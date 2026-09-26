/**
 * AttributionRepository — the persistence boundary of the attribution backend.
 *
 * Today: in-memory implementation over the simulated store.
 * Future: a PostgreSQL repository with the same methods, where `transaction`
 * maps to BEGIN … COMMIT / ROLLBACK. UI code never imports this module.
 */

import { applyResolution, nextId, pushEvent, store } from "@/data/store";
import type {
  AcquisitionJourney,
  AcquisitionSession,
  SignupBinding,
  Attribution,
  AttributionEvent,
  AttributionLink,
  AttributionResolution,
  AttributionRulesConfig,
  Campaign,
  Click,
  ConversionEvent,
  IdempotencyRecord,
  Install,
  Partner,
} from "@/domain/types";
import type { ResolutionOutput } from "@/lib/attribution-rules";

export type NewEvent = Parameters<typeof pushEvent>[0];

export interface AttributionLookup {
  attribution_id?: string | undefined;
  acquisition_journey_id?: string | undefined;
  device_session_id?: string | undefined;
  install_id?: string | undefined;
  user_id?: string | undefined;
  signup_id?: string | undefined;
  tenant_id?: string | undefined;
}

export interface AttributionRepository {
  /* links / campaigns */
  findLinkByToken(token: string): AttributionLink | null;
  findCampaign(id: string): Campaign | null;
  findPartner(id: string): Partner | null;
  /* clicks / sessions */
  insertClick(click: Click): void;
  listClicksForDeviceSession(deviceSessionId: string): Click[];
  insertSession(session: AcquisitionSession): void;
  findSessionByToken(token: string): AcquisitionSession | null;
  findSession(id: string): AcquisitionSession | null;
  findSessionByClick(clickId: string): AcquisitionSession | null;
  findSessionByDeviceHint(hint: string): AcquisitionSession | null;
  listClicksForJourney(journeyId: string): Click[];
  /* journeys (canonical subject) + read model */
  insertJourney(journey: AcquisitionJourney): void;
  findJourney(id: string): AcquisitionJourney | null;
  findJourneyBy(q: { user_id?: string | undefined; signup_id?: string | undefined; tenant_id?: string | undefined; install_id?: string | undefined }): AcquisitionJourney | null;
  insertAttribution(attribution: Attribution): void;
  /* signup bindings */
  insertBinding(binding: SignupBinding): void;
  findBindingByToken(token: string): SignupBinding | null;
  /* installs */
  findInstall(installId: string): Install | null;
  insertInstall(install: Install): void;
  /* events (append-only) + idempotency */
  findIdempotency(sourceSystem: string, sourceEventId: string): IdempotencyRecord | null;
  /** INSERT … ; throws on UNIQUE(source_system, source_event_id). */
  claimIdempotency(record: IdempotencyRecord): void;
  appendEvent(event: NewEvent): AttributionEvent;
  hasEvent(attributionId: string, type: AttributionEvent["event_type"]): boolean;
  /* attributions / resolutions / projection */
  findAttribution(lookup: AttributionLookup): Attribution | null;
  recordResolution(attribution: Attribution, res: ResolutionOutput): AttributionResolution;
  listResolutions(subjectId: string): AttributionResolution[];
  /* conversions */
  insertConversion(conversion: ConversionEvent): void;
  findConversionByTransaction(transactionId: string): ConversionEvent | null;
  /* rules */
  getRules(): AttributionRulesConfig;
  getRulesVersion(): string;
  /* ids */
  nextId(prefix: string, pad?: number): string;
  /* transactions */
  transaction<T>(fn: () => T): T;
  snapshot(): RepositorySnapshot;
  restore(snapshot: RepositorySnapshot): void;
  counts(): RepositoryCounts;
}

export interface RepositoryCounts {
  acquisition_journeys: number;
  signup_bindings: number;
  idempotency_records: number;
  events: number;
  clicks: number;
  acquisition_sessions: number;
  installs: number;
  resolutions: number;
  conversions: number;
  attributions: number;
}

const MUTABLE_TABLES = [
  "clicks",
  "installs",
  "events",
  "attributions",
  "acquisitionSessions",
  "resolutions",
  "conversionEvents",
  "idempotency",
  "links",
  "partners",
  "acquisitionJourneys",
  "signupBindings",
] as const;

export interface RepositorySnapshot {
  tables: Record<(typeof MUTABLE_TABLES)[number], unknown[]>;
  currentAttribution: string;
  rules: string;
  rulesVersion: string;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const simulatedRepository: AttributionRepository = {
  findLinkByToken: (token) => store.links.find((l) => l.token === token) ?? null,
  findCampaign: (id) => store.campaigns.find((c) => c.campaign_id === id) ?? null,
  findPartner: (id) => store.partners.find((p) => p.partner_id === id) ?? null,

  insertClick: (click) => {
    store.clicks.push(click);
  },
  listClicksForDeviceSession: (id) => store.clicks.filter((c) => c.session_id === id),
  insertSession: (session) => {
    if (
      store.acquisitionSessions.some(
        (s) => s.public_acquisition_token === session.public_acquisition_token,
      )
    ) {
      throw new Error("UNIQUE violation: acquisition_sessions.public_acquisition_token");
    }
    store.acquisitionSessions.push(session);
  },
  findSessionByToken: (token) =>
    store.acquisitionSessions.find((s) => s.public_acquisition_token === token) ?? null,
  findSessionByClick: (id) => {
    const click = store.clicks.find((c) => c.click_id === id);
    return (
      store.acquisitionSessions.find(
        (s) => s.acquisition_session_id === click?.acquisition_session_id,
      ) ?? null
    );
  },
  findSessionByDeviceHint: (hint) =>
    [...store.acquisitionSessions].reverse().find((s) => s.device_session_id === hint) ?? null,
  listClicksForJourney: (id) => store.clicks.filter((c) => c.acquisition_journey_id === id),
  insertJourney: (j) => {
    if (store.acquisitionJourneys.some((x) => x.acquisition_journey_id === j.acquisition_journey_id))
      throw new Error("UNIQUE violation: acquisition_journeys.id");
    store.acquisitionJourneys.push(j);
  },
  findJourney: (id) => store.acquisitionJourneys.find((j) => j.acquisition_journey_id === id) ?? null,
  findJourneyBy: (q) =>
    store.acquisitionJourneys.find(
      (j) =>
        (q.tenant_id && j.tenant_id === q.tenant_id) ||
        (q.signup_id && j.signup_id === q.signup_id) ||
        (q.user_id && j.user_id === q.user_id) ||
        (q.install_id && j.install_id === q.install_id),
    ) ?? null,
  insertAttribution: (a) => {
    store.attributions.push(a);
  },
  insertBinding: (b) => {
    if (store.signupBindings.some((x) => x.public_token === b.public_token))
      throw new Error("UNIQUE violation: signup_bindings.public_token");
    store.signupBindings.push(b);
  },
  findBindingByToken: (t) => store.signupBindings.find((b) => b.public_token === t) ?? null,
  findSession: (id) =>
    store.acquisitionSessions.find((s) => s.acquisition_session_id === id) ?? null,

  findInstall: (id) => store.installs.find((i) => i.install_id === id) ?? null,
  insertInstall: (install) => {
    if (store.installs.some((i) => i.install_id === install.install_id)) {
      throw new Error("UNIQUE violation: install_signals.install_id");
    }
    store.installs.push(install);
  },

  findIdempotency: (sys, id) =>
    store.idempotency.find((r) => r.source_system === sys && r.source_event_id === id) ?? null,
  claimIdempotency: (record) => {
    if (
      store.idempotency.some(
        (r) => r.source_system === record.source_system && r.source_event_id === record.source_event_id,
      )
    )
      throw new Error("UNIQUE violation: idempotency_records(source_system, source_event_id)");
    store.idempotency.push(record);
  },
  appendEvent: (event) => {
    if (
      event.source_event_id &&
      store.events.some(
        (e) =>
          e.source_system === event.source_system && e.source_event_id === event.source_event_id,
      )
    ) {
      throw new Error("UNIQUE violation: attribution_events(source_system, source_event_id)");
    }
    return pushEvent(event);
  },
  hasEvent: (attributionId, type) =>
    store.events.some((e) => e.attribution_id === attributionId && e.event_type === type),

  findAttribution: (q) =>
    store.attributions.find(
      (a) =>
        (q.attribution_id && a.attribution_id === q.attribution_id) ||
        (q.acquisition_journey_id && a.acquisition_journey_id === q.acquisition_journey_id) ||
        (q.tenant_id && a.tenant_id === q.tenant_id) ||
        (q.signup_id && a.signup_id === q.signup_id) ||
        (q.user_id && a.user_id === q.user_id) ||
        (q.install_id && a.install_id === q.install_id) ||
        (q.device_session_id && a.session_id === q.device_session_id),
    ) ?? null,
  recordResolution: (attribution, res) => applyResolution(attribution, res),
  listResolutions: (id) => store.resolutions.filter((r) => r.acquisition_journey_id === id),

  insertConversion: (c) => {
    if (
      c.transaction_id &&
      c.conversion_type !== "SUBSCRIPTION_STARTED" &&
      store.conversionEvents.some((x) => x.transaction_id === c.transaction_id)
    ) {
      throw new Error("UNIQUE violation: conversion_events.transaction_id");
    }
    store.conversionEvents.push(c);
  },
  findConversionByTransaction: (id) =>
    store.conversionEvents.find((c) => c.transaction_id === id) ?? null,

  getRules: () => store.rules,
  getRulesVersion: () => store.rulesVersion,
  nextId: (prefix, pad) => nextId(prefix, pad),

  /** BEGIN … COMMIT; any throw → ROLLBACK (state restored exactly). */
  transaction(fn) {
    const snap = this.snapshot();
    try {
      return fn();
    } catch (err) {
      this.restore(snap);
      throw err;
    }
  },
  snapshot() {
    const tables = {} as RepositorySnapshot["tables"];
    for (const t of MUTABLE_TABLES) tables[t] = clone(store[t] as unknown[]);
    return {
      tables,
      currentAttribution: JSON.stringify(store.currentAttribution),
      rules: JSON.stringify(store.rules),
      rulesVersion: store.rulesVersion,
    };
  },
  restore(snap) {
    for (const t of MUTABLE_TABLES) {
      const target = store[t] as unknown[];
      target.splice(0, target.length, ...clone(snap.tables[t]));
    }
    store.currentAttribution = JSON.parse(
      snap.currentAttribution,
    ) as typeof store.currentAttribution;
    Object.assign(store.rules, JSON.parse(snap.rules) as AttributionRulesConfig);
    store.rulesVersion = snap.rulesVersion;
  },
  counts: () => ({
    acquisition_journeys: store.acquisitionJourneys.length,
    signup_bindings: store.signupBindings.length,
    idempotency_records: store.idempotency.length,
    events: store.events.length,
    clicks: store.clicks.length,
    acquisition_sessions: store.acquisitionSessions.length,
    installs: store.installs.length,
    resolutions: store.resolutions.length,
    conversions: store.conversionEvents.length,
    attributions: store.attributions.length,
  }),
};
