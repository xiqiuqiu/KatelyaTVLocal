---
name: localStorage Read-Modify-Write Race Condition
description: `rememberSourceDomainPreference` uses read-modify-write pattern on localStorage without atomicity, causing data loss under concurrent probe calls.
type: feedback
---

The `rememberSourceDomainPreference` function in `src/lib/utils.ts` reads, modifies, and writes localStorage. When called concurrently (e.g., `Promise.all` over probe candidates), writes can overwrite each other.

**Why:** `preferBestSource` probes up to 6 sources in parallel via Promise.all, each calling `rememberSourceDomainPreference`. The read then write pattern is not atomic, so interleaving calls lose data.

**How to apply:** When writing to localStorage from concurrent paths, use a write buffer with microtask-based serialization (`queueMicrotask`), or consolidate writes into a single batch call.
