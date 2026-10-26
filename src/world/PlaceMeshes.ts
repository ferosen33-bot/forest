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

export type PlaceLootKind = 'suitcase' | 'cockpit' | 'medbox' | 'locker' | 'toolbox' | 'crate' | 'chest' | 'shelf' | 'desk';

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
  /** Laterne (flackert leicht, nur nachts), Warnlicht (blinkt), Glut (Feuer). */
  mode: 'lamp' | 'blink' | 'fire';
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
const SUITCASE_COLORS = [0x2d3c55, 0x6b2a24, 0x2b2b2b, 0x56603a, 0x7a6248].map((c) => std(c, { roughness: 0.7 }));

/** Sammelt Meshes und Kollider eines Ortes. */
class Builder {
  readonly group = new THREE.Group();
  readonly model: PlaceModel;
  private readonly e = new THREE.Euler();

  constructor(
    name: string,
    /** Bodenhöhe relativ zum Ursprung an einer lokalen Stelle (für Dinge, die auf dem Gelände liegen). */
    readonly ground: (x: number, z: number) => number,
  ) {
    this.group.name = name;
    this.model = { group: this.group, colliders: [], containers: [], notes: [], lights: [], fires: [], beacons: [] };
  }

  add(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], shadow = true): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.rotation.set(...rot);
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
    this.model.colliders.push({
      half: new THREE.Vector3(...half),
      position: new THREE.Vector3(...pos),
      quaternion: new THREE.Quaternion().setFromEuler(this.e.set(...rot)),
      nav,
    });
  }

  container(kind: PlaceLootKind, pos: [number, number, number]): void {
    this.model.containers.push({ kind, position: new THREE.Vector3(...pos) });
  }

  note(id: string, pos: [number, number, number], rotY = 0): void {
    // Ein Blatt Papier, leicht schräg.
    this.add(new THREE.PlaneGeometry(0.21, 0.28), std(0xe6dfcc, { side: THREE.DoubleSide }), [pos[0], pos[1] + 0.005, pos[2]], [-Math.PI / 2, 0, rotY], false);
    this.model.notes.push({ id, position: new THREE.Vector3(...pos) });
  }

  light(pos: [number, number, number], color: number, intensity: number, distance: number, mode: PlaceLight['mode']): void {
    this.model.lights.push({ position: new THREE.Vector3(...pos), color: new THREE.Color(color), intensity, distance, mode });
  }

  /** Laterne an einem Haken: Glaskörper leuchtet, dazu ein Licht. */
  lantern(pos: [number, number, number]): void {
    this.add(new THREE.CylinderGeometry(0.07, 0.08, 0.2, 8), M.lamp, pos, [0, 0, 0], false);
    this.add(new THREE.ConeGeometry(0.1, 0.08, 8), M.metal, [pos[0], pos[1] + 0.14, pos[2]], [0, 0, 0], false);
    this.light([pos[0], pos[1] - 0.05, pos[2]], 0xffa04a, 6, 14, 'lamp');
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

/**
 * Modell eines Ortes bauen.
 * @param ground Geländehöhe an einer Weltposition
 * @param origin Bauplatz, `yaw` Ausrichtung
 */
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
  else buildRadio(b);
  return b.model;
}
