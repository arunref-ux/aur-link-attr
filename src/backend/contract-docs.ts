/**
 * Developer-readable production contract: flow, endpoints, PostgreSQL model,
 * constraints, privacy, readiness and release plan. Documentation data only —
 * nothing here is enforced as DDL or deployed as an endpoint.
 */

export const SYSTEM_FLOW = [
  { node: "Channel", detail: "WhatsApp / Email / QR / Web — partner shares the opaque link" },
  { node: "go.aurumi.ai", detail: "Public short-link domain" },
  {
    node: "Redirect Service",
    detail: "Resolves token, verifies link + campaign, never exposes partner identity",
  },
  {
    node: "Click + Acquisition Session",
    detail: "clicks + acquisition_sessions rows; opaque aur_at token generated",
  },
  { node: "Google Play", detail: "Receives referrer=aur_at=<opaque token>" },
  { node: "Aura / ShopTalk", detail: "Installed Android app" },
  { node: "Android Install Referrer", detail: "App reads aur_at on first launch" },
  {
    node: "Attribution Ingestion API",
    detail: "POST /api/v1/attribution/events — auth, schema, idempotency",
  },
  {
    node: "Resolution Engine",
    detail: "Shared, rules-versioned; the only place attribution is decided",
  },
  { node: "PostgreSQL", detail: "Append-only events, immutable resolutions" },
  { node: "Current Attribution Projection", detail: "current_attribution read model" },
  {
    node: "Signup / Tenant / Conversion Events",
    detail: "Trusted services correlate downstream facts",
  },
];

export type Access = "PUBLIC" | "TRUSTED_SERVICE" | "ADMIN";

export interface EndpointDoc {
  method: string;
  path: string;
  access: Access;
  purpose: string;
  request?: unknown;
  response?: unknown;
  server_generates?: string[];
}

export const ENDPOINTS: EndpointDoc[] = [
  {
    method: "GET",
    path: "https://go.aurumi.ai/x/{token}",
    access: "PUBLIC",
    purpose:
      "Resolve token → verify ACTIVE link + campaign → persist click → create acquisition session → 302 to store with Install Referrer.",
    response: {
      status: 302,
      location:
        "https://play.google.com/store/apps/details?id=ai.aurumi.aura&referrer=aur_at%3D<opaque>",
    },
    server_generates: ["click_id", "acquisition_session_id", "public_acquisition_token (aur_at)"],
  },
  {
    method: "POST",
    path: "/api/v1/attribution/links",
    access: "ADMIN",
    purpose:
      "Create an attribution link. The server — never the client — chooses the public token.",
    request: {
      campaign_id: "CMP-2031",
      partner_id: "P-104",
      channel: "WHATSAPP",
      target_app: "AURA",
      destination: { type: "SIGNUP" },
    },
    response: { link_id: "LNK-…", url: "https://go.aurumi.ai/x/7DX92KQ", status: "ACTIVE" },
    server_generates: ["link_id", "public_token", "created_at"],
  },
  {
    method: "PATCH",
    path: "/api/v1/attribution/links/{id}",
    access: "ADMIN",
    purpose: "Enable / disable a link. Disabling never alters historical attribution.",
    request: { status: "DISABLED", reason: "Creative retired" },
  },
  {
    method: "POST",
    path: "/api/v1/attribution/events",
    access: "TRUSTED_SERVICE",
    purpose:
      "Ingest install / first-open / signup / tenant facts. Idempotent on (source_system, source_event_id).",
    request: {
      source_system: "AURA_ANDROID",
      source_event_id: "evt-device-generated-123",
      event_type: "FIRST_OPEN",
      occurred_at: "2026-09-26T12:31:08Z",
      acquisition_token: "opaque-token",
      install_id: "INS-…",
    },
    response: {
      success: true,
      data: {
        accepted: true,
        duplicate: false,
        event_ids: ["EVT-…"],
        resolution: { method: "DETERMINISTIC", rules_version: "ATTR-RULES-1" },
      },
    },
    server_generates: ["received_at", "event_id", "resolution_id"],
  },
  {
    method: "POST",
    path: "/api/v1/conversions/events",
    access: "TRUSTED_SERVICE",
    purpose:
      "Billing facts (SUBSCRIPTION_STARTED, FIRST_PAYMENT, PAYMENT_RECEIVED). Amounts come from Billing / Price Admin only.",
    request: {
      source_system: "BILLING_SERVICE",
      source_event_id: "bill-evt-…",
      event_type: "FIRST_PAYMENT",
      tenant_id: "T-…",
      subscription_id: "SUB-…",
      transaction_id: "TX-…",
      plan_id: "PL-…",
      price_version_id: "PV-…",
      amount: 2499,
      currency: "INR",
    },
  },
  {
    method: "POST",
    path: "/api/v1/attributions/{id}/override",
    access: "ADMIN",
    purpose:
      "Admin override → immutable override row + ATTRIBUTION_OVERRIDDEN event + new current resolution. Facts are never rewritten.",
    request: {
      to_partner_id: "P-118",
      reason: "Verified reseller agreement",
      actor_id: "ops@aurumi.ai",
    },
  },
];

export const ERROR_CODES: { code: string; http: number; meaning: string }[] = [
  {
    code: "INVALID_TOKEN",
    http: 404,
    meaning: "Unknown link token — safe fallback, nothing persisted",
  },
  {
    code: "LINK_DISABLED",
    http: 302,
    meaning: "Link inactive — no click, no session, safe fallback",
  },
  {
    code: "CAMPAIGN_INACTIVE",
    http: 302,
    meaning: "Campaign paused/ended — no eligible acquisition session",
  },
  { code: "INVALID_EVENT", http: 400, meaning: "Schema validation failed — nothing persisted" },
  {
    code: "DUPLICATE_EVENT",
    http: 200,
    meaning: "Reserved. Retries return success with duplicate = true instead",
  },
  {
    code: "UNAUTHORIZED_SOURCE",
    http: 401,
    meaning: "Caller not authenticated / not authoritative for this fact",
  },
  {
    code: "UNKNOWN_ACQUISITION_TOKEN",
    http: 200,
    meaning: "Warning — fact stored, NOT attributed",
  },
  {
    code: "CONFLICT",
    http: 409,
    meaning: "Business uniqueness conflict that cannot be treated as a retry",
  },
  {
    code: "INTERNAL_ERROR",
    http: 500,
    meaning: "Rolled back; safe to retry with the same source_event_id",
  },
];

export const SOURCE_AUTHORITY_DOC: { source: string; authoritative_for: string }[] = [
  { source: "REDIRECT_SERVICE", authoritative_for: "clicks, acquisition sessions, redirects" },
  {
    source: "AURA_ANDROID / SHOPTALK_ANDROID / AURUMI_ANDROID",
    authoritative_for: "install signal (aur_at), first open",
  },
  { source: "SIGNUP_SERVICE", authoritative_for: "signup started / completed, user_id, signup_id" },
  { source: "TENANT_SERVICE", authoritative_for: "tenant created / activated, tenant_id" },
  {
    source: "BILLING_SERVICE",
    authoritative_for: "subscription, payment, amount, plan & price version references",
  },
  { source: "ADMIN_PORTAL", authoritative_for: "overrides, link status" },
];

export const TRUST = {
  client_submits: [
    "acquisition_token (aur_at)",
    "install_id",
    "source_event_id",
    "event_type",
    "occurred_at (source time)",
  ],
  never_trusted: [
    "partner_id",
    "campaign_id",
    "link_id",
    "attribution_method",
    "resolution_reason",
    "payment amount / price version (unless BILLING_SERVICE)",
    "server timestamps (received_at)",
  ],
  server_resolves: [
    "aur_at → acquisition_session → click → link → campaign → partner",
    "received_at",
    "resolution (method, reason, rules_version)",
  ],
};

export interface TableDoc {
  name: string;
  purpose: string;
  columns: string[];
  constraints?: string[];
}

export const TABLES: TableDoc[] = [
  {
    name: "campaigns",
    purpose: "Acquisition campaigns",
    columns: [
      "id",
      "name",
      "description",
      "status",
      "target_app",
      "start_at",
      "end_at",
      "created_by",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "attribution_links",
    purpose: "Opaque shareable links",
    columns: [
      "id",
      "public_token",
      "campaign_id",
      "partner_id",
      "channel",
      "target_app",
      "destination_type",
      "destination_payload",
      "demo_experience_id",
      "status",
      "created_by",
      "created_at",
      "disabled_at",
    ],
    constraints: ["UNIQUE(public_token)"],
  },
  {
    name: "clicks",
    purpose: "Redirect facts",
    columns: [
      "id",
      "link_id",
      "acquisition_session_id",
      "channel",
      "occurred_at",
      "received_at",
      "user_agent_summary",
      "platform",
    ],
  },
  {
    name: "acquisition_sessions",
    purpose: "Click → install bridge",
    columns: [
      "id",
      "link_id",
      "click_id",
      "public_acquisition_token",
      "platform",
      "started_at",
      "expires_at",
      "status",
    ],
    constraints: ["UNIQUE(public_acquisition_token)"],
  },
  {
    name: "install_signals",
    purpose: "Install Referrer facts",
    columns: [
      "id",
      "acquisition_session_id",
      "app",
      "platform",
      "install_id",
      "referrer_token",
      "source_event_id",
      "occurred_at",
      "received_at",
    ],
    constraints: ["UNIQUE(install_id)"],
  },
  {
    name: "attribution_events",
    purpose: "Append-only facts",
    columns: [
      "id",
      "source_system",
      "source_event_id",
      "event_type",
      "occurred_at",
      "received_at",
      "acquisition_session_id",
      "link_id",
      "campaign_id",
      "partner_id",
      "install_id",
      "user_id",
      "signup_id",
      "tenant_id",
      "subscription_id",
      "transaction_id",
      "app",
      "platform",
      "metadata",
      "schema_version",
    ],
    constraints: ["UNIQUE(source_system, source_event_id)", "append-only"],
  },
  {
    name: "attribution_resolutions",
    purpose: "Immutable engine conclusions",
    columns: [
      "id",
      "subject_type",
      "subject_id",
      "acquisition_session_id",
      "partner_id",
      "campaign_id",
      "link_id",
      "click_id",
      "method",
      "source",
      "reason",
      "rules_version",
      "resolved_at",
      "created_at",
    ],
  },
  {
    name: "current_attribution",
    purpose: "Read-optimized projection",
    columns: [
      "subject_type",
      "subject_id",
      "current_resolution_id",
      "partner_id",
      "campaign_id",
      "method",
      "status",
      "updated_at",
    ],
    constraints: ["PRIMARY KEY(subject_type, subject_id)"],
  },
  {
    name: "attribution_overrides",
    purpose: "Immutable admin overrides",
    columns: [
      "id",
      "subject_type",
      "subject_id",
      "previous_resolution_id",
      "new_partner_id",
      "reason",
      "actor_id",
      "created_at",
    ],
  },
  {
    name: "conversion_events",
    purpose: "Downstream business facts (billing authoritative)",
    columns: [
      "id",
      "source_system",
      "source_event_id",
      "conversion_type",
      "user_id",
      "tenant_id",
      "subscription_id",
      "transaction_id",
      "plan_id",
      "price_version_id",
      "amount",
      "currency",
      "occurred_at",
      "received_at",
      "metadata",
    ],
    constraints: ["UNIQUE(source_system, source_event_id)", "UNIQUE(transaction_id) for payments"],
  },
];

export const RELATIONSHIPS = `campaign
   ↓
attribution_link
   ↓
click
   ↓
acquisition_session
   ↓
install_signal
   ↓
attribution_event
   ↓
attribution_resolution
   ↓
current_attribution
          ↓
    conversion_event`;

export const EXTERNAL_REFERENCES = [
  "Partner",
  "User",
  "Tenant",
  "Subscription",
  "Transaction",
  "Demo Experience",
  "Price Version",
];

export const CONSTRAINTS = [
  "UNIQUE attribution_links.public_token",
  "UNIQUE attribution_events (source_system, source_event_id)",
  "UNIQUE install_signals.install_id",
  "UNIQUE conversion_events.transaction_id (payment conversions)",
  "INDEX tenant_id",
  "INDEX partner_id",
  "INDEX campaign_id",
  "INDEX acquisition_session_id",
  "INDEX occurred_at",
];

export const TRANSACTION_CONTRACT = `BEGIN
  check idempotency (source_system, source_event_id)
  append event
  apply business uniqueness
  run attribution resolution if required
  persist new resolution if required
  update current_attribution projection
COMMIT
-- any failure → ROLLBACK (no partial state)`;

export const PRIVACY = {
  not_persisted: [
    "Raw WhatsApp message",
    "Email message contents",
    "Raw IP address",
    "Contact lists",
    "Device fingerprints",
  ],
  persisted: ["Internal identifiers", "User-agent / platform summary", "Opaque tokens"],
  future: "Production retention policy remains future work.",
};

export type ReadinessStatus = "SIGNED_OFF" | "DEFINED" | "PENDING";

export const READINESS: { section: string; items: { label: string; status: ReadinessStatus }[] }[] =
  [
    {
      section: "Domain",
      items: [
        { label: "Resolution Engine", status: "SIGNED_OFF" },
        { label: "Trace semantics", status: "SIGNED_OFF" },
        { label: "Override semantics", status: "SIGNED_OFF" },
        { label: "Rules versioning", status: "DEFINED" },
      ],
    },
    {
      section: "Backend",
      items: [
        { label: "PostgreSQL schema", status: "PENDING" },
        { label: "Redirect Service", status: "PENDING" },
        { label: "Event API", status: "PENDING" },
        { label: "Transaction handling", status: "PENDING" },
        { label: "Authentication", status: "PENDING" },
      ],
    },
    {
      section: "Android",
      items: [
        { label: "Aura Install Referrer", status: "PENDING" },
        { label: "ShopTalk Install Referrer", status: "PENDING" },
        { label: "First-open submission", status: "PENDING" },
      ],
    },
    {
      section: "Integrations",
      items: [
        { label: "Signup Service", status: "PENDING" },
        { label: "Tenant Service", status: "PENDING" },
        { label: "Billing Service", status: "PENDING" },
        { label: "Partner provider", status: "PENDING" },
      ],
    },
  ];

export const RELEASES = [
  {
    name: "Production 1A — Link Infrastructure",
    scope: [
      "PostgreSQL",
      "Redirect Service",
      "Link management API",
      "Click persistence",
      "Acquisition sessions",
      "Opaque tokens",
      "Idempotent event ingestion",
      "Security / trust boundaries",
    ],
    outcome: "Real reseller links can safely be distributed.",
  },
  {
    name: "Production 1B — Android Attribution",
    scope: [
      "Aura Install Referrer",
      "ShopTalk Install Referrer",
      "First-open ingestion",
      "Install correlation",
      "Resolution Engine backend execution",
      "Signup correlation",
      "Tenant correlation",
    ],
    outcome:
      "WhatsApp → Play Store → Install → Signup → Tenant → Reseller can be proven. Aurumi mobile is not required; it can be added later without contract changes.",
  },
  {
    name: "Production 1C — Commercial Conversion",
    scope: ["Activation", "Subscription", "Payment", "Price Admin references"],
    outcome: "Real attribution followed through commercial conversion. No commission calculation.",
  },
];
