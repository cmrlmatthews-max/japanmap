# Journey Through Japan (日本の旅) — 3D Map Concept

**Owner:** Cade (CMRLM)
**For:** Cade and Casey, fall 2027 honeymoon
**Date:** 2026-10-13
**Status:** Phases 0, 1, and 2 done 2026-10-13. Phase 2 (places and pins) is complete except the push to GitHub. Phase 3 (route and fly-through) is next.

---

## 1. Vision

An interactive 3D map of central Japan, painted in sumi-e (ink wash) style. It runs as a Home Screen web app on iPhone and iPad. It shows the places you want to see, the route you will take, and the fall color you will chase. It also holds your photos and notes after the trip. The map looks like a scroll painting that you can tilt, turn, and fly through.

The map covers six regions: Tokyo, Hakone, Mount Fuji area, Kyoto, Nara, and Osaka.

Companion files:

- `places-and-data.md` — first place list with transit, data sources, fall dates, and fonts. For coordinates, `data/places.json` now replaces it.
- `gemini-prompts.md` — image prompts for the art assets.

---

## 2. Style direction: B2 ink wash

**Palette**

| Name | Hex | Use |
|---|---|---|
| Rice paper | #F5EFE0 | Ground, sky, panels |
| Sumi ink | #2C2C2A | Lines, text, calligraphy |
| Grey light | #B9B6AC | Far mountain layer |
| Grey mid | #8E8B82 | Middle mountain layer |
| Grey dark | #5B5952 | Near mountain layer |
| Vermilion | #C8341E | Pins, route, torii, seals |
| Gold | #C9A227 | Fall leaves, ginkgo |

**Rules**

- Vermilion is the only accent color in normal view. Gold appears only in the fall layer.
- No digital gradients. Use layered flat washes and brush-edge masks.
- Terrain has soft edges, never hard polygon edges.
- Mist bands sit between terrain layers to show depth.
- All text uses two fonts: Yuji Syuku for kanji labels, Shippori Mincho for readings and body text.

**Calligraphy**

- Title: 日本の旅 as a brush image (Gemini asset) with a fallback in Yuji Syuku.
- Place labels: kanji in Yuji Syuku, hiragana reading below in small Shippori Mincho, English below that.
- Seal pins: red hanko (seal) squares with one kanji per category, drawn live in a canvas texture with Yuji Syuku. Gemini could not produce an exact kanji grid, so no image asset is used. See section 4.

**Scroll frame**

- The map sits inside a horizontal emakimono (picture scroll). Wooden roller caps sit at the left and right edges of the screen.
- The itinerary panel slides up from the bottom as a fold-out washi page.
- On iPad, the itinerary panel can dock to the right side.

---

## 3. Layers

Each layer has a toggle in a small vertical seal menu on the left edge.

| Layer | Default | What it shows |
|---|---|---|
| Terrain | On | 3D relief from real elevation data. Fuji, Hakone, and the Kyoto hills stand out. |
| Route | On | Day-by-day path. Shinkansen as a thick vermilion dashed line. Local trains thin. Walking dotted. |
| Places | On | Seal pins by category. Core pins solid. Suggested pins outlined. |
| Fall color | Off | Momiji and ginkgo washes that spread by date. Slider from Nov 1 to Dec 10. |
| Architecture | Off | Filters to architecture pins. Shows architect name on tap. |
| Light | Off | Sun position by time of day. Sunset turns the paper warm. Night turns it deep grey with lantern dots. |
| Memories | Off | Photo and note pins. Empty until the trip. |

**Fall color rule:** 2027 forecasts do not exist yet. The layer uses average peak dates. See `places-and-data.md` Part 3. Add a note in the UI: "Average dates. Check tenki.jp in October 2027."

---

## 4. Place categories and seal kanji

| Category | Kanji | Meaning |
|---|---|---|
| temple | 寺 | tera |
| shrine | 社 | sha (yashiro) |
| ryokan | 宿 | yado (inn) |
| garden | 庭 | niwa |
| architecture | 建 | ken (build) |
| onsen | 湯 | yu (hot water) |
| technology | 技 | waza (skill) |
| art | 芸 | gei (art) |

**Suggestions:** Each suggested pin shows an outline seal. Tap it to read why it is suggested. Two buttons: "Add to trip" turns the seal solid. "Pass" fades the pin to 20 percent. The choice saves on the device. Both of you can review on your own phones. Sync is in Phase 5.

---

## 5. Camera and motion rules

Motion must feel slow and deliberate. Every move has an easing curve that starts slow and ends slow.

- **Fly-to on tap:** 2.0 seconds. The camera moves to the place and tilts to 45 degrees. A setting named "Still camera" turns this off. When off, the pin only pulses.
- **Itinerary fly-through:** Press play. The camera follows the route city by city. Each hop lasts 6 to 8 seconds. Each stop pauses 3 seconds. A pause button and a scrub bar sit at the bottom.
- **Free orbit:** One finger drags to turn. Two fingers pinch to zoom. Two fingers drag to tilt. Tilt limit is 20 to 70 degrees so the map never flips.
- **No surprise moves.** Layer toggles never move the camera.
- **Reduce motion:** If iOS "Reduce Motion" is on, all moves become instant cross-fades.

---

## 6. Tech stack

| Part | Choice | Reason |
|---|---|---|
| 3D engine | Three.js | Same as Anatomy 3D. You know it. Runs well on iPhone. |
| Terrain | AWS Terrain Tiles (Terrarium PNG). One z9 base file plus three z11 patch files. | Free. Global. Saved as int16 files that load fast. GSI tiles as a later upgrade for sharper Japan relief. |
| Coastline and lakes | Natural Earth 10m GeoJSON, clipped to the six regions | Public domain. Small file. |
| Rail lines | OSM Overpass export to GeoJSON, saved as a static file | One export. No live API calls. |
| Sun position | suncalc.js | Offline. 3 KB. |
| Fonts | Google Fonts: Yuji Syuku, Shippori Mincho | Free. Subset to the characters used. |
| Hosting | GitHub Pages, repo `japanmap` | Same as your other apps. |
| App shell | PWA with manifest and service worker | Add to Home Screen. Works offline in Japan. |
| Data store | JSON files in `data/`; user choices in localStorage; photos in IndexedDB | No server. No account. |

**Performance plan**

- Load terrain for central Japan only, not all of Japan. One base file at zoom 9 covers the whole area. Three patch files at zoom 11 add detail.
- Cap each patch mesh at 256 vertices on its long side. The base mesh is 512 by 192 vertices.
- Use one texture atlas for all seal and leaf sprites.
- Keep the total download under 25 MB so the service worker can cache it. At the end of Phase 2 the total is about 13 MB.
- Target 60 fps on iPhone 15 and newer. Target 30 fps minimum on older phones.

---

## 7. Screen layout

**iPhone (portrait)**

```
┌──────────────────────────────┐
│ 日本の旅          [≡] [⌕]     │  title, menu, search
│                              │
│  ┃                        ┃  │  scroll roller caps at both sides
│  ┃      3D MAP            ┃  │
│  ┃                        ┃  │
│  ┃   ● Kyoto              ┃  │
│  ┃            ▲ Fuji      ┃  │
│  ┃                        ┃  │
│ [寺][社][宿][庭][建][湯][技][芸] │  category filter row
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ ▲ Day 3 · Kyoto · 3 stops   │  itinerary drawer handle
└──────────────────────────────┘
```

**iPad (landscape)**

Map on the left, 70 percent. Itinerary page docked on the right, 30 percent. Layer seals on the left edge.

---

## 8. Build phases and model plan

Each phase ends with a working app you can open on your phone.

| Phase | Deliverable | Model | Reason | Status |
|---|---|---|---|---|
| 0. Assets | Gemini images in `assets/`. You run the prompts. | Gemini (you) + Haiku to check filenames and sizes | Simple checks. | Done 2026-10-13 |
| 1. Paper and terrain | Scroll frame, washi ground, one region (Hakone and Fuji) in 3D relief with ink-wash shader | Opus plans the shader. Sonnet builds. | The shader is the hard part. Build is routine after. | Done 2026-10-13 |
| 2. Places and pins | All six regions. Seal pins from `places.json`. Tap for info card. | Sonnet builds. Haiku converts the table to JSON. Sonnet checks the data. | Data entry is repetitive. | Done 2026-10-13. Push to GitHub open. |
| 3. Route and fly-through | Shinkansen and local lines. Day-by-day itinerary. Play button. | Sonnet | Standard animation work. | Next |
| 4. Fall, light, mist | Date slider. Sun position. Mist bands. Night mode. | Sonnet builds. Opus reviews the look. | Art judgment at review. | |
| 5. Memories and merge | Photo pins. Notes. Two itinerary files that merge. Export and import as JSON. | Sonnet | Standard storage work. | |
| 6. Polish and sound | Reduce Motion. Offline cache. Icon. Sound toggle with three short samples. Performance pass on your iPhone. | Opus reviews. Sonnet fixes. | Review needs judgment. | |

**Working method:** Same as the philosophy game. I plan each phase, spawn agents for the build, review the result, and hand you a link to test.

---

## 9. Data files

The local folder on the Mac is `japan-3d-map`. The GitHub repo is `japanmap`. Files marked "Phase 3" and later do not exist yet.

```
japan-3d-map/
├── index.html
├── manifest.json
├── sw.js                       ← offline cache, v3
├── css/
│   └── style.css
├── js/
│   ├── app.js                  ← camera, flights, labels, mist
│   ├── terrain.js              ← world frame, loaders, meshes
│   ├── ink-shader.js           ← ink-wash material
│   ├── pins.js                 ← seal pins, labels, picking
│   ├── ui.js                   ← info card, crests, filters, who picker
│   ├── route.js                ← Phase 3
│   ├── seasons.js              ← Phase 4
│   └── memories.js             ← Phase 5
├── data/
│   ├── central-japan-z9.bin    ← base terrain, z9, 2048x768
│   ├── hakone-fuji-z11.bin     ← patch, 1280x1280
│   ├── tokyo-z11.bin           ← patch, 1024x768
│   ├── kansai-z11.bin          ← patch, 1024x1280 (Kyoto, Nara, Osaka)
│   ├── places.json             ← 75 places, checked
│   ├── itinerary.json          ← Phase 3, day-by-day plan
│   ├── rail.geojson            ← Phase 3, Overpass export
│   ├── coast.geojson           ← Natural Earth clip (not used: the coast comes from the terrain)
│   └── foliage.json            ← Phase 4, average peak dates
├── assets/                     ← Gemini images (originals)
│   └── web/                    ← web copies the app loads (1.7 MB)
├── tools/key-magenta.py
└── fonts/                      ← not used yet: fonts load from Google Fonts
```

Not in the repo: `assets/_jpeg-originals/`, `_scratch/`, and `_test/`. They are gitignored.

---

## 10. Risks

| Risk | Effect | Prevention |
|---|---|---|
| Terrain too heavy on iPhone | Low frame rate, hot phone | Central Japan only. Vertex cap. Test on your phone after the first push. Not yet done. |
| Gemini garbles kanji | Wrong seal characters | Prompts ask for one kanji per seal. Fallback: render seals live with Yuji Syuku. |
| Transparent PNGs come back opaque | Hard edges on sprites | Magenta key method in `gemini-prompts.md`. |
| Ink-wash shader looks digital | Loses the B2 feel | Use brush-mask images, not math, for edges. Opus review at Phase 1. |
| Fall dates wrong for 2027 | False expectations | UI note. Re-check tenki.jp in October 2027. |
| Coordinates off | Pins in the wrong spot | Two agents checked all 75 rows in Phase 2. Fixes are in `places.json`. A few rows keep notes. See section 13. |
| Safari PWA storage limits | Photos lost after 7 days unused | Export to a file in Phase 5. Note in the UI. |

---

## 11. Decisions (2026-10-13)

1. Osaka is a full stop with its own nights. The route layer treats it like Kyoto.
2. Two itinerary files, one for Cade and one for Casey. The app merges them. A conflict shows both picks side by side.
3. Sound is in: a soft shamisen note on tap, wind on fly-through, water near Hakone. Off by default. One toggle.
4. The map is one continuous world. One base file and three patch files make it. There is no separate scene per region.
5. One Kansai file covers Kyoto, Nara, and Osaka. Cade approved it in Phase 2.
6. The GitHub repo is named `japanmap`.
7. The info card docks on the right on iPad and on iPhone landscape. It is a bottom sheet on iPhone portrait.
8. Vertical exaggeration is 2.0.

---

## 12. Phase 1 notes (2026-10-13)

- App files: `index.html`, `css/style.css`, `js/app.js`, `js/terrain.js`, `js/ink-shader.js`, `manifest.json`, `sw.js`.
- Terrain data: `data/hakone-fuji-z11.bin` (AWS Terrarium tiles z11, x 1812–1816, y 806–810, 1280 x 1280, int16 meters). Fetched through Chrome because the sandbox and the Mac shell cannot reach the tile server.
- At the end of Phase 1, the wide-area file `central-japan-z9.bin` was missing. Chrome had blocked the second download. Phase 2 fetched it. See section 13.
- Local test: `python3 -m http.server 8787 --bind 127.0.0.1` in the project folder, then open http://127.0.0.1:8787/. The service worker is off on localhost.
- Debug switches: `?simple=1` uses a plain material. `?nomist=1` hides mist.
- Known rough spots for Phase 4: mist bands read as flat strips; the ink shader needs a second pass on band contrast.
- Screenshot: `_scratch/phase1-screenshot.jpg`.

## 13. Phase 2 notes (2026-10-13)

Phase 2 is done except the push to GitHub. The app now has one continuous world, 75 seal pins, and an info card.

**Terrain**

- One base file and three patches form the world. The base is `data/central-japan-z9.bin` (z9, x 448–455, y 201–203, 2048 x 768).
- The patches are at z11. `hakone-fuji-z11.bin` is x 1812–1816, y 806–810 (1280 x 1280). `tokyo-z11.bin` is x 1817–1820, y 805–807 (1024 x 768). `kansai-z11.bin` is x 1794–1797, y 810–814 (1024 x 1280).
- The world frame uses z11 Web Mercator pixels. Ten pixels equal one world unit. The origin is the center of the base file.
- Seams: the base discards fragments inside the patch rectangles. Each patch blends its outer 8 percent toward the base height. The base uses polygonOffset.
- The base outer edge fades out with a noisy brush edge.
- Vertical exaggeration is 2.0.
- Chrome blocks a second automatic download per host. The tiles are also on `elevation-tiles-prod.s3.amazonaws.com`. Chrome then asks "Download multiple files". Cade clicked Allow. Details are in `HANDOFF.md`.

**Places**

- `data/places.json` holds 75 places: 42 core and 33 suggestion. Tokyo 25, Kyoto 21, Hakone 8, Nara 8, Osaka 8, Fuji 5.
- Fields: `id`, `name`, `kanji`, `yomi`, `category`, `region`, `lat`, `lng`, `why`, `status`, `tier`, `architect`, `best`, `booking`, `sources`, `checked`.
- Haiku converted the table. Two Sonnet agents checked every row against Wikipedia, official sites, and map links.
- Ten suggestions are new: 21_21 Design Sight, Rikugien, Tokyo International Forum, Hakone Gora Park, Kawaguchiko Momiji Corridor, Eikan-do, Byodo-in, Kyoto Railway Museum, Yoshiki-en, Tower of the Sun.
- The check fixed many coordinates. Hakone and Fuji rows were 0.5 to 5 km off (Oshino Hakkai 5.3 km, Kubota museum 4.6 km). Church of the Light was 3.8 km off. Chikatsu-Asuka was 5.8 km off. It is in Kanan, not Fujiidera.
- The check fixed readings. 浅草寺 is せんそうじ. The Hakone glass museum is 箱根ガラスの森美術館. The bamboo grove is 竹林の小径.
- `places.json` now replaces `places-and-data.md` for coordinates.
- Notes to recheck before the trip: Church of the Light tours are suspended since 2024. The Nintendo Museum is lottery only; apply about 3 months ahead. Owakudani access is limited when volcanic activity rises. Hoshinoya Fuji is a glamping resort and stays in 宿. Gora and Sengokuhara fall color may be past peak in late November.

**App files**

- `js/terrain.js`: world frame, file loaders, meshes.
- `js/pins.js`: canvas hanko seals in 8 categories. A core pin is solid. A suggestion is an outline. A passed pin shows at 20 percent. Pins keep a constant screen size and fade with distance. Labels that overlap are culled. Pins under UI elements are hidden.
- `js/ui.js`: info card, crests, filter row, who picker.
- `js/app.js`: camera, flights with an arc, free-area aiming, and the mist shader.

**Info card and choices**

- The card is a washi panel (`assets/web/card-bg.jpg`). It shows kanji, reading, English name, why, architect, best time, booking, tier, and the core or suggestion mark. It has "Add to trip", "Pass", and the sources.
- On iPhone portrait the card is a bottom sheet. On iPad and on iPhone landscape it docks on the right. This differs from section 7. The height of a landscape phone was too small for a bottom sheet.
- On first open, a picker asks "Cade (ケイド) or Casey (ケイシー)". The seal at the top right switches the person.
- Choices save in localStorage under `jmap.v1`. The shape is `{ who, choices: { cade: { placeId: { c, t } }, casey: { ... } } }`.
- Six crests are sliced to `assets/web/crest-*.png`. A filter row at the bottom has 8 seals.

**Camera**

- A region flight takes about 3.5 seconds with an arc. A place fly-to takes 2.0 seconds.
- The function `freeRect` finds the screen area that no UI covers. The camera aims so that the target lands in that area.
- With reduced motion, or with "Still camera" on, the camera cuts at once. A paper cross-fade hides the cut.

**Size**

- Web copies of the art are in `assets/web/` (1.7 MB). The originals stay in `assets/`.
- The service worker cache is v3. The `data/` folder is 11 MB.

**Testing**

- Tests ran in headless Chromium with Playwright and SwiftShader in the cloud container. Scripts: `p2all.mjs` (screens at 390x844, 844x390, 1180x820, 820x1180) and `func.mjs` (functional checks). They are in a cloud-only `_test` folder.
- There were zero console errors.
- The app is not yet tested on a real iPhone or iPad.

**Git**

- The repo is https://github.com/cmrlmatthews-max/japanmap. It is not `japan-3d-map`.
- The local repo is initialized in the Mac folder. The branch is `main`. It has one commit. The remote `origin` is set.
- The Mac has no GitHub credentials: no keychain entry, no SSH key, no `gh`. The push is NOT done.
- The Pages URL, after the push and the Pages setup, is https://cmrlmatthews-max.github.io/japanmap/.
- `.gitignore` ignores `assets/_jpeg-originals/`, `_scratch/`, `_test/`, `node_modules/`, `data/tiles/`, and `.DS_Store`.

**Known issues for later phases**

- The mist is still a set of billboard bands. Phase 4 replaces it.
- The land strip is about 2.75 to 1. In landscape, the overview uses about one third of the screen height.
- On iPhone portrait, the scroll rollers cover much of the width. Some pins near the edges sit under them.
- The camera does not aim again after a screen rotation.
- The Tokyo area is flat, so it reads as plain paper. For Phase 4, consider a water or wave wash for the sea. Use `assets/wave-pattern-tile.png`.
- Coastlines are slightly stair-stepped at the overview zoom.

## 14. Next step

1. Cade pushes the repo to GitHub, or he gives a credentials route. Then Claude pushes.
2. Cade enables GitHub Pages: branch `main`, folder root.
3. Cade opens https://cmrlmatthews-max.github.io/japanmap/ on iPhone and iPad. He adds it to the Home Screen and tests it.
4. Phase 3: route and fly-through. Export `rail.geojson` from Overpass. Write `itinerary.json`. Add the route layer and the play button.

---

## Sources

- AWS Terrain Tiles: https://registry.opendata.aws/terrain-tiles/
- GSI tiles (Japan): https://maps.gsi.go.jp/development/ichiran.html
- Natural Earth: https://www.naturalearthdata.com/downloads/
- OSM Overpass: https://overpass-api.de/
- suncalc: https://github.com/mourner/suncalc
- Google Fonts Yuji Syuku: https://fonts.google.com/specimen/Yuji+Syuku
- Japan Guide autumn color reports: https://www.japan-guide.com/e/e2344.html
- tenki.jp koyo forecast: https://tenki.jp/koyo/
- AWS Terrarium tiles, virtual-host form: https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png
- Place checks: Wikipedia, the official site of each place, and map links (listed per row in `data/places.json`)
- Playwright: https://playwright.dev/
- Repo: https://github.com/cmrlmatthews-max/japanmap
- Pages (after setup): https://cmrlmatthews-max.github.io/japanmap/

**Confidence:** High on the stack, style, and layer plan. Medium on fall dates. They are averages, and the UI says so.

**Confidence (places data):** High for core coordinates. Two agents checked them against Wikipedia, official sites, and map links. Medium for a few rows that carry notes. These are Church of the Light (tours suspended), Nintendo Museum (lottery), and Owakudani (volcanic access). The others are Hoshinoya Fuji (glamping) and Gora and Sengokuhara (late November color).

