# Flat map plan — 2D default, 3D toggle, phone layout, art

Date: 2026-10-15. Cade gave "GO" on this plan. This file is the build spec. HANDOFF.md gets the result when the work is done.

## Decisions (Cade, 2026-10-15)

1. The map opens flat (2D), framed on central Japan. A small inset map ("key") in a corner shows all of Japan with a frame for the current view. A tap on the inset frames the whole country.
2. Look of the flat map: grey ink height bands where the terrain files exist (central Japan). Flat paper elsewhere. The coast is an ink stroke. The sea is a faint wash with a sparse wave pattern.
3. A "3D" stamp in the layer stamps tilts the camera up over the same spot in a slow 1.5 s move. A second tap flattens it.
4. 2D is the default on every device.
5. Phone frame: plain washi page with a thin ink rule. No rollers on the phone. iPad landscape keeps the handscroll rollers.
6. Phone chrome: one bottom bar with four items: Regions, Filters, Layers, Trip. A tap opens a short row above the bar. The person pill stays at the top right.
7. Travel lines in 2D: the full 10-day route shows at all times. Each night's city gets a small day stamp. The fly-through runs on the 2D map.
8. Artwork: great wave, koi pair, Mount Fuji, crane, pine branch, kabuto helmet. All in grey ink at 25 to 35 percent. In the sea only, never over land or pins. Generated in Gemini with the keyed (magenta) workflow.
9. A koi swims along the route as the fly-through marker.
10. First test device: iPhone portrait (390 x 844).

## Architecture: one camera, two projections

The app keeps ONE `THREE.PerspectiveCamera` and ONE `OrbitControls`. The 2D map is the same scene seen straight down with an orthographic projection.

- `view.mode` is `'2d'` or `'3d'`.
- In 2D the camera sits above the target: `offset = (0, D, 0)` with a tiny z so `lookAt` is safe. `D` is the distance to the target, as today.
- In 2D `camera.updateProjectionMatrix` is overridden. It builds `makeOrthographic(-hw, hw, hh, -hh, near, far)` with `hh = FOV_TAN * D` and `hw = hh * aspect`. This shows the same world height as the perspective camera at distance D. So every rule that uses `dist` (pin fade, label fade, route dash ladder, fog, lod, mist) works unchanged.
- OrbitControls stays on the perspective code path (the camera object is still a PerspectiveCamera). Dolly moves the camera position (changes D). Pan moves the target by the same world-per-pixel as the perspective camera at distance D. Both are exactly right for the orthographic view. Rotation is off in 2D: `enableRotate = false`, `minPolarAngle = maxPolarAngle = EPS` with `EPS = 0.0015` rad. North is up (azimuth 0).
- Mode flight: 1.5 s, eased. The projection matrix blends element by element between the perspective matrix and the orthographic matrix with the flight's eased k. The spherical pose blends polar from 52° (3D) to EPS (2D). With "Motion" off: cut plus the paper cross-fade.
- Sprites (pins) attenuate by depth only when the projection is pure perspective. In 2D and during the blend, pins set their scale in world units: `PIN_PX * wpp` with `wpp = 2 * FOV_TAN * D / canvasHeight`.
- In 2D: `camera.far = max(4000, D * 2 + 500)`. Near stays as today.
- In 2D the pan clamp uses the Japan bounds (from `data/japan-coast.json`), not the terrain bounds. `controls.maxDistance` is `max(900, japanDist * 1.15)`.
- Region crests in 2D fly top-down to `REGIONS[id].dist * 1.25`. The overview in 2D frames the six region centres plus Mount Fuji into the free map area with 10 percent padding. The whole-Japan frame fits the main islands (lon 129.3–145.9, lat 30.9–45.6).
- `ctx.sph(dist, polar, az)` is mode-aware. In 2D it returns `(0, dist, 0)` plus the tiny z. Modules keep calling it as today.
- `aimPose` in 2D is analytic: `T.x = P.x - (C.x - w/2) * wpp`, `T.z = P.z - (C.y - h/2) * wpp` (screen down is world +z, north up).

## Layers under the terrain (new file js/flatmap.js)

Data: `data/japan-coast.json` (built by tools/build-coast.py from Natural Earth 10m, public domain).

```
{ "v": 1,
  "bbox": [lon0, lat0, lon1, lat1],          // main islands + nearby islands, lat >= 30
  "land":  [ [[lon, lat], ...], ... ],        // outer rings, 4 decimals
  "lakes": [ { "name": "Biwa", "ring": [[lon, lat], ...] } ],
  "inset": [ [[lon, lat], ...], ... ] }       // rings simplified to 0.05 deg for the inset
```

Meshes, in render order:

| Mesh | y | renderOrder | Look |
|---|---|---|---|
| Sea plane 40000 x 40000 | -1.0 | -3 | paper mixed 9 percent toward grey-l, washi grain, wave tile (`assets/web/wave.png`) in world UV, one tile = 60 units, tile opacity 0.07, fog toward paper like the terrain |
| Art planes | -0.8 | -2 | see Art. Land covers them, so they never show over land |
| Land mesh | -0.5 | -1 | paper, washi grain. Fragments inside the base terrain rect inset by 30 units are discarded (the terrain draws there) |
| Coast stroke | -0.45 | 0 | ribbon, 1.3 px ink, dry-brush edges, slight hand wander. Same discard rect as the land |
| Lake fill and shore | terrain height + 0.08 | 2 | Biwa and other lakes. Draped on the terrain. Never discarded (the terrain data shows Biwa as flat land) |

The coast ribbon copies the `Builder` class and the vertex shader from route.js into flatmap.js (do not edit route.js). Two styles: COAST (ink, 1.3 px) and SHORE (ink, 0.9 px). The fragment shader is a cut-down copy: coverage, dry-brush break-up, pool at stroke starts, fade uniform.

flatmap exposes `{ group, materials, bounds }`. app.js updates `uCamPos`, `uFogNear`, `uFogFar` on `materials` in the same loop as `world.materials`.

## Inset key (new file js/inset.js)

- `<canvas id="inset">`, 88 x 104 CSS px, DPR-scaled. A washi wash, a 1 px ink rule, a slightly rough border radius.
- Draws the `inset` rings (Mercator, same `lonLatToWorld` scale) as paper fill with a 1 px grey-d stroke.
- Draws the current view as a vermilion polygon: the four corners of the free map area, unprojected onto the ground plane y = 0. In 3D, a corner whose ray misses the ground gets a point 900 units away along the ray. Line width 1.5 px, fill vermilion at 12 percent.
- Redraws when the camera moves (compare position and target, 10 Hz cap).
- Tap: in 2D `view.frameJapan()`. In 3D `flyToRegion('overview')`.
- Hidden while the info card or the drawer is open on the phone.

## Phone layout (css/style.css, index.html, css/trip.css)

Phone = `(max-width: 600px)`. Also iPad portrait keeps the rollers (unchanged).

- Rollers: `display: none` on the phone. `--cap-in: 0px`. A thin ink rule: `#scroll::after`, inset 8 px, 1 px solid ink at 35 percent, radius 3px 2px 4px 2px, pointer-events none.
- Bottom bar `#bar`: four tab buttons, `data-tab` = `regions | filters | layers | trip`. Seal style: a 30 px stamp with an icon and a word under it. Bar height 58 px plus the safe area. z-index 7. Hidden above 600 px.
- `body[data-tab]` marks the open tab. The matching strip shows above the bar: `#crests` for regions, `#filters` for filters, `#seals` for layers. On the phone all three are horizontal rows, centred, `overflow-x: auto`, hidden unless their tab is open. A second tap on the open tab closes the strip. A tap on the map closes it.
- The Trip tab opens the itinerary sheet (`trip.setOpen(true)`). The sheet's fold chevron closes it and clears the tab. On the phone the closed sheet is fully off screen (`translateY(100%)`). While the trip plays and the sheet is closed, the handle row (play, caption, scrub) peeks above the bar.
- The info card (bottom sheet) covers the bar when open.
- Region caption: bottom left, above the bar and above an open strip.
- Inset: bottom right, above the bar (and above an open strip).
- The person pill stays top right. The masthead stays.
- New icons in js/icons.js: `cube` (for the 3D stamp), `regions` (a small crest), `layers` (three stacked strokes), `filters` (a stamp), `trip` (reuse `route`).
- The 3D stamp: `<button class="seal" data-layer="3d" data-icon="cube">` in `#seals`, word "3D". `on` means 3D. The Mist stamp gets class `dim` in 2D (no visible effect in 2D, tooltip "Mist shows in 3D").
- iPad landscape: the seal column, the crests column and the filter row stay where they are. The inset sits bottom right, inside the roller, above the filter row.
- `freeRect` and `refreshUiRects` in app.js include `#bar`, `#inset` and the open strip.

## Trip extras (js/route.js, js/trip.js, new js/marker.js, css/route.css)

- Day stamps: from the itinerary, group consecutive days with the same `stay`. One DOM seal per group: `.dstamp`, 22 px, vermilion, paper text ("1–3", "4", "5", "6–8", "9–10"). Positioned at the stay's world point plus an 18 px up-right offset, by projection each frame. Visible whenever the route layer shows. Hidden under the fixed UI (same blockers as pins). Tap: `trip.setDay(firstDay)`.
- Koi marker: a plane with `assets/web/koi-marker.png` (placeholder until the Gemini koi arrives: an ink fish drawn in canvas). 30 px on screen. Placed by `route.pointOnLeg(day, leg, t, out, tangent)`. Rotates to the tangent. A gentle wiggle: rotation ±6° at 1.2 Hz, scale pulse 3 percent. Visible when `trip.cursor` is on (playing, scrubbing, or paused at a stop).
- trip.js exposes `progress()` → `{ day, leg, t }` or `null`, and `get cursor()`.
- In 2D the hop keeps the camera top-down (`ctx.sph` handles it). The lift becomes a zoom out and in. Stop distance in 2D: 40.

## Art (new js/art.js, data/art.json, assets/web/art-*.png)

`data/art.json`: `[ { "id", "file", "lon", "lat", "km", "rot", "opacity", "flip" } ]`. A plane at y = -0.8, width `km` kilometres (1 unit = 0.764 km), height from the image ratio. Opacity 0.25–0.35, colour multiplied toward grey-d so it stays ink. Fades out below D = 110 and is full above D = 170 (close zoom hides the art).

Placements (sea only):

| id | Where | km |
|---|---|---|
| wave + fuji group | Pacific south of Sagami Bay, lon 138.9, lat 33.6 | 170 |
| koi pair | Sea of Japan west of Noto, lon 136.0, lat 37.9 | 120 |
| crane | Sea of Japan off Niigata, lon 138.0, lat 38.8 | 90 |
| pine branch | Pacific south of Kii, lon 135.0, lat 32.6 | 110 |
| kabuto | Pacific east of Boso, lon 141.6, lat 35.0 | 70 |

The great wave is an original ink-wash wave in the spirit of ukiyo-e, not a copy of any print.

## Work packages and models

| WP | What | Model | Reason |
|---|---|---|---|
| 0 | tools/build-coast.py → data/japan-coast.json; wave web tile | Haiku | mechanical data work |
| 1a | view core: app.js, pins.js (sprite scale), ctx.sph, mode flight, 3D stamp wiring, poses | Sonnet | solid code at lower cost |
| 1b | js/flatmap.js: sea, land, coast, lakes | Sonnet | same |
| 1c | js/inset.js | Sonnet | same |
| 2 | phone layout: bar, strips, rollers off, CSS | Sonnet | same |
| 3 | day stamps, koi marker, trip hooks | Sonnet | same |
| 4 | Gemini prompts and art placement; js/art.js | Haiku (prompts), Sonnet (code) | prompts are a list; code is code |
| 5 | screenshots at 390x844, 844x390, 1180x820; review | Opus | catches layout faults on review |
| 6 | HANDOFF.md, sw.js cache bump, commit, push, Mac pull | Fable | integration |

File ownership: WP1a owns app.js, pins.js, trip.js (sph and stop distance only). WP1b owns flatmap.js and tools. WP1c owns inset.js and css/inset.css. WP2 owns index.html, style.css, trip.css, ui.js, icons.js. WP3 owns route.js, marker.js, route.css and the trip.js hooks (progress, cursor). WP4 owns art.js, art.json. app.js gets one import and one init line per module; Fable adds those.
