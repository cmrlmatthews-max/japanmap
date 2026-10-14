# HANDOFF — Journey Through Japan (日本の旅) 3D map

Read this first in a new chat. It holds the state, the decisions, and the working method.
Last update: 2026-10-13, end of Phase 1.

## Project in one paragraph

An interactive 3D map of central Japan in sumi-e (ink wash) style, for Cade and Casey's fall 2027 honeymoon. It runs as a Home Screen web app on iPhone and iPad, built with Three.js, hosted on GitHub Pages. Six regions: Tokyo, Hakone, Mount Fuji area, Kyoto, Nara, Osaka. Full plan: `japan-3d-map-concept.md`.

## Where things are

```
japan-3d-map/
├── HANDOFF.md                 ← this file
├── japan-3d-map-concept.md    ← vision, style B2, layers, phases, decisions, Phase 1 notes
├── places-and-data.md         ← ~80 places (kanji, hiragana, category, lat/lng), transit, data sources, foliage dates, fonts
├── gemini-prompts.md          ← image prompts + status table of what was generated
├── index.html, css/style.css, manifest.json, sw.js
├── js/app.js                  ← scene, camera, labels, mist, UI seals
├── js/terrain.js              ← loads data/*.bin, builds mesh, lonLatToWorld(), heightAtWorld()
├── js/ink-shader.js           ← ShaderMaterial: height bands, dry-brush streaks, contours, coast, washi grain, edge fade
├── data/hakone-fuji-z11.bin   ← int16 heights, 1280x1280, AWS Terrarium z11 x1812–1816 y806–810
├── assets/*.png               ← 14 keyed art assets (see gemini-prompts.md status table)
├── assets/_jpeg-originals/    ← raw Gemini downloads (gitignored)
├── tools/key-magenta.py       ← magenta key → RGBA PNG
└── _scratch/                  ← screenshots, test images (gitignored)
```

Data file format: `uint32 headerLength` + JSON header `{z,x0,x1,y0,y1,w,h}` + `Int16Array` heights in meters, row-major. Sea is clamped to 0 in the loader.

## Decisions already made (do not re-ask)

- Style: B2 ink wash. Palette: paper #F5EFE0, ink #2C2C2A, greys #B9B6AC / #8E8B82 / #5B5952, vermilion #C8341E only accent, gold #C9A227 fall only.
- Fonts: Yuji Syuku (kanji labels), Shippori Mincho (readings, body). Google Fonts.
- Seal pins render live in canvas textures with Yuji Syuku. No image asset (Gemini could not make the kanji grid).
- Camera: slow and deliberate. 2 s fly-to on tap, "Still camera" seal toggle (動). Tilt limit 20–70°. Layer toggles never move the camera.
- Osaka is a full stop. Two itinerary files (Cade, Casey) that merge. Sound yes, off by default (Phase 6).
- Hosting: GitHub Pages, repo `japan-3d-map`. Not created yet. `gh` is NOT on the Mac; Cade creates the empty repo, then push with git from the Mac shell.
- Markdown for all docs. Short sentences (ASD-STE100 style).

## Phase status

| Phase | Status |
|---|---|
| 0 Assets | Done. 14 PNGs keyed. |
| 1 Paper and terrain | Done. Hakone–Fuji terrain, ink shader, scroll frame, labels, mist. 190 fps in Chrome. Screenshot: `_scratch/phase1-screenshot.jpg` |
| 2 Places and pins | NEXT |
| 3 Route and fly-through | |
| 4 Fall, light, mist | Mist bands currently read as flat strips. Band contrast needs a second pass. |
| 5 Memories and merge | |
| 6 Polish and sound | |

## Phase 2 scope

1. Fetch wide-area terrain `central-japan-z9.bin` (z9, x 448–455, y 201–203, 2048x768). Chrome blocked it as a second download last time. Fetch it FIRST in a fresh tab, one download per page load. JS snippet is in the "How to fetch terrain" section below.
2. Region terrain for Tokyo, Kyoto, Nara, Osaka at z11 (compute tile ranges from lat/lng like Hakone–Fuji). One file per region. Keep each ≤ 1280x1280.
3. `data/places.json` from `places-and-data.md` (Haiku-class agent). Fields: id, name, kanji, yomi, category, region, lat, lng, why, status (core|suggestion), tier.
4. Seal pins: canvas-drawn hanko sprites per category (寺 社 宿 庭 建 湯 技 芸), solid for core, outline for suggestion. Billboard sprites, constant screen size, tap → info card.
5. Info card: washi panel (assets/itinerary-page-bg.png), kanji + yomi + English, why, "Add to trip" / "Pass" buttons. Choices in localStorage.
6. Region picker: six crests from `assets/city-crest-set.png` (6 cells of 848 px). Tap → slow fly to region, swap terrain.
7. Category filter row (8 seals) at bottom.
8. Review on screen (Opus), then update this file and the concept doc.

## Working method (Cade's expectations)

- Cade does not run prompts or scripts himself. Claude does it, with agents where useful. Name the model per task (Opus plan/review, Sonnet build, Haiku data).
- Ask numbered questions before building something new. Give a short summary and wait for "go" before creating files.
- Save work to this folder. The folder is attached to the Claude project.

## How to test the app

- The Mac shell tool (`device_bash`) runs in a Linux VM. Its localhost is NOT the Mac's. Do not serve from there.
- Start a server on the Mac with the osascript tool:
  `do shell script "cd '/Users/cade/Claude-Sandbox/Personal Projects/japan-3d-map' && (nohup /usr/bin/python3 -m http.server 8787 --bind 127.0.0.1 > /tmp/japan-map-server.log 2>&1 &)"`
  `--bind 0.0.0.0` is blocked by the safety rules. 127.0.0.1 only.
- Open http://127.0.0.1:8787/index.html?v=N in Claude in Chrome. Bump `v` to beat cache. The service worker is off on localhost.
- The Chrome extension screenshot tool fails on this page (script injection timeout). Frame rate is fine. Use a macOS capture instead:
  `do shell script "/usr/sbin/screencapture -x '/Users/cade/Claude-Sandbox/Personal Projects/japan-3d-map/_scratch/shot.png'"`
  then crop with PIL in `device_bash`, stage, and Read. Chrome was the right half of a 3440x1440 screen (crop x 1720–3440).
- If the tab is hidden, requestAnimationFrame stops. Bring it to front with osascript (`tell application "Google Chrome" … set active tab index`).
- Stop the server when done: `do shell script "pkill -f 'http.server 8787'"`.
- Debug switches: `?simple=1` (plain material), `?nomist=1`.

## How to fetch terrain (sandbox and Mac shell cannot reach S3)

Navigate Claude in Chrome to any `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/...png` tile (same origin), then run with the javascript tool:

```js
async function grab(z,x0,x1,y0,y1,name){
  const nx=x1-x0+1, ny=y1-y0+1, W=nx*256, H=ny*256;
  const c=document.createElement('canvas'); c.width=W; c.height=H; const g=c.getContext('2d');
  for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++){
    const r=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`);
    g.drawImage(await createImageBitmap(await r.blob()),(x-x0)*256,(y-y0)*256); }
  const d=g.getImageData(0,0,W,H).data; const h=new Int16Array(W*H);
  for(let i=0;i<W*H;i++) h[i]=Math.round(d[i*4]*256+d[i*4+1]+d[i*4+2]/256-32768);
  const hb=new TextEncoder().encode(JSON.stringify({z,x0,x1,y0,y1,w:W,h:H}));
  const blob=new Blob([new Uint32Array([hb.length]),hb,h.buffer]);
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); return name; }
await grab(9,448,455,201,203,'central-japan-z9.bin');
```
Downloads land in `Claude-Sandbox/Personal Projects/`. Move with `mv` in `device_bash`. One download per page load, or Chrome blocks the second.

Tile math (z, lon, lat): `x = floor((lon+180)/360 * 2^z)`, `y = floor((1 - ln(tan(φ)+sec(φ))/π)/2 * 2^z)`.

## How to make images with Gemini

Claude drives Gemini in Chrome (gemini.google.com). New chat per image. Model "3.8 Flash" is fast (~70 s) and the same image quality as Pro. Prefix "Generate an image, not code." Downloads are JPEG. For transparency ask for a solid #FF00FF background, then run `tools/key-magenta.py`. Find the download button with `find "Download full size image button"` and click by ref. Rename with `mv` right after.

## Known gotchas

- `device_commit_files` needs `force: true` after the first write, or it rejects on mtime.
- The Mac shell cannot delete files. Move them to `_scratch/` instead.
- Gemini garbles kanji in grids. Single kanji and short titles are fine.
- Fall-leaf dates and some coordinates in `places-and-data.md` are marked "approx". Check them in Phase 2.
