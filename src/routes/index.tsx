import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import {
  BreakdownTable,
  FunnelBars,
  MetricCard,
  MethodBadge,
  PageHeader,
  Panel,
} from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { attributionClient } from "@/client/attribution-client";
import { APP_LABEL, CHANNEL_LABEL, formatPercent } from "@/lib/format";
import type { AppName, Channel } from "@/domain/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview — Aurumi Link & Attribution" },
      {
        name: "description",
        content:
          "Operational overview of link clicks, attributed installs, signups, tenant activation and paid conversions across Aurumi apps and partners.",
      },
      { property: "og:title", content: "Overview — Aurumi Link & Attribution" },
      {
        property: "og:description",
        content:
          "Acquisition funnel from click to commercial conversion, broken down by channel, partner, app, campaign and attribution method.",
      },
    ],
  }),
  component: OverviewPage,
});

const PERIODS = [
  { label: "Today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

function OverviewPage() {
  const [days, setDays] = useState(30);
  const [custom, setCustom] = useState("");
  const { data } = useQuery({
    queryKey: ["overview", days],
    queryFn: () => attributionClient.getOverview(days),
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Overview"
        title="Acquisition attribution"
        description="Every number below is derived from recorded attribution facts. Commission logic lives outside this system."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {PERIODS.map((p) => (
              <Button
                key={p.days}
                size="sm"
                variant={days === p.days ? "default" : "outline"}
                onClick={() => {
                  setDays(p.days);
                  setCustom("");
                }}
              >
                {p.label}
              </Button>
            ))}
            <div className="flex items-center gap-1.5">
              <Input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Custom days"
                inputMode="numeric"
                className="h-9 w-28"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const n = Number(custom);
                  if (Number.isFinite(n) && n > 0) setDays(Math.min(Math.round(n), 365));
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Link clicks" value={(data?.clicks ?? 0).toLocaleString("en-IN")} />
        <MetricCard
          label="Attributed installs"
          value={(data?.installs ?? 0).toLocaleString("en-IN")}
        />
        <MetricCard label="Signups" value={(data?.signups ?? 0).toLocaleString("en-IN")} />
        <MetricCard
          label="Activated tenants"
          value={(data?.activated ?? 0).toLocaleString("en-IN")}
        />
        <MetricCard label="Paid conversions" value={(data?.paid ?? 0).toLocaleString("en-IN")} />
        <MetricCard
          label="Attribution rate"
          value={formatPercent(data?.attribution_rate ?? 0)}
          hint="Share of journeys with a reliable source"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Panel
          title="Acquisition funnel"
          subtitle="Clicks → Installs → First Opens → Signups → Tenants → Activated → Paid"
        >
          {data ? <FunnelBars rows={data.funnel} /> : null}
        </Panel>
        <Panel
          title="Attribution method"
          subtitle="Categorical method, not invented confidence scores"
        >
          <ul className="space-y-3">
            {(data?.byMethod ?? []).map((m) => {
              const total = (data?.byMethod ?? []).reduce((sum, x) => sum + x.count, 0) || 1;
              return (
                <li key={m.key}>
                  <div className="flex items-center justify-between gap-3">
                    <MethodBadge method={m.key} />
                    <span className="mono-token text-muted-foreground">
                      {m.count} · {formatPercent(m.count / total)}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${(m.count / total) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <Panel
        className="mt-6"
        title="Breakdowns"
        subtitle="Partner performance references Partner Portal records. No commission is calculated here."
      >
        <Tabs defaultValue="channel">
          <TabsList>
            <TabsTrigger value="channel">Source / Channel</TabsTrigger>
            <TabsTrigger value="partner">Partner</TabsTrigger>
            <TabsTrigger value="app">App</TabsTrigger>
            <TabsTrigger value="campaign">Campaign</TabsTrigger>
          </TabsList>
          <TabsContent value="channel" className="pt-4">
            <BreakdownTable
              keyLabel="Channel"
              rows={(data?.byChannel ?? []).map((r) => ({
                ...r,
                label: CHANNEL_LABEL[r.key as Channel] ?? r.label,
              }))}
            />
          </TabsContent>
          <TabsContent value="partner" className="pt-4">
            <BreakdownTable keyLabel="Partner" rows={data?.byPartner ?? []} />
          </TabsContent>
          <TabsContent value="app" className="pt-4">
            <BreakdownTable
              keyLabel="App"
              rows={(data?.byApp ?? []).map((r) => ({
                ...r,
                label: APP_LABEL[r.key as AppName] ?? r.label,
              }))}
            />
          </TabsContent>
          <TabsContent value="campaign" className="pt-4">
            <BreakdownTable keyLabel="Campaign" rows={data?.byCampaign ?? []} />
          </TabsContent>
        </Tabs>
      </Panel>
    </div>
  );
}
