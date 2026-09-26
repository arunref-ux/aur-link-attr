/**
 * Attribution resolution engine — the ONE authoritative path for attribution
 * decisions. Seeds, the interactive simulator and previews only supply facts
 * (clicks, install signals, claims); this module decides the outcome from the
 * configured rules and explains why.
 */

import type {
  AttributionMethod,
  AttributionRulesConfig,
  AttributionStatus,
  Click,
  Platform,
} from "@/domain/types";

/** Install-time signal reported by the platform (a fact, not a decision). */
export interface InstallSignal {
  platform: Platform;
  occurred_at: string;
  /** True when the platform returned the originating click token (Play Install Referrer, preserved web token). */
  referrer_recovered: boolean;
}

/** A user-supplied referral claim (e.g. referral code entered at signup). */
export interface AttributionClaim {
  partner_id: string;
  code: string;
  occurred_at: string;
}

export interface ResolutionInput {
  acquisitionFacts: Click[];
  installSignal?: InstallSignal | null | undefined;
  claims?: AttributionClaim[] | undefined;
  referenceTime: string;
  rules: AttributionRulesConfig;
  /** Optional lookup so reasons can name the partner. */
  partnerName?: ((partnerId: string) => string | null | undefined) | undefined;
}

export interface ResolutionOutput {
  status: AttributionStatus;
  partner_id: string | null;
  campaign_id: string | null;
  link_id: string | null;
  click_id: string | null;
  attribution_method: AttributionMethod;
  attribution_source: string;
  resolution_reason: string;
  resolved_at: string;
  eligible_click_count: number;
}

export function resolveAttribution(input: ResolutionInput): ResolutionOutput {
  const { rules } = input;
  const windowMs = rules.click_attribution_window_days * 86_400_000;
  const ref = new Date(input.referenceTime).getTime();
  const name = (id: string | null) =>
    (id && input.partnerName?.(id)) || (id ? `partner ${id}` : "no partner");

  const eligible = input.acquisitionFacts
    .filter((c) => {
      const age = ref - new Date(c.occurred_at).getTime();
      return age >= 0 && age <= windowMs;
    })
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

  const partnerClicks = eligible.filter((c) => c.partner_id);
  const claim = (input.claims ?? [])
    .filter((c) => new Date(c.occurred_at).getTime() <= ref)
    .at(-1);
  const deterministicSignal = !!input.installSignal?.referrer_recovered && eligible.length > 0;

  const base = { resolved_at: input.referenceTime, eligible_click_count: eligible.length };

  const fromClaim = (): ResolutionOutput => ({
    ...base,
    status: "ATTRIBUTED",
    partner_id: claim!.partner_id,
    campaign_id: null,
    link_id: null,
    click_id: null,
    attribution_method: "CLAIMED",
    attribution_source: "REFERRAL_CODE_CLAIM",
    resolution_reason: `Partner attribution was established from a referral claim (${claim!.code}) supplied during signup, attributed to ${name(claim!.partner_id)}.`,
  });

  // Claims win only when configuration says deterministic does not take precedence.
  if (claim && !rules.deterministic_precedence_over_claimed) return fromClaim();

  if (deterministicSignal) {
    const pool = partnerClicks.length > 0 ? partnerClicks : eligible;
    const last = rules.conflict_rule === "LAST_ELIGIBLE_DETERMINISTIC";
    const chosen = last ? pool[pool.length - 1]! : pool[0]!;
    const distinctPartners = new Set(partnerClicks.map((c) => c.partner_id)).size;
    const source =
      input.installSignal!.platform === "ANDROID"
        ? "PLAY_INSTALL_REFERRER"
        : "PRESERVED_ATTRIBUTION_TOKEN";
    const who = chosen.partner_id
      ? `Attributed to ${name(chosen.partner_id)}`
      : "Attributed to an owned channel (no partner)";
    const reason =
      distinctPartners > 1
        ? `${who} because this was the ${last ? "most recent" : "first"} of ${distinctPartners} eligible deterministic partner acquisitions before installation (rule: ${labelForRule(rules.conflict_rule)}).`
        : `${who} because this was the only eligible deterministic acquisition within the ${rules.click_attribution_window_days}-day attribution window before installation.`;
    return {
      ...base,
      status: "ATTRIBUTED",
      partner_id: chosen.partner_id,
      campaign_id: chosen.campaign_id,
      link_id: chosen.link_id,
      click_id: chosen.click_id,
      attribution_method: "DETERMINISTIC",
      attribution_source: source,
      resolution_reason: reason,
    };
  }

  if (claim) return fromClaim();

  if (eligible.length > 0 && input.installSignal) {
    const chosen = (partnerClicks.length > 0 ? partnerClicks : eligible).at(-1)!;
    return {
      ...base,
      status: "ATTRIBUTED",
      partner_id: chosen.partner_id,
      campaign_id: chosen.campaign_id,
      link_id: chosen.link_id,
      click_id: chosen.click_id,
      attribution_method: "MATCHED",
      attribution_source: "PROVIDER_DEPENDENT",
      resolution_reason: `No deterministic install signal was recovered; matched to ${chosen.partner_id ? name(chosen.partner_id) : "an owned channel"} from allowed matching signals within the ${rules.click_attribution_window_days}-day window (provider-dependent).`,
    };
  }

  if (eligible.length > 0) {
    // Clicks recorded, no install yet — provisional, not a final outcome.
    const chosen = eligible.at(-1)!;
    return {
      ...base,
      status: "PENDING",
      partner_id: null,
      campaign_id: chosen.campaign_id,
      link_id: chosen.link_id,
      click_id: chosen.click_id,
      attribution_method: "UNATTRIBUTED",
      attribution_source: "NONE",
      resolution_reason: "Acquisition click recorded; awaiting an install signal before attribution can be resolved.",
    };
  }

  return {
    ...base,
    status: "UNATTRIBUTED",
    partner_id: null,
    campaign_id: null,
    link_id: null,
    click_id: null,
    attribution_method: "UNATTRIBUTED",
    attribution_source: "NONE",
    resolution_reason:
      input.acquisitionFacts.length > 0
        ? "No eligible acquisition source was found within the configured attribution window."
        : "No eligible acquisition source was found — this journey began without an attribution link.",
  };
}

export function labelForRule(rule: AttributionRulesConfig["conflict_rule"]): string {
  return rule === "LAST_ELIGIBLE_DETERMINISTIC"
    ? "last eligible deterministic acquisition"
    : "first eligible deterministic acquisition";
}
