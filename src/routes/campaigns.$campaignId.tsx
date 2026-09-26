import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import {
  EmptyState,
  FunnelBars,
  MetricCard,
  MethodBadge,
  PageHeader,
  Panel,
  SourceNote,
  StatusPill,
  TraceLink,
} from "@/components/bits";
import { attributionClient } from "@/client/attribution-client";
import { demoProvider, partnerProvider } from "@/providers";
import {
  APP_LABEL,
  CHANNEL_LABEL,
  DESTINATION_LABEL,
  EVENT_LABEL,
  PARTNER_TYPE_LABEL,
  formatDate,
  formatDateTime,
} from "@/lib/format";

export const Route = createFileRoute("/campaigns/$campaignId")({
  head: () => ({
    meta: [
      { title: "Campaign detail — Aurumi Link & Attribution" },
      {
        name: "description",
        content:
          "Campaign links, acquisition funnel, attributed conversions and recent attribution traces.",
      },
      { property: "og:title", content: "Campaign detail — Aurumi Link & Attribution" },
      {
        property: "og:description",
        content: "Links, funnel and traces for a single Aurumi acquisition campaign.",
      },
    ],
  }),
  component: CampaignDetailPage,
});

function CampaignDetailPage() {
  const { campaignId } = Route.useParams();
  const { data: campaign } = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: () => attributionClient.getCampaign(campaignId),
  });
  const { data: performance } = useQuery({
    queryKey: ["campaign-performance", campaignId],
    queryFn: () => attributionClient.getCampaignPerformance(campaignId),
  });
  const { data: links } = useQuery({
    queryKey: ["links", { campaignId }],
    queryFn: () => attributionClient.listLinks({ campaign_id: campaignId }),
  });
  const { data: attributions } = useQuery({
    queryKey: ["attributions", { campaignId }],
    queryFn: () => attributionClient.listAttributions({ campaign_id: campaignId }),
  });
  const { data: events } = useQuery({
    queryKey: ["campaign-events", campaignId],
    queryFn: () => attributionClient.listEvents({ campaign_id: campaignId }),
  });
  const { data: partner } = useQuery({
    queryKey: ["partner", campaign?.associated_partner_id],
    queryFn: () => partnerProvider.getPartner(campaign!.associated_partner_id!),
    enabled: !!campaign?.associated_partner_id,
  });
  const { data: experience } = useQuery({
    queryKey: ["experience", campaign?.demo_experience_id],
    queryFn: () => demoProvider.getExperience(campaign!.demo_experience_id!),
    enabled: !!campaign?.demo_experience_id,
  });

  if (!campaign) {
    return <EmptyState title="Campaign not found" hint="It may have been archived." />;
  }

  const recentEvents = [...(events ?? [])].reverse().slice(0, 12);

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        to="/campaigns"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All campaigns
      </Link>
      <PageHeader
        eyebrow={campaign.campaign_id}
        title={campaign.name}
        description={campaign.description}
        actions={<StatusPill status={campaign.status} />}
      />

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Clicks" value={String(performance?.clicks ?? 0)} />
        <MetricCard label="Installs" value={String(performance?.installs ?? 0)} />
        <MetricCard label="Signups" value={String(performance?.signups ?? 0)} />
        <MetricCard label="Tenants" value={String(performance?.tenants ?? 0)} />
        <MetricCard label="Activated" value={String(performance?.activated ?? 0)} />
        <MetricCard label="Paid" value={String(performance?.paid ?? 0)} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Panel title="Campaign information">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Target app" value={APP_LABEL[campaign.target_app]} />
            <Field label="Default channel" value={CHANNEL_LABEL[campaign.default_channel]} />
            <Field
              label="Default destination"
              value={DESTINATION_LABEL[campaign.default_destination]}
            />
            <Field label="Start" value={formatDate(campaign.start_date)} />
            <Field label="End" value={campaign.end_date ? formatDate(campaign.end_date) : "Open"} />
            <Field label="Created by" value={campaign.created_by} />
            <Field label="Tags" value={campaign.tags.length ? campaign.tags.join(", ") : "—"} />
            <Field label="Updated" value={formatDate(campaign.updated_at)} />
          </dl>
        </Panel>

        <div className="space-y-4">
          <Panel title="Associated partner">
            {partner ? (
              <div>
                <p className="text-base font-semibold text-foreground">{partner.name}</p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Partner ID" value={partner.partner_id} mono />
                  <Field label="Type" value={PARTNER_TYPE_LABEL[partner.partner_type]} />
                  <Field label="Territory" value={partner.territory} />
                  <Field
                    label="Contact"
                    value={`${partner.contact_name} · ${partner.contact_email}`}
                  />
                </dl>
                <SourceNote system="Partner Portal">read-only reference</SourceNote>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No partner attached — owned-channel campaign.
              </p>
            )}
          </Panel>

          <Panel title="Demo experience">
            {experience ? (
              <div>
                <p className="text-sm font-medium text-foreground">{experience.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{experience.description}</p>
                <SourceNote system="Demo Studio">
                  {experience.demo_experience_id} · configuration owned externally
                </SourceNote>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No demo experience referenced.</p>
            )}
          </Panel>
        </div>
      </div>

      <Panel className="mt-6" title="Acquisition funnel">
        {performance ? <FunnelBars rows={performance.funnel} /> : null}
      </Panel>

      <Panel className="mt-6" title="Links" subtitle={`${links?.length ?? 0} attribution links`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {["Short URL", "Partner", "Channel", "Destination", "Clicks", "Paid", "Status"].map(
                  (h) => (
                    <th key={h} className="label-eyebrow pb-2 font-normal">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {(links ?? []).map((l) => (
                <tr key={l.link_id} className="border-b border-border/60 last:border-0">
                  <td className="mono-token py-2.5 pr-4 text-foreground">{l.short_url}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">
                    {l.partner_name_snapshot ?? "—"}
                  </td>
                  <td className="py-2.5 pr-4">{CHANNEL_LABEL[l.channel]}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">
                    {DESTINATION_LABEL[l.destination]}
                  </td>
                  <td className="mono-token py-2.5 pr-4">{l.clicks}</td>
                  <td className="mono-token py-2.5 pr-4 text-primary">{l.conversions}</td>
                  <td className="py-2.5">
                    <StatusPill status={l.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Attributed journeys" subtitle="Most recent resolutions">
          <ul className="space-y-3">
            {(attributions ?? []).slice(0, 8).map((a) => (
              <li
                key={a.attribution_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2.5"
              >
                <div>
                  <p className="text-sm text-foreground">
                    {a.tenant_name ?? a.contact_email ?? a.session_id}
                  </p>
                  <p className="mono-token mt-0.5 text-xs text-muted-foreground">
                    {a.tenant_id ?? a.signup_id ?? a.click_id}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <MethodBadge method={a.attribution_method} />
                  <TraceLink attributionId={a.attribution_id} label="Trace" />
                </div>
              </li>
            ))}
            {(attributions ?? []).length === 0 ? (
              <EmptyState title="No attributed journeys yet" />
            ) : null}
          </ul>
        </Panel>

        <Panel title="Recent traces" subtitle="Latest recorded events on this campaign">
          <ol className="space-y-2.5">
            {recentEvents.map((e) => (
              <li key={e.event_id} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p className="text-foreground">{EVENT_LABEL[e.event_type]}</p>
                  <p className="mono-token text-xs text-muted-foreground">
                    {e.event_id} · {e.source_system}
                  </p>
                </div>
                <span className="mono-token shrink-0 text-xs text-muted-foreground">
                  {formatDateTime(e.occurred_at)}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
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
