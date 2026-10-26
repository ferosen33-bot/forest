import * as THREE from 'three';
import type { HeightMap } from './HeightMap';

/**
 * Glühwürmchen in warmen Nächten: grüngelbe Lichtpunkte, die dicht über Gras und Unterholz taumeln und
 * im eigenen Rhythmus aufleuchten – kurz hell, dann langsam verglimmend. Bei Regen, Kälte und am Tag
 * sind sie verschwunden.
 *
 * Wenige Dutzend Punkte um den Spieler; wer sich zu weit entfernt, taucht an anderer Stelle neu auf.
 */

const COUNT = 120;
const RADIUS = 22;

const vertex = /* glsl */ `
attribute float aPhase;
attribute float aRate;
uniform float uTime;
uniform float uPx;
uniform float uAmount;
varying float vGlow;

void main() {
  // Aufleuchten: rasch an, langsam aus, dann eine dunkle Pause.
  float t = fract(uTime * aRate + aPhase);
  float on = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.08, 0.45, t));
  vGlow = on * uAmount;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Mindestgröße, damit ferne Glühwürmchen als Funken bleiben und nicht flimmern.
  gl_PointSize = clamp(uPx * 0.32 / -mv.z, 4.0, 64.0) * (0.5 + 0.5 * on);
  if (vGlow < 0.005) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const fragment = /* glsl */ `
varying float vGlow;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r >= 1.0) discard;
  // Kleiner heller Kern, weicher grüner Schein (den Rest macht das Bloom).
  float core = exp(-r * r * 40.0);
  float halo = exp(-r * r * 5.0) * (1.0 - r);
  // Nur wo es leuchtet Tiefe schreiben: Der Nebel-Pass misst den Dunst dann am Glühwürmchen, nicht am Hintergrund.
  if ((core + halo * 0.3) * vGlow < 0.03) discard;
  gl_FragColor = vec4((vec3(0.7, 1.0, 0.2) * core * 1.4 + vec3(0.35, 0.9, 0.05) * halo * 0.9) * vGlow, 1.0);
}`;

interface Fly {
  home: THREE.Vector3;
  phase: number;
  speed: number;
}

export class Fireflies {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly flies: Fly[] = [];
  private readonly pos: Float32Array;
  private readonly attr: THREE.BufferAttribute;
  private amount = 0;

  constructor(private readonly heightMap: HeightMap) {
    this.pos = new Float32Array(COUNT * 3);
    const phase = new Float32Array(COUNT);
    const rate = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      phase[i] = Math.random();
      rate[i] = 0.18 + Math.random() * 0.22;
      this.flies.push({ home: new THREE.Vector3(Infinity, 0, 0), phase: Math.random() * 100, speed: 0.3 + Math.random() * 0.5 });
    }
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aRate', new THREE.BufferAttribute(rate, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: true,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPx: { value: 720 }, uAmount: { value: 0 } },
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.name = 'Fireflies';
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** Wie viele Glühwürmchen unterwegs sind (0..1), z. B. aus Nacht, Jahreszeit und Wetter. */
  static amount(night: number, chill: number, snow: number, rain: number, underground: boolean): number {
    if (underground) return 0;
    const warm = THREE.MathUtils.clamp(1 - chill * 5, 0, 1) * (1 - snow);
    return THREE.MathUtils.clamp(night * warm * (1 - rain * 1.5), 0, 1);
  }

  update(dt: number, time: number, camera: THREE.PerspectiveCamera, viewportHeight: number, center: THREE.Vector3, amount: number): void {
    // Sanft ein- und ausblenden, wenn die Nacht kommt oder Regen einsetzt.
    this.amount += (amount - this.amount) * Math.min(1, dt * 0.5);
    this.points.visible = this.amount > 0.01;
    if (!this.points.visible) return;
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uAmount.value = this.amount;
    u.uPx.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const hm = this.heightMap;
    for (let i = 0; i < COUNT; i++) {
      const f = this.flies[i];
      const dx = f.home.x - center.x;
      const dz = f.home.z - center.z;
      if (!(dx * dx + dz * dz < RADIUS * RADIUS)) this.respawn(f, center);
      // Taumeln um den Heimatpunkt: verschiedene Frequenzen je Achse.
      const t = time * f.speed + f.phase;
      const x = f.home.x + Math.sin(t * 0.9) * 1.6 + Math.sin(t * 2.3) * 0.3;
      const z = f.home.z + Math.cos(t * 0.7) * 1.6 + Math.cos(t * 1.9) * 0.3;
      const y = hm.heightAt(x, z) + f.home.y + Math.sin(t * 1.3) * 0.35;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
    }
    this.attr.needsUpdate = true;
  }

  private respawn(f: Fly, center: THREE.Vector3): void {
    const hm = this.heightMap;
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2;
      // Nicht direkt vor der Nase auftauchen.
      const r = 3 + (RADIUS - 3) * Math.sqrt(Math.random());
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      // Nicht über dem Wasser und nicht am Strand.
      if (hm.heightAt(x, z) < hm.waterLevel + 1) continue;
      f.home.set(x, 0.4 + Math.random() * 1.8, z);
      return;
    }
    f.home.set(center.x, 0.8, center.z + RADIUS * 0.8);
  }
}
