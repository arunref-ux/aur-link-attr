import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, MethodBadge, PageHeader, Panel, SourceNote, StatusPill } from "@/components/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AttributionEvent } from "@/domain/types";
import {
  APP_LABEL,
  CHANNEL_LABEL,
  EVENT_LABEL,
  PLATFORM_LABEL,
  formatCurrency,
  formatDayLabel,
  formatTime,
  titleCase,
} from "@/lib/format";
import { attributionProvider, partnerProvider } from "@/providers";

export const Route = createFileRoute("/trace/$attributionId")({
  head: () => ({
    meta: [
      { title: "Attribution trace — Aurumi Link & Attribution" },
      {
        name: "description",
        content:
          "Chronological attribution journey from link click through install, signup, tenant creation, activation and first payment.",
      },
      { property: "og:title", content: "Attribution trace — Aurumi Link & Attribution" },
      {
        property: "og:description",
        content:
          "Readable attribution history with expandable technical detail and raw event payloads.",
      },
    ],
  }),
  component: TraceDetailPage,
});

function TraceDetailPage() {
  const { attributionId } = Route.useParams();
  const [overrideOpen, setOverrideOpen] = useState(false);

  const { data: attribution } = useQuery({
    queryKey: ["attribution", attributionId],
    queryFn: () => attributionProvider.getAttribution(attributionId),
  });
  const { data: events } = useQuery({
    queryKey: ["events", attributionId],
    queryFn: () => attributionProvider.listEvents({ attribution_id: attributionId }),
  });
  const { data: campaigns } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => attributionProvider.listCampaigns(),
  });
  const { data: links } = useQuery({
    queryKey: ["links"],
    queryFn: () => attributionProvider.listLinks(),
  });

  if (!attribution) {
    return (
      <EmptyState title="Attribution record not found" hint="Search Trace for another identifier." />
    );
  }

  const campaign = campaigns?.find((c) => c.campaign_id === attribution.campaign_id);
  const link = links?.find((l) => l.link_id === attribution.link_id);

  let lastDay = "";

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to="/trace"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Trace search
      </Link>
      <PageHeader
        eyebrow="Attribution trace"
        title={attribution.tenant_name ?? attribution.contact_email ?? "Anonymous session"}
        description={attribution.resolution_reason}
        actions={
          <Button variant="outline" onClick={() => setOverrideOpen(true)}>
            <ShieldAlert className="size-4" /> Override attribution
          </Button>
        }
      />

      <Panel>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Field label="Customer" value={attribution.tenant_name ?? "—"} />
          <Field label="Tenant" value={attribution.tenant_id ?? "—"} mono />
          <div>
            <dt className="label-eyebrow">Attribution status</dt>
            <dd className="mt-1.5 flex items-center gap-2">
              <StatusPill status={attribution.status} />
              <MethodBadge method={attribution.attribution_method} />
            </dd>
          </div>
          <Field label="Source partner" value={attribution.partner_name_snapshot ?? "Unattributed"} />
          <Field label="Campaign" value={campaign?.name ?? "—"} />
          <Field label="Channel" value={CHANNEL_LABEL[attribution.channel]} />
          <Field label="Target app" value={APP_LABEL[attribution.app]} />
          <Field label="Platform" value={PLATFORM_LABEL[attribution.platform]} />
          <Field label="Link" value={link?.short_url ?? "—"} mono />
          <Field label="Attribution source" value={titleCase(attribution.attribution_source)} />
          <Field label="Session" value={attribution.session_id} mono />
          <Field label="Attribution ID" value={attribution.attribution_id} mono />
        </dl>
        <SourceNote system="Partner Portal">
          partner snapshot retained for historical readability
        </SourceNote>
      </Panel>

      {attribution.overrides.length > 0 ? (
        <Panel className="mt-6" title="Attribution history" subtitle="Original events are never modified">
          <ol className="space-y-3">
            {attribution.overrides.map((o, i) => (
              <li key={i} className="rounded-md border border-claimed/30 bg-claimed/5 px-4 py-3">
                <p className="text-sm text-foreground">
                  {o.from_partner_name ?? "Unattributed"} → <strong>{o.to_partner_name}</strong>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{o.reason}</p>
                <p className="mono-token mt-1 text-xs text-muted-foreground">
                  {o.actor} · {formatDayLabel(o.occurred_at)} {formatTime(o.occurred_at)}
                </p>
              </li>
            ))}
            <li className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
              Current attribution:{" "}
              <strong className="text-foreground">
                {attribution.partner_name_snapshot ?? "Unattributed"}
              </strong>
            </li>
          </ol>
        </Panel>
      ) : null}

      <Panel
        className="mt-6"
        title="Journey"
        subtitle="Human-readable by default; expand any event for technical detail"
      >
        <ol className="space-y-0">
          {(events ?? []).map((event, index) => {
            const day = formatDayLabel(event.occurred_at);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <li key={event.event_id}>
                {showDay ? <p className="label-eyebrow pt-4 pb-2">{day}</p> : null}
                <EventCard event={event} attributionAmount={attribution.first_payment?.amount} />
                {index < (events ?? []).length - 1 ? (
                  <div className="ml-5 h-4 w-px bg-border" />
                ) : null}
              </li>
            );
          })}
        </ol>
      </Panel>

      <OverrideDialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        attributionId={attribution.attribution_id}
        currentPartner={attribution.partner_name_snapshot}
      />
    </div>
  );
}

function EventCard({
  event,
  attributionAmount,
}: {
  event: AttributionEvent;
  attributionAmount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [raw, setRaw] = useState(false);

  const highlights = humanHighlights(event, attributionAmount);

  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mono-token mt-0.5 shrink-0 text-xs text-muted-foreground">
            {formatTime(event.occurred_at)}
          </span>
          <div>
            <p className="font-display text-sm font-semibold text-foreground">
              {event.event_type}
            </p>
            <p className="text-xs text-muted-foreground">{EVENT_LABEL[event.event_type]}</p>
            {highlights.length > 0 ? (
              <dl className="mt-2.5 grid gap-2 sm:grid-cols-2">
                {highlights.map(([label, value]) => (
                  <div key={label}>
                    <dt className="label-eyebrow">{label}</dt>
                    <dd className="mono-token text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {event.attribution_method ? <MethodBadge method={event.attribution_method} /> : null}
          <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
            <ChevronDown
              className={expanded ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"}
            />
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 border-t border-border pt-3">
          <dl className="grid gap-2 text-xs sm:grid-cols-3">
            {(
              [
                ["event_id", event.event_id],
                ["event_type", event.event_type],
                ["timestamp", event.occurred_at],
                ["source", event.source_system],
                ["click_id", event.click_id],
                ["session_id", event.session_id],
                ["install_id", event.install_id],
                ["user_id", event.user_id],
                ["tenant_id", event.tenant_id],
                ["partner_id", event.partner_id],
                ["campaign_id", event.campaign_id],
                ["attribution_method", event.attribution_method],
                ["app", event.app],
                ["platform", event.platform],
                ["channel", event.channel],
              ] as [string, string | undefined][]
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="label-eyebrow">{k}</dt>
                  <dd className="mono-token break-all text-foreground">{v}</dd>
                </div>
              ))}
          </dl>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setRaw((v) => !v)}>
            {raw ? "Hide raw event" : "View raw event"}
          </Button>
          {raw ? (
            <pre className="mono-token mt-3 overflow-x-auto rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
              {JSON.stringify(event, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function humanHighlights(
  event: AttributionEvent,
  amount?: number,
): [string, string][] {
  const m = event.metadata;
  const rows: [string, string][] = [];
  const add = (label: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "") rows.push([label, String(value)]);
  };

  switch (event.event_type) {
    case "LINK_CREATED":
    case "LINK_SHARED":
    case "LINK_CLICKED":
      add("Link", m["short_url"] ?? (m["token"] ? `go.aurumi.ai/x/${m["token"]}` : undefined));
      add("Platform", PLATFORM_LABEL[event.platform]);
      if (m["duplicate_click"]) add("Note", "Duplicate click — deduplicated");
      break;
    case "STORE_REDIRECTED":
      add("Redirect", m["target"]);
      add("Destination", m["destination"]);
      break;
    case "INSTALL_ATTRIBUTED":
    case "INSTALL_UNATTRIBUTED":
      add("Platform", PLATFORM_LABEL[event.platform]);
      add("Method", m["method_detail"]);
      add("Referrer", m["referrer"]);
      break;
    case "SIGNUP_STARTED":
      add("Claimed code", m["claimed_referral_code"]);
      break;
    case "SIGNUP_COMPLETED":
      add("Email", m["email"]);
      add("Signup", event.signup_id);
      break;
    case "TENANT_CREATED":
      add("Tenant", event.tenant_id);
      add("Name", m["tenant_name"]);
      break;
    case "SUBSCRIPTION_STARTED":
      add("Plan", m["plan_name"] ?? m["plan_id"]);
      add("Price version", m["price_version_id"]);
      break;
    case "FIRST_PAYMENT":
    case "PAYMENT_RECEIVED":
      add("Transaction", m["transaction_id"]);
      add("Value", formatCurrency(Number(m["amount"] ?? amount ?? 0)));
      add("Commission", "handled externally");
      break;
    case "ATTRIBUTION_RESOLVED":
      add("Rule", m["rule"]);
      add("Reason", m["resolution_reason"]);
      break;
    case "ATTRIBUTION_OVERRIDDEN":
      add("From", m["from_partner"] ?? "Unattributed");
      add("To", m["to_partner"]);
      add("Reason", m["reason"]);
      add("Actor", m["actor"]);
      break;
    case "LINK_DISABLED":
      add("Behaviour", m["behavior"]);
      add("Note", m["note"]);
      break;
    default:
      break;
  }
  return rows;
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="label-eyebrow">{label}</dt>
      <dd className={mono ? "mono-token mt-1 text-foreground" : "mt-1 text-sm text-foreground"}>
        {value}
      </dd>
    </div>
  );
}

function OverrideDialog({
  open,
  onOpenChange,
  attributionId,
  currentPartner,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  attributionId: string;
  currentPartner: string | null;
}) {
  const { data: partners } = useQuery({
    queryKey: ["partners"],
    queryFn: () => partnerProvider.searchPartners(),
  });
  const [toPartner, setToPartner] = useState("");
  const [reason, setReason] = useState("");

  async function submit() {
    if (!toPartner || reason.trim().length < 10) {
      toast.error("Choose a partner and give a reason (at least 10 characters)");
      return;
    }
    await attributionProvider.overrideAttribution({
      attribution_id: attributionId,
      to_partner_id: toPartner,
      reason: reason.trim(),
      actor: "you@aurumi.ai",
    });
    toast.success("Attribution overridden", {
      description: "Original event history preserved; ATTRIBUTION_OVERRIDDEN recorded.",
    });
    setReason("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Override attribution</DialogTitle>
          <DialogDescription>
            Current attribution: {currentPartner ?? "Unattributed"}. Nothing is deleted — an
            override event is appended to the audit history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="label-eyebrow">Override to partner</Label>
            <Select value={toPartner} onValueChange={setToPartner}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Select partner" />
              </SelectTrigger>
              <SelectContent>
                {(partners ?? []).map((p) => (
                  <SelectItem key={p.partner_id} value={p.partner_id}>
                    {p.name} · {p.territory}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="label-eyebrow">Reason (required)</Label>
            <Textarea
              className="mt-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why attribution is being reassigned"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Actor recorded: you@aurumi.ai · timestamp recorded automatically
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()}>Record override</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
