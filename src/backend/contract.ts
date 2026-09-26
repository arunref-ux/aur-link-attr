/**
 * Production API contract (/api/v1) — types only.
 *
 * These are the request/response shapes the real Aurumi backend must accept
 * and return. The simulated backend implements them in-process; a future
 * HttpAttributionClient would send exactly these payloads over HTTP.
 */

import type { AppName, AttributionMethod, AttributionStatus, Platform } from "@/domain/types";

export const SCHEMA_VERSION = "1";

export type ApiErrorCode =
  | "INVALID_TOKEN"
  | "LINK_DISABLED"
  | "CAMPAIGN_INACTIVE"
  | "INVALID_EVENT"
  | "DUPLICATE_EVENT"
  | "UNAUTHORIZED_SOURCE"
  | "UNKNOWN_ACQUISITION_TOKEN"
  | "CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "BUSINESS_IDENTITY_CONFLICT"
  | "SIGNUP_BINDING_INVALID"
  | "SIGNUP_BINDING_CONSUMED"
  | "STALE_ATTRIBUTION_STATE"
  | "INTERNAL_ERROR";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

export type ApiResult<T> = { success: true; data: T } | { success: false; error: ApiError };

/** Trusted producers. Each is authoritative for a specific set of facts. */
export type SourceSystem =
  | "REDIRECT_SERVICE"
  | "AURA_ANDROID"
  | "SHOPTALK_ANDROID"
  | "AURUMI_ANDROID"
  | "AURA_IOS"
  | "SHOPTALK_IOS"
  | "AURUMI_IOS"
  | "AURA_WEB"
  | "SHOPTALK_WEB"
  | "AURUMI_WEB"
  | "SIGNUP_SERVICE"
  | "TENANT_SERVICE"
  | "BILLING_SERVICE"
  | "ADMIN_PORTAL";

export function appSourceFor(app: AppName, platform: Platform): SourceSystem {
  return `${app}_${platform}` as SourceSystem;
}

/**
 * Event types accepted by POST /api/v1/attribution/events.
 * Install + first open are NOT submitted here: Android uses the single
 * POST /api/v1/attribution/first-launch request.
 */
export type IngestEventType =
  | "SIGNUP_STARTED"
  | "SIGNUP_COMPLETED"
  | "TENANT_CREATED"
  | "TENANT_ACTIVATED"
  | "SUBSCRIPTION_STARTED"
  | "FIRST_PAYMENT"
  | "PAYMENT_RECEIVED";

export const APP_SOURCES: SourceSystem[] = [
  "AURA_ANDROID",
  "SHOPTALK_ANDROID",
  "AURUMI_ANDROID",
  "AURA_IOS",
  "SHOPTALK_IOS",
  "AURUMI_IOS",
  "AURA_WEB",
  "SHOPTALK_WEB",
  "AURUMI_WEB",
];

/** Source authority: which producer may submit which fact. */
export const SOURCE_AUTHORITY: Record<IngestEventType | "FIRST_LAUNCH", SourceSystem[]> = {
  FIRST_LAUNCH: APP_SOURCES,
  SIGNUP_STARTED: ["SIGNUP_SERVICE"],
  SIGNUP_COMPLETED: ["SIGNUP_SERVICE"],
  TENANT_CREATED: ["TENANT_SERVICE"],
  TENANT_ACTIVATED: ["TENANT_SERVICE"],
  SUBSCRIPTION_STARTED: ["BILLING_SERVICE"],
  FIRST_PAYMENT: ["BILLING_SERVICE"],
  PAYMENT_RECEIVED: ["BILLING_SERVICE"],
};

/** Values never trusted from any caller — always server-resolved. */
export const SERVER_RESOLVED_FIELDS = [
  "partner_id",
  "campaign_id",
  "link_id",
  "attribution_method",
  "resolution_reason",
  "received_at",
  "acquisition_journey_id",
  "acquisition_session_id",
] as const;

/** Commercial values trusted ONLY from BILLING_SERVICE. */
export const BILLING_ONLY_FIELDS = ["amount", "currency", "plan_id", "price_version_id"] as const;

export interface IngestEventRequest {
  source_system: string;
  source_event_id: string;
  event_type: IngestEventType;
  /** Source-reported time. The server adds received_at. */
  occurred_at: string;
  app: AppName;
  platform: Platform;
  /** Opaque token issued at first launch, carried by the app into signup, submitted server-to-server. */
  signup_binding_token?: string | undefined;
  /** Referral code entered at signup — a fact, resolved via the Partner Portal lookup. */
  referral_code?: string | undefined;
  user_id?: string | undefined;
  signup_id?: string | undefined;
  tenant_id?: string | undefined;
  tenant_name?: string | undefined;
  contact_email?: string | undefined;
  subscription_id?: string | undefined;
  transaction_id?: string | undefined;
  plan_id?: string | undefined;
  price_version_id?: string | undefined;
  amount?: number | undefined;
  currency?: "INR" | undefined;
  /* Untrusted values a client might send; the server ignores them. */
  partner_id?: string | undefined;
  campaign_id?: string | undefined;
  link_id?: string | undefined;
  attribution_method?: string | undefined;
  resolution_reason?: string | undefined;
  received_at?: string | undefined;
  acquisition_journey_id?: string | undefined;
  acquisition_session_id?: string | undefined;
  metadata?: Record<string, string | number | boolean | null> | undefined;
}

/** POST /api/v1/attribution/first-launch — sent once by the app after reading the Install Referrer. */
export interface FirstLaunchRequest {
  source_system: string;
  source_event_id: string;
  /** Stable app-installation ID. UNIQUE(app, installation_id). */
  installation_id: string;
  /** Opaque `aur_at` from the Play Install Referrer (or preserved web token), if present. */
  acquisition_token?: string | undefined;
  app: AppName;
  platform: Platform;
  app_version: string;
  occurred_at: string;
  /** Provider-dependent matching hint (simulated iOS deferred matching only). */
  match_hint?: string | undefined;
  /* Untrusted — ignored if present. */
  partner_id?: string | undefined;
  campaign_id?: string | undefined;
  link_id?: string | undefined;
  attribution_method?: string | undefined;
  resolution_reason?: string | undefined;
  received_at?: string | undefined;
  acquisition_journey_id?: string | undefined;
  acquisition_session_id?: string | undefined;
}

export interface FirstLaunchResponse {
  success: true;
  duplicate: boolean;
  outcome: "APPLIED" | "BUSINESS_DUPLICATE";
  acquisition_journey_id: string;
  installation_id: string;
  signup_binding_token: string | null;
  attribution: { status: AttributionStatus; method: AttributionMethod };
  received_at: string;
  ignored_fields: string[];
  warnings: ApiError[];
  /** Simulator display only — not part of the Android response contract. */
  correlation: CorrelationHop[];
}

export interface FirstLaunchOutcome {
  request: FirstLaunchRequest;
  http: HttpExchange<FirstLaunchResponse | { success: false; error: ApiError }>;
  pipeline: PipelineStep[];
  committed: boolean;
}

export interface CorrelationHop {
  label: string;
  value: string;
}

export interface IngestEventResponse {
  accepted: true;
  duplicate: boolean;
  outcome: "APPLIED" | "BUSINESS_DUPLICATE" | "UNRESOLVED";
  event_ids: string[];
  acquisition_journey_id: string | null;
  resolution: {
    resolution_id: string;
    method: AttributionMethod;
    partner_id: string | null;
    partner_name: string | null;
    rules_version: string;
    reason: string;
  } | null;
  received_at: string;
  ignored_fields: string[];
  warnings: ApiError[];
  correlation: CorrelationHop[];
}

export interface PipelineStep {
  stage: string;
  ok: boolean;
  detail: string;
}

export interface HttpExchange<TBody> {
  method: "GET" | "POST" | "PATCH";
  path: string;
  status: number;
  body: TBody;
}

export interface IngestOutcome {
  request: IngestEventRequest;
  http: HttpExchange<ApiResult<IngestEventResponse>>;
  pipeline: PipelineStep[];
  committed: boolean;
}

export interface RedirectOutcome {
  http: { method: "GET"; url: string; status: 302 | 404 };
  pipeline: PipelineStep[];
  location: string;
  /** Install Referrer payload handed to Google Play — never partner identity. */
  referrer: string | null;
  acquisition_journey_id: string | null;
  click_id: string | null;
  acquisition_session_id: string | null;
  acquisition_token: string | null;
  error: ApiError | null;
}

/** Simulated service credential (the authenticated identity of the caller). */
export interface ServiceCredential {
  source_system: string;
}

/** Admin override request — optimistic concurrency via the expected current resolution. */
export interface OverrideRequest {
  attribution_id: string;
  to_partner_id: string;
  reason: string;
  actor: string;
  /** Must equal the journey's current resolution at commit, else 409 STALE_ATTRIBUTION_STATE. */
  expected_current_resolution_id: string | null;
}

/** Deterministic canonical request hash (FNV-1a over sorted-key JSON, excluding server values). */
export function canonicalRequestHash(req: object): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) {
        const val = (v as Record<string, unknown>)[k];
        if (k === "received_at" || val === undefined) continue;
        out[k] = canon(val);
      }
      return out;
    }
    return v;
  };
  const text = JSON.stringify(canon(req));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a:${h.toString(16).padStart(8, "0")}`;
}
