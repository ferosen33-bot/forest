import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { texturize } from './SurfaceTextures';
import { injectSeason } from './SeasonShader';
import type { PlaceKind } from './Places';
import { M, type Builder } from './PlaceMeshes';

/**
 * Die atemberaubenden Orte (Meilenstein 53) – Inszenierungen mit eigener Stimmung:
 * - **Myzel-Hain**: tote Bäume unter weißem Gespinst, Schleier zwischen den Stämmen, Hunderte Pilze,
 *   die nachts türkis leuchten, schwebende Sporen und in der Mitte das pulsierende Herz.
 * - **Der Weiße Schleier**: Wasserfall über eine bemooste Felswand in ein knietiefes Becken, mit
 *   Gischt, Sprühnebel und – bei Sonne – einem Regenbogen.
 * - **Schiffsfriedhof Grauwasser**: ein Kutter in Schräglage, der Bug eines Frachters ragt aus dem
 *   Wasser, ein umgekipptes Segelboot, eine schaukelnde Glockenboje, Nebel über der Bucht.
 * - **Feuerwachturm Hoher Kopf**: Stahlturm mit Treppen im Zickzack, Kanzel mit Rundumfenstern und
 *   Fernglas, das die Karte aufdeckt.
 * - **Versunkenes Dorf Tiefensee**: Kirchturm und Dächer ragen aus dem See, ein Steg, ein Ruderboot,
 *   Seerosen; nachts brennt Licht im Glockenstuhl und unter Wasser.
 * Alles in lokalen Koordinaten des Ortes (Ursprung am Bauplatz, +Z = Blickrichtung).
 */

type V3 = [number, number, number];

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

// Eigene Helfer (PlaceMeshes importiert diese Datei; dessen Konstanten sind beim Laden noch nicht da).
const std = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const seasonal = (m: THREE.MeshStandardMaterial, bias = 0) => {
  m.onBeforeCompile = (shader) => injectSeason(shader, { snowBias: bias });
  return m;
};

const W = {
  rock: texturize(seasonal(std(0x6e6c62, { roughness: 0.95 }), 0.1), 'mossyRock', 0.6),
  rockDark: texturize(std(0x4e4c45, { roughness: 0.95 }), 'rockFace', 0.5),
  rockGrey: texturize(seasonal(std(0x5f5d56, { roughness: 0.95 }), 0.1), 'rockFace', 0.5),
  rockWet: texturize(std(0x34342f, { roughness: 0.25, metalness: 0.1 }), 'rockFace', 0.5),
  moss: texturize(seasonal(std(0x4a5a2e, { roughness: 1 }), 0.3), 'mossyRock', 0.6),
  bark: texturize(std(0x8f8a80, { roughness: 1 }), 'bark', 0.5),
  myceliumBark: texturize(std(0xd8d4c8, { roughness: 1, emissive: new THREE.Color(0x4ac8b8), emissiveIntensity: 0.04 }), 'bark', 0.35),
  bracket: std(0xd9b884, { roughness: 0.8 }),
  stem: std(0xe6e0cc, { roughness: 0.9 }),
  steel: std(0x6a6e70, { metalness: 0.55, roughness: 0.5 }),
  steelDark: std(0x3e4245, { metalness: 0.6, roughness: 0.55 }),
  rustHull: std(0x5a3426, { roughness: 0.9, metalness: 0.25 }),
  hullBlue: std(0x2f4656, { roughness: 0.75, metalness: 0.2 }),
  hullWhite: std(0xb8b4a8, { roughness: 0.7 }),
  redPaint: std(0x8c2b25, { roughness: 0.6 }),
  wood: texturize(seasonal(std(0x7d6a52)), 'planks', 0.5),
  woodDark: texturize(std(0x4e4032), 'planks', 0.5),
  stone: texturize(seasonal(std(0x8a867c)), 'plaster', 0.5),
  roof: texturize(std(0x4a3a34, { roughness: 0.9 }), 'asphalt', 0.4),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fb8c0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25 }),
  sail: std(0xb9b09a, { roughness: 1, side: THREE.DoubleSide }),
  lily: std(0x3d5a2a, { roughness: 0.7, side: THREE.DoubleSide }),
  flower: std(0xf0ece0, { roughness: 0.7, emissive: new THREE.Color(0xfff2d8), emissiveIntensity: 0.1 }),
  flag: std(0xa0281e, { roughness: 0.8, side: THREE.DoubleSide }),
  bronze: std(0x7a5a2a, { metalness: 0.7, roughness: 0.4 }),
};

/** Nur Position und Normale, nicht indiziert – damit sich verschiedene Formen verschmelzen lassen. */
function plain(g: THREE.BufferGeometry, keepUv = false): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  for (const key of Object.keys(n.attributes)) if (key !== 'position' && key !== 'normal' && !(keepUv && key === 'uv')) n.deleteAttribute(key);
  if (!n.getAttribute('normal')) n.computeVertexNormals();
  return n;
}

/** Unregelmäßiger Felsbrocken: Ikosaeder mit verwackelten Ecken, flach gedrückt. */
function boulder(size: number, rng: () => number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(size, 1);
  const p = geo.getAttribute('position');
  // Gleiche Ecken (mehrfach vorhanden) gleich verschieben, sonst reißt die Fläche auf.
  const moved = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let d = moved.get(key);
    if (!d) moved.set(key, (d = [1 + (rng() - 0.5) * 0.35, 1 + (rng() - 0.5) * 0.35, 1 + (rng() - 0.5) * 0.35]));
    p.setXYZ(i, p.getX(i) * d[0] * 1.25, p.getY(i) * d[1] * 0.7, p.getZ(i) * d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Viele kleine Teile (Pilze, Seerosen …) als ein Mesh. */
class Batch {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  /** keepUv: Texturkoordinaten behalten (für Alpha-Maps), dann müssen alle Teile welche haben. */
  constructor(private readonly keepUv = false) {}
  add(g: THREE.BufferGeometry, pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): void {
    const p = plain(g.clone(), this.keepUv);
    this.m.compose(new THREE.Vector3(...pos), this.q.setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    p.applyMatrix4(this.m);
    this.parts.push(p);
  }
  build(b: Builder, mat: THREE.Material, shadow = false): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false)!;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    b.group.add(mesh);
    return mesh;
  }
}

/** Leuchtendes Material; registriert sich fürs Tag-/Nacht-Glühen. */
function glow(b: Builder, color: number, emissive: number, day: number, night: number, pulse?: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(emissive), emissiveIntensity: day, roughness: 0.6, ...extra });
  b.model.glows.push({ material: m, day, night, pulse });
  return m;
}

/**
 * Schwebende Teilchen (Sporen, Gischt, Nebel) – ein Points-Objekt, die Bewegung rechnet der Shader.
 * Jedes Teilchen kreist auf seiner eigenen Bahn und steigt (oder sinkt) in einer Schleife.
 */
function particles(
  b: Builder,
  o: {
    count: number;
    center: V3;
    radius: number;
    height: number;
    color: number;
    size: number;
    rise: number;
    sway: number;
    day: number;
    night: number;
    additive?: boolean;
    /** Teilchen sammeln sich zur Mitte (Gischt am Aufprall). */
    core?: number;
  },
): void {
  const pos = new Float32Array(o.count * 3);
  const seed = new Float32Array(o.count);
  for (let i = 0; i < o.count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = o.radius * Math.pow(Math.random(), o.core ?? 0.5);
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.random() * o.height;
    pos[i * 3 + 2] = Math.sin(a) * r;
    seed[i] = Math.random() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uTime = { value: 0 };
  const uOpacity = { value: o.day };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime,
      uOpacity,
      uColor: { value: new THREE.Color(o.color) },
      uSize: { value: o.size },
      uRise: { value: o.rise },
      uHeight: { value: o.height },
      uSway: { value: o.sway },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uSize, uRise, uHeight, uSway;
      varying float vFade;
      void main() {
        vec3 p = position;
        float h = mod(p.y + uTime * uRise * (0.6 + 0.4 * fract(aSeed * 0.37)), uHeight);
        p.y = h;
        p.x += sin(uTime * 0.4 + aSeed) * uSway;
        p.z += cos(uTime * 0.33 + aSeed * 1.7) * uSway;
        // Ein- und Ausblenden an den Enden der Schleife, ferne Teilchen leiser.
        vFade = smoothstep(0.0, 0.15, h / uHeight) * (1.0 - smoothstep(0.75, 1.0, h / uHeight));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFade *= 1.0 - smoothstep(60.0, 140.0, -mv.z);
        gl_PointSize = uSize * (0.6 + 0.8 * fract(aSeed * 0.13)) * (300.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uColor, a * a * vFade * uOpacity);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.position.copy(b.point(o.center));
  pts.frustumCulled = false;
  b.group.add(pts);
  b.model.clocks.push(uTime);
  b.model.fades.push({ uniform: uOpacity, day: o.day, night: o.night });
}

/** Fließendes Wasser: Schlieren, die über die Fläche laufen (Wasserfall, Bach). */
function waterMaterial(b: Builder, speed: number, opacity: number): THREE.ShaderMaterial {
  const uTime = { value: 0 };
  b.model.clocks.push(uTime);
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime, uSpeed: { value: speed }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uSpeed, uOpacity;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        vec2 p = vec2(vUv.x * 14.0, vUv.y * 3.0 + uTime * uSpeed);
        float n = noise(p) * 0.6 + noise(p * 2.3 + 7.0) * 0.4;
        float streak = smoothstep(0.35, 0.85, n);
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        vec3 col = mix(vec3(0.42, 0.55, 0.58), vec3(0.95, 0.97, 0.98), streak);
        // Unten (vUv.y nahe 0) schäumt es weiß auf.
        col = mix(col, vec3(1.0), smoothstep(0.12, 0.0, vUv.y) * 0.8);
        gl_FragColor = vec4(col, uOpacity * edge * (0.55 + 0.45 * streak));
      }`,
  });
}

/** Weicher, senkrechter Schleier als Canvas-Textur (Myzel-Gespinst). */
function veilTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  // Alpha-Maps lesen den Grünkanal: hell auf Schwarz zeichnen, nicht über Transparenz.
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 128;
    const w = 1 + Math.random() * 4;
    const top = Math.random() * 60;
    const len = 80 + Math.random() * 170;
    const grad = g.createLinearGradient(0, top, 0, top + len);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.2, `rgba(255,255,255,${0.25 + Math.random() * 0.4})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x, top, w, len);
  }
  return new THREE.CanvasTexture(c);
}

/** Runder, zum Rand weich auslaufender Fleck (Alpha-Map für leuchtenden Bodenbewuchs). */
function softDisc(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#e6e6e6');
  grad.addColorStop(0.5, '#737373');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Schild mit Aufschrift (wie an Wanderwegen). */
function plaque(text: string[], bg = '#4a3a28', fg = '#e8dcc0'): THREE.Mesh | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.lineWidth = 10;
  g.strokeRect(10, 10, 492, 236);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  text.forEach((t, i) => {
    g.font = i === 0 ? 'bold 58px Georgia, serif' : 'italic 34px Georgia, serif';
    g.fillText(t, 256, 128 + (i - (text.length - 1) / 2) * 70, 470);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  mesh.castShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Myzel-Hain
// ---------------------------------------------------------------------------

function buildGrove(b: Builder, rng: () => number): void {
  const g = b.ground;
  const caps = new Batch();
  const stems = new Batch();
  const brackets = new Batch();
  const patches = new Batch(true);
  const fuzz = new THREE.MeshStandardMaterial({
    color: 0xf0eee6,
    roughness: 1,
    transparent: true,
    opacity: 0.32,
    alphaMap: veilTexture(),
    side: THREE.DoubleSide,
    depthWrite: false,
    emissive: new THREE.Color(0x7de0d0),
    emissiveIntensity: 0.05,
  });
  b.model.glows.push({ material: fuzz, day: 0.05, night: 0.6, pulse: 0.5 });
  // Auch die Rinde unter dem Gespinst glimmt nachts schwach.
  b.model.glows.push({ material: W.myceliumBark, day: 0.03, night: 0.4, pulse: 0.45 });
  const capMat = glow(b, 0x9ff0e0, 0x3fe6d0, 0.35, 5.5, 0.9);
  const patchMat = glow(b, 0x3c5a52, 0x2fb8a8, 0.04, 1.4, 0.6, { transparent: true, opacity: 0.8, depthWrite: false, alphaMap: softDisc(), roughness: 1 });
  const fleshMat = glow(b, 0x5a2e2c, 0xff5a42, 0.08, 1.1, 1.15, { roughness: 0.35 });
  const strandMat = glow(b, 0xa8b8b0, 0x6fe8d8, 0.08, 1.6, 0.8, { roughness: 0.8 });

  const capGeo = new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const stemGeo = new THREE.CylinderGeometry(0.25, 0.32, 1, 6);
  const mushroom = (x: number, z: number, size: number) => {
    const y = g(x, z);
    const h = size * (1.2 + rng());
    stems.add(stemGeo, [x, y + h / 2, z], [rng() * 0.2, 0, rng() * 0.2], [size, h, size]);
    caps.add(capGeo, [x, y + h, z], [rng() * 0.25, rng() * 3, rng() * 0.25], [size * 1.1, size * 0.7, size * 1.1]);
  };

  // Tote Bäume unter Gespinst
  const trees: V3[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng() * 0.4;
    const r = 7 + rng() * 17;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = g(x, z);
    const h = 7 + rng() * 5;
    const lean: V3 = [(rng() - 0.5) * 0.25, 0, (rng() - 0.5) * 0.25];
    trees.push([x, y, z]);
    b.cyl(W.myceliumBark, 0.16, 0.42, h, [x, y + h / 2, z], lean, 8);
    // Gespinst wie ein zerrissener Strumpf um den unteren Stamm
    b.add(new THREE.CylinderGeometry(0.48, 0.7, h * 0.42, 10, 1, true), fuzz, [x, y + h * 0.21, z], lean, false);
    for (let k = 0; k < 3; k++) {
      const by = y + h * (0.45 + rng() * 0.4);
      const ba = rng() * Math.PI * 2;
      b.add(new THREE.CylinderGeometry(0.04, 0.1, 2 + rng() * 2), W.myceliumBark, [x + Math.cos(ba) * 0.8, by, z + Math.sin(ba) * 0.8], [Math.sin(ba) * 0.9, 0, -Math.cos(ba) * 0.9], false);
    }
    // Baumpilze in Stufen
    for (let k = 0; k < 4; k++) {
      const ba = rng() * Math.PI * 2;
      const r0 = 0.33 + rng() * 0.08;
      brackets.add(new THREE.CylinderGeometry(1, 1, 0.12, 10, 1, false, 0, Math.PI), [x + Math.cos(ba) * r0, y + 0.8 + k * 0.9 + rng() * 0.5, z + Math.sin(ba) * r0], [0, -ba + Math.PI / 2, 0], [0.35 + rng() * 0.25, 1, 0.35]);
    }
    // Leuchtpilze am Fuß
    for (let k = 0; k < 13; k++) {
      const ma = rng() * Math.PI * 2;
      const mr = 0.5 + rng() * 1.8;
      mushroom(x + Math.cos(ma) * mr, z + Math.sin(ma) * mr, 0.07 + rng() * 0.14);
    }
  }
  // Durchhängende Gespinstfäden zwischen benachbarten Stämmen (wie Spinnweben, nur dicker)
  const webs = new Batch();
  for (let i = 0; i < trees.length; i++) {
    const a = trees[i];
    const c = trees[(i + 1 + Math.floor(rng() * 2)) % trees.length];
    const d = Math.hypot(c[0] - a[0], c[2] - a[2]);
    if (d > 13) continue;
    for (let k = 0; k < 1 + Math.floor(rng() * 3); k++) {
      const ha = 2.5 + rng() * 4;
      const hc = 2.5 + rng() * 4;
      const sag = 0.8 + rng() * 1.8;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= 8; j++) {
        const u = j / 8;
        pts.push(new THREE.Vector3(a[0] + (c[0] - a[0]) * u, a[1] + ha + (c[1] + hc - a[1] - ha) * u - Math.sin(u * Math.PI) * sag, a[2] + (c[2] - a[2]) * u));
      }
      webs.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.012 + rng() * 0.02, 3), [0, 0, 0]);
    }
  }
  // Pilzteppich und leuchtende Flecken überall im Hain
  for (let i = 0; i < 170; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 24;
    mushroom(Math.cos(a) * r, Math.sin(a) * r, 0.05 + rng() * 0.12);
  }
  // Einige Riesenpilze, hüfthoch bis mannshoch
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const r = 4 + rng() * 14;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    mushroom(x, z, 0.4 + rng() * 0.35);
    b.collider([0.3, 1, 0.3], [x, g(x, z) + 1, z]);
  }
  const disc = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
  for (let i = 0; i < 36; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 25;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = 0.8 + rng() * 2.4;
    patches.add(disc, [x, g(x, z) + 0.04, z], [0, 0, 0], [s, 1, s * (0.5 + rng() * 0.5)]);
  }
  stems.build(b, W.stem);
  brackets.build(b, W.bracket, true);
  patches.build(b, patchMat);

  // Das Herz: ein fleischiger, glatter Klumpen unter einem Schleier aus Gespinst, mit leuchtenden Knoten.
  const heart = new THREE.SphereGeometry(1.6, 48, 32);
  const p = heart.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n =
      Math.sin(v.x * 2.1 + 0.3) * Math.sin(v.y * 1.7 + 1) * Math.sin(v.z * 2.3 + 2) * 0.18 +
      Math.sin(v.x * 5.3) * Math.sin(v.y * 4.9 + 2) * Math.sin(v.z * 5.1) * 0.06;
    v.multiplyScalar(1 + n + (v.y < 0 ? 0.12 : 0));
    v.y *= 0.82;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  heart.computeVertexNormals();
  const y0 = g(0, 0);
  b.add(heart, fleshMat, [0, y0 + 0.95, 0]);
  b.add(heart.clone().scale(1.1, 1.12, 1.1), fuzz, [0, y0 + 0.95, 0], [0, 0, 0], false);
  b.collider([1.6, 1.3, 1.6], [0, y0 + 1, 0]);
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const el = rng() * 1.1 - 0.2;
    const r = 1.55;
    caps.add(capGeo, [Math.cos(a) * Math.cos(el) * r, y0 + 0.95 + Math.sin(el) * r * 0.82, Math.sin(a) * Math.cos(el) * r], [rng(), rng() * 3, rng()], [0.1 + rng() * 0.1, 0.08, 0.1 + rng() * 0.1]);
  }
  // Feine Fäden vom Herzen zu den Bäumen, wellig über den Boden
  const tendrils = new Batch();
  for (let i = 0; i < 20; i++) {
    const t = trees[i % trees.length];
    const pts: THREE.Vector3[] = [];
    const side = rng() - 0.5;
    for (let k = 0; k <= 10; k++) {
      const u = k / 10;
      const wig = Math.sin(u * Math.PI * (2 + rng())) * side * 1.6 * Math.sin(u * Math.PI);
      const x = t[0] * u - (t[2] / Math.hypot(t[0], t[2])) * wig;
      const z = t[2] * u + (t[0] / Math.hypot(t[0], t[2])) * wig;
      pts.push(new THREE.Vector3(x, g(x, z) + 0.05 + Math.max(0, 1 - u * 3) * 0.7, z));
    }
    tendrils.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.02 + rng() * 0.025, 4), [0, 0, 0]);
  }
  tendrils.build(b, strandMat);
  webs.build(b, strandMat);
  caps.build(b, capMat);
  b.light([0, y0 + 2.6, 0], 0xff7a60, 14, 16, 'pulse');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const r = 9 + (i % 2) * 7;
    b.light([Math.cos(a) * r, g(Math.cos(a) * r, Math.sin(a) * r) + 1.2, Math.sin(a) * r], 0x5ff0d8, 13, 15, 'pulse');
  }
  // Sporen: schweben langsam aufwärts, nachts hell.
  particles(b, { count: 750, center: [0, y0, 0], radius: 24, height: 9, color: 0xbff8ec, size: 0.32, rise: 0.25, sway: 0.8, day: 0.3, night: 1, additive: true });

  // Was von der Forschergruppe übrig ist: eingesponnenes Zelt, Kiste, Notizbuch.
  const cx = 9;
  const cz = -6;
  const cy = g(cx, cz);
  b.add(new THREE.ConeGeometry(1.4, 1.6, 4), M.fabric, [cx, cy + 0.8, cz], [0, 0.6, 0.25]);
  b.add(new THREE.ConeGeometry(1.55, 1.7, 4, 1, true), fuzz, [cx, cy + 0.85, cz], [0, 0.6, 0.25], false);
  b.collider([1.1, 0.8, 1.1], [cx, cy + 0.8, cz]);
  b.box(M.metal, [0.7, 0.45, 0.45], [cx - 2, cy + 0.22, cz + 1]);
  b.container('medbox', [cx - 2, cy + 0.5, cz + 1]);
  b.box(M.oldPlanks, [0.9, 0.6, 0.6], [cx + 1.8, cy + 0.3, cz + 1.6], [0, 0.4, 0]);
  b.container('crate', [cx + 1.8, cy + 0.65, cz + 1.6]);
  b.note('myzel', [cx - 1.2, cy + 0.05, cz + 2], 0.4);
  b.model.sounds.push({ position: new THREE.Vector3(0, y0 + 1.5, 0), loop: { freq: 90, q: 6, gain: 0.5, range: 40 } });
  b.model.sounds.push({ position: new THREE.Vector3(0, y0 + 2, 0), sound: 'whisper', every: [9, 20], volume: 0.7, when: 'night' });
}

// ---------------------------------------------------------------------------
// Wasserfall
// ---------------------------------------------------------------------------

function buildFalls(b: Builder, rng: () => number): void {
  const g = b.ground;
  // Wand finden: wo das Gelände vor uns ansteigt (Fuß) und wo es oben flach wird (Kante).
  let foot = 6;
  for (let z = 3; z < 14; z += 0.5) {
    if (g(0, z) > 1.2) {
      foot = z;
      break;
    }
  }
  let lipZ = foot + 4;
  let lipY = g(0, lipZ);
  for (let z = foot; z < foot + 14; z += 0.5) {
    const y = g(0, z);
    if (y > lipY) {
      lipY = y;
      lipZ = z;
    }
    if (g(0, z + 1.5) - y < 0.3 && y > 6) break;
  }
  const poolY = -0.35;

  // Felswand aus großen, unregelmäßigen Blöcken in Schichten (deckt die Geländestufe ab).
  const rockMats = [W.rock, W.rockDark, W.rockGrey];
  for (let x = -10; x <= 10; x += 1.9) {
    for (let z = foot - 1; z <= lipZ + 1; z += 1.7) {
      const gy = g(x, z);
      const s = 1.3 + rng() * 1.5;
      const wet = Math.abs(x) < 2.4 && z > foot - 0.5;
      // Flache, gestreckte Platten wie Gesteinsschichten
      b.add(boulder(s, rng), wet ? W.rockWet : rockMats[Math.floor(rng() * 3)], [x + (rng() - 0.5), gy + s * 0.1, z + (rng() - 0.5)], [rng() * 0.4, rng() * 3, rng() * 0.4]);
      if (!wet && rng() < 0.35) b.add(boulder(s * 0.55, rng), W.moss, [x + (rng() - 0.5), gy + s * 0.55, z], [0, rng() * 3, 0], false);
    }
  }
  // Größere Brocken an der Kante, links und rechts der Rinne
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const x = s * (2.6 + k * 1.8 + rng());
      const z = lipZ - 0.5 + rng();
      const r = 1.8 + rng() * 1.2;
      b.add(boulder(r, rng), W.rockGrey, [x, g(x, z) + r * 0.4, z], [rng() * 0.4, rng() * 3, 0]);
      b.collider([r * 0.7, r * 0.7, r * 0.7], [x, g(x, z) + r * 0.4, z]);
    }
  }
  // Steine ums Becken (begehbar), Trittsteine quer hindurch
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (Math.sin(a) > 0.6) continue; // zur Wand hin offen
    const r = 7 + rng() * 1.5;
    const s = 0.5 + rng() * 0.9;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    b.add(boulder(s, rng), rng() < 0.5 ? W.rock : W.moss, [x, g(x, z) + s * 0.3, z], [0, rng() * 3, 0]);
  }
  for (let k = -2; k <= 2; k++) b.box(W.rock, [0.9, 0.5, 0.8], [k * 1.4, -0.85 + 0.25 + 0.15 * (k % 2), -3.5 + Math.abs(k) * 0.2], [0, rng(), 0]);

  // Das Wasser: zwei Bänder (Kern und breiterer Schleier), oben ein Bach, unten das Becken.
  const fallSheet = (width: number, opacity: number, inset: number) => {
    const geo = new THREE.PlaneGeometry(width, 1, 1, 28);
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const bottomZ = foot - 1.6;
    for (let i = 0; i < pos.count; i++) {
      const t = 1 - uv.getY(i); // 0 oben, 1 unten
      const y = lipY + (poolY - lipY) * t;
      // Wirft sich über die Kante und fällt dann fast senkrecht.
      const z = lipZ - (lipZ - bottomZ) * Math.sqrt(t) - inset;
      pos.setXYZ(i, pos.getX(i), y, z);
    }
    geo.computeVertexNormals();
    b.add(geo, waterMaterial(b, 2.6, opacity), [0, 0, 0], [0, 0, 0], false);
  };
  fallSheet(4.2, 0.85, 0);
  fallSheet(5.8, 0.32, 0.25);
  // Bach über der Kante
  const stream = new THREE.PlaneGeometry(2.6, 9, 1, 12);
  const sp = stream.getAttribute('position');
  for (let i = 0; i < sp.count; i++) {
    const z = lipZ + 4.5 - sp.getY(i);
    sp.setXYZ(i, sp.getX(i), Math.max(g(sp.getX(i), z), lipY - 0.2) + 0.08, z);
  }
  stream.computeVertexNormals();
  b.add(stream, waterMaterial(b, 0.9, 0.7), [0, 0, 0], [0, 0, 0], false);
  // Becken: dunkles, glänzendes Wasser
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(7.6, 40).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1e3c3e, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.86 }),
  );
  pool.position.set(0, poolY, 0);
  pool.receiveShadow = true;
  b.group.add(pool);
  // Gischt am Aufprall und Sprühnebel, der aufsteigt und über das Becken zieht
  const impact: V3 = [0, poolY, foot - 1.4];
  particles(b, { count: 260, center: impact, radius: 2.2, height: 1.4, color: 0xffffff, size: 0.22, rise: 1.6, sway: 0.4, day: 0.7, night: 0.35, core: 0.8 });
  particles(b, { count: 120, center: impact, radius: 6, height: 7, color: 0xe6f0f2, size: 1.0, rise: 0.6, sway: 1.2, day: 0.1, night: 0.05 });
  // Regenbogen im Sprühnebel – nur bei Sonne
  const uOpacity = { value: 0.3 };
  const rainbow = new THREE.Mesh(
    new THREE.RingGeometry(7.2, 8.6, 64, 1, 0.15, Math.PI - 0.3),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uOpacity },
      vertexShader: /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec2 vP;
        vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
        void main() {
          float r = (length(vP) - 7.2) / 1.4;
          float a = smoothstep(0.0, 0.2, r) * smoothstep(1.0, 0.8, r);
          float ends = smoothstep(0.0, 4.0, vP.y) * (0.6 + 0.4 * smoothstep(-6.0, 6.0, vP.x));
          gl_FragColor = vec4(hue(0.8 - r * 0.8), a * ends * uOpacity);
        }`,
    }),
  );
  rainbow.position.copy(b.point([0, poolY + 0.4, foot - 3.5]));
  b.group.add(rainbow);
  b.model.fades.push({ uniform: uOpacity, day: 0.13, night: 0 });

  // Bank mit Blick auf den Fall, Wanderschild, eingeritztes Herz
  const bx = -4.5;
  const bz = -9.5;
  const by = g(bx, bz);
  b.box(W.wood, [1.8, 0.08, 0.45], [bx, by + 0.45, bz], [0, 0.35, 0]);
  b.box(W.wood, [1.8, 0.4, 0.06], [bx - 0.08, by + 0.75, bz - 0.22], [0.15, 0.35, 0]);
  for (const s of [-1, 1]) b.box(W.woodDark, [0.08, 0.45, 0.4], [bx + s * 0.75 * Math.cos(0.35), by + 0.22, bz - s * 0.75 * Math.sin(0.35)], [0, 0.35, 0], false);
  const sx = 3.5;
  const sz = -10;
  const sy = g(sx, sz);
  b.box(W.woodDark, [0.12, 1.6, 0.12], [sx, sy + 0.8, sz], [0, 0, 0]);
  const sign = plaque(['Der Weiße Schleier', `Fallhöhe ${Math.round(lipY - poolY)} m`]);
  if (sign) {
    sign.position.copy(b.point([sx, sy + 1.55, sz + 0.07]));
    b.group.add(sign);
  }
  b.note('schleier', [bx + 0.2, by + 0.5, bz], 0.3);
  b.model.sounds.push({ position: new THREE.Vector3(0, (lipY + poolY) / 2, foot), loop: { freq: 700, q: 0.4, gain: 0.9, range: 70 } });
}

// ---------------------------------------------------------------------------
// Schiffsfriedhof
// ---------------------------------------------------------------------------

/** Rumpf eines Schiffes als ausgezogene Silhouette (Bug spitz, Heck rund). */
function hullGeometry(len: number, beam: number, depth: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  // Draufsicht (x quer, y = Länge), dann in die Höhe ausgezogen
  s.moveTo(0, len / 2);
  s.quadraticCurveTo(beam / 2, len * 0.25, beam / 2, -len * 0.3);
  s.quadraticCurveTo(beam / 2, -len / 2, 0, -len / 2);
  s.quadraticCurveTo(-beam / 2, -len / 2, -beam / 2, -len * 0.3);
  s.quadraticCurveTo(-beam / 2, len * 0.25, 0, len / 2);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 8 });
  // Extrusion entlang +Z → nach oben drehen: Länge entlang Z, Höhe entlang Y.
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function buildWrecks(b: Builder, rng: () => number): void {
  // Kutter in Schräglage, halb abgesoffen (Kabine durchsuchbar)
  b.setFrame([-9, -1.0, -6], [0.05, 0.6, 0.32]);
  b.add(hullGeometry(12, 4, 3), W.hullBlue, [0, -1.6, 0]);
  b.collider([1.8, 1.5, 5.5], [0, -0.1, 0]);
  b.box(W.rustHull, [3.6, 0.15, 10.5], [0, 1.4, -0.3], [0, 0, 0], true);
  b.box(W.hullWhite, [2.4, 2.0, 2.6], [0, 2.4, -2.4]);
  b.box(M.glass, [2.42, 0.6, 2.62], [0, 2.95, -2.4], [0, 0, 0], false);
  b.box(W.rustHull, [2.6, 0.12, 2.8], [0, 3.45, -2.4], [0, 0, 0], false);
  b.container('locker', [0.6, 1.9, -2.4]);
  b.note('kutter', [-0.5, 2.05, -1.6], 0.3);
  b.cyl(W.steelDark, 0.08, 0.1, 7, [0, 4.6, 1.5], [0, 0, 0], 6, false);
  b.box(W.steelDark, [3.2, 0.08, 0.08], [0, 6.6, 1.5], [0, 0, 0], false);
  b.lantern([1.4, 6.4, 1.5]);
  // Netze hängen vom Ausleger ins Wasser
  b.add(new THREE.PlaneGeometry(2.4, 3.2), new THREE.MeshStandardMaterial({ color: 0x3a3a2e, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }), [-1.6, 2.6, 3.4], [0.2, 0.6, 0.1], false);
  b.setFrame(null);

  // Bug eines Frachters ragt steil aus dem Wasser
  b.setFrame([13, -5, -16], [0.55, -0.4, 0.12]);
  b.add(hullGeometry(26, 7.5, 9), W.rustHull, [0, -2, 0]);
  b.collider([3.4, 4.5, 11], [0, 2.5, 0]);
  b.box(W.rustHull, [7, 0.2, 14], [0, 7.05, 4]);
  for (let i = 0; i < 8; i++) b.box(W.steelDark, [0.12, 0.25, 0.4], [3.1, 6.2 - i * 0.9, 11.5 - i * 0.3], [0, 0, 0.3], false);
  const name = plaque(['NORDSTERN'], '#4a2a20', '#d8d0c0');
  if (name) {
    name.scale.set(2.6, 1.3, 1);
    name.position.copy(b.point([3.76, 4.5, 8]));
    name.quaternion.setFromEuler(new THREE.Euler(0.55, -0.4 + Math.PI / 2, 0.12));
    b.group.add(name);
  }
  b.container('crate', [0, 7.4, 3]);
  b.setFrame(null);

  // Segelboot auf der Seite, Mast schräg, Segel in Fetzen
  b.setFrame([-14, -0.6, 12], [0, 1.9, 1.2]);
  b.add(hullGeometry(7, 2.4, 1.4), W.hullWhite, [0, -0.7, 0]);
  b.collider([1.0, 0.7, 3.4], [0, 0, 0]);
  b.cyl(W.steel, 0.05, 0.06, 7, [0, 3.8, 0.6], [0, 0, 0], 6, false);
  b.add(new THREE.PlaneGeometry(2.6, 4.6), W.sail, [1.2, 3.6, 0.4], [0, Math.PI / 2, 0.05], false);
  b.setFrame(null);

  // Glockenboje, die auf den Wellen schaukelt
  const buoy = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    buoy.add(m);
  };
  add(new THREE.CylinderGeometry(0.9, 1.1, 1.2, 12), W.redPaint, 0);
  add(new THREE.CylinderGeometry(0.95, 0.95, 0.3, 12), std(0x1c1c1c), 0.55);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2), W.steelDark);
    leg.position.set(Math.cos(a) * 0.55, 1.7, Math.sin(a) * 0.55);
    leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
    buoy.add(leg);
  }
  add(new THREE.CylinderGeometry(0.15, 0.35, 0.45, 10), W.bronze, 2.3);
  const at = b.point([3, 0, -20]);
  buoy.position.copy(at);
  b.group.add(buoy);
  b.model.bobbers.push({ object: buoy, base: at.clone(), amp: 0.25, speed: 1.1, roll: 0.14 });
  b.model.sounds.push({ position: at.clone().setY(2.3), sound: 'buoy', every: [5, 11], volume: 0.9 });

  // Reste eines Stegs, Ruderboot kieloben am Strand, Fässer, Reusen
  for (let i = 0; i < 9; i++) {
    const z = 8 + i * 2.4;
    for (const s of [-1, 1]) if (rng() < 0.8) b.cyl(W.woodDark, 0.12, 0.14, 4 + rng(), [6 + s * 1.1, -1.2 + rng() * 0.6, z], [rng() * 0.2, 0, rng() * 0.2], 6, false);
    if (rng() < 0.4 && i > 3) b.box(W.wood, [2.6, 0.08, 0.3], [6, 0.6 + rng() * 0.2, z], [0, 0, (rng() - 0.5) * 0.3], false);
  }
  const shore = 26;
  b.add(hullGeometry(4, 1.4, 0.7), W.wood, [-3, b.ground(-3, shore) + 0.75, shore], [Math.PI, 0.7, 0]);
  b.collider([0.7, 0.4, 2], [-3, b.ground(-3, shore) + 0.4, shore], [0, 0.7, 0]);
  for (let i = 0; i < 4; i++) {
    const x = 1 + i * 1.1 + rng();
    const z = shore - 1 + rng() * 2;
    b.cyl(i % 2 ? W.rustHull : W.redPaint, 0.32, 0.32, 0.9, [x, b.ground(x, z) + 0.3, z], [Math.PI / 2 * (i % 2), rng() * 3, 0], 10);
  }
  // Nebel über der Bucht
  particles(b, { count: 140, center: [0, 0.2, -4], radius: 38, height: 3, color: 0xc8ccc8, size: 9, rise: 0.04, sway: 4, day: 0.16, night: 0.28 });
}

// ---------------------------------------------------------------------------
// Feuerwachturm
// ---------------------------------------------------------------------------

function buildTower(b: Builder, rng: () => number): void {
  const H = 14;
  const L = 2.2;
  // Beine und Streben
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.box(W.steel, [0.22, H + 0.4, 0.22], [sx * (L + 0.15), H / 2, sz * (L + 0.15)], [sz * 0.02, 0, -sx * 0.02]);
  }
  const brace = Math.hypot(2 * L, 3.5);
  const ang = Math.atan2(3.5, 2 * L);
  for (let y = 0; y < H - 1; y += 3.5) {
    for (const s of [-1, 1]) {
      b.box(W.steelDark, [brace, 0.1, 0.1], [0, y + 1.75, s * L], [0, 0, s > 0 ? ang : -ang], false);
      b.box(W.steelDark, [0.1, 0.1, brace], [s * L, y + 1.75, 0], [s > 0 ? -ang : ang, 0, 0], false);
    }
    b.box(W.steelDark, [2 * L, 0.1, 0.1], [0, y + 3.5, L], [0, 0, 0], false);
  }
  // Treppen im Zickzack auf der Vorderseite (+Z), außen am Turm
  const flights = 4;
  const rise = H / flights;
  const run = 6.8;
  const slope = Math.atan2(rise, run);
  // Podesttreppe: die Läufe liegen nebeneinander (innen hinauf, außen zurück), nie übereinander.
  for (let k = 0; k < flights; k++) {
    const dir = k % 2 === 0 ? 1 : -1;
    const zc = k % 2 === 0 ? 4.8 : 6.1;
    const y0 = k * rise;
    for (let i = 0; i < 12; i++) {
      const u = (i + 0.5) / 12;
      b.box(W.steelDark, [0.5, 0.05, 1.2], [dir * (-run / 2 + run * u), y0 + rise * u, zc], [0, 0, 0], false);
    }
    b.box(W.steel, [run + 0.4, 0.12, 1.25], [0, y0 + rise / 2 - 0.08, zc], [0, 0, dir * slope], true, false);
    // Geländer außen (am äußeren Lauf)
    if (k % 2 === 1) b.box(W.steel, [run, 0.06, 0.06], [0, y0 + rise / 2 + 1, zc + 0.62], [0, 0, dir * slope], false);
    // Podest am Ende: über beide Läufe, das oberste reicht bis an den Umlauf.
    const ex = dir * (run / 2 + 0.6);
    b.box(W.steelDark, [1.2, 0.12, 2.9], [ex, y0 + rise - 0.06, 5.3]);
    b.box(W.steel, [0.1, rise + 0.2, 0.1], [ex + dir * 0.55, y0 + rise / 2, 6.7], [0, 0, 0], false);
  }
  // Umlauf und Kanzel oben
  const top = H;
  const C = 2.2;
  const O = 4.1;
  b.box(W.woodDark, [2 * O, 0.16, 2 * O], [0, top - 0.08, 0]);
  for (const s of [-1, 1]) {
    // Geländer (Kollision), vorn mit Lücke für die Treppe
    b.box(W.steel, [2 * O, 1.0, 0.06], [0, top + 0.5, -s * O], [0, 0, 0], s > 0);
    b.box(W.steel, [0.06, 1.0, 2 * O], [s * O, top + 0.5, 0]);
  }
  b.box(W.steel, [2 * O - 1.8, 1.0, 0.06], [0.9, top + 0.5, O]);
  // Kanzel: Brüstung, Fensterband, Pfosten, Dach
  b.box(W.wood, [2 * C, 1.0, 0.12], [0, top + 0.5, -C]);
  for (const s of [-1, 1]) {
    b.box(W.wood, [0.12, 1.0, 2 * C], [s * C, top + 0.5, 0]);
    b.box(W.glass, [2 * C, 1.2, 0.05], [0, top + 1.6, s * C], [0, 0, 0], false);
    b.box(W.glass, [0.05, 1.2, 2 * C], [s * C, top + 1.6, 0], [0, 0, 0], false);
  }
  // Tür in der Vorderwand
  b.box(W.wood, [1.4, 1.0, 0.12], [-1.4, top + 0.5, C]);
  b.box(W.wood, [1.4, 1.0, 0.12], [1.4, top + 0.5, C]);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(W.woodDark, [0.14, 2.4, 0.14], [sx * C, top + 1.2, sz * C], [0, 0, 0], false);
  b.box(W.wood, [2 * C + 0.3, 0.12, 2 * C + 0.3], [0, top + 2.3, 0], [0, 0, 0], false);
  b.add(new THREE.ConeGeometry(C * 1.75, 1.6, 4), W.roof, [0, top + 3.1, 0], [0, Math.PI / 4, 0]);
  // Kartentisch mit Fernglas (benutzbar), Funkgerät, Logbuch, Lampe
  b.box(W.wood, [1.6, 0.08, 1.0], [0, top + 0.95, -1.3]);
  b.box(W.woodDark, [0.1, 0.9, 0.9], [-0.7, top + 0.45, -1.3], [0, 0, 0], false);
  b.box(W.woodDark, [0.1, 0.9, 0.9], [0.7, top + 0.45, -1.3], [0, 0, 0], false);
  b.cyl(std(0x2a2a2a), 0.05, 0.05, 0.22, [-0.2, top + 1.05, -1.3], [0, 0, Math.PI / 2], 8, false);
  b.cyl(std(0x2a2a2a), 0.05, 0.05, 0.22, [-0.2, top + 1.05, -1.15], [0, 0, Math.PI / 2], 8, false);
  b.use('lookout', [-0.2, top + 1.05, -1.25]);
  b.box(M.metal, [0.5, 0.3, 0.3], [0.5, top + 1.14, -1.55], [0, 0, 0], false);
  b.note('turm', [0.35, top + 1.0, -1.05], 0.2);
  b.box(M.oldPlanks, [0.8, 0.5, 0.5], [1.4, top + 0.25, 1.2]);
  b.container('desk', [1.4, top + 0.6, 1.2]);
  b.lantern([0, top + 2.15, 0]);
  // Fahne auf dem Dach, im Wind
  b.cyl(W.steel, 0.03, 0.03, 2, [0, top + 4.6, 0], [0, 0, 0], 6, false);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), W.flag);
  flag.geometry.translate(0.55, 0, 0);
  const fp = b.point([0, top + 5.3, 0]);
  flag.position.copy(fp);
  b.group.add(flag);
  b.model.bobbers.push({ object: flag, base: fp.clone(), amp: 0.02, speed: 3.5, roll: 0.25 });
  // Geräteschuppen am Fuß
  b.box(M.oldPlanks, [2.6, 2.2, 2.0], [-5.5, b.ground(-5.5, -4) + 1.1, -4]);
  b.box(M.rust, [2.9, 0.08, 2.3], [-5.5, b.ground(-5.5, -4) + 2.3, -4], [0.1, 0, 0], false);
  b.box(M.oldPlanks, [0.9, 0.6, 0.6], [-5.5, b.ground(-5.5, -2.6) + 0.3, -2.6]);
  b.container('crate', [-5.5, b.ground(-5.5, -2.6) + 0.65, -2.6]);
  b.model.sounds.push({ position: new THREE.Vector3(0, top + 2, 0), sound: 'creak', every: [6, 14], volume: 0.6 });
  void rng;
}

// ---------------------------------------------------------------------------
// Versunkenes Dorf
// ---------------------------------------------------------------------------

function buildDrowned(b: Builder, rng: () => number): void {
  const g = b.ground;
  // Ufer finden (+Z): erstes Stück über Wasser.
  let shore = 30;
  for (let z = 10; z < 44; z += 1) {
    if (g(0, z) > 0.4) {
      shore = z;
      break;
    }
  }
  // Kirchturm: Schaft, Glockenstuhl mit Licht, spitzer Helm mit Kreuz.
  const tx = -2;
  const tz = -4;
  const bottom = Math.min(g(tx, tz), -1) - 0.5;
  const shaft = 7.5 - bottom;
  b.box(W.stone, [3.6, shaft, 3.6], [tx, bottom + shaft / 2, tz]);
  b.box(std(0x2a2a24, { roughness: 1 }), [3.66, 0.6, 3.66], [tx, 0.15, tz], [0, 0, 0], false);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(W.stone, [0.6, 2.4, 0.6], [tx + sx * 1.5, 8.7, tz + sz * 1.5]);
  b.box(W.stone, [3.8, 0.3, 3.8], [tx, 10.05, tz]);
  b.add(new THREE.CylinderGeometry(0.3, 0.6, 0.8, 12, 1, true), W.bronze, [tx, 9.2, tz], [0, 0, 0], false);
  b.add(new THREE.ConeGeometry(2.7, 6, 4), W.roof, [tx, 13.2, tz], [0, Math.PI / 4, 0]);
  b.box(W.bronze, [0.1, 1.2, 0.1], [tx, 16.7, tz], [0, 0, 0], false);
  b.box(W.bronze, [0.6, 0.1, 0.1], [tx, 16.9, tz], [0, 0, 0], false);
  b.light([tx, 8.6, tz], 0xffb060, 6, 14, 'lamp');
  // Dächer, die knapp aus dem Wasser ragen
  const roofs: [number, number, number, number][] = [
    [8, -10, 0.4, 0.9],
    [-11, 2, -0.6, 0.5],
    [6, 6, 1.2, 0.2],
  ];
  for (const [x, z, yaw, above] of roofs) {
    b.setFrame([x, 0, z], [0, yaw, 0]);
    const depth = Math.min(g(x, z), -1.5);
    const wall = above - 1.6 - depth;
    b.box(W.stone, [6, wall, 5], [0, depth + wall / 2, 0], [0, 0, 0], false);
    for (const s of [-1, 1]) b.box(W.roof, [6.4, 0.16, 3.2], [0, above - 0.6, s * 1.3], [s * 0.62, 0, 0]);
    b.box(W.stone, [0.6, 1.4, 0.6], [1.6, above + 0.2, 0.6]);
    // Fenster unter Wasser, nachts schwach erleuchtet
    b.box(glow(b, 0x203038, 0x60c0ff, 0, 1.4), [1.0, 0.8, 0.05], [-1.4, above - 2.6, 2.53], [0, 0, 0], false);
    b.setFrame(null);
    b.light(b.point([x, -1.6, z]).toArray() as V3, 0x60b8ff, 3, 8, 'flicker');
  }
  // Tote Bäume im Wasser
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const r = 9 + rng() * 14;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (z > shore - 4) continue;
    const h = 5 + rng() * 4;
    b.cyl(M.oldPlanks, 0.12, 0.3, h - g(x, z), [x, (h + g(x, z)) / 2, z], [(rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3], 7, false);
    for (let k = 0; k < 2; k++) b.add(new THREE.CylinderGeometry(0.03, 0.08, 1.8), M.oldPlanks, [x + (rng() - 0.5), h - 1 - k, z + (rng() - 0.5)], [rng() - 0.5, 0, rng() + 0.4], false);
  }
  // Steg vom Ufer in den See, am Ende ein Ruderboot
  const end = shore - 13;
  for (let z = end; z <= shore + 1; z += 2) {
    for (const s of [-1, 1]) b.cyl(W.woodDark, 0.1, 0.12, 3, [s * 0.8, -1, z], [0, 0, 0], 6, false);
  }
  b.box(W.wood, [1.8, 0.12, shore + 2 - end], [0, 0.55, (shore + 1 + end) / 2]);
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(hullGeometry(3.6, 1.3, 0.6), W.wood);
  hull.position.y = -0.3;
  hull.castShadow = true;
  boat.add(hull);
  for (const s of [-1, 1]) {
    const oar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 2.2), W.woodDark);
    oar.position.set(s * 0.5, 0.3, 0);
    oar.rotation.set(0, s * 0.2, 0);
    boat.add(oar);
  }
  const bp = b.point([1.8, 0.05, end + 1]);
  boat.position.copy(bp);
  boat.rotation.y = 0.2;
  b.group.add(boat);
  b.model.bobbers.push({ object: boat, base: bp.clone(), amp: 0.05, speed: 0.9, roll: 0.04 });
  b.note('tiefensee', [1.8, 0.35, end + 1.6], 0.2);
  b.box(M.oldPlanks, [0.7, 0.45, 0.45], [-0.4, 0.83, shore - 2]);
  b.container('crate', [-0.4, 1.1, shore - 2]);
  const sign = plaque(['Tiefensee', 'Baden verboten'], '#d8d0b8', '#5a1a14');
  if (sign) {
    const sy = g(2, shore + 2.5);
    b.box(W.woodDark, [0.1, 1.5, 0.1], [2, sy + 0.75, shore + 2.5], [0, 0, 0.1]);
    sign.position.copy(b.point([2, sy + 1.45, shore + 2.44]));
    sign.rotation.set(0, Math.PI, 0.1);
    b.group.add(sign);
  }
  // Seerosen in Ufernähe
  const pads = new Batch();
  const flowers = new Batch();
  const disc = new THREE.CircleGeometry(0.35, 9, 0.3, Math.PI * 2 - 0.3).rotateX(-Math.PI / 2);
  for (let i = 0; i < 70; i++) {
    const x = (rng() - 0.5) * 30;
    const z = shore - 3 - rng() * 12;
    if (Math.abs(x) < 1.5) continue;
    const s = 0.7 + rng() * 0.8;
    pads.add(disc, [x, 0.03, z], [0, rng() * 6, 0], [s, 1, s]);
    if (rng() < 0.15) flowers.add(new THREE.ConeGeometry(0.1, 0.12, 6), [x, 0.09, z]);
  }
  pads.build(b, W.lily);
  flowers.build(b, W.flower);
  // Nebel über dem See
  particles(b, { count: 120, center: [0, 0.1, -2], radius: 30, height: 2.5, color: 0xd0d4d0, size: 8, rise: 0.03, sway: 3, day: 0.12, night: 0.3 });
  b.model.sounds.push({ position: new THREE.Vector3(tx, 9, tz), sound: 'bell', every: [40, 80], volume: 0.35, when: 'night' });
}

/** Einstieg aus `buildPlace`. */
export function buildWonder(kind: PlaceKind, b: Builder, rng: () => number): void {
  if (kind === 'grove') buildGrove(b, rng);
  else if (kind === 'falls') buildFalls(b, rng);
  else if (kind === 'wrecks') buildWrecks(b, rng);
  else if (kind === 'tower') buildTower(b, rng);
  else if (kind === 'drowned') buildDrowned(b, rng);
}
