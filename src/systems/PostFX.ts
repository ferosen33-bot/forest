import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export interface PostFXParams {
  /** Richtung zur Lichtquelle (Sonne bzw. Mond), Weltkoordinaten. */
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  /** Stärke der Lichtstrahlen (0 = aus). */
  rays: number;
  /** Stärke des Bloom-Glühens. */
  bloom: number;
  underwater: boolean;
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

/** Zusammenführen, Vignette, Tone Mapping und sRGB-Ausgabe. */
const compositeFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tRays;
uniform sampler2D tBloom;
uniform vec3 uRayColor;
uniform float uRays;
uniform float uBloom;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  c += texture2D(tRays, vUv).rgb * uRayColor * uRays;
  c += texture2D(tBloom, vUv).rgb * uBloom;
  // Vignette: Ränder leicht abdunkeln (lenkt den Blick, kaschiert harte Bildkanten).
  vec2 v = vUv - 0.5;
  c *= 1.0 - dot(v, v) * 0.55;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Nachbearbeitung: Lichtstrahlen (Sonne/Mond durch Bäume und Nebel), Bloom (Feuer, Fackel,
 * Sonne, Augen der Schrate) und Vignette.
 *
 * Die Szene wird in ein HDR-Render-Target (MSAA, mit Tiefentextur) gezeichnet; Tone Mapping
 * und sRGB-Umrechnung passieren erst im letzten Schritt.
 */
export class PostFX {
  enabled = true;

  private readonly scene: THREE.WebGLRenderTarget;
  private readonly mask: THREE.WebGLRenderTarget;
  private readonly rays: THREE.WebGLRenderTarget;
  private readonly bloomA: THREE.WebGLRenderTarget;
  private readonly bloomB: THREE.WebGLRenderTarget;
  private readonly quad = new FullScreenQuad();
  private readonly mats;
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
      bright: mat(brightFragment, { tColor: { value: this.scene.texture }, uThreshold: { value: 1.1 } }),
      blur: mat(blurFragment, { tInput: { value: null }, uDir: { value: new THREE.Vector2() } }),
      composite: mat(
        compositeFragment,
        {
          tColor: { value: this.scene.texture },
          tRays: { value: this.rays.texture },
          tBloom: { value: this.bloomA.texture },
          uRayColor: { value: new THREE.Color() },
          uRays: { value: 0 },
          uBloom: { value: 0 },
        },
        true,
      ),
    };
    this.setSize(size.x, size.y);
  }

  setSize(width: number, height: number): void {
    this.scene.setSize(width, height);
    const hw = Math.max(1, Math.floor(width / 2));
    const hh = Math.max(1, Math.floor(height / 2));
    this.mask.setSize(hw, hh);
    this.rays.setSize(hw, hh);
    const qw = Math.max(1, Math.floor(width / 4));
    const qh = Math.max(1, Math.floor(height / 4));
    this.bloomA.setSize(qw, qh);
    this.bloomB.setSize(qw, qh);
    this.mats.occlusion.uniforms.uAspect.value = width / height;
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
    c.uRays.value = rays;
    c.uRayColor.value.copy(p.lightColor);
    c.uBloom.value = p.bloom;
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
    for (const rt of [this.scene, this.mask, this.rays, this.bloomA, this.bloomB]) rt.dispose();
    Object.values(this.mats).forEach((m) => m.dispose());
    this.quad.dispose();
  }
}
