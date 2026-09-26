/**
 * Production API contract (/api/v1) — types only.
 *
 * These are the request/response shapes the real Aurumi backend must accept
 * and return. The simulated backend implements them in-process; a future
 * HttpAttributionClient would send exactly these payloads over HTTP.
 */

import type { AppName, AttributionMethod, Platform } from "@/domain/types";

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
  | "INTERNAL_ERROR";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };

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

/** Event types accepted by POST /api/v1/attribution/events. */
export type IngestEventType =
  | "INSTALL_REFERRER_RECEIVED"
  | "FIRST_OPEN"
  | "SIGNUP_STARTED"
  | "SIGNUP_COMPLETED"
  | "TENANT_CREATED"
  | "TENANT_ACTIVATED"
  | "SUBSCRIPTION_STARTED"
  | "FIRST_PAYMENT"
  | "PAYMENT_RECEIVED";

const APP_SOURCES: SourceSystem[] = [
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
export const SOURCE_AUTHORITY: Record<IngestEventType, SourceSystem[]> = {
  INSTALL_REFERRER_RECEIVED: APP_SOURCES,
  FIRST_OPEN: APP_SOURCES,
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
  /** `aur_at` recovered from the Play Install Referrer (or preserved web token). */
  acquisition_token?: string | undefined;
  acquisition_session_id?: string | undefined;
  install_id?: string | undefined;
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
  /** Provider-dependent matching hint (simulated iOS deferred matching only). */
  match_hint?: string | undefined;
  /* Untrusted values a client might send; the server ignores them. */
  partner_id?: string | undefined;
  campaign_id?: string | undefined;
  link_id?: string | undefined;
  attribution_method?: string | undefined;
  resolution_reason?: string | undefined;
  received_at?: string | undefined;
  metadata?: Record<string, string | number | boolean | null> | undefined;
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
  attribution_id: string | null;
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
  click_id: string | null;
  acquisition_session_id: string | null;
  acquisition_token: string | null;
  error: ApiError | null;
}

/** Simulated service credential (the authenticated identity of the caller). */
export interface ServiceCredential {
  source_system: string;
}
