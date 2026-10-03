---
id: 'T-001'
title: 'Map pipeline: normalize a GLB scan and emit a collision GLB'
status: 'closed'
priority: 100
depends_on: []
route: 'infra'
acceptance_criteria: ['`node client/scripts/map/process-scan.ts <in.glb|in.gltf> --name <id> [--up y|z] [--scale <n>] [--out <dir>]` writes `<out>/<id>.glb`, `<out>/<id>_collision.glb` and `<out>/<id>.meta.json` (default out: client/public/maps)', 'Normalization: with --up z, rotates -90deg about X so the result is Y-up; applies --scale; translates so the bounding box min.y = 0 and the XZ centre is at the origin. Applied to the scene root, then baked into vertices (gltf-transform `flatten` + `transformMesh`, or similar)', 'The collision GLB has only POSITION and indices (no materials, textures, normals or UVs), all meshes joined into one, welded, with disconnected islands under `--min-island-tris` (default 50) removed', 'meta.json holds { id, source, up, scale, bbox: {min,max}, visualTris, collisionTris, createdAt }', 'Pure helpers (axis matrix, recenter offset from a bbox, triangle counting, island filtering on an index buffer) live in lib.ts and are covered by node:test in lib.test.ts', 'client/package.json gets `"test:scripts": "node --test scripts/map/*.test.ts"`, plus devDependencies @gltf-transform/core, @gltf-transform/functions, @gltf-transform/extensions', '`pnpm --filter client test:scripts` passes, and the client build still passes (scripts/ is NOT added to client tsconfig include)']
files_hint: ['client/package.json', 'client/scripts/map/process-scan.ts', 'client/scripts/map/lib.ts', 'client/scripts/map/lib.test.ts']
context_files: []
skills: []
group: ''
conflicts_with: []
max_diff_lines: 0
max_output_tokens: 0
depth: 1
attempts: 1
review_cycles: 3
branch: 'agent/t-001'
base: 'main'
lease_until: ''
spec: 'Offline asset pipeline that turns a raw 3D scan of the venue (Polycam/Scaniverse/Matterport export) into a game-ready map for the existing loader in client/src/map/loadMap.ts. The loader already looks for `<name>_collision.glb` next to `<name>.glb` and builds Rapier trimesh colliders from it. Use @gltf-transform (NodeIO with ALL_EXTENSIONS). Runs on Node 26 with native TS type stripping: erasable syntax only, explicit .ts extensions on local imports, parse args with node:util parseArgs. Log a short summary at the end (tris before/after, bbox size in metres). Don''t simplify the visual mesh in this card; a later card does that. Collision simplification: only weld + island removal here; add `--collision-ratio` (default 1.0) wired to meshoptimizer `simplify` ONLY if meshoptimizer is already added, otherwise leave a TODO.'
last_review_summary: ''
blocking_issues: []
created_at: '2026-10-03T13:57:21Z'
updated_at: '2026-10-03T14:13:59Z'
history: [{at: '2026-10-03T14:00:05Z', note: 'updated'}, {at: '2026-10-03T14:00:05Z', note: 'worker produced changes'}, {at: '2026-10-03T14:00:12Z', note: 'updated'}, {at: '2026-10-03T14:00:12Z', note: 'changes requested (cycle 2)'}, {at: '2026-10-03T14:00:12Z', note: 'claimed'}, {at: '2026-10-03T14:00:52Z', note: 'updated'}, {at: '2026-10-03T14:00:52Z', note: 'worker produced changes'}, {at: '2026-10-03T14:00:57Z', note: 'updated'}, {at: '2026-10-03T14:00:57Z', note: 'review retries exhausted (3)'}, {at: '2026-10-03T14:01:49Z', note: 'updated'}, {at: '2026-10-03T14:01:49Z', note: 'manually reopened for rework (fresh branch)'}, {at: '2026-10-03T14:01:53Z', note: 'claimed'}, {at: '2026-10-03T14:04:12Z', note: 'updated'}, {at: '2026-10-03T14:04:12Z', note: 'oversize: response truncated at max_output_tokens — split the card into smaller tasks or raise the cap'}, {at: '2026-10-03T14:08:37Z', note: 'updated'}, {at: '2026-10-03T14:08:37Z', note: 'manually reopened for rework (fresh branch)'}, {at: '2026-10-03T14:08:40Z', note: 'claimed'}, {at: '2026-10-03T14:12:48Z', note: 'updated'}, {at: '2026-10-03T14:12:48Z', note: 'worker produced changes'}, {at: '2026-10-03T14:13:59Z', note: 'review approved and merged'}]
---

Offline asset pipeline that turns a raw 3D scan of the venue (Polycam/Scaniverse/Matterport export) into a game-ready map for the existing loader in client/src/map/loadMap.ts. The loader already looks for `<name>_collision.glb` next to `<name>.glb` and builds Rapier trimesh colliders from it. Use @gltf-transform (NodeIO with ALL_EXTENSIONS). Runs on Node 26 with native TS type stripping: erasable syntax only, explicit .ts extensions on local imports, parse args with node:util parseArgs. Log a short summary at the end (tris before/after, bbox size in metres). Don't simplify the visual mesh in this card; a later card does that. Collision simplification: only weld + island removal here; add `--collision-ratio` (default 1.0) wired to meshoptimizer `simplify` ONLY if meshoptimizer is already added, otherwise leave a TODO.
