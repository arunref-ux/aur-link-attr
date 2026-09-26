/**
 * Core domain model for Link & Attribution.
 *
 * Attribution records FACTS. It references — but never owns — partner master
 * data (Partner Portal), demo experiences (Demo Studio) and pricing (Price Admin).
 */

export type AppName = "AURA" | "SHOPTALK" | "AURUMI";

export type Channel =
  "WHATSAPP" | "EMAIL" | "SMS" | "QR" | "WEB" | "SOCIAL" | "DIRECT_SHARE" | "OTHER";

export type Platform = "ANDROID" | "IOS" | "WEB";

export type DestinationType =
  | "APP_HOME"
  | "SIGNUP"
  | "AURA_CONVERSATION"
  | "SHOPTALK_HOME"
  | "FEATURE"
  | "DEMO_EXPERIENCE"
  | "CUSTOM";

export type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";

export type LinkStatus = "ACTIVE" | "DISABLED";

export type AttributionMethod = "DETERMINISTIC" | "CLAIMED" | "MATCHED" | "UNATTRIBUTED";

export type AttributionStatus =
  "PENDING" | "ATTRIBUTED" | "UNATTRIBUTED" | "OVERRIDDEN" | "INVALIDATED";

export type EventType =
  | "LINK_CREATED"
  | "LINK_SHARED"
  | "LINK_CLICKED"
  | "STORE_REDIRECTED"
  | "INSTALL_ATTRIBUTED"
  | "INSTALL_UNATTRIBUTED"
  | "FIRST_OPEN"
  | "SIGNUP_STARTED"
  | "SIGNUP_COMPLETED"
  | "TENANT_CREATED"
  | "TENANT_ACTIVATED"
  | "SUBSCRIPTION_STARTED"
  | "SUBSCRIPTION_CANCELLED"
  | "FIRST_PAYMENT"
  | "PAYMENT_RECEIVED"
  | "ATTRIBUTION_RESOLVED"
  | "ATTRIBUTION_OVERRIDDEN"
  | "LINK_DISABLED"
  | "LINK_ENABLED";

/* ---------- External references (read-only in this system) ---------- */

export type PartnerType =
  "TALLY_RESELLER" | "ESSL_RESELLER" | "TECHNOLOGY_PARTNER" | "REFERRAL_PARTNER";

export interface Partner {
  partner_id: string;
  name: string;
  partner_type: PartnerType;
  status: "ACTIVE" | "SUSPENDED";
  territory: string;
  contact_name: string;
  contact_email: string;
  /** Referral code issued by Partner Portal (Partner Portal owns this relationship). */
  referral_code: string;
  source_system: "PARTNER_PORTAL";
}

export interface DemoExperience {
  demo_experience_id: string;
  name: string;
  app: AppName;
  description: string;
  source_system: "DEMO_STUDIO";
}

export interface Plan {
  plan_id: string;
  name: string;
  app: AppName;
  source_system: "PRICE_ADMIN";
}

export interface PriceVersion {
  price_version_id: string;
  plan_id: string;
  amount: number;
  currency: "INR";
  effective_from: string;
  source_system: "PRICE_ADMIN";
}

/* ---------- Owned entities ---------- */

export interface Campaign {
  campaign_id: string;
  name: string;
  description: string;
  status: CampaignStatus;
  start_date: string;
  end_date: string | null;
  target_app: AppName;
  default_destination: DestinationType;
  default_channel: Channel;
  associated_partner_id: string | null;
  demo_experience_id: string | null;
  tags: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AttributionLink {
  link_id: string;
  /** Opaque, immutable public token. Never encodes partner identity. */
  token: string;
  short_url: string;
  campaign_id: string;
  partner_id: string | null;
  partner_name_snapshot: string | null;
  partner_type_snapshot: PartnerType | null;
  channel: Channel;
  app: AppName;
  destination: DestinationType;
  destination_value: string | null;
  demo_experience_id: string | null;
  status: LinkStatus;
  disabled_behavior: "REJECT" | "REDIRECT_FALLBACK";
  metadata: {
    source?: string;
    medium?: string;
    creative?: string;
    placement?: string;
    tags?: string[];
  };
  created_by: string;
  created_at: string;
}

/** What the redirect service resolves server-side from an opaque token. */
export interface AttributionContext {
  token: string;
  link_id: string;
  partner_id: string | null;
  campaign_id: string;
  channel: Channel;
  app: AppName;
  destination: DestinationType;
  demo_experience_id: string | null;
  link_status: LinkStatus;
  /** False when the link is disabled: no new acquisition may originate from it. */
  available_for_acquisition: boolean;
}

export interface Click {
  click_id: string;
  /** Legacy simulation device session. Production correlation uses acquisition_journey_id. */
  session_id: string;
  /** V1.2: owning journey + session (absent on legacy seeded clicks). */
  acquisition_journey_id?: string | undefined;
  acquisition_session_id?: string | undefined;
  received_at?: string | undefined;
  link_id: string;
  token: string;
  campaign_id: string;
  partner_id: string | null;
  channel: Channel;
  app: AppName;
  platform: Platform;
  user_agent: string;
  occurred_at: string;
  redirect_target: string;
}

export interface Install {
  /** installation_id — UNIQUE(app, installation_id). */
  install_id: string;
  acquisition_journey_id?: string | undefined;
  click_id: string | null;
  session_id: string;
  app: AppName;
  platform: Platform;
  attribution_method: AttributionMethod;
  attribution_source: string;
  referrer_recovered: boolean;
  occurred_at: string;
}

export interface AttributionEvent {
  event_id: string;
  /** Identifier assigned by the producing system (idempotency key from the source). */
  source_event_id: string;
  event_type: EventType;
  /** When the source says the event happened. */
  occurred_at: string;
  /** When Aurumi received / recorded the event. */
  received_at: string;
  attribution_id?: string | undefined;
  click_id?: string | undefined;
  session_id?: string | undefined;
  install_id?: string | undefined;
  link_id?: string | undefined;
  campaign_id?: string | undefined;
  partner_id?: string | undefined;
  user_id?: string | undefined;
  tenant_id?: string | undefined;
  signup_id?: string | undefined;
  app: AppName;
  platform: Platform;
  channel?: Channel | undefined;
  attribution_method?: AttributionMethod | undefined;
  source_system: string;
  metadata: Record<string, string | number | boolean | null>;
  /** Contract schema version of the stored fact. */
  schema_version?: string | undefined;
}

export interface Attribution {
  /** For V1.2 journeys this equals acquisition_journey_id (read model keyed by the journey). */
  attribution_id: string;
  /** Null on legacy seeded journeys that predate the V1.2 journey lifecycle. */
  acquisition_journey_id?: string | null | undefined;
  partner_id: string | null;
  partner_name_snapshot: string | null;
  partner_type_snapshot: PartnerType | null;
  campaign_id: string | null;
  link_id: string | null;
  click_id: string | null;
  install_id: string | null;
  session_id: string;
  user_id: string | null;
  signup_id: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  contact_email: string | null;
  /** Null when the journey began without an acquisition link. */
  channel: Channel | null;
  app: AppName;
  platform: Platform;
  attribution_method: AttributionMethod;
  attribution_source: string;
  resolution_reason: string;
  resolution_timestamp: string;
  attributed_at: string | null;
  first_conversion_at: string | null;
  commercial_conversion_at: string | null;
  status: AttributionStatus;
  signup_at: string | null;
  tenant_created_at: string | null;
  activated_at: string | null;
  subscription: {
    subscription_id: string;
    plan_id: string;
    price_version_id: string;
    started_at: string;
  } | null;
  first_payment: {
    transaction_id: string;
    amount: number;
    currency: "INR";
    occurred_at: string;
  } | null;
  overrides: AttributionOverride[];
  /** Rules version of the resolution currently projected onto this record. */
  rules_version?: string | undefined;
  current_resolution_id?: string | undefined;
}

export interface AttributionOverride {
  override_id?: string | undefined;
  previous_resolution_id?: string | null | undefined;
  from_partner_id: string | null;
  from_partner_name: string | null;
  to_partner_id: string;
  to_partner_name: string;
  reason: string;
  actor: string;
  occurred_at: string;
}

export interface AttributionRulesConfig {
  click_attribution_window_days: number;
  install_to_signup_window_days: number;
  conflict_rule: "LAST_ELIGIBLE_DETERMINISTIC" | "FIRST_ELIGIBLE_DETERMINISTIC";
  deterministic_precedence_over_claimed: boolean;
  duplicate_conversion_handling: "ONE_PER_TENANT" | "ALLOW_MULTIPLE";
  unattributed_behavior: "RECORD_UNATTRIBUTED" | "ASSIGN_HOUSE";
  disabled_link_behavior: "REJECT" | "REDIRECT_FALLBACK";
}

export interface ProviderDescriptor {
  provider_id: string;
  name: string;
  type: "NATIVE" | "EXTERNAL_MMP";
  status: "ACTIVE_SIMULATED" | "NOT_CONFIGURED" | "PLANNED";
  capabilities: string[];
  configurable: boolean;
  note: string;
}

export interface DomainDescriptor {
  domain: string;
  status: "SIMULATED_NOT_CONNECTED";
  dns_status: string;
  android_app_link: string;
  apple_universal_link: string;
}

export type FunnelStage =
  "CLICKS" | "INSTALLS" | "FIRST_OPENS" | "SIGNUPS" | "TENANTS" | "ACTIVATED" | "PAID";

/* ---------- Production contract persistence (simulated PostgreSQL rows) ---------- */

/** acquisition_sessions — created by the Redirect Service for every eligible click. */
export interface AcquisitionSession {
  acquisition_session_id: string;
  acquisition_journey_id: string;
  link_id: string;
  /** Opaque, server-generated. Travels as `aur_at` in the Play Install Referrer. */
  public_acquisition_token: string;
  platform: Platform;
  started_at: string;
  expires_at: string;
  status: "OPEN" | "INSTALLED" | "EXPIRED";
  /** Legacy simulation metadata only (simulated iOS matching). NOT a production correlation key. */
  device_session_id: string;
}

export type JourneyOriginType =
  "ATTRIBUTION_LINK" | "DIRECT_FIRST_LAUNCH" | "CLAIMED" | "MATCHED" | "OTHER";

/** acquisition_journeys — the canonical attribution subject. Exists independently of attribution success. */
export interface AcquisitionJourney {
  acquisition_journey_id: string;
  origin_type: JourneyOriginType;
  created_at: string;
  updated_at: string;
  first_acquisition_session_id: string | null;
  install_id: string | null;
  user_id: string | null;
  signup_id: string | null;
  tenant_id: string | null;
  app: AppName;
  status: "OPEN" | "INSTALLED" | "SIGNED_UP" | "TENANT";
  /** Technical metadata recorded at first launch. */
  acquisition_token_status: "NOT_APPLICABLE" | "VALID" | "ABSENT" | "UNKNOWN";
  /** Normalized referral claims (from the Partner Portal lookup) attached at signup. */
  claims: { partner_id: string; code: string; occurred_at: string }[];
}

/** signup_bindings — opaque server-issued handoff from installation to signup. */
export interface SignupBinding {
  signup_binding_id: string;
  public_token: string;
  acquisition_journey_id: string;
  installation_id: string;
  status: "ISSUED" | "CONSUMED" | "EXPIRED" | "REVOKED";
  expires_at: string;
  created_at: string;
  consumed_at: string | null;
  /** The one canonical signup this binding may attach. */
  bound_signup_id: string | null;
}

/** attribution_resolutions — what the engine concluded at a point in time. Immutable. */
export interface AttributionResolution {
  resolution_id: string;
  acquisition_journey_id: string;
  acquisition_session_id: string | null;
  partner_id: string | null;
  campaign_id: string | null;
  link_id: string | null;
  click_id: string | null;
  method: AttributionMethod;
  source: string;
  reason: string;
  status: AttributionStatus;
  kind: "ENGINE" | "OVERRIDE";
  rules_version: string;
  resolved_at: string;
  created_at: string;
}

/** current_attribution — read-optimized projection; may change after an override. */
export interface CurrentAttributionProjection {
  acquisition_journey_id: string;
  current_resolution_id: string;
  partner_id: string | null;
  campaign_id: string | null;
  method: AttributionMethod;
  status: AttributionStatus;
  updated_at: string;
}

export type ConversionType =
  | "SIGNUP_COMPLETED"
  | "TENANT_CREATED"
  | "TENANT_ACTIVATED"
  | "SUBSCRIPTION_STARTED"
  | "FIRST_PAYMENT"
  | "PAYMENT_RECEIVED";

/** conversion_events — downstream business facts; billing stays authoritative. */
export interface ConversionEvent {
  conversion_event_id: string;
  source_system: string;
  source_event_id: string;
  conversion_type: ConversionType;
  user_id: string | null;
  tenant_id: string | null;
  subscription_id: string | null;
  transaction_id: string | null;
  plan_id: string | null;
  price_version_id: string | null;
  amount: number | null;
  currency: "INR" | null;
  occurred_at: string;
  received_at: string;
  metadata: Record<string, string | number | boolean | null>;
}

/** idempotency_records — UNIQUE(source_system, source_event_id), claimed inside the transaction. */
export interface IdempotencyRecord {
  source_system: string;
  source_event_id: string;
  /** Deterministic hash of the canonical business request (excludes server values). */
  request_hash: string;
  status: "IN_PROGRESS" | "COMPLETED";
  response_code: number | null;
  /** Stored original response, replayed on exact retries. */
  response_body: unknown;
  created_at: string;
  completed_at: string | null;
}
