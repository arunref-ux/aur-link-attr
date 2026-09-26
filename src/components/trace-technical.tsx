import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Panel } from "@/components/bits";
import { attributionClient } from "@/client/attribution-client";
import type { AttributionEvent } from "@/domain/types";
import { formatTime } from "@/lib/format";

/** Collapsed-by-default production-contract view of a trace. */
export function TraceTechnical({
  attributionId,
  events,
}: {
  attributionId: string;
  events: AttributionEvent[];
}) {
  const [open, setOpen] = useState(false);
  const { data: resolutions } = useQuery({
    queryKey: ["resolutions", attributionId],
    queryFn: () => attributionClient.getResolutions(attributionId),
    enabled: open,
  });
  const { data: sessions } = useQuery({
    queryKey: ["acq-sessions", attributionId],
    queryFn: () => attributionClient.getAcquisitionSessions(attributionId),
    enabled: open,
  });
  const { data: attribution } = useQuery({
    queryKey: ["attribution", attributionId],
    queryFn: () => attributionClient.getAttribution(attributionId),
  });

  return (
    <Panel className="mt-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <p className="text-sm font-semibold text-foreground">Technical</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Event identities, resolutions and acquisition identifiers (production contract)
          </p>
        </div>
        <ChevronDown className={open ? "size-4 rotate-180" : "size-4"} />
      </button>
      {open ? (
        <div className="mt-5 space-y-6">
          {attribution && !attribution.acquisition_journey_id ? (
            <p className="rounded-md border border-claimed/40 bg-claimed/10 px-3 py-2 text-xs text-foreground">
              <span className="font-semibold">Legacy simulated journey.</span> This sample predates
              the V1.2 journey lifecycle (no acquisition_journeys, acquisition_sessions or
              signup_bindings rows). Do not use it as a production lifecycle example.
            </p>
          ) : null}
          <section>
            <p className="label-eyebrow mb-2">Acquisition</p>
            <dl className="mono-token grid gap-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">acquisition_journey_id</dt>
                <dd>{attribution?.acquisition_journey_id ?? "— (legacy)"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">link_id</dt>
                <dd>{attribution?.link_id ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">click_id</dt>
                <dd>{attribution?.click_id ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">acquisition_session_id</dt>
                <dd>
                  {sessions?.[0]?.acquisition_session_id ??
                    `${attribution?.session_id ?? "—"} (legacy device session)`}
                </dd>
              </div>
            </dl>
          </section>
          <section>
            <p className="label-eyebrow mb-2">Resolutions</p>
            <Table
              head={["resolution_id", "kind", "method", "rules_version", "resolved_at", "reason"]}
              rows={(resolutions ?? []).map((r) => [
                r.resolution_id,
                r.kind,
                r.method,
                r.rules_version,
                formatTime(r.resolved_at),
                r.reason,
              ])}
            />
          </section>
          <section>
            <p className="label-eyebrow mb-2">Events</p>
            <Table
              head={[
                "event_id",
                "source_system",
                "source_event_id",
                "occurred_at",
                "received_at",
                "schema",
              ]}
              rows={events.map((e) => [
                e.event_id,
                e.source_system,
                e.source_event_id,
                e.occurred_at,
                e.received_at,
                e.schema_version ?? "1",
              ])}
            />
          </section>
        </div>
      ) : null}
    </Panel>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="mono-token w-full text-[11px]">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-left font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border align-top">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-1.5 text-foreground">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
