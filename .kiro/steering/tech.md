# Tech Stack & Build System

## Core Technologies

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript 4.9
- **Styling**: Tailwind CSS 3 + CSS Modules
- **UI Components**: Headless UI, Heroicons, Lucide React
- **Video Player**: ArtPlayer, HLS.js, Vidstack
- **Animation**: Framer Motion
- **State**: React Hooks + Context API
- **Validation**: Zod

## Package Manager

- **pnpm** (required, version 10.12.4+)
- Do not use npm or yarn

## Common Commands

```bash
# Development
pnpm dev              # Start dev server (0.0.0.0:3000)

# Build
pnpm build            # Production build
pnpm pages:build      # Cloudflare Pages build

# Code Quality
pnpm lint             # Run ESLint
pnpm lint:fix         # Fix lint issues + format
pnpm typecheck        # TypeScript type checking
pnpm format           # Prettier formatting
pnpm format:check     # Check formatting

# Testing
pnpm test             # Run Jest tests
pnpm test:watch       # Watch mode

# Scripts
pnpm gen:runtime      # Generate runtime config from config.json
pnpm gen:manifest     # Generate PWA manifest
```

## Code Style

- Single quotes, 2-space indent, semicolons required
- Import sorting via `simple-import-sort` (auto-organized groups)
- Unused imports removed automatically
- Prettier + ESLint enforced via Husky pre-commit hooks

## Path Aliases

- `@/*` → `./src/*`
- `~/*` → `./public/*`

## Runtime

- Edge runtime for API routes (`export const runtime = 'edge'`)
- Server components by default, `'use client'` for client components
