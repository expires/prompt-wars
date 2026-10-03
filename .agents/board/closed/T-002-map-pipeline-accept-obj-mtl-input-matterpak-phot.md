---
id: 'T-002'
title: 'Map pipeline: accept OBJ+MTL input (MatterPak / photogrammetry exports)'
status: 'closed'
priority: 90
depends_on: ['T-001']
route: 'infra'
acceptance_criteria: ['process-scan.ts accepts a `.obj` input path. Its .mtl and textures are resolved relative to the OBJ, converted to an in-memory glTF document (obj2gltf with binary:true, then NodeIO.readBinary), and run through the same normalize/collision path as GLB input', 'Matterport MatterPak OBJs are Z-up: print a hint recommending `--up z` when the input is OBJ and --up is not given (don''t change the default silently)', 'Inputs that are neither .glb/.gltf nor .obj exit with code 1 and a clear message', 'obj2gltf is added to client devDependencies. Conversion lives in obj.ts and is imported with an explicit .ts extension', 'test:scripts and the client build pass']
files_hint: ['client/package.json', 'client/scripts/map/process-scan.ts', 'client/scripts/map/obj.ts', 'client/scripts/map/lib.test.ts']
context_files: []
skills: []
group: ''
conflicts_with: []
max_diff_lines: 0
max_output_tokens: 0
depth: 1
attempts: 1
review_cycles: 0
branch: 'agent/t-002'
base: 'main'
lease_until: ''
spec: 'Venue scans often come as OBJ + MTL + many JPG textures (Matterport MatterPak, RealityCapture, Polycam OBJ export). Add OBJ input to the existing pipeline from card 1 without duplicating its normalization logic. Keep the obj2gltf call isolated in obj.ts so it can be mocked or skipped.'
last_review_summary: ''
blocking_issues: []
created_at: '2026-10-03T13:57:21Z'
updated_at: '2026-10-03T14:23:54Z'
history: [{at: '2026-10-03T13:57:21Z', note: 'created'}, {at: '2026-10-03T13:57:21Z', note: 'updated'}, {at: '2026-10-03T14:19:02Z', note: 'claimed'}, {at: '2026-10-03T14:22:10Z', note: 'updated'}, {at: '2026-10-03T14:22:10Z', note: 'worker produced changes'}, {at: '2026-10-03T14:23:54Z', note: 'review approved and merged'}]
---

Venue scans often come as OBJ + MTL + many JPG textures (Matterport MatterPak, RealityCapture, Polycam OBJ export). Add OBJ input to the existing pipeline from card 1 without duplicating its normalization logic. Keep the obj2gltf call isolated in obj.ts so it can be mocked or skipped.
