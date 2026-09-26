/**
 * Production-contract failure scenarios. Each runs against the simulated
 * backend inside a snapshot that is rolled back afterwards, so running them
 * never changes the dataset shown on other screens.
 */

import { simulatedBackend } from "@/backend/simulated-backend";
import { store } from "@/data/store";
import { simulationProvider, type SimulationState } from "@/providers";

export interface ScenarioResult {
  id: string;
  title: string;
  expected: string;
  observed: string;
  pass: boolean;
}

export const SCENARIOS = [
  { id: "duplicate", title: "Duplicate event retry" },
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

async function clicked(linkId = ACTIVE_LINK): Promise<SimulationState> {
  const s = await simulationProvider.start(linkId, "ANDROID");
  return simulationProvider.step(s, "CLICK");
}

async function run(id: ScenarioId): Promise<Omit<ScenarioResult, "id" | "title">> {
  const repo = simulatedBackend.repository;
  switch (id) {
    case "duplicate": {
      let s = await clicked();
      s = await simulationProvider.step(s, "INSTALL");
      const before = repo.counts();
      s = await simulationProvider.retryLast(s);
      const after = repo.counts();
      const body = s.technical.at(-1)!.response as { success: boolean; data?: { duplicate: boolean } };
      const same = JSON.stringify(before) === JSON.stringify(after);
      return {
        expected: "accepted = true, duplicate = true; no new event, resolution or metric",
        observed: `duplicate = ${body.data?.duplicate}; tables ${same ? "unchanged" : "CHANGED"}`,
        pass: !!body.data?.duplicate && same,
      };
    }
    case "unknown-link": {
      const before = repo.counts();
      const out = simulatedBackend.redirect({ token: "ZZZZZZZ", platform: "ANDROID", device_session_id: "SES-SCENARIO" });
      return {
        expected: "404 INVALID_TOKEN, safe fallback, nothing persisted",
        observed: `${out.http.status} ${out.error?.code} → ${out.location}; clicks +${repo.counts().clicks - before.clicks}`,
        pass: out.http.status === 404 && repo.counts().clicks === before.clicks,
      };
    }
    case "disabled-link": {
      const link = store.links.find((l) => l.status === "DISABLED")!;
      const before = repo.counts();
      const out = simulatedBackend.redirect({ token: link.token, platform: "ANDROID", device_session_id: "SES-SCENARIO" });
      const after = repo.counts();
      return {
        expected: "LINK_DISABLED; no click, no acquisition session",
        observed: `${out.error?.code}; clicks +${after.clicks - before.clicks}, sessions +${after.acquisition_sessions - before.acquisition_sessions}`,
        pass: out.error?.code === "LINK_DISABLED" && after.clicks === before.clicks && after.acquisition_sessions === before.acquisition_sessions,
      };
    }
    case "campaign-inactive": {
      const campaign = store.campaigns.find((c) => c.status === "PAUSED")!;
      const link = store.links.find((l) => l.campaign_id === campaign.campaign_id && l.status === "ACTIVE");
      if (!link) return { expected: "CAMPAIGN_INACTIVE", observed: "no active link on a paused campaign", pass: false };
      const before = repo.counts();
      const out = simulatedBackend.redirect({ token: link.token, platform: "ANDROID", device_session_id: "SES-SCENARIO" });
      return {
        expected: "CAMPAIGN_INACTIVE; no eligible acquisition session",
        observed: `${out.error?.code}; sessions +${repo.counts().acquisition_sessions - before.acquisition_sessions}`,
        pass: out.error?.code === "CAMPAIGN_INACTIVE" && repo.counts().acquisition_sessions === before.acquisition_sessions,
      };
    }
    case "unknown-acq-token": {
      let s = await clicked();
      s = await simulationProvider.step(s, "INSTALL", { acquisition_token: "not-a-real-token" });
      const a = store.attributions.find((x) => x.attribution_id === s.attribution_id)!;
      const body = s.technical.at(-1)!.response as { data?: { outcome: string; warnings: { code: string }[] } };
      return {
        expected: "install stored, UNATTRIBUTED / unresolved — no invented partner",
        observed: `outcome ${body.data?.outcome}; warning ${body.data?.warnings[0]?.code}; journey partner ${a.partner_id ?? "none"}`,
        pass: body.data?.outcome === "UNRESOLVED" && a.partner_id === null,
      };
    }
    case "expired-window": {
      let s = await clicked();
      const later = new Date(Date.now() + (store.rules.click_attribution_window_days + 1) * 86_400_000).toISOString();
      s = await simulationProvider.step(s, "INSTALL", { occurred_at: later });
      const a = store.attributions.find((x) => x.attribution_id === s.attribution_id)!;
      return {
        expected: "UNATTRIBUTED — click outside the configured window",
        observed: `${a.attribution_method} · ${a.resolution_reason}`,
        pass: a.attribution_method === "UNATTRIBUTED" && a.partner_id === null,
      };
    }
    case "fail-before-commit": {
      let s = await clicked();
      const snap = JSON.stringify(repo.counts());
      const attrBefore = JSON.stringify(store.attributions.find((x) => x.attribution_id === s.attribution_id));
      s = await simulationProvider.step(s, "INSTALL", { failBeforeCommit: true });
      const same =
        JSON.stringify(repo.counts()) === snap &&
        JSON.stringify(store.attributions.find((x) => x.attribution_id === s.attribution_id)) === attrBefore;
      const retry = await simulationProvider.retryLast(s);
      const retryBody = retry.technical.at(-1)!.response as { data?: { duplicate: boolean } };
      return {
        expected: "500 + ROLLBACK, no partial state; retry of same event then succeeds",
        observed: `${s.technical.at(-1)!.status}; state ${same ? "unchanged" : "PARTIAL"}; retry duplicate = ${retryBody.data?.duplicate}`,
        pass: same && retryBody.data?.duplicate === false,
      };
    }
    case "server-authority": {
      let s = await clicked();
      s = await simulationProvider.step(s, "INSTALL", {
        untrusted: { partner_id: "P-118", attribution_method: "CLAIMED", link_id: "LNK-9999" },
      });
      const a = store.attributions.find((x) => x.attribution_id === s.attribution_id)!;
      const body = s.technical.at(-1)!.response as { data?: { ignored_fields: string[] } };
      return {
        expected: "client partner_id ignored; server-resolved partner from token wins",
        observed: `ignored ${body.data?.ignored_fields.join(", ")}; partner ${a.partner_id} (${a.attribution_method})`,
        pass: a.partner_id === "P-104" && a.attribution_method === "DETERMINISTIC",
      };
    }
    case "unauthorized-source": {
      const s = await clicked();
      const before = repo.counts();
      const out = simulatedBackend.ingestEvent(
        { source_system: "AURA_ANDROID", source_event_id: "evt-x", event_type: "FIRST_PAYMENT", occurred_at: new Date().toISOString(), app: "AURA", platform: "ANDROID", tenant_id: "T-1", transaction_id: "TX-1", amount: 1, currency: "INR" },
        { source_system: "AURA_ANDROID" },
      );
      void s;
      const err = out.http.body.success ? null : out.http.body.error.code;
      return {
        expected: "UNAUTHORIZED_SOURCE — Android app cannot report payments",
        observed: `${out.http.status} ${err}; events +${repo.counts().events - before.events}`,
        pass: err === "UNAUTHORIZED_SOURCE" && repo.counts().events === before.events,
      };
    }
    case "partner-unavailable": {
      let s = await clicked();
      const idx = store.partners.findIndex((p) => p.partner_id === "P-104");
      const [removed] = store.partners.splice(idx, 1);
      s = await simulationProvider.step(s, "INSTALL");
      store.partners.splice(idx, 0, removed!);
      const a = store.attributions.find((x) => x.attribution_id === s.attribution_id)!;
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
