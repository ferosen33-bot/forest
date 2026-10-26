import * as THREE from 'three';

/**
 * Sichtbare Blitze im Gewitter: ein gezackter Hauptkanal von der Wolkenbasis bis zum Boden, mit
 * Verästelungen, die in der Luft enden. Der Leitblitz wächst in wenigen Hundertstelsekunden von oben
 * herab, danach flackert der Kanal in zwei, drei Nachentladungen und erlischt.
 *
 * Gezeichnet als Bänder, die sich zur Kamera drehen (additiv, HDR-hell – das Bloom macht den Schein).
 * Weit entfernte Einschläge werden näher herangeholt, damit sie innerhalb der Sichtweite bleiben.
 */

/** Wolkenbasis über dem Boden (m). */
const CLOUD_BASE = 230;
const MAX_SEGMENTS = 900;
/** Lebensdauer eines Blitzes (s). */
const LIFE = 0.75;

const vertex = /* glsl */ `
attribute vec3 aDir;
attribute float aSide;
attribute float aWidth;
attribute float aBright;
attribute float aT;
uniform float uReveal;
varying float vSide;
varying float vBright;
void main() {
  vec3 side = normalize(cross(aDir, position - cameraPosition));
  vec3 p = position + side * aSide * aWidth;
  vSide = aSide;
  // Leitblitz: nur der bereits gewachsene Teil ist sichtbar.
  vBright = aBright * step(aT, uReveal);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const fragment = /* glsl */ `
uniform float uIntensity;
varying float vSide;
varying float vBright;
void main() {
  float d = abs(vSide);
  // Gleißender Kern, bläulicher Schein drumherum.
  float core = exp(-d * d * 30.0);
  float glow = exp(-d * d * 3.0) * 0.25;
  vec3 col = vec3(1.0, 0.97, 1.0) * core + vec3(0.55, 0.62, 1.0) * glow;
  gl_FragColor = vec4(col * vBright * uIntensity, 1.0);
}`;

interface Segment {
  a: THREE.Vector3;
  b: THREE.Vector3;
  width: number;
  bright: number;
  /** Fortschritt des Leitblitzes (0 = Wolke, 1 = Boden), an dem das Stück erscheint. */
  t: number;
}

export class LightningBolt {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private age = LIFE;
  /** Pulse der Nachentladungen (Zeitpunkte in s). */
  private strokes: number[] = [];
  /** Aktuelle Helligkeit (0..1) – für Himmelsblitz und Licht. */
  brightness = 0;
  /** Einschlagpunkt (Fuß des Blitzes). */
  readonly ground = new THREE.Vector3();

  constructor() {
    const n = MAX_SEGMENTS * 4;
    this.geometry = new THREE.BufferGeometry();
    const attr = (size: number) => new THREE.BufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', attr(3));
    this.geometry.setAttribute('aDir', attr(3));
    this.geometry.setAttribute('aSide', attr(1));
    this.geometry.setAttribute('aWidth', attr(1));
    this.geometry.setAttribute('aBright', attr(1));
    this.geometry.setAttribute('aT', attr(1));
    const index = new Uint32Array(MAX_SEGMENTS * 6);
    for (let i = 0; i < MAX_SEGMENTS; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uReveal: { value: 0 }, uIntensity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'Lightning';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  get active(): boolean {
    return this.age < LIFE;
  }

  /**
   * Blitz auslösen.
   * @param ground Fußpunkt (am Boden, bereits in Sichtweite geholt)
   * @param scale Breite der Bänder (weiter weg breiter, damit er sichtbar bleibt)
   */
  strike(ground: THREE.Vector3, scale: number, rng: () => number = Math.random): void {
    this.ground.copy(ground);
    const top = ground.clone().add(new THREE.Vector3((rng() - 0.5) * 80, CLOUD_BASE, (rng() - 0.5) * 80));
    const segments: Segment[] = [];
    // Hauptkanal: Mittelpunktverschiebung, die Zacken werden zu feinen Stücken immer kleiner.
    const main = this.channel(top, ground, 7, 0.28, rng);
    main.forEach((p, i) => {
      if (i === 0) return;
      segments.push({ a: main[i - 1], b: p, width: 0.7 * scale, bright: 1, t: (i - 1) / (main.length - 1) });
    });
    // Äste: zweigen nach unten ab, werden dünner und schwächer, enden in der Luft.
    const branches = 5 + Math.floor(rng() * 6);
    for (let k = 0; k < branches; k++) {
      const i = 4 + Math.floor(rng() * (main.length * 0.7));
      const from = main[Math.min(i, main.length - 2)];
      const t0 = i / (main.length - 1);
      const len = (1 - t0) * CLOUD_BASE * (0.2 + rng() * 0.35);
      const dir = new THREE.Vector3((rng() - 0.5) * 1.6, -0.6 - rng() * 0.6, (rng() - 0.5) * 1.6).normalize();
      const end = from.clone().addScaledVector(dir, len);
      const pts = this.channel(from, end, 5, 0.38, rng);
      pts.forEach((p, j) => {
        if (j === 0) return;
        const f = j / pts.length;
        segments.push({ a: pts[j - 1], b: p, width: 0.55 * scale * (1 - f * 0.7), bright: 0.55 * (1 - f * 0.8), t: t0 + f * 0.25 });
      });
      // Feine Nebenäste am Ast.
      if (rng() < 0.6) {
        const m = pts[Math.floor(pts.length * (0.3 + rng() * 0.4))];
        const e2 = m.clone().add(new THREE.Vector3((rng() - 0.5) * len * 0.6, -len * (0.2 + rng() * 0.3), (rng() - 0.5) * len * 0.6));
        const sub = this.channel(m, e2, 4, 0.4, rng);
        sub.forEach((p, j) => {
          if (j === 0) return;
          segments.push({ a: sub[j - 1], b: p, width: 0.3 * scale, bright: 0.3 * (1 - j / sub.length), t: t0 + 0.15 + (j / sub.length) * 0.2 });
        });
      }
    }
    this.write(segments);
    this.age = 0;
    // Ein bis drei Nachentladungen durch denselben Kanal.
    this.strokes = [0.06];
    let t = 0.06;
    const extra = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < extra; i++) {
      t += 0.07 + rng() * 0.12;
      this.strokes.push(t);
    }
    this.mesh.visible = true;
  }

  private channel(a: THREE.Vector3, b: THREE.Vector3, depth: number, rough: number, rng: () => number): THREE.Vector3[] {
    let pts = [a.clone(), b.clone()];
    let amp = a.distanceTo(b) * rough * 0.5;
    for (let d = 0; d < depth; d++) {
      const next: THREE.Vector3[] = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1];
        const q = pts[i];
        const mid = p.clone().lerp(q, 0.5);
        mid.x += (rng() - 0.5) * 2 * amp;
        mid.z += (rng() - 0.5) * 2 * amp;
        mid.y += (rng() - 0.5) * amp * 0.5;
        next.push(mid, q);
      }
      pts = next;
      amp *= 0.5;
    }
    return pts;
  }

  private write(segments: Segment[]): void {
    const g = this.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const dir = g.getAttribute('aDir') as THREE.BufferAttribute;
    const side = g.getAttribute('aSide') as THREE.BufferAttribute;
    const width = g.getAttribute('aWidth') as THREE.BufferAttribute;
    const bright = g.getAttribute('aBright') as THREE.BufferAttribute;
    const tAttr = g.getAttribute('aT') as THREE.BufferAttribute;
    const d = new THREE.Vector3();
    const count = Math.min(segments.length, MAX_SEGMENTS);
    for (let i = 0; i < count; i++) {
      const s = segments[i];
      d.subVectors(s.b, s.a).normalize();
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        const p = k < 2 ? s.a : s.b;
        pos.setXYZ(v, p.x, p.y, p.z);
        dir.setXYZ(v, d.x, d.y, d.z);
        side.setX(v, k % 2 === 0 ? -1 : 1);
        // Breite inklusive Schein; die Bänder überlappen an den Knicken.
        width.setX(v, s.width * 1.6);
        bright.setX(v, s.bright);
        tAttr.setX(v, s.t);
      }
    }
    for (const a of [pos, dir, side, width, bright, tAttr]) a.needsUpdate = true;
    g.setDrawRange(0, count * 6);
  }

  update(dt: number): void {
    if (!this.active) {
      this.brightness = 0;
      this.mesh.visible = false;
      return;
    }
    this.age += dt;
    const t = this.age;
    // Leitblitz wächst in ~60 ms herab, dann Pulse, die jeweils rasch verglimmen.
    this.material.uniforms.uReveal.value = Math.min(1, t / 0.06);
    let b = t < 0.06 ? 0.35 : 0;
    for (const s of this.strokes) if (t >= s) b = Math.max(b, Math.exp(-(t - s) * 18));
    b *= 1 - THREE.MathUtils.smoothstep(t, LIFE * 0.7, LIFE);
    this.brightness = b;
    this.material.uniforms.uIntensity.value = 9 * b;
    this.mesh.visible = this.active;
  }
}
