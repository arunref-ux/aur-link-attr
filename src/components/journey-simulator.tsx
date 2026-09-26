import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, CircleDashed, Smartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { MethodBadge, SourceNote } from "@/components/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Platform } from "@/domain/types";
import { APP_LABEL, CHANNEL_LABEL, formatCurrency, formatTime } from "@/lib/format";
import { attributionProvider, simulationProvider, type LinkRow, type SimulationState, type SimulationStep } from "@/providers";

const STEPS: { step: SimulationStep; label: string; button: string }[] = [
  { step: "CLICK", label: "Redirect", button: "Simulate Link Click" },
  { step: "INSTALL", label: "Install", button: "Simulate App Install" },
  { step: "FIRST_OPEN", label: "First open", button: "Simulate First Open" },
  { step: "SIGNUP_STARTED", label: "Signup started", button: "Start Signup" },
  { step: "SIGNUP_COMPLETED", label: "Signup completed", button: "Complete Signup" },
  { step: "TENANT_CREATED", label: "Tenant", button: "Create Tenant" },
  { step: "TENANT_ACTIVATED", label: "Activation", button: "Simulate Activation" },
  { step: "SUBSCRIPTION_STARTED", label: "Subscription", button: "Simulate Subscription" },
  { step: "FIRST_PAYMENT", label: "Payment", button: "Simulate First Payment" },
];

export function JourneySimulator({
  link,
  open,
  onOpenChange,
}: {
  link: LinkRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [platform, setPlatform] = useState<Platform>("ANDROID");
  const [state, setState] = useState<SimulationState | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: attribution } = useQuery({
    queryKey: ["simulated-attribution", state?.attribution_id],
    queryFn: () => simulationProvider.getAttribution(state!.attribution_id),
    enabled: !!state,
  });
  const { data: events } = useQuery({
    queryKey: ["simulated-events", state?.attribution_id],
    queryFn: () => attributionProvider.listEvents({ attribution_id: state!.attribution_id }),
    enabled: !!state,
  });

  const completed = state?.completed ?? [];
  const nextIndex = completed.length;
  const next = STEPS[nextIndex];

  async function run() {
    if (!link) return;
    setBusy(true);
    try {
      const current = state ?? (await simulationProvider.start(link.link_id, platform));
      const updated = await simulationProvider.step(current, next!.step);
      setState(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Step failed");
    } finally {
      setBusy(false);
    }
  }

  function close(v: boolean) {
    if (!v) setState(null);
    onOpenChange(v);
  }

  if (!link) return null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test journey</DialogTitle>
          <DialogDescription>
            Walks the acquisition lifecycle end to end and records real attribution events.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="label-eyebrow">Step 1 — Link shared</p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Row label="Partner" value={link.partner_name_snapshot ?? "No partner (owned channel)"} />
            <Row label="Channel" value={CHANNEL_LABEL[link.channel]} />
            <Row label="Campaign" value={link.campaign_name} />
            <Row label="Link" value={link.short_url} mono />
            <Row label="Target app" value={APP_LABEL[link.app]} />
            <Row label="Token" value={link.token} mono />
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Smartphone className="size-4 text-muted-foreground" />
              <Select
                value={platform}
                onValueChange={(v) => setPlatform(v as Platform)}
                disabled={!!state}
              >
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANDROID">Android</SelectItem>
                  <SelectItem value="IOS">iOS</SelectItem>
                  <SelectItem value="WEB">Web</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {platform === "IOS" ? (
              <p className="text-xs text-claimed">
                iOS deferred attribution through the App Store is provider-dependent / future
                capability.
              </p>
            ) : null}
          </div>
        </div>

        {link.status !== "ACTIVE" && !state ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-foreground">
            This link is disabled. It cannot start a new journey; existing attribution is unchanged.
            Re-enable it to test new journeys.
          </p>
        ) : null}

        <ol className="space-y-2">
          {STEPS.map((s, i) => {
            const done = completed.includes(s.step);
            const isNext = i === nextIndex;
            return (
              <li
                key={s.step}
                className={
                  done
                    ? "rounded-md border border-deterministic/30 bg-deterministic/5 px-4 py-3"
                    : isNext
                      ? "rounded-md border border-primary/40 bg-primary/5 px-4 py-3"
                      : "rounded-md border border-border px-4 py-3 opacity-60"
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {done ? (
                      <CheckCircle2 className="size-4 text-deterministic" />
                    ) : (
                      <CircleDashed className="size-4 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Step {i + 2} — {s.label}
                      </p>
                      {done ? (
                        <StepDetail step={s.step} state={state} />
                      ) : (
                        <p className="text-xs text-muted-foreground">Pending</p>
                      )}
                    </div>
                  </div>
                  {isNext ? (
                    <Button
                      size="sm"
                      disabled={busy || (!state && link.status !== "ACTIVE")}
                      onClick={() => void run()}
                    >
                      {s.button} <ArrowRight className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        {attribution ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="label-eyebrow">Live attribution record</p>
              <MethodBadge method={attribution.attribution_method} />
            </div>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <Row label="Attribution ID" value={attribution.attribution_id} mono />
              <Row label="Session" value={attribution.session_id} mono />
              <Row label="Click" value={attribution.click_id ?? "—"} mono />
              <Row label="Install" value={attribution.install_id ?? "—"} mono />
              <Row label="Tenant" value={attribution.tenant_id ?? "—"} mono />
              <Row label="Source" value={attribution.attribution_source} />
            </dl>
            {attribution.first_payment ? (
              <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
                <p className="text-sm font-medium text-foreground">
                  Commercial conversion attributed to{" "}
                  {attribution.partner_name_snapshot ?? "no partner"}
                </p>
                <p className="mono-token mt-1 text-xs text-muted-foreground">
                  {attribution.first_payment.transaction_id} ·{" "}
                  {formatCurrency(attribution.first_payment.amount)} · commission calculation:
                  handled externally
                </p>
              </div>
            ) : null}
            <SourceNote system="Price Admin">plan and price version referenced, never calculated here</SourceNote>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {events?.length ?? 0} events recorded on this journey
              </p>
              <Button size="sm" variant="outline" asChild>
                <Link
                  to="/trace/$attributionId"
                  params={{ attributionId: attribution.attribution_id }}
                >
                  Open full trace
                </Link>
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StepDetail({ step, state }: { step: SimulationStep; state: SimulationState | null }) {
  if (step === "CLICK" && state?.click) {
    return (
      <p className="mono-token text-xs text-muted-foreground">
        {state.click.click_id} · {formatTime(state.click.occurred_at)} · redirect →{" "}
        {state.redirect_target}
      </p>
    );
  }
  if (step === "INSTALL" && state?.install) {
    return (
      <p className="mono-token text-xs text-muted-foreground">
        {state.install.install_id} ·{" "}
        {state.install.referrer_recovered
          ? "Referrer successfully recovered · Deterministic"
          : "Referrer unavailable · provider-dependent"}
      </p>
    );
  }
  return <p className="text-xs text-deterministic">Recorded</p>;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="label-eyebrow">{label}</dt>
      <dd className={mono ? "mono-token mt-1 text-foreground" : "mt-1 text-sm text-foreground"}>
        {value}
      </dd>
    </div>
  );
}
