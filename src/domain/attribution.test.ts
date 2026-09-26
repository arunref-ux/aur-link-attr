import { describe, expect, it } from "vitest";

import { store } from "@/data/store";
import type { AttributionRulesConfig, Click } from "@/domain/types";
import { resolveAttribution } from "@/lib/attribution-rules";
import { lookupReferralCodeIn, normalizeClaim } from "@/lib/referral-lookup";
import { attributionProvider, partnerProvider, simulationProvider } from "@/providers";

const RULES: AttributionRulesConfig = {
  click_attribution_window_days: 30,
  install_to_signup_window_days: 30,
  conflict_rule: "LAST_ELIGIBLE_DETERMINISTIC",
  deterministic_precedence_over_claimed: true,
  duplicate_conversion_handling: "ONE_PER_TENANT",
  unattributed_behavior: "RECORD_UNATTRIBUTED",
  disabled_link_behavior: "REJECT",
};
const REF = "2026-09-20T10:00:00.000Z";
const minutesBefore = (m: number) => new Date(new Date(REF).getTime() - m * 60_000).toISOString();

function click(id: string, partner: string | null, at: string): Click {
  return {
    click_id: id,
    session_id: "S-1",
    link_id: `L-${id}`,
    token: "TOKEN",
    campaign_id: "C-1",
    partner_id: partner,
    channel: "WHATSAPP",
    app: "AURA",
    platform: "ANDROID",
    user_agent: "test",
    occurred_at: at,
    redirect_target: "play",
  };
}
const androidInstall = { platform: "ANDROID" as const, occurred_at: REF, referrer_recovered: true };

describe("Resolution Engine", () => {
  it("A — single deterministic click attributes to that partner", () => {
    const r = resolveAttribution({
      acquisitionFacts: [click("c1", "P-A", minutesBefore(10))],
      installSignal: androidInstall,
      referenceTime: REF,
      rules: RULES,
    });
    expect(r.partner_id).toBe("P-A");
    expect(r.attribution_method).toBe("DETERMINISTIC");
  });

  it("B — competing clicks follow the configured rule and chronology", () => {
    const aThenB = [click("a", "P-A", minutesBefore(60)), click("b", "P-B", minutesBefore(10))];
    const bThenA = [click("b", "P-B", minutesBefore(60)), click("a", "P-A", minutesBefore(10))];
    const run = (facts: Click[], rules = RULES) =>
      resolveAttribution({
        acquisitionFacts: facts,
        installSignal: androidInstall,
        referenceTime: REF,
        rules,
      });
    expect(run(aThenB).partner_id).toBe("P-B");
    expect(run(bThenA).partner_id).toBe("P-A");
    expect(
      run(aThenB, { ...RULES, conflict_rule: "FIRST_ELIGIBLE_DETERMINISTIC" }).partner_id,
    ).toBe("P-A");
  });

  it("C — attribution window", () => {
    const inside = resolveAttribution({
      acquisitionFacts: [click("c", "P-A", minutesBefore(60 * 24 * 5))],
      installSignal: androidInstall,
      referenceTime: REF,
      rules: RULES,
    });
    const outside = resolveAttribution({
      acquisitionFacts: [click("c", "P-A", minutesBefore(60 * 24 * 45))],
      installSignal: androidInstall,
      referenceTime: REF,
      rules: RULES,
    });
    expect(inside.status).toBe("ATTRIBUTED");
    expect(outside.status).toBe("UNATTRIBUTED");
  });

  it("D — genuine unattributed journey has null source fields", () => {
    const r = resolveAttribution({
      acquisitionFacts: [],
      installSignal: { platform: "WEB", occurred_at: REF, referrer_recovered: false },
      referenceTime: REF,
      rules: RULES,
    });
    expect(r.status).toBe("UNATTRIBUTED");
    expect([r.partner_id, r.campaign_id, r.link_id, r.click_id]).toEqual([null, null, null, null]);
    const lotus = store.attributions.find((a) => a.tenant_name === "Lotus Interiors")!;
    expect(lotus.status).toBe("UNATTRIBUTED");
    expect([lotus.partner_id, lotus.campaign_id, lotus.link_id, lotus.click_id]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("E — referral code resolves through the partner lookup to a CLAIMED result", async () => {
    const input = { referral_code: "SRISAI104" }; // no partner ID supplied
    const lookup = await partnerProvider.lookupReferralCode(input.referral_code);
    expect(lookup?.partner_id).toBe("P-104");
    const claim = normalizeClaim(lookupReferralCodeIn(store.partners, input.referral_code), REF)!;
    const r = resolveAttribution({
      acquisitionFacts: [],
      claims: [claim],
      referenceTime: REF,
      rules: RULES,
    });
    expect(r.attribution_method).toBe("CLAIMED");
    expect(r.partner_id).toBe("P-104");
    const geeta = store.attributions.find((a) => a.tenant_name === "Geeta Steel Works")!;
    expect(geeta.attribution_method).toBe("CLAIMED");
    expect(geeta.partner_id).toBe("P-104");
  });
});

describe("Simulator behaviour", () => {
  it("F — disabled links cannot originate journeys; history stays; re-enable works", async () => {
    const link = await attributionProvider.createLink({
      campaign_id: "CMP-2031",
      partner_id: "P-104",
      channel: "WHATSAPP",
      app: "AURA",
      destination: "SIGNUP",
    });
    const first = await simulationProvider.start(link.link_id, "ANDROID");
    await simulationProvider.step(first, "CLICK");
    await simulationProvider.step(first, "FIRST_LAUNCH");
    const before = store.attributions.find((a) => a.attribution_id === first.acquisition_journey_id!)!;
    expect(before.partner_id).toBe("P-104");

    await attributionProvider.setLinkStatus(link.link_id, "DISABLED");
    expect((await attributionProvider.resolveLink(link.token))?.available_for_acquisition).toBe(
      false,
    );
    const clicksBefore = store.clicks.filter((c) => c.link_id === link.link_id).length;
    await expect(simulationProvider.start(link.link_id, "ANDROID")).rejects.toThrow();
    expect(store.clicks.filter((c) => c.link_id === link.link_id).length).toBe(clicksBefore);
    expect(before.partner_id).toBe("P-104");

    await attributionProvider.setLinkStatus(link.link_id, "ACTIVE");
    expect(
      store.events.some((e) => e.event_type === "LINK_ENABLED" && e.link_id === link.link_id),
    ).toBe(true);
    expect(
      store.events.some((e) => e.event_type === "LINK_DISABLED" && e.link_id === link.link_id),
    ).toBe(true);
    const again = await simulationProvider.start(link.link_id, "ANDROID");
    await simulationProvider.step(again, "CLICK");
    expect(store.clicks.filter((c) => c.link_id === link.link_id).length).toBe(clicksBefore + 1);
  });

  it("G — override records A → B while the original click stays A", async () => {
    const s = await simulationProvider.start("LNK-0001", "ANDROID");
    await simulationProvider.step(s, "CLICK");
    await simulationProvider.step(s, "FIRST_LAUNCH");
    const a = store.attributions.find((x) => x.attribution_id === s.acquisition_journey_id!)!;
    const originalClick = { ...store.clicks.find((c) => c.click_id === a.click_id)! };
    expect(a.partner_id).toBe("P-104");
    await attributionProvider.overrideAttribution({
      attribution_id: a.attribution_id,
      to_partner_id: "P-118",
      reason: "test",
      actor: "tester",
      expected_current_resolution_id: a.current_resolution_id ?? null,
    });
    expect(store.clicks.find((c) => c.click_id === originalClick.click_id)).toEqual(originalClick);
    expect(a.overrides.at(-1)).toMatchObject({ from_partner_id: "P-104", to_partner_id: "P-118" });
    expect(a.partner_id).toBe("P-118");
    expect(a.status).toBe("OVERRIDDEN");
  });

  it("H/I/J — repeated install, tenant and first payment stay singular", async () => {
    let s = await simulationProvider.start("LNK-0002", "ANDROID");
    for (const step of [
      "CLICK",
      "FIRST_LAUNCH",
      "FIRST_LAUNCH",
      "SIGNUP_STARTED",
      "SIGNUP_COMPLETED",
      "TENANT_CREATED",
      "TENANT_CREATED",
      "TENANT_ACTIVATED",
      "SUBSCRIPTION_STARTED",
      "FIRST_PAYMENT",
      "FIRST_PAYMENT",
    ] as const) {
      s = await simulationProvider.step(s, step);
    }
    const a = store.attributions.find((x) => x.attribution_id === s.acquisition_journey_id!)!;
    const events = store.events.filter((e) => e.attribution_id === a.attribution_id);
    expect(store.installs.filter((i) => i.session_id === a.session_id)).toHaveLength(1);
    expect(events.filter((e) => e.event_type === "TENANT_CREATED")).toHaveLength(1);
    expect(events.filter((e) => e.event_type === "FIRST_PAYMENT")).toHaveLength(1);
  });

  it("K — First Opens derive only from FIRST_OPEN events", async () => {
    const firstOpens = async () =>
      (await attributionProvider.getOverview(3650)).funnel.find((f) => f.stage === "First Opens")!
        .count;
    const start = await firstOpens();
    let s = await simulationProvider.start("LNK-0003", "ANDROID");
    for (const step of ["CLICK", "FIRST_LAUNCH"] as const)
      s = await simulationProvider.step(s, step);
    expect(await firstOpens()).toBe(start + 1);
    let t = await simulationProvider.start("LNK-0003", "ANDROID");
    for (const step of [
      "CLICK",
      "FIRST_LAUNCH",
      "SIGNUP_STARTED",
      "SIGNUP_COMPLETED",
      "TENANT_CREATED",
    ] as const) {
      t = await simulationProvider.step(t, step);
    }
    // One first launch = one FIRST_OPEN; signup/tenant never add first opens.
    expect(await firstOpens()).toBe(start + 2);
  });

  it("IDs and tokens never collide with seeded data", async () => {
    const link = await attributionProvider.createLink({
      campaign_id: "CMP-2044",
      partner_id: null,
      channel: "QR",
      app: "SHOPTALK",
      destination: "SIGNUP",
    });
    const linkIds = store.links.map((l) => l.link_id);
    const tokens = store.links.map((l) => l.token);
    expect(new Set(linkIds).size).toBe(linkIds.length);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(link.link_id).not.toBe("LNK-0001");
    for (const ids of [
      store.events.map((e) => e.event_id),
      store.clicks.map((c) => c.click_id),
      store.attributions.map((a) => a.attribution_id),
      store.attributions.map((a) => a.tenant_id).filter(Boolean),
      store.attributions.map((a) => a.first_payment?.transaction_id).filter(Boolean),
    ]) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("Regression journeys", () => {
  const find = (name: string) => store.attributions.find((a) => a.tenant_name === name)!;
  it("Kranthi Traders → Vizag Accounting Technologies", () => {
    expect(find("Kranthi Traders").partner_id).toBe("P-145");
  });
  it("Sunrise Pharma → MATCHED", () => {
    expect(find("Sunrise Pharma Retail").attribution_method).toBe("MATCHED");
  });
  it("Flagship Aura journey uses an Aura price version", () => {
    const flagship = find("ABC Manufacturing Pvt Ltd");
    const plan = store.plans.find((p) => p.plan_id === flagship.subscription?.plan_id);
    expect(plan?.app).toBe("AURA");
  });
});
