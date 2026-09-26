/**
 * Simulated Partner Portal referral lookup.
 *
 * Partner Portal owns partner identity and referral relationships. This is the
 * simulated implementation behind `PartnerProvider.lookupReferralCode`; the
 * Resolution Engine only ever receives the normalized claim it produces.
 */

import type { Partner } from "@/domain/types";
import type { AttributionClaim } from "@/lib/attribution-rules";

export interface ReferralLookupResult {
  partner_id: string;
  partner_name: string;
  code: string;
  source_system: "PARTNER_PORTAL";
}

export function lookupReferralCodeIn(
  partners: Partner[],
  code: string,
): ReferralLookupResult | null {
  const normalized = code.trim().toUpperCase();
  const partner = partners.find(
    (p) => p.status === "ACTIVE" && p.referral_code.toUpperCase() === normalized,
  );
  if (!partner) return null;
  return {
    partner_id: partner.partner_id,
    partner_name: partner.name,
    code: normalized,
    source_system: "PARTNER_PORTAL",
  };
}

/** Referral code (fact) + lookup result → normalized claim for the engine. */
export function normalizeClaim(
  lookup: ReferralLookupResult | null,
  occurred_at: string,
): AttributionClaim | null {
  if (!lookup) return null;
  return { partner_id: lookup.partner_id, code: lookup.code, occurred_at };
}
