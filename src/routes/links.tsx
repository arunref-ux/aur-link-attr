import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Ban, Copy, PlayCircle, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader, Panel, SourceNote, StatusPill } from "@/components/bits";
import { CreateLinkDialog } from "@/components/create-link-dialog";
import { JourneySimulator } from "@/components/journey-simulator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { attributionProvider, type LinkRow } from "@/providers";
import { APP_LABEL, CHANNEL_LABEL, DESTINATION_LABEL, formatDate } from "@/lib/format";
import type { AppName, Channel } from "@/domain/types";

export const Route = createFileRoute("/links")({
  head: () => ({
    meta: [
      { title: "Links — Aurumi Link & Attribution" },
      {
        name: "description",
        content:
          "Create and operate Aurumi attribution links with opaque public tokens, partner references and destination deep links.",
      },
      { property: "og:title", content: "Links — Aurumi Link & Attribution" },
      {
        property: "og:description",
        content:
          "Attribution links for resellers and owned channels, with click and conversion counts and an end-to-end journey simulator.",
      },
    ],
  }),
  component: LinksPage,
});

function LinksPage() {
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<string>("all");
  const [app, setApp] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [journeyLink, setJourneyLink] = useState<LinkRow | null>(null);

  const { data: links } = useQuery({
    queryKey: ["links", { query, channel, app, status }],
    queryFn: () =>
      attributionProvider.listLinks({
        query,
        channel: channel === "all" ? undefined : (channel as Channel),
        app: app === "all" ? undefined : (app as AppName),
        status: status === "all" ? undefined : (status as "ACTIVE" | "DISABLED"),
      }),
  });

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(`https://${url}`);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed — select the link manually");
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Links"
        title="Attribution links"
        description="Public URLs carry opaque tokens only. Partner identity is resolved server-side at redirect time."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Create link
          </Button>
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 pb-4">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search token, URL or partner"
            className="h-9 w-full sm:w-72"
          />
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="h-9 w-40">
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
            <SelectTrigger className="h-9 w-36">
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
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="DISABLED">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(links ?? []).length === 0 ? (
          <EmptyState title="No links match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {[
                    "Short URL",
                    "Campaign",
                    "Partner",
                    "Channel",
                    "App",
                    "Destination",
                    "Clicks",
                    "Paid",
                    "Created",
                    "Status",
                    "",
                  ].map((h) => (
                    <th key={h} className="label-eyebrow pb-2 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(links ?? []).map((l) => (
                  <tr key={l.link_id} className="border-b border-border/60 last:border-0">
                    <td className="py-3 pr-4">
                      <button
                        onClick={() => void copy(l.short_url)}
                        className="mono-token inline-flex items-center gap-1.5 text-foreground hover:text-primary"
                      >
                        {l.short_url} <Copy className="size-3.5" />
                      </button>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{l.campaign_name}</td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {l.partner_name_snapshot ?? "—"}
                    </td>
                    <td className="py-3 pr-4">{CHANNEL_LABEL[l.channel]}</td>
                    <td className="py-3 pr-4">{APP_LABEL[l.app]}</td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {DESTINATION_LABEL[l.destination]}
                      {l.destination_value ? ` · ${l.destination_value}` : ""}
                    </td>
                    <td className="mono-token py-3 pr-4">{l.clicks}</td>
                    <td className="mono-token py-3 pr-4 text-primary">{l.conversions}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatDate(l.created_at)}</td>
                    <td className="py-3 pr-4">
                      <StatusPill status={l.status} />
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={l.status !== "ACTIVE"}
                          title={
                            l.status !== "ACTIVE"
                              ? "Disabled links cannot start new journeys"
                              : undefined
                          }
                          onClick={() => setJourneyLink(l)}
                        >
                          <PlayCircle className="size-4" /> Test journey
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void attributionProvider.setLinkStatus(
                              l.link_id,
                              l.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                            );
                            toast.success(
                              l.status === "ACTIVE"
                                ? "Link disabled — historical attribution stays intact"
                                : "Link re-enabled",
                            );
                          }}
                        >
                          {l.status === "ACTIVE" ? (
                            <Ban className="size-4" />
                          ) : (
                            <RotateCcw className="size-4" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <SourceNote system="Partner Portal">
          partner names are snapshots kept for historical readability
        </SourceNote>
      </Panel>

      <CreateLinkDialog open={createOpen} onOpenChange={setCreateOpen} />
      <JourneySimulator
        link={journeyLink}
        open={!!journeyLink}
        onOpenChange={(v) => {
          if (!v) setJourneyLink(null);
        }}
      />
    </div>
  );
}
