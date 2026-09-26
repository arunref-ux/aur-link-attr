/**
 * AttributionClient — the ONLY application-facing boundary for attribution.
 *
 * Screens call this client. Today it is `SimulatedAttributionClient`, which
 * delegates to the in-process simulated backend. A future `HttpAttributionClient`
 * implements the same interface against Aurumi's /api/v1 services, so no screen
 * changes when the real backend ships.
 *
 * Method → production endpoint:
 *   createCampaign        POST  /api/v1/attribution/campaigns          (admin)
 *   createLink            POST  /api/v1/attribution/links              (admin)
 *   disableLink/enable    PATCH /api/v1/attribution/links/{id}         (admin)
 *   overrideAttribution   POST  /api/v1/attributions/{id}/override     (admin)
 *   ingestEvent           POST  /api/v1/attribution/events             (trusted service)
 *   simulateRedirect      GET   https://go.aurumi.ai/x/{token}         (public)
 *   get*/list*            GET   /api/v1/attribution/...                (admin read)
 */

import type { IngestEventRequest, IngestOutcome, RedirectOutcome, ServiceCredential } from "@/backend/contract";
import { simulatedBackend, type RedirectInput } from "@/backend/simulated-backend";
import { store } from "@/data/store";
import type {
  AcquisitionSession,
  AttributionResolution,
  ConversionEvent,
  CurrentAttributionProjection,
} from "@/domain/types";
import { attributionProvider } from "@/providers";

type Api = typeof attributionProvider;

export interface AttributionContractState {
  rules_version: string;
  counts: ReturnType<typeof simulatedBackend.repository.counts>;
}

export interface AttributionClient {
  /* admin writes */
  createCampaign: Api["createCampaign"];
  createLink: Api["createLink"];
  disableLink(linkId: string, actor?: string): Promise<void>;
  enableLink(linkId: string, actor?: string): Promise<void>;
  setLinkStatus: Api["setLinkStatus"];
  shareLink: Api["shareLink"];
  overrideAttribution: Api["overrideAttribution"];
  updateRules: Api["updateRules"];
  /* reads */
  getOverview: Api["getOverview"];
  listCampaigns: Api["listCampaigns"];
  getCampaign: Api["getCampaign"];
  getCampaignPerformance: Api["getCampaignPerformance"];
  listLinks: Api["listLinks"];
  getLinks: Api["listLinks"];
  getLink: Api["getLink"];
  resolveLink: Api["resolveLink"];
  listAttributions: Api["listAttributions"];
  getConversions: Api["listAttributions"];
  getAttribution: Api["getAttribution"];
  getTrace: Api["getAttribution"];
  searchTraces: Api["searchTraces"];
  listEvents: Api["listEvents"];
  previewResolution: Api["previewResolution"];
  getRules: Api["getRules"];
  listProviders: Api["listProviders"];
  listDomains: Api["listDomains"];
  /* production contract */
  ingestEvent(req: IngestEventRequest, credential: ServiceCredential): Promise<IngestOutcome>;
  simulateRedirect(input: RedirectInput): Promise<RedirectOutcome>;
  getResolutions(attributionId: string): Promise<AttributionResolution[]>;
  getCurrentAttribution(attributionId: string): Promise<CurrentAttributionProjection | null>;
  getAcquisitionSessions(attributionId: string): Promise<AcquisitionSession[]>;
  getConversionEvents(tenantId: string): Promise<ConversionEvent[]>;
  getContractState(): Promise<AttributionContractState>;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const p = attributionProvider;

export const simulatedAttributionClient: AttributionClient = {
  createCampaign: (i) => p.createCampaign(i),
  createLink: (i) => p.createLink(i),
  disableLink: (id, actor) => p.setLinkStatus(id, "DISABLED", actor),
  enableLink: (id, actor) => p.setLinkStatus(id, "ACTIVE", actor),
  setLinkStatus: (id, status, actor) => p.setLinkStatus(id, status, actor),
  shareLink: (id, medium) => p.shareLink(id, medium),
  overrideAttribution: (i) => p.overrideAttribution(i),
  updateRules: (patch) => p.updateRules(patch),
  getOverview: (d) => p.getOverview(d),
  listCampaigns: () => p.listCampaigns(),
  getCampaign: (id) => p.getCampaign(id),
  getCampaignPerformance: (id) => p.getCampaignPerformance(id),
  listLinks: (f) => p.listLinks(f),
  getLinks: (f) => p.listLinks(f),
  getLink: (id) => p.getLink(id),
  resolveLink: (t) => p.resolveLink(t),
  listAttributions: (f) => p.listAttributions(f),
  getConversions: (f) => p.listAttributions(f),
  getAttribution: (id) => p.getAttribution(id),
  getTrace: (id) => p.getAttribution(id),
  searchTraces: (q) => p.searchTraces(q),
  listEvents: (f) => p.listEvents(f),
  previewResolution: (c, d) => p.previewResolution(c, d),
  getRules: () => p.getRules(),
  listProviders: () => p.listProviders(),
  listDomains: () => p.listDomains(),

  ingestEvent: async (req, credential) => clone(simulatedBackend.ingestEvent(req, credential)),
  simulateRedirect: async (input) => clone(simulatedBackend.redirect(input)),
  getResolutions: async (id) =>
    clone(simulatedBackend.repository.listResolutions(id).sort((a, b) => a.created_at.localeCompare(b.created_at))),
  getCurrentAttribution: async (id) => clone(store.currentAttribution[id] ?? null),
  getAcquisitionSessions: async (id) => {
    const a = store.attributions.find((x) => x.attribution_id === id);
    return clone(a ? store.acquisitionSessions.filter((s) => s.device_session_id === a.session_id) : []);
  },
  getConversionEvents: async (tenantId) =>
    clone(store.conversionEvents.filter((c) => c.tenant_id === tenantId)),
  getContractState: async () => ({
    rules_version: store.rulesVersion,
    counts: simulatedBackend.repository.counts(),
  }),
};

/** The client the application uses. Swap for HttpAttributionClient in production. */
export const attributionClient: AttributionClient = simulatedAttributionClient;
