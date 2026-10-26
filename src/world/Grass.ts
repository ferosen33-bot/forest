import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import type { HeightMap } from './HeightMap';
import { deriveSeed, mulberry32 } from '../utils/random';
import { smoothstep } from '../utils/math';

export interface GrassOptions {
  seed: number;
  /** Radius um den Spieler, in dem Gras gezeichnet wird (m). */
  radius?: number;
  /** Rasterabstand der Grasbüschel (m). */
  spacing?: number;
  /** Zusätzlicher Dichte-Faktor 0..1 je Weltposition (z. B. kein Gras auf Straßen und unter Häusern). */
  density?: (x: number, z: number) => number;
}

/**
 * Gras-Dichte je Höhenkarten-Sample in [0, 1]: kein Gras am Strand, unter Wasser,
 * an steilen Hängen und im Gebirge; dazwischen Flecken unterschiedlicher Dichte.
 * (Reine Funktion – wird getestet und befüllt die Masken-Textur.)
 */
export function grassDensity(hm: HeightMap, ix: number, iz: number, noise: (x: number, z: number) => number): number {
  const h = hm.getSample(ix, iz);
  const n: [number, number, number] = [0, 1, 0];
  hm.normalAtSample(ix, iz, n);
  const x = ix * hm.cellSize - hm.half;
  const z = iz * hm.cellSize - hm.half;
  const dry = smoothstep(hm.waterLevel + 1.6, hm.waterLevel + 2.8, h);
  const flat = 1 - smoothstep(0.22, 0.34, 1 - n[1]);
  const low = 1 - smoothstep(36, 44, h);
  const patches = smoothstep(-0.55, 0.35, noise(x * 0.035, z * 0.035) * 0.75 + noise(x * 0.12, z * 0.12) * 0.25);
  return dry * flat * low * (0.25 + 0.75 * patches);
}

/**
 * Ein Büschel aus zwei gekreuzten Karten (Ursprung am Boden, Breite 1, Höhe 1). Darauf liegt ein
 * fotografiertes Grasbüschel (Poly Haven „Grass Medium 01“, CC0); Breite und Bildausschnitt
 * wählt der Shader je Büschel.
 */
function createClumpGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const heights: number[] = [];
  for (let c = 0; c < 2; c++) {
    const a = (c / 2) * Math.PI + 0.35;
    const dx = Math.cos(a) * 0.5;
    const dz = Math.sin(a) * 0.5;
    const quad = [
      [-dx, 0, -dz, 0, 0],
      [dx, 0, dz, 1, 0],
      [dx, 1, dz, 1, 1],
      [-dx, 1, -dz, 0, 1],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [x, y, z, u, v] = quad[i];
      positions.push(x, y, z);
      uvs.push(u, v);
      heights.push(y);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Alle Normalen nach oben (der Shader setzt sie ohnehin) – wird nur für das Attribut-Layout gebraucht.
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aHeight', new THREE.Float32BufferAttribute(heights, 1));
  return g;
}

/** Ausschnitte der Büschel im Atlas: u0, v0, u1, v1, Seitenverhältnis (Breite / Höhe). */
const CLUMPS: [number, number, number, number, number][] = [
  [0.0029, 0.0234, 0.1797, 0.6289, 2.3355],
  [0.1826, 0.0234, 0.3477, 0.4219, 3.3137],
  [0.3506, 0.0234, 0.439, 0.5391, 1.3712],
  [0.4419, 0.0234, 0.5483, 0.5625, 1.5797],
  [0.5513, 0.0234, 0.6821, 0.4414, 2.5047],
];

function grassTexture(file: string): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/grass/${file}`);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * GPU-Gras: ein festes Raster von Büscheln wandert (auf das Raster eingerastet) mit dem Spieler mit.
 * Der Vertex-Shader bestimmt pro Büschel Weltposition, Bodenhöhe (aus einer Höhen-Textur, mit
 * derselben Dreiecksinterpolation wie die Kollision), Dichte (Masken-Textur), Zufallsgröße und
 * -drehung, Wind und das Wegbiegen um den Spieler. → Ein Draw Call, keine CPU-Arbeit pro Frame.
 */
export class Grass {
  readonly mesh: THREE.Mesh;
  readonly count: number;
  readonly maxRadius: number;
  /** Quadrierter Abstand jedes Büschels zur Mitte (aufsteigend). */
  private readonly radiusSq: number[];
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly uniforms;
  private readonly spacing: number;

  constructor(hm: HeightMap, opts: GrassOptions) {
    const radius = opts.radius ?? 36;
    this.spacing = opts.spacing ?? 0.7;

    // Höhen-Textur (Float, Nearest – im Shader wird selbst interpoliert)
    const heightTex = new THREE.DataTexture(hm.heights, hm.samples, hm.samples, THREE.RedFormat, THREE.FloatType);
    heightTex.needsUpdate = true;

    // Dichte-Maske (8 Bit, linear gefiltert für weiche Übergänge)
    const noise = createNoise2D(mulberry32(deriveSeed(opts.seed, 'grass')));
    const mask = new Uint8Array(hm.samples * hm.samples);
    for (let iz = 0; iz < hm.samples; iz++) {
      for (let ix = 0; ix < hm.samples; ix++) {
        const extra = opts.density ? opts.density(ix * hm.cellSize - hm.half, iz * hm.cellSize - hm.half) : 1;
        mask[iz * hm.samples + ix] = Math.round(grassDensity(hm, ix, iz, noise) * extra * 255);
      }
    }
    const maskTex = new THREE.DataTexture(mask, hm.samples, hm.samples, THREE.RedFormat, THREE.UnsignedByteType);
    maskTex.magFilter = THREE.LinearFilter;
    maskTex.minFilter = THREE.LinearFilter;
    maskTex.needsUpdate = true;

    // Instanz-Raster um den Ursprung (lokal), kreisförmig beschnitten und von innen nach außen
    // sortiert: Ein kleinerer Radius (Grafikstufe) zeichnet einfach nur die ersten N Büschel.
    const cells: [number, number][] = [];
    const n = Math.ceil(radius / this.spacing);
    for (let z = -n; z <= n; z++) {
      for (let x = -n; x <= n; x++) {
        if (x * x + z * z <= n * n) cells.push([x, z]);
      }
    }
    cells.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
    this.radiusSq = cells.map(([x, z]) => (x * x + z * z) * this.spacing * this.spacing);
    const offsets = cells.flatMap(([x, z]) => [x * this.spacing, z * this.spacing]);
    this.count = cells.length;
    this.maxRadius = radius;

    const base = createClumpGeometry();
    const geometry = (this.geometry = new THREE.InstancedBufferGeometry());
    geometry.setAttribute('position', base.getAttribute('position'));
    geometry.setAttribute('normal', base.getAttribute('normal'));
    geometry.setAttribute('aHeight', base.getAttribute('aHeight'));
    geometry.setAttribute('uv', base.getAttribute('uv'));
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 2));
    geometry.instanceCount = this.count;
    // Riesige Bounding-Sphere: Positionen entstehen erst im Shader.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = {
      uTime: { value: 0 },
      uWindAmp: { value: 1 },
      uGrassTint: { value: new THREE.Color(1, 1, 1) },
      uGrassSnow: { value: 0 },
      uGrassDry: { value: 0 },
      uGrassGreen: { value: grassTexture('grass_green.png') },
      uGrassDryTex: { value: grassTexture('grass_dry.png') },
      uClumps: { value: CLUMPS.map((c) => new THREE.Vector4(c[0], c[1], c[2], c[3])) },
      uClumpAspect: { value: CLUMPS.map((c) => c[4]) },
      uCenter: { value: new THREE.Vector2() },
      uPlayer: { value: new THREE.Vector3() },
      uRadius: { value: radius },
      uSpacing: { value: this.spacing },
      uHeightTex: { value: heightTex },
      uMaskTex: { value: maskTex },
      uSamples: { value: hm.samples },
      uCellSize: { value: hm.cellSize },
      uHalf: { value: hm.half },
    };

    const material = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, alphaToCoverage: true });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec2 aOffset;
attribute float aHeight;
uniform float uTime, uRadius, uSpacing, uSamples, uCellSize, uHalf, uWindAmp, uGrassSnow;
uniform vec2 uCenter;
uniform vec3 uPlayer;
uniform sampler2D uHeightTex, uMaskTex;
uniform vec4 uClumps[${CLUMPS.length}];
uniform float uClumpAspect[${CLUMPS.length}];
varying float vGrassH;
varying float vGrassR;
varying vec2 vGrassUv;

float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Höhe wie HeightMap.heightAt(): Zelle entlang (x0,z1)–(x1,z0) geteilt.
float terrainHeight(vec2 xz) {
  vec2 g = clamp((xz + uHalf) / uCellSize, vec2(0.0), vec2(uSamples - 1.0));
  vec2 c = min(floor(g), vec2(uSamples - 2.0));
  vec2 f = g - c;
  ivec2 i = ivec2(c);
  float h00 = texelFetch(uHeightTex, i, 0).r;
  float h10 = texelFetch(uHeightTex, i + ivec2(1, 0), 0).r;
  float h01 = texelFetch(uHeightTex, i + ivec2(0, 1), 0).r;
  float h11 = texelFetch(uHeightTex, i + ivec2(1, 1), 0).r;
  if (f.x + f.y <= 1.0) return h00 + (h10 - h00) * f.x + (h01 - h00) * f.y;
  return h11 + (h01 - h11) * (1.0 - f.x) + (h10 - h11) * (1.0 - f.y);
}`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          // Weiche, terrainähnliche Beleuchtung statt flacher Halm-Normalen.
          'vec3 objectNormal = vec3(0.0, 1.0, 0.0);',
        )
        .replace(
          '#include <begin_vertex>',
          `vec2 cellWorld = uCenter + aOffset;            // auf das Raster eingerastet → weltfest
// Zufall aus ganzzahligem Zellindex: unabhängig von Rundungsfehlern beim Mitwandern.
vec2 cellIndex = floor(cellWorld / uSpacing + 0.5);
float r1 = gHash(cellIndex);
float r2 = gHash(cellIndex + 17.3);
vec2 worldXZ = cellWorld + (vec2(r1, r2) - 0.5) * uSpacing;
// Samplemitte i liegt bei UV (i + 0,5) / Samples
float density = texture2D(uMaskTex, ((worldXZ + uHalf) / uCellSize + 0.5) / uSamples).r;
float dist = length(worldXZ - uPlayer.xz);
float fade = 1.0 - smoothstep(uRadius * 0.65, uRadius, dist);
// Im Winter liegt Schnee: nur noch kurze Spitzen ragen heraus.
float size = (0.32 + 0.38 * r2) * step(r1, density) * fade * (1.0 - 0.55 * uGrassSnow);
// Bildausschnitt je Büschel; Breite nach dessen Seitenverhältnis
int clump = int(floor(gHash(cellIndex + 5.1) * ${CLUMPS.length}.0));
vec4 rect = uClumps[clump];
vGrassUv = mix(rect.xy, rect.zw, uv);

// Zufällige Drehung um Y
float ang = r1 * 6.2831;
vec3 p = position;
p.xz *= uClumpAspect[clump];
p.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p.xz;
p *= size;

// Wind: Spitzen schwingen in Böen
float bend = aHeight * aHeight;
float wind = sin(uTime * 1.6 + worldXZ.x * 0.32 + worldXZ.y * 0.21) + 0.5 * sin(uTime * 3.1 + worldXZ.y * 0.7);
p.x += wind * 0.07 * bend * size * uWindAmp;
p.z += wind * 0.035 * bend * size * uWindAmp;

// Spieler biegt das Gras beim Durchlaufen weg
vec2 away = worldXZ - uPlayer.xz;
float push = 1.0 - smoothstep(0.15, 1.0, length(away));
p.xz += normalize(away + 1e-4) * push * 0.32 * bend * size;
p.y *= 1.0 - push * 0.45;

vec3 transformed = vec3(worldXZ.x + p.x, terrainHeight(worldXZ) - 0.02 + p.y, worldXZ.y + p.z);
vGrassH = aHeight;
vGrassR = r2;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vGrassH;\nvarying float vGrassR;\nvarying vec2 vGrassUv;\nuniform vec3 uGrassTint;\nuniform float uGrassSnow, uGrassDry;\nuniform sampler2D uGrassGreen, uGrassDryTex;',
        )
        // Beide Halmseiten wie die Oberseite beleuchten (kein Umdrehen der Normale für Rückseiten).
        .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\nvec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
// Foto-Büschel: grün ↔ trocken (Herbst, Winter; einzelne Büschel auch im Sommer)
vec4 gGreen = texture2D(uGrassGreen, vGrassUv);
vec4 gDry = texture2D(uGrassDryTex, vGrassUv);
float dryness = clamp(uGrassDry + smoothstep(0.82, 1.0, vGrassR) * 0.5, 0.0, 1.0);
vec4 gTex = mix(gGreen, gDry, dryness);
// Weicher Rand über Alpha-to-Coverage (Mehrfachabtastung) statt hartem Ausschnitt: kein Flimmern.
float gCover = clamp((gTex.a - 0.45) / max(fwidth(gTex.a), 1e-4) + 0.5, 0.0, 1.0);
if (gCover <= 0.0) discard;
diffuseColor.a = gCover;
diffuseColor.rgb *= gTex.rgb;
// Dunkler Grund (Eigenschatten im Büschel), hellere Spitzen
diffuseColor.rgb *= mix(0.5, 1.05, vGrassH);
// Jahreszeit: leichter Farbstich (die Trockengras-Textur trägt den Großteil)
diffuseColor.rgb *= mix(vec3(1.0), uGrassTint, 0.25);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.91, 0.95), uGrassSnow * (0.35 + 0.65 * vGrassH));`,
        );
    };

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Grass';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  /** Gras-Radius ändern (Grafikstufe, 0 = aus); höchstens der beim Erzeugen gewählte Radius. */
  setRadius(radius: number): void {
    const r = Math.min(radius, this.maxRadius);
    const r2 = r * r;
    let count = 0;
    if (r > 0) while (count < this.radiusSq.length && this.radiusSq[count] <= r2) count++;
    this.geometry.instanceCount = count;
    this.uniforms.uRadius.value = Math.max(r, 0.01);
    this.mesh.visible = count > 0;
  }

  /** Jahreszeit: Farbfaktor und Schneebedeckung. */
  setSeason(tint: [number, number, number], snow: number): void {
    this.uniforms.uGrassTint.value.setRGB(...tint);
    this.uniforms.uGrassSnow.value = snow;
    // Herbstfärbung (viel Rot, wenig Blau) bzw. Schnee → trockenes Gras
    this.uniforms.uGrassDry.value = Math.max(Math.min(1, Math.max(0, (tint[0] - tint[2]) / 1.1)), snow);
  }

  /** Windstärke 0..1 */
  setWind(strength: number): void {
    this.uniforms.uWindAmp.value = 0.7 + 2.3 * strength;
  }

  update(elapsed: number, player: THREE.Vector3): void {
    const u = this.uniforms;
    u.uTime.value = elapsed;
    u.uPlayer.value.copy(player);
    // Mittelpunkt auf das Raster einrasten, damit Büschel nicht "schwimmen".
    u.uCenter.value.set(Math.round(player.x / this.spacing) * this.spacing, Math.round(player.z / this.spacing) * this.spacing);
  }
}
