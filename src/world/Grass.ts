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

/** Ein Büschel aus drei sich kreuzenden, gebogenen Halmen (Ursprung am Boden). */
function createClumpGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const heights: number[] = [];
  const H = 0.5;
  const W = 0.045;
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const lean = 0.06 * (b - 1);
    // Halm: unten breit, Mitte, Spitze – 3 Dreiecke
    const p = (sx: number, y: number) => [sx * W * cx + lean * y, y * H, sx * W * cz + lean * y * 0.5];
    const v = [p(-1, 0), p(1, 0), p(-0.7, 0.5), p(0.7, 0.5), p(0, 1)];
    const tris = [
      [0, 1, 2],
      [1, 3, 2],
      [2, 3, 4],
    ];
    for (const t of tris) {
      for (const i of t) {
        positions.push(...v[i]);
        heights.push(v[i][1] / H);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Alle Normalen nach oben (der Shader setzt sie ohnehin) – wird nur für das Attribut-Layout gebraucht.
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('aHeight', new THREE.Float32BufferAttribute(heights, 1));
  return g;
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
    this.spacing = opts.spacing ?? 0.55;

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
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 2));
    geometry.instanceCount = this.count;
    // Riesige Bounding-Sphere: Positionen entstehen erst im Shader.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = {
      uTime: { value: 0 },
      uWindAmp: { value: 1 },
      uGrassTint: { value: new THREE.Color(1, 1, 1) },
      uGrassSnow: { value: 0 },
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

    const material = new THREE.MeshLambertMaterial({ color: 0x4d6a2b, side: THREE.DoubleSide });
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
varying float vGrassH;
varying float vGrassR;

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
float size = (0.55 + 0.9 * r2) * step(r1, density) * fade * (1.0 - 0.55 * uGrassSnow);

// Zufällige Drehung um Y
float ang = r1 * 6.2831;
vec3 p = position;
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
        .replace('#include <common>', '#include <common>\nvarying float vGrassH;\nvarying float vGrassR;\nuniform vec3 uGrassTint;\nuniform float uGrassSnow;')
        // Beide Halmseiten wie die Oberseite beleuchten (kein Umdrehen der Normale für Rückseiten).
        .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\nvec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
// Dunkler Grund, hellere Spitzen, etwas Farbvariation (frisch ↔ trocken)
diffuseColor.rgb *= mix(0.45, 1.15, vGrassH);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.1, 0.7), smoothstep(0.75, 1.0, vGrassR) * 0.6);
// Jahreszeit: Herbst gelblich, Frühling frisch; Schnee auf den Spitzen
diffuseColor.rgb *= uGrassTint;
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
