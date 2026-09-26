import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";

import { EmptyState, MethodBadge, PageHeader, Panel, StatusPill } from "@/components/bits";
import { Input } from "@/components/ui/input";
import { attributionProvider } from "@/providers";
import { APP_LABEL, CHANNEL_LABEL, formatDate } from "@/lib/format";

export const Route = createFileRoute("/trace/")({
  head: () => ({
    meta: [
      { title: "Trace — Aurumi Link & Attribution" },
      {
        name: "description",
        content:
          "Search any tenant, user, signup, click, install, link token, partner, campaign or transaction and read exactly how it became attributed.",
      },
      { property: "og:title", content: "Trace — Aurumi Link & Attribution" },
      {
        property: "og:description",
        content:
          "Chronological attribution journeys for support, business development, finance investigation and engineering.",
      },
    ],
  }),
  component: TraceSearchPage,
});

const EXAMPLES = ["T-008291", "7DX92KQ", "TX-92883", "Sri Sai", "Aura + Tally"];

function TraceSearchPage() {
  const [query, setQuery] = useState("");
  const { data: results } = useQuery({
    queryKey: ["trace-search", query],
    queryFn: () => attributionProvider.searchTraces(query),
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Trace"
        title="How did this customer get here?"
        description="Search by tenant ID, user ID, signup ID, click ID, install ID, link token, partner, email, campaign or transaction ID."
      />

      <Panel>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="T-008291, 7DX92KQ, TX-92883, accounts@abcmfg.in…"
            className="h-11 pl-9"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="label-eyebrow">Try</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setQuery(ex)}
              className="mono-token rounded border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {ex}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-2">
          {(results ?? []).length === 0 ? (
            <EmptyState title="No matching attribution records" hint="Try another identifier." />
          ) : (
            (results ?? []).slice(0, 40).map((a) => (
              <Link
                key={a.attribution_id}
                to="/trace/$attributionId"
                params={{ attributionId: a.attribution_id }}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-4 py-3 transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {a.tenant_name ?? a.contact_email ?? "Anonymous session"}
                  </p>
                  <p className="mono-token mt-0.5 text-xs text-muted-foreground">
                    {[a.tenant_id, a.user_id, a.click_id, a.install_id].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{APP_LABEL[a.app]}</span>
                  <span>·</span>
                  <span>{a.channel ? CHANNEL_LABEL[a.channel] : "Direct / organic"}</span>
                  <span>·</span>
                  <span>{a.partner_name_snapshot ?? "No partner"}</span>
                  <span>·</span>
                  <span>{formatDate(a.resolution_timestamp)}</span>
                  <MethodBadge method={a.attribution_method} />
                  <StatusPill status={a.status} />
                </div>
              </Link>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
