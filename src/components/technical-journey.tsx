import { CheckCircle2, ChevronDown, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { TechnicalEntry } from "@/providers";

export function TechnicalJourney({
  entries,
  canRetry,
  busy,
  failNext,
  onFailNextChange,
  onRetry,
}: {
  entries: TechnicalEntry[];
  canRetry: boolean;
  busy: boolean;
  failNext: boolean;
  onFailNextChange: (v: boolean) => void;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Switch id="fail-next" checked={failNext} onCheckedChange={onFailNextChange} />
          <Label htmlFor="fail-next" className="text-sm">
            Fail next event before commit
          </Label>
        </div>
        <Button size="sm" variant="outline" disabled={!canRetry || busy} onClick={onRetry}>
          <RotateCcw className="size-4" /> Retry last event
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Run a step to see the exact request, backend pipeline and response.
        </p>
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => (
            <EntryCard key={e.id} entry={e} />
          ))}
        </ol>
      )}
    </div>
  );
}

function EntryCard({ entry }: { entry: TechnicalEntry }) {
  const [open, setOpen] = useState(false);
  const ok = entry.status < 400;
  const changed = (Object.keys(entry.counts_after) as (keyof TechnicalEntry["counts_after"])[])
    .map((k) => [k, entry.counts_after[k] - entry.counts_before[k]] as const)
    .filter(([, d]) => d !== 0);
  const body = entry.response as { data?: { duplicate?: boolean } } | null;
  const duplicate = body?.data?.duplicate === true;

  return (
    <li className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div>
          <p className="label-eyebrow">{entry.actor}</p>
          <p className="mt-1 text-sm font-medium text-foreground">{entry.title}</p>
          <p className="mono-token mt-1 text-xs text-muted-foreground">{entry.request_line}</p>
        </div>
        <span
          className={
            ok
              ? "mono-token rounded border border-deterministic/40 bg-deterministic/10 px-2 py-0.5 text-xs text-deterministic"
              : "mono-token rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
          }
        >
          {entry.status}
          {duplicate ? " · duplicate = true" : ""}
        </span>
      </div>

      {entry.handoff?.length ? (
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {entry.handoff.map((h) => (
            <p key={h}>↳ {h}</p>
          ))}
        </div>
      ) : null}
      <ul className="space-y-1 border-t border-border px-4 py-3">
        {entry.pipeline.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            {p.ok ? (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-deterministic" />
            ) : (
              <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            )}
            <span className="text-foreground">{p.stage}</span>
            <span className="mono-token text-muted-foreground">{p.detail}</span>
          </li>
        ))}
      </ul>

      {entry.correlation.length > 0 ? (
        <div className="border-t border-border px-4 py-3">
          <p className="label-eyebrow mb-2">Correlation</p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {entry.correlation.map((h, i) => (
              <span key={h.label} className="flex items-center gap-1.5">
                <span className="rounded border border-border bg-muted/40 px-2 py-0.5">
                  <span className="text-muted-foreground">{h.label} </span>
                  <span className="mono-token text-foreground">{h.value}</span>
                </span>
                {i < entry.correlation.length - 1 ? (
                  <span className="text-muted-foreground">→</span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {changed.length === 0
          ? "No rows written — no event, resolution or metric changed."
          : `Rows written: ${changed.map(([k, d]) => `${k.replace(/_/g, " ")} +${d}`).join(" · ")}`}
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 border-t border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={
            open ? "size-3.5 rotate-180 transition-transform" : "size-3.5 transition-transform"
          }
        />
        {open ? "Hide" : "Show"} request &amp; response
      </button>
      {open ? (
        <div className="grid gap-3 border-t border-border px-4 py-3 md:grid-cols-2">
          <Json
            label="Request"
            value={
              entry.payload ?? {
                method: "GET",
                url: entry.request_line.replace("GET ", "https://"),
              }
            }
          />
          <Json label="Response" value={entry.response} />
        </div>
      ) : null}
    </li>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="label-eyebrow mb-1">{label}</p>
      <pre className="mono-token max-h-72 overflow-auto rounded bg-muted/50 p-3 text-[11px] leading-relaxed text-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
