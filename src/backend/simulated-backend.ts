/**
 * Simulated Attribution Backend.
 *
 * Implements the production contract in-process:
 *  - GET  go.aurumi.ai/x/{token}          → redirect()
 *  - POST /api/v1/attribution/events      → ingestEvent()
 *
 * Every accepted event runs the production pipeline — source authentication,
 * schema validation, idempotency, acquisition-token resolution, append-only
 * event persistence, the shared Resolution Engine, projection update — inside
 * one repository transaction. It records facts; the engine decides outcomes.
 */

import {
  SCHEMA_VERSION,
  SERVER_RESOLVED_FIELDS,
  BILLING_ONLY_FIELDS,
  SOURCE_AUTHORITY,
  type ApiError,
  type ApiErrorCode,
  type CorrelationHop,
  type IngestEventRequest,
  type IngestEventResponse,
  type IngestOutcome,
  type PipelineStep,
  type RedirectOutcome,
  type ServiceCredential,
  type SourceSystem,
} from "@/backend/contract";
import { simulatedRepository, type AttributionRepository } from "@/backend/repository";
import { SIMULATED_NOW, partnerNameOf, redirectTargetFor } from "@/data/store";
import type {
  AppName,
  Attribution,
  AttributionEvent,
  Click,
  ConversionType,
  Platform,
} from "@/domain/types";
import { resolveAttribution, type ResolutionOutput } from "@/lib/attribution-rules";

const PLAY_PACKAGE: Record<AppName, string> = {
  AURA: "ai.aurumi.aura",
  SHOPTALK: "ai.aurumi.shoptalk",
  AURUMI: "ai.aurumi.app",
};
const SAFE_FALLBACK = "https://aurumi.ai";
const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export class SimulatedCommitFailure extends Error {
  constructor() {
    super("Simulated failure before COMMIT");
    this.name = "SimulatedCommitFailure";
  }
}

function opaqueToken(length = 22): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return out;
}

function userAgentSummary(platform: Platform): string {
  if (platform === "ANDROID") return "Android 14 · Chrome Mobile";
  if (platform === "IOS") return "iOS 18 · Safari Mobile";
  return "Desktop · Chrome";
}

const fail = (code: ApiErrorCode, message: string): ApiError => ({ code, message });

export interface RedirectInput {
  token: string;
  platform: Platform;
  /** Simulated browser/device session (cookie). Production derives this itself. */
  device_session_id: string;
  now?: string | undefined;
  /** Simulate an unexpected internal error. */
  simulateInternalError?: boolean | undefined;
}

export interface IngestOptions {
  failBeforeCommit?: boolean | undefined;
  now?: string | undefined;
}

export function createSimulatedBackend(repo: AttributionRepository = simulatedRepository) {
  /* ------------------------------ redirect ------------------------------ */

  function redirect(input: RedirectInput): RedirectOutcome {
    const url = `https://go.aurumi.ai/x/${input.token}`;
    const pipeline: PipelineStep[] = [];
    const base = {
      referrer: null,
      click_id: null,
      acquisition_session_id: null,
      acquisition_token: null,
    };
    const safe = (
      error: ApiError,
      status: 302 | 404,
      location = SAFE_FALLBACK,
    ): RedirectOutcome => ({
      ...base,
      http: { method: "GET", url, status },
      pipeline,
      location,
      error,
    });

    try {
      if (input.simulateInternalError) throw new Error("simulated internal failure");
      const link = repo.findLinkByToken(input.token);
      if (!link) {
        pipeline.push({ stage: "Resolve token", ok: false, detail: "token not found" });
        return safe(fail("INVALID_TOKEN", "This attribution link is not valid."), 404);
      }
      pipeline.push({ stage: "Resolve token", ok: true, detail: "token found" });
      pipeline.push({ stage: "Verify link", ok: true, detail: `link ${link.link_id} exists` });
      if (link.status !== "ACTIVE") {
        pipeline.push({
          stage: "Verify status",
          ok: false,
          detail: "link DISABLED — no click, no session",
        });
        return safe(fail("LINK_DISABLED", "This attribution link is inactive."), 302);
      }
      pipeline.push({ stage: "Verify status", ok: true, detail: "link ACTIVE" });
      const campaign = repo.findCampaign(link.campaign_id);
      const expired =
        !!campaign?.end_date && new Date(campaign.end_date).getTime() < SIMULATED_NOW.getTime();
      if (!campaign || campaign.status !== "ACTIVE" || expired) {
        pipeline.push({
          stage: "Verify campaign",
          ok: false,
          detail: `campaign ${campaign?.status ?? "missing"}${expired ? " (ended)" : ""} — no eligible acquisition session`,
        });
        return safe(
          fail("CAMPAIGN_INACTIVE", "This campaign is not currently accepting new acquisitions."),
          302,
          redirectUrl(link.app, input.platform, null),
        );
      }
      pipeline.push({
        stage: "Verify campaign",
        ok: true,
        detail: `${campaign.campaign_id} ACTIVE`,
      });

      const now = input.now ?? new Date().toISOString();
      return repo.transaction(() => {
        const click: Click = {
          click_id: repo.nextId("CLK", 5),
          session_id: input.device_session_id,
          link_id: link.link_id,
          token: link.token,
          campaign_id: link.campaign_id,
          partner_id: link.partner_id,
          channel: link.channel,
          app: link.app,
          platform: input.platform,
          user_agent: userAgentSummary(input.platform),
          occurred_at: now,
          redirect_target: redirectTargetFor(link.app, input.platform),
        };
        repo.insertClick(click);
        pipeline.push({ stage: "Persist click", ok: true, detail: click.click_id });

        const token = opaqueToken();
        const windowDays = repo.getRules().click_attribution_window_days;
        const session = {
          acquisition_session_id: repo.nextId("AS", 5),
          link_id: link.link_id,
          click_id: click.click_id,
          public_acquisition_token: token,
          platform: input.platform,
          started_at: now,
          expires_at: new Date(new Date(now).getTime() + windowDays * 86_400_000).toISOString(),
          status: "OPEN" as const,
          device_session_id: input.device_session_id,
        };
        repo.insertSession(session);
        pipeline.push({
          stage: "Create acquisition session",
          ok: true,
          detail: session.acquisition_session_id,
        });
        pipeline.push({
          stage: "Generate acquisition token",
          ok: true,
          detail: `${token} (opaque)`,
        });

        const attribution = repo.findAttribution({ device_session_id: input.device_session_id });
        const fields = {
          attribution_id: attribution?.attribution_id,
          session_id: input.device_session_id,
          link_id: link.link_id,
          campaign_id: link.campaign_id,
          partner_id: link.partner_id ?? undefined,
          click_id: click.click_id,
          app: link.app,
          platform: input.platform,
          channel: link.channel,
        };
        const location = redirectUrl(link.app, input.platform, token);
        const referrer = input.platform === "IOS" ? null : `aur_at=${token}`;
        repo.appendEvent({
          event_type: "LINK_CLICKED",
          occurred_at: now,
          received_at: now,
          ...fields,
          source_system: "REDIRECT_SERVICE",
          source_event_id: `redirect:${click.click_id}`,
          metadata: {
            acquisition_session_id: session.acquisition_session_id,
            user_agent_summary: click.user_agent,
            simulated: true,
          },
        });
        repo.appendEvent({
          event_type: "STORE_REDIRECTED",
          occurred_at: now,
          received_at: now,
          ...fields,
          source_system: "REDIRECT_SERVICE",
          source_event_id: `redirect:${click.click_id}:302`,
          metadata: {
            target: click.redirect_target,
            destination: link.destination,
            referrer,
            simulated: true,
          },
        });
        if (attribution) {
          // Clicks are facts; the engine reports the provisional state (PENDING).
          repo.recordResolution(attribution, runEngine(attribution, now, null));
        }
        pipeline.push({
          stage: "Determine destination",
          ok: true,
          detail: redirectTargetFor(link.app, input.platform),
        });
        pipeline.push({
          stage: "Generate redirect",
          ok: true,
          detail: referrer
            ? `Install Referrer: ${referrer}`
            : "no Install Referrer on this platform",
        });
        return {
          http: { method: "GET", url, status: 302 },
          pipeline,
          location,
          referrer,
          click_id: click.click_id,
          acquisition_session_id: session.acquisition_session_id,
          acquisition_token: token,
          error: null,
        } satisfies RedirectOutcome;
      });
    } catch {
      pipeline.push({ stage: "Internal", ok: false, detail: "unexpected error — safe fallback" });
      return safe(fail("INTERNAL_ERROR", "Something went wrong. Redirecting to aurumi.ai."), 302);
    }
  }

  function redirectUrl(app: AppName, platform: Platform, token: string | null): string {
    if (platform === "ANDROID") {
      const ref = token ? `&referrer=${encodeURIComponent(`aur_at=${token}`)}` : "";
      return `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE[app]}${ref}`;
    }
    if (platform === "IOS") return `https://apps.apple.com/in/app/${app.toLowerCase()}`;
    return `https://app.aurumi.ai/signup${token ? `?aur_at=${token}` : ""}`;
  }

  /* ------------------------------ engine ------------------------------ */

  function runEngine(
    attribution: Attribution,
    at: string,
    signal: { platform: Platform; referrer_recovered: boolean } | null,
  ): ResolutionOutput {
    const install = attribution.install_id ? repo.findInstall(attribution.install_id) : null;
    const installSignal = signal
      ? { ...signal, occurred_at: at }
      : install
        ? {
            platform: install.platform,
            occurred_at: install.occurred_at,
            referrer_recovered: install.referrer_recovered,
          }
        : null;
    return resolveAttribution({
      acquisitionFacts: repo.listClicksForDeviceSession(attribution.session_id),
      installSignal,
      referenceTime: at,
      rules: repo.getRules(),
      partnerName: partnerNameOf,
    });
  }

  /* ------------------------------ ingestion ------------------------------ */

  function validate(req: IngestEventRequest): string | null {
    if (!req.source_event_id) return "source_event_id is required";
    if (!req.occurred_at || Number.isNaN(new Date(req.occurred_at).getTime()))
      return "occurred_at must be an ISO-8601 timestamp";
    switch (req.event_type) {
      case "INSTALL_REFERRER_RECEIVED":
      case "FIRST_OPEN":
        return req.install_id ? null : "install_id is required";
      case "SIGNUP_STARTED":
      case "SIGNUP_COMPLETED":
        return req.user_id && req.signup_id ? null : "user_id and signup_id are required";
      case "TENANT_CREATED":
      case "TENANT_ACTIVATED":
        return req.tenant_id ? null : "tenant_id is required";
      case "SUBSCRIPTION_STARTED":
        return req.tenant_id && req.subscription_id && req.plan_id && req.price_version_id
          ? null
          : "tenant_id, subscription_id, plan_id and price_version_id are required";
      case "FIRST_PAYMENT":
      case "PAYMENT_RECEIVED":
        return req.tenant_id && req.transaction_id && typeof req.amount === "number" && req.currency
          ? null
          : "tenant_id, transaction_id, amount and currency are required";
      default:
        return `unsupported event_type`;
    }
  }

  function ingestEvent(
    req: IngestEventRequest,
    credential: ServiceCredential,
    options: IngestOptions = {},
  ): IngestOutcome {
    const pipeline: PipelineStep[] = [];
    const path = "/api/v1/attribution/events";
    const reject = (status: number, error: ApiError): IngestOutcome => ({
      request: req,
      http: { method: "POST", path, status, body: { success: false, error } },
      pipeline,
      committed: false,
    });

    // 1. Authentication / source validation
    const allowed = SOURCE_AUTHORITY[req.event_type] as string[] | undefined;
    if (credential.source_system !== req.source_system) {
      pipeline.push({
        stage: "Authenticate source",
        ok: false,
        detail: `credential is ${credential.source_system}, payload claims ${req.source_system}`,
      });
      return reject(
        401,
        fail("UNAUTHORIZED_SOURCE", "Caller is not authenticated as the claimed source."),
      );
    }
    const appEvent =
      req.event_type === "INSTALL_REFERRER_RECEIVED" || req.event_type === "FIRST_OPEN";
    const appMismatch = appEvent && req.source_system !== `${req.app}_${req.platform}`;
    if (!allowed?.includes(req.source_system) || appMismatch) {
      pipeline.push({
        stage: "Authenticate source",
        ok: false,
        detail: `${req.source_system} is not authoritative for ${req.event_type}`,
      });
      return reject(
        403,
        fail("UNAUTHORIZED_SOURCE", `${req.source_system} may not submit ${req.event_type}.`),
      );
    }
    pipeline.push({
      stage: "Authenticate source",
      ok: true,
      detail: `${req.source_system} authenticated`,
    });

    // 2. Schema validation
    const invalid = validate(req);
    if (invalid) {
      pipeline.push({ stage: "Validate schema", ok: false, detail: invalid });
      return reject(400, fail("INVALID_EVENT", invalid));
    }
    pipeline.push({
      stage: "Validate schema",
      ok: true,
      detail: `payload valid (schema v${SCHEMA_VERSION})`,
    });

    // 3. Idempotency — UNIQUE(source_system, source_event_id)
    const prior = repo.findIdempotency(req.source_system, req.source_event_id);
    if (prior) {
      pipeline.push({
        stage: "Idempotency check",
        ok: true,
        detail: "source_event_id already seen — replaying original result, nothing written",
      });
      const original = prior.response as IngestEventResponse | null;
      const body: IngestEventResponse = original
        ? { ...original, duplicate: true }
        : {
            accepted: true,
            duplicate: true,
            outcome: "APPLIED",
            event_ids: [],
            attribution_id: null,
            resolution: null,
            received_at: prior.received_at,
            ignored_fields: [],
            warnings: [],
            correlation: [],
          };
      return {
        request: req,
        http: { method: "POST", path, status: 200, body: { success: true, data: body } },
        pipeline,
        committed: false,
      };
    }
    pipeline.push({ stage: "Idempotency check", ok: true, detail: "source_event_id new" });

    // Server authority — strip values the caller may not decide.
    const ignored: string[] = SERVER_RESOLVED_FIELDS.filter((f) => req[f] !== undefined);
    if (req.source_system !== "BILLING_SERVICE") {
      for (const f of BILLING_ONLY_FIELDS) if (req[f] !== undefined) ignored.push(f);
    }
    if (ignored.length > 0) {
      pipeline.push({
        stage: "Server authority",
        ok: true,
        detail: `ignored untrusted fields: ${ignored.join(", ")}`,
      });
    }

    const received_at = options.now ?? new Date().toISOString();
    const warnings: ApiError[] = [];

    // 4. Resolve acquisition token / correlation
    let attribution: Attribution | null = null;
    let tokenResolved = false;
    const isAppEvent =
      req.event_type === "INSTALL_REFERRER_RECEIVED" || req.event_type === "FIRST_OPEN";
    if (isAppEvent) {
      if (req.acquisition_token) {
        const session = repo.findSessionByToken(req.acquisition_token);
        if (session) {
          tokenResolved = true;
          attribution = repo.findAttribution({ device_session_id: session.device_session_id });
          pipeline.push({
            stage: "Resolve acquisition token",
            ok: true,
            detail: `aur_at → ${session.acquisition_session_id} → ${session.click_id} → ${session.link_id}`,
          });
        } else {
          warnings.push(
            fail(
              "UNKNOWN_ACQUISITION_TOKEN",
              "Acquisition token not recognised; install recorded without attribution.",
            ),
          );
          pipeline.push({
            stage: "Resolve acquisition token",
            ok: false,
            detail: "unknown token — will NOT fabricate attribution",
          });
        }
      } else if (req.match_hint) {
        attribution = repo.findAttribution({ device_session_id: req.match_hint });
        pipeline.push({
          stage: "Resolve acquisition token",
          ok: true,
          detail: "no referrer token — provider-dependent matching signals used",
        });
      } else {
        attribution = repo.findAttribution({ install_id: req.install_id });
        pipeline.push({
          stage: "Resolve acquisition token",
          ok: !!attribution,
          detail: attribution
            ? `correlated by install_id ${req.install_id}`
            : "no token — unresolved",
        });
      }
    } else {
      attribution =
        repo.findAttribution({ tenant_id: req.tenant_id }) ??
        repo.findAttribution({ signup_id: req.signup_id }) ??
        repo.findAttribution({ user_id: req.user_id }) ??
        repo.findAttribution({ install_id: req.install_id }) ??
        (req.acquisition_session_id
          ? repo.findAttribution({
              device_session_id: repo.findSession(req.acquisition_session_id)?.device_session_id,
            })
          : null);
      pipeline.push({
        stage: "Correlate",
        ok: !!attribution,
        detail: attribution ? `correlated to ${attribution.attribution_id}` : "no matching journey",
      });
    }

    try {
      const response = repo.transaction(() => {
        pipeline.push({ stage: "BEGIN", ok: true, detail: "transaction opened" });
        const result = apply(req, attribution, tokenResolved, received_at, pipeline);
        const body: IngestEventResponse = {
          accepted: true,
          duplicate: false,
          ...result,
          received_at,
          ignored_fields: ignored,
          warnings,
        };
        repo.saveIdempotency({
          source_system: req.source_system,
          source_event_id: req.source_event_id,
          received_at,
          response: body,
        });
        if (options.failBeforeCommit) {
          pipeline.push({
            stage: "COMMIT",
            ok: false,
            detail: "failure injected before COMMIT → ROLLBACK",
          });
          throw new SimulatedCommitFailure();
        }
        pipeline.push({
          stage: "COMMIT",
          ok: true,
          detail: "event, resolution and projection committed atomically",
        });
        return body;
      });
      return {
        request: req,
        http: { method: "POST", path, status: 200, body: { success: true, data: response } },
        pipeline,
        committed: true,
      };
    } catch (err) {
      if (!(err instanceof SimulatedCommitFailure)) {
        pipeline.push({
          stage: "ROLLBACK",
          ok: false,
          detail: "unexpected error — no partial state persisted",
        });
      } else {
        pipeline.push({
          stage: "ROLLBACK",
          ok: true,
          detail: "no event, resolution or projection change persisted",
        });
      }
      return reject(
        500,
        fail(
          "INTERNAL_ERROR",
          "The event could not be recorded. Retry with the same source_event_id.",
        ),
      );
    }
  }

  type Applied = Pick<
    IngestEventResponse,
    "outcome" | "event_ids" | "attribution_id" | "resolution" | "correlation"
  >;

  function apply(
    req: IngestEventRequest,
    attribution: Attribution | null,
    tokenResolved: boolean,
    received_at: string,
    pipeline: PipelineStep[],
  ): Applied {
    const at = req.occurred_at;
    const eventIds: string[] = [];
    const dup = (why: string): Applied => {
      pipeline.push({
        stage: "Business uniqueness",
        ok: true,
        detail: `${why} — accepted, no new business fact`,
      });
      return {
        outcome: "BUSINESS_DUPLICATE",
        event_ids: [],
        attribution_id: attribution?.attribution_id ?? null,
        resolution: null,
        correlation: [],
      };
    };
    const append = (
      type: AttributionEvent["event_type"],
      extra: Partial<AttributionEvent>,
      suffix = "",
    ) => {
      const e = repo.appendEvent({
        event_type: type,
        occurred_at: at,
        received_at,
        attribution_id: attribution?.attribution_id,
        session_id: attribution?.session_id,
        link_id: attribution?.link_id ?? undefined,
        campaign_id: attribution?.campaign_id ?? undefined,
        partner_id: attribution?.partner_id ?? undefined,
        app: req.app,
        platform: req.platform,
        channel: attribution?.channel ?? undefined,
        source_system: suffix ? "ATTRIBUTION_ENGINE" : req.source_system,
        source_event_id: `${req.source_event_id}${suffix}`,
        schema_version: SCHEMA_VERSION,
        metadata: { ...(req.metadata ?? {}), simulated: true },
        ...extra,
      });
      eventIds.push(e.event_id);
      return e;
    };
    const resolutionSummary = (): Applied["resolution"] => {
      if (!attribution?.current_resolution_id) return null;
      return {
        resolution_id: attribution.current_resolution_id,
        method: attribution.attribution_method,
        partner_id: attribution.partner_id,
        partner_name: attribution.partner_name_snapshot,
        rules_version: attribution.rules_version ?? repo.getRulesVersion(),
        reason: attribution.resolution_reason,
      };
    };
    const asId = () =>
      (attribution?.click_id
        ? repo.findSessionByClick(attribution.click_id)?.acquisition_session_id
        : null) ?? "—";
    const partnerHop = (): CorrelationHop => ({
      label: "Partner",
      value: attribution?.partner_id
        ? `${attribution.partner_id} · ${attribution.partner_name_snapshot ?? "unknown"}`
        : "none (unattributed)",
    });
    const conversion = (type: ConversionType) => {
      repo.insertConversion({
        conversion_event_id: repo.nextId("CNV", 5),
        source_system: req.source_system,
        source_event_id: req.source_event_id,
        conversion_type: type,
        user_id: req.user_id ?? attribution?.user_id ?? null,
        tenant_id: req.tenant_id ?? null,
        subscription_id: req.subscription_id ?? null,
        transaction_id: req.transaction_id ?? null,
        plan_id: req.source_system === "BILLING_SERVICE" ? (req.plan_id ?? null) : null,
        price_version_id:
          req.source_system === "BILLING_SERVICE" ? (req.price_version_id ?? null) : null,
        amount: req.source_system === "BILLING_SERVICE" ? (req.amount ?? null) : null,
        currency: req.source_system === "BILLING_SERVICE" ? (req.currency ?? null) : null,
        occurred_at: at,
        received_at,
        metadata: {},
      });
    };

    switch (req.event_type) {
      case "INSTALL_REFERRER_RECEIVED": {
        if (repo.findInstall(req.install_id!))
          return dup(`install_id ${req.install_id} already recorded`);
        if (attribution?.install_id) return dup("journey already has a canonical install");
        repo.insertInstall({
          install_id: req.install_id!,
          click_id: null,
          session_id: attribution?.session_id ?? "UNRESOLVED",
          app: req.app,
          platform: req.platform,
          attribution_method: "UNATTRIBUTED",
          attribution_source: "NONE",
          referrer_recovered: tokenResolved,
          occurred_at: at,
        });
        pipeline.push({ stage: "Persist install signal", ok: true, detail: req.install_id! });
        if (!attribution) {
          append("INSTALL_UNATTRIBUTED", {
            install_id: req.install_id,
            attribution_method: "UNATTRIBUTED",
          });
          pipeline.push({
            stage: "Append immutable event",
            ok: true,
            detail: "INSTALL_UNATTRIBUTED (unresolved token)",
          });
          pipeline.push({
            stage: "Resolution Engine",
            ok: true,
            detail: "skipped — no acquisition context; not attributed",
          });
          return {
            outcome: "UNRESOLVED",
            event_ids: eventIds,
            attribution_id: null,
            resolution: null,
            correlation: [],
          };
        }
        attribution.install_id = req.install_id!;
        const res = runEngine(attribution, at, {
          platform: req.platform,
          referrer_recovered: tokenResolved,
        });
        repo.recordResolution(attribution, res);
        const install = repo.findInstall(req.install_id!)!;
        install.click_id = res.click_id;
        install.attribution_method = res.attribution_method;
        install.attribution_source = res.attribution_source;
        append(res.status === "ATTRIBUTED" ? "INSTALL_ATTRIBUTED" : "INSTALL_UNATTRIBUTED", {
          install_id: install.install_id,
          click_id: res.click_id ?? undefined,
          link_id: res.link_id ?? undefined,
          campaign_id: res.campaign_id ?? undefined,
          partner_id: res.partner_id ?? undefined,
          attribution_method: res.attribution_method,
          metadata: {
            method_detail: tokenResolved
              ? req.platform === "ANDROID"
                ? "Play Install Referrer"
                : "Preserved attribution token"
              : "Provider-dependent / future capability",
            referrer: tokenResolved ? "Recovered successfully" : "Not available",
            acquisition_session_id: asId(),
            simulated: true,
          },
        });
        pipeline.push({ stage: "Append immutable event", ok: true, detail: eventIds.join(", ") });
        pipeline.push({
          stage: "Resolution Engine",
          ok: true,
          detail: `${res.attribution_method} · ${res.partner_id ? (partnerNameOf(res.partner_id) ?? res.partner_id) : "no partner"} · ${repo.getRulesVersion()}`,
        });
        pipeline.push({
          stage: "Update current attribution",
          ok: true,
          detail: attribution.current_resolution_id ?? "",
        });
        return {
          outcome: "APPLIED",
          event_ids: eventIds,
          attribution_id: attribution.attribution_id,
          resolution: resolutionSummary(),
          correlation: [
            { label: "Install", value: install.install_id },
            { label: "Acquisition session", value: asId() },
            { label: "Click", value: res.click_id ?? "—" },
            { label: "Link", value: res.link_id ?? "—" },
            { label: "Campaign", value: res.campaign_id ?? "—" },
            partnerHop(),
          ],
        };
      }
      case "FIRST_OPEN": {
        if (attribution && repo.hasEvent(attribution.attribution_id, "FIRST_OPEN"))
          return dup("first open already recorded for this journey");
        append("FIRST_OPEN", {
          install_id: req.install_id,
          click_id: attribution?.click_id ?? undefined,
          metadata: {
            attribution_context: attribution ? "restored" : "unresolved",
            simulated: true,
          },
        });
        pipeline.push({ stage: "Append immutable event", ok: true, detail: eventIds.join(", ") });
        pipeline.push({
          stage: "Resolution Engine",
          ok: true,
          detail: "not required — install already resolved",
        });
        return {
          outcome: attribution ? "APPLIED" : "UNRESOLVED",
          event_ids: eventIds,
          attribution_id: attribution?.attribution_id ?? null,
          resolution: resolutionSummary(),
          correlation: [],
        };
      }
      case "SIGNUP_STARTED": {
        if (!attribution) return unresolved();
        if (attribution.signup_id)
          return dup(`journey already has signup ${attribution.signup_id}`);
        attribution.user_id = req.user_id!;
        attribution.signup_id = req.signup_id!;
        append("SIGNUP_STARTED", {
          install_id: attribution.install_id ?? undefined,
          user_id: req.user_id,
          signup_id: req.signup_id,
        });
        pipeline.push({ stage: "Append immutable event", ok: true, detail: eventIds.join(", ") });
        return applied([
          { label: "Signup", value: req.signup_id! },
          { label: "User", value: req.user_id! },
          { label: "Acquisition session", value: asId() },
          {
            label: "Current attribution",
            value: `${attribution.attribution_method} · ${attribution.current_resolution_id ?? "—"}`,
          },
          partnerHop(),
        ]);
      }
      case "SIGNUP_COMPLETED": {
        if (!attribution) return unresolved();
        if (attribution.signup_at) return dup(`signup ${attribution.signup_id} already completed`);
        attribution.signup_at = at;
        attribution.first_conversion_at = at;
        attribution.tenant_name =
          attribution.tenant_name ?? req.tenant_name ?? "Simulated Prospect Pvt Ltd";
        attribution.contact_email = req.contact_email ?? attribution.contact_email;
        append("SIGNUP_COMPLETED", {
          user_id: attribution.user_id ?? undefined,
          signup_id: attribution.signup_id ?? undefined,
          metadata: { email: attribution.contact_email, simulated: true },
        });
        conversion("SIGNUP_COMPLETED");
        pipeline.push({
          stage: "Append immutable event",
          ok: true,
          detail: `${eventIds.join(", ")} + conversion_event`,
        });
        return applied([
          { label: "Signup", value: attribution.signup_id ?? "—" },
          { label: "User", value: attribution.user_id ?? "—" },
          { label: "Acquisition session", value: asId() },
          {
            label: "Current attribution",
            value: `${attribution.attribution_method} · ${attribution.current_resolution_id ?? "—"}`,
          },
          partnerHop(),
        ]);
      }
      case "TENANT_CREATED": {
        if (!attribution) return unresolved();
        if (attribution.tenant_id)
          return dup(`journey already created tenant ${attribution.tenant_id}`);
        if (repo.findAttribution({ tenant_id: req.tenant_id }))
          return dup(`tenant ${req.tenant_id} already exists`);
        attribution.tenant_id = req.tenant_id!;
        attribution.tenant_created_at = at;
        append("TENANT_CREATED", {
          user_id: attribution.user_id ?? undefined,
          tenant_id: req.tenant_id,
          metadata: { tenant_name: attribution.tenant_name, simulated: true },
        });
        conversion("TENANT_CREATED");
        const res = runEngine(attribution, at, null);
        repo.recordResolution(attribution, res);
        append(
          "ATTRIBUTION_RESOLVED",
          {
            tenant_id: attribution.tenant_id,
            partner_id: res.partner_id ?? undefined,
            attribution_method: res.attribution_method,
            metadata: {
              rule: repo.getRules().conflict_rule,
              rules_version: repo.getRulesVersion(),
              eligible_clicks: res.eligible_click_count,
              resolution_reason: res.resolution_reason,
              simulated: true,
            },
          },
          ":resolution",
        );
        pipeline.push({
          stage: "Append immutable event",
          ok: true,
          detail: `${eventIds.join(", ")} + conversion_event`,
        });
        pipeline.push({
          stage: "Resolution Engine",
          ok: true,
          detail: `${res.attribution_method} · ${repo.getRulesVersion()}`,
        });
        pipeline.push({
          stage: "Update current attribution",
          ok: true,
          detail: attribution.current_resolution_id ?? "",
        });
        return applied([
          { label: "Tenant", value: attribution.tenant_id },
          { label: "Acquisition session", value: asId() },
          partnerHop(),
        ]);
      }
      case "TENANT_ACTIVATED": {
        if (!attribution) return unresolved();
        if (attribution.activated_at)
          return dup(`tenant ${attribution.tenant_id} already activated`);
        attribution.activated_at = at;
        append("TENANT_ACTIVATED", { tenant_id: attribution.tenant_id ?? undefined });
        conversion("TENANT_ACTIVATED");
        pipeline.push({
          stage: "Append immutable event",
          ok: true,
          detail: `${eventIds.join(", ")} + conversion_event`,
        });
        return applied([{ label: "Tenant", value: attribution.tenant_id ?? "—" }, partnerHop()]);
      }
      case "SUBSCRIPTION_STARTED": {
        if (!attribution) return unresolved();
        if (attribution.subscription)
          return dup(`subscription ${attribution.subscription.subscription_id} already started`);
        attribution.subscription = {
          subscription_id: req.subscription_id!,
          plan_id: req.plan_id!,
          price_version_id: req.price_version_id!,
          started_at: at,
        };
        append("SUBSCRIPTION_STARTED", {
          tenant_id: attribution.tenant_id ?? undefined,
          metadata: {
            plan_id: req.plan_id!,
            price_version_id: req.price_version_id!,
            subscription_id: req.subscription_id!,
            pricing_source: "PRICE_ADMIN",
            simulated: true,
          },
        });
        conversion("SUBSCRIPTION_STARTED");
        pipeline.push({
          stage: "Append immutable event",
          ok: true,
          detail: `${eventIds.join(", ")} + conversion_event`,
        });
        return applied([
          { label: "Subscription", value: req.subscription_id! },
          { label: "Tenant", value: attribution.tenant_id ?? "—" },
          partnerHop(),
        ]);
      }
      case "FIRST_PAYMENT":
      case "PAYMENT_RECEIVED": {
        if (!attribution) return unresolved();
        if (repo.findConversionByTransaction(req.transaction_id!))
          return dup(`transaction ${req.transaction_id} already recorded`);
        if (req.event_type === "FIRST_PAYMENT" && attribution.first_payment)
          return dup("first payment already recorded for this tenant");
        if (req.event_type === "FIRST_PAYMENT") {
          attribution.first_payment = {
            transaction_id: req.transaction_id!,
            amount: req.amount!,
            currency: "INR",
            occurred_at: at,
          };
          attribution.commercial_conversion_at = at;
        }
        append(req.event_type, {
          tenant_id: attribution.tenant_id ?? undefined,
          metadata: {
            transaction_id: req.transaction_id!,
            amount: req.amount!,
            currency: req.currency ?? "INR",
            subscription_id:
              req.subscription_id ?? attribution.subscription?.subscription_id ?? null,
            commission_calculation: "handled externally",
            simulated: true,
          },
        });
        conversion(req.event_type);
        pipeline.push({
          stage: "Append immutable event",
          ok: true,
          detail: `${eventIds.join(", ")} + conversion_event`,
        });
        return applied([
          { label: "Transaction", value: req.transaction_id! },
          {
            label: "Subscription",
            value: req.subscription_id ?? attribution.subscription?.subscription_id ?? "—",
          },
          { label: "Tenant", value: attribution.tenant_id ?? "—" },
          {
            label: "Attribution",
            value: `${attribution.attribution_id} · ${attribution.attribution_method}`,
          },
          partnerHop(),
        ]);
      }
    }

    function unresolved(): Applied {
      pipeline.push({
        stage: "Correlate",
        ok: false,
        detail: "no journey to correlate — nothing written",
      });
      return {
        outcome: "UNRESOLVED",
        event_ids: [],
        attribution_id: null,
        resolution: null,
        correlation: [],
      };
    }
    function applied(correlation: CorrelationHop[]): Applied {
      if (!pipeline.some((p) => p.stage === "Resolution Engine")) {
        pipeline.push({
          stage: "Resolution Engine",
          ok: true,
          detail: "not required — correlated to current attribution",
        });
      }
      return {
        outcome: "APPLIED",
        event_ids: eventIds,
        attribution_id: attribution!.attribution_id,
        resolution: resolutionSummary(),
        correlation,
      };
    }
  }

  return { redirect, ingestEvent, repository: repo };
}

export const simulatedBackend = createSimulatedBackend();
export type SimulatedBackend = ReturnType<typeof createSimulatedBackend>;
export type { SourceSystem };
