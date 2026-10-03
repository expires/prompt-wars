---
id: 'T-010'
title: 'Configurable map asset host (VITE_MAP_BASE_URL) + keep raw scans out of git'
status: 'closed'
priority: 60
depends_on: ['T-007']
route: 'infra'
acceptance_criteria: ['resolveMapUrl(url: string | undefined): string | undefined resolves root-relative map URLs (''/maps/x.glb'') against import.meta.env.VITE_MAP_BASE_URL when it is set (trailing slash handled). Absolute http(s) URLs, undefined and an unset env pass through unchanged. main.ts applies it to the chosen map URL', 'VITE_MAP_BASE_URL is typed in client/src/vite-env.d.ts (create the file with `/// <reference types="vite/client" />` if missing)', '.gitignore adds `scans/`, `client/public/maps/*.glb` and `client/public/maps/*.meta.json`. .gitkeep is created (empty)', 'The client build passes']
files_hint: ['client/src/map/assetUrl.ts', 'client/src/main.ts', 'client/src/vite-env.d.ts', '.gitignore', 'client/public/maps/.gitkeep']
context_files: []
skills: []
group: ''
conflicts_with: []
max_diff_lines: 0
max_output_tokens: 0
depth: 1
attempts: 1
review_cycles: 0
branch: 'agent/t-010'
base: 'main'
lease_until: ''
spec: 'Optimized venue GLBs are tens of MB, too big for git and for some static hosts'' per-file limits (Cloudflare Pages: 25 MB). The client deploys to any static host and the map loads from a bucket/CDN. The game server stays on SpacetimeDB Maincloud. loadMap derives _collision.glb and .meta.json from the visual URL, so they follow automatically.'
last_review_summary: ''
blocking_issues: []
created_at: '2026-10-03T14:16:56Z'
updated_at: '2026-10-03T14:26:30Z'
history: [{at: '2026-10-03T14:16:56Z', note: 'created'}, {at: '2026-10-03T14:16:56Z', note: 'updated'}, {at: '2026-10-03T14:23:57Z', note: 'claimed'}, {at: '2026-10-03T14:26:27Z', note: 'updated'}, {at: '2026-10-03T14:26:27Z', note: 'worker produced changes'}, {at: '2026-10-03T14:26:30Z', note: 'review approved and merged'}]
---

Optimized venue GLBs are tens of MB, too big for git and for some static hosts' per-file limits (Cloudflare Pages: 25 MB). The client deploys to any static host and the map loads from a bucket/CDN. The game server stays on SpacetimeDB Maincloud. loadMap derives _collision.glb and .meta.json from the visual URL, so they follow automatically.
