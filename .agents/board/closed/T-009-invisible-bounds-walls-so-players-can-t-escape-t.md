---
id: 'T-009'
title: 'Invisible bounds walls so players can''t escape through scan holes'
status: 'closed'
priority: 50
depends_on: ['T-007']
route: 'frontend'
acceptance_criteria: ['addBoundsColliders(physics, box: {min:[number,number,number],max:[number,number,number]}, { thickness = 1, ceiling = true }) creates fixed cuboid colliders for 4 walls and an optional ceiling just outside the AABB and returns them', 'Game (non-testmap only) picks the bounds source in this order: the MapDef.bounds whose url matches the loaded map (Object.values(MAPS).find), then this.map.meta?.bbox (added by T-004), then the visual bbox. The chosen box is expanded by 0.5 m. The colliders are pushed into map.colliders so dispose() removes them, and map.killY becomes box.min[1] - 20', 'No visible meshes are added', 'The client build passes']
files_hint: ['client/src/map/bounds.ts', 'client/src/engine/Game.ts']
context_files: []
skills: []
group: ''
conflicts_with: []
max_diff_lines: 0
max_output_tokens: 0
depth: 1
attempts: 1
review_cycles: 1
branch: 'agent/t-009'
base: 'main'
lease_until: ''
spec: 'Phone and Matterport scans have holes (glass, doors, unscanned areas). These invisible walls are a safety net on top of the scan''s trimesh colliders.'
last_review_summary: ''
blocking_issues: []
created_at: '2026-10-03T14:16:56Z'
updated_at: '2026-10-03T14:42:04Z'
history: [{at: '2026-10-03T14:33:09Z', note: 'worker produced changes'}, {at: '2026-10-03T14:33:18Z', note: 'updated'}, {at: '2026-10-03T14:33:18Z', note: 'changes requested (cycle 1)'}, {at: '2026-10-03T14:38:10Z', note: 'claimed'}, {at: '2026-10-03T14:38:10Z', note: 'updated'}, {at: '2026-10-03T14:38:10Z', note: 'failed: branch agent/t-009 is behind main and could not be rebased'}, {at: '2026-10-03T14:38:34Z', note: 'updated'}, {at: '2026-10-03T14:38:34Z', note: 'manually reopened for rework (fresh branch)'}, {at: '2026-10-03T14:38:36Z', note: 'claimed'}, {at: '2026-10-03T14:38:36Z', note: 'updated'}, {at: '2026-10-03T14:38:36Z', note: 'retry 1/2: git worktree add /Users/manu/Developer/prompt-wars/.agents/worktrees/T-009 agent/t-009 failed: Preparing worktree (checking out ''agent/t-009'') fatal: ''agent/t-009'' is already used by worktree at ''/Users/manu/Developer/prompt-wars'''}, {at: '2026-10-03T14:38:36Z', note: 'claimed'}, {at: '2026-10-03T14:38:36Z', note: 'updated'}, {at: '2026-10-03T14:38:36Z', note: 'failed: git worktree add /Users/manu/Developer/prompt-wars/.agents/worktrees/T-009 agent/t-009 failed: Preparing worktree (checking out ''agent/t-009'') fatal: ''agent/t-009'' is already used by worktree at ''/Users/manu/Developer/prompt-wars'''}, {at: '2026-10-03T14:39:14Z', note: 'updated'}, {at: '2026-10-03T14:39:14Z', note: 'manually reopened for rework (fresh branch)'}, {at: '2026-10-03T14:39:16Z', note: 'claimed'}, {at: '2026-10-03T14:42:01Z', note: 'updated'}, {at: '2026-10-03T14:42:01Z', note: 'worker produced changes'}, {at: '2026-10-03T14:42:04Z', note: 'review approved and merged'}]
---

Phone and Matterport scans have holes (glass, doors, unscanned areas). These invisible walls are a safety net on top of the scan's trimesh colliders.
