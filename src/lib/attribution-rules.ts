/**
 * Attribution rule engine. Rules are configuration-driven, never hard-coded in UI.
 */

import type { AttributionMethod, AttributionRulesConfig, Click } from "@/domain/types";

export interface ResolutionInput {
  clicks: Click[];
  reference_time: string;
  claimed_partner_id?: string | null;
  deterministic_signal_available: boolean;
}

export interface ResolutionOutput {
  partner_id: string | null;
  campaign_id: string | null;
  click_id: string | null;
  attribution_method: AttributionMethod;
  attribution_source: string;
  resolution_reason: string;
  resolution_timestamp: string;
}

export function resolveAttribution(
  input: ResolutionInput,
  rules: AttributionRulesConfig,
): ResolutionOutput {
  const windowMs = rules.click_attribution_window_days * 86_400_000;
  const ref = new Date(input.reference_time).getTime();

  const eligible = input.clicks
    .filter((c) => ref - new Date(c.occurred_at).getTime() <= windowMs)
    .filter((c) => ref - new Date(c.occurred_at).getTime() >= 0)
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

  const withPartner = eligible.filter((c) => c.partner_id);

  if (input.deterministic_signal_available && withPartner.length > 0) {
    const chosen =
      rules.conflict_rule === "LAST_ELIGIBLE_DETERMINISTIC"
        ? withPartner[withPartner.length - 1]!
        : withPartner[0]!;
    return {
      partner_id: chosen.partner_id,
      campaign_id: chosen.campaign_id,
      click_id: chosen.click_id,
      attribution_method: "DETERMINISTIC",
      attribution_source:
        chosen.platform === "ANDROID" ? "PLAY_INSTALL_REFERRER" : "PRESERVED_ATTRIBUTION_TOKEN",
      resolution_reason:
        withPartner.length > 1
          ? `${withPartner.length} eligible partner clicks — resolved by ${labelForRule(rules.conflict_rule)}`
          : `Single eligible deterministic acquisition within ${rules.click_attribution_window_days}-day window`,
      resolution_timestamp: input.reference_time,
    };
  }

  if (input.claimed_partner_id) {
    return {
      partner_id: input.claimed_partner_id,
      campaign_id: eligible[eligible.length - 1]?.campaign_id ?? null,
      click_id: eligible[eligible.length - 1]?.click_id ?? null,
      attribution_method: "CLAIMED",
      attribution_source: "REFERRAL_CODE_CLAIM",
      resolution_reason: rules.deterministic_precedence_over_claimed
        ? "No deterministic signal; user-supplied referral accepted"
        : "Claimed referral accepted by configuration",
      resolution_timestamp: input.reference_time,
    };
  }

  if (withPartner.length > 0) {
    const chosen = withPartner[withPartner.length - 1]!;
    return {
      partner_id: chosen.partner_id,
      campaign_id: chosen.campaign_id,
      click_id: chosen.click_id,
      attribution_method: "MATCHED",
      attribution_source: "ALLOWED_MATCHING_SIGNALS",
      resolution_reason: "Resolved from allowed matching signals within the attribution window",
      resolution_timestamp: input.reference_time,
    };
  }

  return {
    partner_id: null,
    campaign_id: null,
    click_id: null,
    attribution_method: "UNATTRIBUTED",
    attribution_source: "NONE",
    resolution_reason: "No reliable acquisition source available",
    resolution_timestamp: input.reference_time,
  };
}

export function labelForRule(rule: AttributionRulesConfig["conflict_rule"]): string {
  return rule === "LAST_ELIGIBLE_DETERMINISTIC"
    ? "last eligible deterministic acquisition"
    : "first eligible deterministic acquisition";
}
