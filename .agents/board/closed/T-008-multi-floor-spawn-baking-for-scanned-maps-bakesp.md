---
id: 'T-008'
title: 'Multi-floor spawn baking for scanned maps (?bakeSpawns=1)'
status: 'closed'
priority: 40
depends_on: ['T-007']
route: 'frontend'
acceptance_criteria: ['bakeSpawns(map, physics, { spacing = 3 }) casts down on an XZ grid over the map bbox from just above bbox.max.y. After each hit it re-casts from 0.05 m below the hit, so it collects every floor in the column (bowl tiers, concourses, landings)', 'A candidate is kept only if: hit normal.y > 0.85; there are at least 2.0 m of headroom (upward ray from hit+0.05 hits nothing closer); there is at least 0.6 m of horizontal clearance at 1.0 m height (8 rays); and it is at least `spacing` from kept points', 'Candidates with no ceiling within 30 m are dropped (roof and outside), unless no candidate anywhere has a ceiling (then this filter is skipped)', 'Yaw faces the bbox centre: yaw = atan2(x - cx, z - cz), the convention in shared/src/net.ts', 'Game: when `new URLSearchParams(location.search).get(''bakeSpawns'') === ''1''` and offline and not testmap, run the bake after load. Log the count, console.log JSON shaped like MapSpawn[] ready to paste into MAPS[id].spawns, and add small debug sphere markers to the scene', 'Pure helpers (grid points, min-distance filter, yaw-to-centre) are exported without Rapier dependencies', 'The client build passes']
files_hint: ['client/src/map/bakeSpawns.ts', 'client/src/engine/Game.ts']
context_files: []
skills: []
group: ''
conflicts_with: []
max_diff_lines: 0
max_output_tokens: 0
depth: 1
attempts: 2
review_cycles: 1
branch: 'agent/t-008'
base: 'main'
lease_until: ''
spec: 'findGroundSpawns only finds one floor per column, which is useless for a multi-level arena. This dev tool bakes good random respawn points for a human to paste into shared/src/maps.ts. Call physics.world.step() before raycasting if the query pipeline may be stale. Use Rapier''s world.castRayAndGetNormal like findGroundSpawns in loadMap.ts.'
last_review_summary: ''
blocking_issues: []
created_at: '2026-10-03T14:16:56Z'
updated_at: '2026-10-03T14:38:10Z'
history: [{at: '2026-10-03T14:23:57Z', note: 'claimed'}, {at: '2026-10-03T14:25:54Z', note: 'updated'}, {at: '2026-10-03T14:25:54Z', note: 'retry 1/2: verify failed (npx -y pnpm@10 --filter client build): > client@0.0.1 build /Users/manu/Developer/prompt-wars/.agents/worktrees/T-008/client > tsc --noEmit && vite build  src/engine/Game.ts(342,30): error TS2741: Property ''bbox'' is missing in type ''GameMap'' but required in type ''BakeableMap''. /Users/manu/Developer/prompt-wars/.agents/worktrees/T-008/client:  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  client@0.0.1 build: `tsc --noEmit && vite build` Exit status 1'}, {at: '2026-10-03T14:26:30Z', note: 'claimed'}, {at: '2026-10-03T14:29:17Z', note: 'updated'}, {at: '2026-10-03T14:29:17Z', note: 'worker produced changes'}, {at: '2026-10-03T14:29:22Z', note: 'updated'}, {at: '2026-10-03T14:29:22Z', note: 'changes requested (cycle 1)'}, {at: '2026-10-03T14:29:23Z', note: 'claimed'}, {at: '2026-10-03T14:31:13Z', note: 'updated'}, {at: '2026-10-03T14:31:13Z', note: 'failed: verify failed (npx -y pnpm@10 --filter client build): > client@0.0.1 build /Users/manu/Developer/prompt-wars/.agents/worktrees/T-008/client > tsc --noEmit && vite build  src/map/bakeSpawns.test.ts(1,38): error TS2307: Cannot find module ''vitest'' or its corresponding type declarations. /Users/manu/Developer/prompt-wars/.agents/worktrees/T-008/client:  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  client@0.0.1 build: `tsc --noEmit && vite build` Exit status 1'}, {at: '2026-10-03T14:31:37Z', note: 'updated'}, {at: '2026-10-03T14:31:37Z', note: 'manually reopened for rework (fresh branch)'}, {at: '2026-10-03T14:33:18Z', note: 'claimed'}, {at: '2026-10-03T14:35:34Z', note: 'updated'}, {at: '2026-10-03T14:35:34Z', note: 'retry 1/2: verify failed (npx -y pnpm@10 --filter client build): > client@0.0.1 build /Users/manu/Developer/prompt-wars/.agents/worktrees/T-008/client > tsc --noEmit && vite build  src/map/bakeSpawns.ts(107,28): error TS2339: Property ''bbox'' does not exist on type ''GameMap''. /Users/manu/Developer/prompt-wars/.agents/worktrees/T-008/client:  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  client@0.0.1 build: `tsc --noEmit && vite build` Exit status 1'}, {at: '2026-10-03T14:35:35Z', note: 'claimed'}, {at: '2026-10-03T14:38:07Z', note: 'updated'}, {at: '2026-10-03T14:38:07Z', note: 'worker produced changes'}, {at: '2026-10-03T14:38:10Z', note: 'review approved and merged'}]
---

findGroundSpawns only finds one floor per column, which is useless for a multi-level arena. This dev tool bakes good random respawn points for a human to paste into shared/src/maps.ts. Call physics.world.step() before raycasting if the query pipeline may be stale. Use Rapier's world.castRayAndGetNormal like findGroundSpawns in loadMap.ts.
