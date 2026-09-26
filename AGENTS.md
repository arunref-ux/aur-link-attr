<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Link & Attribution architecture rules

- All external systems (Partner Portal, Demo Studio, Price Admin) are reached only through the provider interfaces in `src/providers/index.ts`; screens never read `src/data/store.ts` directly — so simulated providers can be replaced by real services without UI changes.
- Attribution state lives in the in-memory store `src/data/store.ts` with deterministic seeds; attribution resolution rules stay in `src/lib/attribution-rules.ts` so the configured rule set, not UI code, decides outcomes.
- Commission amounts are never computed or displayed; this system records commission-eligible facts only, because commission logic is owned externally.
- Appearance is controlled by the root `dark` class and the persisted `aurumi-theme` preference, so system, dark, and light modes stay consistent across every screen.
- Every attribution outcome (seeds, journey tester, previews) comes from `resolveAttribution` in `src/lib/attribution-rules.ts`; simulation only records facts (clicks, install signals, claims) and applies the result via `applyResolution` — so configured rules, not simulation code, decide winners and reasons.
- Journeys may start without a link: partner, campaign, link, click and channel are all nullable on an attribution, because unattributed/organic customers are a valid state.
- Referral codes are facts; they reach the engine only as normalized claims produced by the Partner Portal lookup in `src/lib/referral-lookup.ts` (exposed as `partnerProvider.lookupReferralCode`) — so the engine never owns partner master data.
- Simulator IDs come from `nextId` (skips reserved/seeded IDs) and link tokens from `makeUniqueToken`, so interactive data never collides with seeds.
- Domain tests live in `src/**/*.test.ts` and run with `npm test` (standalone `vitest.config.ts`), so domain behavior is verified without loading app plugins.
