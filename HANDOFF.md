# HANDOFF — Journey Through Japan (日本の旅) 3D map

Read this first in a new chat. It holds the state, the decisions, and the working method.
Last update: 2026-10-14, Phase 3 plus the English-first redesign. The app is live on GitHub Pages.

## Project in one paragraph

An interactive 3D map of central Japan in sumi-e (ink wash) style, for Cade and Casey's fall 2027 honeymoon. It runs as a Home Screen web app on iPhone and iPad. It uses Three.js and is hosted on GitHub Pages. Six regions: Tokyo, Hakone, Mount Fuji area, Kyoto, Nara, Osaka. Full plan: `japan-3d-map-concept.md`.

## Where things are

The local folder on the Mac is `japan-3d-map`. The GitHub repo is `japanmap`. The two names are different. Use `japanmap` for all GitHub work.

```
japan-3d-map/
├── HANDOFF.md                 ← this file
├── japan-3d-map-concept.md    ← vision, style B2, layers, phases, decisions, Phase 1 and 2 notes
├── places-and-data.md         ← first place list, transit, data sources, foliage dates, fonts (SUPERSEDED for coordinates by data/places.json)
├── gemini-prompts.md          ← image prompts + status table of what was generated
├── index.html, css/style.css, manifest.json
├── sw.js                      ← offline cache, name 'nihon-no-tabi-v5'. Bump the version when a cached file changes.
├── js/app.js                  ← renderer, camera, region flights, place fly-to, free-area aiming, labels, mist
├── js/terrain.js              ← world frame, file loaders, base and patch meshes, lonLatToWorld(), heightAtWorld()
├── js/ink-shader.js           ← ShaderMaterial: height bands, dry-brush streaks, contours, coast, washi grain, edge fade, patch cut-outs
├── js/pins.js                 ← canvas hanko seals, pin sprites, labels, fade by distance, overlap culling, tap picking
├── js/ui.js                   ← info card, region crests, category filter row, who picker, saved choices (localStorage)
├── js/route.js                ← Phase 3: route layer (ink-brush ribbons on the terrain), faint rail network, station ticks
├── js/trip.js                 ← Phase 3: itinerary drawer (washi page) and fly-through player (play, pause, scrub)
├── js/tips.js                 ← Phase 3: help tooltips in English (hover on Mac, long press on iPhone and iPad)
├── js/icons.js                ← ink-brush pictogram set (24 icons), red stamp builder, PNG override hook (ICON_ART)
├── css/route.css, css/trip.css, css/tips.css ← Phase 3 styles, one file per module
├── data/central-japan-z9.bin  ← base terrain, z9, 2048x768
├── data/hakone-fuji-z11.bin   ← patch, z11, 1280x1280
├── data/tokyo-z11.bin         ← patch, z11, 1024x768
├── data/kansai-z11.bin        ← patch, z11, 1024x1280 (Kyoto, Nara, Osaka in one file)
├── data/places.json           ← 75 places. The source of truth for pins.
├── data/rail.geojson          ← 11 rail lines and 21 stations from OSM (23 KB). Built by tools/build-rail.py.
├── data/itinerary-cade.json   ← Cade's day plan. Built by tools/build-itinerary.py.
├── data/itinerary-casey.json  ← Casey's day plan (starts as a copy of Cade's).
├── itinerary-draft.md         ← the starter plan in readable form, with the stations table
├── assets/*.png               ← keyed art assets, originals (see gemini-prompts.md status table)
├── assets/web/                ← web copies the app loads: washi, mist, card background, caps, title, 6 crests, 3 icons (1.7 MB)
├── assets/_jpeg-originals/    ← raw Gemini downloads (gitignored)
├── tools/key-magenta.py       ← magenta key → RGBA PNG
├── tools/build-rail.py        ← _scratch/rail-raw*.json → data/rail.geojson (Dijkstra per line, Douglas-Peucker, station snap)
├── tools/build-itinerary.py   ← the plan as Python data → both itinerary files, with checks
├── _scratch/                  ← screenshots, test images (gitignored)
├── _test/                     ← Playwright test scripts. Gitignored. A copy is kept on the Mac: stage it to the cloud, then run `npm install` in it.
└── .gitignore                 ← assets/_jpeg-originals/, _scratch/, _test/, node_modules/, data/tiles/, .DS_Store
```

The `data/` folder is 11 MB. The `assets/web/` folder is 1.7 MB. The total is far below the 25 MB budget.

## Data

### Terrain files

Terrain is one continuous world. The base file covers all of central Japan. Three z11 patch files add detail where Cade will spend time.

| File | Zoom | Tiles | Size (px) | Covers |
|---|---|---|---|---|
| `central-japan-z9.bin` (base) | 9 | x 448–455, y 201–203 | 2048 x 768 | All of central Japan |
| `hakone-fuji-z11.bin` | 11 | x 1812–1816, y 806–810 | 1280 x 1280 | Hakone and Mount Fuji area |
| `tokyo-z11.bin` | 11 | x 1817–1820, y 805–807 | 1024 x 768 | Tokyo |
| `kansai-z11.bin` | 11 | x 1794–1797, y 810–814 | 1024 x 1280 | Kyoto, Nara, Osaka |

File format: `uint32 headerLength` + JSON header `{z,x0,x1,y0,y1,w,h}` + `Int16Array` heights in meters, row-major. The loader clamps the sea to 0. The loader also cleans noisy sea-level pixels.

Cade approved one Kansai file instead of three separate files. Kyoto, Nara, and Osaka are close together.

### World frame

- The world uses z11 Web Mercator pixels. Ten pixels equal one world unit.
- The origin is the center of the base file.
- Vertical exaggeration is 2.0.
- `lonLatToWorld()` converts longitude and latitude to world units. It works without any file loaded.
- `heightAtWorld()` returns the height of the best file at a point. Patches have priority over the base.

### Seams

- The base mesh discards fragments inside every patch rectangle (the `uRects` uniform).
- Each patch blends its outer 8% of vertices toward the base mesh height. The edges then meet exactly.
- The base material uses polygonOffset, so it sits behind the patches.
- The base outer edge fades out with a noisy brush edge. Patches have no edge fade.
- Debug switch `?seam=1` tints the patches red.

### Places: `data/places.json`

The file holds 75 places: 42 core and 33 suggestion.

| Region | Count |
|---|---|
| Tokyo | 25 |
| Kyoto | 21 |
| Hakone | 8 |
| Nara | 8 |
| Osaka | 8 |
| Fuji | 5 |

Fields: `id`, `name`, `kanji`, `yomi`, `category`, `region`, `lat`, `lng`, `why`, `status` (core or suggestion), `tier`, `architect`, `best`, `booking`, `sources`, `checked`.

Haiku converted the table from `places-and-data.md`. Two Sonnet agents then checked every row against Wikipedia, official sites, and map links. `places.json` now replaces `places-and-data.md` for coordinates. Do not rewrite `places-and-data.md`. It stays as the first draft and still holds transit, foliage dates, and fonts.

Main fixes from the check:

- Ten suggestions are new: 21_21 Design Sight, Rikugien, Tokyo International Forum, Hakone Gora Park, Kawaguchiko Momiji Corridor, Eikan-do, Byodo-in, Kyoto Railway Museum, Yoshiki-en, Tower of the Sun.
- Many Hakone and Fuji rows were 0.5 to 5 km off. Oshino Hakkai was 5.3 km off. The Kubota museum was 4.6 km off.
- Church of the Light was 3.8 km off.
- Chikatsu-Asuka was 5.8 km off. It is in Kanan, not Fujiidera.
- Readings fixed: 浅草寺 is せんそうじ. The Hakone glass museum is 箱根ガラスの森美術館. The bamboo grove is 竹林の小径.

Notes to recheck before the trip:

- Church of the Light: tours have been suspended since 2024.
- Nintendo Museum: entry is by lottery only. Apply about 3 months ahead.
- Owakudani: access is limited when volcanic activity rises.
- Hoshinoya Fuji: it is a glamping resort. It stays in the 宿 category.
- Gora Park and Sengokuhara: fall color may be past peak in late November.

## Decisions already made (do not re-ask)

- **English first (2026-10-14, Cade).** Cade reads no Japanese. All readable text is English. Red stamps hold ink pictograms (js/icons.js), not kanji. The only Japanese in the UI: one small grey kanji line on the place card, the 日本の旅 title artwork, and the title tooltip that explains it. This replaces the earlier "kanji plus hiragana readings" rule.
- Icons are drawn in code for now. Cade may switch to painted Gemini icons later: put `assets/web/icons/<name>.png` in place and register it in `ICON_ART` (see the top of js/icons.js). Graphics are very important: the app is an art piece.

- Style: B2 ink wash. Palette: paper #F5EFE0, ink #2C2C2A, greys #B9B6AC / #8E8B82 / #5B5952, vermilion #C8341E only accent, gold #C9A227 fall only.
- Fonts: Shippori Mincho (English UI text), Cormorant Garamond 500/600 (big English headings), Yuji Syuku (only the card's kanji line). Google Fonts.
- Seal pins render live in canvas textures with the category icon (drawIcon). Pin labels use the English `short` name from places.json.
- Camera: slow and deliberate. 2 s fly-to on tap. Region flights take about 3.5 s with an arc. "Still camera" seal toggle (動). Tilt limit 20–70°. Layer toggles never move the camera.
- Osaka is a full stop. Two itinerary files (Cade, Casey) that merge. Sound yes, off by default (Phase 6).
- One continuous world. One base file plus three patches. No separate scene per region.
- One Kansai file covers Kyoto, Nara, and Osaka. Cade approved this.
- Vertical exaggeration is 2.0.
- Hosting: GitHub Pages. The repo name is `japanmap` (not `japan-3d-map`). Repo URL: https://github.com/cmrlmatthews-max/japanmap. The app is live at https://cmrlmatthews-max.github.io/japanmap/.
- `gh` is NOT on the Mac. The Mac has no GitHub credentials. Claude pushes from the cloud workspace. See "How to publish".
- The info card is a washi panel. It is a bottom sheet on iPhone portrait. It docks on the right on iPad and on iPhone landscape. This differs from the concept doc. The height of a landscape phone is too small for a bottom sheet.
- Markdown for all docs. Short sentences (ASD-STE100 style).
- Phase 3 (2026-10-13): nights Tokyo 3 · Kawaguchiko 1 · Hakone 1 · Kyoto 3 · Osaka 1. Route order Tokyo → Fuji → Hakone → Kyoto → Nara → Osaka, fly home from KIX.
- Two itinerary files (`itinerary-cade.json`, `itinerary-casey.json`), same format. Casey's starts as a copy. Merge is Phase 5.
- Route styles: Shinkansen thick vermilion dashes, local thin ink, walk dots, bus thin grey, boat thin wavy, ropeway thin with ticks.
- Fly-through: one scrub bar for the whole trip. Hop 6 to 8 s, pause 3 s.
- Drawer: bottom sheet on iPhone portrait (and iPad portrait), docked right on iPad landscape and iPhone landscape.
- Tooltips are plain English help: hover on the Mac, long press on touch. No tooltips on map pins.

## Phase status

| Phase | Status |
|---|---|
| 0 Assets | Done. 14 PNGs keyed. |
| 1 Paper and terrain | Done. Hakone–Fuji terrain, ink shader, scroll frame, labels, mist. 190 fps in Chrome. Screenshot: `_scratch/phase1-screenshot.jpg` |
| 2 Places and pins | Done 2026-10-13. Live on GitHub Pages. Not yet tested on a real iPhone or iPad. |
| 3 Route and fly-through | Done 2026-10-14. Live on GitHub Pages. Not yet tested on a real iPhone or iPad. |
| 4 Fall, light, mist | NEXT. Mist bands still read as billboard strips. Band contrast needs a second pass. |
| 5 Memories and merge | |
| 6 Polish and sound | |

## Phase 2 result

The app now shows one continuous 3D world with 75 seal pins. All six regions work. A tap on a pin opens an info card.

**Terrain**
- One base file and three patches form one world. See "Data".
- The sea edge of the base fades out with a noisy brush edge.

**Pins** (`js/pins.js`)
- Eight categories. Each category has a hanko seal drawn live in a canvas.
- A core pin is a solid seal. A suggestion is an outline seal. A passed pin fades to 20 percent.
- A pin keeps a constant size on screen. It fades with camera distance.
- Labels that overlap are culled. Pins under UI elements are hidden.

**UI** (`js/ui.js`)
- The info card shows kanji, reading, English name, why, architect, best time, booking, tier, and the core or suggestion mark.
- The card has "Add to trip" and "Pass" buttons and a list of sources.
- The card background is `assets/web/card-bg.jpg`.
- On first open, a picker asks who is using the phone: Cade (ケイド) or Casey (ケイシー). The seal at the top right switches the person.
- Choices save in localStorage under the key `jmap.v1`. The shape is `{ who, choices: { cade: { placeId: { c, t } }, casey: { ... } } }`.
- Six crests (sliced to `assets/web/crest-*.png`) plus an overview button fly to a region. The category filter row at the bottom has eight seals.

**Camera** (`js/app.js`)
- A region flight takes about 3.5 s and follows an arc. A place fly-to takes 2.0 s.
- The function `freeRect` finds the screen area that no UI covers. The camera aims so the target lands in that area.
- With reduced motion, or with "Still camera" on, the camera cuts at once. A paper cross-fade hides the cut.
- The mist shader is a soft wash. It fades with camera distance.

**Size**
- Web copies of the art are in `assets/web/` (1.7 MB). The originals stay in `assets/`.
- The service worker cache is v3. The `data/` folder is 11 MB.

**Testing**
- Tests ran in headless Chromium with Playwright. There were zero console errors. See "How to test the app".
- Nobody has tested the app on a real iPhone or iPad.

### Known issues after Phase 2

- The mist is still a set of billboard bands. Phase 4 replaces it.
- The land strip is about 2.75 to 1. In landscape, the overview uses about one third of the screen height.
- On iPhone portrait, the scroll rollers cover much of the width. Some pins near the edges sit under them.
- The camera does not aim again after a screen rotation.
- The Tokyo area is flat, so it reads as plain paper. For Phase 4, consider a water or wave wash for the sea. Use `assets/wave-pattern-tile.png`.
- Coastlines are slightly stair-stepped at the overview zoom.

## Phase 3 result

The app now shows the trip route on the terrain and flies along it. Cade gave "defaults, go" on 2026-10-13. The defaults were:

- Nights: Tokyo 3 · Kawaguchiko 1 · Hakone 1 · Kyoto 3 · Osaka 1 (9 nights, 10 days). Osaka is last, because the flight home leaves from KIX.
- Stops: core places only. Chrome on the Mac had no "Add to trip" picks (`jmap.v1` was empty).
- Casey's file starts as a copy of Cade's file.
- Extra lines: JR Chuo (Shinjuku–Otsuki) and JR Kyoto (Kyoto–Osaka). Fuji to Hakone is a bus.
- Bus is a thin grey line. Boat is a thin wavy line. Ropeway is a thin line with tick marks.
- One scrub bar covers the whole trip, with a tick for each day.
- Tooltips: hover on the Mac, long press (0.45 s) on iPhone and iPad. Pins get no tooltip, because their labels already show English.

**Rail data** (`data/rail.geojson`, 23 KB)
- 11 lines: tokaido-shinkansen, odakyu, hakone-tozan, hakone-cable, hakone-ropeway, jr-chuo, fujikyuko, jr-nara, kintetsu-kyoto, kintetsu-nara, jr-kyoto. All lengths are in the expected range (Shinkansen 514.6 km).
- 21 stations. Each station comes from an OSM station node, then snaps onto its line.
- Raw data: `_scratch/rail-raw.json` and `_scratch/rail-raw-2.json` (gitignored, kept on the Mac). Run `python3 -I tools/build-rail.py` to rebuild.
- Hakone Tozan has a new OSM name since 2024: 小田急箱根鉄道線. The first export missed it. `rail-raw-2.json` adds it.
- The JR Nara line in OSM ends at Kizu. Only Kyoto–Inari is used, so this is fine.
- Ogura station snaps 463 m. Owakudani has no OSM node. Both are walk ends, so the error does not show.

**Itinerary** (`data/itinerary-<who>.json`)
- Shape: `{ version, who, title, updated, note, nights[], unplaced[], days[ { day, region, kanji, title, stay, stops[], legs[] } ] }`.
- A leg is `{ from, to, mode, minutes, note?, parts? }`. Modes: shinkansen, local, walk, bus, boat, ropeway, funicular. A part is `{ mode, line?, minutes, to }`. `to` is a station id or a place id.
- Day 1 has one leg fewer than its stops. On later days, leg 0 comes from the last stop of the day before.
- 37 stops in 10 days. Not placed yet: nara-park, kyoto-imperial-palace, kyoto-national-museum, nakanoshima-museum-of-art, church-of-the-light (reasons in the file).
- To change the plan: edit `tools/build-itinerary.py` (and `itinerary-draft.md`), then run `python3 -I tools/build-itinerary.py`. It writes nothing if a check fails.

**Route layer** (`js/route.js`)
- Ribbons are extruded in screen pixels and draped on the terrain mesh. Two draw calls: the trip, and the faint rail network.
- Shinkansen: vermilion dashes, about 5 px. Local and cable car: thin ink. Walk: dots. Bus, boat, ropeway as above. Dry-brush edges and darker ink at the start of each stroke.
- Dash length steps with zoom (with hysteresis), so dashes do not crawl.
- Station ticks and small kanji labels show below camera distance 120.
- The 路 seal turns the layer on and off. It never moves the camera.
- API on `window.__map.route`: `reload(who)`, `setVisible`, `setActiveDay(i|null)`, `setProgress(day, leg, t)` / `setProgress(null)`, `legPath`, `legLength`, `stopWorld`, `dayStops`, plus `legInfo`, `pointOnLeg`, `stationWorld`. Day and leg indices are 0-based.

**Drawer and player** (`js/trip.js`)
- iPhone portrait and iPad portrait: a bottom sheet. The handle row holds the play button and reads "Day 3 · Kyoto · 3 stops". It opens to about 62 percent.
- iPad landscape: docked on the right, about 354 px, open by default. The crests move to the left of the drawer.
- iPhone landscape: docked, 260 px, folded to a slim spine by default.
- The drawer shows day tabs, the day's kanji and title, the stay, stops, and legs with mode marks. Tap a day to frame it. Tap a stop to fly there and open its card.
- Timeline: a 6 to 8 s hop into each stop, then a 3 s pause. The whole trip lasts about 5 min 40 s. The ink draws with the camera.
- Still camera or Reduce Motion: one cut per hop with the paper fade. The timing stays the same.
- Playback pauses on a map touch, a card, a day or stop tap, a hidden page, or Space.
- API on `window.__map.trip`: `play`, `pause`, `seek(s)`, `setDay(i)`, `setOpen(b)`, `refresh`, `playing`, `time`, `duration`, `segments`.

**Tooltips** (`js/tips.js`)
- Targets: layer seals, category seals (with "shown" or "hidden"), crests, the person seal, the card seal and status, the title, and any element with `data-tip="kanji · romaji · English"`.
- A long press does not toggle the button. A short tap works as before.

**Other changes**
- `app.js` passes a `ctx` object to the three modules and adds `#drawer` and `#player` to `freeRect` and the pin blockers.
- Service worker cache is v4. It caches the new files. The itinerary files load network first.

**Testing**
- Cloud Playwright runs at all four sizes. Zero console errors. Scripts: `p3all.mjs`, `p3check.mjs`, `route-*.mjs`, `trip-func.mjs` (51 checks), `trip-motion.mjs`, `tips-func.mjs` (31 checks).
- Opus reviewed the screenshots in `_scratch/p3-*.png`, `p3c-*.png`, `route-*.png`, `trip-*.png`, `tips-*.png`.
- In SwiftShader a screenshot can catch the paper fade or a CSS transition half way. Wait about 3 s after a cut.

## English-first redesign (2026-10-14)

Cade found the kanji-led UI hard to read. He chose direction B: icons in the red stamps and English words everywhere.

- **Masthead:** the brush title art stays. "Journey Through Japan" under it is the readable title.
- **Person button:** a red pill with an icon and "Cade" or "Casey". The picker asks "Who is using this phone?"
- **Stamps:** icon plus word. Layers: Route, Mist, Motion, Sound. Categories: Temples, Shrines, Inns, Gardens, Buildings, Hot springs, Tech, Art. Crests: English captions and an "All" button.
- **Map lettering:** English only. Regions in letter-spaced capitals, landmarks in italics. Station labels are English.
- **Pins:** category icon in the seal. Label = `short` (new field in places.json, max 20 characters, made by Haiku).
- **Card:** icon, category, "Must-see" or "Suggestion"; the English name as the title; one grey kanji line; region; why; Architect, Best time, Booking, Price tier.
- **Drawer:** "Itinerary · Starter plan", a big "Day 3", the English day title, "Tokyo · 4 stops", stops with a category word, legs with a mode icon ("Bullet train · 2 h 5 min").
- **Tooltips:** English help, for example "Temples · Tap to hide".
- **Icons I want to improve:** architecture (generic), ryokan (busy at 18 px), stay (the pillow reads as a pedestal), boat. These are good candidates for painted Gemini icons.
- **Tests:** `en-shots.mjs`, `en-scan.mjs` (finds any Japanese in the rendered UI), `icons-shots.mjs`, plus the updated `tips-func.mjs` and `trip-func.mjs`. All pass. Screens: `_scratch/en-*.png`, `_scratch/icons-*.png`.
- **To check on a device:** Cormorant Garamond did not load in the cloud tests (fonts are blocked there).

### Known issues after Phase 3

- When the phone sheet is open, a day tap frames the day in the small map area above the sheet. Long days (Day 6, Hakone to Kyoto) then look far away.
- Day 9 has 6 stops (Fushimi Inari, Nintendo Museum, Nara, then Osaka). It is a long day. Consider moving Nintendo to Day 8.
- On iPad landscape the overview map uses only the area left of the crests.
- On iPad landscape an open place card covers the right end of the player bar.
- On iPhone portrait the category cells are only 31–41 px wide to fit eight English captions.
- The day tabs scroll sideways in the docked drawer.
- The two itinerary files do not merge yet (Phase 5). The app shows the file of the current person.
- Nobody has tested Phase 3 on a real iPhone or iPad.

## Working method (Cade's expectations)

- Cade does not run prompts or scripts himself. Claude does it, with agents where useful. Name the model per task (Opus plan/review, Sonnet build, Haiku data).
- Ask numbered questions before building something new. Give a short summary and wait for "go" before creating files.
- Save work to this folder. The folder is attached to the Claude project.

## How to test the app

There are two methods. Use the cloud method for fast checks. Use the Mac method for a real GPU and the real fonts.

### Cloud method (headless Chromium with Playwright)

The cloud container runs Chromium with software GL (SwiftShader). The scripts are in `_test/`. That folder exists only in the cloud container. It is gitignored.

1. Start a server in the project folder: `python3 -m http.server 8791 --bind 127.0.0.1`.
2. Run a script: `node _test/p2all.mjs`.
3. Read the screenshots in `_scratch/p2-*.png`.

Scripts:

- `p3all.mjs`: Phase 3 review. It takes screens at the four sizes: overview, Day 6, a seek, and Day 9.
- `p3check.mjs`: a mid-hop screen on the Day 6 Shinkansen leg.
- `p2all.mjs`: takes screens at 390x844, 844x390, 1180x820, and 820x1180. It flies to Kyoto, Tokyo, and Hakone and opens one card.
- `func.mjs`: functional checks. It tests tap picking, drag, Add and Pass, saved choices, and the who picker.
- `lib.mjs`: shared helpers. Other scripts (`smoke`, `fps`, `seam`, `tour`, `dbg*`) are one-off checks.

Notes:

- `lib.mjs` blocks Google Fonts. It serves Three.js from `_test/node_modules`. Seals then use the serif fallback.
- Run `npm install` in `_test/` if `node_modules` is missing.
- The last run showed zero console errors.
- SwiftShader is slow. Frame rate numbers from this method mean nothing.

### Mac method (Chrome on the Mac)

- The Mac shell tool (`device_bash`) runs in a Linux VM. Its localhost is NOT the Mac's. Do not serve from there.
- Start a server on the Mac with the osascript tool:
  `do shell script "cd '/Users/cade/Claude-Sandbox/Personal Projects/japan-3d-map' && (nohup /usr/bin/python3 -m http.server 8787 --bind 127.0.0.1 > /tmp/japan-map-server.log 2>&1 &)"`
  `--bind 0.0.0.0` is blocked by the safety rules. Use 127.0.0.1 only.
- Open http://127.0.0.1:8787/index.html?v=N in Claude in Chrome. Bump `v` to beat cache. The service worker is off on localhost.
- The Chrome extension screenshot tool fails on this page (script injection timeout). Frame rate is fine. Use a macOS capture instead:
  `do shell script "/usr/sbin/screencapture -x '/Users/cade/Claude-Sandbox/Personal Projects/japan-3d-map/_scratch/shot.png'"`
  Then crop with PIL in `device_bash`, stage the file, and Read it. Chrome was the right half of a 3440x1440 screen (crop x 1720–3440).
- If the tab is hidden, requestAnimationFrame stops. Bring it to front with osascript (`tell application "Google Chrome" … set active tab index`).
- Stop the server when done: `do shell script "pkill -f 'http.server 8787'"`.

### Debug switches

- `?simple=1`: plain material.
- `?nomist=1`: no mist.
- `?seam=1`: tint the patches red.

The page also exposes `window.__map` (camera, controls, pins, `flyToRegion`, `openPlace`, `setWho`). The test scripts use it.

## How to publish

Status: Phase 3 pushed 2026-10-14. The app is live at https://cmrlmatthews-max.github.io/japanmap/.

- The Mac folder is a git repo on branch `main`. The remote `origin` is https://github.com/cmrlmatthews-max/japanmap.
- The Mac has no GitHub credentials (no keychain entry, no SSH key, no `gh`). Do not push from the Mac.
- Push method that works: commit on the Mac with osascript (`git add -A && git commit`). Then run `git bundle create _scratch/japanmap.bundle main`. Stage the bundle to the cloud workspace. Clone it there, set `origin` to the GitHub URL, and push. The cloud session needs the repo attached with push access (`add_repo`, access "push"). Cade chose this method on 2026-10-13.
- After a cloud push, run `git fetch` on the Mac only if the cloud made new commits. Normally the Mac makes all commits, so the two stay the same.
- GitHub Pages is on: branch `main`, folder root. Claude turned it on in Chrome (Settings, Pages). The GitHub API path for Pages is blocked through the cloud proxy.
- Then Cade opens that URL on iPhone and iPad and uses Share, Add to Home Screen. He tests there.
- After any change to a cached file, bump `CACHE` in `sw.js`. Then push again.

## How to fetch OSM data (Overpass)

The cloud and the Mac shell (`device_bash`) cannot reach Overpass. Chrome blocks a second download from the same site. The best method: run curl on the Mac itself through osascript. Native macOS curl has full network access.

1. Write the query to a file in `_scratch/` (for example with `device_bash`).
2. Run it with osascript. Overpass rejects curl without a user agent (HTTP 406):
   `do shell script "cd '/Users/cade/Claude-Sandbox/Personal Projects/japan-3d-map/_scratch' && curl -sS -m 150 -A 'japanmap/1.0 (personal project)' -H 'Accept: application/json' --data-urlencode data@q.overpassql https://overpass-api.de/api/interpreter -o out.json -w '%{http_code}'"`
3. Stage the file to the cloud and convert it there.

This method should also work for the terrain tiles. Try it before the Chrome method below.

## How to fetch terrain (sandbox and Mac shell cannot reach S3)

All four terrain files exist. Fetch again only to change a range or add a patch.

Navigate Claude in Chrome to any tile on the tile host (same origin), then run the code below with the javascript tool. Use this host: `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png`.

```js
async function grab(z,x0,x1,y0,y1,name){
  const nx=x1-x0+1, ny=y1-y0+1, W=nx*256, H=ny*256;
  const c=document.createElement('canvas'); c.width=W; c.height=H; const g=c.getContext('2d');
  for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++){
    const r=await fetch(`https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`);
    g.drawImage(await createImageBitmap(await r.blob()),(x-x0)*256,(y-y0)*256); }
  const d=g.getImageData(0,0,W,H).data; const h=new Int16Array(W*H);
  for(let i=0;i<W*H;i++) h[i]=Math.round(d[i*4]*256+d[i*4+1]+d[i*4+2]/256-32768);
  const hb=new TextEncoder().encode(JSON.stringify({z,x0,x1,y0,y1,w:W,h:H}));
  const blob=new Blob([new Uint32Array([hb.length]),hb,h.buffer]);
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); return name; }
await grab(9,448,455,201,203,'central-japan-z9.bin');
```

Downloads land in `Claude-Sandbox/Personal Projects/`. Move them with `mv` in `device_bash`.

**Download gotcha:** Chrome blocks a second automatic download from the same host. Use the virtual-host URL shown above. The same tiles are also at `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, which is a different host. With the virtual-host URL, Chrome shows a "Download multiple files" prompt. Cade must click Allow. He did this once, so that host now allows multiple downloads.

Bring the tab to the front before you start. A hidden tab cannot show the prompt.

Tile math (z, lon, lat): `x = floor((lon+180)/360 * 2^z)`, `y = floor((1 - ln(tan(φ)+sec(φ))/π)/2 * 2^z)`.

## How to make images with Gemini

Claude drives Gemini in Chrome (gemini.google.com). Use a new chat per image. Model "3.8 Flash" is fast (~70 s) and has the same image quality as Pro. Prefix the prompt with "Generate an image, not code." Downloads are JPEG.

For transparency, ask for a solid #FF00FF background. Then run `tools/key-magenta.py`. Find the download button with `find "Download full size image button"` and click by ref. Rename the file with `mv` right after.

When Gemini is open and waiting in Chrome, Claude runs the prompts and downloads the images. Claude does not hand the prompts back to Cade.

## Known gotchas

- `device_commit_files` needs `force: true` after the first write, or it rejects on mtime.
- The Mac shell cannot delete files. Move them to `_scratch/` instead.
- Gemini garbles kanji in grids. Single kanji and short titles are fine.
- Chrome blocks a second automatic download per host. See "How to fetch terrain".
- The Mac has no GitHub credentials. Push from the cloud. See "How to publish".
- The repo is `japanmap`. The Mac folder is `japan-3d-map`. Do not mix them up.
- The service worker caches the app files. After a change, bump `CACHE` in `sw.js`, or a phone shows the old version.
- OSM renamed the Hakone Tozan Railway to 小田急箱根鉄道線 in 2024. Search both names.
- Chrome blocks a second automatic download per site (overpass-api.de too). Use osascript curl instead.
