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

  async overrideAttribution(input: {
    attribution_id: string;
    to_partner_id: string;
    reason: string;
    actor: string;
  }): Promise<Attribution | null> {
    await latency();
    const attribution = store.attributions.find((a) => a.attribution_id === input.attribution_id);
    const target = store.partners.find((p) => p.partner_id === input.to_partner_id);
    if (!attribution || !target) return null;
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

/* ---------------------- Journey simulation (Test Journey) ---------------------- */

export type SimulationStep =
  | "CLICK"
  | "INSTALL"
  | "FIRST_OPEN"
  | "SIGNUP_STARTED"
  | "SIGNUP_COMPLETED"
  | "TENANT_CREATED"
  | "TENANT_ACTIVATED"
  | "SUBSCRIPTION_STARTED"
  | "FIRST_PAYMENT";

/** One entry in the Technical Journey: what crossed a production boundary. */
export interface TechnicalEntry {
  id: string;
  step: SimulationStep | "RETRY";
  title: string;
  actor: string;
  request_line: string;
  payload: unknown;
  pipeline: PipelineStep[];
  status: number;
  response: unknown;
  correlation: CorrelationHop[];
  counts_before: RepositoryCounts;
  counts_after: RepositoryCounts;
  committed: boolean;
}

export interface SimulationState {
  attribution_id: string;
  link_id: string;
  token: string;
  platform: Platform;
  completed: SimulationStep[];
  click?: Click;
  install?: Install;
  redirect_target?: string;
  technical: TechnicalEntry[];
  /** Last ingested event request (for "Retry Last Event"). */
  last_request?: { request: IngestEventRequest; credential: ServiceCredential; step: SimulationStep };
}

export class LinkUnavailableError extends Error {
  constructor(public link_id: string) {
    super("This link is disabled and cannot start a new journey.");
    this.name = "LinkUnavailableError";
  }
}

/**
 * Simulated devices/services. Each holds only what the real client would hold:
 * the phone keeps the Install Referrer (aur_at) Google Play handed it, the
 * signup service knows its user/signup IDs, billing knows its transactions.
 */
interface DeviceMemory {
  acquisition_token?: string | undefined;
  acquisition_session_id?: string | undefined;
  install_id?: string | undefined;
  user_id?: string | undefined;
  signup_id?: string | undefined;
  tenant_id?: string | undefined;
  subscription_id?: string | undefined;
  price_version_id?: string | undefined;
  amount?: number | undefined;
}
const devices = new Map<string, DeviceMemory>();
const sourceEventId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

export interface StepOptions {
  failBeforeCommit?: boolean | undefined;
  /** Contract testing: override the source-reported event time. */
  occurred_at?: string | undefined;
  /** Contract testing: add untrusted client-supplied fields. */
  untrusted?: Partial<IngestEventRequest> | undefined;
  /** Contract testing: replace the device's acquisition token. */
  acquisition_token?: string | undefined;
}

export const simulationProvider = {
  async start(linkId: string, platform: Platform): Promise<SimulationState> {
    await latency();
    const link = store.links.find((l) => l.link_id === linkId);
    if (!link) throw new Error("Unknown link");
    if (link.status !== "ACTIVE") {
      throw new LinkUnavailableError(link.link_id);
    }
    const attribution: Attribution = {
      attribution_id: nextId("ATR", 5),
      partner_id: null,
      partner_name_snapshot: null,
      partner_type_snapshot: null,
      campaign_id: null,
      link_id: null,
      click_id: null,
      install_id: null,
      session_id: nextId("SES", 5),
      user_id: null,
      signup_id: null,
      tenant_id: null,
      tenant_name: null,
      contact_email: null,
      channel: null,
      app: link.app,
      platform,
      attribution_method: "UNATTRIBUTED",
      attribution_source: "NONE",
      resolution_reason: "Simulation started — no acquisition facts recorded yet",
      resolution_timestamp: new Date().toISOString(),
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
    store.attributions.push(attribution);
    devices.set(attribution.attribution_id, {});
    notifyStore();
    return {
      attribution_id: attribution.attribution_id,
      link_id: link.link_id,
      token: link.token,
      platform,
      completed: [],
      technical: [],
    };
  },

  async step(
    state: SimulationState,
    step: SimulationStep,
    options: StepOptions = {},
  ): Promise<SimulationState> {
    await latency();
    const attribution = store.attributions.find((a) => a.attribution_id === state.attribution_id)!;
    const link = store.links.find((l) => l.link_id === state.link_id)!;
    const device = devices.get(state.attribution_id) ?? {};
    devices.set(state.attribution_id, device);
    const repo = simulatedBackend.repository;
    const next: SimulationState = { ...state, technical: [...(state.technical ?? [])] };
    const before = repo.counts();

    if (step === "CLICK") {
      if (link.status !== "ACTIVE") throw new LinkUnavailableError(link.link_id);
      const out = simulatedBackend.redirect({
        token: link.token,
        platform: state.platform,
        device_session_id: attribution.session_id,
      });
      if (out.error?.code === "LINK_DISABLED") throw new LinkUnavailableError(link.link_id);
      next.technical.push({
        id: nextId("TXN", 5),
        step,
        title: "Redirect Service",
        actor: "Customer's browser",
        request_line: `GET go.aurumi.ai/x/${link.token}`,
        payload: null,
        pipeline: out.pipeline,
        status: out.http.status,
        response: out.error
          ? { success: false, error: out.error, location: out.location }
          : { status: "302 REDIRECT", location: out.location, referrer: out.referrer },
        correlation: out.click_id
          ? [
              { label: "Click", value: out.click_id },
              { label: "Acquisition session", value: out.acquisition_session_id ?? "—" },
              { label: "Acquisition token", value: out.acquisition_token ?? "—" },
            ]
          : [],
        counts_before: before,
        counts_after: repo.counts(),
        committed: !out.error,
      });
      if (out.error) {
        notifyStore();
        throw new Error(out.error.message);
      }
      // Google Play holds the referrer for the device until first launch.
      device.acquisition_token = out.acquisition_token ?? undefined;
      device.acquisition_session_id = out.acquisition_session_id ?? undefined;
      next.click = clone(store.clicks.find((c) => c.click_id === out.click_id)!);
      next.redirect_target = next.click.redirect_target;
      next.completed = next.completed.includes(step) ? next.completed : [...next.completed, step];
      notifyStore();
      return next;
    }

    const built = buildRequest(step, state, attribution, device, options);
    const outcome = simulatedBackend.ingestEvent(built.request, built.credential, {
      failBeforeCommit: options.failBeforeCommit,
    });
    next.last_request = { ...built, step };
    next.technical.push(technicalFor(step, built, outcome, before, repo.counts()));
    if (outcome.committed) {
      next.completed = next.completed.includes(step) ? next.completed : [...next.completed, step];
      if (step === "INSTALL") {
        const install = store.installs.find((i) => i.install_id === attribution.install_id);
        if (install) next.install = clone(install);
      }
    }
    notifyStore();
    return next;
  },

  /** Re-submit the exact last event (same source_system + source_event_id). */
  async retryLast(state: SimulationState): Promise<SimulationState> {
    await latency();
    if (!state.last_request) return state;
    const repo = simulatedBackend.repository;
    const before = repo.counts();
    const outcome = simulatedBackend.ingestEvent(
      state.last_request.request,
      state.last_request.credential,
    );
    const entry = technicalFor("RETRY", state.last_request, outcome, before, repo.counts());
    entry.title = `Retry — ${entry.title}`;
    notifyStore();
    return { ...state, technical: [...state.technical, entry] };
  },

  async getAttribution(id: string): Promise<Attribution | null> {
    return attributionProvider.getAttribution(id);
  },
};

const STEP_EVENT: Record<Exclude<SimulationStep, "CLICK">, IngestEventType> = {
  INSTALL: "INSTALL_REFERRER_RECEIVED",
  FIRST_OPEN: "FIRST_OPEN",
  SIGNUP_STARTED: "SIGNUP_STARTED",
  SIGNUP_COMPLETED: "SIGNUP_COMPLETED",
  TENANT_CREATED: "TENANT_CREATED",
  TENANT_ACTIVATED: "TENANT_ACTIVATED",
  SUBSCRIPTION_STARTED: "SUBSCRIPTION_STARTED",
  FIRST_PAYMENT: "FIRST_PAYMENT",
};

function buildRequest(
  step: SimulationStep,
  state: SimulationState,
  attribution: Attribution,
  device: DeviceMemory,
  options: StepOptions,
): { request: IngestEventRequest; credential: ServiceCredential } {
  const event_type = STEP_EVENT[step as Exclude<SimulationStep, "CLICK">];
  const occurred_at = options.occurred_at ?? new Date().toISOString();
  const base = { event_type, occurred_at, app: attribution.app, platform: state.platform };
  let request: IngestEventRequest;
  if (step === "INSTALL" || step === "FIRST_OPEN") {
    device.install_id = device.install_id ?? nextId("INS", 5);
    const token = options.acquisition_token ?? device.acquisition_token;
    const source = appSourceFor(attribution.app, state.platform);
    request = {
      ...base,
      source_system: source,
      source_event_id: sourceEventId("evt-device"),
      install_id: device.install_id,
      // iOS has no Install Referrer: only provider-dependent matching signals.
      ...(state.platform === "IOS" && !options.acquisition_token
        ? { match_hint: attribution.session_id }
        : { acquisition_token: token }),
    };
  } else if (step === "SIGNUP_STARTED" || step === "SIGNUP_COMPLETED") {
    device.user_id = device.user_id ?? nextId("U", 6);
    device.signup_id = device.signup_id ?? nextId("SGN", 5);
    request = {
      ...base,
      source_system: "SIGNUP_SERVICE",
      source_event_id: sourceEventId("sgn-evt"),
      user_id: device.user_id,
      signup_id: device.signup_id,
      install_id: device.install_id,
      acquisition_session_id: device.acquisition_session_id,
      ...(step === "SIGNUP_COMPLETED"
        ? { contact_email: "simulated.prospect@example.in", tenant_name: "Simulated Prospect Pvt Ltd" }
        : {}),
    };
  } else if (step === "TENANT_CREATED" || step === "TENANT_ACTIVATED") {
    device.tenant_id = device.tenant_id ?? nextId("T", 6);
    request = {
      ...base,
      source_system: "TENANT_SERVICE",
      source_event_id: sourceEventId("tnt-evt"),
      tenant_id: device.tenant_id,
      user_id: device.user_id,
    };
  } else {
    // Billing is authoritative for commercial facts; Price Admin owns the price.
    const pv =
      store.priceVersions.find(
        (p) => store.plans.find((pl) => pl.plan_id === p.plan_id)?.app === attribution.app,
      ) ?? store.priceVersions[0]!;
    device.subscription_id = device.subscription_id ?? nextId("SUB", 5);
    device.price_version_id = pv.price_version_id;
    request = {
      ...base,
      source_system: "BILLING_SERVICE",
      source_event_id: sourceEventId("bill-evt"),
      tenant_id: device.tenant_id ?? attribution.tenant_id ?? undefined,
      subscription_id: device.subscription_id,
      plan_id: pv.plan_id,
      price_version_id: pv.price_version_id,
      ...(step === "FIRST_PAYMENT"
        ? { transaction_id: nextId("TX", 5), amount: pv.amount, currency: "INR" as const }
        : {}),
    };
  }
  if (options.untrusted) request = { ...request, ...options.untrusted };
  return { request, credential: { source_system: request.source_system } };
}

const ACTOR: Record<string, string> = {
  SIGNUP_SERVICE: "Signup Service",
  TENANT_SERVICE: "Tenant Service",
  BILLING_SERVICE: "Billing Service",
};

function technicalFor(
  step: SimulationStep | "RETRY",
  built: { request: IngestEventRequest; credential: ServiceCredential },
  outcome: IngestOutcome,
  before: RepositoryCounts,
  after: RepositoryCounts,
): TechnicalEntry {
  const body = outcome.http.body;
  const src = built.request.source_system;
  return {
    id: nextId("TXN", 5),
    step,
    title: `Attribution Ingestion API · ${built.request.event_type}`,
    actor: ACTOR[src] ?? `${titleApp(src)} app (${src})`,
    request_line: `POST /api/v1/attribution/events`,
    payload: built.request,
    pipeline: outcome.pipeline,
    status: outcome.http.status,
    response: body,
    correlation: body.success ? body.data.correlation : [],
    counts_before: before,
    counts_after: after,
    committed: outcome.committed,
  };
}

function titleApp(source: string): string {
  const app = source.split("_")[0] ?? source;
  return app.charAt(0) + app.slice(1).toLowerCase();
}
