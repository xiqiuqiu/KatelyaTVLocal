# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This repo uses a single-context domain docs layout:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Before exploring, read these

- `CONTEXT.md` at the repo root
- ADRs in `docs/adr/` that touch the area being worked on

If a future `CONTEXT-MAP.md` is added, treat it as a signal that the repo has moved to a multi-context layout and follow that map.

## Use the glossary's vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term as defined in `CONTEXT.md`.

If the concept needed is not in the glossary yet, either reconsider whether the term belongs in this project language or use `/domain-modeling` to add it when it has been resolved.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding it.
