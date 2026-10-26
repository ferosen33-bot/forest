import * as THREE from 'three';

/**
 * Feuer aus drei Teilen:
 * - **Flammen:** zur Kamera gedrehte Flächen, auf denen ein Shader aufsteigendes Rauschen zu züngelnden
 *   Flammen formt – weißgelber Kern, orange Zungen, rote, ausfransende Spitzen. Mehrere versetzte
 *   Flammen geben dem Feuer Tiefe.
 * - **Rauch:** weiche Schwaden steigen auf, wachsen, verwehen mit dem Wind und verblassen. Unten
 *   leuchten sie im Feuerschein orange, oben sind sie grau (tagsüber) bzw. fast schwarz (nachts).
 * - **Funken:** glühende Teilchen, die in die Höhe wirbeln und verglimmen; hin und wieder knackt das
 *   Holz und ein ganzer Schwarm stiebt auf.
 *
 * Alles läuft über instanzierte Flächen mit Billboard-Shadern. Das Licht kommt separat aus dem LightPool,
 * das Hitzeflimmern aus der Nachbearbeitung (siehe {@link FireEffect.heatSources}).
 */

export interface FireOptions {
  smoke?: boolean;
  sparks?: boolean;
  /** Hitzeflimmern in der Nachbearbeitung (nicht für die Fackel in der Hand). */
  heat?: boolean;
}

/** Für alle Feuer gemeinsam: Zeit, Umgebungshelligkeit, Wind. */
const shared = {
  uTime: { value: 0 },
  /** Helligkeit des Umgebungslichts (Rauchfarbe). */
  uAmbient: { value: new THREE.Color(0.5, 0.5, 0.5) },
};

const SMOKE = 14;
const SPARKS = 18;
const FLAMES = 4;

const billboardHead = /* glsl */ `
attribute vec3 aOffset;
attribute vec4 aData;
varying vec2 vUv;
varying vec4 vData;
varying float vHeight;
`;

/** Zylinder-Billboard (bleibt senkrecht) für Flammen. */
const flameVertex = /* glsl */ `
${billboardHead}
void main() {
  vUv = uv;
  vData = aData;
  float scale = length(modelMatrix[0].xyz);
  vec3 center = (modelMatrix * vec4(aOffset, 1.0)).xyz;
  vec3 toCam = cameraPosition - center;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  // aData: Breite, Höhe, Zufallswert, Phase
  vec3 world = center + right * position.x * aData.x * scale + vec3(0.0, 1.0, 0.0) * position.y * aData.y * scale;
  vHeight = position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

/** Kugel-Billboard (zeigt immer zur Kamera) für Rauch und Funken. */
const spriteVertex = /* glsl */ `
${billboardHead}
void main() {
  vUv = uv;
  vData = aData;
  float scale = length(modelMatrix[0].xyz);
  vec3 center = (modelMatrix * vec4(aOffset, 1.0)).xyz;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  // aData: Größe, Deckkraft, Drehung, Höhe über dem Feuer (relativ)
  float c = cos(aData.z), s = sin(aData.z);
  vec2 p = mat2(c, s, -s, c) * position.xy;
  vec3 world = center + (right * p.x + up * p.y) * aData.x * scale;
  vHeight = aData.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const noiseLib = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + 7.1;
    a *= 0.5;
  }
  return v;
}
`;

const flameFragment = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vData;
${noiseLib}
void main() {
  float seed = vData.z * 17.0;
  float t = uTime * (1.0 + vData.z * 0.4) + vData.w;
  vec2 uv = vUv;
  // Zungen: Rauschen strömt nach oben und verbiegt die Flamme seitlich, oben stärker.
  float n = fbm(vec2(uv.x * 2.6 + seed, uv.y * 1.8 - t * 2.4));
  float n2 = fbm(vec2(uv.x * 5.5 - seed, uv.y * 3.2 - t * 3.6));
  uv.x += (n - 0.5) * 0.55 * uv.y;
  float x = abs(uv.x - 0.5) * 2.0;
  // Tropfenform: breit am Fuß, spitz nach oben; oben zerreißen die Zungen.
  float width = (0.55 + 0.45 * smoothstep(0.0, 0.22, uv.y)) * pow(1.0 - uv.y, 0.75) * 0.95;
  float shape = 1.0 - smoothstep(width * 0.35, width, x);
  float f = shape * (1.05 - uv.y) * 1.25 - (1.0 - n2) * 0.75 * uv.y + (n - 0.5) * 0.3;
  f *= smoothstep(0.0, 0.08, vUv.y + (n2 - 0.5) * 0.06);
  f = clamp(f, 0.0, 1.0);
  // Farbverlauf eines Holzfeuers: dunkelrote Ränder, orange Zungen, gelber Kern.
  vec3 col = mix(vec3(0.5, 0.05, 0.0), vec3(1.0, 0.3, 0.03), smoothstep(0.05, 0.35, f));
  col = mix(col, vec3(1.0, 0.6, 0.15), smoothstep(0.35, 0.65, f));
  col = mix(col, vec3(1.0, 0.85, 0.5), smoothstep(0.7, 1.0, f));
  float a = smoothstep(0.04, 0.22, f);
  if (a <= 0.001) discard;
  gl_FragColor = vec4(col * a * (0.35 + 1.05 * f * f), 1.0);
}`;

const smokeFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uAmbient;
varying vec2 vUv;
varying vec4 vData;
varying float vHeight;
${noiseLib}
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  float puff = fbm(vUv * 2.6 + vData.z * 3.0 + vec2(0.0, -uTime * 0.15));
  float wisp = fbm(vUv * 5.0 - vData.z * 5.0 + vec2(uTime * 0.05, -uTime * 0.25));
  // Faserige Schwaden statt runder Bälle: Rauschen frisst den Rand an.
  float a = (1.0 - smoothstep(0.2, 1.0, r + (puff - 0.5) * 0.9)) * smoothstep(0.25, 0.75, wisp + 0.15) * vData.y;
  if (a <= 0.003) discard;
  // Unten vom Feuer angestrahlt, oben nur Umgebungslicht.
  vec3 glow = vec3(1.0, 0.42, 0.12) * 0.45 * exp(-vHeight * 2.6);
  vec3 col = uAmbient * (0.35 + 0.25 * puff) + glow;
  gl_FragColor = vec4(col, a);
}`;

const sparkFragment = /* glsl */ `
varying vec2 vUv;
varying vec4 vData;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float core = exp(-r * r * 12.0);
  if (core < 0.01) discard;
  vec3 col = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.85, 0.5), vData.y);
  gl_FragColor = vec4(col * core * vData.y * 4.0, 1.0);
}`;

function instancedQuad(count: number, pivotBottom: boolean): THREE.InstancedBufferGeometry {
  const plane = new THREE.PlaneGeometry(1, 1);
  if (pivotBottom) plane.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.getAttribute('position'));
  geo.setAttribute('uv', plane.getAttribute('uv'));
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aData', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage));
  geo.instanceCount = count;
  return geo;
}

function material(vertexShader: string, fragmentShader: string, additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: shared,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

const MATERIALS = {
  flame: material(flameVertex, flameFragment, true),
  smoke: material(spriteVertex, smokeFragment, false),
  spark: material(spriteVertex, sparkFragment, true),
};

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  rot: number;
  spin: number;
}

function newParticle(): Particle {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 1, size: 1, rot: 0, spin: 0 };
}

export class FireEffect {
  /** Wind (m/s, x/z in Weltrichtung) – verweht Rauch und Funken. Vom Spiel gesetzt. */
  static readonly wind = new THREE.Vector2(0.4, 0.15);
  /** Feuer, die in diesem Bild aktualisiert wurden und flimmern dürfen (siehe {@link beginFrame}). */
  static readonly heatSources: FireEffect[] = [];

  /** Gemeinsame Zeit und Umgebungslicht setzen und die Liste der Hitzequellen leeren (einmal pro Bild). */
  static beginFrame(time: number, ambient: THREE.Color): void {
    shared.uTime.value = time;
    shared.uAmbient.value.copy(ambient);
    FireEffect.heatSources.length = 0;
  }

  readonly object = new THREE.Group();
  /** Aktuelle Flacker-Intensität in ~[0.75, 1.15] – für das zugehörige Licht. */
  flicker = 1;
  private time = Math.random() * 100;
  private readonly flames: THREE.Mesh;
  private readonly smokeMesh: THREE.Mesh | null = null;
  private readonly sparkMesh: THREE.Mesh | null = null;
  private readonly smoke: Particle[] = [];
  private readonly sparks: Particle[] = [];
  private smokeTimer = 0;
  private sparkTimer = 0;
  private readonly heat: boolean;
  private readonly invScale = new THREE.Vector3();

  constructor(
    readonly size = 1,
    options: FireOptions = {},
  ) {
    const { smoke = true, sparks = true, heat = true } = options;
    this.heat = heat;
    this.object.name = 'Fire';

    const flameGeo = instancedQuad(FLAMES, true);
    const off = flameGeo.getAttribute('aOffset') as THREE.InstancedBufferAttribute;
    const data = flameGeo.getAttribute('aData') as THREE.InstancedBufferAttribute;
    // Eine große Hauptflamme, drei kleinere drumherum.
    for (let i = 0; i < FLAMES; i++) {
      const a = (i / (FLAMES - 1)) * Math.PI * 2 + Math.random();
      const r = i === 0 ? 0 : size * 0.16;
      const k = i === 0 ? 1 : 0.6 + Math.random() * 0.2;
      off.setXYZ(i, Math.cos(a) * r, 0, Math.sin(a) * r);
      data.setXYZW(i, size * 0.75 * k, size * 1.45 * k, Math.random(), Math.random() * 50);
    }
    this.flames = new THREE.Mesh(flameGeo, MATERIALS.flame);
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 3;
    this.object.add(this.flames);

    if (smoke) {
      for (let i = 0; i < SMOKE; i++) this.smoke.push(newParticle());
      this.smokeMesh = new THREE.Mesh(instancedQuad(SMOKE, false), MATERIALS.smoke);
      this.smokeMesh.frustumCulled = false;
      this.smokeMesh.renderOrder = 2;
      this.object.add(this.smokeMesh);
    }
    if (sparks) {
      for (let i = 0; i < SPARKS; i++) this.sparks.push(newParticle());
      this.sparkMesh = new THREE.Mesh(instancedQuad(SPARKS, false), MATERIALS.spark);
      this.sparkMesh.frustumCulled = false;
      this.sparkMesh.renderOrder = 4;
      this.object.add(this.sparkMesh);
    }
  }

  set visible(v: boolean) {
    this.object.visible = v;
  }

  get visible(): boolean {
    return this.object.visible;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.flicker = 0.95 + Math.sin(t * 9.1) * 0.08 + Math.sin(t * 23.7) * 0.05 + Math.sin(t * 4.3) * 0.07;
    if (!this.object.visible) return;
    if (this.heat) FireEffect.heatSources.push(this);
    // Wind wirkt in Weltrichtung; das Feuer selbst kann gedreht oder skaliert sein (Fackel, Brandherd).
    this.object.updateWorldMatrix(true, false);
    const e = this.object.matrixWorld.elements;
    const scale = Math.hypot(e[0], e[1], e[2]) || 1;
    this.invScale.set(FireEffect.wind.x, 0, FireEffect.wind.y).divideScalar(scale);
    if (this.smokeMesh) this.updateSmoke(dt);
    if (this.sparkMesh) this.updateSparks(dt);
  }

  private updateSmoke(dt: number): void {
    const s = this.size;
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.32 + Math.random() * 0.2;
      const p = this.smoke.find((q) => q.age >= q.life);
      if (p) {
        p.x = (Math.random() - 0.5) * s * 0.3;
        p.y = s * (0.9 + Math.random() * 0.4);
        p.z = (Math.random() - 0.5) * s * 0.3;
        p.vx = (Math.random() - 0.5) * 0.15;
        p.vy = 0.55 + s * 0.35 + Math.random() * 0.25;
        p.vz = (Math.random() - 0.5) * 0.15;
        p.age = 0;
        p.life = 3.8 + Math.random() * 1.8;
        p.size = s * (0.55 + Math.random() * 0.3);
        p.rot = Math.random() * Math.PI * 2;
        p.spin = (Math.random() - 0.5) * 0.6;
      }
    }
    const geo = this.smokeMesh!.geometry as THREE.InstancedBufferGeometry;
    const off = geo.getAttribute('aOffset') as THREE.InstancedBufferAttribute;
    const data = geo.getAttribute('aData') as THREE.InstancedBufferAttribute;
    const w = this.invScale;
    for (let i = 0; i < SMOKE; i++) {
      const p = this.smoke[i];
      if (p.age >= p.life) {
        data.setXYZW(i, 0, 0, 0, 0);
        continue;
      }
      p.age += dt;
      const k = p.age / p.life;
      // Aufsteigen, langsamer werden, vom Wind zur Seite gedrückt.
      p.vy *= 1 - dt * 0.25;
      p.vx += (w.x - p.vx) * dt * 0.6;
      p.vz += (w.z - p.vz) * dt * 0.6;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
      const alpha = Math.min(1, p.age / 0.6) * (1 - k) * (1 - k) * 0.55;
      off.setXYZ(i, p.x, p.y, p.z);
      data.setXYZW(i, p.size * (1 + k * 2.6), alpha, p.rot, Math.max(0, p.y - s) / Math.max(0.3, s));
    }
    off.needsUpdate = true;
    data.needsUpdate = true;
  }

  private updateSparks(dt: number): void {
    const s = this.size;
    this.sparkTimer -= dt;
    let burst = 0;
    if (this.sparkTimer <= 0) {
      // Meist einzelne Funken, ab und zu knackt das Holz und ein Schwarm stiebt auf.
      burst = Math.random() < 0.08 ? 7 : 1;
      this.sparkTimer = 0.12 + Math.random() * 0.25;
    }
    const geo = this.sparkMesh!.geometry as THREE.InstancedBufferGeometry;
    const off = geo.getAttribute('aOffset') as THREE.InstancedBufferAttribute;
    const data = geo.getAttribute('aData') as THREE.InstancedBufferAttribute;
    const w = this.invScale;
    for (let i = 0; i < SPARKS; i++) {
      const p = this.sparks[i];
      if (p.age >= p.life) {
        if (burst > 0) {
          burst--;
          p.x = (Math.random() - 0.5) * s * 0.4;
          p.y = s * (0.2 + Math.random() * 0.4);
          p.z = (Math.random() - 0.5) * s * 0.4;
          p.vx = (Math.random() - 0.5) * 1.2;
          p.vy = 1.4 + Math.random() * 2.2 * Math.sqrt(s);
          p.vz = (Math.random() - 0.5) * 1.2;
          p.age = 0;
          p.life = 0.8 + Math.random() * 1.4;
          p.size = 0.025 + Math.random() * 0.025;
          p.rot = Math.random() * 10;
        } else {
          data.setXYZW(i, 0, 0, 0, 0);
          continue;
        }
      }
      p.age += dt;
      const k = p.age / p.life;
      // Thermik trägt, Luftwiderstand bremst, Wirbel lassen die Funken tanzen.
      p.vx += (w.x - p.vx) * dt * 1.2 + Math.sin(p.age * 9 + p.rot) * dt * 2;
      p.vz += (w.z - p.vz) * dt * 1.2 + Math.cos(p.age * 7 + p.rot) * dt * 2;
      p.vy += (0.5 - p.vy) * dt * 0.8;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      // Glühen: kurz hell, verglimmt mit Flackern.
      const glow = (1 - k) * (0.75 + 0.25 * Math.sin(p.age * 40 + p.rot));
      off.setXYZ(i, p.x, p.y, p.z);
      data.setXYZW(i, p.size, glow, 0, 0);
    }
    off.needsUpdate = true;
    data.needsUpdate = true;
  }
}
