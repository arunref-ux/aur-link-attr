/**
 * Provider boundaries.
 *
 * The UI talks ONLY to these providers. Today they are simulated; later a real
 * Aurumi Native Attribution service, a Branch adapter or another MMP can be
 * dropped in behind the same interfaces without redesigning the application.
 */

import type {
  Attribution,
  AttributionContext,
  AttributionEvent,
  AttributionLink,
  AttributionMethod,
  AttributionRulesConfig,
  AppName,
  Campaign,
  Channel,
  Click,
  DemoExperience,
  DestinationType,
  DomainDescriptor,
  Install,
  Partner,
  Plan,
  Platform,
  PriceVersion,
  ProviderDescriptor,
} from "@/domain/types";
import { lookupReferralCodeIn, type ReferralLookupResult } from "@/lib/referral-lookup";
import {
  makeUniqueToken,
  nextId,
  notifyStore,
  pushEvent,
  redirectTargetFor,
  SIMULATED_NOW,
  store,
  applyResolution,
  installSignalFor,
  partnerNameOf,
  recordOverride,
} from "@/data/store";
import { resolveAttribution as runRules } from "@/lib/attribution-rules";
import {
  appSourceFor,
  type CorrelationHop,
  type FirstLaunchRequest,
  type OverrideRequest,
  type IngestEventRequest,
  type IngestEventType,
  type IngestOutcome,
  type PipelineStep,
  type ServiceCredential,
} from "@/backend/contract";
import type { RepositoryCounts } from "@/backend/repository";
import { simulatedBackend } from "@/backend/simulated-backend";

export function bumpRulesVersion(v: string): string {
  const n = Number(v.replace("ATTR-RULES-", "")) || 1;
  return `ATTR-RULES-${n + 1}`;
}

const latency = () => new Promise<void>((r) => setTimeout(r, 40));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/* ----------------------------- PartnerProvider ---------------------------- */

export interface PartnerProvider {
  searchPartners(query?: string): Promise<Partner[]>;
  getPartner(partnerId: string): Promise<Partner | null>;
  /** Resolve a referral code to a partner reference (Partner Portal owns this relationship). */
  lookupReferralCode(code: string): Promise<ReferralLookupResult | null>;
}

export const partnerProvider: PartnerProvider = {
  async searchPartners(query) {
    await latency();
    const q = (query ?? "").trim().toLowerCase();
    return clone(
      store.partners.filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.partner_id.toLowerCase().includes(q) ||
          p.territory.toLowerCase().includes(q),
      ),
    );
  },
  async getPartner(partnerId) {
    await latency();
    return clone(store.partners.find((p) => p.partner_id === partnerId) ?? null);
  },
  async lookupReferralCode(code) {
    await latency();
    return clone(lookupReferralCodeIn(store.partners, code));
  },
};

/* ------------------------------ DemoProvider ------------------------------ */

export interface DemoProvider {
  searchExperiences(query?: string): Promise<DemoExperience[]>;
  getExperience(id: string): Promise<DemoExperience | null>;
}

export const demoProvider: DemoProvider = {
  async searchExperiences(query) {
    await latency();
    const q = (query ?? "").trim().toLowerCase();
    return clone(store.experiences.filter((e) => !q || e.name.toLowerCase().includes(q)));
  },
  async getExperience(id) {
    await latency();
    return clone(store.experiences.find((e) => e.demo_experience_id === id) ?? null);
  },
};

/* ----------------------------- PricingProvider ---------------------------- */

export interface PricingProvider {
  getPlan(planId: string): Promise<Plan | null>;
  listPlans(app?: AppName): Promise<Plan[]>;
  getPriceVersion(id: string): Promise<PriceVersion | null>;
  listPriceVersions(app?: AppName): Promise<PriceVersion[]>;
}

export const pricingProvider: PricingProvider = {
  async getPlan(planId) {
    await latency();
    return clone(store.plans.find((p) => p.plan_id === planId) ?? null);
  },
  async listPlans(app) {
    await latency();
    return clone(store.plans.filter((p) => !app || p.app === app));
  },
  async getPriceVersion(id) {
    await latency();
    return clone(store.priceVersions.find((p) => p.price_version_id === id) ?? null);
  },
  async listPriceVersions(app) {
    await latency();
    const planIds = store.plans.filter((p) => !app || p.app === app).map((p) => p.plan_id);
    return clone(store.priceVersions.filter((pv) => planIds.includes(pv.plan_id)));
  },
};

/* --------------------------- AttributionProvider -------------------------- */

export interface CreateLinkInput {
  campaign_id: string;
  partner_id: string | null;
  channel: Channel;
  app: AppName;
  destination: DestinationType;
  destination_value?: string | null | undefined;
  demo_experience_id?: string | null | undefined;
  metadata?: AttributionLink["metadata"] | undefined;
}

export interface CreateCampaignInput {
  name: string;
  description: string;
  target_app: AppName;
  default_channel: Channel;
  default_destination: DestinationType;
  associated_partner_id: string | null;
  demo_experience_id: string | null;
  status: Campaign["status"];
  start_date: string;
  tags: string[];
}

export interface LinkFilters {
  campaign_id?: string | undefined;
  partner_id?: string | undefined;
  channel?: Channel | undefined;
  app?: AppName | undefined;
  status?: "ACTIVE" | "DISABLED" | undefined;
  query?: string | undefined;
}

export interface LinkRow extends AttributionLink {
  campaign_name: string;
  clicks: number;
  conversions: number;
}

export interface ConversionFilters {
  partner_id?: string | undefined;
  campaign_id?: string | undefined;
  channel?: Channel | undefined;
  app?: AppName | undefined;
  attribution_method?: AttributionMethod | undefined;
  stage?: "SIGNED_UP" | "TENANT" | "ACTIVATED" | "PAID" | undefined;
  period_days?: number | undefined;
  query?: string | undefined;
}

export const attributionProvider = {
  /* --- campaigns --- */
  async listCampaigns(): Promise<Campaign[]> {
    await latency();
    return clone(store.campaigns);
  },
  async getCampaign(id: string): Promise<Campaign | null> {
    await latency();
    return clone(store.campaigns.find((c) => c.campaign_id === id) ?? null);
  },
  async createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    await latency();
    const now = new Date().toISOString();
    const campaign: Campaign = {
      campaign_id: nextId("CMP", 4),
      ...input,
      end_date: null,
      created_by: "you@aurumi.ai",
      created_at: now,
      updated_at: now,
    };
    store.campaigns.unshift(campaign);
    notifyStore();
    return clone(campaign);
  },

  /* --- links --- */
  async listLinks(filters: LinkFilters = {}): Promise<LinkRow[]> {
    await latency();
    const q = (filters.query ?? "").trim().toLowerCase();
    return clone(
      store.links
        .filter((l) => !filters.campaign_id || l.campaign_id === filters.campaign_id)
        .filter((l) => !filters.partner_id || l.partner_id === filters.partner_id)
        .filter((l) => !filters.channel || l.channel === filters.channel)
        .filter((l) => !filters.app || l.app === filters.app)
        .filter((l) => !filters.status || l.status === filters.status)
        .filter(
          (l) =>
            !q ||
            l.token.toLowerCase().includes(q) ||
            l.short_url.toLowerCase().includes(q) ||
            (l.partner_name_snapshot ?? "").toLowerCase().includes(q),
        )
        .map((l) => ({
          ...l,
          campaign_name: store.campaigns.find((c) => c.campaign_id === l.campaign_id)?.name ?? "—",
          clicks: store.events.filter(
            (e) => e.link_id === l.link_id && e.event_type === "LINK_CLICKED",
          ).length,
          conversions: store.attributions.filter(
            (a) => a.link_id === l.link_id && a.commercial_conversion_at,
          ).length,
        }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  },
  async getLink(linkId: string): Promise<LinkRow | null> {
    const rows = await this.listLinks();
    return rows.find((l) => l.link_id === linkId) ?? null;
  },
  async createLink(input: CreateLinkInput): Promise<AttributionLink> {
    await latency();
    const partner = store.partners.find((p) => p.partner_id === input.partner_id) ?? null;
    const token = makeUniqueToken();
    const link: AttributionLink = {
      link_id: nextId("LNK", 4),
      token,
      short_url: `go.aurumi.ai/x/${token}`,
      campaign_id: input.campaign_id,
      partner_id: input.partner_id,
      partner_name_snapshot: partner?.name ?? null,
      partner_type_snapshot: partner?.partner_type ?? null,
      channel: input.channel,
      app: input.app,
      destination: input.destination,
      destination_value: input.destination_value ?? null,
      demo_experience_id: input.demo_experience_id ?? null,
      status: "ACTIVE",
      disabled_behavior: store.rules.disabled_link_behavior,
      metadata: input.metadata ?? {},
      created_by: "you@aurumi.ai",
      created_at: new Date().toISOString(),
    };
    store.links.unshift(link);
    pushEvent({
      event_type: "LINK_CREATED",
      occurred_at: link.created_at,
      link_id: link.link_id,
      campaign_id: link.campaign_id,
      partner_id: link.partner_id ?? undefined,
      app: link.app,
      platform: "WEB",
      channel: link.channel,
      source_system: "AURUMI_NATIVE_ATTRIBUTION",
      metadata: { token: link.token, destination: link.destination, created_by: link.created_by },
    });
    notifyStore();
    return clone(link);
  },
  async setLinkStatus(
    linkId: string,
    status: "ACTIVE" | "DISABLED",
    actor = "you@aurumi.ai",
  ): Promise<void> {
    await latency();
    const link = store.links.find((l) => l.link_id === linkId);
    if (!link || link.status === status) return;
    link.status = status;
    {
      pushEvent({
        event_type: status === "DISABLED" ? "LINK_DISABLED" : "LINK_ENABLED",
        occurred_at: new Date().toISOString(),
        link_id: link.link_id,
        campaign_id: link.campaign_id,
        partner_id: link.partner_id ?? undefined,
        app: link.app,
        platform: "WEB",
        channel: link.channel,
        source_system: "AURUMI_NATIVE_ATTRIBUTION",
        metadata:
          status === "DISABLED"
            ? {
                behavior: link.disabled_behavior,
                actor,
                note: "Historical attribution remains intact",
              }
            : { actor, note: "New journeys may originate from this link again" },
      });
    }
    notifyStore();
  },
  async shareLink(linkId: string, medium: string): Promise<void> {
    await latency();
    const link = store.links.find((l) => l.link_id === linkId);
    if (!link) return;
    pushEvent({
      event_type: "LINK_SHARED",
      occurred_at: new Date().toISOString(),
      link_id: link.link_id,
      campaign_id: link.campaign_id,
      partner_id: link.partner_id ?? undefined,
      app: link.app,
      platform: "WEB",
      channel: link.channel,
      source_system: "AURUMI_NATIVE_ATTRIBUTION",
      metadata: { medium },
    });
    notifyStore();
  },

  /** Server-side token resolution. Public URLs never carry partner identity. */
  async resolveLink(token: string): Promise<AttributionContext | null> {
    await latency();
    const link = store.links.find((l) => l.token === token);
    if (!link) return null;
    return {
      token: link.token,
      link_id: link.link_id,
      partner_id: link.partner_id,
      campaign_id: link.campaign_id,
      channel: link.channel,
      app: link.app,
      destination: link.destination,
      demo_experience_id: link.demo_experience_id,
      link_status: link.status,
      available_for_acquisition: link.status === "ACTIVE",
    };
  },

  /* --- events / attributions --- */
  async listEvents(
    filter: {
      attribution_id?: string;
      link_id?: string;
      campaign_id?: string;
      limit?: number;
    } = {},
  ): Promise<AttributionEvent[]> {
    await latency();
    return clone(
      store.events
        .filter((e) => !filter.attribution_id || e.attribution_id === filter.attribution_id)
        .filter((e) => !filter.link_id || e.link_id === filter.link_id)
        .filter((e) => !filter.campaign_id || e.campaign_id === filter.campaign_id)
        .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
        .slice(0, filter.limit ?? 2000),
    );
  },
  async getAttribution(id: string): Promise<Attribution | null> {
    await latency();
    return clone(store.attributions.find((a) => a.attribution_id === id) ?? null);
  },
  async listAttributions(filters: ConversionFilters = {}): Promise<Attribution[]> {
    await latency();
    const q = (filters.query ?? "").trim().toLowerCase();
    const cutoff = filters.period_days
      ? SIMULATED_NOW.getTime() - filters.period_days * 86_400_000
      : null;
    return clone(
      store.attributions
        .filter((a) => !filters.partner_id || a.partner_id === filters.partner_id)
        .filter((a) => !filters.campaign_id || a.campaign_id === filters.campaign_id)
        .filter((a) => !filters.channel || a.channel === filters.channel)
        .filter((a) => !filters.app || a.app === filters.app)
        .filter(
          (a) => !filters.attribution_method || a.attribution_method === filters.attribution_method,
        )
        .filter((a) => {
          if (!filters.stage) return true;
          if (filters.stage === "SIGNED_UP") return !!a.signup_at;
          if (filters.stage === "TENANT") return !!a.tenant_id;
          if (filters.stage === "ACTIVATED") return !!a.activated_at;
          return !!a.first_payment;
        })
        .filter((a) => !cutoff || new Date(a.resolution_timestamp).getTime() >= cutoff)
        .filter(
          (a) =>
            !q ||
            [
              a.tenant_id,
              a.tenant_name,
              a.user_id,
              a.signup_id,
              a.click_id,
              a.install_id,
              a.contact_email,
              a.partner_name_snapshot,
              a.first_payment?.transaction_id,
              store.links.find((l) => l.link_id === a.link_id)?.token,
              store.campaigns.find((c) => c.campaign_id === a.campaign_id)?.name,
            ]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q)),
        )
        .sort((a, b) => b.resolution_timestamp.localeCompare(a.resolution_timestamp)),
    );
  },

  /** Free-text trace search across identifiers. */
  async searchTraces(query: string): Promise<Attribution[]> {
    return this.listAttributions({ query });
  },

  /**
   * POST /api/v1/attributions/{id}/override. Production: lock the journey /
   * current_attribution row, compare expected_current_resolution_id, then write.
   */
  async overrideAttribution(input: OverrideRequest): Promise<Attribution | null> {
    await latency();
    const attribution = store.attributions.find((a) => a.attribution_id === input.attribution_id);
    const target = store.partners.find((p) => p.partner_id === input.to_partner_id);
    if (!attribution || !target) return null;
    // lock (serialized per journey) → inspect current resolution → compare
    if ((attribution.current_resolution_id ?? null) !== input.expected_current_resolution_id) {
      throw new StaleAttributionStateError(attribution.current_resolution_id ?? null);
    }
    recordOverride(attribution, target, input.reason, input.actor, new Date().toISOString());
    notifyStore();
    return clone(attribution);
  },

  /** Exposed so the Configuration screen can explain the live rule engine. */
  async previewResolution(
    clicks: Click[],
    deterministic: boolean,
  ): Promise<ReturnType<typeof runRules>> {
    await latency();
    const now = new Date().toISOString();
    return runRules({
      acquisitionFacts: clicks,
      installSignal: { platform: "ANDROID", occurred_at: now, referrer_recovered: deterministic },
      referenceTime: now,
      rules: store.rules,
      partnerName: partnerNameOf,
    });
  },

  /* --- configuration --- */
  async getRules(): Promise<AttributionRulesConfig> {
    await latency();
    return clone(store.rules);
  },
  async updateRules(patch: Partial<AttributionRulesConfig>): Promise<AttributionRulesConfig> {
    await latency();
    const changed = (Object.keys(patch) as (keyof AttributionRulesConfig)[]).some(
      (k) => patch[k] !== undefined && patch[k] !== store.rules[k],
    );
    Object.assign(store.rules, patch);
    // A behavioural change creates a new rules version; history keeps its old version.
    if (changed) store.rulesVersion = bumpRulesVersion(store.rulesVersion);
    notifyStore();
    return clone(store.rules);
  },
  async listProviders(): Promise<ProviderDescriptor[]> {
    await latency();
    return clone(store.providers);
  },
  async listDomains(): Promise<DomainDescriptor[]> {
    await latency();
    return clone(store.domains);
  },

  /* --- analytics --- */
  async getOverview(periodDays: number): Promise<OverviewMetrics> {
    await latency();
    return computeOverview(periodDays);
  },
  async getCampaignPerformance(campaignId: string): Promise<CampaignPerformance> {
    await latency();
    const attributions = store.attributions.filter((a) => a.campaign_id === campaignId);
    const clicks = store.events.filter(
      (e) => e.campaign_id === campaignId && e.event_type === "LINK_CLICKED",
    ).length;
    return {
      clicks,
      installs: attributions.filter((a) => a.install_id).length,
      signups: attributions.filter((a) => a.signup_at).length,
      tenants: attributions.filter((a) => a.tenant_id).length,
      activated: attributions.filter((a) => a.activated_at).length,
      paid: attributions.filter((a) => a.first_payment).length,
      funnel: funnelFor(attributions, clicks),
    };
  },
};

/* ------------------------------- analytics ------------------------------- */

export interface FunnelStageRow {
  stage: string;
  count: number;
  from_previous: number;
  from_click: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  clicks: number;
  installs: number;
  signups: number;
  tenants: number;
  paid: number;
  attribution_rate: number;
}

export interface OverviewMetrics {
  clicks: number;
  installs: number;
  signups: number;
  activated: number;
  paid: number;
  attribution_rate: number;
  funnel: FunnelStageRow[];
  byChannel: BreakdownRow[];
  byPartner: BreakdownRow[];
  byApp: BreakdownRow[];
  byCampaign: BreakdownRow[];
  byMethod: { key: AttributionMethod; count: number }[];
}

/** First opens come only from normalized FIRST_OPEN events, deduplicated per journey. */
function firstOpenCount(attributions: Attribution[]): number {
  const ids = new Set(attributions.map((a) => a.attribution_id));
  const opened = new Set(
    store.events
      .filter((e) => e.event_type === "FIRST_OPEN" && e.attribution_id && ids.has(e.attribution_id))
      .map((e) => e.attribution_id),
  );
  return opened.size;
}

function funnelFor(attributions: Attribution[], clicks: number): FunnelStageRow[] {
  const counts = [
    ["Clicks", clicks],
    ["Installs", attributions.filter((a) => a.install_id).length],
    ["First Opens", firstOpenCount(attributions)],
    ["Signups", attributions.filter((a) => a.signup_at).length],
    ["Tenants", attributions.filter((a) => a.tenant_id).length],
    ["Activated", attributions.filter((a) => a.activated_at).length],
    ["Paid", attributions.filter((a) => a.first_payment).length],
  ] as [string, number][];

  return counts.map(([stage, count], i) => {
    const prev = i === 0 ? count : counts[i - 1]![1];
    return {
      stage,
      count,
      from_previous: prev > 0 ? count / prev : 0,
      from_click: counts[0]![1] > 0 ? count / counts[0]![1] : 0,
    };
  });
}

function group(
  attributions: Attribution[],
  clickEvents: AttributionEvent[],
  keyOf: (a: Attribution) => string | null,
  keyOfEvent: (e: AttributionEvent) => string | null,
  labelOf: (key: string) => string,
): BreakdownRow[] {
  const keys = new Set<string>();
  attributions.forEach((a) => {
    const k = keyOf(a);
    if (k) keys.add(k);
  });
  clickEvents.forEach((e) => {
    const k = keyOfEvent(e);
    if (k) keys.add(k);
  });
  return [...keys]
    .map((key) => {
      const rows = attributions.filter((a) => keyOf(a) === key);
      const clicks = clickEvents.filter((e) => keyOfEvent(e) === key).length;
      const attributed = rows.filter((a) => a.attribution_method !== "UNATTRIBUTED").length;
      return {
        key,
        label: labelOf(key),
        clicks,
        installs: rows.filter((a) => a.install_id).length,
        signups: rows.filter((a) => a.signup_at).length,
        tenants: rows.filter((a) => a.tenant_id).length,
        paid: rows.filter((a) => a.first_payment).length,
        attribution_rate: rows.length > 0 ? attributed / rows.length : 0,
      };
    })
    .sort((a, b) => b.clicks - a.clicks);
}

function computeOverview(periodDays: number): OverviewMetrics {
  const cutoff = SIMULATED_NOW.getTime() - periodDays * 86_400_000;
  const inPeriod = (isoString: string) => new Date(isoString).getTime() >= cutoff;

  const attributions = store.attributions.filter((a) => inPeriod(a.resolution_timestamp));
  const clickEvents = store.events.filter(
    (e) => e.event_type === "LINK_CLICKED" && inPeriod(e.occurred_at),
  );
  const clicks = clickEvents.length;
  const attributed = attributions.filter((a) => a.attribution_method !== "UNATTRIBUTED").length;

  const methods: AttributionMethod[] = ["DETERMINISTIC", "CLAIMED", "MATCHED", "UNATTRIBUTED"];

  return {
    clicks,
    installs: attributions.filter((a) => a.install_id).length,
    signups: attributions.filter((a) => a.signup_at).length,
    activated: attributions.filter((a) => a.activated_at).length,
    paid: attributions.filter((a) => a.first_payment).length,
    attribution_rate: attributions.length > 0 ? attributed / attributions.length : 0,
    funnel: funnelFor(attributions, clicks),
    byChannel: group(
      attributions,
      clickEvents,
      (a) => a.channel,
      (e) => e.channel ?? null,
      (k) => k,
    ),
    byPartner: group(
      attributions,
      clickEvents,
      (a) => a.partner_id,
      (e) => e.partner_id ?? null,
      (k) => store.partners.find((p) => p.partner_id === k)?.name ?? k,
    ),
    byApp: group(
      attributions,
      clickEvents,
      (a) => a.app,
      (e) => e.app,
      (k) => k,
    ),
    byCampaign: group(
      attributions,
      clickEvents,
      (a) => a.campaign_id,
      (e) => e.campaign_id ?? null,
      (k) => store.campaigns.find((c) => c.campaign_id === k)?.name ?? k,
    ),
    byMethod: methods.map((m) => ({
      key: m,
      count: attributions.filter((a) => a.attribution_method === m).length,
    })),
  };
}

export interface CampaignPerformance {
  clicks: number;
  installs: number;
  signups: number;
  tenants: number;
  activated: number;
  paid: number;
  funnel: FunnelStageRow[];
}

