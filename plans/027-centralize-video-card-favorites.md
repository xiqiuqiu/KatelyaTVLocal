# 027 — Centralize VideoCard favorite subscriptions

- **Status**: DONE
- **Commit**: 6e7374f
- **Severity**: MEDIUM
- **Category**: Performance
- **Rule**: Beyond the scan
- **Estimated scope**: 3 files, medium

## Problem

Every `VideoCard` independently reads favorite storage and installs a
`favoritesUpdated` subscription.

```ts
// src/components/VideoCard.tsx:152 — current
useEffect(() => {
  if (from === 'douban' || !actualSource || !actualId) return;

  const fetchFavoriteStatus = async () => {
    const nextFavorited = await isFavorited(actualSource, actualId);
    setFavorited(nextFavorited);
  };
  void fetchFavoriteStatus();

  const storageKey = generateStorageKey(actualSource, actualId);
  const unsubscribe = subscribeToDataUpdates(
    'favoritesUpdated',
    (newFavorites: Record<string, Favorite>) => {
      setFavorited(!!newFavorites[storageKey]);
    }
  );
  return unsubscribe;
}, [from, actualSource, actualId]);
```

A list of N cards performs N initial reads/parses and installs N source-event
listeners. One favorite mutation fans out through every component.

## Target

Add `src/lib/favorites-store.client.ts` as one browser-level external store. It
must own exactly one `favoritesUpdated` source subscription while at least one
React consumer exists, deduplicate the initial `getAllFavorites()` request, and
expose a key-selective hook:

```ts
'use client';

import { useSyncExternalStore } from 'react';
import { getAllFavorites, subscribeToDataUpdates } from './db.client';
import type { Favorite } from './types';

let snapshot: Record<string, Favorite> = {};
let loadPromise: Promise<void> | null = null;
let sourceUnsubscribe: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function ensureLoaded() {
  loadPromise ??= getAllFavorites().then((favorites) => {
    snapshot = favorites;
    emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureLoaded();
  sourceUnsubscribe ??= subscribeToDataUpdates(
    'favoritesUpdated',
    (favorites: Record<string, Favorite>) => {
      snapshot = favorites;
      emit();
    }
  );
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      sourceUnsubscribe?.();
      sourceUnsubscribe = null;
    }
  };
}

export function useFavoriteStatus(storageKey: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (storageKey ? Boolean(snapshot[storageKey]) : false),
    () => false
  );
}
```

Add a test-only reset export guarded by naming convention if module state makes
tests leak. `VideoCard` computes its stable storage key and consumes
`useFavoriteStatus`; remove only its favorite-loading effect and local
`favorited` state. Toggle handlers continue calling existing DB mutations and
let the shared event update the UI.

## Repo conventions to follow

- Keep browser storage code in a `'use client'` module beside `db.client.ts`.
- Reuse `getAllFavorites`, `generateStorageKey`, and
  `subscribeToDataUpdates`; do not duplicate backend/cache behavior.
- Follow the event cleanup contract already used in `src/app/page.tsx:157`.

## Steps

1. Add store tests with mocked DB APIs: ten consumers trigger one initial read
   and one source subscription; unrelated key update does not change selected
   snapshots; final unmount unsubscribes.
2. Implement the external store exactly above, including rejected-load handling
   that resets `loadPromise` for retry without throwing during render.
3. Replace `VideoCard`'s `useState`/`useEffect` favorite status with
   `useFavoriteStatus(storageKey)`.
4. Remove now-unused `isFavorited`, `Favorite`, and effect imports only from
   `VideoCard`.
5. Keep optimistic button behavior only if shared-event timing is visibly slow;
   if needed, publish through the existing DB event path rather than adding a
   second card-local authority.
6. Profile a search page with at least 30 cards before and after one favorite
   toggle.

## Boundaries

- Do NOT change favorite persistence, event names, card rendering, or aggregate
  card identity.
- Do NOT add Redux/Zustand/another dependency.
- Do NOT place one Provider around the entire app solely for this state.
- Do NOT make Douban-only cards subscribe when they cannot be favorited.
- STOP if code has drifted from commit `6e7374f`.

## Verification

- **Mechanical**:
  - `pnpm test --runInBand src/lib/favorites-store.client.test.ts src/components/VideoCard.test.tsx`
  - `pnpm typecheck`
  - `pnpm lint:strict` (separate unrelated baseline warnings)
  - `npx react-doctor@latest --scope changed` must not lower the score.
- **Behavior check**: On `/search` with 30+ cards, React Profiler and
  “Highlight updates” should show only the toggled card changing favorite
  presentation. Instrumented mocks or DevTools must show one initial favorites
  load and one source-event subscription, not one per card.
- **Done when**: card count no longer multiplies storage reads/source
  subscriptions and favorite UI remains immediately consistent.
