# Journey Through Japan (日本の旅) — 3D Map Concept

**Owner:** Cade (CMRLM)
**For:** Cade and Casey, fall 2027 honeymoon
**Date:** 2026-10-13
**Status:** Phase 0 (assets) and Phase 1 (paper and terrain) done 2026-10-13. Phase 2 (places and pins) next.

---

## 1. Vision

An interactive 3D map of central Japan, painted in sumi-e (ink wash) style. It runs as a Home Screen web app on iPhone and iPad. It shows the places you want to see, the route you will take, and the fall color you will chase. It also holds your photos and notes after the trip. The map looks like a scroll painting that you can tilt, turn, and fly through.

The map covers six regions: Tokyo, Hakone, Mount Fuji area, Kyoto, Nara, and Osaka.

Companion files:

- `places-and-data.md` — place list with kanji, readings, coordinates, transit, and data sources.
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
| Terrain | AWS Terrain Tiles (Terrarium PNG) at zoom 9 to 11 | Free. Global. Decodes in a shader. GSI tiles as a later upgrade for sharper Japan relief. |
| Coastline and lakes | Natural Earth 10m GeoJSON, clipped to the six regions | Public domain. Small file. |
| Rail lines | OSM Overpass export to GeoJSON, saved as a static file | One export. No live API calls. |
| Sun position | suncalc.js | Offline. 3 KB. |
| Fonts | Google Fonts: Yuji Syuku, Shippori Mincho | Free. Subset to the characters used. |
| Hosting | GitHub Pages, repo `japan-3d-map` | Same as your other apps. |
| App shell | PWA with manifest and service worker | Add to Home Screen. Works offline in Japan. |
| Data store | JSON files in `data/`; user choices in localStorage; photos in IndexedDB | No server. No account. |

**Performance plan**

- Load terrain for the six regions only, not all of Japan. Six tiles sets at zoom 9, upgraded to zoom 11 when the camera is close.
- Cap the terrain mesh at 256 by 256 vertices per region.
- Use one texture atlas for all seal and leaf sprites.
- Keep the total download under 25 MB so the service worker can cache it.
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

| Phase | Deliverable | Model | Reason |
|---|---|---|---|
| 0. Assets | Gemini images in `assets/`. You run the prompts. | Gemini (you) + Haiku to check filenames and sizes | Simple checks. |
| 1. Paper and terrain | Scroll frame, washi ground, one region (Hakone and Fuji) in 3D relief with ink-wash shader | Opus plans the shader. Sonnet builds. | The shader is the hard part. Build is routine after. |
| 2. Places and pins | All six regions. Seal pins from `places-and-data.md`. Tap for info card. | Sonnet builds. Haiku converts the table to JSON. | Data entry is repetitive. |
| 3. Route and fly-through | Shinkansen and local lines. Day-by-day itinerary. Play button. | Sonnet | Standard animation work. |
| 4. Fall, light, mist | Date slider. Sun position. Mist bands. Night mode. | Sonnet builds. Opus reviews the look. | Art judgment at review. |
| 5. Memories and merge | Photo pins. Notes. Two itinerary files that merge. Export and import as JSON. | Sonnet | Standard storage work. |
| 6. Polish and sound | Reduce Motion. Offline cache. Icon. Sound toggle with three short samples. Performance pass on your iPhone. | Opus reviews. Sonnet fixes. | Review needs judgment. |

**Working method:** Same as the philosophy game. I plan each phase, spawn agents for the build, review the result, and hand you a link to test.

---

## 9. Data files

```
japan-3d-map/
├── index.html
├── manifest.json
├── sw.js
├── css/
├── js/
│   ├── app.js
│   ├── terrain.js
│   ├── ink-shader.js
│   ├── pins.js
│   ├── route.js
│   ├── seasons.js
│   └── memories.js
├── data/
│   ├── places.json        ← from places-and-data.md
│   ├── itinerary.json     ← day-by-day plan
│   ├── rail.geojson       ← Overpass export
│   ├── coast.geojson      ← Natural Earth clip
│   └── foliage.json       ← average peak dates
├── assets/                ← Gemini images
└── fonts/
```

---

## 10. Risks

| Risk | Effect | Prevention |
|---|---|---|
| Terrain too heavy on iPhone | Low frame rate, hot phone | Six regions only. Vertex cap. Test on your phone at the end of Phase 1. |
| Gemini garbles kanji | Wrong seal characters | Prompts ask for one kanji per seal. Fallback: render seals live with Yuji Syuku. |
| Transparent PNGs come back opaque | Hard edges on sprites | Magenta key method in `gemini-prompts.md`. |
| Ink-wash shader looks digital | Loses the B2 feel | Use brush-mask images, not math, for edges. Opus review at Phase 1. |
| Fall dates wrong for 2027 | False expectations | UI note. Re-check tenki.jp in October 2027. |
| Coordinates off | Pins in the wrong spot | Rows marked "approx" in the places file get a map check in Phase 2. |
| Safari PWA storage limits | Photos lost after 7 days unused | Export to a file in Phase 5. Note in the UI. |

---

## 11. Decisions (2026-10-13)

1. Osaka is a full stop with its own nights. The route layer treats it like Kyoto.
2. Two itinerary files, one for Cade and one for Casey. The app merges them. A conflict shows both picks side by side.
3. Sound is in: a soft shamisen note on tap, wind on fly-through, water near Hakone. Off by default. One toggle.

---

## 12. Phase 1 notes (2026-10-13)

- App files: `index.html`, `css/style.css`, `js/app.js`, `js/terrain.js`, `js/ink-shader.js`, `manifest.json`, `sw.js`.
- Terrain data: `data/hakone-fuji-z11.bin` (AWS Terrarium tiles z11, x 1812–1816, y 806–810, 1280 x 1280, int16 meters). Fetched through Chrome because the sandbox and the Mac shell cannot reach the tile server.
- The wide-area file `central-japan-z9.bin` is not in yet. Chrome blocked the second download. Fetch it at the start of Phase 2.
- Local test: `python3 -m http.server 8787 --bind 127.0.0.1` in the project folder, then open http://127.0.0.1:8787/. The service worker is off on localhost.
- Debug switches: `?simple=1` uses a plain material. `?nomist=1` hides mist.
- Known rough spots for Phase 4: mist bands read as flat strips; the ink shader needs a second pass on band contrast.
- Screenshot: `_scratch/phase1-screenshot.jpg`.

## 13. Next step

Create the GitHub repo `japan-3d-map` and push, so the app runs on your iPhone. Then Phase 2: all six regions, seal pins from `places-and-data.md`, info cards.

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

**Confidence:** High on the stack, style, and layer plan. Medium on fall dates and some coordinates; both are marked for a check in Phase 2.
