import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import {
  EmptyState,
  MethodBadge,
  PageHeader,
  Panel,
  SourceNote,
  TraceLink,
} from "@/components/bits";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { attributionProvider, partnerProvider } from "@/providers";
import { APP_LABEL, CHANNEL_LABEL, formatCurrency, formatDate } from "@/lib/format";
import type { AppName, AttributionMethod, Channel } from "@/domain/types";

export const Route = createFileRoute("/conversions")({
  head: () => ({
    meta: [
      { title: "Conversions — Aurumi Link & Attribution" },
      {
        name: "description",
        content:
          "Downstream outcomes: signups, tenants, activation, subscriptions and first payments with their attributed acquisition source.",
      },
      { property: "og:title", content: "Conversions — Aurumi Link & Attribution" },
      {
        property: "og:description",
        content:
          "Attributed tenant conversions with subscription and first-payment facts. Commission is calculated outside this system.",
      },
    ],
  }),
  component: ConversionsPage,
});

function ConversionsPage() {
  const [query, setQuery] = useState("");
  const [partnerId, setPartnerId] = useState("all");
  const [campaignId, setCampaignId] = useState("all");
  const [channel, setChannel] = useState("all");
  const [app, setApp] = useState("all");
  const [method, setMethod] = useState("all");
  const [stage, setStage] = useState("TENANT");
  const [periodDays, setPeriodDays] = useState("90");

  const { data: partners } = useQuery({
    queryKey: ["partners"],
    queryFn: () => partnerProvider.searchPartners(),
  });
  const { data: campaigns } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => attributionProvider.listCampaigns(),
  });
  const { data: rows } = useQuery({
    queryKey: [
      "conversions",
      { query, partnerId, campaignId, channel, app, method, stage, periodDays },
    ],
    queryFn: () =>
      attributionProvider.listAttributions({
        query,
        partner_id: partnerId === "all" ? undefined : partnerId,
        campaign_id: campaignId === "all" ? undefined : campaignId,
        channel: channel === "all" ? undefined : (channel as Channel),
        app: app === "all" ? undefined : (app as AppName),
        attribution_method: method === "all" ? undefined : (method as AttributionMethod),
        stage: stage as "SIGNED_UP" | "TENANT" | "ACTIVATED" | "PAID",
        period_days: Number(periodDays),
      }),
  });

  return (
    <div className="mx-auto max-w-[96rem]">
      <PageHeader
        eyebrow="Conversions"
        title="Downstream outcomes"
        description="Commission-eligible events are captured here as facts. No commission amount is calculated or shown."
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 pb-4">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tenant, email, transaction"
            className="h-9 w-full sm:w-64"
          />
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SIGNED_UP">Signed up</SelectItem>
              <SelectItem value="TENANT">Tenant created</SelectItem>
              <SelectItem value="ACTIVATED">Activated</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
            </SelectContent>
          </Select>
          <Select value={partnerId} onValueChange={setPartnerId}>
            <SelectTrigger className="h-9 w-52">
              <SelectValue placeholder="Partner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All partners</SelectItem>
              {(partners ?? []).map((p) => (
                <SelectItem key={p.partner_id} value={p.partner_id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={campaignId} onValueChange={setCampaignId}>
            <SelectTrigger className="h-9 w-56">
              <SelectValue placeholder="Campaign" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {(campaigns ?? []).map((c) => (
                <SelectItem key={c.campaign_id} value={c.campaign_id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
                <SelectItem key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={app} onValueChange={setApp}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue placeholder="App" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All apps</SelectItem>
              {(["AURA", "SHOPTALK", "AURUMI"] as AppName[]).map((a) => (
                <SelectItem key={a} value={a}>
                  {APP_LABEL[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue placeholder="Method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All methods</SelectItem>
              <SelectItem value="DETERMINISTIC">Deterministic</SelectItem>
              <SelectItem value="CLAIMED">Claimed</SelectItem>
              <SelectItem value="MATCHED">Matched</SelectItem>
              <SelectItem value="UNATTRIBUTED">Unattributed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={periodDays} onValueChange={setPeriodDays}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
              <SelectItem value="365">1 year</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(rows ?? []).length === 0 ? (
          <EmptyState title="No conversions match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {[
                    "Tenant",
                    "Partner",
                    "Campaign",
                    "Channel",
                    "App",
                    "Signup",
                    "Activation",
                    "Subscription",
                    "First payment",
                    "Method",
                    "",
                  ].map((h) => (
                    <th key={h} className="label-eyebrow pb-2 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((a) => (
                  <tr key={a.attribution_id} className="border-b border-border/60 last:border-0">
                    <td className="py-3 pr-4">
                      <p className="text-foreground">{a.tenant_name ?? "—"}</p>
                      <p className="mono-token text-xs text-muted-foreground">
                        {a.tenant_id ?? a.signup_id ?? "—"}
                      </p>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {a.partner_name_snapshot ?? "Unattributed"}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {campaigns?.find((c) => c.campaign_id === a.campaign_id)?.name ?? "—"}
                    </td>
                    <td className="py-3 pr-4">
                      {a.channel ? CHANNEL_LABEL[a.channel] : "Direct / organic"}
                    </td>
                    <td className="py-3 pr-4">{APP_LABEL[a.app]}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatDate(a.signup_at)}</td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {formatDate(a.activated_at)}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {a.subscription ? (
                        <span className="mono-token">
                          {a.subscription.subscription_id} · {a.subscription.price_version_id}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {a.first_payment ? (
                        <div>
                          <p className="text-foreground">
                            {formatCurrency(a.first_payment.amount)}
                          </p>
                          <p className="mono-token text-xs text-deterministic">
                            Commission eligible event captured
                          </p>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <MethodBadge method={a.attribution_method} />
                    </td>
                    <td className="py-3">
                      <TraceLink attributionId={a.attribution_id} label="Trace" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <SourceNote system="Price Admin">
          plan, price version and amounts are referenced snapshots
        </SourceNote>
      </Panel>
    </div>
  );
}
