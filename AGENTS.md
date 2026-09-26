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
