---
id: 'T-005'
title: 'Shared map registry (MAPS, ACTIVE_MAP_ID, spawn helpers)'
status: 'closed'
priority: 10
depends_on: []
route: 'backend'
acceptance_criteria: ['shared/src/maps.ts exports `interface MapSpawn {x:number;y:number;z:number;yaw:number}`, `interface MapDef { id: string; url: string | null; collisionUrl?: string; spawns: readonly MapSpawn[]; bounds?: { min: [number,number,number]; max: [number,number,number] }; killY?: number }`, and `MAPS: Record<string, MapDef>` with `testmap` (url null, spawns = TEST_MAP_SPAWN_POINTS imported from ''./net'') and `tauron-arena` (url ''/maps/tauron-arena.glb'', spawns []). Also exports `ACTIVE_MAP_ID = ''testmap''` and `activeMap(): MapDef`', '`spawnSetsEqual(a, b, eps = 1e-3)` (order-insensitive, compares x,y,z) and `effectiveSpawns(def)` (returns TEST_MAP_SPAWN_POINTS when def.spawns is empty) are exported and unit tested in maps.test.ts (vitest)', 'index.ts adds `export * from ''./maps'';`', 'Shared typecheck + tests, server typecheck and client build pass']
files_hint: ['shared/src/maps.ts', 'shared/src/maps.test.ts', 'shared/src/index.ts']
context_files: []
skills: []
group: ''
conflicts_with: []
max_diff_lines: 0
max_output_tokens: 0
depth: 1
attempts: 1
review_cycles: 0
branch: 'agent/t-005'
base: 'main'
lease_until: ''
spec: 'Single source of truth for which map a match runs on, shared by server and client. Pure data + helpers; no server or client changes in this card.'
last_review_summary: ''
blocking_issues: []
created_at: '2026-10-03T14:02:28Z'
updated_at: '2026-10-03T14:04:45Z'
history: [{at: '2026-10-03T14:02:28Z', note: 'created'}, {at: '2026-10-03T14:04:12Z', note: 'claimed'}, {at: '2026-10-03T14:04:43Z', note: 'updated'}, {at: '2026-10-03T14:04:43Z', note: 'worker produced changes'}, {at: '2026-10-03T14:04:45Z', note: 'review approved and merged'}]
---

Single source of truth for which map a match runs on, shared by server and client. Pure data + helpers; no server or client changes in this card.
