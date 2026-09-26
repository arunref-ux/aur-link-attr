import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader, Panel, SourceNote, StatusPill } from "@/components/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { attributionClient } from "@/client/attribution-client";
import { partnerProvider } from "@/providers";
import { APP_LABEL, CHANNEL_LABEL, DESTINATION_LABEL, formatDate } from "@/lib/format";
import type { AppName, Channel, DestinationType } from "@/domain/types";

export const Route = createFileRoute("/campaigns/")({
  head: () => ({
    meta: [
      { title: "Campaigns — Aurumi Link & Attribution" },
      {
        name: "description",
        content:
          "Campaigns group Aurumi attribution links and acquisition activity across partners, channels and apps.",
      },
      { property: "og:title", content: "Campaigns — Aurumi Link & Attribution" },
      {
        property: "og:description",
        content: "Reseller and owned-channel acquisition campaigns for Aura, ShopTalk and Aurumi.",
      },
    ],
  }),
  component: CampaignsPage,
});

function CampaignsPage() {
  const [open, setOpen] = useState(false);
  const { data: campaigns } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => attributionClient.listCampaigns(),
  });
  const { data: partners } = useQuery({
    queryKey: ["partners"],
    queryFn: () => partnerProvider.searchPartners(),
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Campaigns"
        title="Acquisition campaigns"
        description="Campaigns group attribution links and acquisition activity. Partner records are referenced, never edited here."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> New campaign
          </Button>
        }
      />

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {["Campaign", "App", "Channel", "Partner", "Destination", "Window", "Status"].map(
                  (h) => (
                    <th key={h} className="label-eyebrow pb-2 font-normal">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {(campaigns ?? []).map((c) => (
                <tr key={c.campaign_id} className="border-b border-border/60 last:border-0">
                  <td className="py-3 pr-4">
                    <Link
                      to="/campaigns/$campaignId"
                      params={{ campaignId: c.campaign_id }}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {c.name}
                    </Link>
                    <p className="mono-token mt-0.5 text-xs text-muted-foreground">
                      {c.campaign_id}
                    </p>
                  </td>
                  <td className="py-3 pr-4">{APP_LABEL[c.target_app]}</td>
                  <td className="py-3 pr-4">{CHANNEL_LABEL[c.default_channel]}</td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {partners?.find((p) => p.partner_id === c.associated_partner_id)?.name ?? "—"}
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {DESTINATION_LABEL[c.default_destination]}
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {formatDate(c.start_date)} → {c.end_date ? formatDate(c.end_date) : "open"}
                  </td>
                  <td className="py-3">
                    <StatusPill status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SourceNote system="Partner Portal">partner names shown for readability only</SourceNote>
      </Panel>

      <NewCampaignDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function NewCampaignDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: partners } = useQuery({
    queryKey: ["partners"],
    queryFn: () => partnerProvider.searchPartners(),
  });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [app, setApp] = useState<AppName>("AURA");
  const [channel, setChannel] = useState<Channel>("WHATSAPP");
  const [destination, setDestination] = useState<DestinationType>("SIGNUP");
  const [partnerId, setPartnerId] = useState<string>("none");

  async function submit() {
    if (!name.trim()) {
      toast.error("Campaign name is required");
      return;
    }
    await attributionClient.createCampaign({
      name: name.trim(),
      description: description.trim(),
      target_app: app,
      default_channel: channel,
      default_destination: destination,
      associated_partner_id: partnerId === "none" ? null : partnerId,
      demo_experience_id: null,
      status: "DRAFT",
      start_date: new Date().toISOString(),
      tags: [],
    });
    toast.success("Campaign created as draft");
    setName("");
    setDescription("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Campaigns hold defaults for the attribution links created under them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="label-eyebrow">Name</Label>
            <Input
              className="mt-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Aura + Tally — October 2026"
            />
          </div>
          <div>
            <Label className="label-eyebrow">Description</Label>
            <Textarea
              className="mt-2"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="label-eyebrow">Target app</Label>
              <Select value={app} onValueChange={(v) => setApp(v as AppName)}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["AURA", "SHOPTALK", "AURUMI"] as AppName[]).map((a) => (
                    <SelectItem key={a} value={a}>
                      {APP_LABEL[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="label-eyebrow">Default channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {CHANNEL_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="label-eyebrow">Default destination</Label>
              <Select
                value={destination}
                onValueChange={(v) => setDestination(v as DestinationType)}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DESTINATION_LABEL) as DestinationType[]).map((d) => (
                    <SelectItem key={d} value={d}>
                      {DESTINATION_LABEL[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="label-eyebrow">Partner (optional)</Label>
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No partner</SelectItem>
                  {(partners ?? []).map((p) => (
                    <SelectItem key={p.partner_id} value={p.partner_id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <SourceNote system="Partner Portal">partners cannot be created or edited here</SourceNote>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()}>Create campaign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
