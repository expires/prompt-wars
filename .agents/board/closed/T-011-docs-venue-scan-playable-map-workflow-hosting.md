---
id: 'T-011'
title: 'Docs: venue scan → playable map workflow + hosting'
status: 'closed'
priority: 90
depends_on: ['T-002', 'T-003', 'T-006', 'T-008', 'T-009', 'T-010']
route: 'docs'
acceptance_criteria: ['New README section ''Venue map'': getting a scan (phone scan with Polycam/Scaniverse/Luma as GLB/OBJ, or an official MatterPak OBJ export from the tour owner); putting raw files in scans/; running client/scripts/map/process-scan.ts with its real flags (include an example for a Z-up OBJ); checking the result offline with `?offline=1&map=/maps/tauron-arena.glb`; baking spawns with `?bakeSpawns=1` and pasting them into shared/src/maps.ts; setting ACTIVE_MAP_ID, republishing (`pnpm --filter @ai-gaem/server publish:maincloud`), and confirming the spawn_point reseed with `spacetime sql`', 'New ''Deploying'' subsection: server on SpacetimeDB Maincloud; client `pnpm --filter client build` → any static host (dist/); map files on a bucket/CDN with CORS allowing GET from the client origin, and VITE_MAP_BASE_URL set at build time', 'Existing content is preserved. The ''Multiplayer always uses the procedural TEST MAP'' sentence is updated to describe the active-map behaviour', 'Only README.md changes']
files_hint: ['README.md']
context_files: []
skills: []
group: ''
conflicts_with: []
max_diff_lines: 0
max_output_tokens: 0
depth: 1
attempts: 1
review_cycles: 0
branch: 'agent/t-011'
base: 'main'
lease_until: ''
spec: 'Document the flow built by the earlier cards accurately, using the flags and names in the merged code. Don''t invent any.'
last_review_summary: ''
blocking_issues: []
created_at: '2026-10-03T14:16:56Z'
updated_at: '2026-10-03T14:43:34Z'
history: [{at: '2026-10-03T14:16:56Z', note: 'created'}, {at: '2026-10-03T14:16:56Z', note: 'updated'}, {at: '2026-10-03T14:42:04Z', note: 'claimed'}, {at: '2026-10-03T14:43:31Z', note: 'updated'}, {at: '2026-10-03T14:43:31Z', note: 'worker produced changes'}, {at: '2026-10-03T14:43:34Z', note: 'review approved and merged'}]
---

Document the flow built by the earlier cards accurately, using the flags and names in the merged code. Don't invent any.
