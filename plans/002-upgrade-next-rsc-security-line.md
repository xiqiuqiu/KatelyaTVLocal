# 002 — Upgrade Next.js off unpatched 14.x RSC line

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: HIGH
- **Category**: Security
- **Rule**: react-doctor/no-vulnerable-react-server-components
- **Estimated scope**: package.json + lockfile + possible App Router breakages; large

## Problem

Lock resolves `next@14.2.x`. React Doctor reports this release line is affected by React Server Components security advisories with **no patched 14.x**. Help text: upgrade to patched Next (e.g. 15.5.18 or 16.2.6).

## Target

Canonical fix: upgrade Next.js to a patched release line so the bundled RSC runtime includes the fix. Do not attempt to patch React alone while staying on unsupported 14.x.

```json
// package.json — target direction (pin exact patched version after checking advisories)
"next": "15.5.18"
```

(Or a newer patched 16.x if the team prefers that line.) Then `pnpm install` and fix compile/runtime breakages.

## Repo conventions to follow

- Use `pnpm` only.
- Follow existing Cloudflare Pages / `pnpm pages:build` flow in CLAUDE.md.
- Prefer incremental codemods (`npx @next/codemod`) over drive-by refactors.

## Steps

1. Confirm current locked version: `pnpm why next`.
2. Choose the lowest-risk patched line compatible with this app (document choice in the PR).
3. Bump `next` (and peer `@next/*` / eslint-config-next if present) in `package.json`; run `pnpm install`.
4. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` (and `pnpm pages:build` if that is the deploy path).
5. Fix only breakages required for green CI (API route types, middleware, `next/image`, etc.). Do not refactor play page in this plan.

## Boundaries

- Do NOT combine with PlayPageClient split (#007) or unrelated UI work.
- Do NOT downgrade React below what the chosen Next requires.
- STOP and report if Cloudflare adapter / OpenNext / Pages constraints block the chosen major; propose the alternate patched line instead of forcing a broken deploy.

## Verification

- **Mechanical**: React Doctor no longer reports `no-vulnerable-react-server-components`. `pnpm build` succeeds.
- **Behavior check**: Smoke `/`, `/search`, `/play` (one source), `/login`, `/admin` in local or preview. Confirm middleware auth still gates protected routes.
- **Done when**: patched Next locked, CI green, smoke paths work.
