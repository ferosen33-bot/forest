import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { injectSeason } from './SeasonShader';
import { injectSurface, surfaceLayer, type SurfaceId } from './SurfaceTextures';
import { buildingRng, type TownBuilding, type TownLayout, type TownProp } from './Town';
import type { RandomFn } from '../utils/random';
import { TOWN_NOTES } from '../systems/Notes';
import { ruralBuilding, ruralProp } from './RuralMeshes';

/**
 * Baut die Stadt aus ihrem Plan: Geometrie (je Material EIN verschmolzenes Mesh mit Vertexfarben →
 * eine Handvoll Draw Calls für den ganzen Ort), Kollisionsquader, durchsuchbare Behälter und Türen
 * (Durchgänge für die Wegfindung). Alles in Weltkoordinaten.
 */

export type LootKind = 'fridge' | 'cabinet' | 'wardrobe' | 'shelf' | 'register' | 'toolbox' | 'car' | 'desk' | 'caravan' | 'crate';

export const LOOT_LABELS: Record<LootKind, string> = {
  fridge: 'Kühlschrank',
  cabinet: 'Küchenschrank',
  wardrobe: 'Kleiderschrank',
  shelf: 'Regal',
  register: 'Kasse',
  toolbox: 'Werkzeugkiste',
  car: 'Kofferraum',
  desk: 'Schreibtisch',
  caravan: 'Wohnwagen',
  crate: 'Holzkiste',
};

export interface ContainerSpec {
  id: number;
  kind: LootKind;
  position: THREE.Vector3;
  /** Gebäude-Index (−1 bei Autos). */
  building: number;
}

export interface ColliderSpec {
  half: THREE.Vector3;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Gierwinkel (für die Wegfindung). */
  yaw: number;
  /** Hindernis für die Wegfindung. */
  nav: boolean;
  container?: number;
  /** Lesbare Notiz (Sensor, nur zum Anvisieren). */
  note?: string;
}

export interface DoorSpec {
  position: THREE.Vector3;
  yaw: number;
  halfX: number;
  halfZ: number;
}

/** Fenster- oder Türöffnung eines Wohnhauses (zum Verbarrikadieren). */
export interface OpeningSpec {
  id: number;
  building: number;
  kind: 'door' | 'window';
  /** Mitte der Öffnung auf der Wandmitte (Welt), Unterkante (Welt-y), Breite und Höhe. */
  position: THREE.Vector3;
  bottom: number;
  width: number;
  height: number;
  /** Drehung um Y, bei der lokal +Z aus dem Haus hinaus zeigt. */
  yaw: number;
  /** Wanddicke (die Bretter sitzen außen davor). */
  wall: number;
}

export interface TownModel {
  group: THREE.Group;
  colliders: ColliderSpec[];
  containers: ContainerSpec[];
  doors: DoorSpec[];
  openings: OpeningSpec[];
  /** Welche Notiz in welchem Wohnhaus liegt (Gebäude-Index → Notiz-Id). */
  houseNotes: Map<number, string>;
}

export type Bucket = 'in' | 'out';

export interface BoxOpts {
  color: number;
  bucket?: Bucket;
  rx?: number;
  ry?: number;
  rz?: number;
  /** Reihenfolge der Drehungen (Standard XYZ). */
  order?: THREE.EulerOrder;
  collide?: boolean;
  nav?: boolean;
  container?: LootKind;
  /** Nur Kollision, keine Geometrie (z. B. Quader in einem runden Turm). */
  invisible?: boolean;
  /** Foto-Oberfläche; ohne Angabe nach der Farbe (Asphalt, Holz, Beton …), sonst keine. */
  surface?: SurfaceId | null;
}

export interface Opening {
  /** Mitte entlang der Wand (von der Wandmitte aus). */
  at: number;
  width: number;
  y0: number;
  y1: number;
}

export const FLOOR = 0.15;
export const WALL = 0.2;

/** Baukasten aus Quadern mit Vertexfarben (auch für Hafen und Leuchtturm). */
export class Builder {
  readonly colliders: ColliderSpec[] = [];
  readonly containers: ContainerSpec[] = [];
  readonly doors: DoorSpec[] = [];
  readonly openings: OpeningSpec[] = [];
  private readonly parts: Record<Bucket, THREE.BufferGeometry[]> = { in: [], out: [] };
  /** Aktuelles Bezugssystem (Ort → Gebäude), in Weltkoordinaten. */
  base = new THREE.Matrix4();
  building = -1;
  private readonly local = new THREE.Matrix4();
  private readonly world = new THREE.Matrix4();
  private readonly color = new THREE.Color();

  constructor(private readonly town: THREE.Matrix4) {}

  /** Bezugssystem für ein Objekt im Ortssystem setzen (Position x/z, Drehung). */
  at(x: number, z: number, rotation: number, building = -1, y = 0): void {
    this.base.copy(this.town).multiply(new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationY(rotation)));
    this.building = building;
  }

  private add(geometry: THREE.BufferGeometry, bucket: Bucket, color: number, surface?: SurfaceId | null): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(this.world);
    g.deleteAttribute('uv');
    this.color.set(color);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([this.color.r, this.color.g, this.color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // Oberfläche als Ebenen-Index + 1 (0 = glatt, ohne Foto-Textur).
    const s = surface === undefined ? SURFACE_BY_COLOR.get(color) : surface;
    g.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(n).fill(s ? surfaceLayer(s) + 1 : 0), 1));
    this.parts[bucket].push(g);
  }

  /** Quader (Mitte x, y, z im aktuellen Bezugssystem). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, o: BoxOpts): void {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, o.order ?? 'XYZ'));
    this.local.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    this.world.multiplyMatrices(this.base, this.local);
    if (!o.invisible) this.add(new THREE.BoxGeometry(w, h, d), o.bucket ?? 'in', o.color, o.surface);
    if (!o.collide && !o.container) return;
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    this.world.decompose(position, quaternion, new THREE.Vector3());
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    const spec: ColliderSpec = { half: new THREE.Vector3(w / 2, h / 2, d / 2), position, quaternion, yaw: Math.atan2(f.x, f.z), nav: o.nav ?? false };
    if (o.container) {
      const id = this.containers.length;
      this.containers.push({ id, kind: o.container, position: position.clone(), building: this.building });
      spec.container = id;
    }
    this.colliders.push(spec);
  }

  /**
   * Notiz: ein Blatt Papier flach auf einer Fläche (Oberkante `y`) oder als Aushang an einer Wand
   * (`wall`: senkrecht, Vorderseite +Z). Ein Sensor darüber macht es anvisierbar.
   */
  note(id: string, x: number, y: number, z: number, ry: number, wall = false): void {
    if (wall) this.box(0.42, 0.58, 0.01, x, y, z, { color: 0xe6dfcb, ry });
    else this.box(0.22, 0.006, 0.3, x, y + 0.003, z, { color: 0xe6dfcb, ry });
    const position = new THREE.Vector3(x, wall ? y : y + 0.03, z).applyMatrix4(this.base);
    const quaternion = new THREE.Quaternion();
    this.base.decompose(new THREE.Vector3(), quaternion, new THREE.Vector3());
    quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)));
    const half = wall ? new THREE.Vector3(0.24, 0.32, 0.06) : new THREE.Vector3(0.16, 0.04, 0.2);
    this.colliders.push({ half, position, quaternion, yaw: 0, nav: false, note: id });
  }

  /** Beliebige Geometrie (ohne Kollision), z. B. Dreiecksgiebel oder Räder. */
  mesh(geometry: THREE.BufferGeometry, x: number, y: number, z: number, color: number, bucket: Bucket = 'in', rx = 0, ry = 0, rz = 0, surface?: SurfaceId | null): void {
    this.local.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    this.world.multiplyMatrices(this.base, this.local);
    this.add(geometry, bucket, color, surface);
  }

  /**
   * Gerade Wand entlang lokal X (`alongX`) bzw. Z mit Öffnungen (Türen, Fenster).
   * (cx, cz) = Mitte der Wand, length = Länge, Öffnungen relativ zur Mitte.
   */
  wall(cx: number, cz: number, alongX: boolean, length: number, top: number, openings: Opening[], color: number, surface?: SurfaceId): void {
    const pieces: [number, number, number, number][] = []; // [von, bis, y0, y1] entlang der Wand
    const sorted = [...openings].sort((a, b) => a.at - b.at);
    let cursor = -length / 2;
    for (const o of sorted) {
      const a = o.at - o.width / 2;
      const b = o.at + o.width / 2;
      if (a > cursor) pieces.push([cursor, a, 0, top]);
      if (o.y0 > 0.02) pieces.push([a, b, 0, Math.min(o.y0, top)]);
      if (o.y1 < top - 0.02) pieces.push([a, b, o.y1, top]);
      cursor = b;
    }
    if (cursor < length / 2) pieces.push([cursor, length / 2, 0, top]);
    for (const [a, b, y0, y1] of pieces) {
      const len = b - a;
      const mid = (a + b) / 2;
      const h = y1 - y0;
      if (len < 0.02 || h < 0.02) continue;
      const y = FLOOR + y0 + h / 2;
      const surf = surface ?? (color === C.char ? 'planks' : 'plaster');
      if (alongX) this.box(len, h, WALL, cx + mid, y, cz, { color, collide: true, nav: true, surface: surf });
      else this.box(WALL, h, len, cx, y, cz + mid, { color, collide: true, nav: true, surface: surf });
    }
  }

  /**
   * Öffnung in einer Außenwand vormerken (zum Verbarrikadieren). (x, z) = Wandmitte wie bei `wall`,
   * `outward` = +1/−1: Richtung aus dem Haus hinaus (entlang lokal Z bei Wänden entlang X, sonst X).
   */
  opening(kind: 'door' | 'window', x: number, z: number, alongX: boolean, o: Opening, outward: 1 | -1): void {
    const local = alongX ? new THREE.Vector3(x + o.at, FLOOR + (o.y0 + o.y1) / 2, z) : new THREE.Vector3(x, FLOOR + (o.y0 + o.y1) / 2, z + o.at);
    const position = local.applyMatrix4(this.base);
    const q = new THREE.Quaternion();
    this.base.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const out = (alongX ? new THREE.Vector3(0, 0, outward) : new THREE.Vector3(outward, 0, 0)).applyQuaternion(q);
    this.openings.push({
      id: this.openings.length,
      building: this.building,
      kind,
      position,
      bottom: position.y - (o.y1 - o.y0) / 2,
      width: o.width,
      height: o.y1 - o.y0,
      yaw: Math.atan2(out.x, out.z),
      wall: WALL,
    });
  }

  /** Tür als Durchgang für die Wegfindung melden (lokal, Durchgang quer zur Wand). */
  door(x: number, z: number, alongX: boolean, width: number): void {
    const p = new THREE.Vector3(x, 0, z).applyMatrix4(this.base);
    const q = new THREE.Quaternion();
    this.base.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const yaw = Math.atan2(f.x, f.z) + (alongX ? 0 : Math.PI / 2);
    this.doors.push({ position: p, yaw, halfX: width / 2, halfZ: WALL });
  }

  finish(materials: Record<Bucket, THREE.Material>): THREE.Group {
    const g = new THREE.Group();
    g.name = 'Town';
    for (const bucket of ['in', 'out'] as const) {
      if (!this.parts[bucket].length) continue;
      const merged = mergeGeometries(this.parts[bucket], false)!;
      merged.computeVertexNormals();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[bucket]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `Town_${bucket}`;
      g.add(mesh);
      for (const p of this.parts[bucket]) p.dispose();
    }
    return g;
  }
}

// ---------------------------------------------------------------------------
// Materialien & kleine Formen
// ---------------------------------------------------------------------------

export const C = {
  floorWood: 0x6e5a42,
  roofTile: 0x6a3d33,
  roofGrey: 0x4d5257,
  asphalt: 0x3b3c3e,
  line: 0xb5ad8c,
  paving: 0x7b766c,
  concrete: 0x8a877f,
  white: 0xd6d2c8,
  wood: 0x5c4733,
  darkWood: 0x3f3124,
  metal: 0x8d9296,
  rust: 0x7a4c33,
  fabric: 0x5b6470,
  pillow: 0xc8c2b2,
  char: 0x2c2926,
  glassDark: 0x56636d,
  tire: 0x1e1e1e,
  green: 0x3f5240,
};

/** Oberflächen nach Farbe (für Quader ohne eigene Angabe). */
const SURFACE_BY_COLOR = new Map<number, SurfaceId>([
  [C.asphalt, 'asphalt'],
  [C.roofTile, 'asphalt'],
  [C.roofGrey, 'asphalt'],
  [C.paving, 'plaster'],
  [C.concrete, 'plaster'],
  [0x8f8c84, 'plaster'],
  [0xc9c4b8, 'plaster'],
  [C.floorWood, 'planks'],
  [C.wood, 'planks'],
  [C.darkWood, 'planks'],
  [C.rust, 'mossyRock'],
]);

/** Weitere Farben einer Oberfläche zuordnen (z. B. die Palette des Hafens). */
export function registerSurfaceColors(entries: [number, SurfaceId][]): void {
  for (const [c, s] of entries) SURFACE_BY_COLOR.set(c, s);
}

/** Foto-Texturen für die Quader-Bauten: Putz, Asphalt, Bretter (Kennung im Attribut `surf`). */
export const BUILDING_SURFACE = /* glsl */ `
float surfL = vSurf - 1.0;
float surfHas = step(-0.5, surfL);
int surfI = int(max(surfL, 0.0) + 0.5);
vec3 bD = surfTriplanar(surfI, surfP, surfGeo, surfN, surfHas);
diffuseColor.rgb = surfApply(surfBase, mix(vec3(1.0), bD, surfHas), 0.3);
`;

/** Bindet die Foto-Texturen in ein Bau-Material ein (Attribut `surf` → Varying). */
export function injectBuildingSurface(shader: THREE.WebGLProgramParametersWithUniforms): void {
  injectSurface(shader, BUILDING_SURFACE, 1.0);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float surf;\nvarying float vSurf;')
    .replace('#include <project_vertex>', 'vSurf = surf;\n#include <project_vertex>');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSurf;');
}

export function gable(width: number, height: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(0, height);
  s.lineTo(-width / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: WALL, bevelEnabled: false });
  g.translate(0, 0, -WALL / 2);
  return g;
}

/** Schild mit Aufschrift (eigene Textur, nicht verschmolzen). */
export function sign(text: string, width: number, color = '#d9cfb4', bg = '#2f3b46'): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  // Verwittert: ein paar dunkle Flecken.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i < 14; i++) ctx.fillRect(Math.random() * 512, Math.random() * 128, 20 + Math.random() * 60, 6 + Math.random() * 20);
  ctx.fillStyle = color;
  ctx.font = 'bold 76px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  mesh.castShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Gebäude
// ---------------------------------------------------------------------------

function house(b: Builder, t: TownBuilding, rng: RandomFn, ruin: boolean, note?: string): void {
  const { w, d } = t;
  const H = 2.7;
  const color = ruin ? C.char : t.color;
  const doorAt = -w / 2 + 1.6 + rng() * 1.2;
  // Ruinen: Mauern unterschiedlich hoch abgebrochen.
  const top = () => (ruin ? 0.9 + rng() * 1.8 : H);
  // Boden
  b.box(w, FLOOR, d, 0, FLOOR / 2, 0, { color: ruin ? C.char : C.floorWood, collide: true });
  // Außenwände mit Tür und Fenstern
  const win = (at: number): Opening => ({ at, width: 1.2, y0: 0.95, y1: 1.95 });
  const front: Opening = { at: doorAt, width: 1.1, y0: 0, y1: 2.15 };
  b.wall(0, d / 2 - WALL / 2, true, w, top(), [front, win(w / 4 + 0.3)], color);
  b.door(doorAt, d / 2 - WALL / 2, true, 1.1);
  b.wall(0, -d / 2 + WALL / 2, true, w, top(), [win(-w / 4), win(w / 4)], color);
  b.wall(-w / 2 + WALL / 2, 0, false, d - 2 * WALL, top(), [win(0.8)], color);
  b.wall(w / 2 - WALL / 2, 0, false, d - 2 * WALL, top(), [win(-0.8)], color);
  // Bewohnbare Häuser lassen sich verbarrikadieren: Tür und alle Fenster.
  if (!ruin) {
    b.opening('door', 0, d / 2 - WALL / 2, true, front, 1);
    b.opening('window', 0, d / 2 - WALL / 2, true, win(w / 4 + 0.3), 1);
    for (const at of [-w / 4, w / 4]) b.opening('window', 0, -d / 2 + WALL / 2, true, win(at), -1);
    b.opening('window', -w / 2 + WALL / 2, 0, false, win(0.8), -1);
    b.opening('window', w / 2 - WALL / 2, 0, false, win(-0.8), 1);
  }
  // Zwischenwand mit Durchgang: vorne Wohnküche, hinten Schlafzimmer.
  const split = -0.5;
  const passAt = w / 4;
  b.wall(0, split, true, w - 2 * WALL, top(), [{ at: passAt, width: 1.0, y0: 0, y1: 2.1 }], ruin ? C.char : 0xcfc6b4);
  b.door(passAt, split, true, 1.0);

  if (ruin) {
    // Schutt und verkohlte Balken
    for (let i = 0; i < 5; i++) {
      b.box(0.3 + rng() * 1.2, 0.2 + rng() * 0.4, 0.3 + rng() * 1.0, (rng() - 0.5) * (w - 2), FLOOR + 0.15, (rng() - 0.5) * (d - 2), {
        color: C.char,
        ry: rng() * 3,
      });
    }
    b.box(w * 0.8, 0.18, 0.18, 0, FLOOR + 0.3, 1, { color: C.darkWood, rz: 0.15, ry: 0.3 });
    if (rng() < 0.6) b.box(1.6, 0.85, 0.55, -w / 2 + 1.2, FLOOR + 0.42, split + 0.45, { color: C.char, container: 'cabinet' });
    return;
  }

  // Satteldach (First entlang X) mit Giebeln
  const rise = 1.5;
  const run = d / 2 + 0.35;
  const slope = Math.atan2(rise, run);
  const len = Math.hypot(run, rise) + 0.12;
  const roof = rng() < 0.6 ? C.roofTile : C.roofGrey;
  for (const s of [-1, 1]) {
    b.box(w + 0.5, 0.14, len, 0, FLOOR + H + rise / 2 + 0.05, (s * run) / 2, { color: roof, bucket: 'out', rx: s * slope, collide: true });
  }
  for (const s of [-1, 1]) b.mesh(gable(d, rise), s * (w / 2 - WALL / 2), FLOOR + H, 0, color, 'in', 0, Math.PI / 2, 0, 'plaster');

  // Möbel: Küchenzeile + Kühlschrank, Tisch mit Stühlen (vorne); Bett + Kleiderschrank (hinten).
  const front0 = split + WALL / 2;
  if (rng() < 0.85) b.box(2.0, 0.9, 0.6, -w / 2 + WALL + 1.0, FLOOR + 0.45, front0 + 0.3, { color: C.white, container: 'cabinet' });
  if (rng() < 0.8) b.box(0.7, 1.8, 0.7, -w / 2 + WALL + 2.45, FLOOR + 0.9, front0 + 0.35, { color: 0xdfe0dc, container: 'fridge' });
  const tx = w / 4 - 0.2;
  const tz = d / 4 - 0.2;
  b.box(1.4, 0.06, 0.85, tx, FLOOR + 0.74, tz, { color: C.wood, collide: true, nav: false });
  if (note) b.note(note, tx + 0.2, FLOOR + 0.77, tz - 0.1, rng() * 0.6 - 0.3);
  for (const [lx, lz] of [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]]) b.box(0.06, 0.72, 0.06, tx + lx, FLOOR + 0.36, tz + lz, { color: C.darkWood });
  for (const s of [-1, 1]) {
    b.box(0.45, 0.06, 0.45, tx + s * 0.95, FLOOR + 0.45, tz, { color: C.darkWood, ry: rng() * 0.6 });
    b.box(0.45, 0.5, 0.06, tx + s * 1.17, FLOOR + 0.7, tz, { color: C.darkWood, ry: Math.PI / 2 });
  }
  const back = -d / 2 + WALL;
  b.box(2.0, 0.45, 1.0, w / 2 - WALL - 1.1, FLOOR + 0.23, back + 0.6, { color: C.fabric, collide: true });
  b.box(0.5, 0.12, 0.8, w / 2 - WALL - 0.35, FLOOR + 0.52, back + 0.6, { color: C.pillow });
  // (Im Haus mit dem Brief an Marta steht immer einer – dort liegt Pauls Taschenuhr.)
  if (rng() < 0.85 || note === 'brief') b.box(1.2, 2.0, 0.6, -w / 2 + WALL + 0.75, FLOOR + 1.0, back + 0.32, { color: C.wood, container: 'wardrobe' });

  // Vernagelte Fenster (außen) – die Bewohner haben sich verbarrikadiert.
  if (rng() < 0.5) {
    for (let i = 0; i < 3; i++) {
      b.box(1.5, 0.16, 0.04, w / 4 + 0.3, FLOOR + 1.15 + i * 0.32, d / 2 + 0.03, { color: C.wood, rz: (rng() - 0.5) * 0.35 });
    }
  }
}

function shop(b: Builder, t: TownBuilding, g: THREE.Group, place: (o: THREE.Object3D, x: number, y: number, z: number) => void): void {
  const { w, d } = t;
  const H = 3.4;
  b.box(w, FLOOR, d, 0, FLOOR / 2, 0, { color: 0x8f8c84, collide: true });
  b.wall(0, d / 2 - WALL / 2, true, w, H, [{ at: -w / 4, width: w / 2 - 1.2, y0: 0.6, y1: 2.7 }, { at: 1.6, width: 2.0, y0: 0, y1: 2.5 }], t.color);
  b.door(1.6, d / 2 - WALL / 2, true, 2.0);
  b.wall(0, -d / 2 + WALL / 2, true, w, H, [], t.color);
  b.wall(-w / 2 + WALL / 2, 0, false, d - 2 * WALL, H, [], t.color);
  b.wall(w / 2 - WALL / 2, 0, false, d - 2 * WALL, H, [{ at: -2, width: 1.2, y0: 1.0, y1: 2.0 }], t.color);
  b.box(w + 0.4, 0.25, d + 0.4, 0, FLOOR + H + 0.12, 0, { color: C.concrete, bucket: 'out', collide: true });
  b.box(w + 0.4, 0.5, 0.15, 0, FLOOR + H + 0.45, d / 2 + 0.12, { color: t.color });
  // Regale in zwei Reihen, Kassentresen am Eingang, Werkzeugkiste im Lager.
  for (const z of [-2.8, 0.2]) {
    for (const x of [-3, 2.6]) b.box(4.2, 1.6, 0.6, x, FLOOR + 0.8, z, { color: C.metal, container: 'shelf', nav: true });
  }
  b.box(2.2, 1.0, 0.7, 3.6, FLOOR + 0.5, 3.0, { color: C.wood, container: 'register', nav: true });
  b.note(TOWN_NOTES.shop[0], 3.0, FLOOR + 1.0, 3.0, 0.25);
  b.box(0.6, 0.4, 0.4, -w / 2 + 0.8, FLOOR + 0.2, -d / 2 + 0.6, { color: C.rust, container: 'toolbox' });
  const s = sign('MARKT', 4);
  place(s, 0, FLOOR + H - 0.2, d / 2 + 0.22);
  g.add(s);
}

function gasStation(b: Builder, t: TownBuilding, g: THREE.Group, place: (o: THREE.Object3D, x: number, y: number, z: number) => void): void {
  const { w, d } = t;
  const H = 3.0;
  b.box(w, FLOOR, d, 0, FLOOR / 2, 0, { color: 0x8f8c84, collide: true });
  b.wall(0, d / 2 - WALL / 2, true, w, H, [{ at: -1.2, width: 1.2, y0: 0, y1: 2.2 }, { at: 1.6, width: 2.2, y0: 0.9, y1: 2.2 }], t.color);
  b.door(-1.2, d / 2 - WALL / 2, true, 1.2);
  b.wall(0, -d / 2 + WALL / 2, true, w, H, [], t.color);
  b.wall(-w / 2 + WALL / 2, 0, false, d - 2 * WALL, H, [], t.color);
  b.wall(w / 2 - WALL / 2, 0, false, d - 2 * WALL, H, [], t.color);
  b.box(w + 0.3, 0.22, d + 0.3, 0, FLOOR + H + 0.1, 0, { color: C.concrete, bucket: 'out', collide: true });
  b.box(3.0, 1.5, 0.5, -1.5, FLOOR + 0.75, -d / 2 + 0.6, { color: C.metal, container: 'shelf', nav: true });
  b.box(1.6, 1.0, 0.6, 2.2, FLOOR + 0.5, 0.6, { color: C.wood, container: 'register', nav: true });
  b.note(TOWN_NOTES.gas[0], 2.4, FLOOR + 1.0, 0.55, -0.3);
  b.box(0.6, 0.4, 0.4, w / 2 - 0.6, FLOOR + 0.2, -d / 2 + 0.5, { color: 0xa13a2a, container: 'toolbox' });
  // Tankdach über den Zapfsäulen (zur Straße hin)
  const cz = d / 2 + 4.6;
  for (const x of [-3.3, 3.3]) for (const z of [cz - 3.2, cz + 3.2]) b.box(0.3, 4.3, 0.3, x, 2.15, z, { color: C.white, collide: true, nav: true });
  b.box(8.4, 0.4, 8.0, 0, 4.4, cz, { color: 0xc9c4b8, bucket: 'out', collide: true });
  b.box(8.5, 0.45, 0.1, 0, 4.4, cz + 4.02, { color: 0xa8352a });
  for (const x of [-1.5, 1.5]) {
    b.box(0.7, 1.6, 0.45, x, 0.8, cz, { color: 0xb54034, collide: true, nav: true });
    b.box(0.5, 0.35, 0.47, x, 1.25, cz, { color: C.glassDark });
  }
  const s = sign('TANKSTELLE', 5, '#f2ead2', '#9a2f25');
  place(s, 0, 4.4, cz + 4.1);
  g.add(s);
}

function townHall(b: Builder, t: TownBuilding, g: THREE.Group, place: (o: THREE.Object3D, x: number, y: number, z: number) => void): void {
  const { w, d } = t;
  const H = 3.2;
  b.box(w, FLOOR, d, 0, FLOOR / 2, 0, { color: C.floorWood, collide: true });
  const win = (at: number): Opening => ({ at, width: 1.3, y0: 1.0, y1: 2.2 });
  b.wall(0, d / 2 - WALL / 2, true, w, H, [win(-3.6), { at: 0, width: 1.6, y0: 0, y1: 2.4 }, win(3.6)], t.color);
  b.door(0, d / 2 - WALL / 2, true, 1.6);
  b.wall(0, -d / 2 + WALL / 2, true, w, H, [win(-3), win(3)], t.color);
  b.wall(-w / 2 + WALL / 2, 0, false, d - 2 * WALL, H, [win(0)], t.color);
  b.wall(w / 2 - WALL / 2, 0, false, d - 2 * WALL, H, [win(0)], t.color);
  b.box(w + 0.4, 0.25, d + 0.4, 0, FLOOR + H + 0.12, 0, { color: C.roofGrey, bucket: 'out', collide: true });
  // Schreibtische, Aktenregal, Funkgerät
  for (const x of [-3.2, 3.2]) b.box(1.6, 0.75, 0.8, x, FLOOR + 0.38, -1.5, { color: C.wood, container: 'desk', nav: true });
  b.box(2.4, 1.9, 0.45, 0, FLOOR + 0.95, -d / 2 + 0.45, { color: C.metal, container: 'shelf', nav: true });
  b.box(0.7, 0.35, 0.4, 3.2, FLOOR + 0.93, -1.7, { color: 0x3a3d3a });
  b.box(0.08, 0.5, 0.02, 3.45, FLOOR + 1.3, -1.7, { color: C.metal });
  // Aushang innen neben der Tür, Funkprotokolle auf den Schreibtischen.
  const [aushang, funk1, funk2] = TOWN_NOTES.hall;
  b.note(aushang, -1.6, FLOOR + 1.5, d / 2 - WALL - 0.01, Math.PI, true);
  b.note(funk1, 2.7, FLOOR + 0.76, -1.3, 0.2);
  b.note(funk2, -3.0, FLOOR + 0.76, -1.4, -0.15);
  // Funkmast neben dem Haus – von weitem zu sehen.
  const mx = w / 2 + 1.6;
  const mz = -d / 2 + 1.6;
  const H2 = 18;
  for (const [ox, oz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) b.box(0.08, H2, 0.08, mx + ox, H2 / 2, mz + oz, { color: C.metal });
  for (let y = 1.5; y < H2; y += 2) {
    b.box(0.86, 0.05, 0.05, mx, y, mz - 0.4, { color: C.metal });
    b.box(0.86, 0.05, 0.05, mx, y, mz + 0.4, { color: C.metal });
    b.box(0.05, 0.05, 0.86, mx - 0.4, y + 1, mz, { color: C.metal });
    b.box(0.05, 0.05, 0.86, mx + 0.4, y + 1, mz, { color: C.metal });
  }
  b.box(1.0, 9, 1.0, mx, 4.5, mz, { color: C.metal, collide: true, nav: true });
  b.box(0.2, 0.2, 0.2, mx, H2 + 0.1, mz, { color: 0x7a1c16 });
  const s = sign('GEMEINDE', 4.4, '#e8dfc4', '#3c4436');
  place(s, 0, FLOOR + H - 0.1, d / 2 + 0.22);
  g.add(s);
}

// ---------------------------------------------------------------------------
// Straßen & Requisiten
// ---------------------------------------------------------------------------

function streets(b: Builder, t: TownLayout): void {
  b.at(0, 0, 0);
  t.streets.forEach((st, i) => {
    if (st.dirt) return;
    const len = Math.hypot(st.bx - st.ax, st.bz - st.az);
    const yaw = Math.atan2(st.bx - st.ax, st.bz - st.az);
    const cx = (st.ax + st.bx) / 2;
    const cz = (st.az + st.bz) / 2;
    // Leicht versetzte Höhen: an Kreuzungen flimmert nichts.
    const y = 0.02 - i * 0.004;
    b.box(st.width, 0.1, len, cx, y, cz, { color: C.asphalt, bucket: 'out', ry: yaw });
    for (let s = -len / 2 + 2; s < len / 2 - 1; s += 4) {
      const px = cx + Math.sin(yaw) * s;
      const pz = cz + Math.cos(yaw) * s;
      if (i === 0 && t.streets.slice(1).some((o) => Math.abs(pz - o.az) < o.width / 2 + 0.5)) continue;
      if (i > 0 && Math.abs(px) < t.streets[0].width / 2 + 0.5) continue;
      b.box(0.15, 0.02, 1.8, px, y + 0.055, pz, { color: C.line, bucket: 'out', ry: yaw });
    }
  });
  if (t.plaza.radius > 0) b.mesh(new THREE.CylinderGeometry(t.plaza.radius, t.plaza.radius, 0.1, 20), t.plaza.x, 0.03, t.plaza.z, C.paving, 'out');
}

function prop(b: Builder, p: TownProp, rng: RandomFn): void {
  switch (p.kind) {
    case 'car': {
      const rust = rng() < 0.5;
      const paint = rust ? new THREE.Color(p.color).lerp(new THREE.Color(C.rust), 0.5).getHex() : p.color;
      const dark = new THREE.Color(paint).multiplyScalar(0.55).getHex();
      // Karosserie: Unterteil, Motorhaube und Kofferraum etwas tiefer, Fahrgastzelle mit schrägen Scheiben.
      b.box(1.8, 0.55, 4.3, 0, 0.58, 0, { color: paint, bucket: 'out', collide: true, nav: true, container: p.loot ? 'car' : undefined });
      b.box(1.76, 0.1, 1.15, 0, 0.9, 1.5, { color: paint, bucket: 'out', rx: 0.06 });
      b.box(1.76, 0.1, 0.8, 0, 0.9, -1.7, { color: paint, bucket: 'out' });
      b.box(1.66, 0.5, 1.5, 0, 1.12, -0.3, { color: C.glassDark, bucket: 'out' });
      b.box(1.7, 0.07, 1.6, 0, 1.4, -0.3, { color: paint, bucket: 'out' });
      b.box(1.62, 0.52, 0.06, 0, 1.12, 0.62, { color: rng() < 0.3 ? 0x2a3036 : C.glassDark, bucket: 'out', rx: -0.55 });
      b.box(1.62, 0.48, 0.06, 0, 1.12, -1.2, { color: C.glassDark, bucket: 'out', rx: 0.5 });
      // Stoßstangen, Scheinwerfer, Rückleuchten, Kühlergrill
      b.box(1.84, 0.16, 0.12, 0, 0.42, 2.16, { color: 0x2a2a2a, bucket: 'out' });
      b.box(1.84, 0.16, 0.12, 0, 0.42, -2.16, { color: 0x2a2a2a, bucket: 'out' });
      for (const x of [-0.65, 0.65]) {
        b.box(0.3, 0.14, 0.04, x, 0.68, 2.16, { color: 0xc9c6b4, bucket: 'out' });
        b.box(0.3, 0.12, 0.04, x, 0.7, -2.16, { color: 0x7a1c16, bucket: 'out' });
      }
      b.box(0.7, 0.16, 0.04, 0, 0.66, 2.16, { color: 0x1c1c1c, bucket: 'out' });
      // Türfugen, Radkästen
      for (const s of [-1, 1]) {
        b.box(0.02, 0.45, 0.02, s * 0.91, 0.62, 0.35, { color: dark, bucket: 'out' });
        b.box(0.02, 0.45, 0.02, s * 0.91, 0.62, -0.75, { color: dark, bucket: 'out' });
      }
      const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12);
      const rim = new THREE.CylinderGeometry(0.17, 0.17, 0.25, 8);
      for (const x of [-0.82, 0.82])
        for (const z of [-1.35, 1.35]) {
          // Manchmal platt
          const flat = rng() < 0.15 ? 0.08 : 0;
          b.mesh(wheel, x, 0.34 - flat, z, C.tire, 'out', 0, 0, Math.PI / 2);
          b.mesh(rim, x, 0.34 - flat, z, 0x6a6e70, 'out', 0, 0, Math.PI / 2);
        }
      // Eine Tür steht offen.
      if (rng() < 0.35) b.box(0.06, 0.75, 1.05, 1.3, 0.78, 0.2, { color: paint, bucket: 'out', ry: 0.9 });
      break;
    }
    case 'lamp':
      b.box(0.14, 4.6, 0.14, 0, 2.3, 0, { color: C.metal, collide: true });
      b.box(0.08, 0.08, 1.4, 0, 4.5, 0.65, { color: C.metal });
      b.box(0.32, 0.14, 0.5, 0, 4.42, 1.3, { color: 0x4e5357 });
      break;
    case 'bin':
      b.box(0.6, 1.0, 0.6, 0, 0.5, 0, { color: C.green, bucket: 'out', collide: true });
      break;
    case 'mailbox':
      b.box(0.08, 1.1, 0.08, 0, 0.55, 0, { color: C.darkWood });
      b.box(0.28, 0.28, 0.46, 0, 1.2, 0, { color: rng() < 0.5 ? 0x8a2f26 : 0x2f4f6a, bucket: 'out' });
      break;
    case 'bench':
      b.box(1.8, 0.08, 0.5, 0, 0.45, 0, { color: C.wood, bucket: 'out', collide: true });
      b.box(1.8, 0.4, 0.06, 0, 0.75, -0.24, { color: C.wood });
      for (const x of [-0.8, 0.8]) b.box(0.08, 0.45, 0.45, x, 0.22, 0, { color: C.metal });
      break;
  }
}

export function buildTown(t: TownLayout, seed: number): TownModel {
  const town = new THREE.Matrix4().makeTranslation(t.center.x, t.center.y, t.center.z).multiply(new THREE.Matrix4().makeRotationY(t.rotation));
  const b = new Builder(town);
  const signs = new THREE.Group();
  const place = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0) => {
    o.position.set(x, y, z).applyMatrix4(b.base);
    o.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(b.base));
    if (ry) o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry));
  };
  streets(b, t);
  // Drei Briefe und Hefte, verteilt über den Ort (erstes, mittleres und letztes Wohnhaus) – nur in Altwasser;
  // die kleinen Orte tragen ihre Notizen im Plan.
  const houses = t.buildings.filter((x) => x.kind === 'house');
  const houseNotes = new Map<number, string>();
  if (!t.kind || t.kind === 'town') {
    [0, Math.floor(houses.length / 2), houses.length - 1].forEach((i, n) => houses[i] && houseNotes.set(houses[i].index, TOWN_NOTES.houses[n]));
  } else {
    for (const h of houses) if (h.note) houseNotes.set(h.index, h.note);
  }
  // Eigener Zufall je Ort (Altwasser behält seine bisherigen Würfe).
  const salt = !t.kind || t.kind === 'town' ? 0 : 5000 + (Math.abs(Math.round(t.center.x * 7 + t.center.z * 13)) % 4000);
  for (const bd of t.buildings) {
    b.at(bd.x, bd.z, bd.rotation, bd.index);
    const rng = buildingRng(seed, salt ? { ...bd, index: bd.index + salt } : bd);
    if (bd.kind === 'house' || bd.kind === 'ruin') house(b, bd, rng, bd.kind === 'ruin', houseNotes.get(bd.index));
    else if (bd.kind === 'shop') shop(b, bd, signs, place);
    else if (bd.kind === 'gas') gasStation(b, bd, signs, place);
    else if (bd.kind === 'hall') townHall(b, bd, signs, place);
    else ruralBuilding(b, bd, rng, signs, place);
  }
  const propRng = buildingRng(seed, { index: 1000 + salt } as TownBuilding);
  for (const p of t.props) {
    b.at(p.x, p.z, p.rotation, -1, p.y ?? 0);
    if (!ruralProp(b, p, propRng, signs, place)) prop(b, p, propRng);
  }

  const material = (snow: boolean) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true });
    m.onBeforeCompile = (shader) => {
      if (snow) injectSeason(shader, { snowBias: 0.1 });
      injectBuildingSurface(shader);
    };
    // Gleicher Quelltext für beide Varianten → Programme über einen eigenen Schlüssel trennen.
    m.customProgramCacheKey = () => (snow ? 'town-out' : 'town-in');
    return m;
  };
  const group = b.finish({ in: material(false), out: material(true) });
  group.add(signs);
  return { group, colliders: b.colliders, containers: b.containers, doors: b.doors, openings: b.openings, houseNotes };
}
