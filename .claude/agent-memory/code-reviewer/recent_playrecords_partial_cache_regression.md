---
name: recent playrecords partial cache regression
description: Recent-only fetch path can leave playrecord cache empty and break optimistic delete/update flows.
type: project
---

Recent playrecords API consumption can bypass full cache hydration, then optimistic mutation paths use `{}` as base and emit empty playrecord updates.
**Why:** ContinueWatching switched to recent-only reads, while db.client optimistic mutations assume hydrated cache.
**How to apply:** In reviews touching playrecord cache/event logic, verify recent-only paths do not downgrade full-cache assumptions before delete/save/clear operations.
