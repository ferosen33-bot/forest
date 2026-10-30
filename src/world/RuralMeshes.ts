import * as THREE from 'three';
import type { RandomFn } from '../utils/random';
import { Builder, C, FLOOR, WALL, gable, sign, type Opening } from './TownMeshes';
import type { TownBuilding, TownProp } from './Town';

/**
 * Gebäude und Requisiten der kleinen Orte und der Wege (Meilenstein 52): Scheune, Schuppen, Ferienhütte,
 * Gasthof, Sägewerk, Rezeption; Traktor, Heuballen, Zäune, Äcker, Brunnen, Vogelscheuche, Wohnwagen,
 * Zelte, Feuerstellen, Stammholz, Holzlaster, Bushaltestelle, Telefonzelle, Strommasten, Leitpfosten,
 * Wegweiser und Ortsschilder. Alles aus Quadern im selben Baukasten wie Altwasser.
 */

type Place = (o: THREE.Object3D, x: number, y: number, z: number, ry?: number) => void;

const R = {
  straw: 0xb59a5a,
  strawDark: 0x8e7843,
  soil: 0x5a4632,
  soilDark: 0x4c3b2a,
  stalk: 0x8f8252,
  stone: 0x77756d,
  plank: 0x6e5a42,
  plankDark: 0x4a3c2c,
  logEnd: 0x9a7a52,
  bark: 0x4f3d2c,
  white: 0xd8d4ca,
  black: 0x1c1c1c,
  glass: 0x46525a,
  yellow: 0xd9b62a,
  pole: 0x4b3b2a,
  ceramic: 0xcfcac0,
  canvas: 0x8a8070,
  red: 0x8a2a22,
};

/** Satteldach (First entlang X) mit Giebeln. */
function roof(b: Builder, w: number, d: number, H: number, rise: number, color: number, wallColor: number, overhang = 0.35): void {
  const run = d / 2 + overhang;
  const slope = Math.atan2(rise, run);
  const len = Math.hypot(run, rise) + 0.12;
  for (const s of [-1, 1]) b.box(w + overhang * 1.4, 0.14, len, 0, FLOOR + H + rise / 2 + 0.05, (s * run) / 2, { color, bucket: 'out', rx: s * slope, collide: true });
  for (const s of [-1, 1]) b.mesh(gable(d, rise), s * (w / 2 - WALL / 2), FLOOR + H, 0, wallColor, 'in', 0, Math.PI / 2, 0, 'planks');
}

/** Liegender Rundling (Stamm, Rohr …) entlang X. */
function log(b: Builder, len: number, r: number, x: number, y: number, z: number, color: number, ry = 0, bucket: 'in' | 'out' = 'out'): void {
  b.mesh(new THREE.CylinderGeometry(r, r * 1.05, len, 8), x, y, z, color, bucket, 0, ry, Math.PI / 2, 'planks');
}

function bunk(b: Builder, x: number, z: number, rot: number): void {
  for (const y of [0.35, 1.35]) {
    b.box(1.9, 0.12, 0.85, x, FLOOR + y, z, { color: R.plank, ry: rot, collide: y < 1 });
    b.box(1.8, 0.14, 0.8, x, FLOOR + y + 0.12, z, { color: C.fabric, ry: rot });
  }
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const [lx, lz] of [[-0.92, -0.4], [0.92, -0.4], [-0.92, 0.4], [0.92, 0.4]]) b.box(0.07, 1.75, 0.07, x + c * lx + s * lz, FLOOR + 0.87, z - s * lx + c * lz, { color: R.plankDark });
}

function table(b: Builder, x: number, z: number, w: number, d: number, rng: RandomFn, chairs = true): void {
  b.box(w, 0.06, d, x, FLOOR + 0.74, z, { color: C.wood, collide: true });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.06, 0.72, 0.06, x + sx * (w / 2 - 0.1), FLOOR + 0.36, z + sz * (d / 2 - 0.1), { color: C.darkWood });
  if (!chairs) return;
  for (const s of [-1, 1]) {
    const ry = rng() * 0.8 - 0.4;
    b.box(0.42, 0.06, 0.42, x + s * (w / 2 + 0.35), FLOOR + 0.45, z, { color: C.darkWood, ry });
    // Ein Stuhl liegt manchmal umgekippt.
    if (rng() < 0.25) b.box(0.42, 0.42, 0.06, x + s * (w / 2 + 0.9), FLOOR + 0.06, z + 0.3, { color: C.darkWood, rx: Math.PI / 2, ry });
    else b.box(0.42, 0.5, 0.06, x + s * (w / 2 + 0.55), FLOOR + 0.7, z, { color: C.darkWood, ry: ry + Math.PI / 2 });
  }
}

// ---------------------------------------------------------------------------
// Gebäude
// ---------------------------------------------------------------------------

function barn(b: Builder, t: TownBuilding, rng: RandomFn): void {
  const { w, d } = t;
  const H = 4.2;
  b.box(w, FLOOR, d, 0, FLOOR / 2, 0, { color: 0x5d5446, collide: true, surface: 'planks' });
  const gate: Opening = { at: 0, width: 4.4, y0: 0, y1: 3.7 };
  b.wall(0, d / 2 - WALL / 2, true, w, H, [gate], t.color, 'planks');
  b.door(0, d / 2 - WALL / 2, true, 4.4);
  b.wall(0, -d / 2 + WALL / 2, true, w, H, [{ at: w / 4, width: 1.2, y0: 0, y1: 2.2 }], t.color, 'planks');
  b.door(w / 4, -d / 2 + WALL / 2, true, 1.2);
  b.wall(-w / 2 + WALL / 2, 0, false, d - 2 * WALL, H, [{ at: 0, width: 0.9, y0: 2.2, y1: 3.0 }], t.color, 'planks');
  b.wall(w / 2 - WALL / 2, 0, false, d - 2 * WALL, H, [{ at: 0, width: 0.9, y0: 2.2, y1: 3.0 }], t.color, 'planks');
  // Weiße Kanten um das Tor, ein Torflügel steht offen, der andere hängt schief.
  b.box(0.18, 3.8, 0.24, -2.3, FLOOR + 1.9, d / 2, { color: R.white });
  b.box(0.18, 3.8, 0.24, 2.3, FLOOR + 1.9, d / 2, { color: R.white });
  b.box(4.8, 0.18, 0.24, 0, FLOOR + 3.8, d / 2, { color: R.white });
  b.box(2.2, 3.6, 0.1, -3.4, FLOOR + 1.8, d / 2 + 1.0, { color: t.color, ry: -1.1, collide: true, surface: 'planks' });
  b.box(2.2, 3.5, 0.1, 2.6, FLOOR + 1.75, d / 2 + 0.5, { color: t.color, ry: 0.35, rz: 0.04, collide: true, surface: 'planks' });
  roof(b, w, d, H, 3.0, C.roofGrey, t.color, 0.5);
  // Heuboden hinten, Leiter, Heuballen; Werkbank, Kiste und Werkzeug.
  b.box(w - 0.4, 0.15, 3.2, 0, FLOOR + 2.6, -d / 2 + 1.8, { color: R.plank, collide: true });
  for (const x of [-w / 2 + 2, 0, w / 2 - 2]) b.box(0.2, 2.6, 0.2, x, FLOOR + 1.3, -d / 2 + 3.3, { color: R.plankDark, collide: true, nav: true });
  b.box(0.5, 2.9, 0.08, -w / 4, FLOOR + 1.35, -d / 2 + 3.6, { color: R.plankDark, rx: -0.25 });
  for (let i = 0; i < 6; i++) b.box(1.2, 0.5, 0.6, -w / 2 + 1.2 + i * 1.6 + rng() * 0.3, FLOOR + 2.95, -d / 2 + 1.2 + rng() * 0.8, { color: R.straw, ry: rng() * 0.3 });
  for (let i = 0; i < 4; i++) b.box(1.2, 0.5, 0.6, w / 2 - 1.2 - (i % 2) * 1.3, FLOOR + 0.25 + Math.floor(i / 2) * 0.5, d / 2 - 1.8, { color: R.straw, collide: true, nav: true });
  b.box(2.2, 0.9, 0.7, -w / 2 + 1.5, FLOOR + 0.45, 0.8, { color: R.plank, collide: true, nav: true });
  b.box(0.6, 0.4, 0.4, -w / 2 + 1.0, FLOOR + 1.1, 0.8, { color: C.rust, container: 'toolbox' });
  b.box(1.0, 0.7, 0.7, -w / 2 + 0.9, FLOOR + 0.35, -1.2, { color: R.plankDark, container: 'crate', nav: true });
  // Stroh am Boden, eine Mistgabel an der Wand, Kette mit Haken vom Balken.
  for (let i = 0; i < 8; i++) b.box(0.4 + rng() * 0.6, 0.015, 0.3 + rng() * 0.4, (rng() - 0.5) * (w - 2), FLOOR + 0.01, (rng() - 0.5) * (d - 2), { color: 0x6e6040, ry: rng() * 3, surface: null });
  b.box(0.04, 1.5, 0.04, w / 2 - 0.3, FLOOR + 0.8, 1.6, { color: R.plankDark, rz: 0.15 });
  b.box(0.04, 2.2, 0.04, 1.5, FLOOR + H - 1.0, -0.5, { color: C.metal });
}

function shed(b: Builder, t: TownBuilding, rng: RandomFn): void {
  const { w, d } = t;
  const H = 2.3;
  b.box(w, FLOOR, d, 0, FLOOR / 2, 0, { color: R.plankDark, collide: true });
  b.wall(0, d / 2 - WALL / 2, true, w, H, [{ at: -w / 4 + 0.2, width: 1.0, y0: 0, y1: 2.0 }], t.color, 'planks');
  b.door(-w / 4 + 0.2, d / 2 - WALL / 2, true, 1.0);
  b.wall(0, -d / 2 + WALL / 2, true, w, H, [], t.color, 'planks');
  b.wall(-w / 2 + WALL / 2, 0, false, d - 2 * WALL, H, [], t.color, 'planks');
  b.wall(w / 2 - WALL / 2, 0, false, d - 2 * WALL, H, [{ at: 0, width: 0.7, y0: 1.1, y1: 1.7 }], t.color, 'planks');
  // Pultdach aus Wellblech, nach hinten abfallend.
  b.box(w + 0.5, 0.08, d + 0.6, 0, FLOOR + H + 0.25, 0, { color: C.rust, bucket: 'out', rx: -0.12, collide: true, surface: 'mossyRock' });
  b.box(1.6, 1.6, 0.45, w / 4, FLOOR + 0.8, -d / 2 + 0.4, { color: C.metal, container: 'shelf', nav: true });
  b.box(0.6, 0.4, 0.4, -w / 2 + 0.6, FLOOR + 0.2, -d / 2 + 0.5, { color: 0xa13a2a, container: 'toolbox' });
  for (let i = 0; i < 3; i++) b.box(0.05, 1.2 + rng() * 0.3, 0.05, w / 2 - 0.25, FLOOR + 0.65, -0.6 + i * 0.3, { color: R.plankDark, rz: 0.1 });
}

function cabin(b: Builder, t: TownBuilding, rng: RandomFn, note?: string): void {
  const { w, d } = t;
  const H = 2.4;
  b.box(w, FLOOR, d, 0, FLOOR / 2, 0, { color: C.floorWood, collide: true });
  const door: Opening = { at: -w / 4, width: 1.0, y0: 0, y1: 2.05 };
  const win = (at: number): Opening => ({ at, width: 1.0, y0: 0.95, y1: 1.75 });
  b.wall(0, d / 2 - WALL / 2, true, w, H, [door, win(w / 4)], t.color, 'planks');
  b.door(door.at, d / 2 - WALL / 2, true, 1.0);
  b.wall(0, -d / 2 + WALL / 2, true, w, H, [win(0)], t.color, 'planks');
  b.wall(-w / 2 + WALL / 2, 0, false, d - 2 * WALL, H, [], t.color, 'planks');
  b.wall(w / 2 - WALL / 2, 0, false, d - 2 * WALL, H, [], t.color, 'planks');
  b.opening('door', 0, d / 2 - WALL / 2, true, door, 1);
  b.opening('window', 0, d / 2 - WALL / 2, true, win(w / 4), 1);
  b.opening('window', 0, -d / 2 + WALL / 2, true, win(0), -1);
  roof(b, w, d, H, 1.2, C.roofTile, t.color, 0.45);
  // Veranda mit Geländer, Stufe
  b.box(w, 0.12, 1.4, 0, 0.06, d / 2 + 0.7, { color: R.plank, collide: true });
  for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) {
    b.box(0.08, 0.08, 1.4, x, 0.95, d / 2 + 0.7, { color: R.plankDark });
    b.box(0.1, 0.95, 0.1, x, 0.5, d / 2 + 1.35, { color: R.plankDark });
  }
  // Innen: Etagenbett, Tisch, Schrank, Ofenrohr
  bunk(b, w / 2 - 1.1, -d / 2 + 0.7, 0);
  table(b, -w / 4, -0.4, 0.9, 0.7, rng, false);
  if (note) b.note(note, -w / 4, FLOOR + 0.77, -0.4, rng() * 0.6 - 0.3);
  b.box(1.1, 0.9, 0.5, -w / 2 + 0.75, FLOOR + 0.45, -d / 2 + 0.45, { color: C.white, container: 'cabinet' });
  if (rng() < 0.6) b.box(0.7, 1.8, 0.5, -w / 2 + 0.5, FLOOR + 0.9, 0.9, { color: C.wood, container: 'wardrobe' });
  // Verrammelt? Ein Tisch vor der Tür (die Bewohner …).
  if (rng() < 0.35) b.box(1.0, 0.75, 0.6, door.at, FLOOR + 0.38, d / 2 - 0.7, { color: C.wood, rz: 0.1, collide: true });
}

function pub(b: Builder, t: TownBuilding, rng: RandomFn, signs: THREE.Group, place: Place, note?: string): void {
  const { w, d } = t;
  const H = 3.0;
  b.box(w, FLOOR, d, 0, FLOOR / 2, 0, { color: C.floorWood, collide: true });
  const door: Opening = { at: 0, width: 1.4, y0: 0, y1: 2.3 };
  const win = (at: number): Opening => ({ at, width: 1.3, y0: 0.95, y1: 2.05 });
  b.wall(0, d / 2 - WALL / 2, true, w, H, [win(-3.3), door, win(3.3)], t.color);
  b.door(0, d / 2 - WALL / 2, true, 1.4);
  b.wall(0, -d / 2 + WALL / 2, true, w, H, [win(-2.5), { at: 3.4, width: 1.0, y0: 0, y1: 2.1 }], t.color);
  b.door(3.4, -d / 2 + WALL / 2, true, 1.0);
  b.wall(-w / 2 + WALL / 2, 0, false, d - 2 * WALL, H, [win(0)], t.color);
  b.wall(w / 2 - WALL / 2, 0, false, d - 2 * WALL, H, [win(0)], t.color);
  b.opening('door', 0, d / 2 - WALL / 2, true, door, 1);
  b.opening('door', 0, -d / 2 + WALL / 2, true, { at: 3.4, width: 1.0, y0: 0, y1: 2.1 }, -1);
  for (const at of [-3.3, 3.3]) b.opening('window', 0, d / 2 - WALL / 2, true, win(at), 1);
  b.opening('window', 0, -d / 2 + WALL / 2, true, win(-2.5), -1);
  b.opening('window', -w / 2 + WALL / 2, 0, false, win(0), -1);
  b.opening('window', w / 2 - WALL / 2, 0, false, win(0), 1);
  roof(b, w, d, H, 2.0, C.roofTile, t.color);
  // Fachwerk-Balken auf der Fassade
  for (const x of [-w / 2 + 0.15, -1.6, 1.6, w / 2 - 0.15]) b.box(0.16, H, 0.06, x, FLOOR + H / 2, d / 2 + 0.03, { color: R.plankDark });
  b.box(w, 0.16, 0.06, 0, FLOOR + H - 0.1, d / 2 + 0.03, { color: R.plankDark });
  // Tresen hinten mit Zapfhahn, Regal mit Flaschen dahinter
  b.box(4.2, 1.05, 0.7, -1.6, FLOOR + 0.52, -d / 2 + 2.0, { color: C.darkWood, container: 'register', nav: true });
  b.box(0.1, 0.35, 0.1, -1.0, FLOOR + 1.22, -d / 2 + 2.0, { color: C.metal });
  b.box(3.6, 1.8, 0.4, -1.6, FLOOR + 0.9, -d / 2 + 0.45, { color: C.wood, container: 'shelf', nav: true });
  for (let i = 0; i < 9; i++) b.box(0.08, 0.28, 0.08, -3.1 + i * 0.36, FLOOR + 1.95, -d / 2 + 0.45, { color: [0x2f5a32, 0x6a3a1e, 0x8a8a7a][i % 3] });
  b.box(0.7, 1.8, 0.7, w / 2 - 0.7, FLOOR + 0.9, -d / 2 + 0.6, { color: 0xdfe0dc, container: 'fridge' });
  if (note) b.note(note, -2.6, FLOOR + 1.08, -d / 2 + 2.0, 0.2);
  // Tische, ein Stammtisch mit Wimpel, Hirschgeweih über der Tür
  table(b, -3, 1.8, 1.3, 0.85, rng);
  table(b, 2.6, 1.6, 1.3, 0.85, rng);
  table(b, 2.8, -1.2, 1.1, 0.8, rng);
  b.box(0.06, 0.4, 0.3, 0.5, FLOOR + 1.0, 1.6, { color: R.red });
  for (const s of [-1, 1]) b.box(0.05, 0.05, 0.6, s * 0.25, FLOOR + H - 0.35, d / 2 - 0.15, { color: R.logEnd, ry: s * 0.6, rx: -0.5 });
  const sg = sign('GASTHOF', 3.4, '#f0e6c8', '#4a2f1f');
  place(sg, 0, FLOOR + H + 0.45, d / 2 + 0.2);
  signs.add(sg);
}

function sawmill(b: Builder, t: TownBuilding, rng: RandomFn, signs: THREE.Group, place: Place, note?: string): void {
  const { w, d } = t;
  const H = 4.0;
  b.box(w, FLOOR, d, 0, FLOOR / 2, 0, { color: 0x67645c, collide: true });
  // Offene Halle: Rückwand und halbe Seitenwände, Dach auf Pfosten.
  b.wall(0, -d / 2 + WALL / 2, true, w, H, [], t.color, 'planks');
  b.wall(-w / 2 + WALL / 2, -d / 4, false, d / 2 - WALL, H, [], t.color, 'planks');
  b.wall(w / 2 - WALL / 2, -d / 4, false, d / 2 - WALL, H, [], t.color, 'planks');
  for (const x of [-w / 2 + 0.2, -w / 6, w / 6, w / 2 - 0.2]) b.box(0.3, H, 0.3, x, FLOOR + H / 2, d / 2 - 0.2, { color: R.plankDark, collide: true, nav: true });
  roof(b, w, d, H, 1.6, C.rust, t.color, 0.8);
  // Sägestraße: Rollenbahn, Sägetisch mit Blatt, Stamm darauf, Sägemehl
  b.box(10, 0.8, 1.0, -1, FLOOR + 0.4, 0.4, { color: C.metal, collide: true, nav: true });
  for (let i = 0; i < 12; i++) log(b, 1.0, 0.06, -5.6 + i * 0.85, FLOOR + 0.84, 0.4, 0x5a5e62, Math.PI / 2, 'in');
  log(b, 6, 0.32, -2.5, FLOOR + 1.2, 0.4, R.bark);
  b.mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.03, 24), 2.6, FLOOR + 1.0, 0.4, 0xa8acb0, 'in', 0, 0, Math.PI / 2);
  b.box(0.8, 1.2, 1.4, 2.6, FLOOR + 0.6, 0.4, { color: 0x3d5a3a });
  for (let i = 0; i < 6; i++) b.box(1 + rng(), 0.08 + rng() * 0.1, 0.8 + rng(), 3 + rng() * 3, FLOOR + 0.05, -1 + rng() * 3, { color: 0xc2a576, ry: rng() * 3 });
  // Bretterstapel, Büroecke mit Schreibtisch, Spind, Werkzeug
  for (let i = 0; i < 5; i++) b.box(3.6, 0.1, 1.1, -4.8, FLOOR + 0.05 + i * 0.11, -d / 2 + 1.2, { color: 0xb89a6a, ry: (rng() - 0.5) * 0.05, collide: i === 4 });
  b.box(1.5, 0.75, 0.75, w / 2 - 1.4, FLOOR + 0.38, -d / 2 + 0.9, { color: C.wood, container: 'desk', nav: true });
  if (note) b.note(note, w / 2 - 1.6, FLOOR + 0.77, -d / 2 + 0.9, -0.2);
  b.box(0.6, 1.9, 0.5, w / 2 - 0.5, FLOOR + 0.95, -1.4, { color: C.metal, container: 'wardrobe', nav: true });
  b.box(0.6, 0.4, 0.4, -w / 2 + 0.7, FLOOR + 0.2, -0.6, { color: 0xa13a2a, container: 'toolbox' });
  const sg = sign('SÄGEWERK', 4, '#f0e6c8', '#3c4a2e');
  place(sg, 0, FLOOR + H + 0.6, d / 2 - 0.05);
  signs.add(sg);
}

function kiosk(b: Builder, t: TownBuilding, rng: RandomFn, signs: THREE.Group, place: Place, note?: string): void {
  const { w, d } = t;
  const H = 2.6;
  b.box(w, FLOOR, d, 0, FLOOR / 2, 0, { color: C.floorWood, collide: true });
  b.wall(0, d / 2 - WALL / 2, true, w, H, [{ at: 0.6, width: 2.4, y0: 1.0, y1: 2.0 }], t.color, 'planks');
  b.wall(0, -d / 2 + WALL / 2, true, w, H, [], t.color, 'planks');
  b.wall(-w / 2 + WALL / 2, 0, false, d - 2 * WALL, H, [{ at: 0.4, width: 1.0, y0: 0, y1: 2.05 }], t.color, 'planks');
  b.door(-w / 2 + WALL / 2, 0.4, false, 1.0);
  b.wall(w / 2 - WALL / 2, 0, false, d - 2 * WALL, H, [], t.color, 'planks');
  b.box(w + 1.2, 0.16, d + 1.6, 0, FLOOR + H + 0.08, 0.4, { color: C.roofGrey, bucket: 'out', collide: true });
  b.box(2.6, 0.06, 0.5, 0.6, FLOOR + 1.0, d / 2 + 0.1, { color: R.plank });
  b.box(2.0, 1.0, 0.6, 0.6, FLOOR + 0.5, d / 2 - 0.6, { color: C.wood, container: 'register', nav: true });
  if (note) b.note(note, 0.2, FLOOR + 1.03, d / 2 - 0.6, 0.15);
  b.box(1.8, 1.6, 0.4, 0.5, FLOOR + 0.8, -d / 2 + 0.4, { color: C.metal, container: 'shelf', nav: true });
  // Schlüsselbrett: ein paar Haken, die meisten leer.
  b.box(0.8, 0.5, 0.04, w / 2 - 0.22, FLOOR + 1.6, -0.6, { color: R.plank, ry: Math.PI / 2 });
  for (let i = 0; i < 6; i++) if (rng() < 0.3) b.box(0.03, 0.08, 0.02, w / 2 - 0.26, FLOOR + 1.5 + (i % 2) * 0.2, -0.85 + Math.floor(i / 2) * 0.2, { color: C.metal });
  const sg = sign('REZEPTION', 2.6, '#f0e6c8', '#2f4a5e');
  place(sg, 0, FLOOR + H + 0.45, d / 2 + 0.75);
  signs.add(sg);
}

/** @returns false, wenn der Gebäudetyp nicht hierher gehört. */
export function ruralBuilding(b: Builder, t: TownBuilding, rng: RandomFn, signs: THREE.Group, place: Place): boolean {
  switch (t.kind) {
    case 'barn':
      barn(b, t, rng);
      return true;
    case 'shed':
      shed(b, t, rng);
      return true;
    case 'cabin':
      cabin(b, t, rng, t.note);
      return true;
    case 'pub':
      pub(b, t, rng, signs, place, t.note);
      return true;
    case 'sawmill':
      sawmill(b, t, rng, signs, place, t.note);
      return true;
    case 'kiosk':
      kiosk(b, t, rng, signs, place, t.note);
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Requisiten
// ---------------------------------------------------------------------------

/** Pfeilschild als Textur: Spitze rechts (Vorderseite) bzw. links (Rückseite, damit es von hinten richtig zeigt). */
function arrowTexture(text: string, km: string, tipLeft: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  if (tipLeft) {
    ctx.translate(512, 0);
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = '#e9e4d6';
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(450, 6);
  ctx.lineTo(506, 48);
  ctx.lineTo(450, 90);
  ctx.lineTo(0, 90);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#7a2a22';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = 'rgba(60,50,30,0.25)';
  for (let i = 0; i < 10; i++) ctx.fillRect(Math.random() * 480, Math.random() * 90, 10 + Math.random() * 40, 3 + Math.random() * 8);
  ctx.restore();
  ctx.fillStyle = '#2a2622';
  ctx.textBaseline = 'middle';
  const x0 = tipLeft ? 70 : 18;
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.fillText(text, x0, 50, 320);
  ctx.textAlign = 'right';
  ctx.font = '38px system-ui, sans-serif';
  ctx.fillText(km, tipLeft ? 494 : 440, 50);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Wegweiser-Arm: zwei Seiten, beide lesbar, die Spitze zeigt immer in dieselbe Richtung. */
function arrowSign(text: string, km: string): THREE.Group {
  const g = new THREE.Group();
  for (const back of [false, true]) {
    const mat = new THREE.MeshStandardMaterial({ map: arrowTexture(text, km, back), roughness: 0.85, transparent: true, alphaTest: 0.5 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.26), mat);
    mesh.castShadow = true;
    if (back) {
      mesh.rotation.y = Math.PI;
      mesh.position.z = -0.012;
    }
    g.add(mesh);
  }
  return g;
}

/** Gelbes Ortsschild mit schwarzem Rand (wie an deutschen Landstraßen). */
function townSign(name: string): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e8c42c';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#151515';
  ctx.lineWidth = 14;
  ctx.strokeRect(14, 14, 484, 228);
  ctx.fillStyle = 'rgba(80,60,20,0.3)';
  for (let i = 0; i < 18; i++) ctx.fillRect(Math.random() * 512, Math.random() * 256, 6 + Math.random() * 40, 2 + Math.random() * 10);
  ctx.fillStyle = '#151515';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const words = name.split(' ');
  const lines = words.length > 1 && name.length > 12 ? [words[0], words.slice(1).join(' ')] : [name];
  ctx.font = `bold ${lines.length > 1 ? 54 : 70}px system-ui, sans-serif`;
  lines.forEach((l, i) => ctx.fillText(l, 256, 128 + (i - (lines.length - 1) / 2) * 66, 450));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.1 }));
  mesh.castShadow = true;
  return mesh;
}

/** Handgemaltes Warnschild: rote Farbe auf grauem Brett, mit Läufern. */
function warnTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#6a604f';
  ctx.fillRect(0, 0, 512, 256);
  // Bretterfugen und Maserung
  ctx.fillStyle = 'rgba(30,24,16,0.5)';
  for (const y of [84, 170]) ctx.fillRect(0, y, 512, 4);
  ctx.strokeStyle = 'rgba(40,32,20,0.25)';
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    const y = Math.random() * 256;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(170, y + Math.random() * 10 - 5, 340, y + Math.random() * 10 - 5, 512, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#8f1d14';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const words = text.split(' ');
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + w).length <= 14) lines[lines.length - 1] = last + ' ' + w;
    else lines.push(w);
  }
  // So groß, wie es aufs Brett passt (eine Zeile groß, mehrere kleiner).
  let size = lines.length > 2 ? 66 : lines.length > 1 ? 92 : 130;
  ctx.font = `bold ${size}px Impact, "Arial Black", sans-serif`;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (widest > 470) size = Math.floor((size * 470) / widest);
  ctx.font = `bold ${size}px Impact, "Arial Black", sans-serif`;
  lines.forEach((l, i) => {
    const y = 128 + (i - (lines.length - 1) / 2) * size * 1.05;
    // Buchstaben einzeln, leicht verwackelt – mit dem Pinsel gemalt.
    const width = ctx.measureText(l).width;
    let x = 256 - width / 2;
    for (const ch of l) {
      const cw = ctx.measureText(ch).width;
      ctx.save();
      ctx.translate(x + cw / 2, y + (Math.random() - 0.5) * 8);
      ctx.rotate((Math.random() - 0.5) * 0.12);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      // Läufer: Farbe rinnt nach unten.
      if (Math.random() < 0.3) ctx.fillRect(x + cw * (0.2 + Math.random() * 0.6), y + size * 0.3, 3, 10 + Math.random() * 30);
      x += cw;
    }
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** @returns false, wenn die Requisite nicht hierher gehört. */
export function ruralProp(b: Builder, p: TownProp, rng: RandomFn, signs: THREE.Group, place: Place): boolean {
  switch (p.kind) {
    case 'tractor': {
      b.box(1.3, 0.9, 2.2, 0, 1.0, 0.4, { color: p.color, bucket: 'out', collide: true, nav: true });
      b.box(1.1, 0.6, 1.4, 0, 1.75, 0.9, { color: p.color, bucket: 'out' });
      b.box(1.2, 1.3, 1.2, 0, 2.0, -0.6, { color: C.glassDark, bucket: 'out' });
      b.box(1.3, 0.08, 1.3, 0, 2.7, -0.6, { color: p.color, bucket: 'out' });
      b.box(0.1, 0.9, 0.1, 0.35, 2.4, 1.3, { color: R.black });
      const big = new THREE.CylinderGeometry(0.75, 0.75, 0.45, 14);
      const small = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
      for (const s of [-1, 1]) {
        b.mesh(big, s * 0.95, 0.75, -0.6, C.tire, 'out', 0, 0, Math.PI / 2);
        b.mesh(small, s * 0.8, 0.42, 1.35, C.tire, 'out', 0, 0, Math.PI / 2);
      }
      return true;
    }
    case 'hay':
      b.mesh(new THREE.CylinderGeometry(0.72, 0.72, 1.2, 14), 0, 0.72, 0, R.straw, 'out', 0, 0, Math.PI / 2);
      b.box(1.2, 1.3, 1.3, 0, 0.65, 0, { color: R.straw, invisible: true, collide: true, nav: true });
      return true;
    case 'fence': {
      const len = p.length ?? 6;
      const tilt = p.tilt ?? 0;
      for (let x = -len / 2; x <= len / 2 + 0.01; x += 2) b.box(0.1, 1.2, 0.1, x, 0.6, 0, { color: R.plankDark, rz: tilt * 0.3 + (rng() - 0.5) * 0.08 });
      for (const y of [0.45, 0.95]) b.box(len, 0.1, 0.05, 0, y, 0, { color: R.plank, rz: tilt * 0.05 });
      b.box(len, 1.2, 0.12, 0, 0.6, 0, { color: R.plank, invisible: true, collide: true, nav: true });
      return true;
    }
    case 'field': {
      const len = p.length ?? 12;
      const dep = p.depth ?? 10;
      let stalks = 0;
      for (let z = -dep / 2 + 0.45; z < dep / 2; z += 0.9) {
        b.box(len, 0.12, 0.55, 0, 0.02, z, { color: (Math.round(z * 10) & 1) === 0 ? R.soil : R.soilDark, bucket: 'out', surface: 'mud' });
        for (let k = 0; k < 6 && stalks < 140; k++, stalks++) {
          if (rng() < 0.35) continue;
          b.box(0.04, 0.4 + rng() * 0.5, 0.04, (rng() - 0.5) * (len - 1), 0.35, z + (rng() - 0.5) * 0.2, { color: R.stalk, rx: (rng() - 0.5) * 0.5, rz: (rng() - 0.5) * 0.5 });
        }
      }
      return true;
    }
    case 'well':
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        b.box(0.5, 0.75, 0.25, Math.cos(a) * 0.65, 0.38, Math.sin(a) * 0.65, { color: R.stone, ry: -a + Math.PI / 2, surface: 'mossyRock' });
      }
      b.box(0.9, 0.05, 0.9, 0, 0.5, 0, { color: 0x0a0c0e });
      b.box(1.5, 0.8, 1.5, 0, 0.4, 0, { color: R.stone, invisible: true, collide: true, nav: true });
      for (const s of [-1, 1]) b.box(0.12, 2.0, 0.12, s * 0.75, 1.0, 0, { color: R.plankDark });
      b.box(1.7, 0.08, 0.1, 0, 1.9, 0, { color: R.plankDark });
      for (const s of [-1, 1]) b.box(1.8, 0.08, 0.9, 0, 2.15, s * 0.32, { color: C.roofTile, rx: s * 0.6, bucket: 'out' });
      b.box(0.25, 0.3, 0.25, 0.1, 1.45, 0, { color: C.rust });
      return true;
    case 'scarecrow':
      b.box(0.1, 2.3, 0.1, 0, 1.15, 0, { color: R.plankDark, collide: true });
      b.box(1.6, 0.08, 0.08, 0, 1.75, 0, { color: R.plankDark });
      b.box(0.55, 0.75, 0.3, 0, 1.55, 0, { color: 0x4a4a3a });
      for (const s of [-1, 1]) b.box(0.6, 0.18, 0.2, s * 0.55, 1.72, 0, { color: 0x4a4a3a, rz: s * -0.2 });
      b.box(0.32, 0.38, 0.3, 0, 2.15, 0, { color: 0xb8a882, rz: 0.25 });
      b.box(0.5, 0.06, 0.5, 0.03, 2.38, 0, { color: R.strawDark, rz: 0.25 });
      // Zwei dunkle Augenlöcher
      for (const s of [-1, 1]) b.box(0.05, 0.05, 0.02, s * 0.07 - 0.03, 2.2, 0.16, { color: 0x101010, rz: 0.25 });
      return true;
    case 'woodpile':
      for (let row = 0; row < 3; row++)
        for (let i = 0; i < 6 - row; i++) {
          b.mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 7), -0.8 + i * 0.27 + row * 0.13, 0.13 + row * 0.23, 0, rng() < 0.5 ? R.logEnd : R.bark, 'out', Math.PI / 2, 0, 0, 'planks');
        }
      b.box(1.8, 0.8, 0.7, -0.1, 0.4, 0, { color: R.bark, invisible: true, collide: true, nav: true });
      b.box(1.9, 0.06, 0.9, -0.1, 0.95, -0.05, { color: C.rust, rx: 0.15, bucket: 'out' });
      return true;
    case 'caravan': {
      b.box(2.2, 2.0, 5.0, 0, 1.4, 0, { color: p.color, bucket: 'out', collide: true, nav: true, container: p.loot ? 'caravan' : undefined, surface: null });
      b.box(2.22, 0.25, 5.02, 0, 1.25, 0, { color: [0x8a3a2a, 0x3a5a7a, 0x5a6a3a][Math.floor(rng() * 3)], bucket: 'out' });
      for (const z of [-1.4, 1.2]) b.box(2.24, 0.6, 1.0, 0, 1.9, z, { color: C.glassDark, bucket: 'out' });
      b.box(0.04, 1.6, 0.7, 1.12, 1.2, -0.2, { color: 0xb8b2a4 });
      b.box(0.15, 0.15, 1.3, 0, 0.45, 3.1, { color: C.metal });
      for (const s of [-1, 1]) b.mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10), s * 1.05, 0.34, 0.2, C.tire, 'out', 0, 0, Math.PI / 2);
      // Vorzelt hängt in Fetzen
      if (rng() < 0.6) b.box(0.04, 1.6, 2.2, 1.9, 1.3, 0.4, { color: 0x6a6a4a, rz: 0.5 });
      return true;
    }
    case 'tent': {
      const g = gable(2.0, 1.25);
      const collapsed = (p.tilt ?? 0) > 0;
      b.mesh(g, 0, 0.02, 0, p.color, 'out', 0, 0, collapsed ? 0.5 : 0);
      b.mesh(new THREE.BoxGeometry(2.0, 0.02, 2.3), 0, 0.01, 0, R.canvas, 'out');
      // Länger als der Giebel: den Giebel entlang Z in die Länge ziehen.
      b.box(0.02, 1.4, 2.4, -0.58, 0.6, 0, { color: p.color, rz: collapsed ? 1.2 : 0.75, bucket: 'out' });
      b.box(0.02, 1.4, 2.4, 0.58, 0.6, 0, { color: p.color, rz: collapsed ? -0.3 : -0.75, bucket: 'out' });
      b.box(2.0, 1.0, 2.4, 0, 0.5, 0, { color: p.color, invisible: true, collide: true });
      return true;
    }
    case 'picnic':
      b.box(1.8, 0.07, 0.8, 0, 0.75, 0, { color: R.plank, collide: true, bucket: 'out' });
      for (const s of [-1, 1]) {
        b.box(1.8, 0.06, 0.3, 0, 0.45, s * 0.7, { color: R.plank, bucket: 'out' });
        b.box(0.08, 0.8, 1.6, s * 0.7, 0.38, 0, { color: R.plankDark, rx: 0 });
      }
      return true;
    case 'firepit':
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        b.box(0.2, 0.12, 0.16, Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55, { color: 0x4a4844, ry: a + rng(), rx: rng() * 0.3, surface: 'mossyRock' });
      }
      for (let i = 0; i < 3; i++) b.mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6), 0, 0.12, 0, C.char, 'out', Math.PI / 2, i * 1.1, 0.2);
      b.box(0.8, 0.02, 0.8, 0, 0.02, 0, { color: 0x2a2622 });
      return true;
    case 'logpile': {
      const n = [4, 3, 2];
      n.forEach((cnt, row) => {
        for (let i = 0; i < cnt; i++) log(b, 5 + rng() * 0.6, 0.3, 0, 0.3 + row * 0.52, -((cnt - 1) * 0.62) / 2 + i * 0.62, R.bark, Math.PI / 2);
      });
      b.box(5.2, 1.5, 2.6, 0, 0.75, 0, { color: R.bark, invisible: true, collide: true, nav: true });
      for (const s of [-1, 1]) b.box(0.15, 1.2, 0.15, s * 2.0, 0.6, 1.4, { color: R.plankDark });
      return true;
    }
    case 'truck': {
      b.box(2.3, 1.3, 2.0, 0, 1.3, 3.0, { color: p.color, bucket: 'out', collide: true, nav: true });
      b.box(2.1, 0.7, 1.0, 0, 2.2, 2.6, { color: C.glassDark, bucket: 'out' });
      b.box(2.4, 0.3, 5.6, 0, 0.95, -0.9, { color: 0x3a3a3a, bucket: 'out', collide: true, nav: true, container: p.loot ? 'car' : undefined });
      for (let i = 0; i < 3; i++) log(b, 5.2, 0.28, (i - 1) * 0.62, 1.4, -0.9, R.bark);
      log(b, 5.2, 0.28, 0.31, 1.9, -0.9, R.bark);
      for (const s of [-1, 1]) for (const z of [-2.6, -1.2, 3.0]) b.mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.35, 12), s * 1.1, 0.48, z, C.tire, 'out', 0, 0, Math.PI / 2);
      for (const s of [-1, 1]) b.box(0.08, 1.4, 0.08, s * 1.15, 1.6, -3.6, { color: C.metal });
      return true;
    }
    case 'busstop': {
      b.box(3.0, 0.08, 1.4, 0, 2.4, 0, { color: C.metal, bucket: 'out' });
      for (const x of [-1.45, 1.45]) b.box(0.08, 2.4, 0.08, x, 1.2, -0.6, { color: C.metal, collide: true });
      b.box(3.0, 1.8, 0.04, 0, 1.3, -0.65, { color: C.glassDark, collide: true });
      b.box(2.4, 0.06, 0.4, 0, 0.45, -0.4, { color: R.plank, collide: true });
      b.box(0.08, 2.6, 0.08, 1.9, 1.3, 0.5, { color: C.metal });
      const h = sign('H', 0.5, '#2a5a2a', '#e8c42c');
      place(h, 1.9, 2.5, 0.54);
      signs.add(h);
      return true;
    }
    case 'phonebox':
      b.box(1.0, 2.3, 1.0, 0, 1.15, 0, { color: 0xc9c2a8, bucket: 'out', collide: true, nav: true });
      b.box(1.02, 1.5, 0.8, 0, 1.25, 0, { color: C.glassDark, bucket: 'out' });
      b.box(1.04, 0.25, 1.04, 0, 2.2, 0, { color: R.yellow, bucket: 'out' });
      return true;
    case 'pole': {
      const tilt = p.tilt ?? 0;
      // Um den Fuß gekippt (nicht um die Mitte).
      b.box(0.24, 8, 0.24, -Math.sin(tilt) * 4, Math.cos(tilt) * 4, 0, { color: R.pole, rz: tilt, collide: true, surface: 'planks' });
      const topX = -Math.sin(tilt) * 7.6;
      const topY = Math.cos(tilt) * 7.6;
      b.box(1.8, 0.12, 0.12, topX, topY, 0, { color: R.pole, rz: tilt });
      for (const x of [-0.75, 0, 0.75]) b.box(0.08, 0.18, 0.08, topX + x * Math.cos(tilt), topY + 0.15 + x * Math.sin(tilt), 0, { color: R.ceramic });
      if (p.link) {
        // Leitungen mit Durchhang (lokal: x quer, z entlang des Weges)
        const [lx, ly, lz] = p.link;
        for (const off of [-0.75, 0.75]) {
          const ax = topX + off;
          const ay = topY + 0.25;
          const segs = 6;
          let px = ax;
          let py = ay;
          let pz = 0;
          for (let k = 1; k <= segs; k++) {
            const u = k / segs;
            const x = ax + (lx + off - ax) * u;
            const z = lz * u;
            const y = ay + (ly + 0.25 - ay) * u - Math.sin(u * Math.PI) * 0.7;
            const mx = (px + x) / 2;
            const my = (py + y) / 2;
            const mz = (pz + z) / 2;
            const len = Math.hypot(x - px, y - py, z - pz);
            const yaw = Math.atan2(x - px, z - pz);
            const pitch = -Math.atan2(y - py, Math.hypot(x - px, z - pz));
            b.box(0.025, 0.025, len, mx, my, mz, { color: 0x1a1a1a, rx: pitch, ry: yaw, order: 'YXZ', surface: null });
            px = x;
            py = y;
            pz = z;
          }
        }
      }
      return true;
    }
    case 'post':
      b.box(0.12, 1.0, 0.12, 0, 0.5, 0, { color: R.white, rz: p.tilt ?? 0 });
      b.box(0.125, 0.25, 0.125, 0, 0.8, 0, { color: R.black, rz: p.tilt ?? 0 });
      b.box(0.04, 0.12, 0.13, 0, 0.8, 0, { color: 0xd26a1a, rz: p.tilt ?? 0 });
      return true;
    case 'signpost': {
      b.box(0.1, 2.6, 0.1, 0, 1.3, 0, { color: R.white, collide: true });
      (p.text ?? []).forEach((line, i) => {
        const [name, km, yawStr] = line.split('|');
        const yaw = Number(yawStr) - p.rotation;
        const m = arrowSign(name, km);
        // Pfeil zeigt in Richtung `yaw` (lokal): Schild entlang dieser Richtung versetzt.
        const ox = Math.sin(yaw) * 0.68;
        const oz = Math.cos(yaw) * 0.68;
        place(m, ox, 2.35 - i * 0.3, oz, yaw - Math.PI / 2);
        signs.add(m);
      });
      return true;
    }
    case 'townsign': {
      for (const s of [-1, 1]) b.box(0.07, 2.2, 0.07, s * 0.55, 1.1, 0, { color: 0x7a7c80 });
      // Rückseite: graues Blech (die Vorderseite ist nur von vorn lesbar).
      b.box(1.32, 0.67, 0.025, 0, 1.8, 0.03, { color: 0x8a8c8e, surface: null });
      const m = townSign((p.text ?? ['?'])[0]);
      place(m, 0, 1.8, 0.045);
      signs.add(m);
      return true;
    }
    // --- Fundorte im Wald ---
    case 'hunterstand': {
      // Vier schräge Beine, Kanzel auf 3,6 m, Treppe (Stufen als Kollision), Dach.
      const top = 3.6;
      for (const [x, z] of [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]])
        b.box(0.14, top + 0.2, 0.14, x * 1.08, (top + 0.2) / 2, z * 1.08, { color: R.bark, rx: z * 0.05, rz: -x * 0.05, collide: true, surface: 'planks' });
      for (const y of [1.2, 2.4]) {
        b.box(1.9, 0.08, 0.08, 0, y, -0.9, { color: R.bark, rz: 0.5 });
        b.box(0.08, 0.08, 1.9, 0.9, y, 0, { color: R.bark, rx: -0.5 });
      }
      b.box(1.8, 0.1, 1.8, 0, top, 0, { color: R.plank, collide: true });
      for (const [x, z, w, d] of [[0, -0.88, 1.8, 0.06], [-0.88, 0, 0.06, 1.8], [0.88, 0, 0.06, 1.8]] as [number, number, number, number][])
        b.box(w, 1.0, d, x, top + 0.55, z, { color: R.plankDark, collide: true, surface: 'planks' });
      // Vorn nur eine Brüstung (Einstieg von der Treppe in der Mitte frei)
      for (const s of [-1, 1]) b.box(0.6, 1.0, 0.06, s * 0.6, top + 0.55, 0.88, { color: R.plankDark, collide: true, surface: 'planks' });
      for (const [x, z] of [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]]) b.box(0.08, 1.1, 0.08, x, top + 1.6, z, { color: R.bark });
      b.box(2.2, 0.08, 2.3, 0, top + 2.2, -0.05, { color: C.roofGrey, rx: 0.18, bucket: 'out', collide: true });
      // Steile Treppe nach vorn (+Z): Stufen zum Ansehen, darunter eine Rampe als Kollision (≈ 41°).
      const steps = 14;
      const run = 4.2;
      const z0 = 0.95;
      const slope = Math.atan2(top, run);
      for (let i = 0; i < steps; i++) {
        const u = (i + 1) / steps;
        b.box(0.62, 0.05, 0.24, 0, top * u - 0.03, z0 + run * (1 - u) + 0.1, { color: R.plank });
      }
      const len = Math.hypot(run, top);
      for (const s of [-1, 1]) b.box(0.07, 0.12, len + 0.2, s * 0.34, top / 2 - 0.05, z0 + run / 2, { color: R.bark, rx: slope });
      // Die Rampe reicht 1,2 m in den Boden (am Hang setzt die Treppe tiefer auf).
      const below = 1.2;
      const ext = below / Math.tan(slope);
      b.box(0.64, 0.1, Math.hypot(run + ext, top + below), 0, (top - below) / 2 - 0.06, z0 + (run + ext) / 2, { color: R.plank, rx: slope, invisible: true, collide: true });
      if (p.loot) b.box(0.7, 0.45, 0.45, -0.4, top + 0.28, -0.5, { color: 0x3d4a2e, container: 'ammo' });
      return true;
    }
    case 'shrine': {
      b.box(0.5, 0.25, 0.5, 0, 0.12, 0, { color: R.stone, collide: true, surface: 'mossyRock' });
      b.box(0.14, 1.9, 0.14, 0, 1.15, 0, { color: R.plankDark, collide: true });
      b.box(0.7, 0.1, 0.12, 0, 1.75, 0, { color: R.plankDark });
      // Kästchen mit Dach (Marterl), darin ein Bild
      b.box(0.42, 0.45, 0.25, 0, 1.35, 0.12, { color: R.plank });
      b.box(0.3, 0.32, 0.02, 0, 1.36, 0.25, { color: 0x6a5a8a });
      for (const s of [-1, 1]) b.box(0.32, 0.04, 0.36, s * 0.14, 1.65, 0.12, { color: C.roofTile, rz: s * -0.55, bucket: 'out' });
      // Kerzen und verwelkte Blumen am Sockel
      for (let i = 0; i < 4; i++) b.mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.08 + rng() * 0.08, 6), -0.15 + i * 0.1, 0.3, 0.18, 0xe8e0c8, 'out');
      for (let i = 0; i < 5; i++) b.box(0.03, 0.25, 0.03, -0.18 + i * 0.09, 0.36, -0.12, { color: [0x6a2a3a, 0x8a7a3a, 0x5a3a5a][i % 3], rz: (rng() - 0.5) * 0.6 });
      return true;
    }
    case 'totem': {
      // Dreibein aus Ästen, oben ein Geweih, Lumpen und Knochen hängen daran.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.box(0.08, 2.8, 0.08, Math.cos(a) * 0.35, 1.35, Math.sin(a) * 0.35, { color: R.bark, rx: Math.sin(a) * 0.25, rz: -Math.cos(a) * 0.25 });
      }
      b.box(0.5, 0.5, 0.5, 0, 1.2, 0, { color: R.bark, invisible: true, collide: true });
      for (const s of [-1, 1]) {
        b.box(0.04, 0.55, 0.04, s * 0.2, 2.95, 0, { color: 0xc8bea4, rz: s * -0.6 });
        b.box(0.03, 0.25, 0.03, s * 0.34, 3.05, 0.05, { color: 0xc8bea4, rz: s * -0.2 });
      }
      b.mesh(new THREE.SphereGeometry(0.14, 6, 5), 0, 2.72, 0.02, 0xd8d0bc, 'out');
      for (let i = 0; i < 4; i++) b.box(0.12, 0.45 + rng() * 0.3, 0.01, (rng() - 0.5) * 0.5, 1.9 - rng() * 0.4, 0.3, { color: [0x5a3028, 0x3a3a30, 0x6a5a48][i % 3], ry: rng() * 3 });
      for (let i = 0; i < 6; i++) {
        const a = rng() * Math.PI * 2;
        b.box(0.3, 0.16, 0.25, Math.cos(a) * 0.9, 0.08, Math.sin(a) * 0.9, { color: R.stone, ry: a, surface: 'mossyRock' });
      }
      return true;
    }
    case 'stonewall': {
      // Grundmauern eines alten Hauses: Ecken höher, Mitte eingestürzt.
      const L = p.length ?? 7;
      const D = p.depth ?? 6;
      const segs: [number, number, number, number][] = [
        [0, -D / 2, L, 0],
        [-L / 2, 0, D, 1],
        [L / 2, 0, D, 1],
        [0, D / 2, L, 0],
      ];
      segs.forEach(([x, z, len, alongZ], si) => {
        const n = Math.round(len / 1.1);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n - 0.5;
          // Vorderwand mit Türlücke, Höhe fällt zur Mitte ab.
          if (si === 3 && Math.abs(t) < 0.14) continue;
          const h = Math.max(0.2, (0.6 + Math.abs(t) * 3.2) * (0.6 + rng() * 0.6) - (rng() < 0.15 ? 1 : 0));
          const px = alongZ ? x : x + t * len;
          const pz = alongZ ? z + t * len : z;
          b.box(alongZ ? 0.5 : len / n + 0.02, h, alongZ ? len / n + 0.02 : 0.5, px, h / 2, pz, { color: [R.stone, 0x6a6860, 0x5f5d55][i % 3], collide: true, nav: true, surface: 'mossyRock' });
        }
      });
      for (let i = 0; i < 9; i++) b.box(0.3 + rng() * 0.4, 0.2 + rng() * 0.2, 0.3 + rng() * 0.3, (rng() - 0.5) * L * 0.8, 0.1, (rng() - 0.5) * D * 0.8, { color: R.stone, ry: rng() * 3, surface: 'mossyRock' });
      // Ein verkohlter Balken quer über den Resten
      b.box(L * 0.7, 0.18, 0.2, 0.3, 0.5, 0.4, { color: C.char, ry: 0.4, rz: 0.12 });
      return true;
    }
    case 'chimney':
      b.box(0.9, 4.2, 0.9, 0, 2.1, 0, { color: 0x6e5a4a, collide: true, nav: true, surface: 'mossyRock' });
      b.box(1.0, 0.2, 1.0, 0, 4.25, 0, { color: 0x5a4a3c });
      b.box(0.6, 0.6, 0.1, 0, 0.5, 0.46, { color: 0x141210 });
      return true;
    case 'clothesline': {
      for (const s of [-1, 1]) b.box(0.08, 1.9, 0.08, s * 2, 0.95, 0, { color: R.plankDark, rz: s === 1 ? 0.12 : 0 });
      b.box(4.0, 0.015, 0.015, 0, 1.82, 0, { color: 0xcfc8b8, rz: 0.02 });
      for (let i = 0; i < 4; i++) {
        if (rng() < 0.25) continue;
        b.box(0.45 + rng() * 0.3, 0.5 + rng() * 0.3, 0.01, -1.4 + i * 0.9, 1.45, 0, { color: [0x7a2a2a, 0x3a4a6a, 0xc8c2b0, 0x4a5a3a][i], rz: (rng() - 0.5) * 0.2 });
      }
      return true;
    }
    case 'stump': {
      b.mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.5, 9), 0, 0.25, 0, R.bark, 'out', 0, 0, 0, 'bark');
      b.mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.02, 9), 0, 0.5, 0, R.logEnd, 'out');
      b.box(0.6, 0.5, 0.6, 0, 0.25, 0, { color: R.bark, invisible: true, collide: true });
      // Eine Axt steckt im Stumpf.
      if ((p.tilt ?? 0) > 0) {
        b.box(0.04, 0.6, 0.04, 0.1, 0.78, 0, { color: C.wood, rz: 0.5 });
        b.box(0.16, 0.12, 0.03, 0, 0.52, 0, { color: 0x8d9296, rz: 0.5 });
      }
      return true;
    }
    case 'warnsign': {
      const tilt = p.tilt ?? 0;
      b.box(0.1, 2.0, 0.1, 0, 1.0, -0.05, { color: R.plankDark, rz: tilt * 0.4, collide: true });
      b.box(1.25, 0.65, 0.04, 0, 1.55, 0, { color: 0x5a5244, rz: tilt });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.22, 0.6), new THREE.MeshStandardMaterial({ map: warnTexture((p.text ?? ['UMKEHREN'])[0]), roughness: 0.95 }));
      mesh.castShadow = true;
      mesh.rotation.z = tilt;
      const holder = new THREE.Group();
      holder.add(mesh);
      place(holder, 0, 1.55, 0.025);
      signs.add(holder);
      return true;
    }
    case 'backpack':
      b.box(0.36, 0.48, 0.24, 0, 0.2, 0, { color: [0x3a4a2a, 0x2a3a5a, 0x7a3a22][Math.floor(rng() * 3)], rx: 1.25, container: p.loot ? 'pack' : undefined });
      b.box(0.3, 0.16, 0.12, 0, 0.12, 0.25, { color: 0x2a2a24, rx: 1.25 });
      return true;
    case 'droplight':
      b.mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.22, 8), 0, 0.04, 0, 0x2a2a2a, 'out', Math.PI / 2, 0, 0);
      b.mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.06, 8), 0, 0.05, 0.13, 0x9a9a9a, 'out', Math.PI / 2, 0, 0);
      return true;
    case 'bones':
      for (let i = 0; i < 5; i++) b.box(0.04, 0.04, 0.25 + rng() * 0.25, (rng() - 0.5) * 0.8, 0.03, (rng() - 0.5) * 0.8, { color: 0xd0c8b2, ry: rng() * 3 });
      b.box(0.3, 0.06, 0.18, 0.1, 0.04, 0.1, { color: 0xc8bea6, ry: rng() * 3 });
      return true;
    case 'crate':
      b.box(0.9, 0.6, 0.6, 0, 0.3, 0, { color: R.plankDark, container: p.loot ? 'crate' : undefined, collide: true, nav: true });
      b.box(0.92, 0.06, 0.62, 0, 0.55, 0, { color: R.plank });
      return true;
    case 'toolchest':
      b.box(0.7, 0.4, 0.4, 0, 0.2, 0, { color: 0xa13a2a, container: p.loot ? 'toolbox' : undefined, collide: true });
      return true;
    case 'note':
      b.note((p.text ?? [''])[0], 0, 0.01, 0, 0);
      return true;
    case 'stickmen': {
      // Ein toter, krummer Baum; an seinen Ästen hängen Figuren aus Zweigen, mit Schnur gebunden.
      const lean = (rng() - 0.5) * 0.12;
      b.mesh(new THREE.CylinderGeometry(0.14, 0.26, 5, 7), 0, 2.5, 0, R.bark, 'out', lean, 0, lean, 'bark');
      b.box(0.5, 2.5, 0.5, 0, 1.25, 0, { color: R.bark, invisible: true, collide: true });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + rng();
        const y = 2.6 + i * 0.45;
        const len = 1.4 + rng() * 0.8;
        b.box(0.07, 0.07, len, Math.cos(a) * len * 0.45, y + 0.25, Math.sin(a) * len * 0.45, { color: R.bark, ry: -a + Math.PI / 2, rx: -0.35, bucket: 'out' });
        if (i === 4) continue;
        // Figur an der Schnur
        const fx = Math.cos(a) * len * 0.7;
        const fz = Math.sin(a) * len * 0.7;
        const hang = 0.6 + rng() * 0.7;
        const top = y + 0.35;
        const cy = top - hang - 0.55;
        b.box(0.012, hang, 0.012, fx, top - hang / 2, fz, { color: 0xb8a878, bucket: 'out' });
        b.box(0.045, 1.1, 0.045, fx, cy, fz, { color: 0x8a7458, bucket: 'out' });
        b.box(0.8, 0.045, 0.045, fx, cy + 0.3, fz, { color: 0x8a7458, ry: -a, bucket: 'out' });
        for (const s of [-1, 1]) b.box(0.04, 0.7, 0.04, fx + Math.cos(a + Math.PI / 2) * s * 0.13, cy - 0.78, fz + Math.sin(a + Math.PI / 2) * s * 0.13, { color: 0x8a7458, rz: s * 0.3, ry: -a, bucket: 'out' });
        b.box(0.09, 0.06, 0.09, fx, cy + 0.3, fz, { color: 0xb8a878, bucket: 'out' });
        b.box(0.09, 0.06, 0.09, fx, cy - 0.35, fz, { color: 0xb8a878, bucket: 'out' });
      }
      // Kleine Figuren im Boden gesteckt, wie eine Warnung
      for (let i = 0; i < 4; i++) {
        const a = rng() * Math.PI * 2;
        const r = 1.6 + rng() * 1.5;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        b.box(0.025, 0.9, 0.025, x, 0.45, z, { color: 0x6a5640, rz: (rng() - 0.5) * 0.3 });
        b.box(0.4, 0.025, 0.025, x, 0.7, z, { color: 0x6a5640, ry: rng() * 3 });
      }
      return true;
    }
    case 'grave': {
      // Frisch aufgeworfener Erdhügel, Holzkreuz mit Hut, Schaufel, Laterne, ein Schuh
      b.box(0.95, 0.35, 2.0, 0, 0.12, 0, { color: R.soilDark, rx: 0.03, collide: true });
      b.box(0.8, 0.12, 1.8, 0, 0.32, 0, { color: R.soil, rx: 0.03 });
      b.box(0.08, 1.2, 0.07, 0, 0.6, -1.15, { color: R.plankDark, rz: 0.06, collide: true });
      b.box(0.55, 0.07, 0.07, 0, 0.92, -1.15, { color: R.plankDark, rz: 0.06 });
      b.mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12), 0.03, 1.22, -1.15, 0x2a2622, 'out', 0.15, 0, 0.1);
      b.mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.13, 12), 0.03, 1.29, -1.15, 0x2a2622, 'out', 0.15, 0, 0.1);
      b.box(0.04, 1.0, 0.04, 0.7, 0.45, 0.6, { color: R.plankDark, rz: -0.35, rx: 0.1 });
      b.box(0.22, 0.28, 0.02, 0.88, 0.02, 0.62, { color: 0x6a6e70, rz: -0.35 });
      b.box(0.14, 0.2, 0.14, 0.5, 0.1, 0.9, { color: 0x2a2a2a });
      b.box(0.1, 0.12, 0.1, 0.5, 0.26, 0.9, { color: 0xffd8a0, bucket: 'out' });
      b.box(0.12, 0.09, 0.26, -0.7, 0.05, 0.4, { color: 0x3a2a1e, ry: 0.7 });
      for (let i = 0; i < 4; i++) b.box(0.02, 0.3, 0.02, -0.15 + i * 0.1, 0.42, 0.75, { color: [0x5a2a3a, 0x6a6a3a][i % 2], rz: (rng() - 0.5) * 0.9 });
      return true;
    }
    case 'carcass': {
      // Hirsch auf der Seite: heller Pelz, Hals und Kopf mit Geweih, steife Beine, offener Bauch mit Rippen
      const fur = 0x8a6a48;
      const furDark = 0x6a4e34;
      b.mesh(new THREE.SphereGeometry(0.5, 14, 10).scale(1.35, 0.6, 0.75), 0, 0.32, 0, fur, 'out');
      b.box(1.3, 0.55, 0.7, 0, 0.3, 0, { color: fur, invisible: true, collide: true });
      b.mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.55, 8), 0.82, 0.45, -0.05, fur, 'out', 0, 0, -1.05);
      b.mesh(new THREE.SphereGeometry(0.16, 10, 8).scale(1.5, 0.9, 0.9), 1.18, 0.62, -0.05, furDark, 'out', 0, 0, -0.2);
      b.box(0.18, 0.14, 0.16, 1.45, 0.56, -0.05, { color: 0x3a2a1e });
      // Geweih
      for (const s2 of [-1, 1]) {
        b.box(0.04, 0.6, 0.04, 1.12, 0.98, -0.05 + s2 * 0.12, { color: 0xd8d0bc, rx: s2 * 0.5, rz: 0.3 });
        b.box(0.03, 0.3, 0.03, 1.22, 1.08, -0.05 + s2 * 0.3, { color: 0xd8d0bc, rx: s2 * 0.2, rz: -0.4 });
        b.box(0.03, 0.25, 0.03, 1.02, 1.22, -0.05 + s2 * 0.26, { color: 0xd8d0bc, rx: s2 * 0.3, rz: 0.6 });
      }
      // Beine, steif vom Körper weg
      for (const [x, z, r] of [[-0.45, 0.42, 0.3], [-0.3, 0.5, -0.2], [0.4, 0.45, 0.25], [0.55, 0.38, -0.3]]) {
        b.box(0.08, 0.08, 0.9, x, 0.2, z + 0.35, { color: furDark, ry: r });
        b.box(0.1, 0.1, 0.1, x + Math.sin(r) * 0.45, 0.2, z + 0.8, { color: 0x1a1410 });
      }
      // Offener Bauch: rotes Fleisch, gebogene Rippen, Blut
      b.box(0.95, 0.06, 0.5, -0.05, 0.6, 0.12, { color: 0x7a1414 });
      for (let i = 0; i < 7; i++) b.mesh(new THREE.TorusGeometry(0.24, 0.022, 4, 10, Math.PI), -0.45 + i * 0.14, 0.6, 0.12, 0xe8dcc4, 'out', 0, Math.PI / 2, 0);
      b.box(2.4, 0.01, 1.8, 0.1, 0.012, 0.5, { color: 0x3a0606 });
      return true;
    }
    case 'fairyring': {
      // Ein Kreis bleicher Pilze; in der Mitte sitzt eine Puppe mit dem Rücken zur Welt.
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 + (rng() - 0.5) * 0.1;
        const r = 2.1 + (rng() - 0.5) * 0.2;
        const h = 0.08 + rng() * 0.12;
        b.mesh(new THREE.CylinderGeometry(0.02, 0.03, h, 6), Math.cos(a) * r, h / 2, Math.sin(a) * r, 0xe8e0d0, 'out');
        b.mesh(new THREE.SphereGeometry(0.07 + rng() * 0.05, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), Math.cos(a) * r, h, Math.sin(a) * r, i % 5 === 0 ? 0x9a2a22 : 0xd8ccb8, 'out');
      }
      b.mesh(new THREE.CylinderGeometry(0.08, 0.18, 0.3, 8), 0, 0.15, 0, 0x4a5a7a, 'out');
      b.mesh(new THREE.SphereGeometry(0.1, 12, 10), 0, 0.4, 0, 0xe8ddd0, 'out');
      b.mesh(new THREE.SphereGeometry(0.105, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, 0.41, -0.01, 0x2a1a12, 'out', -0.35);
      for (const s of [-1, 1]) {
        b.mesh(new THREE.CylinderGeometry(0.025, 0.022, 0.22, 6), s * 0.1, 0.18, 0.02, 0xe8ddd0, 'out', 0, 0, s * 0.2);
        b.mesh(new THREE.CylinderGeometry(0.028, 0.025, 0.24, 6), s * 0.05, 0.04, 0.12, 0xe8ddd0, 'out', Math.PI / 2);
      }
      return true;
    }
    case 'nest': {
      // Ein Nest aus Ästen, viel zu groß für jeden Vogel, mit Knochen, Stofffetzen und bleichen Eiern
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * Math.PI * 2 * 2 + rng() * 0.3;
        const r = 1.35 + rng() * 0.4;
        const y = 0.15 + (i % 4) * 0.17;
        b.box(0.07, 0.07, 1.3 + rng() * 0.6, Math.cos(a) * r, y, Math.sin(a) * r, { color: [R.bark, 0x5e4a36, 0x3e3024][i % 3], ry: -a + (rng() - 0.5) * 0.9, rx: (rng() - 0.5) * 0.4, bucket: 'out' });
      }
      b.box(3.4, 0.7, 3.4, 0, 0.35, 0, { color: R.bark, invisible: true, collide: true });
      b.box(2.4, 0.05, 2.4, 0, 0.2, 0, { color: 0x3a2e22 });
      for (let i = 0; i < 3; i++) b.mesh(new THREE.SphereGeometry(0.22, 12, 10), -0.3 + i * 0.32, 0.45, (rng() - 0.5) * 0.4, 0xe8e4d8, 'out');
      for (let i = 0; i < 6; i++) b.box(0.04, 0.04, 0.4, (rng() - 0.5) * 1.6, 0.27, (rng() - 0.5) * 1.6, { color: 0xd0c8b2, ry: rng() * 3 });
      b.mesh(new THREE.SphereGeometry(0.13, 8, 6), 0.6, 0.32, 0.5, 0xd8d0bc, 'out');
      for (let i = 0; i < 4; i++) b.box(0.4, 0.01, 0.3, (rng() - 0.5) * 1.4, 0.24 + i * 0.01, (rng() - 0.5) * 1.4, { color: [0x3a4a6a, 0x7a2a2a, 0xc8c2b0, 0x4a5a3a][i], ry: rng() * 3 });
      return true;
    }
    default:
      return false;
  }
}
