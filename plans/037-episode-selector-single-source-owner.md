# 037 — Single owner for source preference / probe state

- **Status**: DONE
- **Commit**: 411e0c2
- **Severity**: HIGH
- **Category**: Maintainability & architecture
- **Rule**: react-doctor/no-mirror-prop-effect (+ Beyond: duplicated ownership)
- **Estimated scope**: 2 files (`EpisodeSelector.tsx`, maybe `play/page.tsx`), medium–large

## Problem

Canonical (`no-mirror-prop-effect`):

> Delete both the `useState` and the `useEffect` and read the prop directly
> while rendering. Copying a prop into state shows the old value on the first
> render before the effect catches up.

Parent already computes and holds preference/probe results:

```ts
// src/app/play/page.tsx:574-578 — current
// 保存优选时的测速结果，避免EpisodeSelector重复测速
const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<…>(…);
const [precomputedSourceStatuses, setPrecomputedSourceStatuses] = useState<…>(…);
```

Child still mirrors those props into local maps:

```ts
// src/components/EpisodeSelector.tsx:537-599 — current
useEffect(() => {
  if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
    setVideoInfoMap((prev) => { /* merge */ });
    setAttemptedSources((prev) => { /* merge */ });
    setSourceStatusMap((prev) => { /* merge */ });
  }
}, [precomputedVideoInfo]);

useEffect(() => {
  if (precomputedSourceStatuses && precomputedSourceStatuses.size > 0) {
    setSourceStatusMap((prev) => { /* merge */ });
  }
}, [precomputedSourceStatuses]);
```

And when the「换源」tab opens, it runs a second full preference +
`probeSourcePlayback` pipeline (`:623+`), duplicating the parent’s
`fetchSourcePreferencesInBatches` work. Two writers → stale rows, double
network, hard-to-reason switcher UI.

## Target

**Ownership rule:** `PlayPageClient` is the sole writer of source preference /
status maps. `EpisodeSelector` is read-mostly for those maps; any incremental
UI-only probing must call up via a prop callback or be deleted when parent data
already covers `availableSources`.

Concrete end state:

1. Remove the two mirror `useEffect`s (`:537`, `:601`).
2. Derive render maps without copying props into state on a delay:

```ts
// target — illustrative
function mergeStatusMaps(
  base: Map<string, SourceStatus> | undefined,
  local: Map<string, SourceStatus>
): Map<string, SourceStatus> {
  if (!base || base.size === 0) return local;
  const next = new Map(base);
  local.forEach((value, key) => {
    // only overlay local keys that are fresher / still probing if you must keep local
    if (!next.has(key) || next.get(key)?.kind === 'idle') next.set(key, value);
  });
  return next;
}

const displayVideoInfoMap = mergeVideoInfoMaps(precomputedVideoInfo, videoInfoMap);
const displaySourceStatusMap = mergeStatusMaps(precomputedSourceStatuses, sourceStatusMap);
```

Use `display*` in JSX / ranking. Prefer deleting local maps entirely if the
sources-tab effect is removed or lifted.

3. Gate or delete the sources-tab preference effect (`:623`):

```ts
// target gate
useEffect(() => {
  if (activeTab !== 'sources' || availableSources.length === 0) return;

  const allCovered = availableSources.every((source) => {
    const key = getSourceIdentityKey(source.source, source.id);
    return precomputedSourceStatuses?.has(key) || precomputedVideoInfo?.has(key);
  });
  if (allCovered) return; // parent already owns results — do not re-fetch

  // … existing fetch/probe only for missing keys …
}, [activeTab, availableSources, precomputedSourceStatuses, precomputedVideoInfo, value]);
```

Better (if effort allows in the same PR): move the remaining “probe missing
keys” path into `play/page.tsx` next to the existing batch prefer logic, and
pass updated maps down as props only — EpisodeSelector then has **no**
`fetchSourcePreferencesInBatches` / `probeSourcePlayback` calls.

4. Default prop `availableSources = []` (`:73`) still breaks memo/deps — change
   callers to always pass an array (play page already does) and use
   `availableSources` without a fresh default, or default to a module-scope
   `const EMPTY_SOURCES: SearchResult[] = []`.

## Repo conventions to follow

- Reuse helpers already imported in EpisodeSelector
  (`fetchSourcePreferencesInBatches`, `probeSourcePlayback`,
  `getSourceIdentityKey`, status factories).
- Keep switch-source UX (scores, badges) visually identical.
- Imitate pure merge helpers style in `src/lib/source-preference.ts` if you
  extract merge functions.

## Steps

1. Add `merge*` helpers (module scope in `EpisodeSelector.tsx` or
   `src/lib/source-preference-video-info.ts`).
2. Delete mirror effects at `:537` and `:601`; switch render/read paths to
   merged/display maps (or props-only).
3. Gate sources-tab effect so covered keys never re-probe; ideally lift remaining
   probes to the parent.
4. Fix `availableSources` default to module-scope empty array.
5. Smoke: open play with prefer on → open 换源 tab — network panel shows **no**
   duplicate preference storm; statuses match parent badges.

## Boundaries

- Do NOT rewrite ArtPlayer / initAll (plans 029/030).
- Do NOT fully split `PlayPageClient` line count in this plan.
- Do NOT change `/api/source-preference` contract.
- STOP if EpisodeSelector already became presentational-only; report drift.

## Verification

- **Mechanical**: `no-mirror-prop-effect` clears for the deleted effects;
  `pnpm typecheck`; player sidebar tests if present
  (`src/components/__tests__/player-sidebar.test.tsx`).
- **Behavior check**: DevTools Network — opening 换源 after init prefer does not
  re-issue a full preference batch for already-measured sources. Switching
  source still works; scores/status icons still render.
- **Profiler**: EpisodeSelector updates when parent maps change without a
  one-frame stale mirror flash.
- **Done when**: one writer owns preference/status maps; mirror effects gone.
