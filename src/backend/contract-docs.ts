/**
 * Developer-readable production contract: flow, endpoints, PostgreSQL model,
 * constraints, privacy, readiness and release plan. Documentation data only —
 * nothing here is enforced as DDL or deployed as an endpoint.
 */

export const SYSTEM_FLOW = [
  { node: "Reseller link", detail: "Partner shares the opaque go.aurumi.ai/x/{token} link" },
  { node: "Redirect", detail: "Validates link + campaign at request time" },
  { node: "AcquisitionJourney created", detail: "Canonical subject — exists before install" },
  { node: "AcquisitionSession", detail: "Owned by the journey; holds opaque aur_at" },
  { node: "Click", detail: "Owned by the session (no sessions.click_id)" },
  { node: "Google Play", detail: "referrer=aur_at=<opaque token> — never partner identity" },
  { node: "Android first launch", detail: "POST /api/v1/attribution/first-launch (once)" },
  {
    node: "INSTALL_SIGNAL + FIRST_OPEN",
    detail: "Two facts, one transaction, same journey + installation",
  },
  { node: "Resolution", detail: "Shared, rules-versioned engine → current_attribution" },
  {
    node: "signup_binding_token",
    detail: "Opaque handoff issued at first launch, carried by the app",
  },
  {
    node: "Trusted Signup Service",
    detail: "Submits the token server-to-server → signup/user on journey",
  },
  {
    node: "Trusted Tenant Service",
    detail: "Correlates by signup/user identity → tenant on journey",
  },
  { node: "Billing", detail: "Subscription / payment correlated by tenant_id" },
];

/** Direct answers required by the V1.2 contract closure. */
export const CONTRACT_FAQ: { q: string; a: string }[] = [
  {
    q: "What is the canonical attribution subject?",
    a: "AcquisitionJourney (acquisition_journey_id)",
  },
  { q: "When is it created?", a: "Aurumi link: at redirect. Direct install: at first launch." },
  {
    q: "How does Android identify the acquisition?",
    a: "Opaque aur_at acquisition token from the Play Install Referrer",
  },
  {
    q: "How does signup inherit it?",
    a: "Opaque signup_binding_token, submitted by the Signup Service",
  },
  { q: "How does tenant inherit it?", a: "Trusted signup/user correlation by the Tenant Service" },
  { q: "How are retries handled?", a: "Atomic idempotency record + canonical request fingerprint" },
  {
    q: "What if the same key carries different data?",
    a: "409 CONFLICT — IDEMPOTENCY_KEY_REUSED, no mutation",
  },
  {
    q: "How are concurrent projection updates handled?",
    a: "Serialized per AcquisitionJourney (row lock on journey / current_attribution)",
  },
];

/** Production architecture vs simulation implementation detail. */
export const IMPLEMENTATION_NOTE = {
  production: [
    "Aurumi backend + PostgreSQL implements the tables, constraints and transactions on this page",
    "Aura / ShopTalk Android clients implement first launch and carry signup_binding_token",
    "Signup, Tenant and Billing services call the API server-to-server",
  ],
  simulation_only: [
    "In-memory store, provider objects and the console's Attribution read model",
    "device_session_id (legacy simulated iOS matching metadata)",
    "Legacy seeded sample journeys without acquisition_journeys rows",
    "PV-262 / ₹6,999 — mock Price Admin data",
  ],
};

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
    server_generates: [
      "acquisition_journey_id",
      "acquisition_session_id",
      "click_id",
      "public_acquisition_token (aur_at)",
    ],
  },
  {
    method: "POST",
    path: "/api/v1/attribution/first-launch",
    access: "TRUSTED_SERVICE",
    purpose:
      "Called once by the Android app after reading the Install Referrer. Locates the journey from aur_at (or creates a DIRECT_FIRST_LAUNCH journey), persists INSTALL_SIGNAL + FIRST_OPEN, resolves, and issues a signup_binding_token. Unknown tokens never fabricate attribution (acquisition_token_status = UNKNOWN).",
    request: {
      source_system: "AURA_ANDROID",
      source_event_id: "stable-first-launch-event-id",
      installation_id: "stable-app-installation-id",
      acquisition_token: "opaque-aur-at-if-present",
      app: "AURA",
      platform: "ANDROID",
      app_version: "1.4.0",
      occurred_at: "2026-09-26T12:31:08Z",
    },
    response: {
      success: true,
      duplicate: false,
      acquisition_journey_id: "AJ-…",
      installation_id: "stable-app-installation-id",
      signup_binding_token: "sbt_<opaque>",
      attribution: { status: "ATTRIBUTED", method: "DETERMINISTIC" },
    },
    server_generates: [
      "acquisition_journey_id (direct)",
      "resolution_id",
      "signup_binding_token",
      "received_at",
    ],
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
      "Signup / tenant facts from trusted services. Signup carries the signup_binding_token (and optional referral_code); tenant correlates by user_id / signup_id. Never accepts acquisition_journey_id or acquisition_session_id from callers.",
    request: {
      source_system: "SIGNUP_SERVICE",
      source_event_id: "sgn-evt-123",
      event_type: "SIGNUP_COMPLETED",
      occurred_at: "2026-09-26T12:40:00Z",
      signup_id: "SGN-…",
      user_id: "U-…",
      signup_binding_token: "sbt_<opaque>",
      referral_code: "optional",
    },
    response: {
      success: true,
      data: {
        accepted: true,
        duplicate: false,
        event_ids: ["EVT-…"],
        acquisition_journey_id: "AJ-…",
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
      "Admin override → lock journey / current_attribution → compare expected_current_resolution_id → immutable override row + ATTRIBUTION_OVERRIDDEN event + new current resolution. Mismatch → 409 STALE_ATTRIBUTION_STATE.",
    request: {
      expected_current_resolution_id: "RES-…",
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
    code: "IDEMPOTENCY_KEY_REUSED",
    http: 409,
    meaning: "Same key, different request fingerprint — no mutation",
  },
  {
    code: "IDEMPOTENCY_IN_PROGRESS",
    http: 409,
    meaning: "Identical request still processing — retry; no mutation",
  },
  {
    code: "BUSINESS_IDENTITY_CONFLICT",
    http: 409,
    meaning: "Business ID already bound to a different journey",
  },
  {
    code: "SIGNUP_BINDING_INVALID",
    http: 422,
    meaning: "Unknown / expired / revoked binding — no association",
  },
  {
    code: "SIGNUP_BINDING_CONSUMED",
    http: 409,
    meaning: "Binding already attached to a different signup",
  },
  {
    code: "STALE_ATTRIBUTION_STATE",
    http: 409,
    meaning: "Override expected a different current resolution — refresh",
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
    authoritative_for: "first launch (installation_id, aur_at) → INSTALL_SIGNAL + FIRST_OPEN",
  },
  {
    source: "SIGNUP_SERVICE",
    authoritative_for:
      "signup started / completed, user_id, signup_id, referral_code, submits signup_binding_token",
  },
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
    "installation_id",
    "signup_binding_token (transported, opaque)",
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
    "acquisition_journey_id / acquisition_session_id (never accepted from callers)",
  ],
  server_resolves: [
    "aur_at → acquisition_session → acquisition_journey → clicks → link → campaign → partner",
    "signup_binding_token → installation → acquisition_journey",
    "user_id / signup_id → acquisition_journey (tenant)",
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
    name: "acquisition_journeys",
    purpose: "Canonical attribution subject (exists whether or not attribution succeeds)",
    columns: [
      "id",
      "origin_type (ATTRIBUTION_LINK | DIRECT_FIRST_LAUNCH | CLAIMED | MATCHED | OTHER)",
      "first_acquisition_session_id",
      "install_id",
      "user_id",
      "signup_id",
      "tenant_id",
      "acquisition_token_status",
      "status",
      "created_at",
      "updated_at",
    ],
    constraints: ["PRIMARY KEY(id)", "row lock serializes current_attribution updates"],
  },
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
    name: "acquisition_sessions",
    purpose: "Journey-owned acquisition bridge (no click_id column)",
    columns: [
      "id",
      "acquisition_journey_id",
      "link_id",
      "public_acquisition_token",
      "platform",
      "started_at",
      "expires_at",
      "status",
    ],
    constraints: ["UNIQUE(public_acquisition_token)"],
  },
  {
    name: "clicks",
    purpose: "Redirect facts, owned by a session",
    columns: [
      "id",
      "acquisition_journey_id",
      "acquisition_session_id",
      "link_id",
      "channel",
      "occurred_at",
      "received_at",
      "user_agent_summary",
      "platform",
    ],
  },
  {
    name: "install_signals",
    purpose: "INSTALL_SIGNAL facts from first launch",
    columns: [
      "id",
      "acquisition_journey_id",
      "acquisition_session_id",
      "app",
      "platform",
      "installation_id",
      "acquisition_token_status",
      "source_event_id",
      "occurred_at",
      "received_at",
    ],
    constraints: ["UNIQUE(app, installation_id)"],
  },
  {
    name: "signup_bindings",
    purpose: "Opaque installation → journey handoff for signup",
    columns: [
      "id",
      "public_token",
      "acquisition_journey_id",
      "installation_id",
      "status",
      "bound_signup_id",
      "expires_at",
      "created_at",
      "consumed_at",
    ],
    constraints: ["UNIQUE(public_token)", "binds at most one canonical signup"],
  },
  {
    name: "idempotency_records",
    purpose: "Atomic transport idempotency with request fingerprint",
    columns: [
      "source_system",
      "source_event_id",
      "request_hash",
      "status (IN_PROGRESS | COMPLETED)",
      "response_code",
      "response_body",
      "created_at",
      "completed_at",
    ],
    constraints: [
      "UNIQUE(source_system, source_event_id)",
      "claimed inside the business transaction",
    ],
  },
  {
    name: "attribution_events",
    purpose: "Append-only facts",
    columns: [
      "id",
      "acquisition_journey_id",
      "source_system",
      "source_event_id",
      "event_type",
      "occurred_at",
      "received_at",
      "acquisition_session_id",
      "installation_id",
      "link_id",
      "campaign_id",
      "partner_id",
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
      "acquisition_journey_id",
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
    purpose: "Read-optimized projection (0..1 per journey)",
    columns: [
      "acquisition_journey_id",
      "current_resolution_id",
      "partner_id",
      "campaign_id",
      "method",
      "status",
      "updated_at",
    ],
    constraints: ["PRIMARY KEY(acquisition_journey_id)", "SELECT … FOR UPDATE on every update"],
  },
  {
    name: "attribution_overrides",
    purpose: "Immutable admin overrides",
    columns: [
      "id",
      "acquisition_journey_id",
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
      "acquisition_journey_id",
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
    constraints: ["UNIQUE(source_system, source_event_id)"],
  },
];

export const RELATIONSHIPS = `acquisition_journey (1)
 ├── acquisition_sessions (many)
 │     └── clicks (many)
 ├── install_signals
 ├── signup_bindings
 ├── attribution_events (many)
 ├── attribution_resolutions (many)
 ├── attribution_overrides (many)
 ├── conversion_events (many)
 └── current_attribution (0..1)`;

export const FOREIGN_KEYS = [
  "acquisition_sessions.acquisition_journey_id → acquisition_journeys.id",
  "clicks.acquisition_journey_id → acquisition_journeys.id",
  "clicks.acquisition_session_id → acquisition_sessions.id",
  "install_signals.acquisition_journey_id → acquisition_journeys.id",
  "attribution_events.acquisition_journey_id → acquisition_journeys.id",
  "attribution_resolutions.acquisition_journey_id → acquisition_journeys.id",
  "current_attribution.acquisition_journey_id → acquisition_journeys.id",
  "attribution_overrides.acquisition_journey_id → acquisition_journeys.id",
  "signup_bindings.acquisition_journey_id → acquisition_journeys.id",
  "-- References only (other services own them): partner_id, user_id, signup_id, tenant_id, subscription_id, transaction_id, plan_id, price_version_id",
];

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
  "-- Transport idempotency",
  "UNIQUE idempotency_records (source_system, source_event_id)",
  "UNIQUE attribution_events (source_system, source_event_id)",
  "-- Business identity (separate from transport keys)",
  "UNIQUE install_signals (app, installation_id)",
  "UNIQUE journeys signup: (SIGNUP_SERVICE, signup_id)  -- signup IDs scoped to the signup source",
  "UNIQUE acquisition_journeys.tenant_id",
  "UNIQUE subscription_id  (BILLING_SERVICE scope)",
  "UNIQUE transaction_id   (BILLING_SERVICE scope)",
  "-- Tokens",
  "UNIQUE attribution_links.public_token",
  "UNIQUE acquisition_sessions.public_acquisition_token",
  "UNIQUE signup_bindings.public_token",
  "-- Indexes",
  "INDEX acquisition_journey_id, tenant_id, partner_id, campaign_id, occurred_at",
  "-- Business duplicates: new source event for an existing canonical outcome",
  "   → accepted, no second outcome; projection stays singular",
];

export const TRANSACTIONS: { name: string; body: string }[] = [
  {
    name: "Redirect",
    body: `BEGIN
  validate link / campaign (at request time)
  create AcquisitionJourney
  create AcquisitionSession
  create Click
  generate / store acquisition token
COMMIT → 302
-- failure → ROLLBACK: no orphan journey, click or session`,
  },
  {
    name: "First launch",
    body: `BEGIN
  INSERT idempotency_record (atomic claim)
    conflict: hash differs → 409 IDEMPOTENCY_KEY_REUSED
              same hash, completed → replay (duplicate = true)
              same hash, in progress → 409 IDEMPOTENCY_IN_PROGRESS
  resolve acquisition token
  locate or create AcquisitionJourney
  enforce UNIQUE(app, installation_id)
  persist INSTALL_SIGNAL
  persist FIRST_OPEN
  lock journey → run Resolution Engine → persist resolution
  update current_attribution
  create signup binding
  store idempotent response
COMMIT`,
  },
  {
    name: "Signup",
    body: `BEGIN
  claim idempotency key + verify fingerprint
  validate signup_binding_token
  enforce signup uniqueness
  persist SIGNUP_COMPLETED
  associate signup / user with AcquisitionJourney
  apply referral claim if present (Partner Portal lookup)
  lock journey → run Resolution Engine if appropriate
  update current_attribution
  consume / bind signup token
  store idempotent response
COMMIT`,
  },
  {
    name: "Tenant",
    body: `BEGIN
  claim idempotency key + verify fingerprint
  enforce UNIQUE(tenant_id)
  resolve trusted signup / user association → journey
  persist TENANT_CREATED
  associate tenant with AcquisitionJourney
  store response
COMMIT`,
  },
  {
    name: "Override",
    body: `BEGIN
  SELECT … FROM current_attribution WHERE journey = $1 FOR UPDATE
  if current_resolution_id ≠ expected → 409 STALE_ATTRIBUTION_STATE
  insert attribution_overrides
  insert OVERRIDE resolution; update current_attribution
COMMIT`,
  },
];

export const CONCURRENCY = [
  "Updates affecting current attribution for the same AcquisitionJourney serialize (row lock on journey / current_attribution; optimistic versioning is an acceptable equivalent).",
  "Concurrent identical requests: only one holds the idempotency claim and mutates; the other resolves through the idempotency record.",
  "Concurrent legitimate signals: both immutable events are kept; projection = deterministic application of event chronology + configured rules + rules version. No last-write-wins.",
  "Canonical request hash: deterministic hash of the canonicalized business payload (sorted keys), excluding server values such as received_at.",
];

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
      section: "Contract (V1.2 — represented and tested)",
      items: [
        { label: "AcquisitionJourney lifecycle defined", status: "DEFINED" },
        { label: "Redirect creates journey", status: "DEFINED" },
        { label: "Direct first launch creates journey", status: "DEFINED" },
        { label: "Single first-launch API defined", status: "DEFINED" },
        { label: "Signup binding defined", status: "DEFINED" },
        { label: "Tenant correlation defined", status: "DEFINED" },
        { label: "Request fingerprint defined", status: "DEFINED" },
        { label: "Idempotency conflict defined", status: "DEFINED" },
        { label: "Business uniqueness defined", status: "DEFINED" },
        { label: "Concurrency semantics defined", status: "DEFINED" },
      ],
    },
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
        { label: "First-launch submission", status: "PENDING" },
        { label: "signup_binding_token transport", status: "PENDING" },
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
      "First-launch API",
      "Signup bindings",
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
