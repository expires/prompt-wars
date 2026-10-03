# UI spec — "Arcade Tactical"

Direction: The Finals / Splitgate / Fortnite energy. Opaque dark "ink" plates with 45° cut corners, hot-yellow primary accent, magenta for anything AI/Forge. The world is bright low-poly — **every HUD element needs a dark plate or a 2px dark outline; no glow-only styling.** Keep all existing `data-testid`s.

## Tokens
```
--ink-900:#0B0D12 (plates .82–.92 alpha in HUD, 1.0 menus)  --ink-800:#141821  --ink-700:#1E2430  --ink-600:#2A3242
--line:rgba(255,255,255,.10)  --fg:#F5F3EE  --fg-dim:#A9B0BE  --fg-mute:#6B7383
--accent:#FFD23F  --accent-ink:#1A1400  --forge:#FF3DA5  --forge-2:#7B5CFF  --info:#3FD0FF
--hp-hi:#4BE38A (>60)  --hp-mid:#FFD23F (30–60)  --hp-lo:#FF4655 (<30, pulse)
--hit:#FFFFFF  --crit:#FFB020 (headshot)  --kill:#FF4655  --enemy:var(--kill) (user option: #C34BFF / #FFE600)
Rarity (always color + pips + label): T1 Scrap #A7ADB7 ●○○○○ · T2 Custom #5BD46A · T3 Rare #3FA9FF · T4 Prototype #B467FF · T5 Mythic #FFA41F (+sheen)
```
Fonts (Google): **Teko** 500/600 for numerals/display, **Chakra Petch** 500–700 for labels/buttons/feed, **Barlow** 400/500 for body/inputs. `tabular-nums` (fallback Barlow Condensed numerals if Teko jitters). Scale @1080p: ammo 72, HP 56, reserve 32, section titles Chakra 700 28 uppercase .06em, buttons Chakra 700 16 uppercase .08em, feed 13–14, micro labels 11 uppercase .14em (min), body 15/1.45.

Motifs: cut corners via clip-path (`--cut` 10px HUD, 14px menus; cut top-right + bottom-left); borders/focus rings via ::before/::after overlays (clip-path hides borders). Skewed badges `skewX(-12deg)` with counter-skewed text. 3px accent tick on a plate's outer edge. Hard drop shadow `drop-shadow(0 2px 0 rgba(0,0,0,.5))`. Floating text: `text-shadow:0 0 2px #000,0 2px 0 #000`. Glow only for events (headshot, kill, Mythic, forge building). Menus: 4% diagonal hatch background. Icons: inline SVG 24×24, stroke 2, square caps, in one `icons.ts` (headshot ≠ skull at 16px).

Motion: `--t-snap 80ms, --t-fast 140ms, --t-med 240ms, --t-slow 420ms`; `--ease-out cubic-bezier(.2,.8,.2,1)`, `--ease-pop cubic-bezier(.34,1.56,.64,1)`, `--ease-in cubic-bezier(.4,0,1,1)`. Feedback instant; entrances slide 12–24px from anchor edge; pops scale 1.4→1; menu items stagger 30ms; only transform/opacity (HP bar scaleX). Reduced motion (OS + in-game toggle): opacity fades ≤120ms, no shake/pulse/sheen/turntable spin.

## HUD (1920×1080; `--u: calc(min(100vw/1920,100vh/1080)*var(--hud-scale))`, margin 40u, text `max(11px, N*u)`; ultrawide: anchor to centered 16:9 box; crosshair NOT scaled by u)
- **Health** bottom-left plate 380×96: cross icon + HP Teko 56 colored by band, "HEALTH" micro label, segmented bar 236×14 (10 segments, 3px gaps), white damage-trail layer shrinking after 300ms over 400ms, <30 HP pulse + red tick.
- **Ammo** bottom-right plate 420×112: weapon name Chakra 700 16 accent uppercase + rarity chip; mag Teko 72, divider, reserve Teko 32 dim; mag ≤25% yellow, empty red + "RELOAD [R]" chip; reloading = 2px progress line on plate bottom + "RELOADING". Melee: show swing type (SLASH/THRUST/…) Teko 40 + "BLOCK [F]".
- **Crosshair** presets Classic+/Dot/Circle/T/Chevron; options color/thickness/length/gap/outline/opacity/dot/dynamic spread. Hitmarker 4 diagonal ticks fade 160ms; headshot = longer amber ticks + diamond glyph, pop; kill = 44px X + expanding ring; headshot kill adds head glyph. Charge bar 96×6 skewed under crosshair, flashes "RELEASE" when full.
- **Damage direction** arcs on r=180 ring, 60° wedge, fade 900ms, max 4, merge per attacker.
- **Low HP**: hit flash inset vignette .6→0 300ms; persistent radial vignette opacity `clamp(0,(40-hp)/40,1)*.8`, heartbeat pulse <20.
- **Kill feed** top-right, 5 rows, 6s life, row 32h plate: killer (enemy color) · skewed weapon chip (icon+name, tier-colored left border, max 180px) · headshot/melee glyph · victim. Rows involving you: accent .18 bg + accent left border. Slide from x+24.
- **Top-left** ping/FPS micro (`23 MS · 144 FPS`, yellow >80ms, red >150). Remove the always-on debug scoreboard text block; debug behind F3. Optional top-center score pill / compass (480×28).
- **Scoreboard** (hold Tab) 960 wide centered top 140: # · player · weapon (tier diamond + name) · K · D · HS% · ms; your row accent bar.
- **Status line** (SPRINTING/CROUCHED/AUTORUN) micro pill under crosshair, appears after 150ms. **Toasts** top-center y=96 max 560, left tick color by type, 4s, max 2.

## Menus
Buttons: primary 52h accent bg, cut corners, hover translateX(4px)+tick; secondary ink-700; **forge button** gradient forge→forge-2 with sparkle; kbd chips skewed.
- **Landing / first login**: blurred live world + ink .55 + hatch. Left column at x=120: logo Teko 120 + skewed accent underline + tagline "prompt your weapon. frag your friends."; CALLSIGN input 420×52 + dice; big PLAY. Right: loadout card + FORGE button. **First login must go through the Forge before PLAY deploys** (server: `needsLoadout`).
- **Esc pause**: left rail 440w ink .92 slides in, world blurred. Items: RESUME (Esc) · REDEPLOY (calls request_redeploy; confirm if HP<100 since it counts a death) · ✦ WEAPON FORGE · SETTINGS › · LEAVE (bottom, confirm). Right area: settings with tabs CONTROLS / MOUSE·TRACKPAD / GAMEPAD / VIDEO / AUDIO (skewed segmented tabs 44h); rows grid `1fr 320px` 52h; custom sliders (accent fill, skewed thumb, numeric box); HOLD|TOGGLE segmented toggles. Mouse tab includes crosshair editor with live preview; Video tab includes accessibility (enemy color, colorblind presets, reduced motion, shake, vignette intensity, text size 100/115/130%, HUD scale).
- **Death screen**: desaturated world + rgba(20,0,4,.55) (no full red wash). "ELIMINATED BY" Chakra 16 dim + killer name Teko 64 enemy color + detail line (headshot · dmg · distance). Left: killer's weapon card (0.8 scale) with "✦ remix this" (opens Forge seeded with that design). Right "YOUR NEXT LIFE": KEEP LOADOUT primary button with countdown; "or forge something new": prompt input + suggestion chips + QUICK FORGE + OPEN FORGE ›. Respawn ring 64px depleting (SVG dashoffset) with Teko 40 number.

## Weapon Forge editor (full-screen; from first login, death, Esc)
Background ink-900 + radial spotlight `radial-gradient(circle at 50% 45%,#2A2140 0%,#0B0D12 60%)` + hatch. Grid `400px 1fr 440px` × rows `72px 1fr 120px 132px`, gap 24, padding 40.
```
┌ ✦ WEAPON FORGE        <live weapon name Teko 40>  ◆◆◆◆○ PROTOTYPE        [?] [✕ Esc] ┐
│ COMPONENTS n/m │          3D TURNTABLE (own canvas)            │ WEAPON CARD          │
│ [card per comp]│   drag rotate · scroll zoom · reset           │ STATS vs class avg   │
│ [✓KEEP][🔒LOCK][✕REJECT] │                                     │ … TTK, BUDGET meter  │
├ VARIANTS  [A][B]*[C]   [compare]                                                        ┤
├ ✦ [ reprompt textarea                         ]  [✦ REFORGE ⌘⏎]  [EQUIP ▶]             ┤
│   [suggestion chips…]                                                                   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
- **3D preview**: auto-spin 20°/s, pause on drag, resume after 3s; zoom .6–1.6; contact shadow + slowly rotating forge-tick ring. Hover a component card ↔ highlight mesh (emissive accent .35, others dim 50%, camera eases toward part 300ms); hover mesh highlights card. Locked parts show lock glyph; rejected parts ghosted 30% red wireframe until reforge.
- **Component cards** 400×88 ink-800: role icon, ROLE micro label, label Chakra 600 16, desc Barlow 13 mute, 3-state control KEEP (hp-hi) / LOCK (accent, card accent bar) / REJECT (hp-lo, strikethrough) — each with icon. Keys 1/2/3, arrows move. Footer: Lock all · Clear marks.
- **Streaming build**: skeleton shimmer cards; each `component` event fills a card (fade + x-12, 240ms) and the part materializes in 3D (bottom→top clip-plane sweep 400ms with forge-colored edge; reduced motion = fade). Stat bars animate; budget updates live. On done: rarity reveal (frame wipes to tier color, T4+ sheen), name types in 25ms/char. Status: `FORGING · stock (3/6)…` Chakra 13 forge color.
- **Stats panel**: weapon card on top (Borderlands-style: tier band with hatch, name Teko 34, class chip, pips, italic flavor text, "Forged by X"); rows 32h: label · 8-segment bar with class-avg tick, gains green / losses hollow red · value Teko 22 · delta arrow. Show DMG (body/head), RPM, range, mag, reload, handling, **TTK @100HP** (Teko 28). Budget meter 16px 10 segments green→yellow→red; over budget chip "server will nerf: DMG −12%".
- **Variants**: 220×96 tiles with thumbnail, letter, pips, biggest stat diff; hover previews (crossfade 200ms); compare = side-by-side cards + diff.
- **Prompt bar**: textarea up to 3 lines, forge gradient border on focus, rotating placeholder; REFORGE (forge gradient, 56h, shows "keeping 2 · locked 1 · rerolling 3"); EQUIP primary disabled until done; 5–6 contextual skewed suggestion chips that append text; inline error chip + retry.
- Below 1400px side columns 320; below 1100px stats become a drawer.

## Accessibility
Text on plates ≥4.5:1; min 11px, 13px for combat-critical; every color signal has a second channel (shape/icon/pips); enemy color + colorblind presets; reduced motion; no flashes >3Hz; full keyboard + gamepad menu navigation with visible focus ring; hit targets ≥44px; real `<button>`s, radiogroups for toggles, `aria-live="polite"` toasts.

References: interfaceingame.com pages for The Finals (main), Valorant, Apex Legends, CoD MW (Gunsmith), Borderlands 4, Destiny 2, Halo Infinite, Overwatch 2.
