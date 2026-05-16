---
name: ai-find parity baseline
description: AI find work should be checked against the 2026-05-16 plan for opt-in UI, disabled-mode rejection, and three-tool orchestration.
type: project
---
AI find parity reviews should use the 2026-05-16 plan and assistant doc as the baseline for expected behavior.
**Why:** The implementation can drift while still passing narrow unit tests; the authoritative requirements include opt-in UI, disabled-route rejection, three-tool orchestration, per-candidate grouping, and safety caps.
**How to apply:** When reviewing AI find changes, compare route, orchestrator, web-search safeguards, and UI mode gating against the plan before focusing on style or refactors.
