import { describe, expect, it } from "vitest";

import { simulatedBackend } from "@/backend/simulated-backend";
import { runScenario, type ScenarioId } from "@/client/contract-scenarios";
import { store } from "@/data/store";
import { simulationProvider } from "@/providers";

const repo = simulatedBackend.repository;

async function scenario(id: ScenarioId) {
  const before = repo.counts();
  const r = await runScenario(id);
  expect(r.pass, `${r.title}: ${r.observed}`).toBe(true);
  expect(repo.counts()).toEqual(before); // scenarios roll back
}

describe("V1.2 — AcquisitionJourney lifecycle", () => {
  it("redirect creates Journey + Session + Click without a pre-existing attribution subject", () =>
    scenario("clean-start"));

  it("direct first launch: no aur_at → journey → INSTALL_SIGNAL + FIRST_OPEN → UNATTRIBUTED", () =>
    scenario("direct-first-launch"));

  it("attributed first launch: valid aur_at locates the existing journey → DETERMINISTIC", async () => {
    let s = await simulationProvider.start("LNK-0001", "ANDROID");
    s = await simulationProvider.step(s, "CLICK");
    const journeyId = s.acquisition_journey_id!;
    const journeysBefore = store.acquisitionJourneys.length;
    s = await simulationProvider.step(s, "FIRST_LAUNCH");
    expect(s.acquisition_journey_id).toBe(journeyId);
    expect(store.acquisitionJourneys.length).toBe(journeysBefore);
    const j = repo.findJourney(journeyId)!;
    expect(j.install_id).not.toBeNull();
    expect(j.acquisition_token_status).toBe("VALID");
    const a = store.attributions.find((x) => x.attribution_id === journeyId)!;
    expect(a.attribution_method).toBe("DETERMINISTIC");
    expect(a.partner_id).toBe("P-104");
    expect(store.resolutions.filter((r) => r.acquisition_journey_id === journeyId)).toHaveLength(1);
  });
});

describe("V1.2 — Idempotency", () => {
  it("exact retry → duplicate success", () => scenario("duplicate"));
  it("same key + different payload → 409 IDEMPOTENCY_KEY_REUSED, no mutation", () =>
    scenario("idempotency-conflict"));
  it("concurrent identical first launch → one canonical result", () =>
    scenario("concurrent-first-launch"));
  it("different source events + same installation → one canonical installation", () =>
    scenario("same-installation"));
});

describe("V1.2 — Signup / tenant binding", () => {
  it("valid binding token attaches signup to the correct journey", () => scenario("signup-binding"));
  it("invalid binding token → no arbitrary journey association", () =>
    scenario("invalid-binding"));
  it("reused binding cannot attach an unrelated second signup", () => scenario("reused-binding"));
  it("exact retry of same signup is idempotent", () => scenario("signup-retry"));
  it("tenant resolves through trusted signup/user association", () =>
    scenario("tenant-correlation"));

  it("referral code at signup → Partner Portal lookup → configured precedence applies", async () => {
    let s = await simulationProvider.start("LNK-0001", "ANDROID");
    for (const step of ["CLICK", "FIRST_LAUNCH", "SIGNUP_STARTED"] as const)
      s = await simulationProvider.step(s, step);
    s = await simulationProvider.step(s, "SIGNUP_COMPLETED", { referral_code: "SRISAI104" });
    const j = repo.findJourney(s.acquisition_journey_id!)!;
    expect(j.claims[0]?.partner_id).toBe("P-104");
    const a = store.attributions.find((x) => x.attribution_id === j.acquisition_journey_id)!;
    // Default rules: deterministic precedence over claimed.
    expect(a.attribution_method).toBe(
      store.rules.deterministic_precedence_over_claimed ? "DETERMINISTIC" : "CLAIMED",
    );
  });
});

describe("V1.2 — Concurrency", () => {
  it("override against stale resolution → 409 STALE_ATTRIBUTION_STATE", () =>
    scenario("stale-override"));
});

describe("V1.2 — Legacy seeds preserved", () => {
  it("seeded journeys are marked legacy and keep their signed-off outcomes", () => {
    const kranthi = store.attributions.find((a) => a.tenant_name === "Kranthi Traders")!;
    const sunrise = store.attributions.find((a) => a.tenant_name === "Sunrise Pharma Retail")!;
    expect(kranthi.acquisition_journey_id ?? null).toBeNull();
    expect(kranthi.partner_id).toBe("P-145");
    expect(sunrise.attribution_method).toBe("MATCHED");
  });
});
