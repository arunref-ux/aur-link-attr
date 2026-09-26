/**
 * Simulated persistence layer.
 *
 * This is the ONLY module holding simulated state. Providers read/write it;
 * UI never imports it directly. Replacing the simulated providers with real
 * services means swapping the provider implementations, not the UI.
 */

import type {
  AcquisitionJourney,
  AcquisitionSession,
  SignupBinding,
  Attribution,
  AttributionResolution,
  ConversionEvent,
  CurrentAttributionProjection,
  IdempotencyRecord,
  AttributionEvent,
  AttributionLink,
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
import { lookupReferralCodeIn, normalizeClaim } from "@/lib/referral-lookup";
import {
  resolveAttribution,
  type AttributionClaim,
  type InstallSignal,
  type ResolutionOutput,
} from "@/lib/attribution-rules";

export interface StoreShape {
  partners: Partner[];
  experiences: DemoExperience[];
  plans: Plan[];
  priceVersions: PriceVersion[];
  campaigns: Campaign[];
  links: AttributionLink[];
  clicks: Click[];
  installs: Install[];
  events: AttributionEvent[];
  attributions: Attribution[];
  rules: AttributionRulesConfig;
  providers: ProviderDescriptor[];
  domains: DomainDescriptor[];
  /* production-contract tables (simulated PostgreSQL) */
  acquisitionSessions: AcquisitionSession[];
  resolutions: AttributionResolution[];
  currentAttribution: Record<string, CurrentAttributionProjection>;
  conversionEvents: ConversionEvent[];
  idempotency: IdempotencyRecord[];
  acquisitionJourneys: AcquisitionJourney[];
  signupBindings: SignupBinding[];
  /** Active rules version; every new resolution is stamped with it. */
  rulesVersion: string;
}

/** Anchor "now" so the simulated dataset is deterministic across server + client. */
export const SIMULATED_NOW = new Date("2026-09-26T06:30:00.000Z");

const TOKEN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
let lcg = 987654321;
function rand() {
  lcg = (lcg * 1103515245 + 12345) % 2147483648;
  return lcg / 2147483648;
}
export function makeToken(): string {
  let out = "";
  for (let i = 0; i < 7; i += 1) {
    out += TOKEN_ALPHABET[Math.floor(rand() * TOKEN_ALPHABET.length)];
  }
  return out;
}
function pick<T>(items: T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

/**
 * Simulator ID generation. Every seeded or generated ID is registered, and the
 * generator skips anything already occupied — so interactive creation can never
 * collide with seeded IDs (e.g. LNK-0001, T-008291).
 */
const counters: Record<string, number> = {};
const usedIds = new Set<string>();
export function reserveId(id: string): void {
  usedIds.add(id);
}
export function nextId(prefix: string, pad = 4): string {
  let id: string;
  do {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    id = `${prefix}-${String(counters[prefix]).padStart(pad, "0")}`;
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

/** Generate an opaque token not already used by any link in the dataset. */
export function makeUniqueToken(): string {
  let token = makeToken();
  while (store.links.some((l) => l.token === token)) token = makeToken();
  return token;
}

/** True while module-level seeding runs; seeded events are "received" when they occurred. */
let seeding = true;

function iso(base: Date, minutes: number): string {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}
function daysAgo(days: number, minuteOfDay = 620): Date {
  const d = new Date(SIMULATED_NOW.getTime() - days * 86_400_000);
  d.setUTCHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 8, 0);
  return d;
}

/* ------------------------------- seed data ------------------------------- */

const partners: Partner[] = [
  {
    partner_id: "P-104",
    referral_code: "SRISAI104",
    name: "Sri Sai Tally Solutions",
    partner_type: "TALLY_RESELLER",
    status: "ACTIVE",
    territory: "Hyderabad, Telangana",
    contact_name: "Ramesh Kumar",
    contact_email: "ramesh@srisaitally.in",
    source_system: "PARTNER_PORTAL",
  },
  {
    partner_id: "P-118",
    referral_code: "HBS118",
    name: "Hyderabad Business Systems",
    partner_type: "TECHNOLOGY_PARTNER",
    status: "ACTIVE",
    territory: "Hyderabad, Telangana",
    contact_name: "Farida Sheikh",
    contact_email: "farida@hbsystems.in",
    source_system: "PARTNER_PORTAL",
  },
  {
    partner_id: "P-131",
    referral_code: "VERTEX131",
    name: "Vertex eSSL Solutions",
    partner_type: "ESSL_RESELLER",
    status: "ACTIVE",
    territory: "Secunderabad",
    contact_name: "Anil Varma",
    contact_email: "anil@vertexessl.in",
    source_system: "PARTNER_PORTAL",
  },
  {
    partner_id: "P-145",
    referral_code: "VIZAG145",
    name: "Vizag Accounting Technologies",
    partner_type: "TALLY_RESELLER",
    status: "ACTIVE",
    territory: "Visakhapatnam, Andhra Pradesh",
    contact_name: "Lakshmi Rao",
    contact_email: "lakshmi@vizagacct.in",
    source_system: "PARTNER_PORTAL",
  },
  {
    partner_id: "P-152",
    referral_code: "METRO152",
    name: "Metro Biometric Systems",
    partner_type: "REFERRAL_PARTNER",
    status: "ACTIVE",
    territory: "Bengaluru, Karnataka",
    contact_name: "Joseph Mathew",
    contact_email: "joseph@metrobiometric.in",
    source_system: "PARTNER_PORTAL",
  },
];

const experiences: DemoExperience[] = [
  {
    demo_experience_id: "DX-011",
    name: "Aura for Tally Dealers — Guided Walkthrough",
    app: "AURA",
    description: "Conversation-led demo positioned for Tally reseller prospects.",
    source_system: "DEMO_STUDIO",
  },
  {
    demo_experience_id: "DX-014",
    name: "ShopTalk Retail Counter Demo",
    app: "SHOPTALK",
    description: "Counter-billing demo with sample catalogue.",
    source_system: "DEMO_STUDIO",
  },
  {
    demo_experience_id: "DX-022",
    name: "Aura Attendance + eSSL Demo",
    app: "AURA",
    description: "Biometric attendance scenario for eSSL resellers.",
    source_system: "DEMO_STUDIO",
  },
];

const plans: Plan[] = [
  { plan_id: "PL-AURA-GROWTH", name: "Aura Growth", app: "AURA", source_system: "PRICE_ADMIN" },
  { plan_id: "PL-AURA-STD", name: "Aura Standard", app: "AURA", source_system: "PRICE_ADMIN" },
  {
    plan_id: "PL-ST-BUSINESS",
    name: "ShopTalk Business",
    app: "SHOPTALK",
    source_system: "PRICE_ADMIN",
  },
  {
    plan_id: "PL-AURUMI-SUITE",
    name: "Aurumi Business Suite",
    app: "AURUMI",
    source_system: "PRICE_ADMIN",
  },
  {
    plan_id: "PL-ST-STARTER",
    name: "ShopTalk Starter",
    app: "SHOPTALK",
    source_system: "PRICE_ADMIN",
  },
];

const priceVersions: PriceVersion[] = [
  {
    price_version_id: "PV-262",
    plan_id: "PL-AURUMI-SUITE",
    amount: 6999,
    currency: "INR",
    effective_from: "2026-07-01T00:00:00.000Z",
    source_system: "PRICE_ADMIN",
  },
  {
    price_version_id: "PV-239",
    plan_id: "PL-ST-BUSINESS",
    amount: 2499,
    currency: "INR",
    effective_from: "2026-04-01T00:00:00.000Z",
    source_system: "PRICE_ADMIN",
  },
  {
    price_version_id: "PV-241",
    plan_id: "PL-ST-STARTER",
    amount: 999,
    currency: "INR",
    effective_from: "2026-04-01T00:00:00.000Z",
    source_system: "PRICE_ADMIN",
  },
  {
    price_version_id: "PV-256",
    plan_id: "PL-AURA-GROWTH",
    amount: 4999,
    currency: "INR",
    effective_from: "2026-07-01T00:00:00.000Z",
    source_system: "PRICE_ADMIN",
  },
  {
    price_version_id: "PV-258",
    plan_id: "PL-AURA-STD",
    amount: 1899,
    currency: "INR",
    effective_from: "2026-07-01T00:00:00.000Z",
    source_system: "PRICE_ADMIN",
  },
];

const campaigns: Campaign[] = [
  {
    campaign_id: "CMP-2031",
    name: "Aura + Tally — September 2026",
    description:
      "Tally reseller network pushes Aura through WhatsApp to accounting-led SMB prospects.",
    status: "ACTIVE",
    start_date: "2026-09-01T00:00:00.000Z",
    end_date: "2026-12-31T00:00:00.000Z",
    target_app: "AURA",
    default_destination: "SIGNUP",
    default_channel: "WHATSAPP",
    associated_partner_id: "P-104",
    demo_experience_id: "DX-011",
    tags: ["tally", "reseller", "whatsapp"],
    created_by: "priya.n@aurumi.ai",
    created_at: "2026-08-24T05:10:00.000Z",
    updated_at: "2026-09-18T07:40:00.000Z",
  },
  {
    campaign_id: "CMP-2044",
    name: "ShopTalk Reseller Acquisition",
    description: "Reseller-led ShopTalk acquisition across retail counters.",
    status: "ACTIVE",
    start_date: "2026-07-15T00:00:00.000Z",
    end_date: null,
    target_app: "SHOPTALK",
    default_destination: "SHOPTALK_HOME",
    default_channel: "WHATSAPP",
    associated_partner_id: null,
    demo_experience_id: "DX-014",
    tags: ["shoptalk", "retail"],
    created_by: "vikram.s@aurumi.ai",
    created_at: "2026-07-08T09:00:00.000Z",
    updated_at: "2026-09-12T06:25:00.000Z",
  },
  {
    campaign_id: "CMP-2058",
    name: "Aura + eSSL Hyderabad",
    description: "Biometric attendance angle via eSSL resellers in Hyderabad.",
    status: "ACTIVE",
    start_date: "2026-08-10T00:00:00.000Z",
    end_date: null,
    target_app: "AURA",
    default_destination: "DEMO_EXPERIENCE",
    default_channel: "WHATSAPP",
    associated_partner_id: "P-131",
    demo_experience_id: "DX-022",
    tags: ["essl", "biometric", "hyderabad"],
    created_by: "priya.n@aurumi.ai",
    created_at: "2026-08-02T04:45:00.000Z",
    updated_at: "2026-09-20T10:10:00.000Z",
  },
  {
    campaign_id: "CMP-2062",
    name: "Aurumi Web Direct — Q3",
    description: "Owned-channel web and email acquisition, no partner attached.",
    status: "PAUSED",
    start_date: "2026-07-01T00:00:00.000Z",
    end_date: null,
    target_app: "AURUMI",
    default_destination: "APP_HOME",
    default_channel: "WEB",
    associated_partner_id: null,
    demo_experience_id: null,
    tags: ["owned", "web"],
    created_by: "meera.k@aurumi.ai",
    created_at: "2026-06-25T11:00:00.000Z",
    updated_at: "2026-09-01T08:00:00.000Z",
  },
  {
    campaign_id: "CMP-2071",
    name: "ShopTalk Vizag Pilot",
    description: "Draft campaign for the Visakhapatnam retail pilot.",
    status: "DRAFT",
    start_date: "2026-10-05T00:00:00.000Z",
    end_date: null,
    target_app: "SHOPTALK",
    default_destination: "SIGNUP",
    default_channel: "QR",
    associated_partner_id: "P-145",
    demo_experience_id: null,
    tags: ["pilot", "vizag"],
    created_by: "vikram.s@aurumi.ai",
    created_at: "2026-09-22T06:00:00.000Z",
    updated_at: "2026-09-22T06:00:00.000Z",
  },
];

interface LinkSeed {
  link_id: string;
  token: string;
  campaign_id: string;
  partner_id: string | null;
  channel: Channel;
  app: AppName;
  destination: DestinationType;
  demo_experience_id?: string | null;
  status?: "ACTIVE" | "DISABLED";
  created_days_ago: number;
  metadata?: AttributionLink["metadata"];
}

const linkSeeds: LinkSeed[] = [
  {
    link_id: "LNK-0001",
    token: "7DX92KQ",
    campaign_id: "CMP-2031",
    partner_id: "P-104",
    channel: "WHATSAPP",
    app: "AURA",
    destination: "SIGNUP",
    demo_experience_id: "DX-011",
    created_days_ago: 24,
    metadata: { source: "partner_whatsapp", medium: "chat", creative: "tally_card_v2" },
  },
  {
    link_id: "LNK-0002",
    token: "K4M7RTA",
    campaign_id: "CMP-2031",
    partner_id: "P-145",
    channel: "WHATSAPP",
    app: "AURA",
    destination: "SIGNUP",
    created_days_ago: 21,
    metadata: { source: "partner_whatsapp", medium: "chat", placement: "broadcast" },
  },
  {
    link_id: "LNK-0003",
    token: "Q9WB23N",
    campaign_id: "CMP-2044",
    partner_id: "P-118",
    channel: "WHATSAPP",
    app: "SHOPTALK",
    destination: "SHOPTALK_HOME",
    created_days_ago: 47,
    metadata: { source: "partner_whatsapp", medium: "chat" },
  },
  {
    link_id: "LNK-0004",
    token: "M2PLZ8F",
    campaign_id: "CMP-2044",
    partner_id: "P-152",
    channel: "QR",
    app: "SHOPTALK",
    destination: "SIGNUP",
    created_days_ago: 38,
    metadata: { source: "counter_standee", medium: "qr", placement: "billing_counter" },
  },
  {
    link_id: "LNK-0005",
    token: "V6HN4TB",
    campaign_id: "CMP-2058",
    partner_id: "P-131",
    channel: "WHATSAPP",
    app: "AURA",
    destination: "DEMO_EXPERIENCE",
    demo_experience_id: "DX-022",
    created_days_ago: 33,
    metadata: { source: "partner_whatsapp", medium: "chat", creative: "essl_attendance" },
  },
  {
    link_id: "LNK-0006",
    token: "R3JXC7D",
    campaign_id: "CMP-2062",
    partner_id: null,
    channel: "EMAIL",
    app: "AURUMI",
    destination: "APP_HOME",
    created_days_ago: 52,
    metadata: { source: "newsletter", medium: "email" },
  },
  {
    link_id: "LNK-0007",
    token: "B8KD5WQ",
    campaign_id: "CMP-2031",
    partner_id: "P-118",
    channel: "SMS",
    app: "AURA",
    destination: "AURA_CONVERSATION",
    created_days_ago: 17,
    status: "DISABLED",
    metadata: { source: "sms_blast", medium: "sms" },
  },
  {
    link_id: "LNK-0008",
    token: "N5TQ9XJ",
    campaign_id: "CMP-2058",
    partner_id: "P-152",
    channel: "SOCIAL",
    app: "AURA",
    destination: "FEATURE",
    created_days_ago: 11,
    metadata: { source: "instagram", medium: "social", creative: "reel_attendance" },
  },
];

const links: AttributionLink[] = linkSeeds.map((seed) => {
  const partner = partners.find((p) => p.partner_id === seed.partner_id) ?? null;
  return {
    link_id: seed.link_id,
    token: seed.token,
    short_url: `go.aurumi.ai/x/${seed.token}`,
    campaign_id: seed.campaign_id,
    partner_id: seed.partner_id,
    partner_name_snapshot: partner?.name ?? null,
    partner_type_snapshot: partner?.partner_type ?? null,
    channel: seed.channel,
    app: seed.app,
    destination: seed.destination,
    destination_value: seed.destination === "FEATURE" ? "aura/attendance" : null,
    demo_experience_id: seed.demo_experience_id ?? null,
    // Links disabled in the seed are disabled AFTER their historical journeys run.
    status: "ACTIVE",
    disabled_behavior: "REJECT",
    metadata: seed.metadata ?? {},
    created_by: "priya.n@aurumi.ai",
    created_at: daysAgo(seed.created_days_ago, 540).toISOString(),
  };
});

const rules: AttributionRulesConfig = {
  click_attribution_window_days: 30,
  install_to_signup_window_days: 30,
  conflict_rule: "LAST_ELIGIBLE_DETERMINISTIC",
  deterministic_precedence_over_claimed: true,
  duplicate_conversion_handling: "ONE_PER_TENANT",
  unattributed_behavior: "RECORD_UNATTRIBUTED",
  disabled_link_behavior: "REJECT",
};

const providers: ProviderDescriptor[] = [
  {
    provider_id: "aurumi_native",
    name: "Aurumi Native Attribution",
    type: "NATIVE",
    status: "ACTIVE_SIMULATED",
    capabilities: [
      "Link generation",
      "Click tracking",
      "Android Install Referrer",
      "App deep links",
      "Signup attribution",
      "Tenant attribution",
    ],
    configurable: true,
    note: "Simulated implementation. Same provider interface will back the real service.",
  },
  {
    provider_id: "branch",
    name: "Branch",
    type: "EXTERNAL_MMP",
    status: "NOT_CONFIGURED",
    capabilities: ["Deferred deep linking", "Cross-platform matching"],
    configurable: false,
    note: "External attribution provider. Adapter not implemented; configuration unavailable.",
  },
  {
    provider_id: "future_mmp",
    name: "Additional Measurement Partner",
    type: "EXTERNAL_MMP",
    status: "PLANNED",
    capabilities: ["Provider-dependent"],
    configurable: false,
    note: "Provider boundary exists so another MMP can be added without redesign.",
  },
];

const domains: DomainDescriptor[] = [
  {
    domain: "go.aurumi.ai",
    status: "SIMULATED_NOT_CONNECTED",
    dns_status: "Not verified (simulated)",
    android_app_link: "assetlinks.json not published",
    apple_universal_link: "apple-app-site-association not published",
  },
];

export const store: StoreShape = {
  partners,
  experiences,
  plans,
  priceVersions,
  campaigns,
  links,
  clicks: [],
  installs: [],
  events: [],
  attributions: [],
  rules,
  providers,
  domains,
  acquisitionSessions: [],
  resolutions: [],
  currentAttribution: {},
  conversionEvents: [],
  idempotency: [],
  acquisitionJourneys: [],
  signupBindings: [],
  rulesVersion: "ATTR-RULES-1",
};

for (const id of [
  ...partners.map((p) => p.partner_id),
  ...campaigns.map((c) => c.campaign_id),
  ...links.map((l) => l.link_id),
  "T-008291",
  "TX-92883",
]) {
  reserveId(id);
}

/* --------------------------- journey generation --------------------------- */

const STAGES = [
  "CLICK",
  "INSTALL",
  "FIRST_OPEN",
  "SIGNUP_STARTED",
  "SIGNUP_COMPLETED",
  "TENANT_CREATED",
  "TENANT_ACTIVATED",
  "SUBSCRIPTION",
  "PAYMENT",
] as const;
export type JourneyStage = (typeof STAGES)[number];

interface JourneySeed {
  /** Acquisition link the prospect clicked. `null` = journey began without any link (organic/direct). */
  link_id: string | null;
  /** Required when link_id is null. */
  app?: AppName | undefined;
  start: Date;
  platform: Platform;
  tenant_name: string;
  email: string;
  reach: JourneyStage;
  price_version_id?: string | undefined;
  /** Referral code the user typed at signup (a fact). Resolved via the Partner Portal lookup. */
  referral_code?: string | undefined;
  /** Platform failed to return the click token (e.g. web session token lost). */
  referrer_lost?: boolean | undefined;
  extraClicks?: number | undefined;
  /** An earlier click on another link in the same session (competing fact). */
  conflictWithLinkId?: string | undefined;
  overrideTo?: { partner_id: string; reason: string; actor: string };
}

function userAgentFor(platform: Platform): string {
  if (platform === "ANDROID")
    return "Mozilla/5.0 (Linux; Android 14; SM-M356B) AppleWebKit/537.36 Chrome/128 Mobile";
  if (platform === "IOS")
    return "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile";
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128";
}

export function redirectTargetFor(app: AppName, platform: Platform): string {
  if (platform === "ANDROID")
    return `Google Play → ${app === "SHOPTALK" ? "ShopTalk" : app === "AURA" ? "Aura" : "Aurumi"}`;
  if (platform === "IOS") return `App Store → ${app === "SHOPTALK" ? "ShopTalk" : "Aura"}`;
  return "Web app → aurumi.ai";
}

type EventInput = Omit<AttributionEvent, "event_id" | "source_event_id" | "received_at"> & {
  source_event_id?: string | undefined;
  received_at?: string | undefined;
};

function pushEvent(e: EventInput): AttributionEvent {
  const event_id = nextId("EVT", 5);
  const event: AttributionEvent = {
    ...e,
    event_id,
    source_event_id: e.source_event_id ?? `${e.source_system}:${event_id.replace("EVT-", "")}`,
    received_at: e.received_at ?? (seeding ? e.occurred_at : new Date().toISOString()),
    schema_version: e.schema_version ?? "1",
  };
  store.events.push(event);
  return event;
}

function reached(reach: JourneyStage, stage: JourneyStage) {
  return STAGES.indexOf(stage) <= STAGES.indexOf(reach);
}

export function partnerNameOf(id: string): string | null {
  return store.partners.find((p) => p.partner_id === id)?.name ?? null;
}

/** Deterministic install signal availability is a platform FACT, not a decision. */
export function installSignalFor(
  platform: Platform,
  occurred_at: string,
  referrer_lost = false,
): InstallSignal {
  return {
    platform,
    occurred_at,
    referrer_recovered: platform === "IOS" ? false : !referrer_lost,
  };
}

function makeClick(
  link: AttributionLink,
  session_id: string,
  platform: Platform,
  at: string,
): Click {
  return {
    click_id: nextId("CLK", 5),
    session_id,
    link_id: link.link_id,
    token: link.token,
    campaign_id: link.campaign_id,
    partner_id: link.partner_id,
    channel: link.channel,
    app: link.app,
    platform,
    user_agent: userAgentFor(platform),
    occurred_at: at,
    redirect_target: redirectTargetFor(link.app, platform),
  };
}

/** Session → click ownership: clicks reference their session (no sessions.click_id). */
export function sessionForClick(clickId: string | null): AcquisitionSession | undefined {
  if (!clickId) return undefined;
  const click = store.clicks.find((c) => c.click_id === clickId);
  return click?.acquisition_session_id
    ? store.acquisitionSessions.find(
        (s) => s.acquisition_session_id === click.acquisition_session_id,
      )
    : undefined;
}

/** Write the current_attribution projection row from the attribution's latest resolution. */
export function projectCurrent(attribution: Attribution, at: string) {
  if (!attribution.current_resolution_id) return;
  store.currentAttribution[attribution.attribution_id] = {
    acquisition_journey_id: attribution.acquisition_journey_id ?? attribution.attribution_id,
    current_resolution_id: attribution.current_resolution_id,
    partner_id: attribution.partner_id,
    campaign_id: attribution.campaign_id,
    method: attribution.attribution_method,
    status: attribution.status,
    updated_at: at,
  };
}

/**
 * Apply an engine result: persist an immutable attribution_resolutions row
 * (stamped with the active rules version) and update the current projection.
 */
export function applyResolution(attribution: Attribution, res: ResolutionOutput) {
  const partner = res.partner_id
    ? (store.partners.find((p) => p.partner_id === res.partner_id) ?? null)
    : null;
  const link = res.link_id ? store.links.find((l) => l.link_id === res.link_id) : undefined;
  attribution.partner_id = res.partner_id;
  // Partner unavailable from Partner Portal → keep history interpretable via the link snapshot.
  attribution.partner_name_snapshot =
    partner?.name ?? (res.partner_id ? (link?.partner_name_snapshot ?? null) : null);
  attribution.partner_type_snapshot =
    partner?.partner_type ?? (res.partner_id ? (link?.partner_type_snapshot ?? null) : null);
  attribution.campaign_id = res.campaign_id;
  attribution.link_id = res.link_id;
  attribution.click_id = res.click_id;
  attribution.channel = link?.channel ?? null;
  attribution.attribution_method = res.attribution_method;
  attribution.attribution_source = res.attribution_source;
  attribution.resolution_reason = res.resolution_reason;
  attribution.resolution_timestamp = res.resolved_at;
  attribution.status = res.status;
  attribution.attributed_at = res.status === "ATTRIBUTED" ? res.resolved_at : null;

  const createdAt = seeding ? res.resolved_at : new Date().toISOString();
  const session = sessionForClick(res.click_id);
  const resolution: AttributionResolution = {
    resolution_id: nextId("RES", 5),
    acquisition_journey_id: attribution.acquisition_journey_id ?? attribution.attribution_id,
    acquisition_session_id: session?.acquisition_session_id ?? null,
    partner_id: res.partner_id,
    campaign_id: res.campaign_id,
    link_id: res.link_id,
    click_id: res.click_id,
    method: res.attribution_method,
    source: res.attribution_source,
    reason: res.resolution_reason,
    status: res.status,
    kind: "ENGINE",
    rules_version: store.rulesVersion,
    resolved_at: res.resolved_at,
    created_at: createdAt,
  };
  store.resolutions.push(resolution);
  attribution.rules_version = resolution.rules_version;
  attribution.current_resolution_id = resolution.resolution_id;
  projectCurrent(attribution, createdAt);
  return resolution;
}

/**
 * Admin override: immutable override record + ATTRIBUTION_OVERRIDDEN event +
 * OVERRIDE resolution row + updated projection. Acquisition facts are untouched.
 */
export function recordOverride(
  attribution: Attribution,
  target: Partner,
  reason: string,
  actor: string,
  at: string,
) {
  const previous = attribution.current_resolution_id ?? null;
  const resolution: AttributionResolution = {
    resolution_id: nextId("RES", 5),
    acquisition_journey_id: attribution.acquisition_journey_id ?? attribution.attribution_id,
    acquisition_session_id: sessionForClick(attribution.click_id)?.acquisition_session_id ?? null,
    partner_id: target.partner_id,
    campaign_id: attribution.campaign_id,
    link_id: attribution.link_id,
    click_id: attribution.click_id,
    method: attribution.attribution_method,
    source: "ADMIN_OVERRIDE",
    reason: `Override by ${actor}: ${reason}`,
    status: "OVERRIDDEN",
    kind: "OVERRIDE",
    rules_version: store.rulesVersion,
    resolved_at: at,
    created_at: at,
  };
  attribution.overrides.push({
    override_id: nextId("OVR", 5),
    previous_resolution_id: previous,
    from_partner_id: attribution.partner_id,
    from_partner_name: attribution.partner_name_snapshot,
    to_partner_id: target.partner_id,
    to_partner_name: target.name,
    reason,
    actor,
    occurred_at: at,
  });
  pushEvent({
    event_type: "ATTRIBUTION_OVERRIDDEN",
    occurred_at: at,
    attribution_id: attribution.attribution_id,
    session_id: attribution.session_id,
    link_id: attribution.link_id ?? undefined,
    campaign_id: attribution.campaign_id ?? undefined,
    partner_id: target.partner_id,
    tenant_id: attribution.tenant_id ?? undefined,
    app: attribution.app,
    platform: attribution.platform,
    channel: attribution.channel ?? undefined,
    source_system: "ADMIN_PORTAL",
    metadata: {
      from_partner: attribution.partner_name_snapshot,
      to_partner: target.name,
      reason,
      actor,
      previous_resolution_id: previous,
      note: "Original event history preserved",
    },
  });
  store.resolutions.push(resolution);
  attribution.partner_id = target.partner_id;
  attribution.partner_name_snapshot = target.name;
  attribution.partner_type_snapshot = target.partner_type;
  attribution.status = "OVERRIDDEN";
  attribution.attributed_at = attribution.attributed_at ?? at;
  attribution.current_resolution_id = resolution.resolution_id;
  attribution.rules_version = resolution.rules_version;
  projectCurrent(attribution, at);
}

function buildJourney(seed: JourneySeed): Attribution {
  const link = seed.link_id ? store.links.find((l) => l.link_id === seed.link_id)! : null;
  if (link && link.status === "DISABLED") {
    throw new Error(`Link ${link.link_id} is disabled and cannot originate a new journey`);
  }
  const app: AppName = link?.app ?? seed.app ?? "AURUMI";
  const session_id = nextId("SES", 5);
  const base = seed.start;
  const attribution_id = nextId("ATR", 5);

  /* ---------------- 1. Generate acquisition FACTS only ---------------- */
  const clicks: Click[] = [];

  const recordClick = (l: AttributionLink, at: string, note?: string) => {
    const click = makeClick(l, session_id, seed.platform, at);
    store.clicks.push(click);
    clicks.push(click);
    pushEvent({
      event_type: "LINK_CLICKED",
      occurred_at: at,
      attribution_id,
      click_id: click.click_id,
      session_id,
      link_id: l.link_id,
      campaign_id: l.campaign_id,
      partner_id: l.partner_id ?? undefined,
      app: l.app,
      platform: seed.platform,
      channel: l.channel,
      source_system: "AURUMI_NATIVE_ATTRIBUTION",
      metadata: note
        ? { token: l.token, note }
        : { token: l.token, user_agent: click.user_agent, short_url: l.short_url },
    });
    pushEvent({
      event_type: "STORE_REDIRECTED",
      occurred_at: iso(new Date(at), 0.3),
      attribution_id,
      click_id: click.click_id,
      session_id,
      link_id: l.link_id,
      campaign_id: l.campaign_id,
      partner_id: l.partner_id ?? undefined,
      app: l.app,
      platform: seed.platform,
      channel: l.channel,
      source_system: "REDIRECT_SERVICE",
      metadata: { target: click.redirect_target, destination: l.destination },
    });
    return click;
  };

  if (seed.conflictWithLinkId) {
    const other = store.links.find((l) => l.link_id === seed.conflictWithLinkId)!;
    recordClick(other, iso(base, -95), "Click from a different partner link in the same session");
  }

  if (link) {
    const primary = recordClick(link, iso(base, 0));
    for (let i = 0; i < (seed.extraClicks ?? 0); i += 1) {
      pushEvent({
        event_type: "LINK_CLICKED",
        occurred_at: iso(base, 3 + i * 7),
        attribution_id,
        click_id: primary.click_id,
        session_id,
        link_id: link.link_id,
        campaign_id: link.campaign_id,
        partner_id: link.partner_id ?? undefined,
        app: link.app,
        platform: seed.platform,
        channel: link.channel,
        source_system: "AURUMI_NATIVE_ATTRIBUTION",
        metadata: { token: link.token, duplicate_click: true, deduplicated_to: primary.click_id },
      });
    }
  }

  const attribution: Attribution = {
    attribution_id,
    partner_id: null,
    partner_name_snapshot: null,
    partner_type_snapshot: null,
    campaign_id: null,
    link_id: null,
    click_id: null,
    install_id: null,
    session_id,
    user_id: null,
    signup_id: null,
    tenant_id: null,
    tenant_name: null,
    contact_email: seed.email,
    channel: null,
    app,
    platform: seed.platform,
    attribution_method: "UNATTRIBUTED",
    attribution_source: "NONE",
    resolution_reason: "",
    resolution_timestamp: iso(base, 0),
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

  /* ---------------- 2. Ask the engine ---------------- */
  let installSignal: InstallSignal | null = null;
  const claims: AttributionClaim[] = [];
  const resolve = (at: string) => {
    const res = resolveAttribution({
      acquisitionFacts: clicks,
      installSignal,
      claims,
      referenceTime: at,
      rules: store.rules,
      partnerName: partnerNameOf,
    });
    applyResolution(attribution, res);
    return res;
  };
  resolve(iso(base, 0.5));

  /** Shared correlation fields, taken from the current resolution. */
  const ctx = () => ({
    attribution_id,
    session_id,
    link_id: attribution.link_id ?? undefined,
    campaign_id: attribution.campaign_id ?? undefined,
    partner_id: attribution.partner_id ?? undefined,
    click_id: attribution.click_id ?? undefined,
    app,
    platform: seed.platform,
    channel: attribution.channel ?? undefined,
  });

  if (reached(seed.reach, "INSTALL")) {
    const at = iso(base, 4);
    installSignal = installSignalFor(seed.platform, at, seed.referrer_lost);
    const res = resolve(at);
    const install: Install = {
      install_id: nextId("INS", 5),
      click_id: res.click_id,
      session_id,
      app,
      platform: seed.platform,
      attribution_method: res.attribution_method,
      attribution_source: res.attribution_source,
      referrer_recovered: installSignal.referrer_recovered && clicks.length > 0,
      occurred_at: at,
    };
    store.installs.push(install);
    attribution.install_id = install.install_id;
    pushEvent({
      event_type: res.status === "ATTRIBUTED" ? "INSTALL_ATTRIBUTED" : "INSTALL_UNATTRIBUTED",
      occurred_at: at,
      ...ctx(),
      install_id: install.install_id,
      attribution_method: res.attribution_method,
      source_system: "AURUMI_NATIVE_ATTRIBUTION",
      metadata: {
        method_detail:
          clicks.length === 0
            ? "Organic install — no acquisition link"
            : seed.platform === "ANDROID"
              ? "Play Install Referrer"
              : seed.platform === "IOS"
                ? "iOS deferred attribution — provider-dependent / future capability"
                : "Web session token",
        referrer: install.referrer_recovered ? "Recovered successfully" : "Not available",
      },
    });
  }

  if (reached(seed.reach, "FIRST_OPEN")) {
    pushEvent({
      event_type: "FIRST_OPEN",
      occurred_at: iso(base, 4.8),
      ...ctx(),
      install_id: attribution.install_id ?? undefined,
      source_system: "APP_SDK",
      metadata: { attribution_context: attribution.link_id ? "restored" : "not available" },
    });
  }

  if (reached(seed.reach, "SIGNUP_STARTED")) {
    attribution.user_id = nextId("U", 6);
    attribution.signup_id = nextId("SGN", 5);
    const at = iso(base, 7);
    if (seed.referral_code) {
      // Code → Partner Portal lookup → normalized claim → engine.
      const claim = normalizeClaim(lookupReferralCodeIn(store.partners, seed.referral_code), at);
      if (claim) {
        claims.push(claim);
        resolve(at);
      }
    }
    pushEvent({
      event_type: "SIGNUP_STARTED",
      occurred_at: at,
      ...ctx(),
      install_id: attribution.install_id ?? undefined,
      user_id: attribution.user_id,
      signup_id: attribution.signup_id,
      source_system: "SIGNUP_SERVICE",
      metadata: seed.referral_code ? { referral_code: seed.referral_code } : {},
    });
  }

  if (reached(seed.reach, "SIGNUP_COMPLETED")) {
    attribution.signup_at = iso(base, 10.8);
    attribution.first_conversion_at = attribution.signup_at;
    pushEvent({
      event_type: "SIGNUP_COMPLETED",
      occurred_at: attribution.signup_at,
      ...ctx(),
      install_id: attribution.install_id ?? undefined,
      user_id: attribution.user_id ?? undefined,
      signup_id: attribution.signup_id ?? undefined,
      source_system: "SIGNUP_SERVICE",
      metadata: { email: seed.email },
    });
  }

  if (reached(seed.reach, "TENANT_CREATED")) {
    attribution.tenant_id = nextId("T", 6);
    attribution.tenant_name = seed.tenant_name;
    attribution.tenant_created_at = iso(base, 11);
    pushEvent({
      event_type: "TENANT_CREATED",
      occurred_at: attribution.tenant_created_at,
      ...ctx(),
      install_id: attribution.install_id ?? undefined,
      user_id: attribution.user_id ?? undefined,
      tenant_id: attribution.tenant_id,
      source_system: "TENANT_SERVICE",
      metadata: { tenant_name: seed.tenant_name },
    });
    const res = resolve(iso(base, 11.2));
    pushEvent({
      event_type: "ATTRIBUTION_RESOLVED",
      occurred_at: res.resolved_at,
      ...ctx(),
      install_id: attribution.install_id ?? undefined,
      user_id: attribution.user_id ?? undefined,
      tenant_id: attribution.tenant_id,
      attribution_method: res.attribution_method,
      source_system: "ATTRIBUTION_ENGINE",
      metadata: {
        rule: store.rules.conflict_rule,
        eligible_clicks: res.eligible_click_count,
        resolution_reason: res.resolution_reason,
      },
    });
  }

  if (reached(seed.reach, "TENANT_ACTIVATED")) {
    attribution.activated_at = iso(base, 2 * 1440 + 30);
    pushEvent({
      event_type: "TENANT_ACTIVATED",
      occurred_at: attribution.activated_at,
      ...ctx(),
      user_id: attribution.user_id ?? undefined,
      tenant_id: attribution.tenant_id ?? undefined,
      source_system: "TENANT_SERVICE",
      metadata: { activation_trigger: "first_business_document_created" },
    });
  }

  const priceVersion =
    store.priceVersions.find((pv) => pv.price_version_id === seed.price_version_id) ??
    store.priceVersions.find(
      (pv) => store.plans.find((p) => p.plan_id === pv.plan_id)?.app === app,
    ) ??
    store.priceVersions[0]!;
  const plan = store.plans.find((p) => p.plan_id === priceVersion.plan_id) ?? store.plans[0]!;

  if (reached(seed.reach, "SUBSCRIPTION")) {
    attribution.subscription = {
      subscription_id: nextId("SUB", 5),
      plan_id: plan.plan_id,
      price_version_id: priceVersion.price_version_id,
      started_at: iso(base, 8 * 1440),
    };
    pushEvent({
      event_type: "SUBSCRIPTION_STARTED",
      occurred_at: attribution.subscription.started_at,
      ...ctx(),
      user_id: attribution.user_id ?? undefined,
      tenant_id: attribution.tenant_id ?? undefined,
      source_system: "BILLING_SERVICE",
      metadata: {
        plan_id: plan.plan_id,
        plan_name: plan.name,
        price_version_id: priceVersion.price_version_id,
        subscription_id: attribution.subscription.subscription_id,
        pricing_source: "PRICE_ADMIN",
      },
    });
  }

  if (reached(seed.reach, "PAYMENT")) {
    attribution.first_payment = {
      transaction_id: nextId("TX", 5),
      amount: priceVersion.amount,
      currency: "INR",
      occurred_at: iso(base, 8 * 1440 + 40),
    };
    attribution.commercial_conversion_at = attribution.first_payment.occurred_at;
    pushEvent({
      event_type: "FIRST_PAYMENT",
      occurred_at: attribution.first_payment.occurred_at,
      ...ctx(),
      user_id: attribution.user_id ?? undefined,
      tenant_id: attribution.tenant_id ?? undefined,
      source_system: "BILLING_SERVICE",
      metadata: {
        transaction_id: attribution.first_payment.transaction_id,
        amount: attribution.first_payment.amount,
        currency: "INR",
        subscription_id: attribution.subscription?.subscription_id ?? null,
        commission_calculation: "handled externally",
      },
    });
  }

  if (seed.overrideTo) {
    const target = store.partners.find((p) => p.partner_id === seed.overrideTo!.partner_id)!;
    recordOverride(
      attribution,
      target,
      seed.overrideTo.reason,
      seed.overrideTo.actor,
      iso(base, 9 * 1440),
    );
  }

  store.attributions.push(attribution);
  return attribution;
}

/* ---- LINK_CREATED events for seeded links ---- */
for (const link of store.links) {
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
}

/* ---- Flagship journey from the brief (Trace showcase) ---- */
const flagship = buildJourney({
  link_id: "LNK-0001",
  start: new Date("2026-09-26T05:01:08.000Z"), // 10:31:08 IST
  platform: "ANDROID",
  tenant_name: "ABC Manufacturing Pvt Ltd",
  email: "accounts@abcmfg.in",
  reach: "PAYMENT",
  price_version_id: "PV-256", // Aura Growth (Price Admin)
});
flagship.tenant_id = "T-008291";
flagship.tenant_name = "ABC Manufacturing Pvt Ltd";
for (const ev of store.events.filter((e) => e.attribution_id === flagship.attribution_id)) {
  if (ev.tenant_id) ev.tenant_id = "T-008291";
  if (ev.event_type === "TENANT_CREATED") ev.metadata["tenant_id"] = "T-008291";
  if (ev.event_type === "FIRST_PAYMENT") ev.metadata["transaction_id"] = "TX-92883";
}
if (flagship.first_payment) flagship.first_payment.transaction_id = "TX-92883";

/* ---- Scenario journeys ---- */
buildJourney({
  link_id: "LNK-0002",
  start: daysAgo(12, 615),
  platform: "ANDROID",
  tenant_name: "Kranthi Traders",
  email: "kranthi@kranthitraders.in",
  reach: "PAYMENT",
  conflictWithLinkId: "LNK-0001", // Scenario A: competing partner clicks
  price_version_id: "PV-256",
});
buildJourney({
  link_id: "LNK-0003",
  start: daysAgo(19, 700),
  platform: "ANDROID",
  tenant_name: "Nandini Super Bazaar",
  email: "billing@nandinibazaar.in",
  reach: "PAYMENT",
  extraClicks: 3, // Scenario B: repeated clicks, single conversion
  price_version_id: "PV-239",
});
buildJourney({
  link_id: "LNK-0005",
  start: daysAgo(9, 540),
  platform: "ANDROID",
  tenant_name: "Sravani Industries",
  email: "hr@sravaniind.in",
  reach: "FIRST_OPEN", // Scenario C: installs, never signs up
});
buildJourney({
  link_id: null, // Scenario D: organic — journey begins without any link
  app: "AURUMI",
  start: daysAgo(15, 800),
  platform: "WEB",
  tenant_name: "Lotus Interiors",
  email: "hello@lotusinteriors.in",
  reach: "TENANT_ACTIVATED",
});
buildJourney({
  link_id: "LNK-0007",
  start: daysAgo(14, 650),
  platform: "ANDROID",
  tenant_name: "Deccan Hardware Mart",
  email: "sales@deccanhardware.in",
  reach: "PAYMENT", // Scenario E: link later disabled, attribution intact
  price_version_id: "PV-258",
});
buildJourney({
  link_id: "LNK-0004",
  start: daysAgo(22, 690),
  platform: "IOS",
  tenant_name: "Sunrise Pharma Retail",
  email: "owner@sunrisepharma.in",
  reach: "TENANT_CREATED", // iOS: no deterministic signal — engine falls back to matching
});
buildJourney({
  link_id: "LNK-0002",
  start: daysAgo(27, 600),
  platform: "WEB",
  tenant_name: "Geeta Steel Works",
  email: "geeta@geetasteel.in",
  reach: "SUBSCRIPTION",
  referrer_lost: true, // web token not preserved — engine falls back to the claim
  referral_code: "SRISAI104",
});
buildJourney({
  link_id: "LNK-0003",
  start: daysAgo(34, 660),
  platform: "ANDROID",
  tenant_name: "Ravi Electricals",
  email: "ravi@ravielectricals.in",
  reach: "PAYMENT",
  price_version_id: "PV-241",
  overrideTo: {
    partner_id: "P-104",
    reason: "Prospect was introduced by Sri Sai Tally Solutions; wrong link shared by field team.",
    actor: "meera.k@aurumi.ai",
  },
});

/* ---- Volume: deterministic spread of additional journeys ---- */
const tenantNames = [
  "Balaji Agencies",
  "Chandra Textiles",
  "Divya Auto Parts",
  "Eshwar Foods",
  "Ganesh Plastics",
  "Harika Stores",
  "Indus Packaging",
  "Jyothi Enterprises",
  "Krishna Marketing",
  "Laxmi Traders",
  "Madhav Distributors",
  "Nirmal Fabrics",
  "Omkar Tools",
  "Pranav Chemicals",
  "Quality Hardware",
  "Rajesh Motors",
  "Surya Seeds",
  "Tejas Printers",
  "Uma Sarees",
  "Varun Logistics",
  "Yamini Foods",
  "Zenith Fittings",
  "Aditya Dairy",
  "Bhavya Crafts",
  "Chaitanya Books",
  "Dhruva Solar",
  "Esha Boutique",
  "Falcon Sports",
  "Gokul Sweets",
  "Hema Pharma",
  "Ishan Cables",
  "Jayanth Paints",
  "Kiran Bakery",
  "Lohit Timbers",
  "Manasa Optics",
  "Naveen Mobiles",
  "Orbit Stationers",
  "Pavan Poultry",
  "Rithika Toys",
  "Sagar Marine",
  "Tara Silks",
  "Uday Cements",
  "Vamsi Granites",
  "Wisdom Academy",
  "Yash Tyres",
];
const reaches: JourneyStage[] = [
  "CLICK",
  "CLICK",
  "INSTALL",
  "FIRST_OPEN",
  "FIRST_OPEN",
  "SIGNUP_STARTED",
  "SIGNUP_COMPLETED",
  "SIGNUP_COMPLETED",
  "TENANT_CREATED",
  "TENANT_CREATED",
  "TENANT_ACTIVATED",
  "TENANT_ACTIVATED",
  "SUBSCRIPTION",
  "PAYMENT",
  "PAYMENT",
];
const activeLinkIds = [
  "LNK-0001",
  "LNK-0002",
  "LNK-0003",
  "LNK-0004",
  "LNK-0005",
  "LNK-0006",
  "LNK-0008",
];
for (let i = 0; i < tenantNames.length; i += 1) {
  const platform: Platform = pick<Platform>(["ANDROID", "ANDROID", "ANDROID", "IOS", "WEB"]);
  const organic = rand() < 0.12;
  const claimed = rand() < 0.1;
  const linkId = pick(activeLinkIds);
  buildJourney({
    link_id: organic ? null : linkId,
    app: pick<AppName>(["AURA", "SHOPTALK", "AURUMI"]),
    start: daysAgo(2 + Math.floor(rand() * 86), 480 + Math.floor(rand() * 480)),
    platform,
    tenant_name: tenantNames[i]!,
    email: `contact@${tenantNames[i]!.toLowerCase().replace(/[^a-z]/g, "")}.in`,
    reach: pick(reaches),
    referral_code: organic && claimed ? pick(partners).referral_code : undefined,
  });
}

/* ---- Links disabled after their historical journeys ---- */
for (const link of store.links) {
  const seed = linkSeeds.find((l) => l.link_id === link.link_id);
  if (seed?.status === "DISABLED") {
    link.status = "DISABLED";
    pushEvent({
      event_type: "LINK_DISABLED",
      occurred_at: daysAgo(6, 700).toISOString(),
      link_id: link.link_id,
      campaign_id: link.campaign_id,
      partner_id: link.partner_id ?? undefined,
      app: link.app,
      platform: "WEB",
      channel: link.channel,
      source_system: "AURUMI_NATIVE_ATTRIBUTION",
      metadata: {
        reason: "Campaign creative retired",
        behavior: link.disabled_behavior,
        actor: "priya.n@aurumi.ai",
        note: "Historical attribution remains intact",
      },
    });
  }
}
seeding = false;

/* ------------------------------ reactivity ------------------------------ */

const listeners = new Set<() => void>();
export function subscribeStore(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notifyStore() {
  listeners.forEach((fn) => fn());
}
export { pushEvent, buildJourney };
