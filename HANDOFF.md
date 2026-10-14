# HANDOFF — Journey Through Japan (日本の旅) 3D map

Read this first in a new chat. It holds the state, the decisions, and the working method.
Last update: 2026-10-13, end of Phase 2. The push to GitHub is still open.

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
├── sw.js                      ← offline cache, name 'nihon-no-tabi-v3'. Bump the version when a cached file changes.
├── js/app.js                  ← renderer, camera, region flights, place fly-to, free-area aiming, labels, mist
├── js/terrain.js              ← world frame, file loaders, base and patch meshes, lonLatToWorld(), heightAtWorld()
├── js/ink-shader.js           ← ShaderMaterial: height bands, dry-brush streaks, contours, coast, washi grain, edge fade, patch cut-outs
├── js/pins.js                 ← canvas hanko seals, pin sprites, labels, fade by distance, overlap culling, tap picking
├── js/ui.js                   ← info card, region crests, category filter row, who picker, saved choices (localStorage)
├── data/central-japan-z9.bin  ← base terrain, z9, 2048x768
├── data/hakone-fuji-z11.bin   ← patch, z11, 1280x1280
├── data/tokyo-z11.bin         ← patch, z11, 1024x768
├── data/kansai-z11.bin        ← patch, z11, 1024x1280 (Kyoto, Nara, Osaka in one file)
├── data/places.json           ← 75 places. The source of truth for pins.
├── assets/*.png               ← keyed art assets, originals (see gemini-prompts.md status table)
├── assets/web/                ← web copies the app loads: washi, mist, card background, caps, title, 6 crests, 3 icons (1.7 MB)
├── assets/_jpeg-originals/    ← raw Gemini downloads (gitignored)
├── tools/key-magenta.py       ← magenta key → RGBA PNG
├── _scratch/                  ← screenshots, test images (gitignored)
├── _test/                     ← Playwright test scripts. Cloud container only. Gitignored.
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

- Style: B2 ink wash. Palette: paper #F5EFE0, ink #2C2C2A, greys #B9B6AC / #8E8B82 / #5B5952, vermilion #C8341E only accent, gold #C9A227 fall only.
- Fonts: Yuji Syuku (kanji labels), Shippori Mincho (readings, body). Google Fonts.
- Seal pins render live in canvas textures with Yuji Syuku. No image asset (Gemini could not make the kanji grid).
- Camera: slow and deliberate. 2 s fly-to on tap. Region flights take about 3.5 s with an arc. "Still camera" seal toggle (動). Tilt limit 20–70°. Layer toggles never move the camera.
- Osaka is a full stop. Two itinerary files (Cade, Casey) that merge. Sound yes, off by default (Phase 6).
- One continuous world. One base file plus three patches. No separate scene per region.
- One Kansai file covers Kyoto, Nara, and Osaka. Cade approved this.
- Vertical exaggeration is 2.0.
- Hosting: GitHub Pages. The repo name is `japanmap` (not `japan-3d-map`). Repo URL: https://github.com/cmrlmatthews-max/japanmap. The Pages URL is https://cmrlmatthews-max.github.io/japanmap/ after the push and the Pages setup.
- `gh` is NOT on the Mac. The Mac also has no GitHub credentials. See "How to publish".
- The info card is a washi panel. It is a bottom sheet on iPhone portrait. It docks on the right on iPad and on iPhone landscape. This differs from the concept doc. The height of a landscape phone is too small for a bottom sheet.
- Markdown for all docs. Short sentences (ASD-STE100 style).

## Phase status

| Phase | Status |
|---|---|
| 0 Assets | Done. 14 PNGs keyed. |
| 1 Paper and terrain | Done. Hakone–Fuji terrain, ink shader, scroll frame, labels, mist. 190 fps in Chrome. Screenshot: `_scratch/phase1-screenshot.jpg` |
| 2 Places and pins | Done 2026-10-13. Not yet pushed to GitHub. Not yet tested on a real iPhone or iPad. |
| 3 Route and fly-through | NEXT |
| 4 Fall, light, mist | Mist bands still read as billboard strips. Band contrast needs a second pass. |
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

## Phase 3 scope

Goal: show the route and fly along it. Ask Cade numbered questions before you build. Wait for "go".

1. `data/rail.geojson`: export the rail lines from OSM Overpass as one static file. Clip it to the six regions. Check first whether the cloud container can reach Overpass. If it cannot, fetch the data through Chrome like the terrain.
2. `data/itinerary.json`: the day-by-day plan. One stop list per day. Each stop uses a `placeId` from `places.json`. Cade needs to give the day plan and the nights per city.
3. `js/route.js`: draw the route layer. Shinkansen is a thick vermilion dashed line. Local trains are thin. Walking is dotted.
4. Route seal in the left seal column. It turns the layer on and off. It never moves the camera.
5. Itinerary panel: a fold-out washi page. It slides up from the bottom on iPhone. It docks on the right on iPad.
6. Play button, pause button, and scrub bar. Each hop lasts 6 to 8 seconds. Each stop pauses 3 seconds.
7. Reuse `flyToPose` and `freeRect` from `js/app.js`. Follow the reduced motion rule.
8. Review on screen (Opus). Then update this file and the concept doc.

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

Status: NOT done. The local repo exists. The push is open.

- The local repo is initialized in the Mac folder. The branch is `main`. It has one commit. The remote `origin` is set to https://github.com/cmrlmatthews-max/japanmap.
- The Mac has no GitHub credentials. It has no keychain entry, no SSH key, and no `gh`. A push from the Mac fails today.
- Cade must do one of two things. He pushes from his own terminal. Or he gives a credentials route, for example a token that Claude can use for one push.
- After the push, Cade enables GitHub Pages. Settings, Pages, source: branch `main`, folder root.
- The app is then live at https://cmrlmatthews-max.github.io/japanmap/.
- Then Cade opens that URL on iPhone and iPad and uses Share, Add to Home Screen. He tests there.
- After any change to a cached file, bump `CACHE` in `sw.js`. Then push again.

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
- The Mac has no GitHub credentials. See "How to publish".
- The repo is `japanmap`. The Mac folder is `japan-3d-map`. Do not mix them up.
- The service worker caches the app files. After a change, bump `CACHE` in `sw.js`, or a phone shows the old version.
