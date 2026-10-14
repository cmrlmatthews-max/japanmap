#!/usr/bin/env python3
"""Convert raw OpenStreetMap rail ways into one clean centre path per line.

Usage (from the project root):   python3 -I tools/build-rail.py

Reads   _scratch/rail-raw.json and _scratch/rail-raw-2.json (extra Hakone Tozan
        ways plus OSM station nodes; ways are deduped by way id)
Writes  data/rail.geojson
        _scratch/rail-report.md   (also printed to stdout)

Standard library only.
"""

import heapq
import json
import math
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_PATH = os.path.join(ROOT, "_scratch", "rail-raw.json")
RAW2_PATH = os.path.join(ROOT, "_scratch", "rail-raw-2.json")
OUT_PATH = os.path.join(ROOT, "data", "rail.geojson")
REPORT_PATH = os.path.join(ROOT, "_scratch", "rail-report.md")

ATTRIBUTION = ("© OpenStreetMap contributors (ODbL). "
               "Exported with the Overpass API on 2026-10-13.")
EARTH_R = 6371008.8
JOIN_MAX_M = 600.0        # largest gap bridged by a virtual edge
SNAP_WARN_M = 400.0       # snap distance that is reported as a warning
SIZE_LIMIT = 300 * 1024   # hard limit for the output file
SIZE_AIM = 120 * 1024     # soft target
MAX_TOL_STEPS = 6         # tolerance is raised by 1.5x per step if too big

# Lines in output order. tol = Douglas-Peucker tolerance in metres.
# km = expected path length range from the brief.
LINES = [
    dict(id="tokaido-shinkansen", name="Tokaido Shinkansen", kanji="東海道新幹線",
         type="shinkansen", start="tokyo-sta", end="shin-osaka-sta", tol=40, km=(500, 560)),
    dict(id="odakyu", name="Odakyu Odawara Line", kanji="小田急小田原線",
         type="local", start="shinjuku-sta", end="odawara-sta", tol=25, km=(75, 90)),
    dict(id="hakone-tozan", name="Hakone Tozan Railway", kanji="箱根登山鉄道",
         type="local", start="odawara-sta", end="gora-sta", tol=15, km=(13, 17)),
    # endpoint_only: both ends snap to the graph's terminal nodes, so the whole
    # cable car is drawn instead of stopping at an interior node.
    dict(id="hakone-cable", name="Hakone Tozan Cable Car", kanji="箱根登山ケーブルカー",
         type="funicular", start="gora-sta", end="sounzan-sta", tol=15, km=(1, 1.5),
         endpoint_only=True),
    dict(id="hakone-ropeway", name="Hakone Ropeway", kanji="箱根ロープウェイ",
         type="ropeway", start="sounzan-sta", end="togendai-sta", tol=15, km=(3.5, 4.5)),
    dict(id="jr-chuo", name="JR Chuo Line", kanji="JR中央本線",
         type="local", start="shinjuku-sta", end="otsuki-sta", tol=25, km=(70, 95)),
    dict(id="fujikyuko", name="Fujikyuko Line", kanji="富士急行線",
         type="local", start="otsuki-sta", end="kawaguchiko-sta", tol=25, km=(22, 28)),
    dict(id="jr-nara", name="JR Nara Line", kanji="JR奈良線",
         type="local", start="kyoto-sta", end="jr-nara-end", tol=25, km=(30, 40)),
    dict(id="kintetsu-kyoto", name="Kintetsu Kyoto Line", kanji="近鉄京都線",
         type="local", start="kyoto-sta", end="yamato-saidaiji-sta", tol=25, km=(30, 40)),
    dict(id="kintetsu-nara", name="Kintetsu Nara Line", kanji="近鉄奈良線",
         type="local", start="fuse-sta", end="kintetsu-nara-sta", tol=25, km=(25, 32)),
    dict(id="jr-kyoto", name="JR Kyoto Line", kanji="JR京都線",
         type="local", start="kyoto-sta", end="osaka-sta", tol=25, km=(38, 50)),
]

# id, kanji, English name, lat, lng, lines (first listed line is the snap line)
STATIONS = [
    ("tokyo-sta", "東京", "Tokyo", 35.6812, 139.7671, ["tokaido-shinkansen"]),
    ("shinjuku-sta", "新宿", "Shinjuku", 35.6896, 139.7006, ["odakyu", "jr-chuo"]),
    ("odawara-sta", "小田原", "Odawara", 35.2564, 139.1551, ["tokaido-shinkansen", "odakyu", "hakone-tozan"]),
    ("hakone-yumoto-sta", "箱根湯本", "Hakone-Yumoto", 35.2326, 139.1065, ["hakone-tozan"]),
    ("chokoku-no-mori-sta", "彫刻の森", "Chokoku-no-Mori", 35.2445, 139.0535, ["hakone-tozan"]),
    ("gora-sta", "強羅", "Gora", 35.2499, 139.0469, ["hakone-tozan", "hakone-cable"]),
    ("sounzan-sta", "早雲山", "Sounzan", 35.2470, 139.0360, ["hakone-cable", "hakone-ropeway"]),
    ("owakudani-sta", "大涌谷", "Owakudani", 35.2440, 139.0200, ["hakone-ropeway"]),
    ("togendai-sta", "桃源台", "Togendai", 35.2400, 139.0050, ["hakone-ropeway"]),
    ("otsuki-sta", "大月", "Otsuki", 35.6136, 138.9406, ["jr-chuo", "fujikyuko"]),
    ("shimoyoshida-sta", "下吉田", "Shimoyoshida", 35.4980, 138.8030, ["fujikyuko"]),
    ("kawaguchiko-sta", "河口湖", "Kawaguchiko", 35.4985, 138.7690, ["fujikyuko"]),
    ("kyoto-sta", "京都", "Kyoto", 34.9858, 135.7588, ["tokaido-shinkansen", "jr-nara", "jr-kyoto", "kintetsu-kyoto"]),
    ("tofukuji-sta", "東福寺", "Tofukuji", 34.9807, 135.7697, ["jr-nara"]),
    ("inari-sta", "稲荷", "Inari", 34.9670, 135.7700, ["jr-nara"]),
    ("ogura-sta", "小倉", "Ogura", 34.8940, 135.7880, ["kintetsu-kyoto"]),
    ("yamato-saidaiji-sta", "大和西大寺", "Yamato-Saidaiji", 34.6938, 135.7830, ["kintetsu-kyoto", "kintetsu-nara"]),
    ("kintetsu-nara-sta", "近鉄奈良", "Kintetsu-Nara", 34.6840, 135.8280, ["kintetsu-nara"]),
    ("fuse-sta", "布施", "Fuse", 34.6647, 135.5634, ["kintetsu-nara"]),
    ("shin-osaka-sta", "新大阪", "Shin-Osaka", 34.7334, 135.5002, ["tokaido-shinkansen", "jr-kyoto"]),
    ("osaka-sta", "大阪", "Osaka", 34.7025, 135.4959, ["jr-kyoto"]),
]

# Endpoints that are not stations. (lat, lng) as given in the brief.
EXTRA_POINTS = {
    "jr-nara-end": (34.6807, 135.8197),
}

# Station positions come from OSM station nodes with the same kanji name, within
# OSM_MATCH_M of the approximate coordinate. Operator keywords per line family
# are preferred; if none match, the nearest node of any operator is used.
OSM_MATCH_M = 2000.0
OPERATOR_KEYS = {
    "jr": ("JR", "東日本", "東海旅客", "西日本"),
    "kintetsu": ("近畿日本",),
    "fuji": ("富士急", "富士山麓"),
    "hakone": ("小田急", "箱根"),
}
LINE_FAMILY = {
    "tokaido-shinkansen": "jr", "jr-chuo": "jr", "jr-nara": "jr", "jr-kyoto": "jr",
    "kintetsu-kyoto": "kintetsu", "kintetsu-nara": "kintetsu",
    "fujikyuko": "fuji", "odakyu": "hakone", "hakone-tozan": "hakone",
    "hakone-cable": "hakone", "hakone-ropeway": "hakone",
}
# Set by apply_special_rules (endpoints of the cable and ropeway graphs), so the
# OSM station lookup must not override them.
RULE_STATIONS = {"sounzan-sta", "togendai-sta"}


# ---------------------------------------------------------------- geometry

def node_key(p):
    return (round(p[0], 5), round(p[1], 5))


def haversine(a, b):
    """Great-circle distance in metres between two (lng, lat) points."""
    lng1, lat1 = math.radians(a[0]), math.radians(a[1])
    lng2, lat2 = math.radians(b[0]), math.radians(b[1])
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(h)))


def path_km(pts):
    return sum(haversine(a, b) for a, b in zip(pts, pts[1:])) / 1000.0


def simplify(points, tol):
    """Douglas-Peucker in local metres (equirectangular, mean latitude)."""
    if len(points) <= 2:
        return list(points)
    lat0 = sum(p[1] for p in points) / len(points)
    kx = EARTH_R * math.pi / 180 * math.cos(math.radians(lat0))
    ky = EARTH_R * math.pi / 180
    xy = [(p[0] * kx, p[1] * ky) for p in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        ax, ay = xy[i]
        bx, by = xy[j]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        dmax, kmax = -1.0, i
        for k in range(i + 1, j):
            px, py = xy[k]
            if seg2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > dmax:
                dmax, kmax = d, k
        if dmax > tol:
            keep[kmax] = True
            stack.append((i, kmax))
            stack.append((kmax, j))
    return [p for p, k in zip(points, keep) if k]


# ------------------------------------------------------------------ graph

def build_graph(ways):
    adj = defaultdict(dict)
    for way in ways:
        pts = [node_key(p) for p in way["c"]]
        for a, b in zip(pts, pts[1:]):
            if a != b and b not in adj[a]:
                d = haversine(a, b)
                adj[a][b] = d
                adj[b][a] = d
    return dict(adj)


def nearest(adj, pt, ends_only=False):
    cands = list(adj)
    if ends_only:
        cands = degree_one(adj) or cands
    best = None
    for n in cands:
        d = haversine(pt, n)
        if best is None or d < best[1]:
            best = (n, d)
    return best


def degree_one(adj):
    return [n for n, nb in adj.items() if len(nb) == 1]


def dijkstra(adj, s, t):
    dist = {s: 0.0}
    prev = {}
    done = set()
    heap = [(0.0, s)]
    while heap:
        d, u = heapq.heappop(heap)
        if u in done:
            continue
        done.add(u)
        if u == t:
            break
        for v, w in adj.get(u, {}).items():
            nd = d + w
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(heap, (nd, v))
    if t not in done:
        return None
    path = [t]
    while path[-1] != s:
        path.append(prev[path[-1]])
    return path[::-1]


def components(adj):
    comp = {}
    cid = 0
    for n in adj:
        if n in comp:
            continue
        comp[n] = cid
        stack = [n]
        while stack:
            u = stack.pop()
            for v in adj[u]:
                if v not in comp:
                    comp[v] = cid
                    stack.append(v)
        cid += 1
    return comp


CELL_DEG = 0.01  # about 1.1 km in latitude, about 0.9 km in longitude at 35 N


def closest_other(group_nodes, comp, cid, limit):
    """Closest node outside component cid to any node in group_nodes, searched
    through a grid. Only pairs within `limit` metres can be found, which is all
    the caller needs; returns (dist, a, b) or None."""
    grid = defaultdict(list)
    for n in comp:
        if comp[n] != cid:
            grid[(math.floor(n[0] / CELL_DEG), math.floor(n[1] / CELL_DEG))].append(n)
    best = None
    for a in group_nodes:
        gx, gy = math.floor(a[0] / CELL_DEG), math.floor(a[1] / CELL_DEG)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for b in grid.get((gx + dx, gy + dy), ()):
                    d = haversine(a, b)
                    if d <= limit and (best is None or d < best[0]):
                        best = (d, a, b)
    return best


class Blocked(Exception):
    """A line whose raw ways cannot be joined into a path under the rules."""


def route(line_id, adj, s, t):
    """Shortest path s->t. If the line is disconnected, bridge the closest
    gap (under JOIN_MAX_M) touching the start or end component, and repeat.
    Raises Blocked when no such gap exists; no long straight bridge is drawn."""
    joins = []
    while True:
        path = dijkstra(adj, s, t)
        if path is not None:
            return path, joins
        comp = components(adj)
        best = None
        for cid in {comp[s], comp[t]}:
            group = [n for n in comp if comp[n] == cid]
            cand = closest_other(group, comp, cid, JOIN_MAX_M)
            if cand and (best is None or cand[0] < best[0]):
                best = cand
        if best is None:
            # Report how far apart the start and end pieces really are.
            far = min(((haversine(a, b), a, b) for a in
                       [n for n in comp if comp[n] == comp[s]]
                       for b in [n for n in comp if comp[n] == comp[t]]),
                      default=None)
            detail = (f"start piece and end piece are {far[0]:.0f} m apart at the closest"
                      if far else "start and end are not connected")
            raise Blocked(f"{detail}; no gap under {JOIN_MAX_M:.0f} m joins them")
        d, a, b = best
        adj[a][b] = d
        adj[b][a] = d
        joins.append((a, b, d))


# ------------------------------------------------------------- build steps

def apply_special_rules(ways_by_line, coords, notes):
    """Sounzan and Togendai are placed on graph endpoints, as the brief asks."""
    cable = build_graph(ways_by_line["hakone-cable"])
    gora = coords["gora-sta"]
    sounzan = max(degree_one(cable), key=lambda n: haversine(gora, n))
    coords["sounzan-sta"] = sounzan
    notes.append(f"Sounzan set to hakone-cable endpoint farthest from Gora: "
                 f"{sounzan} ({haversine(gora, sounzan):.0f} m from Gora).")

    rope = build_graph(ways_by_line["hakone-ropeway"])
    rope_sounzan = nearest(rope, sounzan)[0]
    candidates = [n for n in degree_one(rope) if n != rope_sounzan]
    togendai = min(candidates, key=lambda n: (n[0], n[1]))  # most westerly
    coords["togendai-sta"] = togendai
    notes.append(f"Togendai set to hakone-ropeway endpoint most westerly, not the "
                 f"Sounzan end: {togendai} ({haversine(rope_sounzan, togendai)/1000:.2f} km "
                 f"from the Sounzan end).")


def resolve_osm_stations(osm_stations, approx):
    """For each table station, find the OSM station node with the same kanji
    name nearest to the approximate position (within OSM_MATCH_M). Operator
    keywords of the station's first listed line are preferred. Stations that
    are set by rules or have no node within range are returned as None."""
    matches = {}
    for sid, kanji, _name, _lat, _lng, line_ids in STATIONS:
        if sid in RULE_STATIONS:
            continue
        here = approx[sid]
        keys = OPERATOR_KEYS[LINE_FAMILY[line_ids[0]]]
        cands = []
        for node in osm_stations:
            if node.get("name") != kanji:
                continue
            d = haversine(here, (node["lng"], node["lat"]))
            if d <= OSM_MATCH_M:
                cands.append((d, node))
        if not cands:
            matches[sid] = None
            continue
        matched = [c for c in cands if any(k in (c[1].get("operator") or "") for k in keys)]
        d, node = min(matched or cands, key=lambda c: c[0])
        matches[sid] = dict(pos=(node["lng"], node["lat"]), osm_id=node["id"],
                            operator=node.get("operator") or "(none)", d=d,
                            operator_match=bool(matched))
    return matches


def build_line(spec, ways, coords, tol):
    adj = build_graph(ways)
    s_pt = coords[spec["start"]]
    t_pt = coords[spec["end"]]
    ends_only = spec.get("endpoint_only", False)
    s, s_d = nearest(adj, s_pt, ends_only)
    t, t_d = nearest(adj, t_pt, ends_only)
    if s == t:
        raise SystemExit(f"[{spec['id']}] start and end snap to the same node")
    path, joins = route(spec["id"], adj, s, t)
    pts = simplify(path, tol)
    return dict(spec=spec, pts=pts, raw_nodes=len(path), joins=joins, tol=tol,
                start=(spec["start"], s, s_d), end=(spec["end"], t, t_d),
                km=round(path_km(pts), 1))


def build_all(ways_by_line, coords, scale):
    lines = {}
    blocked = []
    for spec in LINES:
        try:
            lines[spec["id"]] = build_line(spec, ways_by_line[spec["id"]],
                                           coords, spec["tol"] * scale)
        except Blocked as exc:
            blocked.append((spec["id"], str(exc)))

    stations = []
    unplaced = []
    for sid, kanji, name, _lat, _lng, line_ids in STATIONS:
        used = coords[sid]
        built = [lid for lid in line_ids if lid in lines]
        if not built:
            unplaced.append(sid)
            continue
        snap_line = built[0]
        pts = lines[snap_line]["pts"]
        vertex = min(pts, key=lambda p: haversine(used, p))
        stations.append(dict(id=sid, kanji=kanji, name=name, lines=built,
                             used=used, vertex=vertex, snap_line=snap_line,
                             listed_first=line_ids[0], snap_m=haversine(used, vertex)))

    features = []
    for spec in LINES:
        if spec["id"] not in lines:
            continue
        L = lines[spec["id"]]
        features.append({
            "type": "Feature",
            "properties": {"kind": "line", "id": spec["id"], "name": spec["name"],
                           "kanji": spec["kanji"], "type": spec["type"], "km": L["km"]},
            "geometry": {"type": "LineString",
                         "coordinates": [[p[0], p[1]] for p in L["pts"]]},
        })
    for st in stations:
        features.append({
            "type": "Feature",
            "properties": {"kind": "station", "id": st["id"], "kanji": st["kanji"],
                           "name": st["name"], "lines": st["lines"]},
            "geometry": {"type": "Point",
                         "coordinates": [st["vertex"][0], st["vertex"][1]]},
        })
    geojson = {"type": "FeatureCollection", "attribution": ATTRIBUTION,
               "features": features}
    text = json.dumps(geojson, ensure_ascii=False, separators=(",", ":"))
    return dict(lines=lines, stations=stations, blocked=blocked, unplaced=unplaced,
                text=text, size=len(text.encode("utf-8")))


# ------------------------------------------------------------------ report

def fmt_ll(p):
    return f"({p[0]:.5f}, {p[1]:.5f})"


def write_report(result, scale, warnings, notes, ok_size, osm_matches, input_stats):
    lines = result["lines"]
    out = []
    out.append("# Rail build report")
    out.append("")
    out.append("Generated by `tools/build-rail.py` from `_scratch/rail-raw.json` and "
               "`_scratch/rail-raw-2.json`.")
    out.append("")
    out.append("Inputs: " + "; ".join(input_stats) + ".")
    out.append("")
    out.append("## Blocked lines")
    out.append("")
    if result["blocked"]:
        out.append("These lines are NOT in `data/rail.geojson`. The raw data cannot be "
                   "joined into one path under the 600 m gap rule, and no straight "
                   "bridge was drawn.")
        out.append("")
        out.extend(f"- {msg}" for _lid, msg in result["blocked"])
        if result["unplaced"]:
            out.append("")
            out.append("Stations left out because every line they are on is blocked: "
                       + ", ".join(result["unplaced"]) + ".")
    else:
        out.append("None.")
    out.append("")
    out.append("## Warnings")
    out.append("")
    if warnings:
        out.extend(f"- {w}" for w in warnings)
    else:
        out.append("None.")
    out.append("")
    out.append("## Output")
    out.append("")
    size = result["size"]
    out.append(f"- `data/rail.geojson`: {size} bytes ({size / 1024:.1f} KB)"
               f" - {'under' if size <= SIZE_AIM else 'over'} the 120 KB aim"
               f"{'' if ok_size else ', OVER the 300 KB limit'}")
    out.append(f"- Tolerance scale: x{scale:g}")
    out.append("")
    out.append("## Lines")
    out.append("")
    out.append("| line | points | km | expected km | in range | tol m |")
    out.append("|---|---:|---:|---|---|---:|")
    for spec in LINES:
        lo, hi = spec["km"]
        if spec["id"] not in lines:
            out.append(f"| {spec['id']} | - | - | {lo}-{hi} | BLOCKED | {spec['tol']:g} |")
            continue
        L = lines[spec["id"]]
        inr = "yes" if lo <= L["km"] <= hi else "NO"
        out.append(f"| {spec['id']} | {len(L['pts'])} | {L['km']} | {lo}-{hi} | {inr} | {L['tol']:g} |")
    out.append("")
    out.append("## OSM station positions")
    out.append("")
    out.append("| station | OSM node | operator | approx to node m | operator match | note |")
    out.append("|---|---|---|---:|---|---|")
    for sid, kanji, _name, _lat, _lng, _ls in STATIONS:
        m = osm_matches.get(sid, None)
        if sid in RULE_STATIONS:
            out.append(f"| {sid} | - | - | - | - | set by rule (endpoint) |")
        elif m is None:
            out.append(f"| {sid} | none within {OSM_MATCH_M / 1000:.0f} km | - | - | - | approximate coordinate used |")
        else:
            out.append(f"| {sid} | {m['osm_id']} | {m['operator']} | {m['d']:.0f} | "
                       f"{'yes' if m['operator_match'] else 'no'} | OSM node used |")
    out.append("")
    out.append("## Station snaps (to first listed line's final path)")
    out.append("")
    out.append("| station | snap line | snap m | note |")
    out.append("|---|---|---:|---|")
    for st in result["stations"]:
        note = ""
        if st["id"] == "sounzan-sta":
            note = "set to cable endpoint (rule)"
        elif st["id"] == "togendai-sta":
            note = "set to ropeway endpoint (rule)"
        if st["snap_line"] != st["listed_first"]:
            note = f"first listed line {st['listed_first']} is blocked; used {st['snap_line']}"
        out.append(f"| {st['id']} | {st['snap_line']} | {st['snap_m']:.1f} | {note} |")
    out.append("")
    out.append("## Line endpoint snaps (raw graph node)")
    out.append("")
    out.append("| line | end | station/point | snap m |")
    out.append("|---|---|---|---:|")
    for spec in LINES:
        if spec["id"] not in lines:
            continue
        L = lines[spec["id"]]
        for label, (sid, _node, d) in (("start", L["start"]), ("end", L["end"])):
            out.append(f"| {spec['id']} | {label} | {sid} | {d:.1f} |")
    out.append("")
    out.append("## Virtual edges")
    out.append("")
    joined = [(spec["id"], j) for spec in LINES if spec["id"] in lines
              for j in lines[spec["id"]]["joins"]]
    if joined:
        out.append("| line | from | to | gap m |")
        out.append("|---|---|---|---:|")
        for lid, (a, b, d) in joined:
            out.append(f"| {lid} | {fmt_ll(a)} | {fmt_ll(b)} | {d:.1f} |")
    else:
        out.append("None.")
    out.append("")
    out.append("## Notes")
    out.append("")
    out.extend(f"- {n}" for n in notes)
    out.append("")
    return "\n".join(out)


# -------------------------------------------------------------------- main

def load_inputs():
    """Read both raw files; ways are deduped by way id across them."""
    with open(RAW_PATH, encoding="utf-8") as fh:
        raw1 = json.load(fh)
    with open(RAW2_PATH, encoding="utf-8") as fh:
        raw2 = json.load(fh)
    seen = set()
    ways_by_line = defaultdict(list)
    stats = []
    for name, raw in (("rail-raw.json", raw1), ("rail-raw-2.json", raw2)):
        added = dup = 0
        for way in raw["ways"]:
            if way["id"] in seen:
                dup += 1
                continue
            seen.add(way["id"])
            ways_by_line[way["line"]].append(way)
            added += 1
        stats.append(f"{name}: {added} ways added, {dup} duplicates skipped")
    return ways_by_line, raw2["stations"], stats


def main():
    ways_by_line, osm_stations, input_stats = load_inputs()
    for spec in LINES:
        if not ways_by_line[spec["id"]]:
            raise SystemExit(f"no ways for line {spec['id']}")

    approx = {sid: (lng, lat) for sid, _k, _n, lat, lng, _l in STATIONS}
    coords = dict(approx)
    for pid, (lat, lng) in EXTRA_POINTS.items():
        coords[pid] = (lng, lat)

    osm_matches = resolve_osm_stations(osm_stations, approx)
    for sid, m in osm_matches.items():
        if m is not None:
            coords[sid] = m["pos"]

    notes = []
    apply_special_rules(ways_by_line, coords, notes)

    scale = 1.0
    for _step in range(MAX_TOL_STEPS):
        result = build_all(ways_by_line, coords, scale)
        if result["size"] <= SIZE_LIMIT:
            break
        scale *= 1.5
    ok_size = result["size"] <= SIZE_LIMIT
    if not ok_size:
        raise SystemExit(f"output still {result['size']} bytes after raising tolerances")

    warnings = []
    for lid, msg in result["blocked"]:
        warnings.append(f"BLOCKED {lid}: {msg}")
    for sid in result["unplaced"]:
        warnings.append(f"MISSING station {sid}: no built line carries it.")
    for sid, m in osm_matches.items():
        if m is None:
            warnings.append(f"Station {sid}: no OSM node with that name within "
                            f"{OSM_MATCH_M / 1000:.0f} km; approximate coordinate used.")
    for st in result["stations"]:
        if st["snap_m"] > SNAP_WARN_M:
            warnings.append(f"Station {st['id']} snaps {st['snap_m']:.0f} m "
                            f"to {st['snap_line']} path (over {SNAP_WARN_M:.0f} m).")
    for spec in LINES:
        if spec["id"] not in result["lines"]:
            continue
        L = result["lines"][spec["id"]]
        for label, (sid, _node, d) in (("start", L["start"]), ("end", L["end"])):
            if d > SNAP_WARN_M:
                warnings.append(f"{spec['id']} {label} point {sid} is {d:.0f} m from the "
                                f"nearest {spec['id']} graph node (over {SNAP_WARN_M:.0f} m).")
        lo, hi = spec["km"]
        if not lo <= L["km"] <= hi:
            warnings.append(f"{spec['id']} length {L['km']} km is outside {lo}-{hi} km.")
    for spec in LINES:
        if spec["id"] not in result["lines"]:
            continue
        for a, b, d in result["lines"][spec["id"]]["joins"]:
            notes.append(f"Virtual edge on {spec['id']}: {fmt_ll(a)} to {fmt_ll(b)}, {d:.1f} m.")

    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        fh.write(result["text"])
    report = write_report(result, scale, warnings, notes, ok_size, osm_matches, input_stats)
    with open(REPORT_PATH, "w", encoding="utf-8") as fh:
        fh.write(report)
    print(report)
    status = 0
    if result["blocked"]:
        print("INCOMPLETE lines: " + ", ".join(lid for lid, _ in result["blocked"]), file=sys.stderr)
        status = 2
    if result["unplaced"]:
        print("MISSING stations: " + ", ".join(result["unplaced"]), file=sys.stderr)
        status = 2
    return status


if __name__ == "__main__":
    sys.exit(main())
