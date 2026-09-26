/**
 * Simulated persistence layer.
 *
 * This is the ONLY module holding simulated state. Providers read/write it;
 * UI never imports it directly. Replacing the simulated providers with real
 * services means swapping the provider implementations, not the UI.
 */

import type {
  Attribution,
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

const counters: Record<string, number> = {};
export function nextId(prefix: string, pad = 4): string {
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  return `${prefix}-${String(counters[prefix]).padStart(pad, "0")}`;
}

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
    plan_id: "PL-ST-STARTER",
    name: "ShopTalk Starter",
    app: "SHOPTALK",
    source_system: "PRICE_ADMIN",
  },
];

const priceVersions: PriceVersion[] = [
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
    end_date: "2026-09-30T00:00:00.000Z",
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
    status: seed.status ?? "ACTIVE",
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
};

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
  link_id: string;
  start: Date;
  platform: Platform;
  tenant_name: string;
  email: string;
  reach: JourneyStage;
  method?: AttributionMethod | undefined;
  price_version_id?: string | undefined;
  unattributed?: boolean | undefined;
  claimed_code?: string | undefined;
  extraClicks?: number | undefined;
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

function pushEvent(e: Omit<AttributionEvent, "event_id">): AttributionEvent {
  const event: AttributionEvent = { event_id: nextId("EVT", 5), ...e };
  store.events.push(event);
  return event;
}

function reached(reach: JourneyStage, stage: JourneyStage) {
  return STAGES.indexOf(stage) <= STAGES.indexOf(reach);
}

function buildJourney(seed: JourneySeed): Attribution {
  const link = store.links.find((l) => l.link_id === seed.link_id)!;
  const campaign = store.campaigns.find((c) => c.campaign_id === link.campaign_id)!;
  const partner = store.partners.find((p) => p.partner_id === link.partner_id) ?? null;
  const session_id = nextId("SES", 5);
  const base = seed.start;

  const method: AttributionMethod = seed.unattributed
    ? "UNATTRIBUTED"
    : (seed.method ??
      (seed.platform === "ANDROID"
        ? "DETERMINISTIC"
        : seed.platform === "WEB"
          ? "DETERMINISTIC"
          : "MATCHED"));

  const attribution_id = nextId("ATR", 5);

  /* Conflicting click from another partner's link, resolved by the rule. */
  let conflictClick: Click | null = null;
  if (seed.conflictWithLinkId) {
    const other = store.links.find((l) => l.link_id === seed.conflictWithLinkId)!;
    conflictClick = {
      click_id: nextId("CLK", 5),
      session_id,
      link_id: other.link_id,
      token: other.token,
      campaign_id: other.campaign_id,
      partner_id: other.partner_id,
      channel: other.channel,
      app: other.app,
      platform: seed.platform,
      user_agent: userAgentFor(seed.platform),
      occurred_at: iso(base, -95),
      redirect_target: redirectTargetFor(other.app, seed.platform),
    };
    store.clicks.push(conflictClick);
    pushEvent({
      event_type: "LINK_CLICKED",
      occurred_at: conflictClick.occurred_at,
      attribution_id,
      click_id: conflictClick.click_id,
      session_id,
      link_id: other.link_id,
      campaign_id: other.campaign_id,
      partner_id: other.partner_id ?? undefined,
      app: other.app,
      platform: seed.platform,
      channel: other.channel,
      source_system: "AURUMI_NATIVE_ATTRIBUTION",
      metadata: { token: other.token, note: "Competing click from a different partner link" },
    });
  }

  const click: Click = {
    click_id: nextId("CLK", 5),
    session_id,
    link_id: link.link_id,
    token: link.token,
    campaign_id: link.campaign_id,
    partner_id: link.partner_id,
    channel: link.channel,
    app: link.app,
    platform: seed.platform,
    user_agent: userAgentFor(seed.platform),
    occurred_at: iso(base, 0),
    redirect_target: redirectTargetFor(link.app, seed.platform),
  };
  store.clicks.push(click);

  pushEvent({
    event_type: "LINK_CLICKED",
    occurred_at: click.occurred_at,
    attribution_id,
    click_id: click.click_id,
    session_id,
    link_id: link.link_id,
    campaign_id: link.campaign_id,
    partner_id: link.partner_id ?? undefined,
    app: link.app,
    platform: seed.platform,
    channel: link.channel,
    source_system: "AURUMI_NATIVE_ATTRIBUTION",
    metadata: {
      token: link.token,
      user_agent: click.user_agent,
      short_url: link.short_url,
    },
  });

  for (let i = 0; i < (seed.extraClicks ?? 0); i += 1) {
    pushEvent({
      event_type: "LINK_CLICKED",
      occurred_at: iso(base, 3 + i * 7),
      attribution_id,
      click_id: click.click_id,
      session_id,
      link_id: link.link_id,
      campaign_id: link.campaign_id,
      partner_id: link.partner_id ?? undefined,
      app: link.app,
      platform: seed.platform,
      channel: link.channel,
      source_system: "AURUMI_NATIVE_ATTRIBUTION",
      metadata: { token: link.token, duplicate_click: true, deduplicated_to: click.click_id },
    });
  }

  pushEvent({
    event_type: "STORE_REDIRECTED",
    occurred_at: iso(base, 0.3),
    attribution_id,
    click_id: click.click_id,
    session_id,
    link_id: link.link_id,
    campaign_id: link.campaign_id,
    partner_id: link.partner_id ?? undefined,
    app: link.app,
    platform: seed.platform,
    channel: link.channel,
    source_system: "REDIRECT_SERVICE",
    metadata: { target: click.redirect_target, destination: link.destination },
  });

  let install: Install | null = null;
  if (reached(seed.reach, "INSTALL")) {
    const deterministic = !seed.unattributed && seed.platform === "ANDROID";
    install = {
      install_id: nextId("INS", 5),
      click_id: seed.unattributed ? null : click.click_id,
      session_id,
      app: link.app,
      platform: seed.platform,
      attribution_method: seed.unattributed
        ? "UNATTRIBUTED"
        : deterministic
          ? "DETERMINISTIC"
          : method,
      attribution_source: seed.unattributed
        ? "NONE"
        : deterministic
          ? "PLAY_INSTALL_REFERRER"
          : seed.platform === "IOS"
            ? "PROVIDER_DEPENDENT"
            : "PRESERVED_ATTRIBUTION_TOKEN",
      referrer_recovered: deterministic,
      occurred_at: iso(base, 4),
    };
    store.installs.push(install);
    pushEvent({
      event_type: seed.unattributed ? "INSTALL_UNATTRIBUTED" : "INSTALL_ATTRIBUTED",
      occurred_at: install.occurred_at,
      attribution_id,
      click_id: install.click_id ?? undefined,
      install_id: install.install_id,
      session_id,
      link_id: seed.unattributed ? undefined : link.link_id,
      campaign_id: seed.unattributed ? undefined : link.campaign_id,
      partner_id: seed.unattributed ? undefined : (link.partner_id ?? undefined),
      app: link.app,
      platform: seed.platform,
      channel: link.channel,
      attribution_method: install.attribution_method,
      source_system: "AURUMI_NATIVE_ATTRIBUTION",
      metadata: {
        method_detail:
          seed.platform === "ANDROID"
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
      attribution_id,
      click_id: click.click_id,
      install_id: install?.install_id,
      session_id,
      link_id: link.link_id,
      campaign_id: link.campaign_id,
      partner_id: link.partner_id ?? undefined,
      app: link.app,
      platform: seed.platform,
      channel: link.channel,
      source_system: "APP_SDK",
      metadata: { attribution_context: seed.unattributed ? "not available" : "restored" },
    });
  }

  const user_id = reached(seed.reach, "SIGNUP_STARTED") ? nextId("U", 6) : null;
  const signup_id = reached(seed.reach, "SIGNUP_STARTED") ? nextId("SGN", 5) : null;

  if (reached(seed.reach, "SIGNUP_STARTED")) {
    pushEvent({
      event_type: "SIGNUP_STARTED",
      occurred_at: iso(base, 7),
      attribution_id,
      click_id: click.click_id,
      install_id: install?.install_id,
      session_id,
      link_id: link.link_id,
      campaign_id: link.campaign_id,
      partner_id: link.partner_id ?? undefined,
      user_id: user_id ?? undefined,
      signup_id: signup_id ?? undefined,
      app: link.app,
      platform: seed.platform,
      channel: link.channel,
      source_system: "SIGNUP_SERVICE",
      metadata: seed.claimed_code ? { claimed_referral_code: seed.claimed_code } : {},
    });
  }

  const signup_at = reached(seed.reach, "SIGNUP_COMPLETED") ? iso(base, 10.8) : null;
  if (signup_at) {
    pushEvent({
      event_type: "SIGNUP_COMPLETED",
      occurred_at: signup_at,
      attribution_id,
      click_id: click.click_id,
      install_id: install?.install_id,
      session_id,
      link_id: link.link_id,
      campaign_id: link.campaign_id,
      partner_id: link.partner_id ?? undefined,
      user_id: user_id ?? undefined,
      signup_id: signup_id ?? undefined,
      app: link.app,
      platform: seed.platform,
      channel: link.channel,
      source_system: "SIGNUP_SERVICE",
      metadata: { email: seed.email },
    });
  }

  const tenant_id = reached(seed.reach, "TENANT_CREATED") ? nextId("T", 6) : null;
  const tenant_created_at = tenant_id ? iso(base, 11) : null;
  if (tenant_id) {
    pushEvent({
      event_type: "TENANT_CREATED",
      occurred_at: tenant_created_at!,
      attribution_id,
      click_id: click.click_id,
      install_id: install?.install_id,
      session_id,
      link_id: link.link_id,
      campaign_id: link.campaign_id,
      partner_id: link.partner_id ?? undefined,
      user_id: user_id ?? undefined,
      tenant_id,
      app: link.app,
      platform: seed.platform,
      channel: link.channel,
      source_system: "TENANT_SERVICE",
      metadata: { tenant_name: seed.tenant_name },
    });

    pushEvent({
      event_type: "ATTRIBUTION_RESOLVED",
      occurred_at: iso(base, 11.2),
      attribution_id,
      click_id: click.click_id,
      install_id: install?.install_id,
      session_id,
      link_id: link.link_id,
      campaign_id: link.campaign_id,
      partner_id: seed.unattributed ? undefined : (link.partner_id ?? undefined),
      user_id: user_id ?? undefined,
      tenant_id,
      app: link.app,
      platform: seed.platform,
      channel: link.channel,
      attribution_method: method,
      source_system: "ATTRIBUTION_ENGINE",
      metadata: {
        rule: store.rules.conflict_rule,
        resolution_reason: conflictClick
          ? "Two eligible partner clicks in session — resolved by last eligible deterministic acquisition"
          : seed.unattributed
            ? "No reliable acquisition signal available"
            : "Single eligible deterministic acquisition in window",
      },
    });
  }

  const activated_at = reached(seed.reach, "TENANT_ACTIVATED") ? iso(base, 2 * 1440 + 30) : null;
  if (activated_at) {
    pushEvent({
      event_type: "TENANT_ACTIVATED",
      occurred_at: activated_at,
      attribution_id,
      session_id,
      link_id: link.link_id,
      campaign_id: link.campaign_id,
      partner_id: link.partner_id ?? undefined,
      user_id: user_id ?? undefined,
      tenant_id: tenant_id ?? undefined,
      app: link.app,
      platform: seed.platform,
      channel: link.channel,
      source_system: "TENANT_SERVICE",
      metadata: { activation_trigger: "first_business_document_created" },
    });
  }

  const priceVersion =
    store.priceVersions.find((pv) => pv.price_version_id === seed.price_version_id) ??
    store.priceVersions.find(
      (pv) => store.plans.find((p) => p.plan_id === pv.plan_id)?.app === link.app,
    ) ??
    store.priceVersions[0]!;
  const plan =
    store.plans.find((p) => p.plan_id === priceVersion.plan_id) ?? store.plans[0]!;

  let subscription: Attribution["subscription"] = null;
  if (reached(seed.reach, "SUBSCRIPTION")) {
    subscription = {
      subscription_id: nextId("SUB", 5),
      plan_id: plan.plan_id,
      price_version_id: priceVersion.price_version_id,
      started_at: iso(base, 8 * 1440),
    };
    pushEvent({
      event_type: "SUBSCRIPTION_STARTED",
      occurred_at: subscription.started_at,
      attribution_id,
      session_id,
      link_id: link.link_id,
      campaign_id: link.campaign_id,
      partner_id: link.partner_id ?? undefined,
      user_id: user_id ?? undefined,
      tenant_id: tenant_id ?? undefined,
      app: link.app,
      platform: seed.platform,
      channel: link.channel,
      source_system: "BILLING_SERVICE",
      metadata: {
        plan_id: plan.plan_id,
        plan_name: plan.name,
        price_version_id: priceVersion.price_version_id,
        subscription_id: subscription.subscription_id,
        pricing_source: "PRICE_ADMIN",
      },
    });
  }

  let first_payment: Attribution["first_payment"] = null;
  if (reached(seed.reach, "PAYMENT")) {
    first_payment = {
      transaction_id: `TX-${90000 + Math.floor(rand() * 9000)}`,
      amount: priceVersion.amount,
      currency: "INR",
      occurred_at: iso(base, 8 * 1440 + 40),
    };
    pushEvent({
      event_type: "FIRST_PAYMENT",
      occurred_at: first_payment.occurred_at,
      attribution_id,
      session_id,
      link_id: link.link_id,
      campaign_id: link.campaign_id,
      partner_id: link.partner_id ?? undefined,
      user_id: user_id ?? undefined,
      tenant_id: tenant_id ?? undefined,
      app: link.app,
      platform: seed.platform,
      channel: link.channel,
      source_system: "BILLING_SERVICE",
      metadata: {
        transaction_id: first_payment.transaction_id,
        amount: first_payment.amount,
        currency: "INR",
        subscription_id: subscription?.subscription_id ?? null,
        commission_calculation: "handled externally",
      },
    });
  }

  const attribution: Attribution = {
    attribution_id,
    partner_id: seed.unattributed ? null : link.partner_id,
    partner_name_snapshot: seed.unattributed ? null : (partner?.name ?? null),
    partner_type_snapshot: seed.unattributed ? null : (partner?.partner_type ?? null),
    campaign_id: link.campaign_id,
    link_id: link.link_id,
    click_id: click.click_id,
    install_id: install?.install_id ?? null,
    session_id,
    user_id,
    signup_id,
    tenant_id,
    tenant_name: tenant_id ? seed.tenant_name : null,
    contact_email: seed.email,
    channel: link.channel,
    app: link.app,
    platform: seed.platform,
    attribution_method: method,
    attribution_source: seed.unattributed
      ? "NONE"
      : method === "CLAIMED"
        ? "REFERRAL_CODE_CLAIM"
        : seed.platform === "ANDROID"
          ? "PLAY_INSTALL_REFERRER"
          : seed.platform === "IOS"
            ? "PROVIDER_DEPENDENT"
            : "PRESERVED_ATTRIBUTION_TOKEN",
    resolution_reason: conflictClick
      ? "Conflict resolved: last eligible deterministic acquisition before install"
      : seed.unattributed
        ? "No reliable acquisition source available"
        : `Eligible acquisition within ${store.rules.click_attribution_window_days}-day click window`,
    resolution_timestamp: iso(base, 11.2),
    attributed_at: seed.unattributed ? null : iso(base, 11.2),
    first_conversion_at: signup_at,
    commercial_conversion_at: first_payment?.occurred_at ?? null,
    status: seed.unattributed ? "UNATTRIBUTED" : "ATTRIBUTED",
    signup_at,
    tenant_created_at,
    activated_at,
    subscription,
    first_payment,
    overrides: [],
  };

  if (seed.overrideTo) {
    const target = store.partners.find((p) => p.partner_id === seed.overrideTo!.partner_id)!;
    attribution.overrides.push({
      from_partner_id: attribution.partner_id,
      from_partner_name: attribution.partner_name_snapshot,
      to_partner_id: target.partner_id,
      to_partner_name: target.name,
      reason: seed.overrideTo.reason,
      actor: seed.overrideTo.actor,
      occurred_at: iso(base, 9 * 1440),
    });
    pushEvent({
      event_type: "ATTRIBUTION_OVERRIDDEN",
      occurred_at: iso(base, 9 * 1440),
      attribution_id,
      session_id,
      link_id: link.link_id,
      campaign_id: link.campaign_id,
      partner_id: target.partner_id,
      tenant_id: tenant_id ?? undefined,
      app: link.app,
      platform: seed.platform,
      channel: link.channel,
      source_system: "ATTRIBUTION_ADMIN",
      metadata: {
        from_partner: attribution.partner_name_snapshot,
        to_partner: target.name,
        reason: seed.overrideTo.reason,
        actor: seed.overrideTo.actor,
        note: "Original event history preserved",
      },
    });
    attribution.partner_id = target.partner_id;
    attribution.partner_name_snapshot = target.name;
    attribution.partner_type_snapshot = target.partner_type;
    attribution.status = "OVERRIDDEN";
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
  if (link.status === "DISABLED") {
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
        note: "Historical attribution remains intact",
      },
    });
  }
}

/* ---- Flagship journey from the brief (Trace showcase) ---- */
const flagship = buildJourney({
  link_id: "LNK-0001",
  start: new Date("2026-09-26T05:01:08.000Z"), // 10:31:08 IST
  platform: "ANDROID",
  tenant_name: "ABC Manufacturing Pvt Ltd",
  email: "accounts@abcmfg.in",
  reach: "PAYMENT",
  price_version_id: "PV-239",
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
  link_id: "LNK-0006",
  start: daysAgo(15, 800),
  platform: "WEB",
  tenant_name: "Lotus Interiors",
  email: "hello@lotusinteriors.in",
  reach: "TENANT_ACTIVATED",
  unattributed: true, // Scenario D: no reliable source
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
  reach: "TENANT_CREATED",
  method: "MATCHED",
});
buildJourney({
  link_id: "LNK-0002",
  start: daysAgo(27, 600),
  platform: "WEB",
  tenant_name: "Geeta Steel Works",
  email: "geeta@geetasteel.in",
  reach: "SUBSCRIPTION",
  method: "CLAIMED",
  claimed_code: "SRISAI104",
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
const activeLinkIds = ["LNK-0001", "LNK-0002", "LNK-0003", "LNK-0004", "LNK-0005", "LNK-0006", "LNK-0008"];
for (let i = 0; i < tenantNames.length; i += 1) {
  const platform: Platform = pick<Platform>(["ANDROID", "ANDROID", "ANDROID", "IOS", "WEB"]);
  const unattributed = rand() < 0.12;
  buildJourney({
    link_id: pick(activeLinkIds),
    start: daysAgo(2 + Math.floor(rand() * 86), 480 + Math.floor(rand() * 480)),
    platform,
    tenant_name: tenantNames[i]!,
    email: `contact@${tenantNames[i]!.toLowerCase().replace(/[^a-z]/g, "")}.in`,
    reach: pick(reaches),
    unattributed,
    method: unattributed ? "UNATTRIBUTED" : rand() < 0.1 ? "CLAIMED" : undefined,
  });
}

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
