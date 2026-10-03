---
id: 'T-006'
title: 'Server: seed spawn_point from the active map (no schema change)'
status: 'closed'
priority: 20
depends_on: ['T-005']
route: 'backend'
acceptance_criteria: ['In seedWorld, replace the ''Spawn points: seed the TEST MAP spawns'' block. If the stored spawn_point rows don''t match effectiveSpawns(activeMap()) per spawnSetsEqual, delete all rows and insert the active map''s spawns (id 0n, x, y, z, yaw). This also covers the old placeholder-ring migration, so remove the isOldRing special case', 'Imports updated (activeMap, effectiveSpawns, spawnSetsEqual from ''@ai-gaem/shared''); remove TEST_MAP_SPAWN_POINTS from the import only if it becomes unused', 'NO other changes: no table, column, reducer or procedure added, removed or re-signed, and every other line of the file is preserved byte-for-byte. The diff should be roughly 20 lines', 'Server typecheck and client build pass']
files_hint: ['server/src/index.ts']
context_files: []
skills: []
group: ''
conflicts_with: []
max_diff_lines: 0
max_output_tokens: 0
depth: 1
attempts: 1
review_cycles: 0
branch: 'agent/t-006'
base: 'main'
lease_until: ''
spec: 'Lets a human switch maps by changing ACTIVE_MAP_ID in shared/src/maps.ts and republishing; spawn points reseed automatically on init/connect. You must return the COMPLETE file. It is ~790 lines: copy everything outside the seedWorld spawn block exactly as is. Client bindings are generated from this module, so any schema change would break them.'
last_review_summary: ''
blocking_issues: []
created_at: '2026-10-03T14:02:28Z'
updated_at: '2026-10-03T14:06:53Z'
history: [{at: '2026-10-03T14:02:28Z', note: 'created'}, {at: '2026-10-03T14:02:28Z', note: 'updated'}, {at: '2026-10-03T14:04:45Z', note: 'claimed'}, {at: '2026-10-03T14:05:42Z', note: 'updated'}, {at: '2026-10-03T14:05:42Z', note: 'worker produced changes'}, {at: '2026-10-03T14:06:53Z', note: 'review approved and merged'}]
---

Lets a human switch maps by changing ACTIVE_MAP_ID in shared/src/maps.ts and republishing; spawn points reseed automatically on init/connect. You must return the COMPLETE file. It is ~790 lines: copy everything outside the seedWorld spawn block exactly as is. Client bindings are generated from this module, so any schema change would break them.
