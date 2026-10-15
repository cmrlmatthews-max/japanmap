// The koi: the fly-through marker. A flat ink fish that swims at the tip of the ink while the trip plays, is scrubbed or rests at a stop.
// It reads the trip cursor (trip.progressPoint) and is a plane lying on the ground, SIZE_PX long on screen, drawn above the pins.
// Image: assets/web/koi-marker.png (transparent, the fish facing right). Until it loads, or if it is missing, an ink fish drawn in canvas stands in.

const IMG = 'assets/web/koi-marker.png';
const SIZE_PX = 30;                     // length on screen, CSS px
const LIFT = 0.3;                       // world units above the path
const FADE_S = 0.25;                    // fade in / out
const WIGGLE_DEG = 6, HZ = 1.2, PULSE = 0.03;
const INK = '#2C2C2A', VERM = '#C8341E', PAPER = '#F5EFE0';

// ---------- the stand-in fish: 128 x 64, head to the right ----------
export function drawKoi() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const g = cv.getContext('2d'); if (!g) return cv;
  const body = () => {                                           // tapered body, long forked tail
    g.beginPath(); g.moveTo(122, 33);
    g.bezierCurveTo(121, 25, 112, 20, 98, 19.5);                  // nose, forehead
    g.bezierCurveTo(82, 19, 66, 22, 52, 28);                      // back, narrowing to the tail stalk
    g.bezierCurveTo(46, 30.5, 42, 31, 38, 31.5);
    g.bezierCurveTo(30, 29, 20, 20, 6, 8);                        // upper lobe of the tail, swept back
    g.bezierCurveTo(14, 20, 20, 27, 22, 32);                      // the fork
    g.bezierCurveTo(20, 37, 14, 44, 6, 56);                       // lower lobe
    g.bezierCurveTo(20, 50, 30, 36, 38, 32.5);                    // back to the stalk
    g.bezierCurveTo(52, 38, 70, 46, 92, 46);                      // belly
    g.bezierCurveTo(108, 46, 120, 40, 122, 33);                   // chin
    g.closePath();
  };
  const fin = () => {                                            // pectoral fin, swept back
    g.beginPath(); g.moveTo(98, 41); g.bezierCurveTo(92, 49, 82, 55, 70, 56); g.bezierCurveTo(78, 51, 84, 46, 90, 41); g.closePath();
  };
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(245,239,224,.9)'; g.lineWidth = 6;       // a paper halo, so the ink reads on dark ground
  body(); g.stroke(); fin(); g.stroke();
  g.fillStyle = INK; body(); g.fill(); fin(); g.fill();
  g.fillStyle = PAPER; g.globalAlpha = 0.16;                     // a few pale patches on the back, like a koi
  for (const [x, y, rx, ry] of [[82, 26, 11, 4.2], [60, 29.5, 8, 3.2], [99, 27, 4.5, 2.8]]) { g.beginPath(); g.ellipse(x, y, rx, ry, -0.12, 0, 6.2832); g.fill(); }
  g.globalAlpha = 1;
  g.fillStyle = VERM; g.beginPath(); g.arc(109, 28.5, 3.2, 0, 6.2832); g.fill();    // the eye
  return cv;
}

export function initMarker(ctx, route, trip) {
  const { THREE, scene, camera, canvas, view, state } = ctx;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  // --- texture: the drawn fish first, the image when it arrives ---
  let aspect = 2;
  const mat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, opacity: 0, side: THREE.DoubleSide });
  const setMap = (t, a) => { const old = mat.map; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; mat.map = t; mat.needsUpdate = true; aspect = a; if (old && old !== t) old.dispose(); };
  setMap(new THREE.CanvasTexture(drawKoi()), 2);
  new THREE.TextureLoader().load(IMG, (t) => {
    const im = t.image;
    setMap(t, im && im.width && im.height ? im.width / im.height : 2);
  }, undefined, () => { /* no image yet: the drawn fish stays */ });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.name = 'koi-marker'; mesh.renderOrder = 25; mesh.frustumCulled = false; mesh.visible = false;
  mesh.rotation.order = 'YXZ';                                   // lie flat first (x), then turn about the vertical (y)
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);

  // --- per frame ---
  const P = new THREE.Vector3(), T = new THREE.Vector3(), _f = new THREE.Vector3(), _d = new THREE.Vector3();
  let userOn = true, alpha = 0, time = 0, yaw = 0, haveYaw = false, placed = false;

  function wppAt(point, dist, h) {                               // world units per CSS px at this point (same rule as the pins)
    const bl = view ? view.blend : 0;
    if (bl >= 1) return view.wpp(dist);
    camera.getWorldDirection(_f);
    const depth = Math.max(0.05, _d.subVectors(point, camera.position).dot(_f));
    if (bl > 0) return 2 * tanHalf * dist / h * ((1 - bl) * depth + bl) / ((1 - bl) * dist + bl);
    return 2 * tanHalf * depth / h;
  }

  function update(dt, dist) {
    time += dt;
    const live = userOn && state.route !== false && !!trip && !!trip.cursor && typeof trip.progressPoint === 'function' && !!trip.progressPoint(P, T.set(0, 0, 0));
    alpha = Math.min(1, Math.max(0, alpha + (live ? dt : -dt) / FADE_S));
    mesh.visible = alpha > 0.004;
    if (!mesh.visible) { haveYaw = false; placed = false; return; }
    mat.opacity = alpha;
    if (live) {
      placed = true;
      mesh.position.set(P.x, P.y + LIFT, P.z);
      if (T.x * T.x + T.z * T.z > 1e-8) {                        // turn to the heading (shortest way round); a stop keeps the last heading
        const want = Math.atan2(-T.z, T.x);
        if (!haveYaw) { yaw = want; haveYaw = true; }
        else yaw += Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw)) * (1 - Math.exp(-dt * 12));
        yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      }
    }
    if (!placed) { mesh.visible = false; return; }
    const still = state.cameraMoves === false;                   // Motion off: no wiggle, no pulse
    const ph = time * Math.PI * 2 * HZ;
    mesh.rotation.y = yaw + (still ? 0 : Math.sin(ph) * THREE.MathUtils.degToRad(WIGGLE_DEG));
    const pulse = still ? 1 : 1 + PULSE * Math.sin(ph + 1.3);
    const len = SIZE_PX * wppAt(mesh.position, dist, canvas.clientHeight || 1) * pulse;
    if (aspect >= 1) mesh.scale.set(len, len / aspect, 1); else mesh.scale.set(len * aspect, len, 1);
  }

  return {
    update,
    setVisible(b) { userOn = !!b; },                             // the app's Route switch; the marker also follows state.route by itself
    mesh,
    get opacity() { return alpha; },
    dispose() { scene.remove(mesh); mesh.geometry.dispose(); if (mat.map) mat.map.dispose(); mat.dispose(); },
  };
}
