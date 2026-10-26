import * as THREE from 'three';
import type { HeightMap } from './HeightMap';

/**
 * Spuren im Schnee: Stiefel des Spielers, nackte Füße der Schrate, Hufe, Pfoten und Hasenläufe bleiben
 * als flache Abdrücke auf dem Boden liegen. Wer im Winter einer frischen Wolfsfährte folgt, findet
 * das Rudel – und das Rudel findet umgekehrt den Spieler.
 *
 * Abdrücke verblassen mit der Zeit; Neuschnee deckt sie schneller zu, Tauwetter lässt sie verschwinden.
 * Gezeichnet als ein instanziertes Mesh mit einem gemalten Atlas (vier Formen).
 */

export type TrackKind = 'boot' | 'hoof' | 'paw' | 'rabbit';
const TILE: Record<TrackKind, number> = { boot: 0, hoof: 1, paw: 2, rabbit: 3 };
/** Breite × Länge eines Abdrucks (m). */
const SIZE: Record<TrackKind, [number, number]> = {
  boot: [0.13, 0.3],
  hoof: [0.09, 0.11],
  paw: [0.1, 0.12],
  rabbit: [0.12, 0.2],
};

const MAX = 900;
/** Lebensdauer eines Abdrucks bei ruhigem Wetter (s). */
const LIFE = 320;
/** Mindestschnee, ab dem Spuren entstehen. */
const MIN_SNOW = 0.35;

/** Atlas mit vier Abdrücken (Zehen bzw. Spitze oben). */
function makeAtlas(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const T = 128;
  const c = document.createElement('canvas');
  c.width = T * 4;
  c.height = T;
  const g = c.getContext('2d')!;
  // Vertiefung: blaugrauer Schatten, zur Mitte dunkler; Rand weich.
  const dent = (x: number, y: number, rx: number, ry: number, rot = 0) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.scale(1, ry / rx);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    grad.addColorStop(0, 'rgba(92,104,130,1)');
    grad.addColorStop(0.7, 'rgba(128,140,165,0.9)');
    grad.addColorStop(1, 'rgba(190,198,212,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  // Stiefel: Sohle, Absatz, Profilrillen.
  dent(64, 40, 26, 38);
  dent(64, 100, 20, 22);
  g.fillStyle = 'rgba(95,105,128,0.5)';
  for (let i = 0; i < 6; i++) g.fillRect(46, 18 + i * 9, 36, 3);
  // Huf: zwei Schalen
  dent(T + 50, 64, 16, 44, -0.08);
  dent(T + 78, 64, 16, 44, 0.08);
  // Pfote: Ballen und vier Zehen, Krallenspitzen
  dent(T * 2 + 64, 84, 24, 22);
  for (const [x, y] of [
    [44, 50],
    [57, 34],
    [71, 34],
    [84, 50],
  ]) {
    dent(T * 2 + x, y, 10, 13);
    dent(T * 2 + x + (x - 64) * 0.12, y - 15, 3, 4);
  }
  // Hase: zwei lange Hinterläufe vorne, zwei kleine Vorderpfoten hintereinander
  dent(T * 3 + 46, 34, 12, 28);
  dent(T * 3 + 82, 34, 12, 28);
  dent(T * 3 + 64, 82, 10, 12);
  dent(T * 3 + 64, 108, 10, 12);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class SnowTracks {
  readonly mesh: THREE.InstancedMesh;
  private readonly tile = new Float32Array(MAX);
  private readonly fade = new Float32Array(MAX);
  private readonly age = new Float32Array(MAX).fill(Infinity);
  private readonly tileAttr: THREE.InstancedBufferAttribute;
  private readonly fadeAttr: THREE.InstancedBufferAttribute;
  private next = 0;
  private count = 0;
  private refresh = 0;
  /** Schneehöhe (0..1) und Schneefall (0..1) – vom Klima gesetzt. */
  snow = 0;
  snowfall = 0;
  /** In der Höhle o. Ä.: keine neuen Spuren. */
  enabled = true;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qYaw = new THREE.Quaternion();
  private readonly n = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly normal: [number, number, number] = [0, 1, 0];

  constructor(private readonly heightMap: HeightMap) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.tileAttr = new THREE.InstancedBufferAttribute(this.tile, 1);
    this.fadeAttr = new THREE.InstancedBufferAttribute(this.fade, 1);
    geo.setAttribute('aTile', this.tileAttr);
    geo.setAttribute('aFade', this.fadeAttr);
    // Abdrücke dunkeln den Schnee darunter ab (multiplikativ): so bleiben sie auch auf grell
    // beleuchtetem Schnee sichtbar und sind nachts genauso dunkel wie ihre Umgebung.
    const mat = new THREE.MeshBasicMaterial({
      map: makeAtlas(),
      transparent: true,
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aTile;\nattribute float aFade;\nvarying float vTrackFade;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x = (vMapUv.x + aTile) * 0.25;\n#endif\nvTrackFade = aFade;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vTrackFade;')
        .replace(
          '#include <map_fragment>',
          '#include <map_fragment>\ndiffuseColor.rgb = mix(vec3(1.0), vec3(0.1, 0.12, 0.18), diffuseColor.a * vTrackFade);\ndiffuseColor.a = 1.0;',
        );
    };
    mat.customProgramCacheKey = () => 'snow-tracks';
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.name = 'SnowTracks';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /**
   * Abdruck setzen.
   * @param heading Laufrichtung (Winkel wie `atan2(dx, dz)`).
   * @param side seitlicher Versatz (m, + = rechts) – linker und rechter Fuß.
   */
  add(kind: TrackKind, pos: THREE.Vector3, heading: number, side = 0, scale = 1): void {
    if (!this.enabled || this.snow < MIN_SNOW) return;
    const hm = this.heightMap;
    const x = pos.x + Math.cos(heading) * side;
    const z = pos.z - Math.sin(heading) * side;
    const h = hm.heightAt(x, z);
    // Nur auf verschneitem Boden: oberhalb der Schneegrenze am Strand und nicht am steilen Hang.
    if (h < hm.waterLevel + 2 || Math.abs(pos.y - h) > 0.6) return;
    const nrm = hm.normalAt(x, z, this.normal);
    if (nrm[1] < 0.8) return;
    this.n.set(nrm[0], nrm[1], nrm[2]);
    this.q.setFromUnitVectors(this.up, this.n);
    this.qYaw.setFromAxisAngle(this.up, heading + Math.PI);
    this.q.multiply(this.qYaw);
    const [w, l] = SIZE[kind];
    this.p.set(x, h + 0.04, z);
    this.s.set(w * scale, 1, l * scale);
    this.m.compose(this.p, this.q, this.s);
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.count = Math.min(MAX, this.count + 1);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tile[i] = TILE[kind];
    this.age[i] = 0;
    this.fade[i] = 1;
    this.tileAttr.needsUpdate = true;
    this.fadeAttr.needsUpdate = true;
    this.mesh.count = this.count;
  }

  update(dt: number): void {
    // Neuschnee deckt Spuren schneller zu.
    const aging = dt * (1 + 5 * this.snowfall);
    for (let i = 0; i < this.count; i++) this.age[i] += aging;
    this.refresh -= dt;
    if (this.refresh > 0) return;
    this.refresh = 0.5;
    // Tauwetter: alle Spuren verblassen mit dem Schnee.
    const ground = THREE.MathUtils.smoothstep(this.snow, MIN_SNOW - 0.1, MIN_SNOW + 0.15);
    for (let i = 0; i < this.count; i++) {
      const t = this.age[i] / LIFE;
      this.fade[i] = t >= 1 ? 0 : (1 - t * t) * ground * 0.85;
    }
    this.fadeAttr.needsUpdate = true;
    this.mesh.visible = ground > 0.01 && this.count > 0;
  }

  /** Alles zurücksetzen (z. B. nach dem Laden). */
  clear(): void {
    this.count = 0;
    this.next = 0;
    this.mesh.count = 0;
    this.age.fill(Infinity);
  }
}
