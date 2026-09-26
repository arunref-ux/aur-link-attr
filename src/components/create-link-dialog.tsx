import { useQuery } from "@tanstack/react-query";
import { Check, Copy, MessageCircle, Mail, QrCode, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SourceNote } from "@/components/bits";
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
import type { AppName, AttributionLink, Channel, DestinationType } from "@/domain/types";
import { APP_LABEL, CHANNEL_LABEL, DESTINATION_LABEL } from "@/lib/format";
import { attributionProvider, demoProvider, partnerProvider } from "@/providers";

export function CreateLinkDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (link: AttributionLink) => void;
}) {
  const [campaignId, setCampaignId] = useState<string>("");
  const [partnerQuery, setPartnerQuery] = useState("");
  const [partnerId, setPartnerId] = useState<string>("none");
  const [channel, setChannel] = useState<Channel>("WHATSAPP");
  const [app, setApp] = useState<AppName>("AURA");
  const [destination, setDestination] = useState<DestinationType>("SIGNUP");
  const [destinationValue, setDestinationValue] = useState("");
  const [experienceId, setExperienceId] = useState<string>("none");
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [creative, setCreative] = useState("");
  const [placement, setPlacement] = useState("");
  const [tags, setTags] = useState("");
  const [created, setCreated] = useState<AttributionLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const { data: campaigns } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => attributionProvider.listCampaigns(),
  });
  const { data: partners } = useQuery({
    queryKey: ["partners", partnerQuery],
    queryFn: () => partnerProvider.searchPartners(partnerQuery),
  });
  const { data: experiences } = useQuery({
    queryKey: ["experiences"],
    queryFn: () => demoProvider.searchExperiences(),
  });

  const campaign = campaigns?.find((c) => c.campaign_id === campaignId);

  function applyCampaignDefaults(id: string) {
    setCampaignId(id);
    const c = campaigns?.find((x) => x.campaign_id === id);
    if (!c) return;
    setApp(c.target_app);
    setChannel(c.default_channel);
    setDestination(c.default_destination);
    setPartnerId(c.associated_partner_id ?? "none");
    setExperienceId(c.demo_experience_id ?? "none");
  }

  async function submit() {
    if (!campaignId) {
      toast.error("Select a campaign first");
      return;
    }
    const link = await attributionProvider.createLink({
      campaign_id: campaignId,
      partner_id: partnerId === "none" ? null : partnerId,
      channel,
      app,
      destination,
      destination_value: destinationValue.trim() || null,
      demo_experience_id: experienceId === "none" ? null : experienceId,
      metadata: {
        ...(source ? { source } : {}),
        ...(medium ? { medium } : {}),
        ...(creative ? { creative } : {}),
        ...(placement ? { placement } : {}),
        ...(tags
          ? {
              tags: tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            }
          : {}),
      },
    });
    setCreated(link);
    onCreated?.(link);
    toast.success("Attribution link created", { description: link.short_url });
  }

  function reset() {
    setCreated(null);
    setCopied(false);
    setShowQr(false);
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(`https://${url}`);
      setCopied(true);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed — select the link manually");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Link ready</DialogTitle>
              <DialogDescription>
                The public URL carries an opaque token only. Partner identity is resolved
                server-side.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-5 text-center">
              <p className="label-eyebrow">Public link</p>
              <p className="mono-token mt-2 text-lg text-foreground">https://{created.short_url}</p>
              <p className="mono-token mt-1 text-xs text-muted-foreground">
                token {created.token} · {created.link_id}
              </p>
            </div>
            {showQr ? (
              <div className="flex justify-center">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                    `https://${created.short_url}`,
                  )}`}
                  alt={`QR code for ${created.short_url}`}
                  className="rounded-md border border-border bg-background p-2"
                  width={180}
                  height={180}
                />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void copy(created.short_url)}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy link
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void attributionProvider.shareLink(created.link_id, "share_sheet")}
              >
                <Share2 className="size-4" /> Share
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void attributionProvider.shareLink(created.link_id, "whatsapp")}
                asChild
              >
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`https://${created.short_url}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle className="size-4" /> WhatsApp
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={`mailto:?body=https://${created.short_url}`}>
                  <Mail className="size-4" /> Email
                </a>
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowQr((v) => !v)}>
                <QrCode className="size-4" /> {showQr ? "Hide QR" : "Generate QR"}
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Create another
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create attribution link</DialogTitle>
              <DialogDescription>
                Attribution context and destination context are configured separately.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <section className="space-y-4">
                <p className="label-eyebrow">Attribution context</p>
                <div>
                  <Label className="label-eyebrow">Campaign</Label>
                  <Select value={campaignId} onValueChange={applyCampaignDefaults}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Select a campaign" />
                    </SelectTrigger>
                    <SelectContent>
                      {(campaigns ?? [])
                        .filter((c) => c.status !== "ARCHIVED")
                        .map((c) => (
                          <SelectItem key={c.campaign_id} value={c.campaign_id}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="label-eyebrow">
                    Partner {campaign?.associated_partner_id ? "" : "(optional)"}
                  </Label>
                  <Input
                    className="mt-2"
                    placeholder="Search partners by name, ID or territory"
                    value={partnerQuery}
                    onChange={(e) => setPartnerQuery(e.target.value)}
                  />
                  <Select value={partnerId} onValueChange={setPartnerId}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Select partner" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No partner</SelectItem>
                      {(partners ?? []).map((p) => (
                        <SelectItem key={p.partner_id} value={p.partner_id}>
                          {p.name} · {p.territory}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <SourceNote system="Partner Portal">
                    partner data provided by Partner Portal
                  </SourceNote>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="label-eyebrow">Channel</Label>
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
                </div>
              </section>

              <section className="space-y-4 border-t border-border pt-5">
                <p className="label-eyebrow">Destination context</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="label-eyebrow">Destination</Label>
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
                  {destination === "FEATURE" || destination === "CUSTOM" ? (
                    <div>
                      <Label className="label-eyebrow">Deep-link path</Label>
                      <Input
                        className="mt-2"
                        placeholder="aura/attendance"
                        value={destinationValue}
                        onChange={(e) => setDestinationValue(e.target.value)}
                      />
                    </div>
                  ) : null}
                  <div>
                    <Label className="label-eyebrow">Demo experience (optional)</Label>
                    <Select value={experienceId} onValueChange={setExperienceId}>
                      <SelectTrigger className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {(experiences ?? []).map((e) => (
                          <SelectItem key={e.demo_experience_id} value={e.demo_experience_id}>
                            {e.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <SourceNote system="Demo Studio">experiences configured externally</SourceNote>
                  </div>
                </div>
              </section>

              <section className="space-y-3 border-t border-border pt-5">
                <p className="label-eyebrow">Campaign / creative metadata (optional)</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="Source"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  />
                  <Input
                    placeholder="Medium"
                    value={medium}
                    onChange={(e) => setMedium(e.target.value)}
                  />
                  <Input
                    placeholder="Creative"
                    value={creative}
                    onChange={(e) => setCreative(e.target.value)}
                  />
                  <Input
                    placeholder="Placement"
                    value={placement}
                    onChange={(e) => setPlacement(e.target.value)}
                  />
                  <Input
                    className="sm:col-span-2"
                    placeholder="Tags (comma separated)"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                  />
                </div>
              </section>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()}>Generate link</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
