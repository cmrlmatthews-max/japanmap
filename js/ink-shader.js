// Sumi-e ink-wash terrain material.
// Height bands in paper + three greys, slope-driven dry-brush streaks, faint contour ink,
// a coast line in ink, washi grain.
//
// One shader serves the coarse BASE and the fine PATCHES. Everything is driven by world xz and by
// height in meters, so bands, contours and streaks read the same on both.
//  - BASE:  fades out at the outer world edge (uBounds) and discards fragments inside patch rectangles (uRects).
//  - PATCH: no edge fade at all; its border vertices are blended to the base height in terrain.js.
import * as THREE from 'three';

const PAL = {
  paper:  new THREE.Color('#F5EFE0'),
  ink:    new THREE.Color('#2C2C2A'),
  greyL:  new THREE.Color('#B9B6AC'),
  greyM:  new THREE.Color('#8E8B82'),
  greyD:  new THREE.Color('#5B5952'),
};

const MAX_RECTS = 6;

const vert = /* glsl */`
attribute float height;
varying float vH;
varying vec3 vN;
varying vec3 vW;
void main() {
  vH = height;
  vN = normal;                                   // world space (the mesh sits at the origin)
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */`
precision highp float;
uniform vec3 uPaper, uInk, uGreyL, uGreyM, uGreyD;
uniform sampler2D uWashi;
uniform float uTime;
uniform float uSnow;       // meters
uniform vec3 uCamPos;
uniform float uFogNear, uFogFar;
uniform sampler2D uCoastTex;  // per-file blurred land mask: crisp coastlines independent of the mesh resolution
uniform vec4 uCoastRect;      // world rect (xmin, zmin, xmax, zmax) the raster covers
uniform vec3 uTint;        // debug: tint to show patch areas
uniform float uFlat;       // 1 on the flat map: the relief is lifted toward paper, so the ink reads as a wash rather than a dark mass seen from straight above
uniform vec4 uBounds;      // base only: xmin, zmin, xmax, zmax (world)
uniform vec4 uRects[${MAX_RECTS}];  // base only: patch rectangles xmin, zmin, xmax, zmax (world, inset)
uniform int uRectN;
varying float vH;
varying vec3 vN;
varying vec3 vW;

// --- noise ---
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<3;i++){ v += a*noise(p); p *= 2.1; a *= 0.5; } return v; }

void main() {
#ifdef BASE
  for (int i = 0; i < ${MAX_RECTS}; i++) {
    if (i >= uRectN) break;
    vec4 r = uRects[i];
    if (vW.x > r.x && vW.x < r.z && vW.z > r.y && vW.z < r.w) discard;
  }
#endif

  float dCam = distance(vW, uCamPos);
  float lod = 1.0 - smoothstep(120.0, 420.0, dCam);   // fine brush detail fades out when the camera is far (no aliasing at overview)
  vec3 N = normalize(vN);
  float slope = 1.0 - clamp(N.y, 0.0, 1.0);
  float wob = (fbm(vW.xz * 0.35) - 0.5) * 220.0;      // brush wobble on band edges (meters)
  float h = vH + wob;

  // --- height bands (paper -> light -> mid -> dark) ---
  vec3 col = mix(uPaper, uGreyL, smoothstep(60.0, 420.0, h));
  col = mix(col, uGreyM, smoothstep(650.0, 1250.0, h));
  col = mix(col, uGreyD, smoothstep(1500.0, 2400.0, h));
  // snow cap on Fuji: back to paper with a ragged edge
  float snow = smoothstep(uSnow - 80.0, uSnow + 160.0, vH + (fbm(vW.xz*1.3)-0.5)*260.0*lod);
  col = mix(col, uPaper, snow);

  // --- light from the upper left (north-west), soft ---
  vec3 L = normalize(vec3(-0.6, 0.8, -0.35));
  float lit = clamp(dot(N, L), 0.0, 1.0);
  col = mix(col * 0.78, col, smoothstep(0.1, 0.8, lit));

  // --- dry-brush streaks on slopes, following the fall line ---
  vec2 fall = normalize(N.xz + 1e-4);
  vec2 perp = vec2(-fall.y, fall.x);
  float along = dot(vW.xz, perp) * 1.8 + fbm(vW.xz * 0.6) * 3.0;
  float streak = fbm(vec2(along, dot(vW.xz, fall) * 0.25));
  float sk = smoothstep(0.035, 0.2, slope) * smoothstep(0.52, 0.72, streak) * (1.0 - snow) * lod;
  col = mix(col, uInk, sk * 0.75);

  // --- faint contour ink every 300 m ---
  float c = fract((vH + wob * 0.4) / 300.0);
  float cl = (1.0 - smoothstep(0.0, 0.05, c)) * smoothstep(40.0, 200.0, vH) * (1.0 - snow);
  col = mix(col, uInk, cl * 0.22);
  col = mix(col, uPaper, 0.3 * uFlat);              // flat map: a lighter wash (the lit slopes that give the 3D view its air are not there)

  // --- coast: a crisp ink line of constant screen width, then paper with no terrain ---
  // (flat shores stay clean instead of turning into translucent marsh)
  vec2 cuv = (vW.xz - uCoastRect.xy) / (uCoastRect.zw - uCoastRect.xy);
  float mk = texture2D(uCoastTex, clamp(cuv, 0.0, 1.0)).r + (fbm(vW.xz * 2.0) - 0.5) * 0.3 * lod;   // brushy shoreline
  float sd = (mk - 0.5) / max(fwidth(mk), 0.02);                      // signed distance to the shore in screen px (+ = land)
  float coastLine = 1.0 - smoothstep(0.5, 2.0, abs(sd - 1.0));
  col = mix(col, uInk, coastLine * 0.8);
  float alpha = smoothstep(-0.6, 0.6, sd);

  // --- washi grain (world-space so base and patches match) ---
  vec3 grain = texture2D(uWashi, vW.xz * 0.07).rgb;
  col *= mix(vec3(1.0), grain / 0.96, 0.35);

  // --- distance fog toward paper (range follows the camera distance) ---
  col = mix(col, uPaper, smoothstep(uFogNear, uFogFar, dCam) * 0.85);

#ifdef BASE
  // --- brush-edge fade at the outer world edge only ---
  // The edge wanders (slow noise moves where the ink gives out) and frays (fine noise), so the cut of the data file never reads as a ruled line.
  float e = min(min(vW.x - uBounds.x, uBounds.z - vW.x), min(vW.z - uBounds.y, uBounds.w - vW.z));
  float slow = fbm(vW.xz * 0.021 + 7.3) - 0.5;
  float mid  = fbm(vW.xz * 0.085 + 2.1) - 0.5;
  float fray = fbm(vW.xz * 0.5) - 0.5;
  float eo = e + slow * 46.0 + mid * 20.0 + fray * 7.0;
  float edgeA = smoothstep(0.0, 17.0, eo);
  // dry-brush bite: thin streaks of paper show through the fade
  float bite = fbm(vec2(dot(vW.xz, vec2(0.9, 0.4)) * 0.9, dot(vW.xz, vec2(-0.4, 0.9)) * 0.06));
  edgeA *= 1.0 - (1.0 - edgeA) * smoothstep(0.35, 0.65, bite) * 0.7;
  alpha *= edgeA;
#endif

  col = mix(col, uTint, length(uTint) > 0.0 ? 0.35 : 0.0);
  gl_FragColor = vec4(col, alpha);
}`;

export function makeInkMaterial(washiTex, { base = false, bounds = null, rects = [], coastTex = null, coastRect = null } = {}) {
  washiTex.wrapS = washiTex.wrapT = THREE.RepeatWrapping;
  washiTex.colorSpace = THREE.SRGBColorSpace;
  const inset = 0.6;                     // base discards a little inside each patch: the patch overlaps it, so no crack shows at the seam
  const rectArr = [];
  for (let i = 0; i < MAX_RECTS; i++) {
    const r = rects[i];
    rectArr.push(r ? new THREE.Vector4(r.x0 + inset, r.z0 + inset, r.x1 - inset, r.z1 - inset) : new THREE.Vector4());
  }
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    defines: base ? { BASE: 1 } : {},
    transparent: true,
    polygonOffset: base,                 // base sits behind patches where both exist
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 4,
    uniforms: {
      uPaper: { value: PAL.paper }, uInk: { value: PAL.ink },
      uGreyL: { value: PAL.greyL }, uGreyM: { value: PAL.greyM }, uGreyD: { value: PAL.greyD },
      uWashi: { value: washiTex },
      uTime: { value: 0 },
      uSnow: { value: 2950 },
      uCamPos: { value: new THREE.Vector3() },
      uTint: { value: new THREE.Vector3() },
      uFlat: { value: 0 },
      uCoastTex: { value: coastTex },
      uCoastRect: { value: coastRect ? new THREE.Vector4(coastRect.x0, coastRect.z0, coastRect.x1, coastRect.z1) : new THREE.Vector4(0, 0, 1, 1) },
      uFogNear: { value: 90 }, uFogFar: { value: 260 },
      uBounds: { value: bounds ? new THREE.Vector4(bounds.x0, bounds.z0, bounds.x1, bounds.z1) : new THREE.Vector4() },
      uRects: { value: rectArr },
      uRectN: { value: Math.min(rects.length, MAX_RECTS) },
    },
  });
  return mat;
}
export { PAL };
