import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Play, XCircle } from "lucide-react";
import { useState } from "react";

import { Panel } from "@/components/bits";
import { Button } from "@/components/ui/button";
import {
  CONSTRAINTS,
  ENDPOINTS,
  ERROR_CODES,
  EXTERNAL_REFERENCES,
  PRIVACY,
  READINESS,
  RELATIONSHIPS,
  RELEASES,
  SOURCE_AUTHORITY_DOC,
  SYSTEM_FLOW,
  TABLES,
  TRANSACTION_CONTRACT,
  TRUST,
} from "@/backend/contract-docs";
import { attributionClient } from "@/client/attribution-client";
import { runAllScenarios, type ScenarioResult } from "@/client/contract-scenarios";

const pre =
  "mono-token overflow-auto rounded bg-muted/50 p-3 text-[11px] leading-relaxed text-foreground";

export function ProductionContract() {
  const { data: state } = useQuery({
    queryKey: ["contract-state"],
    queryFn: () => attributionClient.getContractState(),
  });
  const [results, setResults] = useState<ScenarioResult[] | null>(null);
  const [running, setRunning] = useState(false);

  return (
    <div className="space-y-6">
      <Panel
        title="Production system flow"
        subtitle="What the real Aurumi services and Android apps implement"
      >
        <ol className="space-y-1.5">
          {SYSTEM_FLOW.map((s, i) => (
            <li key={s.node} className="flex gap-3 text-sm">
              <span className="mono-token w-6 text-right text-muted-foreground">{i + 1}</span>
              <span className="w-64 shrink-0 font-medium text-foreground">{s.node}</span>
              <span className="text-muted-foreground">{s.detail}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">
          Active rules version:{" "}
          <span className="mono-token text-foreground">{state?.rules_version}</span>. Changing a
          rule creates a new version; historical resolutions keep the version they were made under.
        </p>
      </Panel>

      <Panel
        title="API contract (/api/v1)"
        subtitle="Simulated through the client boundary — not deployed"
      >
        <div className="space-y-4">
          {ENDPOINTS.map((e) => (
            <div key={e.method + e.path} className="rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono-token rounded bg-primary/15 px-2 py-0.5 text-xs text-primary">
                  {e.method}
                </span>
                <span className="mono-token text-sm text-foreground">{e.path}</span>
                <span className="label-eyebrow ml-auto">{e.access.replace("_", " ")}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{e.purpose}</p>
              {e.server_generates ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Server generates:{" "}
                  <span className="mono-token">{e.server_generates.join(", ")}</span>
                </p>
              ) : null}
              {e.request || e.response ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {e.request ? (
                    <pre className={pre}>{JSON.stringify(e.request, null, 2)}</pre>
                  ) : null}
                  {e.response ? (
                    <pre className={pre}>{JSON.stringify(e.response, null, 2)}</pre>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Trust boundary" subtitle="Which values are trusted vs server-resolved">
          <List label="Clients submit" items={TRUST.client_submits} />
          <List label="Never trusted from clients" items={TRUST.never_trusted} />
          <List label="Server resolves" items={TRUST.server_resolves} />
        </Panel>
        <Panel
          title="Source authority"
          subtitle="Each producer is authoritative for specific facts"
        >
          <ul className="space-y-2 text-sm">
            {SOURCE_AUTHORITY_DOC.map((s) => (
              <li key={s.source}>
                <p className="mono-token text-xs text-foreground">{s.source}</p>
                <p className="text-muted-foreground">{s.authoritative_for}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="PostgreSQL model" subtitle="Logical tables — documentation, not a database">
        <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
          <div className="grid gap-3 sm:grid-cols-2">
            {TABLES.map((t) => (
              <div key={t.name} className="rounded-md border border-border p-3">
                <p className="mono-token text-sm text-primary">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.purpose}</p>
                <p className="mono-token mt-2 text-[11px] leading-relaxed text-foreground">
                  {t.columns.join(" · ")}
                </p>
                {t.constraints ? (
                  <p className="mono-token mt-2 text-[11px] text-claimed">
                    {t.constraints.join(" · ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          <div>
            <p className="label-eyebrow mb-2">Relationships</p>
            <pre className={pre}>{RELATIONSHIPS}</pre>
            <p className="label-eyebrow mt-4 mb-2">External references</p>
            <p className="text-xs text-muted-foreground">
              {EXTERNAL_REFERENCES.join(", ")} — owned by other systems.
            </p>
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Constraints & indexes">
          <pre className={pre}>{CONSTRAINTS.join("\n")}</pre>
        </Panel>
        <Panel title="Transaction contract" subtitle="Each accepted event is atomic">
          <pre className={pre}>{TRANSACTION_CONTRACT}</pre>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Error model"
          subtitle={'{ "success": false, "error": { "code", "message" } }'}
        >
          <ul className="space-y-1.5 text-xs">
            {ERROR_CODES.map((e) => (
              <li key={e.code} className="flex gap-2">
                <span className="mono-token w-52 shrink-0 text-foreground">{e.code}</span>
                <span className="mono-token w-8 text-muted-foreground">{e.http}</span>
                <span className="text-muted-foreground">{e.meaning}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Privacy contract">
          <List label="Not persisted" items={PRIVACY.not_persisted} />
          <List label="Persisted" items={PRIVACY.persisted} />
          <p className="text-xs text-muted-foreground">{PRIVACY.future}</p>
        </Panel>
      </div>

      <Panel
        title="Contract scenarios"
        subtitle="Runs against the simulated backend and rolls back — no data changes"
        actions={
          <Button
            size="sm"
            disabled={running}
            onClick={async () => {
              setRunning(true);
              setResults(await runAllScenarios());
              setRunning(false);
            }}
          >
            <Play className="size-4" /> Run all
          </Button>
        }
      >
        {results ? (
          <ul className="space-y-2">
            {results.map((r) => (
              <li key={r.id} className="rounded-md border border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  {r.pass ? (
                    <CheckCircle2 className="size-4 text-deterministic" />
                  ) : (
                    <XCircle className="size-4 text-destructive" />
                  )}
                  <p className="text-sm font-medium text-foreground">{r.title}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Expected: {r.expected}</p>
                <p className="mono-token mt-0.5 text-xs text-foreground">Observed: {r.observed}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Duplicate retry, unknown/disabled link, inactive campaign, unknown acquisition token,
            expired window, fail before commit, client-supplied partner, unauthorized source,
            partner unavailable.
          </p>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Production readiness"
          subtitle="Simulated capabilities are not production capabilities"
        >
          <div className="space-y-4">
            {READINESS.map((sec) => (
              <div key={sec.section}>
                <p className="label-eyebrow mb-1.5">{sec.section}</p>
                <ul className="space-y-1 text-sm">
                  {sec.items.map((i) => (
                    <li key={i.label} className="flex justify-between gap-2">
                      <span className="text-foreground">{i.label}</span>
                      <span
                        className={
                          i.status === "PENDING"
                            ? "mono-token text-xs text-muted-foreground"
                            : "mono-token text-xs text-deterministic"
                        }
                      >
                        {i.status.replace("_", " ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Target production releases">
          <div className="space-y-4">
            {RELEASES.map((r) => (
              <div key={r.name}>
                <p className="text-sm font-medium text-foreground">{r.name}</p>
                <p className="mono-token mt-1 text-[11px] text-muted-foreground">
                  {r.scope.join(" · ")}
                </p>
                <p className="mt-1 text-xs text-foreground">{r.outcome}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mb-3">
      <p className="label-eyebrow mb-1">{label}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
