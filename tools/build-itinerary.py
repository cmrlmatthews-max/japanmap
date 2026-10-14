#!/usr/bin/env python3
"""Build the Japan map itinerary files and run the plan checks.

Writes data/itinerary-cade.json and data/itinerary-casey.json. They are
identical except for "who". Standard library only. Run from the project root:

    python3 -I tools/build-itinerary.py

If any ERROR is found, nothing is written and the script exits 1.
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
PLACES_PATH = os.path.join(DATA_DIR, "places.json")
RAIL_PATH = os.path.join(DATA_DIR, "rail.geojson")
OUTPUTS = {
    "cade": os.path.join(DATA_DIR, "itinerary-cade.json"),
    "casey": os.path.join(DATA_DIR, "itinerary-casey.json"),
}

VERSION = 1
TITLE = "日本の旅 · Starter plan"
UPDATED = "2026-10-13"
NOTE = "Starter plan drafted from the core places. Times are typical, not timetable checks."
NIGHTS = [
    {"region": "tokyo", "nights": 3},
    {"region": "fuji", "nights": 1},
    {"region": "hakone", "nights": 1},
    {"region": "kyoto", "nights": 3},
    {"region": "osaka", "nights": 1},
]

REGIONS = ("tokyo", "fuji", "hakone", "kyoto", "nara", "osaka")
MODES = ("shinkansen", "local", "walk", "bus", "boat", "ropeway", "funicular")
LINES = (
    "tokaido-shinkansen", "odakyu", "hakone-tozan", "hakone-cable", "hakone-ropeway",
    "fujikyuko", "jr-chuo", "jr-nara", "kintetsu-nara", "kintetsu-kyoto", "jr-kyoto",
)
EXPECTED_DAYS = 10
MINUTES_TOLERANCE = 5

# Plan data, transcribed from itinerary-draft.md (draft dated 2026-10-13).
# DAYS is already in the JSON shape the map app reads.

UNPLACED = [
    {"id": "nara-park", "reason": "Todai-ji and Kasuga Taisha sit inside the park. The Day 9 walk crosses it."},
    {"id": "kyoto-imperial-palace", "reason": "Entry needs a reservation. Add it to Day 7 or Day 8 if you book it."},
    {"id": "kyoto-national-museum", "reason": "No room on Day 8. It is next to Sanjusangendo, near Kiyomizu-dera."},
    {"id": "nakanoshima-museum-of-art", "reason": "One Osaka night is short. Add it to Day 10 if the flight is late."},
    {"id": "church-of-the-light", "reason": "Tours are suspended since 2024."},
]

STATIONS = {
    "tokyo-sta": {"kanji": "東京", "name": "Tokyo", "lat": 35.6812, "lng": 139.7671},
    "shinjuku-sta": {"kanji": "新宿", "name": "Shinjuku", "lat": 35.6896, "lng": 139.7006},
    "odawara-sta": {"kanji": "小田原", "name": "Odawara", "lat": 35.2564, "lng": 139.1551},
    "hakone-yumoto-sta": {"kanji": "箱根湯本", "name": "Hakone-Yumoto", "lat": 35.2326, "lng": 139.1065},
    "chokoku-no-mori-sta": {"kanji": "彫刻の森", "name": "Chokoku-no-Mori", "lat": 35.2445, "lng": 139.0535},
    "gora-sta": {"kanji": "強羅", "name": "Gora", "lat": 35.2499, "lng": 139.0469},
    "sounzan-sta": {"kanji": "早雲山", "name": "Sounzan", "lat": 35.247, "lng": 139.036},
    "owakudani-sta": {"kanji": "大涌谷", "name": "Owakudani", "lat": 35.244, "lng": 139.02},
    "togendai-sta": {"kanji": "桃源台", "name": "Togendai", "lat": 35.24, "lng": 139.005},
    "otsuki-sta": {"kanji": "大月", "name": "Otsuki", "lat": 35.6136, "lng": 138.9406},
    "shimoyoshida-sta": {"kanji": "下吉田", "name": "Shimoyoshida", "lat": 35.498, "lng": 138.803},
    "kawaguchiko-sta": {"kanji": "河口湖", "name": "Kawaguchiko", "lat": 35.4985, "lng": 138.769},
    "kyoto-sta": {"kanji": "京都", "name": "Kyoto", "lat": 34.9858, "lng": 135.7588},
    "tofukuji-sta": {"kanji": "東福寺", "name": "Tofukuji", "lat": 34.9807, "lng": 135.7697},
    "inari-sta": {"kanji": "稲荷", "name": "Inari", "lat": 34.967, "lng": 135.77},
    "ogura-sta": {"kanji": "小倉", "name": "Ogura", "lat": 34.894, "lng": 135.788},
    "yamato-saidaiji-sta": {"kanji": "大和西大寺", "name": "Yamato-Saidaiji", "lat": 34.6938, "lng": 135.783},
    "kintetsu-nara-sta": {"kanji": "近鉄奈良", "name": "Kintetsu-Nara", "lat": 34.684, "lng": 135.828},
    "fuse-sta": {"kanji": "布施", "name": "Fuse", "lat": 34.6647, "lng": 135.5634},
    "shin-osaka-sta": {"kanji": "新大阪", "name": "Shin-Osaka", "lat": 34.7334, "lng": 135.5002},
    "osaka-sta": {"kanji": "大阪", "name": "Osaka", "lat": 34.7025, "lng": 135.4959},
}

DAYS = [
    {
        "day": 1,
        "region": "tokyo",
        "kanji": "到着",
        "title": "Arrive — Azabudai and Roppongi",
        "stay": None,
        "stops": ["tokyo-station", "teamlab-borderless", "mori-art-museum"],
        "legs": [
            {"from": "tokyo-station", "to": "teamlab-borderless", "mode": "local", "minutes": 20},
            {"from": "teamlab-borderless", "to": "mori-art-museum", "mode": "walk", "minutes": 15},
        ],
    },
    {
        "day": 2,
        "region": "tokyo",
        "kanji": "東",
        "title": "East — Asakusa, Ueno, Odaiba, Akihabara",
        "stay": None,
        "stops": ["senso-ji", "tokyo-national-museum", "miraikan", "akihabara-electric-town"],
        "legs": [
            {"from": "mori-art-museum", "to": "senso-ji", "mode": "local", "minutes": 35},
            {"from": "senso-ji", "to": "tokyo-national-museum", "mode": "local", "minutes": 15},
            {"from": "tokyo-national-museum", "to": "miraikan", "mode": "local", "minutes": 45},
            {"from": "miraikan", "to": "akihabara-electric-town", "mode": "local", "minutes": 35},
        ],
    },
    {
        "day": 3,
        "region": "tokyo",
        "kanji": "西",
        "title": "West — Harajuku, Aoyama, Shinjuku",
        "stay": None,
        "stops": ["meiji-jingu", "yoyogi-national-gymnasium", "nezu-museum", "shinjuku-gyoen"],
        "legs": [
            {"from": "akihabara-electric-town", "to": "meiji-jingu", "mode": "local", "minutes": 25},
            {"from": "meiji-jingu", "to": "yoyogi-national-gymnasium", "mode": "walk", "minutes": 10},
            {"from": "yoyogi-national-gymnasium", "to": "nezu-museum", "mode": "walk", "minutes": 25},
            {"from": "nezu-museum", "to": "shinjuku-gyoen", "mode": "local", "minutes": 20},
        ],
    },
    {
        "day": 4,
        "region": "fuji",
        "kanji": "富士",
        "title": "Fuji Five Lakes",
        "stay": None,
        "stops": ["arakurayama-sengen-park", "oshino-hakkai"],
        "legs": [
            {"from": "shinjuku-gyoen", "to": "arakurayama-sengen-park", "mode": "local", "minutes": 135, "parts": [{"mode": "walk", "minutes": 10, "to": "shinjuku-sta"}, {"mode": "local", "line": "jr-chuo", "minutes": 60, "to": "otsuki-sta"}, {"mode": "local", "line": "fujikyuko", "minutes": 50, "to": "shimoyoshida-sta"}, {"mode": "walk", "minutes": 15, "to": "arakurayama-sengen-park"}]},
            {"from": "arakurayama-sengen-park", "to": "oshino-hakkai", "mode": "bus", "minutes": 30},
        ],
    },
    {
        "day": 5,
        "region": "hakone",
        "kanji": "箱根",
        "title": "Lake Ashi and Owakudani",
        "stay": "gora-kadan",
        "stops": ["hakone-shrine", "owakudani", "gora-kadan"],
        "legs": [
            {"from": "oshino-hakkai", "to": "hakone-shrine", "mode": "bus", "minutes": 110, "note": "bus via Gotemba"},
            {"from": "hakone-shrine", "to": "owakudani", "mode": "ropeway", "minutes": 55, "parts": [{"mode": "boat", "minutes": 25, "to": "togendai-sta"}, {"mode": "ropeway", "line": "hakone-ropeway", "minutes": 25, "to": "owakudani-sta"}, {"mode": "walk", "minutes": 5, "to": "owakudani"}]},
            {"from": "owakudani", "to": "gora-kadan", "mode": "ropeway", "minutes": 30, "parts": [{"mode": "ropeway", "line": "hakone-ropeway", "minutes": 10, "to": "sounzan-sta"}, {"mode": "funicular", "line": "hakone-cable", "minutes": 10, "to": "gora-sta"}, {"mode": "walk", "minutes": 10, "to": "gora-kadan"}]},
        ],
    },
    {
        "day": 6,
        "region": "kyoto",
        "kanji": "箱根から京都",
        "title": "Hakone to Kyoto",
        "stay": "tawaraya",
        "stops": ["hakone-open-air-museum", "hakone-yumoto-onsen", "kyoto-station", "tawaraya"],
        "legs": [
            {"from": "gora-kadan", "to": "hakone-open-air-museum", "mode": "local", "minutes": 10, "parts": [{"mode": "walk", "minutes": 4, "to": "gora-sta"}, {"mode": "local", "line": "hakone-tozan", "minutes": 3, "to": "chokoku-no-mori-sta"}, {"mode": "walk", "minutes": 3, "to": "hakone-open-air-museum"}]},
            {"from": "hakone-open-air-museum", "to": "hakone-yumoto-onsen", "mode": "local", "minutes": 40, "parts": [{"mode": "walk", "minutes": 3, "to": "chokoku-no-mori-sta"}, {"mode": "local", "line": "hakone-tozan", "minutes": 32, "to": "hakone-yumoto-sta"}, {"mode": "walk", "minutes": 5, "to": "hakone-yumoto-onsen"}]},
            {"from": "hakone-yumoto-onsen", "to": "kyoto-station", "mode": "shinkansen", "minutes": 145, "parts": [{"mode": "walk", "minutes": 5, "to": "hakone-yumoto-sta"}, {"mode": "local", "line": "hakone-tozan", "minutes": 15, "to": "odawara-sta"}, {"mode": "shinkansen", "line": "tokaido-shinkansen", "minutes": 120, "to": "kyoto-sta"}, {"mode": "walk", "minutes": 5, "to": "kyoto-station"}]},
            {"from": "kyoto-station", "to": "tawaraya", "mode": "local", "minutes": 15},
        ],
    },
    {
        "day": 7,
        "region": "kyoto",
        "kanji": "嵐山",
        "title": "Arashiyama and the north",
        "stay": "tawaraya",
        "stops": ["arashiyama-bamboo-grove", "tenryu-ji", "ryoan-ji", "kinkaku-ji"],
        "legs": [
            {"from": "tawaraya", "to": "arashiyama-bamboo-grove", "mode": "local", "minutes": 40},
            {"from": "arashiyama-bamboo-grove", "to": "tenryu-ji", "mode": "walk", "minutes": 5},
            {"from": "tenryu-ji", "to": "ryoan-ji", "mode": "local", "minutes": 20},
            {"from": "ryoan-ji", "to": "kinkaku-ji", "mode": "walk", "minutes": 20},
        ],
    },
    {
        "day": 8,
        "region": "kyoto",
        "kanji": "東山",
        "title": "Higashiyama",
        "stay": "tawaraya",
        "stops": ["tofuku-ji", "kiyomizu-dera", "nanzen-ji", "ginkaku-ji"],
        "legs": [
            {"from": "kinkaku-ji", "to": "tofuku-ji", "mode": "local", "minutes": 50, "parts": [{"mode": "local", "minutes": 35, "to": "kyoto-sta"}, {"mode": "local", "line": "jr-nara", "minutes": 3, "to": "tofukuji-sta"}, {"mode": "walk", "minutes": 10, "to": "tofuku-ji"}]},
            {"from": "tofuku-ji", "to": "kiyomizu-dera", "mode": "bus", "minutes": 25},
            {"from": "kiyomizu-dera", "to": "nanzen-ji", "mode": "bus", "minutes": 20},
            {"from": "nanzen-ji", "to": "ginkaku-ji", "mode": "walk", "minutes": 30, "note": "Philosopher's Path"},
        ],
    },
    {
        "day": 9,
        "region": "nara",
        "kanji": "伏見・宇治・奈良",
        "title": "Fushimi, Uji, Nara → Osaka",
        "stay": None,
        "stops": ["fushimi-inari-taisha", "nintendo-museum", "todai-ji", "kasuga-taisha", "kofuku-ji", "umeda-sky-building"],
        "legs": [
            {"from": "ginkaku-ji", "to": "fushimi-inari-taisha", "mode": "local", "minutes": 35, "parts": [{"mode": "local", "minutes": 25, "to": "kyoto-sta"}, {"mode": "local", "line": "jr-nara", "minutes": 5, "to": "inari-sta"}, {"mode": "walk", "minutes": 3, "to": "fushimi-inari-taisha"}]},
            {"from": "fushimi-inari-taisha", "to": "nintendo-museum", "mode": "local", "minutes": 30},
            {"from": "nintendo-museum", "to": "todai-ji", "mode": "local", "minutes": 55, "parts": [{"mode": "walk", "minutes": 10, "to": "ogura-sta"}, {"mode": "local", "line": "kintetsu-kyoto", "minutes": 25, "to": "yamato-saidaiji-sta"}, {"mode": "local", "line": "kintetsu-nara", "minutes": 5, "to": "kintetsu-nara-sta"}, {"mode": "walk", "minutes": 15, "to": "todai-ji"}]},
            {"from": "todai-ji", "to": "kasuga-taisha", "mode": "walk", "minutes": 15},
            {"from": "kasuga-taisha", "to": "kofuku-ji", "mode": "walk", "minutes": 20},
            {"from": "kofuku-ji", "to": "umeda-sky-building", "mode": "local", "minutes": 60, "parts": [{"mode": "walk", "minutes": 5, "to": "kintetsu-nara-sta"}, {"mode": "local", "line": "kintetsu-nara", "minutes": 30, "to": "fuse-sta"}, {"mode": "local", "minutes": 25, "to": "umeda-sky-building"}]},
        ],
    },
    {
        "day": 10,
        "region": "osaka",
        "kanji": "大阪",
        "title": "Osaka, then fly home",
        "stay": None,
        "stops": ["osaka-castle", "shitennoji", "sumiyoshi-taisha"],
        "legs": [
            {"from": "umeda-sky-building", "to": "osaka-castle", "mode": "local", "minutes": 20},
            {"from": "osaka-castle", "to": "shitennoji", "mode": "local", "minutes": 20},
            {"from": "shitennoji", "to": "sumiyoshi-taisha", "mode": "local", "minutes": 25},
        ],
    },
]


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, msg):
        self.errors.append(msg)
        print(f"ERROR: {msg}")

    def warn(self, msg):
        self.warnings.append(msg)
        print(f"WARNING: {msg}")


def load_places():
    with open(PLACES_PATH, encoding="utf-8") as f:
        return json.load(f)


def check_ids(rep, days, unplaced, place_ids, station_ids):
    """Check 1: every stop, leg end, stay, unplaced id and part target is known."""
    valid_to = station_ids | place_ids
    for day in days:
        label = f"Day {day['day']}"
        for stop in day["stops"]:
            if stop not in place_ids:
                rep.error(f"{label}: stop '{stop}' is not a place id")
        if day["stay"] is not None and day["stay"] not in place_ids:
            rep.error(f"{label}: stay '{day['stay']}' is not a place id")
        for i, leg in enumerate(day["legs"]):
            for end in ("from", "to"):
                if leg[end] not in place_ids:
                    rep.error(f"{label} leg {i}: {end} '{leg[end]}' is not a place id")
            for part in leg.get("parts", []):
                if part["to"] not in valid_to:
                    rep.error(f"{label} leg {i}: part to '{part['to']}' is neither a station nor a place id")
    for item in unplaced:
        if item["id"] not in place_ids:
            rep.error(f"unplaced id '{item['id']}' is not a place id")


def check_codes(rep, days):
    """Checks 2 and 3: known rail lines and travel modes."""
    for day in days:
        label = f"Day {day['day']}"
        for i, leg in enumerate(day["legs"]):
            if leg["mode"] not in MODES:
                rep.error(f"{label} leg {i}: mode '{leg['mode']}' is not allowed")
            for part in leg.get("parts", []):
                if part["mode"] not in MODES:
                    rep.error(f"{label} leg {i}: part mode '{part['mode']}' is not allowed")
                if "line" in part and part["line"] not in LINES:
                    rep.error(f"{label} leg {i}: line '{part['line']}' is not allowed")


def check_chain(rep, days):
    """Check 4: each leg starts where the previous stop ends."""
    prev_last = None
    for day in days:
        label = f"Day {day['day']}"
        stops, legs = day["stops"], day["legs"]
        if day["day"] == 1:
            expected = [(stops[i], stops[i + 1]) for i in range(len(stops) - 1)]
        else:
            expected = [(prev_last, stops[0])] + [
                (stops[i - 1], stops[i]) for i in range(1, len(stops))
            ]
        if len(legs) != len(expected):
            rep.error(f"{label}: has {len(legs)} legs, expected {len(expected)}")
        for i, (leg, (frm, to)) in enumerate(zip(legs, expected)):
            if leg["from"] != frm or leg["to"] != to:
                rep.error(f"{label} leg {i}: {leg['from']} -> {leg['to']}, expected {frm} -> {to}")
        prev_last = stops[-1]


def check_part_ends(rep, days):
    """Check 5: the last part of a leg ends at the leg's own 'to'."""
    for day in days:
        for i, leg in enumerate(day["legs"]):
            parts = leg.get("parts")
            if parts and parts[-1]["to"] != leg["to"]:
                rep.error(f"Day {day['day']} leg {i}: last part ends at '{parts[-1]['to']}', leg ends at '{leg['to']}'")


def check_minutes(rep, days):
    """Check 6: part minutes should add up to the leg minutes."""
    for day in days:
        for i, leg in enumerate(day["legs"]):
            parts = leg.get("parts")
            if not parts:
                continue
            total = sum(p["minutes"] for p in parts)
            if abs(total - leg["minutes"]) > MINUTES_TOLERANCE:
                rep.warn(f"Day {day['day']} leg {i} ({leg['from']} -> {leg['to']}): parts sum to {total} min, leg says {leg['minutes']}")


def check_regions(rep, days):
    """Check 7: every day has a known region."""
    for day in days:
        if day["region"] not in REGIONS:
            rep.error(f"Day {day['day']}: region '{day['region']}' is not allowed")


def summarise(rep, days, unplaced, places):
    """Check 8: day count, stop counts, and core places missing from the plan."""
    if len(days) != EXPECTED_DAYS:
        rep.error(f"plan has {len(days)} days, expected {EXPECTED_DAYS}")
    if [d["day"] for d in days] != list(range(1, len(days) + 1)):
        rep.error("day numbers are not 1..N in order")
    print(f"Days: {len(days)}")
    total = sum(len(d["stops"]) for d in days)
    print(f"Total stops: {total}")
    print("Stops per day:")
    for d in days:
        print(f"  Day {d['day']:>2} {d['region']:<7} {len(d['stops']):>2}: {', '.join(d['stops'])}")

    core_ids = [p["id"] for p in places if p.get("status") == "core"]
    used = {stop for d in days for stop in d["stops"]}
    missing = [pid for pid in core_ids if pid not in used]
    print(f"Core places in no day's stops ({len(missing)}): {', '.join(missing)}")

    listed = [u["id"] for u in unplaced]
    only_missing = sorted(set(missing) - set(listed))
    only_listed = sorted(set(listed) - set(missing))
    if only_missing:
        rep.warn(f"core places missing from the plan but not in 'unplaced': {', '.join(only_missing)}")
    if only_listed:
        rep.warn(f"'unplaced' lists places that are in the plan or not core: {', '.join(only_listed)}")
    if not only_missing and not only_listed:
        print("Matches the 'unplaced' list.")


def check_rail(rep, days):
    """Check 9: every station used in parts exists in rail.geojson."""
    if not os.path.exists(RAIL_PATH):
        print("rail.geojson not found, station check skipped")
        return
    with open(RAIL_PATH, encoding="utf-8") as f:
        geo = json.load(f)
    station_feats = set()
    for feat in geo.get("features", []):
        props = feat.get("properties") or {}
        if props.get("kind") == "station":
            station_feats.add(props.get("id", feat.get("id")))
    used = sorted({
        part["to"]
        for day in days
        for leg in day["legs"]
        for part in leg.get("parts", [])
        if part["to"] in STATIONS
    })
    missing = [s for s in used if s not in station_feats]
    for s in missing:
        rep.error(f"station '{s}' is used in parts but is not a station feature in rail.geojson")
    print(f"rail.geojson: {len(used)} station ids checked, {len(missing)} missing")


def build_doc(who):
    return {
        "version": VERSION,
        "who": who,
        "title": TITLE,
        "updated": UPDATED,
        "note": NOTE,
        "nights": NIGHTS,
        "unplaced": UNPLACED,
        "days": DAYS,
    }


def main():
    places = load_places()
    place_ids = {p["id"] for p in places}
    station_ids = set(STATIONS)
    rep = Report()

    print("== Checks ==")
    check_ids(rep, DAYS, UNPLACED, place_ids, station_ids)
    check_codes(rep, DAYS)
    check_chain(rep, DAYS)
    check_part_ends(rep, DAYS)
    check_minutes(rep, DAYS)
    check_regions(rep, DAYS)
    summarise(rep, DAYS, UNPLACED, places)
    check_rail(rep, DAYS)

    print(f"== Result: {len(rep.errors)} error(s), {len(rep.warnings)} warning(s) ==")
    if rep.errors:
        print("Nothing written.")
        return 1

    for who, path in OUTPUTS.items():
        text = json.dumps(build_doc(who), indent=2, ensure_ascii=False) + "\n"
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        with open(path, encoding="utf-8") as f:
            json.load(f)
        print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
