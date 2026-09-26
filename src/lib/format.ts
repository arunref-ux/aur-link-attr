import type {
  AppName,
  AttributionMethod,
  Channel,
  DestinationType,
  EventType,
  PartnerType,
  Platform,
} from "@/domain/types";

const TZ = "Asia/Kolkata";

export function formatDateTime(isoString: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(new Date(isoString));
}

export function formatDate(isoString: string | null): string {
  if (!isoString) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  }).format(new Date(isoString));
}

export function formatTime(isoString: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(new Date(isoString));
}

export function formatDayLabel(isoString: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  }).format(new Date(isoString));
}

export function formatCurrency(amount: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const APP_LABEL: Record<AppName, string> = {
  AURA: "Aura",
  SHOPTALK: "ShopTalk",
  AURUMI: "Aurumi",
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  SMS: "SMS",
  QR: "QR",
  WEB: "Web",
  SOCIAL: "Social",
  DIRECT_SHARE: "Direct Share",
  OTHER: "Other",
};

export const PLATFORM_LABEL: Record<Platform, string> = {
  ANDROID: "Android",
  IOS: "iOS",
  WEB: "Web",
};

export const METHOD_LABEL: Record<AttributionMethod, string> = {
  DETERMINISTIC: "Deterministic",
  CLAIMED: "Claimed",
  MATCHED: "Matched",
  UNATTRIBUTED: "Unattributed",
};

export const DESTINATION_LABEL: Record<DestinationType, string> = {
  APP_HOME: "App Home",
  SIGNUP: "Signup",
  AURA_CONVERSATION: "Aura Conversation",
  SHOPTALK_HOME: "ShopTalk Home",
  FEATURE: "Feature",
  DEMO_EXPERIENCE: "Demo Experience",
  CUSTOM: "Custom deep link",
};

export const PARTNER_TYPE_LABEL: Record<PartnerType, string> = {
  TALLY_RESELLER: "Tally Reseller",
  ESSL_RESELLER: "eSSL Reseller",
  TECHNOLOGY_PARTNER: "Technology Partner",
  REFERRAL_PARTNER: "Referral Partner",
};

export const EVENT_LABEL: Record<EventType, string> = {
  LINK_CREATED: "Link created",
  LINK_SHARED: "Link shared",
  LINK_CLICKED: "Link clicked",
  STORE_REDIRECTED: "Store redirected",
  INSTALL_ATTRIBUTED: "Install attributed",
  INSTALL_UNATTRIBUTED: "Install unattributed",
  FIRST_OPEN: "First open",
  SIGNUP_STARTED: "Signup started",
  SIGNUP_COMPLETED: "Signup completed",
  TENANT_CREATED: "Tenant created",
  TENANT_ACTIVATED: "Tenant activated",
  SUBSCRIPTION_STARTED: "Subscription started",
  SUBSCRIPTION_CANCELLED: "Subscription cancelled",
  FIRST_PAYMENT: "First payment",
  PAYMENT_RECEIVED: "Payment received",
  ATTRIBUTION_RESOLVED: "Attribution resolved",
  ATTRIBUTION_OVERRIDDEN: "Attribution overridden",
  LINK_DISABLED: "Link disabled",
};

export function methodTone(method: AttributionMethod): string {
  switch (method) {
    case "DETERMINISTIC":
      return "text-deterministic border-deterministic/40 bg-deterministic/10";
    case "CLAIMED":
      return "text-claimed border-claimed/40 bg-claimed/10";
    case "MATCHED":
      return "text-matched border-matched/40 bg-matched/10";
    default:
      return "text-unattributed border-unattributed/40 bg-unattributed/10";
  }
}
