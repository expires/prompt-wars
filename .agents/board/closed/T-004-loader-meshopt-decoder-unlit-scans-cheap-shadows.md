---
id: 'T-004'
title: 'Loader: meshopt decoder, unlit scans, cheap shadows for big maps'
status: 'closed'
priority: 85
depends_on: []
route: 'frontend'
acceptance_criteria: ['The GLTFLoader in loadMap.ts registers MeshoptDecoder from ''three/examples/jsm/libs/meshopt_decoder.module.js'', so EXT_meshopt_compression GLBs load', 'Maps whose visual triangle count is above 150k get castShadow=false on every mesh (receiveShadow stays true). Below that, behaviour is unchanged', 'Materials that are MeshBasicMaterial (from KHR_materials_unlit) keep their map texture colorSpace as SRGBColorSpace, and their frustum culling stays enabled', 'loadMap fetches an optional `<name>.meta.json` next to the GLB (missing or non-JSON => ignored, same index.html sniffing as tryLoad) and exposes it as `GameMap.meta?: { bbox?: {min:[number,number,number],max:[number,number,number]}; [k: string]: unknown }`', 'The console info line also logs the visual triangle count', 'The client build passes']
files_hint: ['client/src/map/loadMap.ts', 'client/src/map/types.ts']
context_files: []
skills: []
group: ''
conflicts_with: []
max_diff_lines: 0
max_output_tokens: 0
depth: 1
attempts: 1
review_cycles: 0
branch: 'agent/t-004'
base: 'main'
lease_until: ''
spec: 'Prepares the client to load the optimized venue GLBs from the offline pipeline (cards 1-3). Keep loadMap''s public signature compatible: Game.ts calls loadMap(url, physics, scene). Small and contained.'
last_review_summary: ''
blocking_issues: []
created_at: '2026-10-03T13:57:21Z'
updated_at: '2026-10-03T13:59:25Z'
history: [{at: '2026-10-03T13:57:21Z', note: 'created'}, {at: '2026-10-03T13:57:25Z', note: 'claimed'}, {at: '2026-10-03T13:58:50Z', note: 'updated'}, {at: '2026-10-03T13:58:50Z', note: 'worker produced changes'}, {at: '2026-10-03T13:59:25Z', note: 'review approved and merged'}]
---

Prepares the client to load the optimized venue GLBs from the offline pipeline (cards 1-3). Keep loadMap's public signature compatible: Game.ts calls loadMap(url, physics, scene). Small and contained.
