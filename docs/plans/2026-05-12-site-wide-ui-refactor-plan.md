# Site-Wide UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the KatelyaTV UI into one consistent visual and interaction system across login, homepage, search, category browsing, playback, and settings without breaking the current playback and data flows.

**Architecture:** Keep existing page routes, data fetching, and playback business logic in place wherever possible, but extract the UI into a shared shell plus shared surface primitives so every page consumes the same rules. The implementation should separate visual structure from business logic first, then migrate page-by-page onto the new shell and primitives. The design reference is used as a phased alignment target, not as a reason to blindly replace working flows; any UI change that touches business behavior must first be isolated, reviewed, and verified.

**Tech Stack:** Next.js 14 App Router, React 18, Tailwind CSS, Testing Library + Jest, Lucide React, existing client-side localStorage/session flows.

## Reality Check: 2026-05-15

The source tree and production site have moved ahead of the original unchecked tracker. The top-level checklist below has now been reconciled against current code, production browser checks, and local verification from 2026-05-15. The detailed Task 1-7 sections remain useful as implementation history and reference, but the top-level Phase 0-8 list is the current progress tracker.

Verified as already present in the current implementation and visible on `https://movie.sigclr.com`:

- Shared dark shell with sticky top search, collapsible desktop rail, mobile bottom navigation, and shared page width rules.
- Shared token and primitive layer: `ui-theme.css`, `AppShell`, `PageHeader`, `SectionHeader`, `ActionLink`, `Surface`, `PosterGrid`, card actions, and playback wrappers.
- Homepage, search, Douban, login, user menu, and playback pages are already using the shared visual language in production.
- Search query routing, aggregate search display, Douban category browsing, source probing, unavailable-source blocking, and actual playback still work in the checked production flow.
- Focused tests for shell, card actions, player sidebar, and user menu pass locally.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass locally. `lint` still reports pre-existing warnings in unrelated/debug files and import ordering.

Remaining gaps against `UI_1.0_web.png` and this plan:

- Homepage does not yet have the large hero/recommendation block shown in the web reference.
- Search results do not yet expose the full category tab/filter/selected-card treatment from the reference.
- Playback works and has the new shell/sidebar, but the lower details/recommendations area is not fully aligned with the reference composition.
- A few verification items are still partial: full Jest suite, local `/login` browser screenshot, logout/password-change persistence, and full interaction sweep.

Recommended next development slice:

1. Implement the homepage hero/recommendation block as a visual/structural task using existing fetched content first.
2. Add the search-result category/filter/selected-card polish without changing query or aggregation behavior.
3. Align the playback detail/recommendation composition with the web reference, keeping source switching, episode switching, resume, and favorite flows unchanged.
4. Run the remaining full verification pass and close the final partial checklist items.

---

## Scope

This plan implements:

- A phased design-reference alignment pass against `UI_1.0_web.png`, with explicit business-impact checks before changing behavior
- A shared visual token layer for color, spacing, border radius, shadow, panel opacity, and motion
- A shared app shell for header, desktop navigation, mobile navigation, and page content width rules
- Shared content primitives for section headers, content grids, list states, action links, and card behaviors
- A unified card and section system across homepage, search results, and Douban browsing
- A playback page redesign that keeps source probing, switching, and progress logic working
- A unified settings/menu/login visual treatment
- Automated smoke coverage for shell, cards, search controls, and playback sidebar interactions

This plan does **not** implement:

- Source ranking algorithm changes
- Playback-source business logic changes beyond what is required for UI consistency
- Admin page redesign
- TVBox configuration workflow redesign
- New backend APIs

## Current Code Impact

Shared shell and global styling now exist and are the primary UI path:

- Shell: `src/components/PageLayout.tsx`, `src/components/TopSearchBar.tsx`, `src/components/Sidebar.tsx`, `src/components/MobileBottomNav.tsx`
- Content surfaces: `src/components/VideoCard.tsx`, `src/components/ContinueWatching.tsx`, `src/components/ScrollableRow.tsx`, `src/components/CapsuleSwitch.tsx`, `src/components/DoubanSelector.tsx`
- Page-level consumers: `src/app/page.tsx`, `src/app/search/page.tsx`, `src/app/douban/page.tsx`, `src/app/play/page.tsx`, `src/app/login/page.tsx`
- Settings/menu: `src/components/UserMenu.tsx`
- Global styling: `tailwind.config.ts`, `src/app/globals.css`, `src/styles/globals.css`

The highest-risk files are:

- `src/app/play/page.tsx`
- `src/components/EpisodeSelector.tsx`
- `src/components/VideoCard.tsx`
- `src/components/UserMenu.tsx`

Those files mix visual structure with business behavior, so they should be refactored in contained slices instead of rewritten wholesale.

## Design Alignment Policy

`UI_1.0_web.png` is the visual direction and acceptance reference for the web redesign, but implementation must stay grounded in the current codebase. Alignment happens in phases:

- First align low-risk foundations: tokens, shared surfaces, spacing rhythm, button hierarchy, and typography rules
- Then align shell structure where route behavior and navigation state can stay unchanged
- Then align page sections using existing data sources before introducing new data assumptions
- Only then evaluate deeper layout changes that require moving state, changing component ownership, or changing interaction behavior

Every design-reference gap must be classified before implementation:

- `visual-only`: tokens, spacing, color, radius, typography, card chrome, hover states
- `structural`: layout placement, section order, shell density, card grid/list shape, responsive behavior
- `behavioral`: navigation target, route/query preservation, source switching, resume behavior, settings persistence
- `data-contract`: new fields, new ranking rules, new API data, or extra derived metadata required by the design

Implementation order should prefer `visual-only` and `structural` changes that preserve the current route and data contracts. `behavioral` and `data-contract` changes need their own task, test, and verification path.

## Workload Estimate

This is the working estimate for one engineer already familiar with the repo:

- Task 1 tokens and shell rules: `1.5-2 days`
- Task 2 shell component migration: `1.5-2 days`
- Task 3 shared card and section primitives: `2-3 days`
- Task 4 homepage/search/Douban migration: `2-3 days`
- Task 5 playback page migration: `3-5 days`
- Task 6 login and settings/menu migration: `1.5-2 days`
- Task 7 verification and cleanup: `1-2 days`

Expected total: `13-19 working days`

## Execution TODO List

Use this checklist as the top-level rollout tracker. Detailed implementation steps remain in Tasks 1-7 below.

### Phase 0: Baseline and guardrails

- [ ] Create a dedicated worktree or branch for the UI refactor
- [x] Confirm the current baseline passes `pnpm typecheck` (verified 2026-05-15)
- [x] Confirm the current baseline passes `pnpm lint` (verified 2026-05-15; existing warnings remain)
- [x] Confirm the current baseline passes `pnpm build` (verified 2026-05-15)
- [ ] Capture current browser screenshots for `/login`, `/`, `/search?q=庆余年`, `/douban?type=movie`, and `/play` (partial: production screenshots captured for `/`, `/search`, `/douban`, `/play`, and mobile `/play`; `/login` still pending)
- [x] Freeze the redesign direction: dark cinematic shell, one card system, one action hierarchy, one overlay language
- [x] Treat `UI_1.0_web.png` as the phased visual acceptance reference for web layout, tokens, card states, and page density
- [x] For each design-reference gap, classify it as `visual-only`, `structural`, `behavioral`, or `data-contract` before implementation
- [x] Do not start a behavioral or data-contract change until the current business flow and rollback risk are documented

### Phase 1: Lock shared design rules

- [x] Add shared UI tokens for background, surface, border, text, accent, radius, shadow, and motion using the exact web design-reference values
- [x] Import the token layer into the app root
- [x] Extend Tailwind with shared UI radii and shadows
- [x] Define the canonical nav item list in one shared file
- [x] Define shared page titles and section labels in one shared file
- [x] Add a shared shell component contract
- [ ] Remove or quarantine legacy purple/rainbow/global styles that conflict with the design-reference token system (needs final drift audit)

### Phase 2: Replace the global shell

- [x] Convert `PageLayout` into a thin wrapper around the new shell
- [x] Rebuild the top header with one consistent search region and tool region
- [x] Restyle the desktop sidebar toward the compact icon rail shown in `UI_1.0_web.png`, while keeping active-route and navigation behavior unchanged
- [x] Restyle the mobile bottom nav to the new shell rules
- [x] Keep active-route behavior unchanged during the visual migration
- [x] Add or update shell tests before continuing to page-level work

### Phase 3: Standardize shared content primitives

- [x] Create a shared page header component
- [x] Create a shared section header component
- [x] Create a shared inline action link component for buttons like `查看更多`
- [x] Create a shared surface wrapper for panels and cards
- [x] Create a shared poster grid component
- [x] Create a shared card action group component
- [x] Move repeated spacing, heading, and section action patterns onto these primitives

### Phase 4: Rebuild the card system

- [x] Refactor `VideoCard` so the primary click target is explicit
- [x] Keep favorite/delete/play interactions from bubbling into wrong route changes
- [x] Unify title, subtitle, badge, overlay, and hover behavior across all card modes
- [x] Keep search, Douban, favorite, and continue-watching business logic intact
- [x] Restyle `ContinueWatching` to use the shared section/header primitives
- [x] Restyle `ScrollableRow` to match the new shell and action language
- [x] Add card interaction tests before migrating pages that consume the card

### Phase 5: Migrate browse pages

- [x] Refactor the homepage onto shared page and section primitives
- [x] Evaluate the homepage hero/recommendation area from `UI_1.0_web.png` against current available data before implementation
- [ ] Restore the homepage hero/recommendation area using existing fetched content first; if new ranking/data is needed, split it into a separate data-contract task
- [x] Restore the `继续观看` row near the top of the homepage, using existing play-record data and the same card density as the design reference
- [x] Replace homepage ad-hoc section actions with the shared `查看更多` action component
- [x] Refactor the search page onto shared page and grid primitives
- [ ] Rebuild the search result page with category tabs, filter/action row, compact result cards, and selected-card state only after confirming current query, aggregation, and result-routing behavior stays unchanged
- [x] Keep the `聚合` toggle behavior in place while restyling it
- [x] Refactor the Douban page onto shared page header, filter surface, and poster grid primitives
- [x] Normalize page spacing and content width across homepage, search, and Douban pages
- [x] Verify browse-page navigation still lands on the same routes and query states

### Phase 6: Rebuild the playback page shell

- [x] Create a visual-only playback header wrapper
- [x] Create a visual-only playback sidebar wrapper
- [ ] Move the playback page layout onto the design-reference playback structure without rewriting source logic (partial: header/player/sidebar migrated; lower details and recommendations still need alignment)
- [x] Keep the player as the primary visual block, but move source chips, episode grid, detail card, and recommendations in stages so source switching, episode switching, resume, and favorite state ownership do not change accidentally
- [x] If matching the design requires moving `EpisodeSelector` state or source-switching ownership, split that into a separate behavioral task with focused tests before changing layout
- [x] Restyle loading, empty, and error states to match the global surface system
- [x] Add explicit labels and stable structure to `EpisodeSelector` tabs and controls
- [x] Keep source switching, episode switching, resume, and favorite flows unchanged
- [x] Verify that the playback page still builds and that state transitions still work after the shell migration

### Phase 7: Unify settings and login

- [x] Restyle the login page as a standalone auth surface using the shared token layer
- [x] Keep single-password and optional username flows unchanged
- [x] Rebuild the user menu with grouped actions and one overlay style
- [x] Rebuild the settings drawer rows so all toggles and inputs share one visual rule set
- [x] Keep localStorage-backed settings behavior unchanged
- [ ] Verify menu, logout, password change, and settings persistence still work (partial: user-menu component test passes; full browser persistence sweep still pending)

### Phase 8: Final consistency pass

- [ ] Run the full test suite
- [x] Run `pnpm typecheck`
- [x] Run `pnpm lint`
- [x] Run `pnpm build`
- [ ] Smoke-test `/login`, `/`, `/search`, `/douban`, and `/play` in the browser (partial: production browser checks passed for `/`, `/search`, `/douban`, `/play`; `/login` pending)
- [ ] Check that `查看更多`, card clicks, `继续观看`, `聚合`, `线路`, and `选集` all follow the agreed interaction rules (partial: production checks covered navigation, card click, search display, source list, and playback; full interaction sweep still pending)
- [ ] Remove any one-off colors, radii, shadows, or button styles that escaped the token system
- [ ] Capture after screenshots for the same key pages used in the baseline (partial: production screenshots captured for key pages except `/login`)
- [x] Compare after screenshots against `UI_1.0_web.png` for token match, shell density, homepage hero, search result layout, playback page structure, and shared card states
- [x] Document any deliberate design-reference deviation with the reason: current data limitation, business-flow risk, responsive constraint, or staged follow-up
- [x] Prepare the implementation summary and any remaining follow-up items

## File Structure

The refactor should introduce a small UI layer instead of continuing to scatter visual rules inline.

**Create**

- `src/styles/ui-theme.css`
  Central CSS custom properties for surfaces, borders, radii, shadows, and motion timing.
- `src/lib/ui/navigation.ts`
  One source of truth for nav items, labels, and page metadata.
- `src/lib/ui/page-meta.ts`
  Shared page titles, subtitles, and section labels for consistent headers.
- `src/components/ui/AppShell.tsx`
  Shared shell container for header, desktop rail, mobile bar, content width, and page spacing.
- `src/components/ui/PageHeader.tsx`
  Shared page title/subtitle/action layout.
- `src/components/ui/SectionHeader.tsx`
  Shared section title plus trailing action link.
- `src/components/ui/ActionLink.tsx`
  Shared functional link/button treatment for “查看更多” and similar actions.
- `src/components/ui/Surface.tsx`
  Shared elevated/frosted panel wrapper.
- `src/components/ui/PosterGrid.tsx`
  Shared desktop/mobile grid behavior for poster-heavy pages.
- `src/components/ui/CardActions.tsx`
  Shared overlay action button grouping for cards.
- `src/components/player/PlayerHeader.tsx`
  Visual-only header region for playback title and primary actions.
- `src/components/player/PlayerSidebar.tsx`
  Visual-only sidebar wrapper for source and episode controls.
- `src/components/__tests__/app-shell.test.tsx`
- `src/components/__tests__/video-card-actions.test.tsx`
- `src/components/__tests__/search-toolbar.test.tsx`
- `src/components/__tests__/player-sidebar.test.tsx`

**Modify**

- `tailwind.config.ts`
- `src/app/layout.tsx`
- `src/app/globals.css`
- `src/styles/globals.css`
- `src/components/PageLayout.tsx`
- `src/components/TopSearchBar.tsx`
- `src/components/Sidebar.tsx`
- `src/components/MobileBottomNav.tsx`
- `src/components/VideoCard.tsx`
- `src/components/ContinueWatching.tsx`
- `src/components/ScrollableRow.tsx`
- `src/components/CapsuleSwitch.tsx`
- `src/components/DoubanSelector.tsx`
- `src/components/EpisodeSelector.tsx`
- `src/components/UserMenu.tsx`
- `src/app/page.tsx`
- `src/app/search/page.tsx`
- `src/app/douban/page.tsx`
- `src/app/play/page.tsx`
- `src/app/login/page.tsx`

## Visual Rules To Lock Before Coding

These rules are part of the implementation, not optional polish:

- `UI_1.0_web.png` is the web visual reference until a newer design reference replaces it; it guides phased alignment, not blind page replacement
- The web shell should move toward the compact icon rail and dense cinematic content layout, but route behavior and current navigation state must remain stable during each step
- One shell language across all pages:
  sticky top header, desktop side rail, lighter mobile bottom bar, fixed content width behavior
- One surface language:
  `plain`, `raised`, `frosted`, `critical`, `success`
- One action hierarchy:
  `primary`, `secondary`, `quiet`, `inline-link`
- One poster/card language:
  same aspect ratio, same title treatment, same badge placement, same hover depth, same loading state
- One section language:
  title left, action right, fixed spacing rhythm
- One overlay language:
  menus, drawers, and modals use the same spacing, corners, close affordance, and backdrop rules
- One motion language:
  `120ms` hover, `180ms` open/close, `240ms` page section reveal

## Design Reference Tokens

These values come from `UI_1.0_web.png` and are the target token values for the next low-risk alignment pass before more page-level migration:

- Background main: `#0B0F14`
- Background elevated: `#121820`
- Card background: `#161D27`
- Border/divider: `#232A36`
- Primary blue: `#3B82F6`
- Warm accent/rating: `#FFB020`
- Success: `#22C55E`
- Primary text: `#E8EDF3`
- Secondary text: `#A3ACB8`
- Radius scale: `8px`, `12px`, `16px`, `20px`

Current implementation values should be treated as drift if they do not map back to these tokens and no deliberate exception is documented.

## Interaction Rules To Lock Before Coding

- “查看更多” always navigates to the matching list page and preserves context
- Content cards always route into the next useful step:
  play-ready item goes to `/play`, browsing list item goes to `/play` by title/year/type
- “继续观看” always resumes directly
- Search “聚合” toggles in place and never hard-refreshes the page
- Playback source switching only refreshes the player region and related sidebar state
- Episode switching keeps sidebar state, scroll position, and active-source context
- Settings toggles update in place, show immediate state, and do not restyle differently per option

## Risk Controls

- Design-reference matching does not override working business flows; preserve current behavior unless a task explicitly says otherwise
- Before changing a layout that owns state, identify where the state currently lives and whether the change is visual-only, structural, behavioral, or data-contract
- Do not rewrite source probing, playback resume, favorites, or search APIs during the UI pass
- Do not replace `VideoCard` in one jump; extract shared visual pieces first
- Do not split `src/app/play/page.tsx` until visual wrappers exist and tests cover the sidebar interactions
- Keep route shapes unchanged: `/`, `/search`, `/douban`, `/play`, `/login`

---

### Task 1: Introduce the token layer and app shell contract

**Current status:** Complete in current code. Shell contract coverage exists and passed in focused verification on 2026-05-15. Original commit step below is historical and was not re-run.

**Files:**
- Create: `src/styles/ui-theme.css`
- Create: `src/lib/ui/navigation.ts`
- Create: `src/lib/ui/page-meta.ts`
- Create: `src/components/ui/AppShell.tsx`
- Create: `src/components/__tests__/app-shell.test.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/styles/globals.css`
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Write the failing shell contract test**

```tsx
import { render, screen } from '@testing-library/react';

import AppShell from '@/components/ui/AppShell';

jest.mock('@/components/TopSearchBar', () => () => <div data-testid='top-search-bar' />);
jest.mock('@/components/Sidebar', () => () => <div data-testid='desktop-sidebar' />);
jest.mock('@/components/MobileBottomNav', () => () => <div data-testid='mobile-bottom-nav' />);

describe('AppShell', () => {
  it('renders the shared shell regions around page content', () => {
    render(
      <AppShell activePath='/search'>
        <div>search-body</div>
      </AppShell>
    );

    expect(screen.getByTestId('top-search-bar')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-bottom-nav')).toBeInTheDocument();
    expect(screen.getByText('search-body')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --runInBand src/components/__tests__/app-shell.test.tsx`

Expected: FAIL with `Cannot find module '@/components/ui/AppShell'`

- [ ] **Step 3: Create the token layer and shell**

```css
/* src/styles/ui-theme.css */
:root {
  --ui-bg: 8 10 14;
  --ui-surface: 18 22 30;
  --ui-surface-strong: 24 30 40;
  --ui-border: 255 255 255;
  --ui-border-alpha: 0.08;
  --ui-text: 244 247 250;
  --ui-text-muted: 154 163 175;
  --ui-accent: 74 144 226;
  --ui-accent-warm: 245 166 35;
  --ui-radius-sm: 12px;
  --ui-radius-md: 18px;
  --ui-radius-lg: 24px;
  --ui-shadow-soft: 0 12px 32px rgba(0, 0, 0, 0.22);
  --ui-shadow-strong: 0 22px 44px rgba(0, 0, 0, 0.32);
  --ui-motion-fast: 120ms;
  --ui-motion-base: 180ms;
  --ui-motion-slow: 240ms;
}

.ui-app-bg {
  background:
    radial-gradient(circle at top left, rgba(74, 144, 226, 0.16), transparent 32%),
    radial-gradient(circle at top right, rgba(245, 166, 35, 0.10), transparent 28%),
    rgb(var(--ui-bg));
}
```

```ts
/* src/lib/ui/navigation.ts */
export const primaryNavItems = [
  { label: '首页', href: '/' },
  { label: '搜索', href: '/search' },
  { label: '电影', href: '/douban?type=movie' },
  { label: '剧集', href: '/douban?type=tv' },
  { label: '综艺', href: '/douban?type=show' },
] as const;
```

```tsx
/* src/components/ui/AppShell.tsx */
import MobileBottomNav from '@/components/MobileBottomNav';
import Sidebar from '@/components/Sidebar';
import TopSearchBar from '@/components/TopSearchBar';

interface AppShellProps {
  children: React.ReactNode;
  activePath?: string;
}

export default function AppShell({ children, activePath = '/' }: AppShellProps) {
  return (
    <div className='ui-app-bg min-h-screen text-[rgb(var(--ui-text))]'>
      <TopSearchBar />
      <div className='relative'>
        <div className='hidden md:block'>
          <Sidebar activePath={activePath} />
        </div>
        <main className='pb-24 md:pl-64 md:pb-0'>
          <div className='mx-auto w-full max-w-[1600px] px-4 py-4 md:px-6 md:py-6 lg:px-8 lg:py-8'>
            {children}
          </div>
        </main>
      </div>
      <div className='md:hidden'>
        <MobileBottomNav activePath={activePath} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the shell and token imports**

```tsx
/* src/app/layout.tsx */
import './globals.css';
import '@/styles/globals.css';
import '@/styles/ui-theme.css';
```

```ts
/* tailwind.config.ts */
extend: {
  boxShadow: {
    'ui-soft': 'var(--ui-shadow-soft)',
    'ui-strong': 'var(--ui-shadow-strong)',
  },
  borderRadius: {
    'ui-sm': 'var(--ui-radius-sm)',
    'ui-md': 'var(--ui-radius-md)',
    'ui-lg': 'var(--ui-radius-lg)',
  },
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- --runInBand src/components/__tests__/app-shell.test.tsx`

Expected: PASS with `1 passed`

- [ ] **Step 6: Run shell safety checks**

Run: `pnpm typecheck`

Expected: PASS with no TypeScript errors

Run: `pnpm lint`

Expected: PASS with no new lint failures

- [ ] **Step 7: Commit**

```bash
git add tailwind.config.ts src/app/layout.tsx src/app/globals.css src/styles/globals.css src/styles/ui-theme.css src/lib/ui/navigation.ts src/lib/ui/page-meta.ts src/components/ui/AppShell.tsx src/components/__tests__/app-shell.test.tsx
git commit -m "feat: add shared ui token layer and app shell"
```

### Task 2: Migrate the header and navigation components onto the shared shell

**Current status:** Complete in current code. Production shows the shared header, search region, desktop rail, and mobile navigation. Original commit step below is historical and was not re-run.

**Files:**
- Modify: `src/components/PageLayout.tsx`
- Modify: `src/components/TopSearchBar.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/MobileBottomNav.tsx`
- Modify: `src/components/ThemeToggle.tsx`
- Modify: `src/components/SiteProvider.tsx`

- [ ] **Step 1: Write a failing navigation state test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';

import TopSearchBar from '@/components/TopSearchBar';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('q=庆余年'),
}));

jest.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => <div>theme</div> }));
jest.mock('@/components/UserMenu', () => ({ UserMenu: () => <div>user</div> }));

describe('TopSearchBar', () => {
  it('submits the search query from the shared input', () => {
    render(<TopSearchBar />);
    fireEvent.submit(screen.getByRole('search'));
    expect(push).toHaveBeenCalledWith('/search?q=%E5%BA%86%E4%BD%99%E5%B9%B4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --runInBand src/components/__tests__/search-toolbar.test.tsx`

Expected: FAIL because the header does not expose a stable `role="search"` region yet

- [ ] **Step 3: Convert `PageLayout` into a thin adapter over `AppShell`**

```tsx
/* src/components/PageLayout.tsx */
import AppShell from '@/components/ui/AppShell';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
}

export default function PageLayout({ children, activePath = '/' }: PageLayoutProps) {
  return <AppShell activePath={activePath}>{children}</AppShell>;
}
```

- [ ] **Step 4: Rebuild the header and nav components to consume the token layer**

```tsx
/* TopSearchBar shape */
return (
  <header className='sticky top-0 z-[9999] border-b border-white/10 bg-[rgba(10,14,20,0.78)] backdrop-blur-xl'>
    <div className='mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 md:px-6 lg:px-8'>
      <button aria-label='切换侧边栏' className='rounded-ui-sm p-3 text-[rgb(var(--ui-text-muted))] hover:bg-white/5 hover:text-[rgb(var(--ui-text))]' />
      <button className='hidden md:inline-flex text-sm font-semibold tracking-[0.18em] text-[rgb(var(--ui-text))]'>KatelyaTV</button>
      <form role='search' onSubmit={handleSearch} className='mx-auto flex max-w-3xl flex-1 items-center rounded-full border border-white/10 bg-white/5'>
        <input className='h-11 flex-1 bg-transparent px-5 text-sm text-[rgb(var(--ui-text))] placeholder:text-[rgb(var(--ui-text-muted))]' />
        <button type='submit' className='mr-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--ui-accent))] text-white' />
      </form>
    </div>
  </header>
);
```

```tsx
/* Sidebar active item shape */
<Link
  data-active={isActive}
  className='group flex items-center gap-3 rounded-ui-md px-4 py-3 text-sm text-[rgb(var(--ui-text-muted))] transition data-[active=true]:bg-white/8 data-[active=true]:text-[rgb(var(--ui-text))] hover:bg-white/5 hover:text-[rgb(var(--ui-text))]'
>
```

```tsx
/* MobileBottomNav active item shape */
<Link className='relative flex h-16 flex-col items-center justify-center gap-1 text-[11px]'>
  {active && <div className='absolute inset-x-2 inset-y-1 rounded-ui-md border border-white/10 bg-white/7' />}
</Link>
```

- [ ] **Step 5: Run tests and safety checks**

Run: `pnpm test -- --runInBand src/components/__tests__/search-toolbar.test.tsx`

Expected: PASS with `1 passed`

Run: `pnpm typecheck`

Expected: PASS

Run: `pnpm lint`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/PageLayout.tsx src/components/TopSearchBar.tsx src/components/Sidebar.tsx src/components/MobileBottomNav.tsx src/components/ThemeToggle.tsx src/components/SiteProvider.tsx src/components/__tests__/search-toolbar.test.tsx
git commit -m "feat: unify shared header and navigation"
```

### Task 3: Standardize cards, section headers, and content actions

**Current status:** Complete in current code. Card action tests passed in focused verification on 2026-05-15. Original commit step below is historical and was not re-run.

**Files:**
- Create: `src/components/ui/PageHeader.tsx`
- Create: `src/components/ui/SectionHeader.tsx`
- Create: `src/components/ui/ActionLink.tsx`
- Create: `src/components/ui/Surface.tsx`
- Create: `src/components/ui/PosterGrid.tsx`
- Create: `src/components/ui/CardActions.tsx`
- Create: `src/components/__tests__/video-card-actions.test.tsx`
- Modify: `src/components/VideoCard.tsx`
- Modify: `src/components/ContinueWatching.tsx`
- Modify: `src/components/ScrollableRow.tsx`
- Modify: `src/components/CapsuleSwitch.tsx`
- Modify: `src/components/DoubanSelector.tsx`

- [ ] **Step 1: Write a failing card-action test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';

import VideoCard from '@/components/VideoCard';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

describe('VideoCard', () => {
  it('keeps the card click as the primary action and prevents favorite clicks from routing', () => {
    render(
      <VideoCard
        id='1'
        source='test'
        title='示例影片'
        poster='https://example.com/poster.jpg'
        episodes={12}
        source_name='测试源'
        year='2026'
        from='favorite'
      />
    );

    fireEvent.click(screen.getByLabelText('toggle-favorite'));
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('示例影片'));
    expect(push).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --runInBand src/components/__tests__/video-card-actions.test.tsx`

Expected: FAIL because the favorite action does not expose a stable label and the title hit area is not explicit

- [ ] **Step 3: Extract shared card surfaces and section actions**

```tsx
/* src/components/ui/ActionLink.tsx */
interface ActionLinkProps {
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}

export function ActionLink({ href, onClick, children }: ActionLinkProps) {
  const className =
    'inline-flex items-center gap-1 text-sm font-medium text-[rgb(var(--ui-text-muted))] transition hover:text-[rgb(var(--ui-text))]';

  if (href) {
    return <Link href={href} className={className}>{children}</Link>;
  }

  return <button onClick={onClick} className={className}>{children}</button>;
}
```

```tsx
/* VideoCard action grouping */
<button
  aria-label='toggle-favorite'
  onClick={handleToggleFavorite}
  className='inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white backdrop-blur-md'
>
  <Heart className={favorited ? 'fill-red-500 text-red-500' : ''} />
</button>
```

```tsx
/* title hit area */
<button onClick={handleClick} className='mt-3 block w-full text-left'>
  <span className='line-clamp-2 text-sm font-semibold text-[rgb(var(--ui-text))]'>{actualTitle}</span>
</button>
```

- [ ] **Step 4: Migrate row/grid consumers**

```tsx
/* ContinueWatching heading */
<SectionHeader
  title='继续观看'
  action={playRecords.length > 0 ? <ActionLink onClick={clearRecords}>清空</ActionLink> : null}
/>
```

```tsx
/* PosterGrid shape */
export function PosterGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Run tests and checks**

Run: `pnpm test -- --runInBand src/components/__tests__/video-card-actions.test.tsx`

Expected: PASS

Run: `pnpm typecheck`

Expected: PASS

Run: `pnpm lint`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/PageHeader.tsx src/components/ui/SectionHeader.tsx src/components/ui/ActionLink.tsx src/components/ui/Surface.tsx src/components/ui/PosterGrid.tsx src/components/ui/CardActions.tsx src/components/VideoCard.tsx src/components/ContinueWatching.tsx src/components/ScrollableRow.tsx src/components/CapsuleSwitch.tsx src/components/DoubanSelector.tsx src/components/__tests__/video-card-actions.test.tsx
git commit -m "feat: standardize content cards and section actions"
```

### Task 4: Migrate homepage, search, and Douban pages onto the shared templates

**Current status:** Partially complete. Homepage, search, and Douban are on shared templates in code and production, but the homepage hero and full search-result category/filter treatment from `UI_1.0_web.png` remain pending.

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/search/page.tsx`
- Modify: `src/app/douban/page.tsx`
- Modify: `src/lib/ui/page-meta.ts`

- [ ] **Step 1: Write a failing search-results layout test**

```tsx
import { render, screen } from '@testing-library/react';

import SearchPage from '@/app/search/page';

jest.mock('@/components/PageLayout', () => ({ children }: { children: React.ReactNode }) => <div>{children}</div>);

describe('Search page', () => {
  it('renders the shared page title and aggregate control region', () => {
    render(<SearchPage />);
    expect(screen.getByText('搜索结果')).toBeInTheDocument();
    expect(screen.getByText('聚合')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --runInBand src/app/search/page.tsx`

Expected: FAIL because the App Router page export cannot be rendered as-is without a dedicated test wrapper

- [ ] **Step 3: Add a renderable page-content export and migrate the page structure**

```tsx
/* src/app/search/page.tsx */
export function SearchPageContent() {
  return (
    <PageLayout activePath='/search'>
      <div className='space-y-8'>
        <PageHeader
          title='搜索结果'
          action={
            <label className='inline-flex items-center gap-2'>
              <span className='text-sm text-[rgb(var(--ui-text-muted))]'>聚合</span>
              {aggregateToggle}
            </label>
          }
        />
        <PosterGrid>{resultCards}</PosterGrid>
      </div>
    </PageLayout>
  );
}

export default function SearchPage() {
  return <Suspense><SearchPageContent /></Suspense>;
}
```

```tsx
/* homepage section shape */
<SectionHeader
  title='热门电影'
  action={<ActionLink href='/douban?type=movie'>查看更多</ActionLink>}
/>
```

```tsx
/* Douban page title shape */
<PageHeader title={getPageTitle()} subtitle='来自豆瓣的精选内容' />
```

- [ ] **Step 4: Replace ad-hoc grid widths with the shared grid and spacing rhythm**

Run these replacements:

- homepage sections use `PosterGrid`
- search aggregated and non-aggregated results both use `PosterGrid`
- Douban list uses `PosterGrid`
- all section wrappers use `space-y-8` or `space-y-10`

- [ ] **Step 5: Run checks**

Run: `pnpm typecheck`

Expected: PASS

Run: `pnpm lint`

Expected: PASS

Run: `pnpm build`

Expected: PASS and the app still builds after the shared page-structure migration

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/search/page.tsx src/app/douban/page.tsx src/lib/ui/page-meta.ts
git commit -m "feat: migrate browse pages onto shared templates"
```

### Task 5: Redesign the playback page with visual wrappers before touching logic

**Current status:** Partially complete. Playback header/sidebar wrappers are implemented, source and episode flows still work in production, and the player starts successfully. Lower detail and recommendation composition still needs the final visual alignment pass.

**Files:**
- Create: `src/components/player/PlayerHeader.tsx`
- Create: `src/components/player/PlayerSidebar.tsx`
- Create: `src/components/__tests__/player-sidebar.test.tsx`
- Modify: `src/app/play/page.tsx`
- Modify: `src/components/EpisodeSelector.tsx`
- Modify: `src/components/SkipController.tsx`

- [ ] **Step 1: Write a failing playback-sidebar interaction test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';

import EpisodeSelector from '@/components/EpisodeSelector';

describe('EpisodeSelector', () => {
  it('shows the source tab and keeps the selected episode button visible', () => {
    render(
      <EpisodeSelector
        totalEpisodes={24}
        value={3}
        availableSources={[
          {
            id: 'a',
            source: 'source-a',
            title: '示例剧集',
            year: '2026',
            poster: '',
            episodes: ['1.m3u8', '2.m3u8', '3.m3u8'],
            source_name: 'A源',
          } as any,
        ]}
      />
    );

    expect(screen.getByText('选集')).toBeInTheDocument();
    expect(screen.getByText('线路')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第3集' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('线路'));
    expect(screen.getByText('A源')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --runInBand src/components/__tests__/player-sidebar.test.tsx`

Expected: FAIL because the episode buttons and tabs do not expose stable labels yet

- [ ] **Step 3: Extract visual-only playback wrappers**

```tsx
/* src/components/player/PlayerHeader.tsx */
interface PlayerHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function PlayerHeader({ title, subtitle, actions }: PlayerHeaderProps) {
  return (
    <div className='flex flex-col gap-4 rounded-ui-lg border border-white/10 bg-white/5 p-5 shadow-ui-soft lg:flex-row lg:items-start lg:justify-between'>
      <div className='min-w-0'>
        <h1 className='text-2xl font-semibold text-[rgb(var(--ui-text))]'>{title}</h1>
        {subtitle ? <p className='mt-1 text-sm text-[rgb(var(--ui-text-muted))]'>{subtitle}</p> : null}
      </div>
      {actions ? <div className='flex items-center gap-2'>{actions}</div> : null}
    </div>
  );
}
```

```tsx
/* src/components/player/PlayerSidebar.tsx */
export default function PlayerSidebar({ children }: { children: React.ReactNode }) {
  return (
    <aside className='rounded-ui-lg border border-white/10 bg-white/5 p-4 shadow-ui-soft'>
      {children}
    </aside>
  );
}
```

- [ ] **Step 4: Migrate `play/page.tsx` in two passes**

Pass 1, visual extraction only:

- header row moves into `PlayerHeader`
- right column wrapper moves into `PlayerSidebar`
- empty/loading/error states reuse `Surface`
- player stage gets one consistent surface wrapper

Pass 2, stability cleanup without changing logic:

- add explicit labels for source/episode tabs and buttons
- replace ad-hoc collapse buttons with the shared secondary action style
- keep `handleEpisodeChange`, `handleSourceChange`, source probing, and resume logic unchanged

```tsx
/* play/page.tsx layout target */
<PageLayout activePath='/play'>
  <div className='space-y-6'>
    <PlayerHeader title={videoTitle} subtitle={videoYear ? `${videoYear} · 播放中` : '播放中'} actions={headerActions} />
    <div className='grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]'>
      <div className='rounded-ui-lg border border-white/10 bg-black/40 p-3 shadow-ui-strong'>
        {playerStage}
      </div>
      <PlayerSidebar>
        <EpisodeSelector ... />
      </PlayerSidebar>
    </div>
  </div>
</PageLayout>
```

- [ ] **Step 5: Run checks**

Run: `pnpm test -- --runInBand src/components/__tests__/player-sidebar.test.tsx`

Expected: PASS

Run: `pnpm typecheck`

Expected: PASS

Run: `pnpm lint`

Expected: PASS

Run: `pnpm build`

Expected: PASS with playback page compiling cleanly

- [ ] **Step 6: Commit**

```bash
git add src/components/player/PlayerHeader.tsx src/components/player/PlayerSidebar.tsx src/components/EpisodeSelector.tsx src/components/SkipController.tsx src/app/play/page.tsx src/components/__tests__/player-sidebar.test.tsx
git commit -m "feat: redesign playback page shell and sidebar"
```

### Task 6: Unify login, user menu, and settings surfaces

**Current status:** Mostly complete. Login and user menu surfaces are implemented and user-menu component coverage passes. Full browser verification for logout, password change, and settings persistence is still pending.

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/components/UserMenu.tsx`
- Modify: `src/components/ThemeToggle.tsx`

- [ ] **Step 1: Write a failing menu-structure test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';

import { UserMenu } from '@/components/UserMenu';

describe('UserMenu', () => {
  it('opens a shared-surface menu with grouped actions', async () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    expect(await screen.findByText('偏好设置')).toBeInTheDocument();
    expect(screen.getByText('退出登录')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --runInBand src/components/UserMenu.tsx`

Expected: FAIL because the current menu labels and grouping do not match the new shared layout

- [ ] **Step 3: Rebuild the login surface and menu grouping**

```tsx
/* login/page.tsx surface target */
<div className='ui-app-bg flex min-h-screen items-center justify-center px-4'>
  <div className='w-full max-w-md rounded-ui-lg border border-white/10 bg-[rgba(18,22,30,0.82)] p-8 shadow-ui-strong backdrop-blur-2xl'>
    <h1 className='text-center text-3xl font-semibold tracking-[0.12em] text-[rgb(var(--ui-text))]'>{siteName}</h1>
    {loginForm}
  </div>
</div>
```

```tsx
/* UserMenu group target */
<section className='space-y-1'>
  <div className='px-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--ui-text-muted))]'>
    偏好设置
  </div>
  {settingsAction}
</section>
```

The settings drawer keeps the same toggles and storage writes, but all toggle rows share one row component and one visual treatment.

- [ ] **Step 4: Run checks**

Run: `pnpm typecheck`

Expected: PASS

Run: `pnpm lint`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/login/page.tsx src/components/UserMenu.tsx src/components/ThemeToggle.tsx
git commit -m "feat: unify login and settings surfaces"
```

### Task 7: Verify the whole UI system and remove drift

**Current status:** In progress. `pnpm typecheck`, `pnpm lint`, focused UI tests, `pnpm build`, and production browser checks passed on 2026-05-15, but the full Jest suite and remaining browser interaction sweep have not been closed.

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/search/page.tsx`
- Modify: `src/app/douban/page.tsx`
- Modify: `src/app/play/page.tsx`
- Modify: `src/app/login/page.tsx`
- Modify: any touched shared UI component from Tasks 1-6

- [ ] **Step 1: Run the automated quality gates**

Run: `pnpm test -- --runInBand`

Expected: PASS for the full Jest suite

Run: `pnpm typecheck`

Expected: PASS

Run: `pnpm lint`

Expected: PASS

Run: `pnpm build`

Expected: PASS

- [ ] **Step 2: Start the app for manual verification**

Run: `pnpm dev`

Expected: local dev server starts on `http://0.0.0.0:3000`

- [ ] **Step 3: Verify the critical journeys in the browser**

Manual checks:

- login page opens with the new shell-free auth surface
- homepage shows consistent section headers and card behavior
- “查看更多” from homepage lands in the correct Douban list context
- search page preserves query and toggles aggregation in place
- favorite and continue-watching cards still route correctly
- play page keeps source switching, episode switching, resume, and favorite behavior working
- user menu toggles still persist into `localStorage`

- [ ] **Step 4: Fix any cross-page drift before finalizing**

Drift checklist:

- no page uses a stray white panel while the rest use frosted dark surfaces
- no page uses a one-off green button if the action hierarchy says it should be secondary
- no card uses a different badge corner or title spacing
- no menu or drawer uses a unique corner radius or overlay opacity

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/app/search/page.tsx src/app/douban/page.tsx src/app/play/page.tsx src/app/login/page.tsx src/components src/styles tailwind.config.ts
git commit -m "chore: finish site-wide ui refactor verification"
```

## Self-Review

### Spec coverage

Covered requirements:

- strict visual consistency across multiple pages and business flows
- explicit visual and interaction rules before implementation
- assessment of whether existing code can support the redesign
- workload clarity and risk identification
- separation between low-risk restyling and medium/high-risk interaction refactors

No uncovered requirements remain for this planning scope.

### Placeholder scan

Checked for:

- unfinished placeholders
- deferred implementation notes
- cross-task shorthand instead of explicit instructions
- vague validation-only instructions without concrete code or commands

None remain in this plan.

### Type consistency

Shared names used consistently:

- `AppShell`
- `ActionLink`
- `SectionHeader`
- `PosterGrid`
- `PlayerHeader`
- `PlayerSidebar`

The plan keeps routes, page names, and component ownership aligned with the current codebase.
