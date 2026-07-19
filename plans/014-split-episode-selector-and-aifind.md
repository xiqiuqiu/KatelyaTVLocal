# 014 — Split EpisodeSelector and AiFindPanel ownership

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: MEDIUM
- **Category**: Maintainability & architecture
- **Rule**: react-doctor/no-giant-component
- **Estimated scope**: 2+ files, medium–large

## Problem

Hot-path giants: `EpisodeSelector` (~1489 lines, `:64`) and `AiFindPanel` (~930 lines, `:158`). Changes are high-risk.

## Target

Canonical: pull each section into its own component.

Minimum ship for this plan:

1. **EpisodeSelector**: extract episode grid UI and/or source list into `EpisodeSelectorEpisodes.tsx` / `EpisodeSelectorSources.tsx` under `src/components/` (or `player/`), props-in / callbacks-out.
2. **AiFindPanel**: extract saved-records list UI and/or result groups list into child components; keep orchestration + `activeRunRef` in parent.

Do not rewrite business logic — move JSX/state islands only.

## Repo conventions to follow

- Match existing player component folder patterns.
- Keep tests: update imports in `AiFindPanel.test.tsx` / player-sidebar tests as needed.

## Steps

1. Identify natural JSX boundaries (tabs, lists, modals).
2. Extract EpisodeSelector slice first; keep public export API of `EpisodeSelector` stable.
3. Extract AiFindPanel presentational slice; keep `handleSubmit` in parent.
4. Run focused component tests.

## Boundaries

- Do NOT fold #017 race fix into the same commit unless trivial — prefer #017 first or immediately after.
- Do NOT change search URL contracts.

## Verification

- **Mechanical**: typecheck; focused tests. Line-count warning may remain — OK if ≥1 real extraction each.
- **Behavior check**: Switch sources/episodes on `/play`; run one AI find on `/search` — UI identical.
- **Done when**: extractions components render via parents; smoke OK.
