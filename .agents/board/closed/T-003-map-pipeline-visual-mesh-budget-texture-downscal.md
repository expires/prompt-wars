---
id: 'T-003'
title: 'Map pipeline: visual mesh budget, texture downscale, unlit, meshopt compression'
status: 'closed'
priority: 80
depends_on: ['T-001']
route: 'infra'
acceptance_criteria: ['New flags: --visual-tris (default 400000), --collision-tris (default 80000), --max-texture (default 2048), --unlit (default true; --no-unlit to disable), --meshopt (default true)', 'Visual output: dedup, weld, then meshoptimizer simplify toward the --visual-tris budget (ratio computed from the current tri count, clamped to (0,1]). Textures resized to at most --max-texture on the long edge and re-encoded as webp via textureCompress + sharp. KHR_materials_unlit added to every material when --unlit. EXT_meshopt_compression applied when --meshopt', 'Collision output is simplified toward --collision-tris with meshoptimizer (lockBorder false), and is never meshopt-compressed (Rapier needs plain buffers, and the loader decodes either way)', 'meta.json adds { visualTrisBefore, visualTris, collisionTris, textures: count, unlit, meshopt }', 'The ratio helper `simplifyRatio(current, budget)` is unit tested', 'Deps added to client devDependencies: meshoptimizer, sharp', 'test:scripts and the client build pass']
files_hint: ['client/package.json', 'client/scripts/map/process-scan.ts', 'client/scripts/map/optimize.ts', 'client/scripts/map/lib.ts', 'client/scripts/map/lib.test.ts']
context_files: []
skills: []
group: ''
conflicts_with: []
max_diff_lines: 0
max_output_tokens: 0
depth: 1
attempts: 2
review_cycles: 1
branch: 'agent/t-003'
base: 'main'
lease_until: ''
spec: 'Raw venue scans are millions of triangles and hundreds of MB of textures, far too heavy for a browser FPS. Scan textures already have lighting baked in, so render them unlit to avoid double lighting. Put the gltf-transform transform chain in optimize.ts and call it from process-scan.ts after normalization. Print before/after sizes in MB.'
last_review_summary: 'The patch only adds client/scripts/map/optimize.ts. It does not implement the CLI flags, meta.json fields, unit tests for simplifyRatio, dependency additions, or the pipeline wiring required by the acceptance criteria. The file also contains a broken reference (EXTENSION_PLACEHOLDER is undefined) and imports simplifyRatio from ''./lib.ts'' which is not part of the diff.'
blocking_issues: ['Missing CLI flags: --visual-tris, --collision-tris, --max-texture, --unlit/--no-unlit, --meshopt are not defined anywhere in the diff.', 'Missing meta.json changes: { visualTrisBefore, visualTris, collisionTris, textures, unlit, meshopt } are not written by any code in the diff.', 'Missing unit test for simplifyRatio(current, budget) as required by acceptance criteria.', 'Missing dependency additions to client/package.json devDependencies: meshoptimizer and sharp.', 'optimize.ts references undefined identifier EXTENSION_PLACEHOLDER, which will fail typecheck/build.', 'optimize.ts imports simplifyRatio from ''./lib.ts'', but lib.ts is not included in the diff, so the module cannot resolve.', 'The pipeline is not wired into the map script entrypoint; optimizeVisual/optimizeCollision are never invoked, so no acceptance criterion about output behavior can be satisfied.', 'meshopt compression is applied via meshopt({ encoder: meshopt }) which is incorrect usage; the encoder option expects a meshopt encoder instance/function from the meshoptimizer package, not the gltf-transform meshopt transform itself.']
created_at: '2026-10-03T13:57:21Z'
updated_at: '2026-10-03T14:19:02Z'
history: [{at: '2026-10-03T13:57:21Z', note: 'created'}, {at: '2026-10-03T13:57:21Z', note: 'updated'}, {at: '2026-10-03T14:13:59Z', note: 'claimed'}, {at: '2026-10-03T14:14:22Z', note: 'updated'}, {at: '2026-10-03T14:14:22Z', note: 'worker produced changes'}, {at: '2026-10-03T14:15:55Z', note: 'updated'}, {at: '2026-10-03T14:15:55Z', note: 'changes requested (cycle 1)'}, {at: '2026-10-03T14:15:55Z', note: 'claimed'}, {at: '2026-10-03T14:18:58Z', note: 'updated'}, {at: '2026-10-03T14:18:58Z', note: 'worker produced changes'}, {at: '2026-10-03T14:19:02Z', note: 'review approved and merged'}]
---

Raw venue scans are millions of triangles and hundreds of MB of textures, far too heavy for a browser FPS. Scan textures already have lighting baked in, so render them unlit to avoid double lighting. Put the gltf-transform transform chain in optimize.ts and call it from process-scan.ts after normalization. Print before/after sizes in MB.
