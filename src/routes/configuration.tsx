import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { PageHeader, Panel, SourceNote } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductionContract } from "@/components/production-contract";
import { attributionClient } from "@/client/attribution-client";
import { labelForRule } from "@/lib/attribution-rules";
import { titleCase } from "@/lib/format";
import type { AttributionRulesConfig } from "@/domain/types";

export const Route = createFileRoute("/configuration")({
  head: () => ({
    meta: [
      { title: "Configuration — Aurumi Link & Attribution" },
      {
        name: "description",
        content:
          "Attribution windows, conflict rules, link domains and attribution provider boundaries for Aurumi Link & Attribution.",
      },
      { property: "og:title", content: "Configuration — Aurumi Link & Attribution" },
      {
        property: "og:description",
        content:
          "Configure attribution windows and precedence rules, review the link domain, and inspect native and external attribution providers.",
      },
    ],
  }),
  component: ConfigurationPage,
});

function ConfigurationPage() {
  const { data: rules } = useQuery({
    queryKey: ["rules"],
    queryFn: () => attributionClient.getRules(),
  });
  const { data: providers } = useQuery({
    queryKey: ["providers"],
    queryFn: () => attributionClient.listProviders(),
  });
  const { data: domains } = useQuery({
    queryKey: ["domains"],
    queryFn: () => attributionClient.listDomains(),
  });

  async function patch(update: Partial<AttributionRulesConfig>, message: string) {
    await attributionClient.updateRules(update);
    toast.success(message);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Configuration"
        title="Attribution rules, domains and providers"
        description="Rules are configuration, not code buried in screens. The attribution engine reads these values at resolution time."
      />

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules &amp; providers</TabsTrigger>
          <TabsTrigger value="contract">Production contract</TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="mt-6">
          <Panel
            title="Attribution rules"
            subtitle={
              rules
                ? `Default conflict rule: ${titleCase(labelForRule(rules.conflict_rule))}`
                : undefined
            }
          >
            {rules ? (
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <Label className="label-eyebrow">Click attribution window (days)</Label>
                  <Input
                    type="number"
                    className="mt-2"
                    defaultValue={rules.click_attribution_window_days}
                    onBlur={(e) =>
                      void patch(
                        { click_attribution_window_days: Number(e.target.value) || 30 },
                        "Click attribution window updated",
                      )
                    }
                  />
                </div>
                <div>
                  <Label className="label-eyebrow">Install → Signup window (days)</Label>
                  <Input
                    type="number"
                    className="mt-2"
                    defaultValue={rules.install_to_signup_window_days}
                    onBlur={(e) =>
                      void patch(
                        { install_to_signup_window_days: Number(e.target.value) || 30 },
                        "Install → signup window updated",
                      )
                    }
                  />
                </div>
                <div>
                  <Label className="label-eyebrow">Click attribution precedence</Label>
                  <Select
                    value={rules.conflict_rule}
                    onValueChange={(v) =>
                      void patch(
                        { conflict_rule: v as AttributionRulesConfig["conflict_rule"] },
                        "Conflict rule updated",
                      )
                    }
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LAST_ELIGIBLE_DETERMINISTIC">
                        Last eligible deterministic acquisition
                      </SelectItem>
                      <SelectItem value="FIRST_ELIGIBLE_DETERMINISTIC">
                        First eligible deterministic acquisition
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="label-eyebrow">Duplicate handling</Label>
                  <Select
                    value={rules.duplicate_conversion_handling}
                    onValueChange={(v) =>
                      void patch(
                        {
                          duplicate_conversion_handling:
                            v as AttributionRulesConfig["duplicate_conversion_handling"],
                        },
                        "Duplicate handling updated",
                      )
                    }
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ONE_PER_TENANT">One conversion per tenant</SelectItem>
                      <SelectItem value="ALLOW_MULTIPLE">Allow multiple conversions</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 px-4 py-3 sm:col-span-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Deterministic takes precedence over claimed
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      When on, a recovered install referrer wins over a manually entered referral
                      code.
                    </p>
                  </div>
                  <Switch
                    checked={rules.deterministic_precedence_over_claimed}
                    onCheckedChange={(checked) =>
                      void patch(
                        { deterministic_precedence_over_claimed: checked },
                        "Precedence updated",
                      )
                    }
                  />
                </div>
                <div>
                  <Label className="label-eyebrow">Unattributed behaviour</Label>
                  <Select
                    value={rules.unattributed_behavior}
                    onValueChange={(v) =>
                      void patch(
                        {
                          unattributed_behavior:
                            v as AttributionRulesConfig["unattributed_behavior"],
                        },
                        "Unattributed behaviour updated",
                      )
                    }
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RECORD_UNATTRIBUTED">
                        Record as unattributed (never assume a partner)
                      </SelectItem>
                      <SelectItem value="ASSIGN_HOUSE">Assign to house / owned channel</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="label-eyebrow">Disabled link behaviour</Label>
                  <Select
                    value={rules.disabled_link_behavior}
                    onValueChange={(v) =>
                      void patch(
                        {
                          disabled_link_behavior:
                            v as AttributionRulesConfig["disabled_link_behavior"],
                        },
                        "Disabled link behaviour updated",
                      )
                    }
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="REJECT">Reject future clicks</SelectItem>
                      <SelectItem value="REDIRECT_FALLBACK">
                        Redirect to fallback destination
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
          </Panel>

          <Panel
            className="mt-6"
            title="Domains"
            subtitle="Short-link domain used for public tokens"
          >
            {(domains ?? []).map((d) => (
              <div key={d.domain} className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="mono-token text-foreground">{d.domain}</p>
                  <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                    Simulated / Not connected
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="label-eyebrow">DNS</dt>
                    <dd className="mt-1 text-foreground">{d.dns_status}</dd>
                  </div>
                  <div>
                    <dt className="label-eyebrow">Android App Links</dt>
                    <dd className="mt-1 text-foreground">{d.android_app_link}</dd>
                  </div>
                  <div>
                    <dt className="label-eyebrow">Apple Universal Links</dt>
                    <dd className="mt-1 text-foreground">{d.apple_universal_link}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </Panel>

          <Panel
            className="mt-6"
            title="Providers"
            subtitle="Attribution capability sits behind a provider boundary so implementations can be swapped."
          >
            <div className="space-y-3">
              {(providers ?? []).map((p) => (
                <div
                  key={p.provider_id}
                  className="rounded-md border border-border bg-muted/30 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{p.name}</p>
                      <p className="label-eyebrow mt-1">
                        {p.type === "NATIVE" ? "Native" : "External attribution provider"}
                      </p>
                    </div>
                    <span
                      className={
                        p.status === "ACTIVE_SIMULATED"
                          ? "rounded-full border border-deterministic/40 bg-deterministic/10 px-2.5 py-0.5 text-xs text-deterministic"
                          : "rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                      }
                    >
                      {p.status === "ACTIVE_SIMULATED"
                        ? "Active / Simulated"
                        : p.status === "NOT_CONFIGURED"
                          ? "Not configured"
                          : "Planned"}
                    </span>
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {p.capabilities.map((c) => (
                      <li
                        key={c}
                        className="rounded border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {c}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-muted-foreground">{p.note}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    disabled={!p.configurable}
                    onClick={() =>
                      toast.info("Provider configuration is simulated in V1.", {
                        description: p.name,
                      })
                    }
                  >
                    Configure provider
                  </Button>
                </div>
              ))}
            </div>
            <SourceNote system="Aurumi platform architecture">
              iOS deferred deep-link attribution through App Store installation is
              provider-dependent and treated as a future capability.
            </SourceNote>
          </Panel>
        </TabsContent>
        <TabsContent value="contract" className="mt-6">
          <ProductionContract />
        </TabsContent>
      </Tabs>
    </div>
  );
}
