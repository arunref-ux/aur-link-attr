/**
 * Production-contract scenarios. Each runs against the simulated backend
 * inside a snapshot that is rolled back afterwards, so running them never
 * changes the dataset shown on other screens.
 */

import type { FirstLaunchRequest } from "@/backend/contract";
import { simulatedBackend } from "@/backend/simulated-backend";
import { store } from "@/data/store";
import { attributionProvider, simulationProvider, type SimulationState } from "@/providers";

export interface ScenarioResult {
  id: string;
  title: string;
  expected: string;
  observed: string;
  pass: boolean;
}

export const SCENARIOS = [
  { id: "clean-start", title: "Redirect creates Journey + Session + Click" },
  { id: "direct-first-launch", title: "Direct first launch (no aur_at)" },
  { id: "duplicate", title: "Same key, same payload" },
  { id: "idempotency-conflict", title: "Same key, changed payload" },
  { id: "concurrent-first-launch", title: "Concurrent identical first launch" },
  { id: "same-installation", title: "Different source events, same installation" },
  { id: "signup-binding", title: "Signup via binding token" },
  { id: "invalid-binding", title: "Invalid signup binding token" },
  { id: "reused-binding", title: "Reused binding for unrelated signup" },
  { id: "signup-retry", title: "Exact retry of same signup" },
  { id: "tenant-correlation", title: "Tenant via trusted signup/user" },
  { id: "stale-override", title: "Override against stale resolution" },
  { id: "unknown-link", title: "Unknown link token" },
  { id: "disabled-link", title: "Disabled link" },
  { id: "campaign-inactive", title: "Inactive campaign" },
  { id: "unknown-acq-token", title: "Unknown acquisition token" },
  { id: "expired-window", title: "Expired attribution window" },
  { id: "fail-before-commit", title: "Fail before commit" },
  { id: "server-authority", title: "Client-supplied partner ID" },
  { id: "unauthorized-source", title: "Unauthorized source" },
  { id: "partner-unavailable", title: "Partner unavailable" },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]["id"];

const title = (id: ScenarioId) => SCENARIOS.find((s) => s.id === id)!.title;
const ACTIVE_LINK = "LNK-0001"; // Sri Sai Tally Solutions · WhatsApp · Aura

const journeyOf = (s: SimulationState) =>
  store.attributions.find((x) => x.attribution_id === s.acquisition_journey_id)!;
const lastBody = <T>(s: SimulationState) => s.technical.at(-1)!.response as T;
const lastStatus = (s: SimulationState) => s.technical.at(-1)!.status;

async function clicked(linkId = ACTIVE_LINK): Promise<SimulationState> {
  const s = await simulationProvider.start(linkId, "ANDROID");
  return simulationProvider.step(s, "CLICK");
}
async function launched(): Promise<SimulationState> {
  return simulationProvider.step(await clicked(), "FIRST_LAUNCH");
}
function directLaunch(installation_id: string, source_event_id: string): FirstLaunchRequest {
  return {
    source_system: "AURA_ANDROID",
    source_event_id,
    installation_id,
    app: "AURA",
    platform: "ANDROID",
    app_version: "1.4.0",
    occurred_at: new Date().toISOString(),
  };
}

async function run(id: ScenarioId): Promise<Omit<ScenarioResult, "id" | "title">> {
  const repo = simulatedBackend.repository;
  switch (id) {
    case "clean-start": {
      const before = repo.counts();
      const s = await simulationProvider.start(ACTIVE_LINK, "ANDROID");
      const untouched = JSON.stringify(repo.counts()) === JSON.stringify(before);
      const c = await simulationProvider.step(s, "CLICK");
      const after = repo.counts();
      const a = journeyOf(c);
      return {
        expected: "nothing exists before redirect; redirect creates AJ + AS + CLK + aur_at, no resolution",
        observed: `before: ${untouched ? "no rows" : "ROWS"}; journeys +${after.acquisition_journeys - before.acquisition_journeys}, sessions +${after.acquisition_sessions - before.acquisition_sessions}, clicks +${after.clicks - before.clicks}, resolutions +${after.resolutions - before.resolutions}; ${a.attribution_id}`,
        pass:
          untouched &&
          after.acquisition_journeys === before.acquisition_journeys + 1 &&
          after.acquisition_sessions === before.acquisition_sessions + 1 &&
          after.clicks === before.clicks + 1 &&
          after.resolutions === before.resolutions,
      };
    }
    case "direct-first-launch": {
      const before = repo.counts();
      const out = simulatedBackend.firstLaunch(directLaunch("INS-DIRECT-1", "fl-direct-1"), {
        source_system: "AURA_ANDROID",
      });
      const body = out.http.body;
      const j = body.success ? repo.findJourney(body.acquisition_journey_id) : null;
      const events = store.events.filter((e) => e.install_id === "INS-DIRECT-1").map((e) => e.event_type);
      return {
        expected: "DIRECT_FIRST_LAUNCH journey; INSTALL_SIGNAL + FIRST_OPEN; UNATTRIBUTED; no link/click",
        observed: `${j?.origin_type}; ${events.join(" + ")}; ${body.success ? body.attribution.method : "error"}; clicks +${repo.counts().clicks - before.clicks}`,
        pass:
          j?.origin_type === "DIRECT_FIRST_LAUNCH" &&
          events.includes("FIRST_OPEN") &&
          events.includes("INSTALL_UNATTRIBUTED") &&
          body.success &&
          body.attribution.method === "UNATTRIBUTED" &&
          repo.counts().clicks === before.clicks,
      };
    }
    case "duplicate": {
      const s = await launched();
      const before = repo.counts();
      const r = await simulationProvider.retryLast(s);
      const body = lastBody<{ success: boolean; duplicate: boolean }>(r);
      const same = JSON.stringify(before) === JSON.stringify(repo.counts());
      return {
        expected: "200, duplicate = true; no journey, install, FIRST_OPEN, resolution or metric added",
        observed: `${lastStatus(r)} duplicate = ${body.duplicate}; tables ${same ? "unchanged" : "CHANGED"}`,
        pass: body.duplicate === true && same,
      };
    }
    case "idempotency-conflict": {
      const s = await launched();
      const before = repo.counts();
      const r = await simulationProvider.retryLast(s, { app_version: "9.9.9" });
      const body = lastBody<{ success: boolean; error?: { code: string } }>(r);
      const same = JSON.stringify(before) === JSON.stringify(repo.counts());
      return {
        expected: "409 IDEMPOTENCY_KEY_REUSED; no business mutation",
        observed: `${lastStatus(r)} ${body.error?.code}; tables ${same ? "unchanged" : "CHANGED"}`,
        pass: lastStatus(r) === 409 && body.error?.code === "IDEMPOTENCY_KEY_REUSED" && same,
      };
    }
    case "concurrent-first-launch": {
      const c = await clicked();
      const token = c.technical[0]!.correlation.find((h) => h.label === "aur_at")!.value;
      const req: FirstLaunchRequest = {
        ...directLaunch("INS-RACE-1", "fl-race-1"),
        acquisition_token: token,
      };
      const cred = { source_system: "AURA_ANDROID" };
      let twin = 0;
      // Request A holds the idempotency claim; identical request B arrives before A commits.
      const a = simulatedBackend.firstLaunch(req, cred, {
        beforeCommit: () => {
          twin = simulatedBackend.firstLaunch(req, cred).http.status;
        },
      });
      const later = simulatedBackend.firstLaunch(req, cred);
      const installs = store.installs.filter((i) => i.install_id === "INS-RACE-1").length;
      const opens = store.events.filter((e) => e.event_type === "FIRST_OPEN" && e.install_id === "INS-RACE-1").length;
      const res = store.resolutions.filter((r) => r.acquisition_journey_id === c.acquisition_journey_id).length;
      return {
        expected: "twin during claim → 409 IN_PROGRESS; later retry replays; one install, one FIRST_OPEN, one resolution",
        observed: `A ${a.http.status}; in-flight twin ${twin}; later duplicate = ${later.http.body.success ? later.http.body.duplicate : "error"}; installs ${installs}, first opens ${opens}, resolutions ${res}`,
        pass:
          a.http.status === 200 &&
          twin === 409 &&
          later.http.body.success === true &&
          later.http.body.duplicate === true &&
          installs === 1 &&
          opens === 1 &&
          res === 1,
      };
    }
    case "same-installation": {
      const s = await launched();
      const first = s.last_request!;
      if (first.kind !== "FIRST_LAUNCH") throw new Error("unexpected");
      const before = repo.counts();
      const out = simulatedBackend.firstLaunch(
        { ...first.request, source_event_id: "fl-other-source-event" },
        first.credential,
      );
      const after = repo.counts();
      const body = out.http.body;
      return {
        expected: "BUSINESS_DUPLICATE on same journey; no new install, events or resolution",
        observed: `${body.success ? body.outcome : "error"} → ${body.success ? body.acquisition_journey_id : ""}; installs +${after.installs - before.installs}, events +${after.events - before.events}`,
        pass:
          body.success &&
          body.outcome === "BUSINESS_DUPLICATE" &&
          body.acquisition_journey_id === s.acquisition_journey_id &&
          after.installs === before.installs &&
          after.events === before.events &&
          after.resolutions === before.resolutions,
      };
    }
    case "signup-binding": {
      let s = await launched();
      s = await simulationProvider.step(s, "SIGNUP_STARTED");
      const a = journeyOf(s);
      const j = repo.findJourney(s.acquisition_journey_id!)!;
      return {
        expected: "signup/user attached to the journey that owns the binding",
        observed: `${lastStatus(s)} · ${j.acquisition_journey_id} signup ${j.signup_id} user ${j.user_id}`,
        pass: lastStatus(s) === 200 && !!j.signup_id && a.signup_id === j.signup_id,
      };
    }
    case "invalid-binding": {
      let s = await launched();
      const before = repo.counts();
      s = await simulationProvider.step(s, "SIGNUP_STARTED", { signup_binding_token: "sbt_forged" });
      const body = lastBody<{ error?: { code: string } }>(s);
      return {
        expected: "422 SIGNUP_BINDING_INVALID; no journey association",
        observed: `${lastStatus(s)} ${body.error?.code}; journey signup ${repo.findJourney(s.acquisition_journey_id!)?.signup_id ?? "none"}`,
        pass:
          body.error?.code === "SIGNUP_BINDING_INVALID" &&
          !repo.findJourney(s.acquisition_journey_id!)?.signup_id &&
          JSON.stringify(before) === JSON.stringify(repo.counts()),
      };
    }
    case "reused-binding": {
      let s = await launched();
      s = await simulationProvider.step(s, "SIGNUP_STARTED");
      const r = await simulationProvider.retryLast(s, {
        source_event_id: "sgn-unrelated",
        signup_id: "SGN-UNRELATED",
        user_id: "U-UNRELATED",
      });
      const body = lastBody<{ error?: { code: string } }>(r);
      return {
        expected: "409 SIGNUP_BINDING_CONSUMED; unrelated signup not attached",
        observed: `${lastStatus(r)} ${body.error?.code}; journey signup ${repo.findJourney(s.acquisition_journey_id!)?.signup_id}`,
        pass:
          lastStatus(r) === 409 &&
          body.error?.code === "SIGNUP_BINDING_CONSUMED" &&
          repo.findJourney(s.acquisition_journey_id!)?.signup_id !== "SGN-UNRELATED",
      };
    }
    case "signup-retry": {
      let s = await launched();
      s = await simulationProvider.step(s, "SIGNUP_COMPLETED");
      const before = repo.counts();
      const r = await simulationProvider.retryLast(s);
      const body = lastBody<{ data?: { duplicate: boolean } }>(r);
      return {
        expected: "200 duplicate = true; nothing written",
        observed: `${lastStatus(r)} duplicate = ${body.data?.duplicate}`,
        pass: body.data?.duplicate === true && JSON.stringify(before) === JSON.stringify(repo.counts()),
      };
    }
    case "tenant-correlation": {
      let s = await launched();
      s = await simulationProvider.step(s, "SIGNUP_COMPLETED");
      s = await simulationProvider.step(s, "TENANT_CREATED");
      const req = s.last_request!.request as { acquisition_journey_id?: string; acquisition_session_id?: string };
      const j = repo.findJourney(s.acquisition_journey_id!)!;
      return {
        expected: "tenant attached via signup/user identity; request carries no journey/session ID",
        observed: `${j.acquisition_journey_id} tenant ${j.tenant_id}; request journey/session IDs: ${req.acquisition_journey_id ?? req.acquisition_session_id ?? "none"}`,
        pass: !!j.tenant_id && !req.acquisition_journey_id && !req.acquisition_session_id,
      };
    }
    case "stale-override": {
      const s = await launched();
      const a = journeyOf(s);
      const stale = a.current_resolution_id ?? null;
      await attributionProvider.overrideAttribution({
        attribution_id: a.attribution_id,
        to_partner_id: "P-118",
        reason: "first admin",
        actor: "admin-1",
        expected_current_resolution_id: stale,
      });
      let code = "none";
      try {
        await attributionProvider.overrideAttribution({
          attribution_id: a.attribution_id,
          to_partner_id: "P-145",
          reason: "second admin, stale view",
          actor: "admin-2",
          expected_current_resolution_id: stale,
        });
      } catch (err) {
        code = (err as { code?: string }).code ?? "error";
      }
      return {
        expected: "409 STALE_ATTRIBUTION_STATE; first override stands",
        observed: `${code}; current partner ${journeyOf(s).partner_id}`,
        pass: code === "STALE_ATTRIBUTION_STATE" && journeyOf(s).partner_id === "P-118",
      };
    }
    case "unknown-link": {
      const before = repo.counts();
      const out = simulatedBackend.redirect({ token: "ZZZZZZZ", platform: "ANDROID" });
      return {
        expected: "404 INVALID_TOKEN, safe fallback, nothing persisted",
        observed: `${out.http.status} ${out.error?.code} → ${out.location}; journeys +${repo.counts().acquisition_journeys - before.acquisition_journeys}`,
        pass: out.http.status === 404 && JSON.stringify(repo.counts()) === JSON.stringify(before),
      };
    }
    case "disabled-link": {
      const link = store.links.find((l) => l.status === "DISABLED")!;
      const before = repo.counts();
      const out = simulatedBackend.redirect({ token: link.token, platform: "ANDROID" });
      return {
        expected: "LINK_DISABLED; no journey, click or session",
        observed: `${out.error?.code}; rows ${JSON.stringify(repo.counts()) === JSON.stringify(before) ? "unchanged" : "CHANGED"}`,
        pass: out.error?.code === "LINK_DISABLED" && JSON.stringify(repo.counts()) === JSON.stringify(before),
      };
    }
    case "campaign-inactive": {
      const campaign = store.campaigns.find((c) => c.status === "PAUSED")!;
      const link = store.links.find((l) => l.campaign_id === campaign.campaign_id && l.status === "ACTIVE");
      if (!link) return { expected: "CAMPAIGN_INACTIVE", observed: "no active link on a paused campaign", pass: false };
      const before = repo.counts();
      const out = simulatedBackend.redirect({ token: link.token, platform: "ANDROID" });
      return {
        expected: "CAMPAIGN_INACTIVE (evaluated at request time); no journey or session",
        observed: `${out.error?.code}; sessions +${repo.counts().acquisition_sessions - before.acquisition_sessions}`,
        pass: out.error?.code === "CAMPAIGN_INACTIVE" && JSON.stringify(repo.counts()) === JSON.stringify(before),
      };
    }
    case "unknown-acq-token": {
      const c = await clicked();
      const s = await simulationProvider.step(c, "FIRST_LAUNCH", { acquisition_token: "not-a-real-token" });
      const body = lastBody<{ acquisition_journey_id: string; attribution: { method: string }; warnings: { code: string }[] }>(s);
      const j = repo.findJourney(body.acquisition_journey_id)!;
      const linkJourney = journeyOf(c);
      return {
        expected: "new direct journey, token status UNKNOWN, UNATTRIBUTED; link journey untouched",
        observed: `${j.origin_type} · ${j.acquisition_token_status} · ${body.attribution.method}; warning ${body.warnings[0]?.code}; link journey install ${linkJourney.install_id ?? "none"}`,
        pass:
          j.acquisition_token_status === "UNKNOWN" &&
          body.attribution.method === "UNATTRIBUTED" &&
          j.acquisition_journey_id !== c.acquisition_journey_id &&
          linkJourney.install_id === null,
      };
    }
    case "expired-window": {
      const later = new Date(Date.now() + (store.rules.click_attribution_window_days + 1) * 86_400_000).toISOString();
      const s = await simulationProvider.step(await clicked(), "FIRST_LAUNCH", { occurred_at: later });
      const a = journeyOf(s);
      return {
        expected: "UNATTRIBUTED — click outside the configured window",
        observed: `${a.attribution_method} · ${a.resolution_reason}`,
        pass: a.attribution_method === "UNATTRIBUTED" && a.partner_id === null,
      };
    }
    case "fail-before-commit": {
      let s = await clicked();
      const snap = JSON.stringify(repo.counts());
      const attrBefore = JSON.stringify(journeyOf(s));
      s = await simulationProvider.step(s, "FIRST_LAUNCH", { failBeforeCommit: true });
      const same = JSON.stringify(repo.counts()) === snap && JSON.stringify(journeyOf(s)) === attrBefore;
      const retry = await simulationProvider.retryLast(s);
      const retryBody = lastBody<{ duplicate?: boolean }>(retry);
      return {
        expected: "500 + ROLLBACK (incl. idempotency claim); retry of same event then succeeds",
        observed: `${s.technical.at(-1)!.status}; state ${same ? "unchanged" : "PARTIAL"}; retry duplicate = ${retryBody.duplicate}`,
        pass: same && retryBody.duplicate === false,
      };
    }
    case "server-authority": {
      const s = await simulationProvider.step(await clicked(), "FIRST_LAUNCH", {
        untrusted: { partner_id: "P-118", attribution_method: "CLAIMED", link_id: "LNK-9999", acquisition_journey_id: "AJ-FAKE" },
      });
      const a = journeyOf(s);
      const body = lastBody<{ ignored_fields: string[] }>(s);
      return {
        expected: "client partner / journey IDs ignored; server-resolved partner from token wins",
        observed: `ignored ${body.ignored_fields.join(", ")}; partner ${a.partner_id} (${a.attribution_method})`,
        pass: a.partner_id === "P-104" && a.attribution_method === "DETERMINISTIC",
      };
    }
    case "unauthorized-source": {
      const before = repo.counts();
      const out = simulatedBackend.ingestEvent(
        {
          source_system: "AURA_ANDROID",
          source_event_id: "evt-x",
          event_type: "FIRST_PAYMENT",
          occurred_at: new Date().toISOString(),
          app: "AURA",
          platform: "ANDROID",
          tenant_id: "T-1",
          transaction_id: "TX-1",
          amount: 1,
          currency: "INR",
        },
        { source_system: "AURA_ANDROID" },
      );
      const err = out.http.body.success ? null : out.http.body.error.code;
      return {
        expected: "UNAUTHORIZED_SOURCE — Android app cannot report payments",
        observed: `${out.http.status} ${err}; events +${repo.counts().events - before.events}`,
        pass: err === "UNAUTHORIZED_SOURCE" && repo.counts().events === before.events,
      };
    }
    case "partner-unavailable": {
      const c = await clicked();
      const idx = store.partners.findIndex((p) => p.partner_id === "P-104");
      const [removed] = store.partners.splice(idx, 1);
      const s = await simulationProvider.step(c, "FIRST_LAUNCH");
      store.partners.splice(idx, 0, removed!);
      const a = journeyOf(s);
      return {
        expected: "stays P-104, name from link snapshot; never reassigned",
        observed: `${a.partner_id} · ${a.partner_name_snapshot ?? "no name"}`,
        pass: a.partner_id === "P-104" && !!a.partner_name_snapshot,
      };
    }
  }
}

export async function runScenario(id: ScenarioId): Promise<ScenarioResult> {
  const repo = simulatedBackend.repository;
  const snap = repo.snapshot();
  try {
    return { id, title: title(id), ...(await run(id)) };
  } catch (err) {
    return { id, title: title(id), expected: "—", observed: err instanceof Error ? err.message : "failed", pass: false };
  } finally {
    repo.restore(snap);
  }
}

export async function runAllScenarios(): Promise<ScenarioResult[]> {
  const out: ScenarioResult[] = [];
  for (const s of SCENARIOS) out.push(await runScenario(s.id));
  return out;
}
