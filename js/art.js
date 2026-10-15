// Ink paintings on the sea of the flat map, under the land sheet.
//
//   plane   y      renderOrder
//   sea     -1.0   -3     (flatmap.js)
//   art     -0.8   -2     (this file)
//   land    -0.5   -1     (flatmap.js: draws over the art, so a painting never shows on land)
//
// data/art.json is a list of { id, file, lon, lat, km, rot, opacity, flip }:
//   km       width on the map (1 world unit = 0.764 km, as in terrain.js). The height follows the image ratio.
//   rot      turn on the ground in radians, positive = counter-clockwise seen from above (north is up)
//   opacity  strength when fully faded in
//   flip     mirror left to right (before the turn)
// A painting whose file is missing is skipped without a word.
//
// Use: const art = await initArt(ctx);  then each frame: art.update(dt, dist).
// initArt adds the group to ctx.scene and returns once the list is read. The paintings join the group as they load;
// art.ready resolves when every file has loaded or failed. Needs ctx.THREE, ctx.scene and ctx.lonLatToWorld.

const KM_PER_UNIT = 0.764;               // METERS_PER_UNIT in terrain.js / 1000
const Y = -0.8, ORDER = -2;
const FADE = { hidden: 110, full: 170 }; // camera distance: gone below 110, full above 170 (a close zoom hides the art)
const INK = '#5B5952';                   // grey-d: multiplies the ink toward grey
const DEFAULT_OPACITY = 0.3;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export async function initArt(ctx) {
  const { THREE, scene, lonLatToWorld } = ctx;
  const group = new THREE.Group(); group.name = 'art';
  const items = [];                      // { mesh, mat, opacity }
  let fade = 0;                          // last distance fade, so a late painting starts at the right strength
  const api = {
    group, ready: Promise.resolve(),
    update(dt, dist) {
      fade = smooth(FADE.hidden, FADE.full, dist);
      for (const it of items) {
        const o = it.opacity * fade;
        it.mat.opacity = o; it.mesh.visible = o > 0.004;
      }
    },
    setVisible(b) { group.visible = !!b; },
  };
  scene.add(group);

  let list = [];
  try { const r = await fetch('data/art.json'); if (r.ok) list = await r.json(); } catch (e) { /* no list, no art */ }
  if (!Array.isArray(list)) list = [];

  const loader = new THREE.TextureLoader();
  const place = (p) => new Promise((resolve) => {
    const lon = num(p && p.lon, NaN), lat = num(p && p.lat, NaN), km = num(p && p.km, NaN);
    if (!p || typeof p.file !== 'string' || !(km > 0) || !Number.isFinite(lon) || !Number.isFinite(lat)) { resolve(); return; }
    loader.load(p.file, (tex) => {
      try {
        const img = tex.image, iw = img && (img.naturalWidth || img.width), ih = img && (img.naturalHeight || img.height);
        if (!(iw > 0 && ih > 0)) { tex.dispose(); resolve(); return; }
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, color: INK, opacity: 0 });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        const w = km / KM_PER_UNIT, h = w * ih / iw, at = lonLatToWorld(lon, lat);
        mesh.name = 'art-' + (p.id || '');
        mesh.position.set(at.x, Y, at.z);
        mesh.rotation.set(-Math.PI / 2, 0, num(p.rot, 0));   // lay it flat (image up = north), then turn it about its own normal
        mesh.scale.set(p.flip ? -w : w, h, 1);                // a negative x scale mirrors it (three.js flips the face winding to match)
        mesh.renderOrder = ORDER; mesh.frustumCulled = true;
        const opacity = num(p.opacity, DEFAULT_OPACITY), o = opacity * fade;
        mat.opacity = o; mesh.visible = o > 0.004;
        group.add(mesh);
        items.push({ mesh, mat, opacity });
      } catch (e) { /* skip this painting */ }
      resolve();
    }, undefined, () => resolve());                           // missing file: skip it
  });

  api.ready = Promise.all(list.map(place)).then(() => undefined, () => undefined);
  return api;
}
