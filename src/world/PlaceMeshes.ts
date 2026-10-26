import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { texturize } from './SurfaceTextures';
import { injectSeason } from './SeasonShader';
import type { PlaceKind } from './Places';
import type { HeightMap } from './HeightMap';
import { deriveSeed, mulberry32 } from '../utils/random';

/**
 * Modelle der besonderen Orte (Absturzstelle, Zeche, Hütte im Moor, Funkstation) aus einfachen Körpern
 * mit Foto-Oberflächen. Alles in lokalen Koordinaten des Ortes (Ursprung am Bauplatz, +Z = Blickrichtung
 * des Ortes); `systems/Places` setzt es in die Welt und erzeugt Kollision, Behälter und Notizen.
 */

export type PlaceLootKind = 'suitcase' | 'cockpit' | 'medbox' | 'locker' | 'toolbox' | 'crate' | 'chest' | 'shelf' | 'desk' | 'spares' | 'safe' | 'sacristy' | 'stash' | 'oilstore';

export const PLACE_LOOT_LABELS: Record<PlaceLootKind, string> = {
  suitcase: 'Koffer',
  cockpit: 'Cockpit',
  medbox: 'Erste-Hilfe-Kasten',
  locker: 'Spind',
  toolbox: 'Werkzeugkiste',
  crate: 'Kiste',
  chest: 'Truhe',
  shelf: 'Regal',
  desk: 'Schreibtisch',
  spares: 'Ersatzteilkiste',
  safe: 'Tresor',
  sacristy: 'Sakristeischrank',
  stash: 'Schmugglerkiste',
  oilstore: 'Ölschuppen',
};

export interface PlaceCollider {
  half: THREE.Vector3;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Hindernis für die Wegfindung. */
  nav: boolean;
}

export interface PlaceLight {
  position: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  distance: number;
  /** Laterne (flackert leicht, nur nachts), Warnlicht (blinkt), Glut (Feuer), Leuchtröhre (immer an, setzt aus). */
  mode: 'lamp' | 'blink' | 'fire' | 'flicker';
}

export interface PlaceModel {
  group: THREE.Group;
  colliders: PlaceCollider[];
  containers: { kind: PlaceLootKind; position: THREE.Vector3 }[];
  notes: { id: string; position: THREE.Vector3 }[];
  lights: PlaceLight[];
  /** Feuer (schwelendes Triebwerk …): Mittelpunkt und Größe. */
  fires: { position: THREE.Vector3; size: number }[];
  /** Blinkende Warnlampe (Mesh mit leuchtendem Material). */
  beacons: THREE.Mesh[];
  /** Benutzbare Dinge (Funkgerät …). */
  uses: { id: string; position: THREE.Vector3 }[];
  /** Drehende Teile (Leuchtfeuer): Umdrehungen pro Sekunde in Radiant. */
  spinners: { object: THREE.Object3D; speed: number }[];
  /** Lichtkegel, die nur nachts sichtbar sind. */
  beams: THREE.Mesh[];
}

/** Brandfleck: dunkel in der Mitte, zum Rand hin ausgefranst. */
function scorchTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 60; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * S * 0.32;
    const x = S / 2 + Math.cos(a) * d;
    const y = S / 2 + Math.sin(a) * d;
    const r = S * (0.08 + rnd() * 0.16);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}

const std = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const seasonal = (m: THREE.MeshStandardMaterial, bias = 0) => {
  m.onBeforeCompile = (shader) => injectSeason(shader, { snowBias: bias });
  return m;
};

const M = {
  planks: texturize(seasonal(std(0x80705a)), 'planks', 0.5),
  oldPlanks: texturize(seasonal(std(0x6a6656)), 'planks', 0.45),
  concrete: texturize(seasonal(std(0xa29e94)), 'plaster', 0.4),
  hull: std(0xbdbbb1, { metalness: 0.3, roughness: 0.6 }),
  hullShell: std(0xc4c2b8, { metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide }),
  interior: std(0x080808, { roughness: 1, side: THREE.BackSide }),
  flap: std(0xa8a69c, { metalness: 0.3, roughness: 0.65, side: THREE.DoubleSide }),
  hullDirty: std(0xa8a69c, { metalness: 0.3, roughness: 0.65 }),
  stripe: std(0x8e2620, { roughness: 0.6 }),
  metal: std(0x45484b, { metalness: 0.6, roughness: 0.55 }),
  rust: std(0x6b3a22, { roughness: 0.9, metalness: 0.2 }),
  dark: std(0x080808, { roughness: 1 }),
  glass: std(0x1a2126, { roughness: 0.15, metalness: 0.2 }),
  fabric: std(0x313b52, { roughness: 0.95 }),
  scorch: new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 1, transparent: true, alphaMap: scorchTexture(), depthWrite: false }),
  bone: std(0xd6cbb2, { roughness: 0.8 }),
  rope: std(0x8b7a58, { roughness: 1 }),
  coal: std(0x252525, { roughness: 0.95, flatShading: true }),
  redPaint: std(0x8c2b25, { roughness: 0.6 }),
  bluePaint: std(0x2c4a6e, { roughness: 0.6 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0x302010, emissive: new THREE.Color(1, 0.62, 0.28), emissiveIntensity: 3 }),
  beacon: new THREE.MeshStandardMaterial({ color: 0x300000, emissive: new THREE.Color(1, 0.08, 0.05), emissiveIntensity: 0 }),
};
const PAPER = std(0xe6dfcc, { side: THREE.DoubleSide });
const SUITCASE_COLORS = [0x2d3c55, 0x6b2a24, 0x2b2b2b, 0x56603a, 0x7a6248].map((c) => std(c, { roughness: 0.7 }));

/** Sammelt Meshes und Kollider eines Ortes. */
class Builder {
  readonly group = new THREE.Group();
  readonly model: PlaceModel;
  /** Optionaler Rahmen (z. B. das schräg liegende Schiff): alle folgenden Teile liegen darin. */
  private frame: THREE.Matrix4 | null = null;
  private readonly e = new THREE.Euler();
  private readonly m4 = new THREE.Matrix4();

  constructor(
    name: string,
    /** Bodenhöhe relativ zum Ursprung an einer lokalen Stelle (für Dinge, die auf dem Gelände liegen). */
    readonly ground: (x: number, z: number) => number,
  ) {
    this.group.name = name;
    this.model = { group: this.group, colliders: [], containers: [], notes: [], lights: [], fires: [], beacons: [], uses: [], spinners: [], beams: [] };
  }

  /** Folgende Teile in einem gedrehten/verschobenen Rahmen bauen (null = wieder im Ortsraum). */
  setFrame(pos: [number, number, number] | null, rot: [number, number, number] = [0, 0, 0]): void {
    this.frame = pos ? new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)) : null;
  }

  /** Lage im Ortsraum (Rahmen angewandt). */
  private xf(pos: [number, number, number], rot: [number, number, number]): { p: THREE.Vector3; q: THREE.Quaternion } {
    const p = new THREE.Vector3(...pos);
    const q = new THREE.Quaternion().setFromEuler(this.e.set(...rot));
    if (this.frame) {
      this.m4.compose(p, q, new THREE.Vector3(1, 1, 1)).premultiply(this.frame);
      this.m4.decompose(p, q, new THREE.Vector3());
    }
    return { p, q };
  }

  private point(pos: [number, number, number]): THREE.Vector3 {
    const p = new THREE.Vector3(...pos);
    return this.frame ? p.applyMatrix4(this.frame) : p;
  }

  add(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], shadow = true): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    const { p, q } = this.xf(pos, rot);
    m.position.copy(p);
    m.quaternion.copy(q);
    m.castShadow = shadow;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  /** Quader mit Kollision (`collide` = false: nur Optik). */
  box(mat: THREE.Material, size: [number, number, number], pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], collide = true, nav = true): THREE.Mesh {
    const m = this.add(new THREE.BoxGeometry(...size), mat, pos, rot);
    if (collide) this.collider([size[0] / 2, size[1] / 2, size[2] / 2], pos, rot, nav);
    return m;
  }

  /** Zylinder entlang der lokalen Y-Achse (vor der Drehung); Kollision als umschließender Quader. */
  cyl(mat: THREE.Material, rTop: number, rBot: number, h: number, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], segs = 12, collide = true, open = false): THREE.Mesh {
    const m = this.add(new THREE.CylinderGeometry(rTop, rBot, h, segs, 1, open), mat, pos, rot);
    if (collide) {
      const r = Math.max(rTop, rBot) * 0.9;
      this.collider([r, h / 2, r], pos, rot, true);
    }
    return m;
  }

  collider(half: [number, number, number], pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], nav = true): void {
    const { p, q } = this.xf(pos, rot);
    this.model.colliders.push({ half: new THREE.Vector3(...half), position: p, quaternion: q, nav });
  }

  container(kind: PlaceLootKind, pos: [number, number, number]): void {
    this.model.containers.push({ kind, position: this.point(pos) });
  }

  note(id: string, pos: [number, number, number], rotY = 0): void {
    // Ein Blatt Papier, leicht schräg.
    this.add(new THREE.PlaneGeometry(0.21, 0.28), PAPER, [pos[0], pos[1] + 0.005, pos[2]], [-Math.PI / 2, 0, rotY], false);
    this.model.notes.push({ id, position: this.point(pos) });
  }

  /** Etwas, das man benutzen kann (Funkgerät …). */
  use(id: string, pos: [number, number, number]): void {
    this.model.uses.push({ id, position: this.point(pos) });
  }

  light(pos: [number, number, number], color: number, intensity: number, distance: number, mode: PlaceLight['mode']): void {
    this.model.lights.push({ position: this.point(pos), color: new THREE.Color(color), intensity, distance, mode });
  }

  /** Laterne an einem Haken: Glaskörper leuchtet, dazu ein Licht. */
  lantern(pos: [number, number, number]): void {
    this.add(new THREE.CylinderGeometry(0.07, 0.08, 0.2, 8), M.lamp, pos, [0, 0, 0], false);
    this.add(new THREE.ConeGeometry(0.1, 0.08, 8), M.metal, [pos[0], pos[1] + 0.14, pos[2]], [0, 0, 0], false);
    this.light([pos[0], pos[1] - 0.05, pos[2]], 0xffa04a, 6, 14, 'lamp');
  }

  fire(pos: [number, number, number], size: number): void {
    this.model.fires.push({ position: this.point(pos), size });
    this.light([pos[0], pos[1] + 0.5, pos[2]], 0xff7a2a, 9 * size + 3, 12, 'fire');
  }
}

// ---------------------------------------------------------------------------
// Absturzstelle
// ---------------------------------------------------------------------------

/** Rumpfstück: Röhre mit Fensterreihe und Zierstreifen, offene Bruchkante. */
function fuselage(b: Builder, len: number, pos: [number, number, number], rot: [number, number, number], rng: () => number): void {
  const R = 1.55;
  const seg = new THREE.Group();
  seg.position.set(...pos);
  seg.rotation.set(...rot);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, len, 20, 1, true), M.hullShell);
  shell.rotation.x = Math.PI / 2;
  shell.castShadow = shell.receiveShadow = true;
  seg.add(shell);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.96, R * 0.96, len * 0.98, 16, 1, true), M.interior);
  inner.rotation.x = Math.PI / 2;
  seg.add(inner);
  // Boden im Inneren
  const floor = new THREE.Mesh(new THREE.BoxGeometry(R * 1.6, 0.08, len * 0.96), M.metal);
  floor.position.y = -R * 0.55;
  seg.add(floor);
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, len * 0.98), M.stripe);
    stripe.position.set(side * R * 0.99, -0.1, 0);
    seg.add(stripe);
    for (let z = -len / 2 + 0.8; z < len / 2 - 0.5; z += 0.75) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.24), M.glass);
      win.position.set(side * R * 0.995, 0.35, z);
      seg.add(win);
    }
  }
  // Ausgefranste Bruchkante: ein paar verbogene Blechfetzen.
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2;
    const flap = new THREE.Mesh(new THREE.PlaneGeometry(0.6 + rng() * 0.6, 0.5 + rng() * 0.5), M.flap);
    flap.position.set(Math.cos(a) * R, Math.sin(a) * R, len / 2 + 0.15);
    flap.rotation.set(rng() - 0.2, a + Math.PI / 2, rng() * 0.8);
    seg.add(flap);
  }
  b.group.add(seg);
  // Kollision: Quader um die Röhre (begehbarer Boden innen bleibt außen vor – der Rumpf ist ein Hindernis).
  b.collider([R * 0.9, R * 0.9, len / 2], pos, rot);
}

function buildCrash(b: Builder, rng: () => number): void {
  const g = b.ground;
  // Verbrannte Erde
  const scorch = b.add(new THREE.CircleGeometry(13, 40), M.scorch, [0, g(0, 0) + 0.06, 0], [-Math.PI / 2, 0, 0], false);
  scorch.renderOrder = 1;
  // Bugsektion: kopfüber in den Boden gebohrt, Cockpit nach vorn.
  fuselage(b, 7, [0, g(0, 2) + 1.3, 3.5], [0.22, 0.15, 0.35], rng);
  const nose = b.add(new THREE.SphereGeometry(1.55, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.hull, [0, 0, 0], [Math.PI / 2, 0, 0]);
  nose.scale.set(1, 1.5, 1);
  nose.position.set(0.3, g(0, 8) + 0.4, 7.6);
  nose.rotation.set(Math.PI / 2 + 0.22, 0.15, 0.35);
  // Cockpitscheiben
  b.box(M.glass, [1.6, 0.35, 0.05], [0.35, g(0, 8) + 1.1, 8.1], [0.9, 0.15, 0.35], false);
  b.container('cockpit', [0.3, g(0, 7) + 0.9, 6.8]);
  b.note('bordbuch', [-1.4, g(-1.4, 9.4) + 0.05, 9.4], 0.6);
  // Heckteil: auf der Seite, 14 m weiter, mit Leitwerk.
  fuselage(b, 8, [-3.5, g(-3.5, -9) + 1.2, -9], [0.05, -0.4, 1.35], rng);
  b.box(M.hull, [0.25, 3.2, 2.6], [-6.4, g(-6, -13) + 1.4, -12.6], [0.2, -0.4, 1.35]);
  b.box(M.stripe, [0.27, 0.5, 2.4], [-6.3, g(-6, -13) + 2.4, -12.4], [0.2, -0.4, 1.35], false);
  b.box(M.hull, [5, 0.18, 1.5], [-4.8, g(-5, -13) + 0.6, -13.2], [0.1, -0.4, 0.2]);
  // Tragfläche: abgerissen, schräg an den Bäumen.
  b.box(M.hullDirty, [11, 0.32, 2.3], [7.5, g(7.5, -2) + 1.0, -2], [0.08, 0.6, -0.14]);
  b.box(M.stripe, [1.2, 0.34, 2.32], [12.3, g(12, -5) + 1.6, -4.8], [0.08, 0.6, -0.14], false);
  // Triebwerk, schwelend
  const ex = 5.5;
  const ez = 6;
  b.cyl(M.metal, 0.65, 0.75, 2.6, [ex, g(ex, ez) + 0.7, ez], [Math.PI / 2, 0.4, 0.1], 14);
  b.cyl(M.dark, 0.5, 0.5, 0.1, [ex + 0.5, g(ex, ez) + 0.7, ez + 1.25], [Math.PI / 2, 0.4, 0.1], 14, false);
  b.model.fires.push({ position: new THREE.Vector3(ex, g(ex, ez) + 1.1, ez), size: 0.55 });
  b.light([ex, g(ex, ez) + 1.5, ez], 0xff7a2a, 9, 12, 'fire');
  // Sitzreihen, herausgeschleudert
  for (let i = 0; i < 7; i++) {
    const x = (rng() - 0.5) * 18;
    const z = (rng() - 0.5) * 18;
    if (Math.hypot(x, z - 3) < 3) continue;
    const yaw = rng() * Math.PI * 2;
    const tip = rng() < 0.5 ? Math.PI / 2 : 0;
    const y = g(x, z);
    b.box(M.fabric, [1.4, 0.15, 0.5], [x, y + 0.45, z], [tip, yaw, 0], true, false);
    b.box(M.fabric, [1.4, 0.7, 0.12], [x, y + 0.8, z], [tip, yaw, 0], false);
  }
  // Koffer, verstreut
  const cases: [number, number][] = [
    [-5, 4],
    [3, -6],
    [9, 6],
    [-8, -3],
    [1, 11],
  ];
  cases.forEach(([x, z], i) => {
    const y = g(x, z);
    const yaw = rng() * Math.PI * 2;
    b.box(SUITCASE_COLORS[i % SUITCASE_COLORS.length], [0.72, 0.26, 0.48], [x, y + 0.13, z], [0, yaw, rng() * 0.2], true, false);
    b.container('suitcase', [x, y + 0.2, z]);
  });
  // Erste-Hilfe-Kasten am Heck
  b.box(std(0xb8b2a4), [0.5, 0.35, 0.18], [-1.6, g(-1.6, -6) + 0.18, -6], [0, 0.4, 0], true, false);
  b.box(M.stripe, [0.16, 0.16, 0.19], [-1.6, g(-1.6, -6) + 0.2, -6], [0, 0.4, 0], false);
  b.container('medbox', [-1.6, g(-1.6, -6) + 0.25, -6]);
  // Trümmer: Blechfetzen
  for (let i = 0; i < 16; i++) {
    const x = (rng() - 0.5) * 28;
    const z = (rng() - 0.5) * 28;
    const s = 0.3 + rng() * 0.9;
    b.box(rng() < 0.6 ? M.hullDirty : M.metal, [s, 0.04, s * (0.5 + rng())], [x, g(x, z) + 0.05, z], [rng() * 0.6, rng() * 6, rng() * 0.6], false);
  }
}

// ---------------------------------------------------------------------------
// Zeche
// ---------------------------------------------------------------------------

function buildMine(b: Builder, rng: () => number): void {
  const g = b.ground;
  // Mundloch: Türstock aus Balken vor der Höhlenöffnung (lokal +Z in den Hang).
  const gz = 0.3;
  for (const side of [-1, 1]) b.box(M.oldPlanks, [0.3, 3.4, 0.3], [side * 1.55, g(side * 1.5, gz) + 1.5, gz], [0, 0, side * -0.05]);
  b.box(M.oldPlanks, [3.8, 0.35, 0.35], [0, g(0, gz) + 3.2, gz]);
  // Schild "Glück auf"
  const sign = b.box(M.planks, [1.8, 0.45, 0.06], [0, g(0, gz) + 3.65, gz - 0.12], [0, 0, 0.03], false);
  sign.name = 'MineSign';
  b.lantern([1.25, g(1.2, gz) + 2.7, gz - 0.25]);
  // Gleise aus dem Stollen in den Hof
  for (let z = -1; z > -16; z -= 0.9) b.box(M.oldPlanks, [1.5, 0.1, 0.22], [0, g(0, z) + 0.05, z], [0, 0, 0], false);
  for (const side of [-0.5, 0.5]) {
    for (let z = -1; z > -16; z -= 3) {
      const y0 = g(side, z);
      const y1 = g(side, z - 3);
      b.box(M.rust, [0.07, 0.1, 3.05], [side, (y0 + y1) / 2 + 0.14, z - 1.5], [Math.atan2(y0 - y1, 3), 0, 0], false);
    }
  }
  // Förderwagen mit Erz
  const cz = -6;
  const cy = g(0, cz) + 0.62;
  b.box(M.rust, [1.0, 0.7, 1.5], [0, cy, cz], [0, 0, 0], true);
  b.add(new THREE.SphereGeometry(0.55, 7, 5), M.coal, [0, cy + 0.35, cz], [0, 0, 0]).scale.set(0.9, 0.5, 1.2);
  for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) b.cyl(M.metal, 0.2, 0.2, 0.08, [sx, cy - 0.38, cz + sz], [0, 0, Math.PI / 2], 10, false);
  // Abraumhalde
  const hx = 7;
  const hz = -12;
  b.add(new THREE.ConeGeometry(4, 2.6, 9), M.coal, [hx, g(hx, hz) + 1.0, hz], [0, rng(), 0]);
  b.collider([3, 1.2, 3], [hx, g(hx, hz) + 0.9, hz]);
  // Zechenhaus (Kaue): Holzhaus links im Hof, Tür zum Hof.
  const kx = -7.5;
  const kz = -11;
  const ky = g(kx, kz);
  const W = 5;
  const D = 4;
  const H = 2.7;
  b.box(M.planks, [W, 0.15, D], [kx, ky + 0.08, kz], [0, 0, 0], true, false);
  b.box(M.planks, [W, H, 0.12], [kx, ky + H / 2, kz - D / 2]);
  b.box(M.planks, [0.12, H, D], [kx - W / 2, ky + H / 2, kz]);
  b.box(M.planks, [0.12, H, D], [kx + W / 2, ky + H / 2, kz]);
  // Vorderwand mit Tür (zum Gleis hin, +Z)
  b.box(M.planks, [1.6, H, 0.12], [kx - 1.7, ky + H / 2, kz + D / 2]);
  b.box(M.planks, [2.2, H, 0.12], [kx + 1.4, ky + H / 2, kz + D / 2]);
  b.box(M.planks, [1.2, 0.6, 0.12], [kx - 0.3, ky + H - 0.3, kz + D / 2]);
  // Fenster (dunkel)
  b.box(M.glass, [0.9, 0.6, 0.14], [kx + 1.4, ky + 1.6, kz + D / 2], [0, 0, 0], false);
  // Pultdach
  b.box(M.oldPlanks, [W + 0.6, 0.12, D + 0.8], [kx, ky + H + 0.25, kz], [0.12, 0, 0]);
  // Einrichtung
  b.box(M.metal, [0.6, 1.8, 0.5], [kx + 1.9, ky + 0.95, kz - 1.6]);
  b.container('locker', [kx + 1.9, ky + 1.2, kz - 1.35]);
  b.box(M.planks, [1.4, 0.06, 0.8], [kx - 1.2, ky + 0.82, kz - 1.3]);
  for (const [lx, lz] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.35], [0.6, 0.35]]) b.box(M.planks, [0.06, 0.8, 0.06], [kx - 1.2 + lx, ky + 0.42, kz - 1.3 + lz], [0, 0, 0], false);
  b.note('zeche', [kx - 1.3, ky + 0.86, kz - 1.3], 0.3);
  b.box(M.redPaint, [0.6, 0.35, 0.35], [kx + 0.4, ky + 0.25, kz - 1.5], [0, 0.2, 0], true, false);
  b.container('toolbox', [kx + 0.4, ky + 0.45, kz - 1.5]);
  b.lantern([kx - 0.3, ky + 2.3, kz + D / 2 + 0.25]);
  // Kisten im Hof
  for (let i = 0; i < 3; i++) {
    const x = 3 + i * 0.9;
    const z = -4 - (i % 2) * 0.9;
    b.box(M.oldPlanks, [0.8, 0.7, 0.8], [x, g(x, z) + 0.35, z], [0, rng() * 0.4, 0]);
  }
  b.container('crate', [3.9, g(3.9, -4) + 0.75, -4]);
}

// ---------------------------------------------------------------------------
// Hütte im Moor
// ---------------------------------------------------------------------------

function buildHut(b: Builder, rng: () => number, water: number): void {
  const deck = water + 1.25;
  // Pfähle bis in den Schlamm
  for (const [x, z] of [[-2.3, -2.3], [2.3, -2.3], [-2.3, 2.3], [2.3, 2.3], [0, -2.3], [0, 2.3]]) {
    const y0 = b.ground(x, z) - 0.6;
    b.cyl(M.oldPlanks, 0.13, 0.15, deck - y0, [x, (deck + y0) / 2, z], [0, 0, (rng() - 0.5) * 0.05], 7);
  }
  // Plattform mit Veranda (vorn, −Z: dort kommt der Steg an)
  b.box(M.oldPlanks, [5, 0.16, 6.2], [0, deck, -0.6]);
  // Hütte
  const W = 4;
  const D = 4;
  const H = 2.4;
  const y = deck + 0.08;
  b.box(M.oldPlanks, [W, H, 0.1], [0, y + H / 2, D / 2]);
  b.box(M.oldPlanks, [0.1, H, D], [-W / 2, y + H / 2, 0]);
  b.box(M.oldPlanks, [0.1, H, D], [W / 2, y + H / 2, 0]);
  b.box(M.oldPlanks, [1.3, H, 0.1], [-1.35, y + H / 2, -D / 2]);
  b.box(M.oldPlanks, [1.3, H, 0.1], [1.35, y + H / 2, -D / 2]);
  b.box(M.oldPlanks, [1.4, 0.5, 0.1], [0, y + H - 0.25, -D / 2]);
  // Satteldach
  for (const s of [-1, 1]) b.box(M.oldPlanks, [2.6, 0.1, D + 1.4], [s * 1.15, y + H + 0.55, -0.2], [0, 0, s * -0.5]);
  // Einrichtung
  b.box(M.oldPlanks, [1.6, 1.4, 0.4], [-1.1, y + 0.7, D / 2 - 0.3]);
  b.container('shelf', [-1.1, y + 1.0, D / 2 - 0.45]);
  b.box(M.planks, [0.9, 0.5, 0.55], [1.3, y + 0.25, 1.2], [0, 0.3, 0]);
  b.container('chest', [1.3, y + 0.55, 1.2]);
  b.box(M.planks, [0.8, 0.06, 0.6], [1.3, y + 0.75, -0.8]);
  b.note('einsiedlerin', [1.3, y + 0.79, -0.8], 0.4);
  b.lantern([-0.9, y + 2.1, -D / 2 - 0.35]);
  // Totems: Knochen und Geweih an Schnüren vor der Tür
  for (let i = 0; i < 5; i++) {
    const x = -2 + i;
    const z = -3.6;
    b.cyl(M.rope, 0.008, 0.008, 0.6, [x * 0.9, y + H - 0.1, z], [0, 0, 0], 4, false);
    b.cyl(M.bone, 0.025, 0.03, 0.28, [x * 0.9, y + H - 0.55, z], [0.3 * (rng() - 0.5), 0, 0.5 * (rng() - 0.5)], 6, false);
  }
  // Bohlensteg zum Ufer (−Z), leicht unregelmäßig
  for (let z = -3.8; z > -12.5; z -= 0.45) {
    const sag = Math.sin((z + 3.8) * 0.4) * 0.05;
    b.box(M.oldPlanks, [1.3, 0.08, 0.38], [(rng() - 0.5) * 0.08, deck - 0.25 + sag + (z + 3.8) * 0.06, z], [0, (rng() - 0.5) * 0.08, 0], false);
  }
  // Begehbarer Steg als eine schräge Fläche
  b.collider([0.65, 0.06, 4.4], [0, deck - 0.25 - 0.26, -8.1], [-Math.atan(0.06), 0, 0], false);
  for (let z = -4.5; z > -12.5; z -= 2.2) {
    for (const side of [-0.6, 0.6]) {
      const y0 = b.ground(side, z) - 0.5;
      const top = deck - 0.3 + (z + 3.8) * 0.06;
      b.cyl(M.oldPlanks, 0.07, 0.08, top - y0, [side, (top + y0) / 2, z], [0, 0, 0], 6, false);
    }
  }
}

// ---------------------------------------------------------------------------
// Funkstation
// ---------------------------------------------------------------------------

/** Dreibeiniger Gittermast mit Zickzack-Streben. */
function lattice(height: number, base: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const legs: THREE.Vector3[] = [0, 1, 2].map((i) => new THREE.Vector3(Math.cos((i / 3) * Math.PI * 2), 0, Math.sin((i / 3) * Math.PI * 2)));
  const at = (leg: THREE.Vector3, y: number) => {
    const r = base * (1 - (y / height) * 0.7);
    return new THREE.Vector3(leg.x * r, y, leg.z * r);
  };
  const strut = (a: THREE.Vector3, c: THREE.Vector3, r: number) => {
    const len = a.distanceTo(c);
    const g = new THREE.CylinderGeometry(r, r, len, 4);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize());
    g.applyQuaternion(q);
    g.translate(a.x, a.y, a.z);
    parts.push(g);
  };
  for (const leg of legs) strut(at(leg, 0), at(leg, height), 0.07);
  const step = 1.6;
  for (let y = 0; y < height - step; y += step) {
    for (let i = 0; i < 3; i++) {
      const l0 = legs[i];
      const l1 = legs[(i + 1) % 3];
      strut(at(l0, y), at(l1, y + step), 0.025);
      strut(at(l1, y), at(l0, y + step), 0.025);
    }
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

function buildRadio(b: Builder): void {
  const g = b.ground;
  const y = g(0, 0);
  // Mast hinten rechts, mit Warnlicht
  const mx = 5;
  const mz = 4;
  const H = 30;
  b.add(lattice(H, 1.1), M.metal, [mx, g(mx, mz), mz]);
  b.collider([1.0, H / 2, 1.0], [mx, g(mx, mz) + H / 2, mz]);
  const beacon = b.add(new THREE.SphereGeometry(0.22, 10, 8), M.beacon.clone(), [mx, g(mx, mz) + H + 0.25, mz], [0, 0, 0], false);
  b.model.beacons.push(beacon);
  b.light([mx, g(mx, mz) + H, mz], 0xff2010, 0, 40, 'blink');
  // Antennenausleger
  b.box(M.metal, [2.2, 0.05, 0.05], [mx, g(mx, mz) + H - 1, mz], [0, 0.4, 0], false);
  b.box(M.metal, [2.2, 0.05, 0.05], [mx, g(mx, mz) + H - 3, mz], [0, 1.4, 0], false);
  // Baracke aus Beton (Tür nach −Z)
  const bx = -3;
  const bz = 0;
  const W = 5;
  const D = 4;
  const Hh = 2.8;
  b.box(M.concrete, [W + 0.4, 0.25, D + 0.4], [bx, y + 0.12, bz], [0, 0, 0], true, false);
  b.box(M.concrete, [W, Hh, 0.2], [bx, y + Hh / 2, bz + D / 2]);
  b.box(M.concrete, [0.2, Hh, D], [bx - W / 2, y + Hh / 2, bz]);
  b.box(M.concrete, [0.2, Hh, D], [bx + W / 2, y + Hh / 2, bz]);
  b.box(M.concrete, [1.7, Hh, 0.2], [bx - 1.65, y + Hh / 2, bz - D / 2]);
  b.box(M.concrete, [2.1, Hh, 0.2], [bx + 1.45, y + Hh / 2, bz - D / 2]);
  b.box(M.concrete, [1.2, 0.7, 0.2], [bx - 0.2, y + Hh - 0.35, bz - D / 2]);
  b.box(M.glass, [1.2, 0.7, 0.22], [bx + 1.45, y + 1.6, bz - D / 2], [0, 0, 0], false);
  b.box(M.concrete, [W + 0.5, 0.2, D + 0.5], [bx, y + Hh + 0.1, bz]);
  // Funktisch mit Geräten
  b.box(M.planks, [2.2, 0.06, 0.8], [bx - 0.8, y + 0.85, bz + 1.4]);
  b.box(M.metal, [2.2, 0.8, 0.7], [bx - 0.8, y + 0.42, bz + 1.4], [0, 0, 0], true, false);
  b.container('desk', [bx - 1.5, y + 0.95, bz + 1.3]);
  b.box(std(0x3a3d36, { roughness: 0.5 }), [0.7, 0.4, 0.45], [bx - 0.4, y + 1.1, bz + 1.5], [0, 0, 0], false);
  b.box(std(0x2a2a2a, { roughness: 0.4 }), [0.5, 0.3, 0.35], [bx - 1.3, y + 1.03, bz + 1.55], [0, 0.1, 0], false);
  b.note('funk3', [bx - 0.9, y + 0.89, bz + 1.15], -0.2);
  b.use('transmitter', [bx - 0.4, y + 1.1, bz + 1.5]);
  b.box(M.metal, [0.6, 1.8, 0.5], [bx + 2.0, y + 0.95, bz + 1.5]);
  b.container('locker', [bx + 2.0, y + 1.2, bz + 1.25]);
  b.lantern([bx - 0.2, y + 2.4, bz - D / 2 - 0.3]);
  // Generator und Fässer
  b.box(M.bluePaint, [1.4, 0.9, 0.8], [bx + 4, g(bx + 4, -3) + 0.45, -3]);
  b.cyl(M.redPaint, 0.3, 0.3, 0.9, [bx + 5.1, g(bx + 5, -2.5) + 0.45, -2.5]);
  b.cyl(M.rust, 0.3, 0.3, 0.9, [bx + 5.6, g(bx + 5.6, -3.4) + 0.45, -3.4]);
  b.cyl(M.redPaint, 0.3, 0.3, 0.9, [bx + 5.2, g(bx + 5.2, -4.1) + 0.3, -4.1], [Math.PI / 2, 0.4, 0]);
  // Zaun (Pfosten mit Draht), Tor vorn
  const F = 10;
  const posts: [number, number][] = [];
  for (let i = -F; i <= F; i += 2.5) posts.push([i, -F], [i, F], [-F, i], [F, i]);
  for (const [x, z] of posts) {
    if (z === -F && Math.abs(x) < 2) continue;
    b.box(M.metal, [0.08, 1.9, 0.08], [x, g(x, z) + 0.95, z], [0, 0, 0], false);
  }
  const wire = (ax: number, az: number, cx: number, cz: number) => {
    const len = Math.hypot(cx - ax, cz - az);
    const yaw = Math.atan2(cx - ax, cz - az);
    for (const h of [0.5, 1.0, 1.5, 1.85]) {
      b.box(M.metal, [0.015, 0.015, len], [(ax + cx) / 2, (g(ax, az) + g(cx, cz)) / 2 + h, (az + cz) / 2], [0, yaw, 0], false);
    }
    b.collider([0.05, 1.0, len / 2], [(ax + cx) / 2, (g(ax, az) + g(cx, cz)) / 2 + 1.0, (az + cz) / 2], [0, yaw, 0]);
  };
  wire(-F, F, F, F);
  wire(-F, -F, -F, F);
  wire(F, -F, F, F);
  wire(-F, -F, -2.2, -F);
  wire(2.2, -F, F, -F);
  b.container('crate', [bx + 4, g(bx + 4, -3) + 1.0, -3]);
}

// ---------------------------------------------------------------------------
// Gemeinsames für die späteren Orte
// ---------------------------------------------------------------------------

/** Schriftzug auf transparentem Grund (Schiffsname, Landeplatz-H). */
function textTexture(text: string, color: string, w = 512, h = 128, font = 'bold 84px serif'): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const L = {
  shipHull: std(0x1f2a33, { roughness: 0.7, metalness: 0.25 }),
  shipBand: std(0xd8d3c6, { roughness: 0.7 }),
  shipRust: std(0x5e2f1c, { roughness: 0.95 }),
  deck: texturize(std(0x6f6150), 'planks', 0.5),
  white: std(0xd2cec2, { roughness: 0.65 }),
  funnel: std(0x26292c, { roughness: 0.6 }),
  stone: texturize(seasonal(std(0x8f8a80), 0.1), 'mossyRock', 0.45),
  wallStone: texturize(seasonal(std(0xb3ada0)), 'plaster', 0.4),
  slate: seasonal(std(0x34373c, { roughness: 0.8 }), 0.2),
  bronze: std(0x5a4424, { metalness: 0.6, roughness: 0.45 }),
  dirt: std(0x3a2f22, { roughness: 1 }),
  pit: std(0x050403, { roughness: 1 }),
  wood: texturize(std(0x5b4632), 'planks', 0.45),
  steel: std(0x6e7378, { metalness: 0.6, roughness: 0.45 }),
  labWhite: std(0xd6d6d0, { roughness: 0.5 }),
  jar: new THREE.MeshStandardMaterial({ color: 0x0c2a26, emissive: new THREE.Color(0.1, 0.85, 0.72), emissiveIntensity: 1.6, roughness: 0.2, transparent: true, opacity: 0.85 }),
  glow: new THREE.MeshStandardMaterial({ color: 0x1a4a44, emissive: new THREE.Color(0.15, 0.95, 0.8), emissiveIntensity: 2.2, roughness: 0.5 }),
  tube: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(0.85, 0.95, 1), emissiveIntensity: 2.5 }),
  candle: new THREE.MeshStandardMaterial({ color: 0xe8e0c8, emissive: new THREE.Color(1, 0.7, 0.35), emissiveIntensity: 1.2 }),
};

// ---------------------------------------------------------------------------
// Fährenwrack
// ---------------------------------------------------------------------------

function buildFerry(b: Builder, rng: () => number): void {
  // Das Schiff liegt auf dem Riff: Bug leicht gehoben, Schlagseite nach Steuerbord.
  b.setFrame([0, 0, 0], [-0.04, 0, 0.13]);
  const keel = -2.6;
  const deckY = 1.7;
  const H = deckY - keel;
  // Rumpf: Grundriss mit spitzem Bug, senkrecht extrudiert.
  const shape = new THREE.Shape();
  const pts: [number, number][] = [[-3.4, -13], [3.4, -13], [3.5, 6], [2.4, 11], [0, 14.5], [-2.4, 11], [-3.5, 6]];
  shape.moveTo(pts[0][0], -pts[0][1]);
  for (const [x, z] of pts.slice(1)) shape.lineTo(x, -z);
  shape.closePath();
  const hull = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false });
  hull.rotateX(-Math.PI / 2);
  hull.translate(0, keel, 0);
  b.add(hull, L.shipHull, [0, 0, 0]);
  b.collider([3.4, H / 2, 10], [0, keel + H / 2, -3]);
  b.collider([2.2, H / 2, 3.5], [0, keel + H / 2, 10.5]);
  // Weißer Streifen oben, Rost an der Wasserlinie
  b.box(L.shipBand, [7.1, 0.35, 19.2], [0, deckY - 0.3, -3.5], [0, 0, 0], false);
  b.box(L.shipRust, [7.05, 0.5, 19.1], [0, 0.1, -3.5], [0, 0, 0], false);
  // Deck (begehbar)
  b.box(L.deck, [6.6, 0.12, 19.5], [0, deckY + 0.06, -3.3]);
  b.box(L.deck, [4.2, 0.12, 6], [0, deckY + 0.06, 9], [0, 0, 0], true, false);
  // Reling
  for (const side of [-1, 1]) {
    b.box(L.white, [0.05, 0.05, 19], [side * 3.3, deckY + 1.0, -3.5], [0, 0, 0], false);
    b.collider([0.05, 0.5, 9.5], [side * 3.3, deckY + 0.6, -3.5], [0, 0, 0], false);
    for (let z = -12.5; z < 6; z += 1.6) b.box(L.white, [0.05, 1.0, 0.05], [side * 3.3, deckY + 0.5, z], [0, 0, 0], false);
  }
  // Schiffsname am Bug
  const name = textTexture('ALTWASSER', '#e8e2d2');
  for (const side of [-1, 1]) {
    const plate = b.add(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: name, transparent: true, toneMapped: true }), [side * 3.0, deckY - 1.0, 8.5], [0, side * (Math.PI / 2 - 0.45), 0], false);
    plate.renderOrder = 2;
  }
  // Brücke (hohl, Tür achtern)
  const bz = -2;
  const by = deckY + 0.12;
  const W = 4.8;
  const D = 5;
  const Hb = 2.5;
  b.box(L.white, [W, Hb, 0.12], [0, by + Hb / 2, bz + D / 2]);
  b.box(L.white, [0.12, Hb, D], [-W / 2, by + Hb / 2, bz]);
  b.box(L.white, [0.12, Hb, D], [W / 2, by + Hb / 2, bz]);
  b.box(L.white, [1.6, Hb, 0.12], [-1.6, by + Hb / 2, bz - D / 2]);
  b.box(L.white, [1.6, Hb, 0.12], [1.6, by + Hb / 2, bz - D / 2]);
  b.box(L.white, [W + 0.4, 0.15, D + 0.4], [0, by + Hb + 0.07, bz]);
  b.box(M.glass, [W - 0.4, 0.7, 0.14], [0, by + 1.7, bz + D / 2], [0, 0, 0], false);
  for (const side of [-1, 1]) b.box(M.glass, [0.14, 0.6, 3], [side * W / 2, by + 1.7, bz], [0, 0, 0], false);
  // Steuerstand, Kartentisch
  b.box(M.metal, [2.4, 1.0, 0.6], [0, by + 0.5, bz + 1.9]);
  b.add(new THREE.TorusGeometry(0.35, 0.04, 6, 16), L.wood, [0, by + 1.25, bz + 1.5], [0.4, 0, 0], false);
  b.box(L.wood, [1.2, 0.06, 0.8], [-1.5, by + 0.85, bz - 0.6]);
  b.note('faehre', [-1.5, by + 0.89, bz - 0.6], 0.3);
  b.box(M.metal, [0.6, 1.8, 0.5], [1.9, by + 0.9, bz - 1.6]);
  b.container('locker', [1.9, by + 1.1, bz - 1.35]);
  b.lantern([0, by + Hb - 0.3, bz - D / 2 - 0.3]);
  // Schornstein
  b.cyl(L.funnel, 0.8, 0.9, 2.8, [0, by + Hb + 1.4, bz - 3.8], [-0.12, 0, 0], 14);
  b.cyl(M.stripe, 0.82, 0.82, 0.4, [0, by + Hb + 2.2, bz - 3.9], [-0.12, 0, 0], 14, false);
  // Rettungsboot an Backbord, das an Steuerbord fehlt (nur das Seil hängt).
  b.box(L.white, [1.2, 0.7, 4], [-3.9, deckY + 1.5, -8], [0, 0, 0.1]);
  b.box(M.stripe, [1.25, 0.15, 4.05], [-3.9, deckY + 1.75, -8], [0, 0, 0.1], false);
  for (const z of [-9.6, -6.4]) {
    b.box(M.metal, [0.08, 2.0, 0.08], [-3.3, deckY + 1.0, z], [0, 0, -0.3], false);
    b.box(M.rope, [0.03, 1.8, 0.03], [3.6, deckY + 0.3, z], [0, 0, 0.05], false);
  }
  // Achterdeck: Bänke, Ladung, Luke zum Maschinenraum
  b.box(L.wood, [2.4, 0.45, 0.5], [-1.5, deckY + 0.35, -7], [0, 0, 0], true, false);
  b.note('anne', [-1.5, deckY + 0.59, -7], 1.2);
  b.box(M.metal, [1.6, 0.5, 1.6], [1.2, deckY + 0.35, -10.5]);
  b.box(M.rust, [1.65, 0.08, 1.65], [1.2, deckY + 0.62, -10.5], [0, 0, 0.3], false);
  b.box(M.redPaint, [0.9, 0.5, 0.6], [2.2, deckY + 0.37, -8.8], [0, 0.3, 0], true, false);
  b.container('spares', [2.2, deckY + 0.7, -8.8]);
  for (let i = 0; i < 5; i++) {
    const x = -2 + rng() * 4;
    const z = -12.4 + rng() * 2;
    b.box(M.oldPlanks, [0.9, 0.8, 0.9], [x, deckY + 0.5, z], [0, rng(), 0], true, false);
  }
  // Fallreep: Gangway vom Bug hinunter ins flache Wasser vor dem Strand.
  b.setFrame(null);
  const gz = 15.2;
  const top = deckY + 0.6;
  const footZ = 21;
  const foot = Math.max(b.ground(0, footZ), -0.5);
  const len = Math.hypot(footZ - gz, top - foot);
  const slope = Math.atan2(top - foot, footZ - gz);
  b.box(L.deck, [1.2, 0.1, len], [0, (top + foot) / 2, (gz + footZ) / 2], [slope, 0, 0]);
  for (const side of [-0.6, 0.6]) b.box(M.rope, [0.03, 0.03, len], [side, (top + foot) / 2 + 0.7, (gz + footZ) / 2], [slope, 0, 0], false);
}

// ---------------------------------------------------------------------------
// Kapelle mit Friedhof
// ---------------------------------------------------------------------------

function buildChapel(b: Builder, rng: () => number): void {
  const g = b.ground;
  const y = g(0, 0);
  const W = 7;
  const D = 12;
  const H = 4.4;
  // Schiff der Kapelle, Eingang vorn (+Z)
  b.box(L.wallStone, [W, 0.2, D], [0, y + 0.1, 0], [0, 0, 0], true, false);
  b.box(L.wallStone, [W, H, 0.4], [0, y + H / 2, -D / 2]);
  for (const side of [-1, 1]) {
    b.box(L.wallStone, [0.4, H, D], [side * W / 2, y + H / 2, 0]);
    for (const z of [-3.5, 0, 3.5]) b.box(M.glass, [0.44, 1.8, 0.7], [side * W / 2, y + 2.6, z], [0, 0, 0], false);
  }
  b.box(L.wallStone, [2.7, H, 0.4], [-2.15, y + H / 2, D / 2]);
  b.box(L.wallStone, [2.7, H, 0.4], [2.15, y + H / 2, D / 2]);
  b.box(L.wallStone, [1.6, H - 2.7, 0.4], [0, y + 2.7 + (H - 2.7) / 2, D / 2]);
  // Giebel und Dach
  const gable = new THREE.Shape();
  gable.moveTo(-W / 2, 0);
  gable.lineTo(W / 2, 0);
  gable.lineTo(0, 2.6);
  gable.closePath();
  for (const z of [-D / 2, D / 2]) {
    const geo = new THREE.ExtrudeGeometry(gable, { depth: 0.4, bevelEnabled: false });
    geo.translate(0, 0, -0.2);
    b.add(geo, L.wallStone, [0, y + H, z]);
  }
  for (const side of [-1, 1]) b.box(L.slate, [4.6, 0.15, D + 1], [side * 1.8, y + H + 1.3, 0], [0, 0, side * -0.62]);
  // Glockenturm hinten
  const tz = -D / 2 - 1.6;
  b.box(L.wallStone, [3, 8.5, 3], [0, y + 4.25, tz]);
  b.box(M.dark, [1.2, 1.4, 3.05], [0, y + 7.4, tz], [0, 0, 0], false);
  b.box(M.dark, [3.05, 1.4, 1.2], [0, y + 7.4, tz], [0, 0, 0], false);
  b.add(new THREE.ConeGeometry(1.2, 1.0, 12, 1, true), L.bronze, [0, y + 7.6, tz], [0, 0, 0], false);
  b.add(new THREE.ConeGeometry(2.4, 3.5, 4), L.slate, [0, y + 10.25, tz], [0, Math.PI / 4, 0]);
  b.box(L.bronze, [0.08, 1.2, 0.08], [0, y + 12.5, tz], [0, 0, 0], false);
  b.box(L.bronze, [0.6, 0.08, 0.08], [0, y + 12.7, tz], [0, 0, 0], false);
  // Innen: Bänke, Altar mit Kerzen, Sakristeischrank
  for (let row = 0; row < 5; row++) {
    for (const side of [-1, 1]) {
      const z = 3.8 - row * 1.4;
      const fallen = rng() < 0.25;
      b.box(L.wood, [2.3, 0.45, 0.4], [side * 1.6, y + (fallen ? 0.25 : 0.45), z], [fallen ? 1.2 : 0, (rng() - 0.5) * 0.2, 0], true, false);
      if (!fallen) b.box(L.wood, [2.3, 0.6, 0.08], [side * 1.6, y + 0.85, z - 0.2], [0, 0, 0], false);
    }
  }
  b.box(L.wallStone, [2.2, 1.0, 0.9], [0, y + 0.5, -D / 2 + 1.2]);
  b.note('pfarrer', [0.3, y + 1.01, -D / 2 + 1.2], 0.2);
  for (const x of [-0.8, -0.5, 0.7]) b.cyl(L.candle, 0.03, 0.03, 0.25, [x, y + 1.12, -D / 2 + 1.0], [0, 0, 0], 6, false);
  b.light([0, y + 1.6, -D / 2 + 1.3], 0xffb060, 3, 9, 'lamp');
  b.box(L.wood, [1.0, 2.0, 0.5], [W / 2 - 0.6, y + 1.0, -D / 2 + 1.8]);
  b.container('sacristy', [W / 2 - 0.6, y + 1.3, -D / 2 + 2.1]);
  // Friedhof rechts der Kapelle (+X), drei Gräber offen
  const fx = 9;
  let open = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = fx + c * 2.2 + (rng() - 0.5) * 0.3;
      const z = -4.5 + r * 3 + (rng() - 0.5) * 0.3;
      const gy = g(x, z);
      const isOpen = (r * 4 + c) % 5 === 2 && open < 3;
      if (isOpen) {
        open++;
        b.box(L.pit, [0.9, 0.05, 1.9], [x, gy + 0.03, z], [0, 0, 0], false);
        b.add(new THREE.SphereGeometry(0.7, 7, 5), L.dirt, [x + 1.0, gy, z], [0, rng(), 0]).scale.set(0.8, 0.45, 1.3);
        b.box(L.wood, [0.6, 0.05, 1.8], [x - 0.9, gy + 0.3, z + 0.2], [0.2, 0.3, 1.1], false);
      } else {
        b.box(L.dirt, [0.9, 0.18, 1.9], [x, gy + 0.05, z], [0, 0, 0], false);
      }
      if (rng() < 0.55) {
        b.box(L.wood, [0.1, 1.0, 0.1], [x, gy + 0.5, z - 1.0], [(rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3], false);
        b.box(L.wood, [0.55, 0.09, 0.09], [x, gy + 0.75, z - 1.0], [0, 0, 0], false);
      } else {
        b.box(L.stone, [0.7, 0.85, 0.18], [x, gy + 0.4, z - 1.0], [(rng() - 0.5) * 0.2, 0, (rng() - 0.5) * 0.25], true, false);
      }
    }
  }
  // Friedhofsmauer (niedrig) mit Lücke zur Kapelle
  for (const [x, z, w, d] of [[fx + 3.3, -6.6, 9.6, 0.4], [fx + 3.3, 7.1, 9.6, 0.4], [fx + 8.3, 0.25, 0.4, 13.7]] as const) {
    b.box(L.stone, [w, 0.9, d], [x, g(x, z) + 0.45, z]);
  }
}

// ---------------------------------------------------------------------------
// Labor Nordwand
// ---------------------------------------------------------------------------

function buildLab(b: Builder, rng: () => number): void {
  const g = b.ground;
  const y = g(0, 0);
  const W = 10;
  const D = 7;
  const H = 3.2;
  // Betonbau, Eingang vorn (+Z)
  b.box(M.concrete, [W + 0.4, 0.25, D + 0.4], [0, y + 0.12, 0], [0, 0, 0], true, false);
  b.box(M.concrete, [W, H, 0.25], [0, y + H / 2, -D / 2]);
  b.box(M.concrete, [0.25, H, D], [-W / 2, y + H / 2, 0]);
  b.box(M.concrete, [0.25, H, D], [W / 2, y + H / 2, 0]);
  b.box(M.concrete, [4.2, H, 0.25], [-2.9, y + H / 2, D / 2]);
  b.box(M.concrete, [4.2, H, 0.25], [2.9, y + H / 2, D / 2]);
  b.box(M.concrete, [1.6, 0.8, 0.25], [0, y + H - 0.4, D / 2]);
  for (const x of [-3, 3]) b.box(M.glass, [1.8, 0.8, 0.28], [x, y + 1.9, D / 2], [0, 0, 0], false);
  b.box(M.concrete, [W + 0.5, 0.25, D + 0.5], [0, y + H + 0.12, 0]);
  // Dach: Lüfter, Antenne, Schüssel
  b.cyl(L.steel, 0.35, 0.35, 0.8, [-3, y + H + 0.6, -1.5], [0, 0, 0], 10);
  b.cyl(L.steel, 0.35, 0.35, 0.8, [-1.8, y + H + 0.6, -1.5], [0, 0, 0], 10);
  b.box(M.metal, [0.08, 5, 0.08], [3.8, y + H + 2.5, -2.5], [0, 0, 0], false);
  b.add(new THREE.SphereGeometry(0.9, 14, 8, 0, Math.PI * 2, 0, 0.9), L.labWhite, [2.2, y + H + 0.9, -2], [-0.9, 0.6, 0]);
  // Innen: Labortische mit leuchtenden Probengläsern, Kühltruhe, Schreibtisch, Tresor, Spind
  for (const x of [-2.5, 1.5]) {
    b.box(L.labWhite, [3, 0.9, 1], [x, y + 0.45 + 0.12, -0.5]);
    for (let i = 0; i < 5; i++) {
      const jx = x - 1.2 + i * 0.6 + (rng() - 0.5) * 0.1;
      b.cyl(L.jar, 0.09, 0.09, 0.26 + rng() * 0.1, [jx, y + 1.17, -0.5 + (rng() - 0.5) * 0.4], [0, 0, 0], 10, false);
    }
  }
  b.light([-0.5, y + 1.5, -0.5], 0x40ffd8, 4, 8, 'flicker');
  b.note('labor1', [1.0, y + 1.04, -0.2], 0.4);
  b.box(L.labWhite, [1.8, 0.9, 0.8], [-3.8, y + 0.57, -2.8]);
  b.box(L.wood, [1.6, 0.06, 0.8], [3.6, y + 0.85, -2.6]);
  b.box(M.metal, [1.6, 0.8, 0.7], [3.6, y + 0.45, -2.6], [0, 0, 0], true, false);
  b.note('labor2', [3.4, y + 0.89, -2.6], -0.3);
  b.box(M.dark, [0.8, 0.9, 0.7], [4.4, y + 0.57, 2.6]);
  b.box(L.steel, [0.05, 0.25, 0.25], [4.0, y + 0.65, 2.6], [0, 0, 0], false);
  b.container('safe', [4.1, y + 0.8, 2.6]);
  b.box(M.metal, [0.6, 1.8, 0.5], [-4.4, y + 1.02, 2.4]);
  b.container('locker', [-4.15, y + 1.2, 2.4]);
  // Leuchtröhre an der Decke
  b.box(L.tube, [1.6, 0.06, 0.12], [0, y + H - 0.1, 0], [0, 0, 0], false);
  b.light([0, y + H - 0.4, 0.5], 0xdfeeff, 5, 12, 'flicker');
  // Landeplatz vor dem Gebäude
  const px = 0;
  const pz = 11;
  b.box(M.concrete, [8, 0.15, 8], [px, g(px, pz) + 0.08, pz], [0, 0, 0], true, false);
  const hTex = textTexture('H', '#e8e4d8', 256, 256, 'bold 220px sans-serif');
  const hPlate = b.add(new THREE.PlaneGeometry(5, 5), new THREE.MeshStandardMaterial({ map: hTex, transparent: true, roughness: 0.9 }), [px, g(px, pz) + 0.17, pz], [-Math.PI / 2, 0, 0], false);
  hPlate.renderOrder = 1;
  // Zaun mit Tor
  const F = 15;
  for (let i = -F; i <= F; i += 3) {
    for (const [x, z] of [[i, -F], [-F, i], [F, i]] as [number, number][]) b.box(M.metal, [0.08, 2.0, 0.08], [x, g(x, z) + 1.0, z], [0, 0, 0], false);
  }
  for (const [ax, az, cx, cz] of [[-F, -F, F, -F], [-F, -F, -F, F], [F, -F, F, F]] as const) {
    const len = Math.hypot(cx - ax, cz - az);
    const yaw = Math.atan2(cx - ax, cz - az);
    for (const h of [0.6, 1.2, 1.9]) b.box(M.metal, [0.015, 0.015, len], [(ax + cx) / 2, (g(ax, az) + g(cx, cz)) / 2 + h, (az + cz) / 2], [0, yaw, 0], false);
    b.collider([0.05, 1.0, len / 2], [(ax + cx) / 2, (g(ax, az) + g(cx, cz)) / 2 + 1.0, (az + cz) / 2], [0, yaw, 0]);
  }
}

// ---------------------------------------------------------------------------
// Steinkreis
// ---------------------------------------------------------------------------

function buildStones(b: Builder, rng: () => number): void {
  const g = b.ground;
  const R = 7;
  const N = 9;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (rng() - 0.5) * 0.15;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const h = 2.2 + rng() * 1.6;
    const fallen = i === 4;
    if (fallen) b.box(L.stone, [1.0, 0.6, h], [x * 1.1, g(x, z) + 0.3, z * 1.1], [0, a, 0.1]);
    else b.box(L.stone, [1.0 + rng() * 0.3, h, 0.6 + rng() * 0.25], [x, g(x, z) + h / 2 - 0.2, z], [(rng() - 0.5) * 0.12, -a + Math.PI / 2, (rng() - 0.5) * 0.12]);
  }
  // Altar in der Mitte mit Leuchtpilzen und Knochen
  const y = g(0, 0);
  b.box(L.stone, [0.5, 0.6, 0.5], [-0.6, y + 0.3, 0]);
  b.box(L.stone, [0.5, 0.6, 0.5], [0.6, y + 0.3, 0]);
  b.box(L.stone, [2.2, 0.3, 1.2], [0, y + 0.75, 0], [0, 0.1, 0]);
  for (let i = 0; i < 9; i++) {
    const mx = (rng() - 0.5) * 1.6;
    const mz = (rng() - 0.5) * 0.8;
    b.add(new THREE.SphereGeometry(0.06 + rng() * 0.05, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), L.glow, [mx, y + 0.9, mz], [0, 0, 0], false);
  }
  b.light([0, y + 1.3, 0], 0x40ffd8, 2.5, 7, 'flicker');
  for (let i = 0; i < 4; i++) b.cyl(M.bone, 0.025, 0.03, 0.35, [(rng() - 0.5) * 1.8, y + 0.93, (rng() - 0.5) * 0.9], [Math.PI / 2, rng() * 3, 0], 6, false);
  // Totems mit Geweihen und Schädeln
  for (const a of [0.6, 2.7, 4.6]) {
    const x = Math.cos(a) * 4.2;
    const z = Math.sin(a) * 4.2;
    const ty = g(x, z);
    b.cyl(L.wood, 0.1, 0.13, 3.2, [x, ty + 1.6, z], [(rng() - 0.5) * 0.08, 0, (rng() - 0.5) * 0.08], 7);
    b.add(new THREE.SphereGeometry(0.17, 8, 6), M.bone, [x, ty + 3.25, z], [0, 0, 0]).scale.set(1, 0.85, 1.25);
    for (const s of [-1, 1]) {
      b.cyl(M.bone, 0.02, 0.035, 0.7, [x + s * 0.25, ty + 3.6, z], [0, a, s * 0.7], 5, false);
      b.cyl(M.bone, 0.015, 0.02, 0.35, [x + s * 0.45, ty + 3.85, z], [0.4, a, s * 0.2], 5, false);
    }
  }
  // Feuerstelle vor dem Altar – die Schrate halten sie am Brennen.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box(L.stone, [0.35, 0.25, 0.3], [Math.cos(a) * 0.8, g(0, 3) + 0.12, 3 + Math.sin(a) * 0.8], [0, a, 0], false);
  }
  b.fire([0, g(0, 3) + 0.05, 3], 0.7);
  // Hochsitz des Jägers am Waldrand, seine Aufzeichnungen liegen auf der Kiste darunter.
  const hx = -14;
  const hz = 10;
  const hy = g(hx, hz);
  for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) b.cyl(L.wood, 0.07, 0.08, 3.4, [hx + dx, hy + 1.7, hz + dz], [0, 0, 0], 6);
  b.box(L.wood, [2, 0.1, 2], [hx, hy + 3.2, hz], [0, 0, 0], false);
  b.box(L.wood, [2, 0.9, 0.06], [hx, hy + 3.7, hz - 1], [0, 0, 0], false);
  for (let r = 0.4; r < 3.2; r += 0.4) b.box(L.wood, [0.6, 0.05, 0.05], [hx, hy + r, hz + 1.3], [0, 0, 0], false);
  b.box(M.oldPlanks, [0.7, 0.5, 0.5], [hx + 1.4, hy + 0.25, hz + 0.6]);
  b.note('steinkreis', [hx + 1.4, hy + 0.51, hz + 0.6], 0.5);
}

/**
 * Modell eines Ortes bauen.
 * @param ground Geländehöhe an einer Weltposition
 * @param origin Bauplatz, `yaw` Ausrichtung
 */
// ---------------------------------------------------------------------------
// Leuchtturm
// ---------------------------------------------------------------------------

/** Lichtkegel des Leuchtfeuers: additiv, zur Spitze hin heller, nach außen verblassend. */
function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(1, 0.86, 0.62) } },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vAlong = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform vec3 uColor;
      varying float vAlong;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        // uv.y = 1 an der Spitze (Lampe), 0 am weiten Ende.
        float along = pow(vAlong, 2.2);
        // Hell in der Achse, weich zu den Rändern: Flächen, auf die man frontal sieht, liegen in der Kegelmitte.
        float core = pow(abs(dot(normalize(vNormalV), normalize(vViewDir))), 1.8);
        float a = uOpacity * along * core;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function buildLighthouse(b: Builder, rng: () => number): void {
  const g = b.ground;
  const y = g(0, 0);
  const H = 15;
  const white = std(0xe8e4da, { roughness: 0.7 });
  // Turm: weiß mit zwei roten Bändern, nach oben schlanker.
  b.cyl(white, 1.7, 2.3, H, [0, y + H / 2, 0], [0, 0, 0], 20);
  for (const h of [4.5, 10]) b.cyl(M.redPaint, 2.3 - (h / H) * 0.6 + 0.02, 2.3 - ((h + 1.6) / H) * 0.6 + 0.02, 1.6, [0, y + h + 0.8, 0], [0, 0, 0], 20, false);
  // Sockel und Tür (zur Hauptinsel, +Z)
  b.cyl(M.concrete, 2.8, 3.0, 0.6, [0, y + 0.3, 0], [0, 0, 0], 20, false);
  b.box(M.oldPlanks, [1.0, 2.0, 0.1], [0, y + 1.6, 2.2], [0.06, 0, 0], false);
  // Umgang mit Geländer
  b.cyl(M.metal, 2.4, 2.4, 0.2, [0, y + H + 0.1, 0], [0, 0, 0], 20, false);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    b.box(M.metal, [0.05, 1.0, 0.05], [Math.cos(a) * 2.3, y + H + 0.7, Math.sin(a) * 2.3], [0, 0, 0], false);
  }
  const rail = b.add(new THREE.TorusGeometry(2.3, 0.04, 4, 32), M.metal, [0, y + H + 1.2, 0], [Math.PI / 2, 0, 0], false);
  rail.castShadow = false;
  // Laternenraum: Glas, Lampe, Kuppel
  b.cyl(M.glass, 1.25, 1.25, 2.0, [0, y + H + 1.2, 0], [0, 0, 0], 14, false, false);
  b.add(new THREE.SphereGeometry(0.45, 14, 10), M.lamp, [0, y + H + 1.2, 0], [0, 0, 0], false);
  b.add(new THREE.ConeGeometry(1.5, 1.2, 14), M.redPaint, [0, y + H + 2.8, 0], [0, 0, 0]);
  b.add(new THREE.SphereGeometry(0.16, 8, 6), M.metal, [0, y + H + 3.45, 0], [0, 0, 0], false);
  b.light([0, y + H + 1.2, 0], 0xffd9a0, 40, 60, 'lamp');
  // Drehendes Leuchtfeuer: zwei gegenüberliegende Lichtkegel, 90 m lang.
  const spin = new THREE.Group();
  spin.position.set(0, y + H + 1.2, 0);
  const L = 90;
  for (const dir of [1, -1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(9, L, 24, 1, true), beamMaterial());
    // Spitze an der Lampe, Kegel waagerecht (leicht abwärts) nach außen.
    cone.rotation.z = dir * (Math.PI / 2 + 0.03);
    cone.position.x = dir * L / 2;
    cone.renderOrder = 3;
    cone.frustumCulled = false;
    spin.add(cone);
    b.model.beams.push(cone);
  }
  b.group.add(spin);
  b.model.spinners.push({ object: spin, speed: 0.55 });

  // Wärterhaus neben dem Turm, Tür zum Turm hin
  const hx = -6.5;
  const hz = 1;
  const hy = g(hx, hz);
  const W = 4.4;
  const D = 3.6;
  const Hh = 2.5;
  b.box(M.planks, [W, 0.15, D], [hx, hy + 0.08, hz], [0, 0, 0], true, false);
  b.box(white, [W, Hh, 0.15], [hx, hy + Hh / 2, hz - D / 2]);
  b.box(white, [0.15, Hh, D], [hx - W / 2, hy + Hh / 2, hz]);
  b.box(white, [1.3, Hh, 0.15], [hx + 0.2, hy + Hh / 2, hz + D / 2]);
  b.box(white, [0.15, Hh, 1.1], [hx + W / 2, hy + Hh / 2, hz - 1.25]);
  b.box(white, [0.15, Hh, 1.1], [hx + W / 2, hy + Hh / 2, hz + 1.25]);
  b.box(M.glass, [0.9, 0.7, 0.17], [hx - 1.3, hy + 1.5, hz + D / 2], [0, 0, 0], false);
  b.box(white, [1.4, Hh, 0.15], [hx - 1.5, hy + Hh / 2, hz + D / 2]);
  b.box(M.redPaint, [W + 0.5, 0.15, D + 0.6], [hx, hy + Hh + 0.3, hz], [0, 0, 0.12]);
  // Einrichtung: Pult mit Logbuch, Spind, Bett
  b.box(M.planks, [1.3, 0.06, 0.7], [hx - 1.2, hy + 0.85, hz - 1.2]);
  b.box(M.planks, [1.2, 0.8, 0.6], [hx - 1.2, hy + 0.42, hz - 1.2], [0, 0, 0], true, false);
  b.container('desk', [hx - 1.6, hy + 0.95, hz - 1.15]);
  b.note('leuchtfeuer', [hx - 0.9, hy + 0.89, hz - 1.2], 0.2);
  b.box(M.metal, [0.6, 1.8, 0.5], [hx + 1.6, hy + 0.95, hz - 1.4]);
  b.container('locker', [hx + 1.6, hy + 1.2, hz - 1.15]);
  b.box(M.fabric, [0.9, 0.35, 1.9], [hx - 1.6, hy + 0.3, hz + 0.6], [0, 0, 0], true, false);
  b.lantern([hx + W / 2 + 0.3, hy + 2.1, hz]);
  // Ölschuppen: Fässer unter einem Vordach
  const sx = 5.5;
  const sz = -4;
  const sy = g(sx, sz);
  for (const [ox, oz] of [[0, 0], [0.7, 0.3], [-0.6, 0.5]]) b.cyl(rng() < 0.5 ? M.rust : M.redPaint, 0.3, 0.3, 0.9, [sx + ox, sy + 0.45, sz + oz]);
  for (const px of [-1, 1]) b.box(M.oldPlanks, [0.12, 1.9, 0.12], [sx + px * 1.1, sy + 0.95, sz + 1.0], [0, 0, 0], false);
  b.box(M.oldPlanks, [2.6, 0.08, 1.8], [sx, sy + 1.95, sz + 0.2], [0.15, 0, 0], false);
  b.container('oilstore', [sx, sy + 0.95, sz + 0.2]);
}

// ---------------------------------------------------------------------------
// Schmugglerbucht
// ---------------------------------------------------------------------------

function buildSmugglers(b: Builder, rng: () => number): void {
  const g = b.ground;
  const y = g(0, 0);
  // Plane zwischen vier Pfählen, darunter Kisten und Fässer; ein umgedrehtes Ruderboot.
  for (const [x, z] of [[-2.2, -1.6], [2.2, -1.6], [-2.2, 1.6], [2.2, 1.6]]) b.box(M.oldPlanks, [0.14, 2.2, 0.14], [x, g(x, z) + 1.0, z], [0, 0, (rng() - 0.5) * 0.08], false);
  const tarp = std(0x3d4a36, { roughness: 0.95, side: THREE.DoubleSide });
  b.add(new THREE.PlaneGeometry(5.2, 3.9, 6, 4), tarp, [0, y + 2.05, 0], [-Math.PI / 2 + 0.12, 0, 0]);
  for (let i = 0; i < 5; i++) {
    const x = -1.5 + (i % 3) * 1.0;
    const z = -0.9 + Math.floor(i / 3) * 1.0;
    const h = 0.6 + rng() * 0.2;
    b.box(i % 2 ? M.planks : M.oldPlanks, [0.8, h, 0.7], [x, g(x, z) + h / 2, z], [0, rng() * 0.3, 0]);
  }
  b.container('stash', [-0.5, g(-0.5, -0.9) + 0.75, -0.9]);
  b.container('crate', [1.2, g(1.2, 0.6) + 0.5, 0.6]);
  b.cyl(M.rust, 0.3, 0.3, 0.9, [1.8, g(1.8, -1.0) + 0.45, -1.0]);
  b.note('schmuggler', [0.5, g(0.5, -0.9) + 0.72, -0.9], 0.4);
  // Ruderboot kieloben am Strand (Richtung Wasser, +Z)
  const bz = 5.5;
  const hull = b.add(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0x5a6a72, { roughness: 0.7 }), [0, g(0, bz) - 0.05, bz], [0, 0.3, 0]);
  hull.scale.set(0.75, 0.45, 2.1);
  b.collider([0.7, 0.4, 2.0], [0, g(0, bz) + 0.3, bz], [0, 0.3, 0]);
  // Feuerstelle mit kalter Asche, Treibholz
  b.add(new THREE.CylinderGeometry(0.5, 0.55, 0.05, 10), M.coal, [-3.2, g(-3.2, 2.5) + 0.03, 2.5], [0, 0, 0], false);
  for (let i = 0; i < 4; i++) {
    const x = -5 + rng() * 10;
    const z = 3 + rng() * 4;
    b.cyl(M.oldPlanks, 0.12, 0.14, 1.6 + rng(), [x, g(x, z) + 0.12, z], [Math.PI / 2, rng() * 3, 0], 7, false);
  }
  b.lantern([2.1, y + 1.7, 1.45]);
}

export function buildPlace(kind: PlaceKind, seed: number, origin: THREE.Vector3, yaw: number, hm: HeightMap): PlaceModel {
  const rng = mulberry32(deriveSeed(seed, `place-${kind}`));
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Lokal (x, z) → Welt: Drehung um Y wie bei Object3D.rotation.y
  const ground = (x: number, z: number) => hm.heightAt(origin.x + x * c + z * s, origin.z - x * s + z * c) - origin.y;
  const b = new Builder(`Place_${kind}`, ground);
  if (kind === 'crash') buildCrash(b, rng);
  else if (kind === 'mine') buildMine(b, rng);
  else if (kind === 'hut') buildHut(b, rng, hm.waterLevel - origin.y);
  else if (kind === 'radio') buildRadio(b);
  else if (kind === 'ferry') buildFerry(b, rng);
  else if (kind === 'chapel') buildChapel(b, rng);
  else if (kind === 'lab') buildLab(b, rng);
  else if (kind === 'lighthouse') buildLighthouse(b, rng);
  else if (kind === 'smugglers') buildSmugglers(b, rng);
  else buildStones(b, rng);
  return b.model;
}
