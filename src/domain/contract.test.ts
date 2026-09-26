import { describe, expect, it } from "vitest";

import { simulatedBackend } from "@/backend/simulated-backend";
import { runAllScenarios } from "@/client/contract-scenarios";
import { store } from "@/data/store";
import { attributionProvider, simulationProvider } from "@/providers";

const repo = simulatedBackend.repository;

describe("Redirect contract", () => {
  it("active seeded link always produces a session", () => {
    const link = store.links.find((l) => l.link_id === "LNK-0001")!;
    const before = repo.counts();
    const out = simulatedBackend.redirect({
      token: link.token,
      platform: "ANDROID",
      device_session_id: "SES-T2",
    });
    expect(out.error).toBeNull();
    expect(repo.counts().acquisition_sessions).toBe(before.acquisition_sessions + 1);
    expect(out.referrer).not.toContain("P-104");
  });

  it("disabled token → no click, no session", () => {
    const link = store.links.find((l) => l.status === "DISABLED")!;
    const before = repo.counts();
    const out = simulatedBackend.redirect({
      token: link.token,
      platform: "ANDROID",
      device_session_id: "SES-T3",
    });
    expect(out.error?.code).toBe("LINK_DISABLED");
    expect(repo.counts().clicks).toBe(before.clicks);
    expect(repo.counts().acquisition_sessions).toBe(before.acquisition_sessions);
  });

  it("unknown token → safe 404 failure", () => {
    const out = simulatedBackend.redirect({
      token: "NOPE000",
      platform: "ANDROID",
      device_session_id: "SES-T4",
    });
    expect(out.http.status).toBe(404);
    expect(out.error?.code).toBe("INVALID_TOKEN");
    expect(out.location).toBe("https://aurumi.ai");
  });
});

describe("Ingestion contract", () => {
  it("same source_system + source_event_id twice → one event, duplicate = true", async () => {
    let s = await simulationProvider.start("LNK-0001", "ANDROID");
    s = await simulationProvider.step(s, "CLICK");
    s = await simulationProvider.step(s, "INSTALL");
    const before = repo.counts();
    s = await simulationProvider.retryLast(s);
    expect(repo.counts()).toEqual(before);
    const body = s.technical.at(-1)!.response as { success: boolean; data: { duplicate: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.duplicate).toBe(true);
    const req = s.last_request!.request;
    expect(
      store.events.filter(
        (e) => e.source_system === req.source_system && e.source_event_id === req.source_event_id,
      ),
    ).toHaveLength(1);
  });

  it("valid acquisition token resolves the correct session; unknown token does not fabricate attribution", async () => {
    let s = await simulationProvider.start("LNK-0001", "ANDROID");
    s = await simulationProvider.step(s, "CLICK");
    const session = store.acquisitionSessions.find((x) => x.click_id === s.click!.click_id)!;
    s = await simulationProvider.step(s, "INSTALL");
    const a = store.attributions.find((x) => x.attribution_id === s.attribution_id)!;
    expect(a.click_id).toBe(session.click_id);
    expect(a.attribution_method).toBe("DETERMINISTIC");

    let u = await simulationProvider.start("LNK-0001", "ANDROID");
    u = await simulationProvider.step(u, "CLICK");
    u = await simulationProvider.step(u, "INSTALL", { acquisition_token: "unknown-token" });
    const ua = store.attributions.find((x) => x.attribution_id === u.attribution_id)!;
    expect(ua.partner_id).toBeNull();
    expect(ua.install_id).toBeNull();
  });

  it("failure before commit leaves no partial state", async () => {
    let s = await simulationProvider.start("LNK-0001", "ANDROID");
    s = await simulationProvider.step(s, "CLICK");
    const counts = repo.counts();
    const attr = JSON.stringify(
      store.attributions.find((x) => x.attribution_id === s.attribution_id),
    );
    s = await simulationProvider.step(s, "INSTALL", { failBeforeCommit: true });
    expect(s.technical.at(-1)!.status).toBe(500);
    expect(repo.counts()).toEqual(counts);
    expect(
      JSON.stringify(store.attributions.find((x) => x.attribution_id === s.attribution_id)),
    ).toBe(attr);
    expect(s.completed).not.toContain("INSTALL");
  });

  it("client-supplied partner_id never overrides the server-resolved partner", async () => {
    let s = await simulationProvider.start("LNK-0001", "ANDROID");
    s = await simulationProvider.step(s, "CLICK");
    s = await simulationProvider.step(s, "INSTALL", { untrusted: { partner_id: "P-118" } });
    const a = store.attributions.find((x) => x.attribution_id === s.attribution_id)!;
    expect(a.partner_id).toBe("P-104");
    const body = s.technical.at(-1)!.response as { data: { ignored_fields: string[] } };
    expect(body.data.ignored_fields).toContain("partner_id");
  });
});

describe("Rules versioning", () => {
  it("existing resolutions keep their version; new ones use the new version", async () => {
    const seeded = store.attributions.find((a) => a.tenant_name === "Kranthi Traders")!;
    const oldVersion = seeded.rules_version;
    expect(oldVersion).toBe("ATTR-RULES-1");
    const current = store.rules.click_attribution_window_days;
    await attributionProvider.updateRules({ click_attribution_window_days: current + 1 });
    expect(store.rulesVersion).not.toBe(oldVersion);
    let s = await simulationProvider.start("LNK-0001", "ANDROID");
    s = await simulationProvider.step(s, "CLICK");
    s = await simulationProvider.step(s, "INSTALL");
    const fresh = store.attributions.find((a) => a.attribution_id === s.attribution_id)!;
    expect(fresh.rules_version).toBe(store.rulesVersion);
    expect(seeded.rules_version).toBe(oldVersion);
    expect(seeded.partner_id).toBe("P-145");
    await attributionProvider.updateRules({ click_attribution_window_days: current });
  });
});

describe("Contract scenarios", () => {
  it("every production-contract scenario passes and leaves no state behind", async () => {
    const before = repo.counts();
    const results = await runAllScenarios();
    for (const r of results) expect(r.pass, `${r.title}: ${r.observed}`).toBe(true);
    expect(repo.counts()).toEqual(before);
  });
});

describe("Regression — Lotus & Geeta", () => {
  it("Lotus Interiors stays unattributed; Geeta Steel Works stays CLAIMED", () => {
    const lotus = store.attributions.find((a) => a.tenant_name === "Lotus Interiors")!;
    const geeta = store.attributions.find((a) => a.tenant_name === "Geeta Steel Works")!;
    expect(lotus.partner_id).toBeNull();
    expect(lotus.attribution_method).toBe("UNATTRIBUTED");
    expect(geeta.attribution_method).toBe("CLAIMED");
    expect(geeta.partner_id).toBe("P-104");
  });
});
