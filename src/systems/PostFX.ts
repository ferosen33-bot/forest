import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { N8AOPass } from 'n8ao';

/** Farbstimmung wie im Horrorfilm (wird nach dem Tone Mapping im Anzeige-Farbraum angewandt). */
export interface Grade {
  /** 1 = unverändert, 0 = schwarz-weiß. */
  saturation: number;
  /** Kontrast um Mittelgrau (1 = unverändert). */
  contrast: number;
  /** Farbstich in den Schatten (wird aufaddiert, klein halten). */
  shadows: THREE.Color;
  /** Farbfilter in den Lichtern (Multiplikator). */
  highlights: THREE.Color;
  /** Filmkorn 0..~0.12. */
  grain: number;
  /** Abdunkeln der Bildränder. */
  vignette: number;
  /** Farbsäume zum Rand hin (Linsenfehler). */
  aberration: number;
}

/** Bodennebel: Dichte nimmt mit der Höhe exponentiell ab (sammelt sich in Senken). */
export interface Mist {
  color: THREE.Color;
  /** Dichte auf Höhe `base` (pro Meter). */
  density: number;
  /** Höhe, über die die Dichte auf 1/e fällt (m). */
  height: number;
  /** Bezugshöhe (Welt-Y). */
  base: number;
}

export interface PostFXParams {
  /** Richtung zur Lichtquelle (Sonne bzw. Mond), Weltkoordinaten. */
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  /** Stärke der Lichtstrahlen (0 = aus). */
  rays: number;
  /** Stärke des Bloom-Glühens. */
  bloom: number;
  underwater: boolean;
  grade: Grade;
  mist: Mist;
  time: number;
  /** Wird nach Umgebungsverdeckung und Nebel über das Bild gezeichnet (Gegenstand in der Hand). */
  overlay?: { scene: THREE.Scene; camera: THREE.Camera } | null;
}

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Maske: nur unverdeckter Himmel nahe der Sonne leuchtet (Bäume/Gelände davor sind schwarz). */
const occlusionFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uSun;
uniform float uAspect;
varying vec2 vUv;
void main() {
  float depth = texture2D(tDepth, vUv).r;
  float sky = step(0.99999, depth);
  vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
  float glow = pow(max(0.0, 1.0 - length(d) * 1.4), 3.0);
  vec3 c = texture2D(tColor, vUv).rgb;
  gl_FragColor = vec4(min(c, vec3(4.0)) * sky * glow, 1.0);
}`;

/** Radiale Unschärfe in Richtung Lichtquelle ("God Rays", GPU Gems 3, Kap. 13). */
const raysFragment = /* glsl */ `
uniform sampler2D tMask;
uniform vec2 uSun;
varying vec2 vUv;
const int SAMPLES = 56;
void main() {
  vec2 delta = (vUv - uSun) * (0.92 / float(SAMPLES));
  vec2 uv = vUv;
  float decay = 1.0;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    uv -= delta;
    sum += texture2D(tMask, uv).rgb * decay;
    decay *= 0.965;
  }
  gl_FragColor = vec4(sum / float(SAMPLES) * 2.2, 1.0);
}`;

/**
 * Bodennebel aus der Tiefe: Weltposition rekonstruieren und die Nebeldichte entlang des Sehstrahls
 * analytisch integrieren (exponentieller Höhennebel nach Iñigo Quilez). Der Himmel bekommt den
 * Nebel einer festen Entfernung, damit der Horizont im Dunst verschwimmt.
 */
const mistFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCamPos;
uniform vec3 uMistColor;
uniform float uDensity;
uniform float uFalloff;
uniform float uBase;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  float depth = texture2D(tDepth, vUv).r;
  vec4 view = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  view /= view.w;
  vec3 world = (uViewInv * vec4(view.xyz, 1.0)).xyz;
  vec3 ray = world - uCamPos;
  float dist = length(ray);
  vec3 rd = ray / max(dist, 1e-4);
  if (depth >= 0.99999) dist = 380.0;
  float b = uFalloff;
  float a = uDensity * exp(-b * (uCamPos.y - uBase));
  float k = b * rd.y;
  float f = abs(k) > 1e-4 ? a * (1.0 - exp(-k * dist)) / k : a * dist;
  float fog = 1.0 - exp(-max(f, 0.0));
  gl_FragColor = vec4(mix(c, uMistColor, clamp(fog, 0.0, 0.92)), 1.0);
}`;

/** Helle Bereiche für Bloom (weiches Knie über der Schwelle). */
const brightFragment = /* glsl */ `
uniform sampler2D tColor;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThreshold, uThreshold * 1.8, l);
  gl_FragColor = vec4(min(c * k, vec3(8.0)), 1.0);
}`;

/** Separierbarer 9-Tap-Gauß. */
const blurFragment = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb * 0.227027;
  c += texture2D(tInput, vUv + uDir * 1.384615).rgb * 0.316216;
  c += texture2D(tInput, vUv - uDir * 1.384615).rgb * 0.316216;
  c += texture2D(tInput, vUv + uDir * 3.230769).rgb * 0.070270;
  c += texture2D(tInput, vUv - uDir * 3.230769).rgb * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}`;

/**
 * Zusammenführen: Farbsäume, Lichtstrahlen, Bloom → Tone Mapping → Filmlook
 * (Sättigung, Kontrast, getönte Schatten und Lichter, Vignette, Filmkorn).
 */
const compositeFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tRays;
uniform sampler2D tBloom;
uniform vec3 uRayColor;
uniform float uRays;
uniform float uBloom;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uShadows;
uniform vec3 uHighlights;
uniform float uGrain;
uniform float uVignette;
uniform float uAberration;
uniform float uTime;
uniform vec2 uRes;
varying vec2 vUv;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 dir = vUv - 0.5;
  float r2 = dot(dir, dir);
  vec2 off = dir * uAberration * r2;
  vec3 c;
  c.r = texture2D(tColor, vUv - off).r;
  c.g = texture2D(tColor, vUv).g;
  c.b = texture2D(tColor, vUv + off).b;
  c += texture2D(tRays, vUv).rgb * uRayColor * uRays;
  c += texture2D(tBloom, vUv).rgb * uBloom;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  vec3 g = gl_FragColor.rgb;
  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g = mix(vec3(l), g, uSaturation);
  g = (g - 0.5) * uContrast + 0.5;
  g += uShadows * (1.0 - smoothstep(0.0, 0.55, l));
  // Farbfilter in den Lichtern – die hellsten Stellen (Flammen, Lampen) behalten ihre eigene Farbe.
  g *= mix(vec3(1.0), uHighlights, smoothstep(0.25, 0.7, l) * (1.0 - smoothstep(0.75, 0.95, l)));
  g *= 1.0 - r2 * uVignette;
  // Filmkorn: pro Pixel und Bild neu, in mittleren und dunklen Tönen am stärksten.
  float n = hash(floor(vUv * uRes) + fract(uTime * 7.31) * 517.0) - 0.5;
  g += n * uGrain * (0.55 + 0.45 * (1.0 - l));
  gl_FragColor = vec4(clamp(g, 0.0, 1.0), 1.0);
}`;

/**
 * Nachbearbeitung im Stil eines Horrorfilms:
 * - Umgebungsverdeckung (n8ao): Ecken, Spalten und Bodenkontakt werden dunkel,
 * - Bodennebel, der in Senken hängt,
 * - Lichtstrahlen (Sonne/Mond durch Bäume) und Bloom (Feuer, Lampen, Augen der Schrate),
 * - Filmlook: entsättigte, getönte Farben, Kontrast, Vignette, Filmkorn und Farbsäume.
 *
 * Die Szene wird in ein HDR-Render-Target (MSAA, mit Tiefentextur) gezeichnet; Tone Mapping
 * und sRGB-Umrechnung passieren erst im letzten Schritt.
 */
export class PostFX {
  enabled = true;
  /** Umgebungsverdeckung (kostet auf schwachen Geräten spürbar Leistung). */
  ao = true;

  private readonly scene: THREE.WebGLRenderTarget;
  /** Ergebnis der Umgebungsverdeckung (ohne Tiefe). */
  private readonly aoOut: THREE.WebGLRenderTarget;
  /** Fertig beleuchtetes Bild mit Nebel; mit eigenem Tiefenpuffer für den Gegenstand in der Hand. */
  private readonly lit: THREE.WebGLRenderTarget;
  private readonly mask: THREE.WebGLRenderTarget;
  private readonly rays: THREE.WebGLRenderTarget;
  private readonly bloomA: THREE.WebGLRenderTarget;
  private readonly bloomB: THREE.WebGLRenderTarget;
  private readonly quad = new FullScreenQuad();
  private readonly mats;
  private aoPass: N8AOPass | null = null;
  private readonly sunUv = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private readonly black = new THREE.Color(0, 0, 0);

  constructor(renderer: THREE.WebGLRenderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const hdr = { type: THREE.HalfFloatType, depthBuffer: false };
    this.scene = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(size.x, size.y),
    });
    this.aoOut = new THREE.WebGLRenderTarget(size.x, size.y, hdr);
    this.lit = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: true });
    this.mask = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.rays = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.bloomA = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.bloomB = new THREE.WebGLRenderTarget(1, 1, hdr);

    const mat = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, toneMapped = false) =>
      new THREE.ShaderMaterial({ vertexShader: quadVertex, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped });
    this.mats = {
      occlusion: mat(occlusionFragment, {
        tColor: { value: this.scene.texture },
        tDepth: { value: this.scene.depthTexture },
        uSun: { value: this.sunUv },
        uAspect: { value: 1 },
      }),
      rays: mat(raysFragment, { tMask: { value: this.mask.texture }, uSun: { value: this.sunUv } }),
      mist: mat(mistFragment, {
        tColor: { value: this.scene.texture },
        tDepth: { value: this.scene.depthTexture },
        uProjInv: { value: new THREE.Matrix4() },
        uViewInv: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uMistColor: { value: new THREE.Color() },
        uDensity: { value: 0 },
        uFalloff: { value: 0.1 },
        uBase: { value: 0 },
      }),
      bright: mat(brightFragment, { tColor: { value: this.lit.texture }, uThreshold: { value: 1.1 } }),
      blur: mat(blurFragment, { tInput: { value: null }, uDir: { value: new THREE.Vector2() } }),
      composite: mat(
        compositeFragment,
        {
          tColor: { value: this.lit.texture },
          tRays: { value: this.rays.texture },
          tBloom: { value: this.bloomA.texture },
          uRayColor: { value: new THREE.Color() },
          uRays: { value: 0 },
          uBloom: { value: 0 },
          uSaturation: { value: 1 },
          uContrast: { value: 1 },
          uShadows: { value: new THREE.Color(0, 0, 0) },
          uHighlights: { value: new THREE.Color(1, 1, 1) },
          uGrain: { value: 0 },
          uVignette: { value: 0.55 },
          uAberration: { value: 0 },
          uTime: { value: 0 },
          uRes: { value: new THREE.Vector2(size.x, size.y) },
        },
        true,
      ),
    };
    this.setSize(size.x, size.y);
  }

  setSize(width: number, height: number): void {
    this.scene.setSize(width, height);
    this.aoOut.setSize(width, height);
    this.lit.setSize(width, height);
    this.aoPass?.setSize(width, height);
    const hw = Math.max(1, Math.floor(width / 2));
    const hh = Math.max(1, Math.floor(height / 2));
    this.mask.setSize(hw, hh);
    this.rays.setSize(hw, hh);
    const qw = Math.max(1, Math.floor(width / 4));
    const qh = Math.max(1, Math.floor(height / 4));
    this.bloomA.setSize(qw, qh);
    this.bloomB.setSize(qw, qh);
    this.mats.occlusion.uniforms.uAspect.value = width / height;
    this.mats.composite.uniforms.uRes.value.set(width, height);
  }

  /** Umgebungsverdeckung, die das bereits gezeichnete Szenenbild (samt Tiefe) weiterverwendet. */
  private ensureAO(scene: THREE.Scene, camera: THREE.Camera): N8AOPass {
    if (this.aoPass) return this.aoPass;
    const pass = new N8AOPass(scene, camera, this.scene.width, this.scene.height);
    pass.beautyRenderTarget.dispose();
    pass.beautyRenderTarget = this.scene;
    pass.autoDetectTransparency = false;
    pass.setQualityMode('Medium');
    const c = pass.configuration;
    c.autoRenderBeauty = false;
    c.gammaCorrection = false; // wir bleiben bis zum Schluss im linearen HDR-Raum
    c.halfRes = true;
    c.aoRadius = 2.2;
    c.distanceFalloff = 1.2;
    c.intensity = 3.2;
    this.aoPass = pass;
    return pass;
  }

  /** Zeichnet die Szene mit allen Effekten auf den Bildschirm. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, p: PostFXParams): void {
    renderer.setRenderTarget(this.scene);
    renderer.clear();
    renderer.render(scene, camera);

    // Lichtquelle in Bildschirmkoordinaten; hinter der Kamera → keine Strahlen.
    this.tmp.copy(camera.position).addScaledVector(p.lightDir, 400).project(camera);
    const inFront = this.tmp.z < 1;
    this.sunUv.set(this.tmp.x * 0.5 + 0.5, this.tmp.y * 0.5 + 0.5);
    // Auch knapp außerhalb des Bildes noch Strahlen zeigen, dann weich ausblenden.
    const edge = Math.max(Math.abs(this.tmp.x), Math.abs(this.tmp.y));
    const rays = inFront && !p.underwater ? p.rays * (1 - THREE.MathUtils.smoothstep(edge, 1.0, 1.6)) : 0;

    if (rays > 0.001) {
      this.pass(renderer, this.mats.occlusion, this.mask);
      this.pass(renderer, this.mats.rays, this.rays);
    } else {
      renderer.setRenderTarget(this.rays);
      renderer.setClearColor(this.black, 1);
      renderer.clear();
    }

    // Umgebungsverdeckung → Bodennebel → `lit`
    let color = this.scene.texture;
    if (this.ao) {
      this.ensureAO(scene, camera).render(renderer, this.aoOut);
      color = this.aoOut.texture;
    }
    const m = this.mats.mist.uniforms;
    m.tColor.value = color;
    m.uProjInv.value.copy(camera.projectionMatrixInverse);
    m.uViewInv.value.copy(camera.matrixWorld);
    m.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    m.uMistColor.value.copy(p.mist.color);
    m.uDensity.value = p.underwater ? 0 : p.mist.density;
    m.uFalloff.value = 1 / Math.max(0.5, p.mist.height);
    m.uBase.value = p.mist.base;
    this.pass(renderer, this.mats.mist, this.lit);

    // Gegenstand in der Hand darüber (eigener Tiefenpuffer, nicht vernebelt, ohne Umgebungsverdeckung).
    if (p.overlay) {
      renderer.setRenderTarget(this.lit);
      renderer.clearDepth();
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(p.overlay.scene, p.overlay.camera);
      renderer.autoClear = auto;
    }

    // Bloom: Schwelle → 2 × (horizontal + vertikal) weichzeichnen
    this.pass(renderer, this.mats.bright, this.bloomA);
    const blur = this.mats.blur.uniforms;
    for (let i = 0; i < 2; i++) {
      blur.tInput.value = this.bloomA.texture;
      blur.uDir.value.set((1 + i) / this.bloomA.width, 0);
      this.pass(renderer, this.mats.blur, this.bloomB);
      blur.tInput.value = this.bloomB.texture;
      blur.uDir.value.set(0, (1 + i) / this.bloomA.height);
      this.pass(renderer, this.mats.blur, this.bloomA);
    }

    const c = this.mats.composite.uniforms;
    const g = p.grade;
    c.uRays.value = rays;
    c.uRayColor.value.copy(p.lightColor);
    c.uBloom.value = p.bloom;
    c.uSaturation.value = g.saturation;
    c.uContrast.value = g.contrast;
    c.uShadows.value.copy(g.shadows);
    c.uHighlights.value.copy(g.highlights);
    c.uGrain.value = g.grain;
    c.uVignette.value = g.vignette;
    c.uAberration.value = g.aberration;
    c.uTime.value = p.time;
    renderer.setRenderTarget(null);
    this.quad.material = this.mats.composite;
    this.quad.render(renderer);
  }

  private pass(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(target);
    this.quad.material = material;
    this.quad.render(renderer);
  }

  dispose(): void {
    for (const rt of [this.scene, this.aoOut, this.lit, this.mask, this.rays, this.bloomA, this.bloomB]) rt.dispose();
    Object.values(this.mats).forEach((m) => m.dispose());
    this.quad.dispose();
  }
}
