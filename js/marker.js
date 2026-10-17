// The traveler: the marker for the trip. One pilgrim in ink (straw kasa hat, walking staff, side view) who glides along the route
// while the trip plays, is scrubbed or rests at a stop. He is a sprite that always faces the screen, feet on the trip cursor (trip.progressPoint),
// TALL_PX high on screen, drawn above the pins. He mirrors to face the way he walks (on screen), glides with no bounce, and steps aside at a stop.
// Image: assets/web/traveler.png (transparent, figure facing right, feet at the bottom edge). Until it loads, or if it is missing, a drawn pilgrim stands in.

const IMG = 'assets/web/traveler.png';
const TALL_PX = 34;                     // height on screen, CSS px
const LIFT = 0.3;                       // world units above the path
const FADE_S = 0.25;                    // fade in / out
const MOVE_PX_S = 4;                    // faster than this on screen counts as walking
const SIDE_PX = 22;                     // at a stop he steps aside, so he does not stand on the place's pin
const INK = '#2C2C2A', VERM = '#C8341E', PAPER = '#F5EFE0';

// ---------- the stand-in pilgrim: 96 x 128, facing right, feet on the bottom edge ----------
export function drawTraveler() {
  const cv = document.createElement('canvas'); cv.width = 96; cv.height = 128;
  const g = cv.getContext('2d'); if (!g) return cv;
  const hat = () => { g.beginPath(); g.moveTo(47, 5); g.bezierCurveTo(54, 17, 68, 30, 82, 42); g.quadraticCurveTo(48, 48, 14, 42); g.bezierCurveTo(28, 30, 40, 17, 47, 5); g.closePath(); };
  const head = () => { g.beginPath(); g.arc(50, 53, 7, 0, 6.2832); g.closePath(); };
  const robe = () => { g.beginPath(); g.moveTo(43, 59); g.lineTo(59, 59); g.lineTo(63, 98); g.lineTo(35, 98); g.closePath(); };
  const limbs = () => {                                                // legs in mid stride, one arm, the staff held forward
    for (const [a, b, c, d, w] of [[43, 96, 31, 122, 8], [56, 96, 68, 122, 8], [55, 66, 70, 76, 6.5], [70, 46, 85, 123, 4.5]]) {
      g.lineWidth = w + g._pad; g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke();
    }
  };
  g.lineJoin = 'round'; g.lineCap = 'round';
  g._pad = 10; g.lineWidth = 10;                                        // a thin paper halo, so the ink reads on dark ground
  g.fillStyle = g.strokeStyle = 'rgba(245,239,224,.92)';
  for (const f of [hat, head, robe]) { f(); g.fill(); g.stroke(); }
  limbs();
  g._pad = 0; g.fillStyle = g.strokeStyle = INK;
  for (const f of [hat, head, robe]) { f(); g.fill(); }
  limbs();
  g.strokeStyle = VERM; g.lineWidth = 5.5; g.beginPath(); g.moveTo(18, 41); g.quadraticCurveTo(48, 47, 78, 40.5); g.stroke();   // the cord along the hat rim
  return cv;
}

function haloed(im) {                                                   // paper silhouette stamped round the image, then the image on top
  try {
    const r = Math.max(2, Math.round(im.height * 0.014)), W = im.width + 2 * r, H = im.height + r;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); if (!g) return null;
    const sil = document.createElement('canvas'); sil.width = im.width; sil.height = im.height;
    const sg = sil.getContext('2d'); sg.drawImage(im, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = PAPER; sg.fillRect(0, 0, sil.width, sil.height);
    g.globalAlpha = 0.9;
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; g.drawImage(sil, r + Math.cos(a) * r, r + Math.sin(a) * r); }
    g.globalAlpha = 1; g.drawImage(im, r, r);
    return cv;
  } catch (e) { return null; }
}

function drawShadow() {                                                 // a soft ink ellipse
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
  const g = cv.getContext('2d'); if (!g) return cv;
  const r = g.createRadialGradient(32, 16, 1, 32, 16, 30);
  r.addColorStop(0, 'rgba(44,44,42,.9)'); r.addColorStop(0.6, 'rgba(44,44,42,.45)'); r.addColorStop(1, 'rgba(44,44,42,0)');
  g.save(); g.translate(0, 16); g.scale(1, 0.5); g.translate(0, -16); g.fillStyle = r; g.fillRect(0, 0, 64, 32); g.restore();
  return cv;
}

export function initMarker(ctx, route, trip) {
  const { THREE, scene, camera, canvas, view, state } = ctx;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // --- texture: the drawn pilgrim first, the image when it arrives ---
  let aspect = 0.75;
  const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false, opacity: 0 });
  const setMap = (t, a) => { const old = mat.map; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; mat.map = t; mat.needsUpdate = true; aspect = a; if (old && old !== t) old.dispose(); };
  setMap(new THREE.CanvasTexture(drawTraveler()), 0.75);
  new THREE.TextureLoader().load(IMG, (t) => {
    const im = t.image;
    if (!(im && im.width && im.height)) { setMap(t, 0.75); return; }
    const h = haloed(im);                                                // the image with the same thin paper halo as the drawn one
    if (h) { t.dispose(); setMap(new THREE.CanvasTexture(h), h.width / h.height); } else setMap(t, im.width / im.height);
  }, undefined, () => { /* no image yet: the drawn pilgrim stays */ });

  const fig = new THREE.Sprite(mat);                                     // feet at the bottom centre
  fig.center.set(0.5, 0); fig.renderOrder = 25; fig.frustumCulled = false;
  const shMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(drawShadow()), transparent: true, fog: false, depthTest: false, depthWrite: false, opacity: 0 });
  const shadow = new THREE.Sprite(shMat);
  shadow.renderOrder = 24; shadow.frustumCulled = false;
  const mesh = new THREE.Group(); mesh.name = 'traveler-marker'; mesh.visible = false;
  mesh.add(shadow, fig);
  scene.add(mesh);

  // --- per frame ---
  const P = new THREE.Vector3(), T = new THREE.Vector3(), _f = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _last = new THREE.Vector3(), _o = new THREE.Vector3();
  let userOn = true, alpha = 0, placed = false, haveLast = false;
  let face = 1, faceTo = 1, walkHold = 0, side = 0;                               // face: +1 right on screen, -1 left (eased)

  function wppAt(point, dist, h) {                                       // world units per CSS px at this point (same rule as the pins)
    const bl = view ? view.blend : 0;
    if (bl >= 1) return view.wpp(dist);
    camera.getWorldDirection(_f);
    const depth = Math.max(0.05, _d.subVectors(point, camera.position).dot(_f));
    if (bl > 0) return 2 * tanHalf * dist / h * ((1 - bl) * depth + bl) / ((1 - bl) * dist + bl);
    return 2 * tanHalf * depth / h;
  }

  function update(dt, dist) {
    const live = userOn && state.route !== false && !!trip && !!trip.cursor && typeof trip.progressPoint === 'function' && !!trip.progressPoint(P, T.set(0, 0, 0));
    alpha = Math.min(1, Math.max(0, alpha + (live ? dt : -dt) / FADE_S));
    mesh.visible = alpha > 0.004;
    if (!mesh.visible) { placed = false; haveLast = false; return; }
    if (live) { placed = true; mesh.position.set(P.x, P.y + LIFT, P.z); }
    if (!placed) { mesh.visible = false; return; }

    camera.updateMatrixWorld();
    _r.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);   // screen right and up, in the world
    const wpp = wppAt(mesh.position, dist, canvas.clientHeight || 1);

    // heading on screen: the tangent against the screen's right axis; a stop or a straight up / down heading keeps the last facing
    if (live && T.lengthSq() > 1e-12) { const s = T.dot(_r) / T.length(); if (s > 0.15) faceTo = 1; else if (s < -0.15) faceTo = -1; }
    face += (faceTo - face) * (1 - Math.exp(-dt * 20));

    // walking = the point is really moving on screen (paused, a stop and a still camera all stand still)
    let walking = false;
    if (live && haveLast && dt > 0) walking = _d.subVectors(mesh.position, _last).length() / wpp / dt > MOVE_PX_S;
    _last.copy(mesh.position); haveLast = live;
    walkHold = walking ? 0.12 : Math.max(0, walkHold - dt);
    side += ((walkHold > 0 ? 0 : 1) - side) * (1 - Math.exp(-dt * 6));   // ease aside at a stop, back onto the line when he walks
    _o.copy(_r).multiplyScalar(-face * SIDE_PX * wpp * side);            // the side he came from

    const h = TALL_PX * wpp, w = h * aspect;
    fig.scale.set(face * w, h, 1);
    fig.position.copy(_o);
    fig.material.opacity = alpha;
    shadow.scale.set(Math.max(w, h * 0.5) * 0.9, h * 0.2, 1);
    shadow.position.copy(_o);
    shMat.opacity = alpha * 0.4;
  }

  return {
    update,
    setVisible(b) { userOn = !!b; },                                     // the app's Route switch; the marker also follows state.route by itself
    mesh,
    get opacity() { return alpha; },
    dispose() { scene.remove(mesh); if (mat.map) mat.map.dispose(); mat.dispose(); if (shMat.map) shMat.map.dispose(); shMat.dispose(); },
  };
}
