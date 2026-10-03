---
id: 'T-007'
title: 'Client plays the active map in multiplayer (test-map fallback + warning)'
status: 'closed'
priority: 30
depends_on: ['T-005']
route: 'frontend'
acceptance_criteria: ['main.ts: `mapUrl: params.get(''map'') ?? activeMap().url ?? undefined` in BOTH offline and multiplayer (GameOptions.mapUrl is `string | undefined`; MapDef.url is `string | null`, hence the trailing `?? undefined`). Remove the comment and code that force the test map in multiplayer', 'Game: find the MapDef with `Object.values(MAPS).find((m) => m.url === url)` (no casts; import MAPS and the MapDef type only from ''@ai-gaem/shared''). If found and def.spawns.length > 0, set `this.map.spawns = def.spawns.map((s) => [s.x, s.y, s.z] as Vec3)` instead of the findGroundSpawns guess. Otherwise keep the existing guess', 'If the GLB fails to load while net.authoritative, fall back to the test map and show a persistent HUD warning ''Venue map failed to load — playing test map; spawns may be wrong'' (add a minimal Hud.showWarning(text): a fixed-position div)', 'With ACTIVE_MAP_ID = ''testmap'' (the default), behaviour is identical to today, and client/e2e/multiplayer.spec.ts needs no changes', '`pnpm --filter client build` (tsc --noEmit strict + vite build) passes']
files_hint: ['client/src/main.ts', 'client/src/engine/Game.ts', 'client/src/ui/Hud.ts']
context_files: []
skills: []
group: ''
conflicts_with: []
max_diff_lines: 0
max_output_tokens: 0
depth: 1
attempts: 1
review_cycles: 0
branch: 'agent/t-007'
base: 'main'
lease_until: ''
spec: 'Everyone in a match loads the same venue GLB and spawns at server-known points. A previous attempt failed tsc three times on (1) passing `string | null` where `string | undefined` was expected and (2) casting MapDef arrays. Follow the exact expressions in the acceptance criteria. Keep the diff minimal and return complete file contents.'
last_review_summary: ''
blocking_issues: []
created_at: '2026-10-03T14:16:56Z'
updated_at: '2026-10-03T14:23:57Z'
history: [{at: '2026-10-03T14:16:56Z', note: 'created'}, {at: '2026-10-03T14:16:56Z', note: 'updated'}, {at: '2026-10-03T14:19:02Z', note: 'claimed'}, {at: '2026-10-03T14:23:51Z', note: 'updated'}, {at: '2026-10-03T14:23:51Z', note: 'worker produced changes'}, {at: '2026-10-03T14:23:57Z', note: 'review approved and merged'}]
---

Everyone in a match loads the same venue GLB and spawns at server-known points. A previous attempt failed tsc three times on (1) passing `string | null` where `string | undefined` was expected and (2) casting MapDef arrays. Follow the exact expressions in the acceptance criteria. Keep the diff minimal and return complete file contents.
