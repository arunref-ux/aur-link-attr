/**
 * Simulated Attribution Backend (V1.2 contract).
 *
 * Implements the production contract in-process:
 *  - GET  go.aurumi.ai/x/{token}             → redirect()     creates Journey → Session → Click
 *  - POST /api/v1/attribution/first-launch   → firstLaunch()  INSTALL_SIGNAL + FIRST_OPEN + binding
 *  - POST /api/v1/attribution/events         → ingestEvent()  signup / tenant / billing facts
 *
 * Every mutation runs inside one repository transaction. Idempotency is claimed
 * INSIDE that transaction (atomic INSERT into idempotency_records), with a
 * canonical request fingerprint distinguishing exact retries from conflicting
 * reuse. It records facts; the shared Resolution Engine decides outcomes.
 *
 * Simulation detail (not a production requirement): the in-memory store and
 * the legacy `Attribution` read model used by the console screens.
 */

import {
  APP_SOURCES,
  BILLING_ONLY_FIELDS,
  SCHEMA_VERSION,
  SERVER_RESOLVED_FIELDS,
  SOURCE_AUTHORITY,
  canonicalRequestHash,
  type ApiError,
  type ApiErrorCode,
  type CorrelationHop,
  type FirstLaunchOutcome,
  type FirstLaunchRequest,
  type FirstLaunchResponse,
  type IngestEventRequest,
  type IngestEventResponse,
  type IngestOutcome,
  type PipelineStep,
  type RedirectOutcome,
  type ServiceCredential,
  type SourceSystem,
} from "@/backend/contract";
import { simulatedRepository, type AttributionRepository } from "@/backend/repository";
import { partnerNameOf, redirectTargetFor, store } from "@/data/store";
import type {
  AcquisitionJourney,
  AppName,
  Attribution,
  AttributionEvent,
  Click,
  ConversionType,
  JourneyOriginType,
  Platform,
} from "@/domain/types";
import { resolveAttribution, type ResolutionOutput } from "@/lib/attribution-rules";
import { lookupReferralCodeIn, normalizeClaim } from "@/lib/referral-lookup";

const PLAY_PACKAGE: Record<AppName, string> = {
  AURA: "ai.aurumi.aura",
  SHOPTALK: "ai.aurumi.shoptalk",
  AURUMI: "ai.aurumi.app",
};
const SAFE_FALLBACK = "https://aurumi.ai";
const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const BINDING_TTL_DAYS = 30;

export class SimulatedCommitFailure extends Error {
  constructor() {
    super("Simulated failure before COMMIT");
    this.name = "SimulatedCommitFailure";
  }
}

/** Business rejection raised inside a transaction → ROLLBACK, no mutation. */
class Rejection extends Error {
  constructor(
    public status: number,
    public error: ApiError,
  ) {
    super(error.message);
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
  /** Legacy simulation metadata (simulated iOS matching only). Not a production key. */
  device_session_id?: string | undefined;
  /** Request/backend evaluation time for this operation. */
  now?: string | undefined;
  simulateInternalError?: boolean | undefined;
}

export interface IngestOptions {
  failBeforeCommit?: boolean | undefined;
  now?: string | undefined;
  /**
   * Contract testing: runs after business processing and before COMMIT —
   * models a concurrent request arriving while this one holds the claim.
   */
  beforeCommit?: (() => void) | undefined;
}

type Mutation<T> = { status: number; body: T };
type IdemResult<T> =
  | { kind: "COMMITTED"; status: number; body: T }
  | { kind: "REPLAY"; status: number; body: T }
  | { kind: "REJECTED"; status: number; error: ApiError };

export function createSimulatedBackend(repo: AttributionRepository = simulatedRepository) {
  /* ------------------------- idempotent transaction ------------------------- */

  function runIdempotent<T extends object>(
    key: { source_system: string; source_event_id: string },
    hash: string,
    pipeline: PipelineStep[],
    received_at: string,
    options: IngestOptions,
    work: () => Mutation<T>,
  ): IdemResult<T> {
    try {
      return repo.transaction(() => {
        pipeline.push({ stage: "BEGIN", ok: true, detail: "transaction opened" });
        const existing = repo.findIdempotency(key.source_system, key.source_event_id);
        if (existing) {
          if (existing.request_hash !== hash) {
            pipeline.push({
              stage: "Idempotency claim",
              ok: false,
              detail: `key exists with different fingerprint (${existing.request_hash} ≠ ${hash})`,
            });
            throw new Rejection(
              409,
              fail(
                "IDEMPOTENCY_KEY_REUSED",
                "source_event_id was already used for a different request.",
              ),
            );
          }
          if (existing.status === "IN_PROGRESS") {
            pipeline.push({
              stage: "Idempotency claim",
              ok: false,
              detail: "identical request in progress — no mutation; retry shortly",
            });
            throw new Rejection(
              409,
              fail("IDEMPOTENCY_IN_PROGRESS", "An identical request is being processed. Retry."),
            );
          }
          pipeline.push({
            stage: "Idempotency claim",
            ok: true,
            detail: "same key + same fingerprint, completed — replaying original result",
          });
          return {
            kind: "REPLAY" as const,
            status: existing.response_code ?? 200,
            body: { ...(existing.response_body as T), duplicate: true },
          };
        }
        repo.claimIdempotency({
          ...key,
          request_hash: hash,
          status: "IN_PROGRESS",
          response_code: null,
          response_body: null,
          created_at: received_at,
          completed_at: null,
        });
        pipeline.push({ stage: "Idempotency claimed", ok: true, detail: "INSERT idempotency_record" });
        pipeline.push({ stage: "Request fingerprint verified", ok: true, detail: hash });

        const result = work();
        options.beforeCommit?.();

        const record = repo.findIdempotency(key.source_system, key.source_event_id)!;
        record.status = "COMPLETED";
        record.response_code = result.status;
        record.response_body = result.body;
        record.completed_at = received_at;
        if (options.failBeforeCommit) {
          pipeline.push({
            stage: "COMMIT",
            ok: false,
            detail: "failure injected before COMMIT → ROLLBACK",
          });
          throw new SimulatedCommitFailure();
        }
        pipeline.push({ stage: "Transaction committed", ok: true, detail: "all rows atomic" });
        return { kind: "COMMITTED" as const, ...result };
      });
    } catch (err) {
      if (err instanceof Rejection) {
        pipeline.push({ stage: "ROLLBACK", ok: true, detail: "no business mutation persisted" });
        return { kind: "REJECTED", status: err.status, error: err.error };
      }
      pipeline.push({
        stage: "ROLLBACK",
        ok: err instanceof SimulatedCommitFailure,
        detail: "no event, resolution, journey or projection change persisted",
      });
      return {
        kind: "REJECTED",
        status: 500,
        error: fail(
          "INTERNAL_ERROR",
          "The request could not be recorded. Retry with the same source_event_id.",
        ),
      };
    }
  }

  /* ------------------------------ journeys ------------------------------ */

  function createJourney(
    origin: JourneyOriginType,
    app: AppName,
    platform: Platform,
    at: string,
    tokenStatus: AcquisitionJourney["acquisition_token_status"],
  ): { journey: AcquisitionJourney; attribution: Attribution } {
    const id = repo.nextId("AJ", 5);
    const journey: AcquisitionJourney = {
      acquisition_journey_id: id,
      origin_type: origin,
      created_at: at,
      updated_at: at,
      first_acquisition_session_id: null,
      install_id: null,
      user_id: null,
      signup_id: null,
      tenant_id: null,
      app,
      status: "OPEN",
      acquisition_token_status: tokenStatus,
      claims: [],
    };
    repo.insertJourney(journey);
    // Simulation read model used by console screens; keyed by the journey. Not resolved yet.
    const attribution: Attribution = {
      attribution_id: id,
      acquisition_journey_id: id,
      partner_id: null,
      partner_name_snapshot: null,
      partner_type_snapshot: null,
      campaign_id: null,
      link_id: null,
      click_id: null,
      install_id: null,
      session_id: id,
      user_id: null,
      signup_id: null,
      tenant_id: null,
      tenant_name: null,
      contact_email: null,
      channel: null,
      app,
      platform,
      attribution_method: "UNATTRIBUTED",
      attribution_source: "NONE",
      resolution_reason: "Journey exists — not yet resolved",
      resolution_timestamp: at,
      attributed_at: null,
      first_conversion_at: null,
      commercial_conversion_at: null,
      status: "PENDING",
      signup_at: null,
      tenant_created_at: null,
      activated_at: null,
      subscription: null,
      first_payment: null,
      overrides: [],
    };
    repo.insertAttribution(attribution);
    return { journey, attribution };
  }

  /* ------------------------------ redirect ------------------------------ */

  function redirect(input: RedirectInput): RedirectOutcome {
    const url = `https://go.aurumi.ai/x/${input.token}`;
    const pipeline: PipelineStep[] = [];
    const base = {
      referrer: null,
      acquisition_journey_id: null,
      click_id: null,
      acquisition_session_id: null,
      acquisition_token: null,
    };
    const safe = (error: ApiError, status: 302 | 404, location = SAFE_FALLBACK): RedirectOutcome => ({
      ...base,
      http: { method: "GET", url, status },
      pipeline,
      location,
      error,
    });
    const now = input.now ?? new Date().toISOString();
    const nowMs = new Date(now).getTime();

    try {
      if (input.simulateInternalError) throw new Error("simulated internal failure");
      const link = repo.findLinkByToken(input.token);
      if (!link) {
        pipeline.push({ stage: "Resolve token", ok: false, detail: "token not found" });
        return safe(fail("INVALID_TOKEN", "This attribution link is not valid."), 404);
      }
      pipeline.push({ stage: "Resolve token", ok: true, detail: `link ${link.link_id}` });
      if (link.status !== "ACTIVE") {
        pipeline.push({
          stage: "Validate link",
          ok: false,
          detail: "link DISABLED — no journey, click or session",
        });
        return safe(fail("LINK_DISABLED", "This attribution link is inactive."), 302);
      }
      pipeline.push({ stage: "Validate link", ok: true, detail: "link ACTIVE" });
      const campaign = repo.findCampaign(link.campaign_id);
      // Evaluated at this request's time, not a simulation clock.
      const ended = !!campaign?.end_date && new Date(campaign.end_date).getTime() < nowMs;
      const notStarted = !!campaign && new Date(campaign.start_date).getTime() > nowMs;
      if (!campaign || campaign.status !== "ACTIVE" || ended || notStarted) {
        pipeline.push({
          stage: "Validate campaign",
          ok: false,
          detail: `campaign ${campaign?.status ?? "missing"}${ended ? " (ended)" : ""}${notStarted ? " (not started)" : ""} at ${now}`,
        });
        return safe(
          fail("CAMPAIGN_INACTIVE", "This campaign is not currently accepting new acquisitions."),
          302,
          redirectUrl(link.app, input.platform, null),
        );
      }
      pipeline.push({
        stage: "Validate campaign",
        ok: true,
        detail: `${campaign.campaign_id} ACTIVE at ${now}`,
      });

      return repo.transaction(() => {
        pipeline.push({ stage: "BEGIN", ok: true, detail: "transaction opened" });
        const { journey, attribution } = createJourney(
          "ATTRIBUTION_LINK",
          link.app,
          input.platform,
          now,
          "NOT_APPLICABLE",
        );
        pipeline.push({
          stage: "Create AcquisitionJourney",
          ok: true,
          detail: `${journey.acquisition_journey_id} · origin ATTRIBUTION_LINK`,
        });

        const token = opaqueToken();
        const windowDays = repo.getRules().click_attribution_window_days;
        const session = {
          acquisition_session_id: repo.nextId("AS", 5),
          acquisition_journey_id: journey.acquisition_journey_id,
          link_id: link.link_id,
          public_acquisition_token: token,
          platform: input.platform,
          started_at: now,
          expires_at: new Date(nowMs + windowDays * 86_400_000).toISOString(),
          status: "OPEN" as const,
          device_session_id: input.device_session_id ?? journey.acquisition_journey_id,
        };
        repo.insertSession(session);
        journey.first_acquisition_session_id = session.acquisition_session_id;
        pipeline.push({
          stage: "Create AcquisitionSession",
          ok: true,
          detail: `${session.acquisition_session_id} → ${journey.acquisition_journey_id}`,
        });

        const click: Click = {
          click_id: repo.nextId("CLK", 5),
          session_id: journey.acquisition_journey_id,
          acquisition_journey_id: journey.acquisition_journey_id,
          acquisition_session_id: session.acquisition_session_id,
          received_at: now,
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
        pipeline.push({
          stage: "Create Click",
          ok: true,
          detail: `${click.click_id} → ${session.acquisition_session_id}`,
        });
        pipeline.push({ stage: "Store acquisition token", ok: true, detail: `aur_at ${token} (opaque)` });

        const fields = {
          attribution_id: attribution.attribution_id,
          session_id: journey.acquisition_journey_id,
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
            acquisition_journey_id: journey.acquisition_journey_id,
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
          metadata: { target: click.redirect_target, destination: link.destination, referrer, simulated: true },
        });
        pipeline.push({ stage: "COMMIT", ok: true, detail: "journey, session, click committed" });
        pipeline.push({
          stage: "Redirect",
          ok: true,
          detail: referrer ? `302 · Install Referrer ${referrer}` : "302 · no Install Referrer on this platform",
        });
        return {
          http: { method: "GET", url, status: 302 },
          pipeline,
          location,
          referrer,
          acquisition_journey_id: journey.acquisition_journey_id,
          click_id: click.click_id,
          acquisition_session_id: session.acquisition_session_id,
          acquisition_token: token,
          error: null,
        } satisfies RedirectOutcome;
      });
    } catch {
      pipeline.push({ stage: "ROLLBACK", ok: false, detail: "no orphan journey, click or session — safe fallback" });
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
    journey: AcquisitionJourney | null,
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
      acquisitionFacts: journey
        ? repo.listClicksForJourney(journey.acquisition_journey_id)
        : repo.listClicksForDeviceSession(attribution.session_id),
      installSignal,
      claims: journey?.claims.length ? journey.claims : undefined,
      referenceTime: at,
      rules: repo.getRules(),
      partnerName: partnerNameOf,
    });
  }

  function ignoredFields(req: object, sourceSystem: string): string[] {
    const r = req as Record<string, unknown>;
    const ignored: string[] = SERVER_RESOLVED_FIELDS.filter((f) => r[f] !== undefined);
    if (sourceSystem !== "BILLING_SERVICE") {
      for (const f of BILLING_ONLY_FIELDS) if (r[f] !== undefined) ignored.push(f);
    }
    return ignored;
  }

  /* ------------------------------ first launch ------------------------------ */

  function firstLaunch(
    req: FirstLaunchRequest,
    credential: ServiceCredential,
    options: IngestOptions = {},
  ): FirstLaunchOutcome {
    const pipeline: PipelineStep[] = [];
    const path = "/api/v1/attribution/first-launch";
    const reject = (status: number, error: ApiError): FirstLaunchOutcome => ({
      request: req,
      http: { method: "POST", path, status, body: { success: false, error } },
      pipeline,
      committed: false,
    });

    const expectedSource = `${req.app}_${req.platform}`;
    if (credential.source_system !== req.source_system) {
      pipeline.push({ stage: "Authenticate source", ok: false, detail: "credential ≠ payload source" });
      return reject(401, fail("UNAUTHORIZED_SOURCE", "Caller is not authenticated as the claimed source."));
    }
    if (!(APP_SOURCES as string[]).includes(req.source_system) || req.source_system !== expectedSource) {
      pipeline.push({
        stage: "Authenticate source",
        ok: false,
        detail: `${req.source_system} may not report first launch for ${expectedSource}`,
      });
      return reject(403, fail("UNAUTHORIZED_SOURCE", `${req.source_system} may not submit FIRST_LAUNCH.`));
    }
    pipeline.push({ stage: "Authenticate source", ok: true, detail: `${req.source_system} authenticated` });

    const invalid = !req.source_event_id
      ? "source_event_id is required"
      : !req.installation_id
        ? "installation_id is required"
        : !req.occurred_at || Number.isNaN(new Date(req.occurred_at).getTime())
          ? "occurred_at must be an ISO-8601 timestamp"
          : null;
    if (invalid) {
      pipeline.push({ stage: "Validate schema", ok: false, detail: invalid });
      return reject(400, fail("INVALID_EVENT", invalid));
    }
    pipeline.push({ stage: "Validate schema", ok: true, detail: `schema v${SCHEMA_VERSION}` });

    const ignored = ignoredFields(req, req.source_system);
    if (ignored.length)
      pipeline.push({ stage: "Server authority", ok: true, detail: `ignored untrusted fields: ${ignored.join(", ")}` });

    const received_at = options.now ?? new Date().toISOString();
    const hash = canonicalRequestHash(req);
    const at = req.occurred_at;

    const result = runIdempotent<FirstLaunchResponse>(req, hash, pipeline, received_at, options, () => {
      const warnings: ApiError[] = [];
      // Business identity: UNIQUE(app, installation_id)
      const existingInstall = repo.findInstall(req.installation_id);
      if (existingInstall && existingInstall.app === req.app) {
        const j = repo.findJourneyBy({ install_id: req.installation_id });
        const a = j ? repo.findAttribution({ acquisition_journey_id: j.acquisition_journey_id }) : null;
        pipeline.push({
          stage: "Installation uniqueness checked",
          ok: true,
          detail: `${req.installation_id} already canonical on ${j?.acquisition_journey_id ?? "—"} — no new facts`,
        });
        const binding = store.signupBindings.find(
          (b) => b.installation_id === req.installation_id && b.status === "ISSUED",
        );
        return {
          status: 200,
          body: {
            success: true,
            duplicate: false,
            outcome: "BUSINESS_DUPLICATE",
            acquisition_journey_id: j?.acquisition_journey_id ?? "",
            installation_id: req.installation_id,
            signup_binding_token: binding?.public_token ?? null,
            attribution: {
              status: a?.status ?? "UNATTRIBUTED",
              method: a?.attribution_method ?? "UNATTRIBUTED",
            },
            received_at,
            ignored_fields: ignored,
            warnings,
            correlation: [{ label: "Journey", value: j?.acquisition_journey_id ?? "—" }],
          },
        };
      }

      // Resolve acquisition token → session → journey
      let journey: AcquisitionJourney | null = null;
      let tokenValid = false;
      let tokenStatus: AcquisitionJourney["acquisition_token_status"] = "ABSENT";
      let sessionId: string | null = null;
      if (req.acquisition_token) {
        const session = repo.findSessionByToken(req.acquisition_token);
        const candidate = session ? repo.findJourney(session.acquisition_journey_id) : null;
        if (session && candidate && !candidate.install_id) {
          journey = candidate;
          tokenValid = true;
          tokenStatus = "VALID";
          sessionId = session.acquisition_session_id;
          pipeline.push({
            stage: "Acquisition token resolved",
            ok: true,
            detail: `aur_at → ${session.acquisition_session_id} → ${candidate.acquisition_journey_id}`,
          });
        } else {
          tokenStatus = "UNKNOWN";
          warnings.push(
            fail(
              "UNKNOWN_ACQUISITION_TOKEN",
              "Acquisition token not recognised; installation recorded without attribution.",
            ),
          );
          pipeline.push({
            stage: "Acquisition token resolved",
            ok: false,
            detail: session ? "token already bound to another installation — not reused" : "unknown token — will NOT fabricate attribution",
          });
        }
      } else if (req.match_hint) {
        const session = repo.findSessionByDeviceHint(req.match_hint);
        const candidate = session ? repo.findJourney(session.acquisition_journey_id) : null;
        if (candidate && !candidate.install_id) {
          journey = candidate;
          sessionId = session!.acquisition_session_id;
        }
        pipeline.push({
          stage: "Acquisition token resolved",
          ok: !!journey,
          detail: journey
            ? `no referrer — provider-dependent match → ${journey.acquisition_journey_id}`
            : "no referrer, no match",
        });
      } else {
        pipeline.push({ stage: "Acquisition token resolved", ok: true, detail: "aur_at absent — direct install" });
      }

      let attribution: Attribution;
      if (journey) {
        attribution = repo.findAttribution({ acquisition_journey_id: journey.acquisition_journey_id })!;
        journey.acquisition_token_status = tokenStatus;
        pipeline.push({ stage: "Journey located", ok: true, detail: journey.acquisition_journey_id });
      } else {
        const created = createJourney("DIRECT_FIRST_LAUNCH", req.app, req.platform, at, tokenStatus);
        journey = created.journey;
        attribution = created.attribution;
        pipeline.push({
          stage: "Journey created",
          ok: true,
          detail: `${journey.acquisition_journey_id} · DIRECT_FIRST_LAUNCH · token ${tokenStatus}`,
        });
      }
      pipeline.push({ stage: "Installation uniqueness checked", ok: true, detail: `${req.app} · ${req.installation_id} new` });

      repo.insertInstall({
        install_id: req.installation_id,
        acquisition_journey_id: journey.acquisition_journey_id,
        click_id: null,
        session_id: attribution.session_id,
        app: req.app,
        platform: req.platform,
        attribution_method: "UNATTRIBUTED",
        attribution_source: "NONE",
        referrer_recovered: tokenValid,
        occurred_at: at,
      });
      journey.install_id = req.installation_id;
      journey.status = "INSTALLED";
      journey.updated_at = received_at;
      attribution.install_id = req.installation_id;

      const res = runEngine(attribution, journey, at, { platform: req.platform, referrer_recovered: tokenValid });
      const install = repo.findInstall(req.installation_id)!;
      install.click_id = res.click_id;
      install.attribution_method = res.attribution_method;
      install.attribution_source = res.attribution_source;

      const common = {
        occurred_at: at,
        received_at,
        attribution_id: attribution.attribution_id,
        session_id: attribution.session_id,
        install_id: req.installation_id,
        app: req.app,
        platform: req.platform,
        source_system: req.source_system,
        schema_version: SCHEMA_VERSION,
      };
      const signalEvent = repo.appendEvent({
        ...common,
        event_type: res.status === "ATTRIBUTED" ? "INSTALL_ATTRIBUTED" : "INSTALL_UNATTRIBUTED",
        source_event_id: `${req.source_event_id}:install_signal`,
        click_id: res.click_id ?? undefined,
        link_id: res.link_id ?? undefined,
        campaign_id: res.campaign_id ?? undefined,
        partner_id: res.partner_id ?? undefined,
        attribution_method: res.attribution_method,
        metadata: {
          fact: "INSTALL_SIGNAL",
          acquisition_journey_id: journey.acquisition_journey_id,
          acquisition_session_id: sessionId,
          acquisition_token_status: tokenStatus,
          method_detail: tokenValid
            ? req.platform === "ANDROID"
              ? "Play Install Referrer"
              : "Preserved attribution token"
            : "Provider-dependent / future capability",
          referrer: tokenValid ? "Recovered successfully" : "Not available",
          simulated: true,
        },
      });
      pipeline.push({ stage: "INSTALL_SIGNAL persisted", ok: true, detail: signalEvent.event_id });
      const openEvent = repo.appendEvent({
        ...common,
        event_type: "FIRST_OPEN",
        source_event_id: `${req.source_event_id}:first_open`,
        click_id: res.click_id ?? undefined,
        metadata: { fact: "FIRST_OPEN", app_version: req.app_version, simulated: true },
      });
      pipeline.push({ stage: "FIRST_OPEN persisted", ok: true, detail: openEvent.event_id });

      repo.recordResolution(attribution, res);
      pipeline.push({
        stage: "Resolution Engine executed",
        ok: true,
        detail: `${res.attribution_method} · ${res.partner_id ? (partnerNameOf(res.partner_id) ?? res.partner_id) : "no partner"} · ${repo.getRulesVersion()}`,
      });
      pipeline.push({ stage: "Current attribution updated", ok: true, detail: attribution.current_resolution_id ?? "" });

      const binding = {
        signup_binding_id: repo.nextId("SB", 5),
        public_token: `sbt_${opaqueToken(26)}`,
        acquisition_journey_id: journey.acquisition_journey_id,
        installation_id: req.installation_id,
        status: "ISSUED" as const,
        expires_at: new Date(new Date(received_at).getTime() + BINDING_TTL_DAYS * 86_400_000).toISOString(),
        created_at: received_at,
        consumed_at: null,
        bound_signup_id: null,
      };
      repo.insertBinding(binding);
      pipeline.push({ stage: "Signup binding issued", ok: true, detail: `${binding.signup_binding_id} (opaque token)` });

      return {
        status: 200,
        body: {
          success: true,
          duplicate: false,
          outcome: "APPLIED",
          acquisition_journey_id: journey.acquisition_journey_id,
          installation_id: req.installation_id,
          signup_binding_token: binding.public_token,
          attribution: { status: res.status, method: res.attribution_method },
          received_at,
          ignored_fields: ignored,
          warnings,
          correlation: [
            { label: "Journey", value: journey.acquisition_journey_id },
            { label: "Acquisition session", value: sessionId ?? "—" },
            { label: "Installation", value: req.installation_id },
            { label: "Resolution", value: `${res.attribution_method} · ${attribution.current_resolution_id ?? "—"}` },
            { label: "Signup binding", value: binding.signup_binding_id },
          ],
        },
      };
    });

    if (result.kind === "REJECTED") return reject(result.status, result.error);
    return {
      request: req,
      http: { method: "POST", path, status: result.status, body: result.body },
      pipeline,
      committed: result.kind === "COMMITTED",
    };
  }

  /* ------------------------------ event ingestion ------------------------------ */

  function validate(req: IngestEventRequest): string | null {
    if (!req.source_event_id) return "source_event_id is required";
    if (!req.occurred_at || Number.isNaN(new Date(req.occurred_at).getTime()))
      return "occurred_at must be an ISO-8601 timestamp";
    switch (req.event_type) {
      case "SIGNUP_STARTED":
      case "SIGNUP_COMPLETED":
        return req.user_id && req.signup_id && req.signup_binding_token
          ? null
          : "user_id, signup_id and signup_binding_token are required";
      case "TENANT_CREATED":
      case "TENANT_ACTIVATED":
        return req.tenant_id && (req.user_id || req.signup_id)
          ? null
          : "tenant_id and user_id or signup_id are required";
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
        return "unsupported event_type (install / first open use /first-launch)";
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

    const allowed = SOURCE_AUTHORITY[req.event_type] as string[] | undefined;
    if (credential.source_system !== req.source_system) {
      pipeline.push({
        stage: "Authenticate source",
        ok: false,
        detail: `credential is ${credential.source_system}, payload claims ${req.source_system}`,
      });
      return reject(401, fail("UNAUTHORIZED_SOURCE", "Caller is not authenticated as the claimed source."));
    }
    if (!allowed?.includes(req.source_system)) {
      pipeline.push({
        stage: "Authenticate source",
        ok: false,
        detail: `${req.source_system} is not authoritative for ${req.event_type}`,
      });
      return reject(403, fail("UNAUTHORIZED_SOURCE", `${req.source_system} may not submit ${req.event_type}.`));
    }
    pipeline.push({ stage: "Authenticate source", ok: true, detail: `${req.source_system} authenticated` });

    const invalid = validate(req);
    if (invalid) {
      pipeline.push({ stage: "Validate schema", ok: false, detail: invalid });
      return reject(400, fail("INVALID_EVENT", invalid));
    }
    pipeline.push({ stage: "Validate schema", ok: true, detail: `payload valid (schema v${SCHEMA_VERSION})` });

    const ignored = ignoredFields(req, req.source_system);
    if (ignored.length)
      pipeline.push({ stage: "Server authority", ok: true, detail: `ignored untrusted fields: ${ignored.join(", ")}` });

    const received_at = options.now ?? new Date().toISOString();
    const hash = canonicalRequestHash(req);

    const result = runIdempotent<IngestEventResponse>(req, hash, pipeline, received_at, options, () => {
      const { journey, attribution } = correlate(req, pipeline, received_at);
      const applied = apply(req, journey, attribution, received_at, pipeline);
      return {
        status: 200,
        body: {
          accepted: true,
          duplicate: false,
          ...applied,
          received_at,
          ignored_fields: ignored,
          warnings: [],
        },
      };
    });

    if (result.kind === "REJECTED") return reject(result.status, result.error);
    return {
      request: req,
      http: { method: "POST", path, status: result.status, body: { success: true, data: result.body } },
      pipeline,
      committed: result.kind === "COMMITTED",
    };
  }

  /** Trusted correlation — never from client-supplied journey / session IDs. */
  function correlate(
    req: IngestEventRequest,
    pipeline: PipelineStep[],
    received_at: string,
  ): { journey: AcquisitionJourney | null; attribution: Attribution | null } {
    if (req.event_type === "SIGNUP_STARTED" || req.event_type === "SIGNUP_COMPLETED") {
      const binding = repo.findBindingByToken(req.signup_binding_token!);
      const expired = binding && new Date(binding.expires_at).getTime() < new Date(received_at).getTime();
      if (!binding || expired || binding.status === "REVOKED" || binding.status === "EXPIRED") {
        pipeline.push({ stage: "Validate signup binding", ok: false, detail: "token invalid or expired — no journey association" });
        throw new Rejection(422, fail("SIGNUP_BINDING_INVALID", "The signup binding token is not valid."));
      }
      if (binding.bound_signup_id && binding.bound_signup_id !== req.signup_id) {
        pipeline.push({
          stage: "Validate signup binding",
          ok: false,
          detail: "binding already attached to a different signup",
        });
        throw new Rejection(409, fail("SIGNUP_BINDING_CONSUMED", "This signup binding is already used."));
      }
      const journey = repo.findJourney(binding.acquisition_journey_id)!;
      const other = repo.findJourneyBy({ signup_id: req.signup_id });
      if (other && other.acquisition_journey_id !== journey.acquisition_journey_id) {
        pipeline.push({ stage: "Signup uniqueness", ok: false, detail: "signup_id belongs to another journey" });
        throw new Rejection(409, fail("BUSINESS_IDENTITY_CONFLICT", "signup_id is already associated elsewhere."));
      }
      if (!binding.bound_signup_id) {
        binding.bound_signup_id = req.signup_id!;
        binding.status = "CONSUMED";
        binding.consumed_at = received_at;
      }
      pipeline.push({
        stage: "Validate signup binding",
        ok: true,
        detail: `binding → ${binding.installation_id} → ${journey.acquisition_journey_id}`,
      });
      return {
        journey,
        attribution: repo.findAttribution({ acquisition_journey_id: journey.acquisition_journey_id }),
      };
    }
    let journey: AcquisitionJourney | null = null;
    if (req.event_type === "TENANT_CREATED" || req.event_type === "TENANT_ACTIVATED") {
      journey =
        (req.event_type === "TENANT_ACTIVATED" ? repo.findJourneyBy({ tenant_id: req.tenant_id }) : null) ??
        repo.findJourneyBy({ signup_id: req.signup_id }) ??
        repo.findJourneyBy({ user_id: req.user_id });
    } else {
      journey = repo.findJourneyBy({ tenant_id: req.tenant_id });
    }
    const attribution = journey
      ? repo.findAttribution({ acquisition_journey_id: journey.acquisition_journey_id })
      : // legacy seeded journeys (pre-V1.2) correlate by business IDs on the read model
        (repo.findAttribution({ tenant_id: req.tenant_id }) ??
        repo.findAttribution({ signup_id: req.signup_id }) ??
        repo.findAttribution({ user_id: req.user_id }));
    pipeline.push({
      stage: "Trusted correlation",
      ok: !!attribution,
      detail: attribution
        ? `${req.event_type.startsWith("TENANT") ? "user/signup identity" : "tenant identity"} → ${journey?.acquisition_journey_id ?? `${attribution.attribution_id} (legacy)`}`
        : "no journey for this business identity",
    });
    return { journey, attribution };
  }

  type Applied = Pick<
    IngestEventResponse,
    "outcome" | "event_ids" | "acquisition_journey_id" | "resolution" | "correlation"
  >;

  function apply(
    req: IngestEventRequest,
    journey: AcquisitionJourney | null,
    attribution: Attribution | null,
    received_at: string,
    pipeline: PipelineStep[],
  ): Applied {
    const at = req.occurred_at;
    const eventIds: string[] = [];
    const journeyId = journey?.acquisition_journey_id ?? attribution?.attribution_id ?? null;
    const touch = () => {
      if (journey) journey.updated_at = received_at;
    };
    const dup = (why: string): Applied => {
      pipeline.push({ stage: "Business uniqueness", ok: true, detail: `${why} — no new canonical outcome` });
      return { outcome: "BUSINESS_DUPLICATE", event_ids: [], acquisition_journey_id: journeyId, resolution: null, correlation: [] };
    };
    const append = (type: AttributionEvent["event_type"], extra: Partial<AttributionEvent>, suffix = "") => {
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
    const journeyHop = (): CorrelationHop => ({ label: "Journey", value: journeyId ?? "—" });
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
        price_version_id: req.source_system === "BILLING_SERVICE" ? (req.price_version_id ?? null) : null,
        amount: req.source_system === "BILLING_SERVICE" ? (req.amount ?? null) : null,
        currency: req.source_system === "BILLING_SERVICE" ? (req.currency ?? null) : null,
        occurred_at: at,
        received_at,
        metadata: {},
      });
    };
    const reresolve = (why: string) => {
      const res = runEngine(attribution!, journey, at, null);
      repo.recordResolution(attribution!, res);
      append(
        "ATTRIBUTION_RESOLVED",
        {
          tenant_id: attribution!.tenant_id ?? undefined,
          partner_id: res.partner_id ?? undefined,
          attribution_method: res.attribution_method,
          metadata: {
            trigger: why,
            rule: repo.getRules().conflict_rule,
            rules_version: repo.getRulesVersion(),
            eligible_clicks: res.eligible_click_count,
            resolution_reason: res.resolution_reason,
            simulated: true,
          },
        },
        ":resolution",
      );
      pipeline.push({ stage: "Resolution Engine", ok: true, detail: `${res.attribution_method} · ${repo.getRulesVersion()}` });
      pipeline.push({ stage: "Current attribution updated", ok: true, detail: attribution!.current_resolution_id ?? "" });
    };

    if (!attribution) return unresolved();

    switch (req.event_type) {
      case "SIGNUP_STARTED":
      case "SIGNUP_COMPLETED": {
        if (req.event_type === "SIGNUP_STARTED" && attribution.signup_id)
          return dup(`journey already has signup ${attribution.signup_id}`);
        if (req.event_type === "SIGNUP_COMPLETED" && attribution.signup_at)
          return dup(`signup ${attribution.signup_id} already completed`);
        attribution.user_id = req.user_id!;
        attribution.signup_id = req.signup_id!;
        if (journey) {
          journey.user_id = req.user_id!;
          journey.signup_id = req.signup_id!;
          journey.status = "SIGNED_UP";
          touch();
        }
        pipeline.push({ stage: "Signup associated", ok: true, detail: `${req.signup_id} / ${req.user_id} → ${journeyId}` });
        if (req.event_type === "SIGNUP_STARTED") {
          append("SIGNUP_STARTED", { install_id: attribution.install_id ?? undefined, user_id: req.user_id, signup_id: req.signup_id });
        } else {
          attribution.signup_at = at;
          attribution.first_conversion_at = at;
          attribution.tenant_name = attribution.tenant_name ?? req.tenant_name ?? "Simulated Prospect Pvt Ltd";
          attribution.contact_email = req.contact_email ?? attribution.contact_email;
          append("SIGNUP_COMPLETED", {
            user_id: req.user_id,
            signup_id: req.signup_id,
            metadata: { email: attribution.contact_email, referral_code: req.referral_code ?? null, simulated: true },
          });
          conversion("SIGNUP_COMPLETED");
          if (req.referral_code && journey) {
            // Referral code → Partner Portal lookup → normalized claim → engine (configured precedence).
            const claim = normalizeClaim(lookupReferralCodeIn(store.partners, req.referral_code), at);
            pipeline.push({
              stage: "Referral claim",
              ok: !!claim,
              detail: claim ? `${req.referral_code} → ${claim.partner_id} (Partner Portal)` : `${req.referral_code} not recognised`,
            });
            if (claim) {
              journey.claims.push(claim);
              reresolve("REFERRAL_CLAIM");
            }
          }
        }
        return applied([
          { label: "Signup binding", value: "validated server-to-server" },
          journeyHop(),
          { label: "Signup", value: req.signup_id! },
          { label: "User", value: req.user_id! },
          { label: "Current attribution", value: `${attribution.attribution_method} · ${attribution.current_resolution_id ?? "—"}` },
          partnerHop(),
        ]);
      }
      case "TENANT_CREATED": {
        if (attribution.tenant_id) {
          if (attribution.tenant_id === req.tenant_id) return dup(`tenant ${req.tenant_id} already created`);
          return dup(`journey already created tenant ${attribution.tenant_id}`);
        }
        const other = repo.findJourneyBy({ tenant_id: req.tenant_id }) ?? repo.findAttribution({ tenant_id: req.tenant_id });
        if (other) return dup(`tenant ${req.tenant_id} already exists`);
        attribution.tenant_id = req.tenant_id!;
        attribution.tenant_created_at = at;
        if (journey) {
          journey.tenant_id = req.tenant_id!;
          journey.status = "TENANT";
          touch();
        }
        append("TENANT_CREATED", {
          user_id: attribution.user_id ?? undefined,
          tenant_id: req.tenant_id,
          metadata: { tenant_name: attribution.tenant_name, simulated: true },
        });
        conversion("TENANT_CREATED");
        pipeline.push({ stage: "Tenant associated", ok: true, detail: `${req.tenant_id} → ${journeyId}` });
        reresolve("TENANT_CREATED");
        return applied([
          { label: "User / signup", value: `${req.user_id ?? "—"} / ${req.signup_id ?? "—"}` },
          journeyHop(),
          { label: "Tenant", value: req.tenant_id! },
          partnerHop(),
        ]);
      }
      case "TENANT_ACTIVATED": {
        if (attribution.activated_at) return dup(`tenant ${attribution.tenant_id} already activated`);
        attribution.activated_at = at;
        touch();
        append("TENANT_ACTIVATED", { tenant_id: attribution.tenant_id ?? undefined });
        conversion("TENANT_ACTIVATED");
        return applied([journeyHop(), { label: "Tenant", value: attribution.tenant_id ?? "—" }, partnerHop()]);
      }
      case "SUBSCRIPTION_STARTED": {
        if (attribution.subscription) return dup(`subscription ${attribution.subscription.subscription_id} already started`);
        attribution.subscription = {
          subscription_id: req.subscription_id!,
          plan_id: req.plan_id!,
          price_version_id: req.price_version_id!,
          started_at: at,
        };
        touch();
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
        return applied([
          journeyHop(),
          { label: "Tenant", value: attribution.tenant_id ?? "—" },
          { label: "Subscription", value: req.subscription_id! },
          partnerHop(),
        ]);
      }
      case "FIRST_PAYMENT":
      case "PAYMENT_RECEIVED": {
        if (repo.findConversionByTransaction(req.transaction_id!)) return dup(`transaction ${req.transaction_id} already recorded`);
        if (req.event_type === "FIRST_PAYMENT" && attribution.first_payment) return dup("first payment already recorded for this tenant");
        if (req.event_type === "FIRST_PAYMENT") {
          attribution.first_payment = {
            transaction_id: req.transaction_id!,
            amount: req.amount!,
            currency: "INR",
            occurred_at: at,
          };
          attribution.commercial_conversion_at = at;
        }
        touch();
        append(req.event_type, {
          tenant_id: attribution.tenant_id ?? undefined,
          metadata: {
            transaction_id: req.transaction_id!,
            amount: req.amount!,
            currency: req.currency ?? "INR",
            subscription_id: req.subscription_id ?? attribution.subscription?.subscription_id ?? null,
            commission_calculation: "handled externally",
            simulated: true,
          },
        });
        conversion(req.event_type);
        return applied([
          journeyHop(),
          { label: "Tenant", value: attribution.tenant_id ?? "—" },
          { label: "Subscription", value: req.subscription_id ?? attribution.subscription?.subscription_id ?? "—" },
          { label: "Transaction", value: req.transaction_id! },
          partnerHop(),
        ]);
      }
    }

    function unresolved(): Applied {
      pipeline.push({ stage: "Correlate", ok: false, detail: "no journey to correlate — no business fact written" });
      return { outcome: "UNRESOLVED", event_ids: [], acquisition_journey_id: null, resolution: null, correlation: [] };
    }
    function applied(correlation: CorrelationHop[]): Applied {
      pipeline.push({ stage: "Append immutable event", ok: true, detail: eventIds.join(", ") });
      if (!pipeline.some((p) => p.stage === "Resolution Engine")) {
        pipeline.push({ stage: "Resolution Engine", ok: true, detail: "not required — current attribution unchanged" });
      }
      return { outcome: "APPLIED", event_ids: eventIds, acquisition_journey_id: journeyId, resolution: resolutionSummary(), correlation };
    }
  }

  return { redirect, firstLaunch, ingestEvent, repository: repo };
}

export const simulatedBackend = createSimulatedBackend();
export type SimulatedBackend = ReturnType<typeof createSimulatedBackend>;
export type { SourceSystem };
