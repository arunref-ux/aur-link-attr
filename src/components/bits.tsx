import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import type { AttributionMethod, AttributionStatus, CampaignStatus } from "@/domain/types";
import { METHOD_LABEL, formatPercent, methodTone, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div>
        <p className="label-eyebrow">{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel", className)}>
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="panel px-4 py-4">
      <p className="label-eyebrow">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function MethodBadge({ method }: { method: AttributionMethod }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        methodTone(method),
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {METHOD_LABEL[method]}
    </span>
  );
}

export function StatusPill({
  status,
}: {
  status: AttributionStatus | CampaignStatus | "ACTIVE" | "DISABLED";
}) {
  const tone =
    status === "ATTRIBUTED" || status === "ACTIVE"
      ? "text-deterministic border-deterministic/40 bg-deterministic/10"
      : status === "OVERRIDDEN" || status === "PAUSED"
        ? "text-claimed border-claimed/40 bg-claimed/10"
        : status === "INVALIDATED" || status === "DISABLED"
          ? "text-destructive border-destructive/40 bg-destructive/10"
          : "text-muted-foreground border-border bg-muted/40";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tone,
      )}
    >
      {titleCase(status)}
    </span>
  );
}

/** Makes external ownership explicit everywhere referenced data appears. */
export function SourceNote({ system, children }: { system: string; children?: ReactNode }) {
  return (
    <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
      <ExternalLink className="size-3" />
      <span>
        Source: <span className="text-foreground">{system}</span>
        {children ? <> — {children}</> : null}
      </span>
    </p>
  );
}

export function FunnelBars({
  rows,
}: {
  rows: { stage: string; count: number; from_previous: number; from_click: number }[];
}) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ol className="space-y-2.5">
      {rows.map((row, i) => (
        <li key={row.stage}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium text-foreground">{row.stage}</span>
            <span className="mono-token text-muted-foreground">
              {row.count.toLocaleString("en-IN")}
              {i > 0 ? (
                <>
                  {" · "}
                  <span className="text-foreground">{formatPercent(row.from_previous)}</span> from
                  prev
                  {" · "}
                  {formatPercent(row.from_click)} of clicks
                </>
              ) : null}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/80"
              style={{ width: `${Math.max((row.count / max) * 100, 1.5)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

export function BreakdownTable({
  rows,
  keyLabel,
}: {
  rows: {
    key: string;
    label: string;
    clicks: number;
    installs: number;
    signups: number;
    tenants: number;
    paid: number;
    attribution_rate: number;
  }[];
  keyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity in this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="label-eyebrow pb-2 font-normal">{keyLabel}</th>
            <th className="label-eyebrow pb-2 text-right font-normal">Clicks</th>
            <th className="label-eyebrow pb-2 text-right font-normal">Installs</th>
            <th className="label-eyebrow pb-2 text-right font-normal">Signups</th>
            <th className="label-eyebrow pb-2 text-right font-normal">Tenants</th>
            <th className="label-eyebrow pb-2 text-right font-normal">Paid</th>
            <th className="label-eyebrow pb-2 text-right font-normal">Attr. rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/60 last:border-0">
              <td className="py-2.5 pr-3 text-foreground">{row.label}</td>
              <td className="mono-token py-2.5 text-right">{row.clicks}</td>
              <td className="mono-token py-2.5 text-right">{row.installs}</td>
              <td className="mono-token py-2.5 text-right">{row.signups}</td>
              <td className="mono-token py-2.5 text-right">{row.tenants}</td>
              <td className="mono-token py-2.5 text-right text-primary">{row.paid}</td>
              <td className="mono-token py-2.5 text-right">{formatPercent(row.attribution_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TraceLink({ attributionId, label }: { attributionId: string; label?: string }) {
  return (
    <Link
      to="/trace/$attributionId"
      params={{ attributionId }}
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {label ?? "Open trace"}
      <ArrowUpRight className="size-3.5" />
    </Link>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
