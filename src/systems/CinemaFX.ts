import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Kino-Effekte zwischen Szenenbild und Tone Mapping (alles im linearen HDR-Raum):
 * - **Bloom als Mip-Kette** (wie in Unreal): sechs Stufen bis 1/64 Auflösung werden heruntergerechnet und
 *   wieder aufaddiert – weites, weiches Leuchten um Feuer, Sonne und Lampen ohne Blockmuster.
 * - **Augenanpassung:** mittlere Helligkeit des Bildes → Belichtung, die langsam nachzieht (wer aus der
 *   Höhle tritt, ist kurz geblendet; im Dunkeln gewöhnt sich das Auge – begrenzt, damit Nächte Nächte bleiben).
 * - **Bewegungsunschärfe** der Kamera (aus Tiefe und der Kameramatrix des letzten Bildes).
 * - **Tiefenunschärfe** beim Zielen: scharf ist, was im Fadenkreuz liegt.
 * Der Gegenstand in der Hand (eigene Tiefe im Ergebnisbild) bleibt von Unschärfe verschont.
 */

export interface CinemaParams {
  dt: number;
  /** Bewegungsunschärfe 0..1 (0 = aus). */
  motionBlur: number;
  /** Tiefenunschärfe 0..1 (beim Zielen). */
  dof: number;
  /** Augenanpassung an/aus (unter Wasser, im Menü …). */
  adapt: boolean;
}

const vertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Bewegungs- und Tiefenunschärfe in einem Durchgang. */
const blurFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;     // Tiefe der Szene
uniform sampler2D tOverlay;   // Tiefe des Ergebnisbildes: < 1 = Gegenstand in der Hand
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform mat4 uPrevViewProj;
uniform float uMotion;
uniform float uDof;
uniform float uNear;
uniform float uFar;
uniform vec2 uTexel;
varying vec2 vUv;

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
bool isOverlay(vec2 uv) { return texture2D(tOverlay, uv).r < 0.9999; }
// Zerstreuung: um die Fokusebene herum ein breiter scharfer Bereich, davor und dahinter weich zunehmend.
float cocAt(float z, float focus) {
  return clamp((abs(z - focus) - focus * 0.2) / max(2.0, focus * 1.4), 0.0, 1.0);
}

void main() {
  vec3 base = texture2D(tColor, vUv).rgb;
  if (any(isnan(base))) base = vec3(0.0);
  if (isOverlay(vUv)) { gl_FragColor = vec4(base, 1.0); return; }
  float d = texture2D(tDepth, vUv).r;
  vec3 col = base;

  // Tiefenunschärfe: Zerstreuungskreis aus dem Abstand zur Fokusebene (Fadenkreuz).
  if (uDof > 0.001) {
    float focus = linearDepth(texture2D(tDepth, vec2(0.5)).r);
    float z = linearDepth(d);
    float coc = cocAt(z, focus) * uDof;
    if (coc > 0.02) {
      vec3 sum = base;
      float wsum = 1.0;
      float radius = coc * 7.0;
      for (int i = 0; i < 16; i++) {
        float fi = float(i);
        float r = sqrt((fi + 0.5) / 16.0) * radius;
        float a = fi * 2.39996;
        vec2 o = vec2(cos(a), sin(a)) * r * uTexel;
        vec2 uv = vUv + o;
        if (isOverlay(uv)) continue;
        // Scharfes vor Unscharfem nicht hineinbluten lassen.
        float zs = linearDepth(texture2D(tDepth, uv).r);
        float cs = cocAt(zs, focus);
        float w = smoothstep(0.0, 0.3, cs);
        sum += texture2D(tColor, uv).rgb * w;
        wsum += w;
      }
      col = sum / wsum;
    }
  }

  // Bewegungsunschärfe: wo lag dieser Punkt im letzten Bild?
  if (uMotion > 0.001) {
    vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 view = uProjInv * ndc;
    view /= view.w;
    vec4 world = uViewInv * view;
    vec4 prev = uPrevViewProj * world;
    vec2 prevUv = prev.xy / prev.w * 0.5 + 0.5;
    vec2 vel = (vUv - prevUv) * uMotion;
    float len = length(vel);
    // Sprünge (Teleport, Höhlenwechsel) nicht verschmieren.
    if (len > 0.0008 && len < 0.25) {
      vel *= min(1.0, 0.035 / len);
      vec3 sum = col;
      float n = 1.0;
      for (int i = 1; i <= 8; i++) {
        vec2 uv = vUv - vel * (float(i) / 8.0 - 0.5);
        if (isOverlay(uv)) continue;
        sum += texture2D(tColor, uv).rgb;
        n += 1.0;
      }
      col = sum / n;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/** Erste Bloom-Stufe: Schwelle mit weichem Knie, danach 13-Tap-Verkleinerung (Jimenez, CoD). */
const downFragment = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uPrefilter;
varying vec2 vUv;
vec3 tap(vec2 o) {
  vec3 c = texture2D(tInput, vUv + o * uTexel).rgb;
  // Ein ungültiger Pixel würde sich durch die ganze Kette zu einem schwarzen Fleck ausbreiten.
  if (any(isnan(c)) || any(isinf(c))) return vec3(0.0);
  if (uPrefilter > 0.5) {
    float l = max(c.r, max(c.g, c.b));
    c *= smoothstep(uThreshold, uThreshold * 1.8, l);
    // Glühwürmchen-Unterdrückung: einzelne extrem helle Pixel dämpfen.
    c /= 1.0 + max(0.0, l - 12.0) * 0.1;
  }
  return c;
}
void main() {
  vec3 a = tap(vec2(-2.0, 2.0)), b = tap(vec2(0.0, 2.0)), c = tap(vec2(2.0, 2.0));
  vec3 d = tap(vec2(-2.0, 0.0)), e = tap(vec2(0.0)), f = tap(vec2(2.0, 0.0));
  vec3 g = tap(vec2(-2.0, -2.0)), h = tap(vec2(0.0, -2.0)), i = tap(vec2(2.0, -2.0));
  vec3 j = tap(vec2(-1.0, 1.0)), k = tap(vec2(1.0, 1.0)), l = tap(vec2(-1.0, -1.0)), m = tap(vec2(1.0, -1.0));
  vec3 s = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(min(s, vec3(64.0)), 1.0);
}`;

/** Bloom zurück nach oben: 3×3-Zelt der kleineren Stufe, mit der aktuellen gemischt. */
const upFragment = /* glsl */ `
uniform sampler2D tSmall;
uniform sampler2D tCurrent;
uniform vec2 uTexel;     // Texel der kleineren Stufe
uniform float uScatter;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSmall, vUv + vec2(-1.0, 1.0) * uTexel).rgb + texture2D(tSmall, vUv + vec2(1.0, 1.0) * uTexel).rgb
    + texture2D(tSmall, vUv + vec2(-1.0, -1.0) * uTexel).rgb + texture2D(tSmall, vUv + vec2(1.0, -1.0) * uTexel).rgb;
  s += (texture2D(tSmall, vUv + vec2(0.0, 1.0) * uTexel).rgb + texture2D(tSmall, vUv + vec2(0.0, -1.0) * uTexel).rgb
    + texture2D(tSmall, vUv + vec2(1.0, 0.0) * uTexel).rgb + texture2D(tSmall, vUv + vec2(-1.0, 0.0) * uTexel).rgb) * 2.0;
  s += texture2D(tSmall, vUv).rgb * 4.0;
  s /= 16.0;
  gl_FragColor = vec4(mix(texture2D(tCurrent, vUv).rgb, s, uScatter), 1.0);
}`;

/** Logarithmische Helligkeit, zur Mitte hin stärker gewichtet (dort schaut man hin). */
const lumFragment = /* glsl */ `
uniform sampler2D tInput;
varying vec2 vUv;
void main() {
  // Vier Abtastungen je Zelle gegen Flackern (das Bild wird stark verkleinert).
  vec2 q = vec2(0.25 / 64.0);
  vec3 c = (texture2D(tInput, vUv + vec2(-q.x, -q.y)).rgb + texture2D(tInput, vUv + vec2(q.x, -q.y)).rgb
    + texture2D(tInput, vUv + vec2(-q.x, q.y)).rgb + texture2D(tInput, vUv + q).rgb) * 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = 1.0 - smoothstep(0.15, 0.75, length(vUv - 0.5));
  // Ungültige Pixel (NaN/Inf aus einzelnen Shadern) dürfen den Mittelwert nicht vergiften.
  if (isnan(l) || isinf(l)) { gl_FragColor = vec4(0.0); return; }
  gl_FragColor = vec4(log(clamp(l, 1e-4, 1e4)) * (0.35 + w), 0.35 + w, 0.0, 1.0);
}`;

/**
 * Augenanpassung relativ zur abgestimmten Bildstimmung: R = Helligkeit, an die das Auge gewöhnt ist (log,
 * nachgeführt), G = Belichtung = √(jetzt ÷ gewöhnt). Im Gleichgewicht ist sie 1 – Tag und Nacht bleiben, wie sie
 * gestaltet sind. Wer aus der dunklen Höhle tritt, ist kurz geblendet; wer hineingeht, sieht erst einmal nichts.
 */
const adaptFragment = /* glsl */ `
uniform sampler2D tLum;
uniform sampler2D tPrev;
uniform float uDt;
uniform float uReset;
uniform vec2 uRange;
varying vec2 vUv;
void main() {
  float sum = 0.0;
  float wsum = 0.0;
  for (int y = 0; y < 16; y++) {
    for (int x = 0; x < 16; x++) {
      vec2 v = texture2D(tLum, (vec2(float(x), float(y)) + 0.5) / 16.0).rg;
      sum += v.r;
      wsum += v.g;
    }
  }
  float current = sum / max(wsum, 1e-4);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  if (isnan(current) || isinf(current)) current = isnan(prev) ? -2.0 : prev;
  if (isnan(prev) || isinf(prev)) prev = current;
  // Ans Helle gewöhnt sich das Auge in gut einer Sekunde, ans Dunkle deutlich langsamer.
  float speed = current > prev ? 1.8 : 0.45;
  float adapted = uReset > 0.5 ? current : mix(prev, current, 1.0 - exp(-uDt * speed));
  float exposure = clamp(exp((current - adapted) * 0.5), uRange.x, uRange.y);
  gl_FragColor = vec4(adapted, exposure, 0.0, 1.0);
}`;

/** Bloom-Stufen (1/2 … 1/64). */
const LEVELS = 6;

export class CinemaFX {
  private readonly quad = new FullScreenQuad();
  private readonly down: THREE.WebGLRenderTarget[] = [];
  private readonly up: THREE.WebGLRenderTarget[] = [];
  private readonly blurred: THREE.WebGLRenderTarget;
  private readonly lum: THREE.WebGLRenderTarget;
  private readonly exposure: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private exposureIndex = 0;
  private reset = true;
  private readonly prevViewProj = new THREE.Matrix4();
  private hasPrev = false;
  private readonly prevCam = new THREE.Vector3();
  private readonly mats;
  /** Belichtung an aus (Einstellung „Nachbearbeitung“ bleibt unabhängig). */
  adaptEnabled = true;

  constructor(width: number, height: number) {
    const hdr = { type: THREE.HalfFloatType, depthBuffer: false };
    for (let i = 0; i < LEVELS; i++) {
      this.down.push(new THREE.WebGLRenderTarget(1, 1, hdr));
      this.up.push(new THREE.WebGLRenderTarget(1, 1, hdr));
    }
    this.blurred = new THREE.WebGLRenderTarget(width, height, hdr);
    this.lum = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, depthBuffer: false });
    const one = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.exposure = [new THREE.WebGLRenderTarget(1, 1, one), new THREE.WebGLRenderTarget(1, 1, one)];
    const mat = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    this.mats = {
      blur: mat(blurFragment, {
        tColor: { value: null },
        tDepth: { value: null },
        tOverlay: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uViewInv: { value: new THREE.Matrix4() },
        uPrevViewProj: { value: new THREE.Matrix4() },
        uMotion: { value: 0 },
        uDof: { value: 0 },
        uNear: { value: 0.1 },
        uFar: { value: 500 },
        uTexel: { value: new THREE.Vector2() },
      }),
      down: mat(downFragment, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.1 }, uPrefilter: { value: 0 } }),
      up: mat(upFragment, { tSmall: { value: null }, tCurrent: { value: null }, uTexel: { value: new THREE.Vector2() }, uScatter: { value: 0.7 } }),
      lum: mat(lumFragment, { tInput: { value: null } }),
      adapt: mat(adaptFragment, {
        tLum: { value: this.lum.texture },
        tPrev: { value: null },
        uDt: { value: 0 },
        uReset: { value: 1 },
        uRange: { value: new THREE.Vector2(0.45, 2.4) },
      }),
    };
    this.setSize(width, height);
  }

  setSize(width: number, height: number): void {
    this.blurred.setSize(width, height);
    this.mats.blur.uniforms.uTexel.value.set(1 / width, 1 / height);
    let w = width;
    let h = height;
    for (let i = 0; i < LEVELS; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      this.down[i].setSize(w, h);
      this.up[i].setSize(w, h);
    }
  }

  /** Nach Teleports (Höhle, Tod) nicht verschmieren und die Belichtung sofort setzen. */
  cut(): void {
    this.hasPrev = false;
    this.reset = true;
  }

  /** Bewegungs-/Tiefenunschärfe; liefert das Bild, das weiterverarbeitet wird. */
  blur(
    renderer: THREE.WebGLRenderer,
    color: THREE.Texture,
    depth: THREE.Texture,
    overlayDepth: THREE.Texture,
    camera: THREE.PerspectiveCamera,
    p: CinemaParams,
  ): THREE.Texture {
    // Sprung der Kamera (Teleport, Höhle, Tod): kein Verwischen über den Schnitt.
    if (this.hasPrev && this.prevCam.distanceTo(camera.position) > 4) this.hasPrev = false;
    this.prevCam.copy(camera.position);
    const motion = this.hasPrev ? p.motionBlur : 0;
    const u = this.mats.blur.uniforms;
    if (motion > 0.001 || p.dof > 0.001) {
      u.tColor.value = color;
      u.tDepth.value = depth;
      u.tOverlay.value = overlayDepth;
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uViewInv.value.copy(camera.matrixWorld);
      u.uPrevViewProj.value.copy(this.prevViewProj);
      // Auf ~60 Bilder/s normiert: bei hoher Bildrate nicht weniger, bei niedriger nicht mehr Unschärfe.
      u.uMotion.value = motion * Math.min(1.5, 1 / 60 / Math.max(1 / 240, p.dt)) * 0.5;
      u.uDof.value = p.dof;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      this.pass(renderer, this.mats.blur, this.blurred);
      color = this.blurred.texture;
    }
    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.hasPrev = true;
    return color;
  }

  /** Bloom-Kette; liefert das Leuchten (halbe Auflösung) und eine kleine Stufe für Linsenreflexe. */
  bloom(renderer: THREE.WebGLRenderer, color: THREE.Texture, threshold: number): { bloom: THREE.Texture; lens: THREE.Texture } {
    const d = this.mats.down.uniforms;
    let input = color;
    let texel = new THREE.Vector2(1 / (this.down[0].width * 2), 1 / (this.down[0].height * 2));
    for (let i = 0; i < LEVELS; i++) {
      d.tInput.value = input;
      d.uTexel.value.copy(texel);
      d.uPrefilter.value = i === 0 ? 1 : 0;
      d.uThreshold.value = threshold;
      this.pass(renderer, this.mats.down, this.down[i]);
      input = this.down[i].texture;
      texel = new THREE.Vector2(1 / this.down[i].width, 1 / this.down[i].height);
    }
    const up = this.mats.up.uniforms;
    let small = this.down[LEVELS - 1].texture;
    for (let i = LEVELS - 2; i >= 0; i--) {
      up.tSmall.value = small;
      up.tCurrent.value = this.down[i].texture;
      up.uTexel.value.set(1 / this.down[i + 1].width, 1 / this.down[i + 1].height);
      this.pass(renderer, this.mats.up, this.up[i]);
      small = this.up[i].texture;
    }
    return { bloom: this.up[0].texture, lens: this.up[2].texture };
  }

  /** Augenanpassung; liefert eine 1×1-Textur, deren Grün-Kanal die Belichtung ist. */
  adapt(renderer: THREE.WebGLRenderer, color: THREE.Texture, p: CinemaParams): THREE.Texture {
    this.mats.lum.uniforms.tInput.value = color;
    this.pass(renderer, this.mats.lum, this.lum);
    const a = this.mats.adapt.uniforms;
    const prev = this.exposure[this.exposureIndex];
    const next = this.exposure[1 - this.exposureIndex];
    a.tPrev.value = prev.texture;
    a.uDt.value = p.dt;
    a.uReset.value = this.reset ? 1 : 0;
    // Ausgeschaltet: Belichtung 1 (Bereich auf 1..1 klemmen).
    const on = p.adapt && this.adaptEnabled;
    a.uRange.value.set(on ? 0.45 : 1, on ? 2.4 : 1);
    this.pass(renderer, this.mats.adapt, next);
    this.exposureIndex = 1 - this.exposureIndex;
    this.reset = false;
    return next.texture;
  }

  private pass(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(target);
    this.quad.material = material;
    this.quad.render(renderer);
  }

  dispose(): void {
    for (const rt of [...this.down, ...this.up, this.blurred, this.lum, ...this.exposure]) rt.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
