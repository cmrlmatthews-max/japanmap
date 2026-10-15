"""Build the coast data and the wave tile for the flat map.
Usage: python3 -I tools/build-coast.py <countries.geojson> <lakes.geojson>
Run from the repo root. Inputs: Natural Earth 10m countries and lakes (public domain).
Output: data/japan-coast.json and assets/web/wave.png
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JSON = os.path.join(ROOT, "data", "japan-coast.json")
SRC_TILE = os.path.join(ROOT, "assets", "wave-pattern-tile.png")
OUT_TILE = os.path.join(ROOT, "assets", "web", "wave.png")

MIN_LAT = 30.0          # Drop islands that reach south of this line. These are the Ryukyu islands.
DECIMALS = 4
INSET_MIN_PTS = 60      # Simplify rings with at least this many points.
INSET_TOL = 0.05        # Douglas-Peucker tolerance, in degrees.
INSET_MIN_SPAN = 0.5    # Keep a smaller ring only if it is wider or taller than this.
SIZE_LIMIT_KB = 400     # The JSON file stays under this size. KB means 1000 bytes here.


def clean_ring(ring):
    """Round to 4 decimals. Drop repeated points. Return None if fewer than 4 remain."""
    out = []
    for lon, lat in ring:
        pt = [round(lon, DECIMALS), round(lat, DECIMALS)]
        if not out or out[-1] != pt:
            out.append(pt)
    return out if len(out) >= 4 else None


def polygons_of(geom):
    """Return the polygons of a Polygon or MultiPolygon geometry."""
    if geom is None:
        return []
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def ring_bbox(points):
    """Return [min_lon, min_lat, max_lon, max_lat] for a list of points."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return [min(xs), min(ys), max(xs), max(ys)]


def centroid(ring):
    """Return the area centroid of a ring. Use the vertex mean if the area is zero."""
    area2 = 0.0
    cx = 0.0
    cy = 0.0
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        area2 += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(area2) < 1e-12:
        return sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n
    return cx / (3.0 * area2), cy / (3.0 * area2)


def point_in_ring(x, y, ring):
    """Ray casting. Return True if the point is inside the ring."""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y):
            if x < xi + (y - yi) * (xj - xi) / (yj - yi):
                inside = not inside
        j = i
    return inside


def in_land(x, y, land, boxes):
    """Return True if the point is inside one of the land rings."""
    for ring, (x0, y0, x1, y1) in zip(land, boxes):
        if x0 <= x <= x1 and y0 <= y <= y1 and point_in_ring(x, y, ring):
            return True
    return False


def simplify(points, tol):
    """Simplify a ring with Douglas-Peucker. Keep both end points."""
    n = len(points)
    keep = [False] * n
    keep[0] = True
    keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        ax, ay = points[a]
        bx, by = points[b]
        dx = bx - ax
        dy = by - ay
        seg2 = dx * dx + dy * dy
        far = -1.0
        far_i = -1
        for i in range(a + 1, b):
            px, py = points[i]
            if seg2 == 0.0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / seg2
                t = min(1.0, max(0.0, t))
                d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d2 > far:
                far = d2
                far_i = i
        if far > tol * tol:
            keep[far_i] = True
            stack.append((a, far_i))
            stack.append((far_i, b))
    return [p for p, k in zip(points, keep) if k]


def make_wave_tile():
    """Step 6. Make the 512 x 512 RGBA wave tile."""
    from PIL import Image  # Only this step needs PIL.

    with Image.open(SRC_TILE) as src:
        tile = src.convert("RGBA").resize((512, 512), Image.Resampling.LANCZOS)
    tile.save(OUT_TILE, format="PNG")
    with Image.open(OUT_TILE) as chk:
        print("Wrote %s. Size %dx%d, mode %s." % (OUT_TILE, chk.size[0], chk.size[1], chk.mode))


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding="utf-8") as f:
        countries = json.load(f)
    with open(sys.argv[2], encoding="utf-8") as f:
        lakes_src = json.load(f)

    # Step 1. Find Japan. Keep the main islands. Keep the outer ring only.
    japan = [ft for ft in countries["features"] if ft["properties"].get("ADMIN") == "Japan"]
    if len(japan) != 1:
        sys.exit("Expected one Japan feature, found %d." % len(japan))
    polys = polygons_of(japan[0]["geometry"])
    print("Japan polygons in source: %d" % len(polys))
    land = []
    for poly in polys:
        if any(p[1] < MIN_LAT for ring in poly for p in ring):
            continue
        ring = clean_ring(poly[0])
        if ring is not None:
            land.append(ring)

    # Step 2. Keep each lake whose centroid lies inside a land ring.
    boxes = [ring_bbox(r) for r in land]
    lakes = []
    for ft in lakes_src["features"]:
        name = (ft.get("properties") or {}).get("name") or ""
        for poly in polygons_of(ft.get("geometry")):
            cx, cy = centroid(poly[0])
            if not in_land(cx, cy, land, boxes):
                continue
            ring = clean_ring(poly[0])
            if ring is not None:
                lakes.append({"name": name, "ring": ring})

    # Step 3. Build the inset rings. Simplify the big rings. Keep the wide small rings.
    inset = []
    for ring in land:
        if len(ring) >= INSET_MIN_PTS:
            small = simplify(ring, INSET_TOL)
            if len(small) >= 4:
                inset.append(small)
        else:
            x0, y0, x1, y1 = ring_bbox(ring)
            if x1 - x0 > INSET_MIN_SPAN or y1 - y0 > INSET_MIN_SPAN:
                inset.append(ring)

    # Step 4. Bounding box of all land rings.
    bbox = ring_bbox([p for ring in land for p in ring])

    # Step 5. Write the JSON file. Check the size.
    data = {"v": 1, "bbox": bbox, "land": land, "lakes": lakes, "inset": inset}
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    size_kb = os.path.getsize(OUT_JSON) / 1000.0

    land_pts = sum(len(r) for r in land)
    lake_pts = sum(len(lk["ring"]) for lk in lakes)
    inset_pts = sum(len(r) for r in inset)
    print("Land polygons: %d. Land vertices: %d." % (len(land), land_pts))
    print("Lakes: %d. Lake vertices: %d." % (len(lakes), lake_pts))
    print("Lake names: %s" % ", ".join(lk["name"] or "(no name)" for lk in lakes))
    print("Inset rings: %d. Inset vertices: %d." % (len(inset), inset_pts))
    print("bbox: %s" % bbox)
    print("Wrote %s. File size %.1f KB." % (OUT_JSON, size_kb))
    if size_kb > SIZE_LIMIT_KB:
        sys.exit("File is over %d KB." % SIZE_LIMIT_KB)

    make_wave_tile()


if __name__ == "__main__":
    main()
