# Itinerary draft — Phase 3 starter plan

Draft: 2026-10-13. Opus wrote this plan. Haiku converts it to `data/itinerary-cade.json` and `data/itinerary-casey.json`.

## Basis

- Nights: Tokyo 3 · Kawaguchiko 1 · Hakone 1 · Kyoto 3 · Osaka 1. That is 9 nights over 10 days (option A).
- Order: Tokyo → Fuji → Hakone → Odawara → Shinkansen → Kyoto → Nara → Osaka. The flight home leaves from KIX.
- Stops: core places only. No "Add to trip" picks were saved in Chrome on the Mac.
- Casey's file starts as a copy of this plan.
- Dates are not set. Times are typical, not timetable checks. Check them before booking.

## Core places not in the plan yet

| Place id | Reason |
|---|---|
| nara-park | Todai-ji and Kasuga Taisha sit inside the park. The Day 9 walk crosses it. |
| kyoto-imperial-palace | Entry needs a reservation. Add it to Day 7 or Day 8 if you book it. |
| kyoto-national-museum | No room on Day 8. It is next to Sanjusangendo, near Kiyomizu-dera. |
| nakanoshima-museum-of-art | One Osaka night is short. Add it to Day 10 if the flight is late. |
| church-of-the-light | Tours are suspended since 2024. |

## Leg format

Each leg links two place ids: `from` and `to`. The first leg of a day starts at the last stop of the day before.

- `mode`: the main way to travel. One of `shinkansen`, `local`, `walk`, `bus`, `boat`, `ropeway`, `funicular`. `local` also covers subways and private lines.
- `minutes`: total time for the leg.
- `parts` (optional): the steps of the leg, in order. Each part has `mode`, `minutes`, and `to` (a station id from `rail.geojson`, or a place id). A part with `line` follows that line in `rail.geojson`. A part without `line` draws as a short brush curve.
- When a leg has no `parts`, it draws as one brush curve in its `mode` style.

## Stations (for `rail.geojson`)

Coordinates are approximate. The rail script snaps each one to its line.

| id | Kanji | English | Lat | Lng | Lines |
|---|---|---|---|---|---|
| tokyo-sta | 東京 | Tokyo | 35.6812 | 139.7671 | tokaido-shinkansen |
| shinjuku-sta | 新宿 | Shinjuku | 35.6896 | 139.7006 | odakyu, jr-chuo |
| odawara-sta | 小田原 | Odawara | 35.2564 | 139.1551 | tokaido-shinkansen, odakyu, hakone-tozan |
| hakone-yumoto-sta | 箱根湯本 | Hakone-Yumoto | 35.2326 | 139.1065 | hakone-tozan |
| chokoku-no-mori-sta | 彫刻の森 | Chokoku-no-Mori | 35.2445 | 139.0535 | hakone-tozan |
| gora-sta | 強羅 | Gora | 35.2499 | 139.0469 | hakone-tozan, hakone-cable |
| sounzan-sta | 早雲山 | Sounzan | 35.2470 | 139.0360 | hakone-cable, hakone-ropeway (use the cable car end far from Gora) |
| owakudani-sta | 大涌谷 | Owakudani | 35.2440 | 139.0200 | hakone-ropeway |
| togendai-sta | 桃源台 | Togendai | 35.2400 | 139.0050 | hakone-ropeway (use the ropeway end near Lake Ashi) |
| otsuki-sta | 大月 | Otsuki | 35.6136 | 138.9406 | jr-chuo, fujikyuko |
| shimoyoshida-sta | 下吉田 | Shimoyoshida | 35.4980 | 138.8030 | fujikyuko |
| kawaguchiko-sta | 河口湖 | Kawaguchiko | 35.4985 | 138.7690 | fujikyuko |
| kyoto-sta | 京都 | Kyoto | 34.9858 | 135.7588 | tokaido-shinkansen, jr-nara, jr-kyoto, kintetsu-kyoto |
| tofukuji-sta | 東福寺 | Tofukuji | 34.9807 | 135.7697 | jr-nara |
| inari-sta | 稲荷 | Inari | 34.9670 | 135.7700 | jr-nara |
| ogura-sta | 小倉 | Ogura | 34.8940 | 135.7880 | kintetsu-kyoto |
| yamato-saidaiji-sta | 大和西大寺 | Yamato-Saidaiji | 34.6938 | 135.7830 | kintetsu-kyoto, kintetsu-nara |
| kintetsu-nara-sta | 近鉄奈良 | Kintetsu-Nara | 34.6840 | 135.8280 | kintetsu-nara |
| fuse-sta | 布施 | Fuse | 34.6647 | 135.5634 | kintetsu-nara |
| shin-osaka-sta | 新大阪 | Shin-Osaka | 34.7334 | 135.5002 | tokaido-shinkansen, jr-kyoto |
| osaka-sta | 大阪 | Osaka | 34.7025 | 135.4959 | jr-kyoto |

## Days

Region values: tokyo, fuji, hakone, kyoto, nara, osaka. `stay` is a place id or null.

### Day 1 · tokyo · 到着 Arrive — Azabudai and Roppongi · stay: null

Stops: tokyo-station, teamlab-borderless, mori-art-museum

| from | to | mode | min | parts |
|---|---|---|---|---|
| tokyo-station | teamlab-borderless | local | 20 | — |
| teamlab-borderless | mori-art-museum | walk | 15 | — |

### Day 2 · tokyo · 東 East — Asakusa, Ueno, Odaiba, Akihabara · stay: null

Stops: senso-ji, tokyo-national-museum, miraikan, akihabara-electric-town

| from | to | mode | min | parts |
|---|---|---|---|---|
| mori-art-museum | senso-ji | local | 35 | — |
| senso-ji | tokyo-national-museum | local | 15 | — |
| tokyo-national-museum | miraikan | local | 45 | — |
| miraikan | akihabara-electric-town | local | 35 | — |

### Day 3 · tokyo · 西 West — Harajuku, Aoyama, Shinjuku · stay: null

Stops: meiji-jingu, yoyogi-national-gymnasium, nezu-museum, shinjuku-gyoen

| from | to | mode | min | parts |
|---|---|---|---|---|
| akihabara-electric-town | meiji-jingu | local | 25 | — |
| meiji-jingu | yoyogi-national-gymnasium | walk | 10 | — |
| yoyogi-national-gymnasium | nezu-museum | walk | 25 | — |
| nezu-museum | shinjuku-gyoen | local | 20 | — |

### Day 4 · fuji · 富士 Fuji Five Lakes · stay: null

Stops: arakurayama-sengen-park, oshino-hakkai

| from | to | mode | min | parts |
|---|---|---|---|---|
| shinjuku-gyoen | arakurayama-sengen-park | local | 135 | walk 10 → shinjuku-sta; local jr-chuo 60 → otsuki-sta; local fujikyuko 50 → shimoyoshida-sta; walk 15 → arakurayama-sengen-park |
| arakurayama-sengen-park | oshino-hakkai | bus | 30 | — |

### Day 5 · hakone · 箱根 Lake Ashi and Owakudani · stay: gora-kadan

Stops: hakone-shrine, owakudani, gora-kadan

| from | to | mode | min | parts |
|---|---|---|---|---|
| oshino-hakkai | hakone-shrine | bus | 110 | — (bus via Gotemba) |
| hakone-shrine | owakudani | ropeway | 55 | boat 25 → togendai-sta; ropeway hakone-ropeway 25 → owakudani-sta; walk 5 → owakudani |
| owakudani | gora-kadan | ropeway | 30 | ropeway hakone-ropeway 10 → sounzan-sta; funicular hakone-cable 10 → gora-sta; walk 10 → gora-kadan |

### Day 6 · kyoto · 箱根から京都 Hakone to Kyoto · stay: tawaraya

Stops: hakone-open-air-museum, hakone-yumoto-onsen, kyoto-station, tawaraya

| from | to | mode | min | parts |
|---|---|---|---|---|
| gora-kadan | hakone-open-air-museum | local | 10 | walk 4 → gora-sta; local hakone-tozan 3 → chokoku-no-mori-sta; walk 3 → hakone-open-air-museum |
| hakone-open-air-museum | hakone-yumoto-onsen | local | 40 | walk 3 → chokoku-no-mori-sta; local hakone-tozan 32 → hakone-yumoto-sta; walk 5 → hakone-yumoto-onsen |
| hakone-yumoto-onsen | kyoto-station | shinkansen | 145 | walk 5 → hakone-yumoto-sta; local hakone-tozan 15 → odawara-sta; shinkansen tokaido-shinkansen 120 → kyoto-sta; walk 5 → kyoto-station |
| kyoto-station | tawaraya | local | 15 | — |

### Day 7 · kyoto · 嵐山 Arashiyama and the north · stay: tawaraya

Stops: arashiyama-bamboo-grove, tenryu-ji, ryoan-ji, kinkaku-ji

| from | to | mode | min | parts |
|---|---|---|---|---|
| tawaraya | arashiyama-bamboo-grove | local | 40 | — |
| arashiyama-bamboo-grove | tenryu-ji | walk | 5 | — |
| tenryu-ji | ryoan-ji | local | 20 | — |
| ryoan-ji | kinkaku-ji | walk | 20 | — |

### Day 8 · kyoto · 東山 Higashiyama · stay: tawaraya

Stops: tofuku-ji, kiyomizu-dera, nanzen-ji, ginkaku-ji

| from | to | mode | min | parts |
|---|---|---|---|---|
| kinkaku-ji | tofuku-ji | local | 50 | local 35 → kyoto-sta; local jr-nara 3 → tofukuji-sta; walk 10 → tofuku-ji |
| tofuku-ji | kiyomizu-dera | bus | 25 | — |
| kiyomizu-dera | nanzen-ji | bus | 20 | — |
| nanzen-ji | ginkaku-ji | walk | 30 | — (Philosopher's Path) |

### Day 9 · nara · 伏見・宇治・奈良 Fushimi, Uji, Nara → Osaka · stay: null

Stops: fushimi-inari-taisha, nintendo-museum, todai-ji, kasuga-taisha, kofuku-ji, umeda-sky-building

| from | to | mode | min | parts |
|---|---|---|---|---|
| ginkaku-ji | fushimi-inari-taisha | local | 35 | local 25 → kyoto-sta; local jr-nara 5 → inari-sta; walk 3 → fushimi-inari-taisha |
| fushimi-inari-taisha | nintendo-museum | local | 30 | — |
| nintendo-museum | todai-ji | local | 55 | walk 10 → ogura-sta; local kintetsu-kyoto 25 → yamato-saidaiji-sta; local kintetsu-nara 5 → kintetsu-nara-sta; walk 15 → todai-ji |
| todai-ji | kasuga-taisha | walk | 15 | — |
| kasuga-taisha | kofuku-ji | walk | 20 | — |
| kofuku-ji | umeda-sky-building | local | 60 | walk 5 → kintetsu-nara-sta; local kintetsu-nara 30 → fuse-sta; local 25 → umeda-sky-building |

### Day 10 · osaka · 大阪 Osaka, then fly home · stay: null

Stops: osaka-castle, shitennoji, sumiyoshi-taisha

| from | to | mode | min | parts |
|---|---|---|---|---|
| umeda-sky-building | osaka-castle | local | 20 | — |
| osaka-castle | shitennoji | local | 20 | — |
| shitennoji | sumiyoshi-taisha | local | 25 | — |
