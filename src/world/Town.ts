import * as THREE from 'three';
import { deriveSeed, mulberry32, randRange, type RandomFn } from '../utils/random';
import { smoothstep } from '../utils/math';
import type { HeightMap } from './HeightMap';

/**
 * Die verlassene Kleinstadt – reiner Stadtplan ohne Grafik und Physik (getestet).
 *
 * Lokales Koordinatensystem: Ursprung = Ortsmitte auf Bodenhöhe, die Hauptstraße läuft entlang Z,
 * zwei Querstraßen entlang X. Gebäude stehen an den Straßen, ihre Vorderseite (+Z lokal) zeigt
 * zur Straße. `rotation` dreht den ganzen Ort um Y in die Welt.
 */

export type BuildingKind = 'house' | 'shop' | 'gas' | 'hall' | 'ruin' | 'barn' | 'shed' | 'cabin' | 'pub' | 'sawmill' | 'kiosk';
export type PropKind =
  | 'car'
  | 'lamp'
  | 'bin'
  | 'bench'
  | 'mailbox'
  // Land und Siedlungen (seit Meilenstein 52)
  | 'tractor'
  | 'hay'
  | 'fence'
  | 'field'
  | 'well'
  | 'scarecrow'
  | 'woodpile'
  | 'caravan'
  | 'tent'
  | 'picnic'
  | 'firepit'
  | 'logpile'
  | 'truck'
  | 'busstop'
  | 'phonebox'
  // Fundorte im Wald
  | 'hunterstand'
  | 'shrine'
  | 'totem'
  | 'stonewall'
  | 'chimney'
  | 'clothesline'
  | 'stump'
  | 'warnsign'
  // Waffenfundstellen (Meilenstein 60)
  | 'chopblock'
  | 'remains'
  | 'blind'
  | 'backpack'
  | 'droplight'
  | 'bones'
  | 'crate'
  | 'toolchest'
  | 'note'
  // Unheimliches im Wald (Meilenstein 57)
  | 'stickmen'
  | 'grave'
  | 'carcass'
  | 'fairyring'
  | 'nest'
  // An den Wegen
  | 'pole'
  | 'post'
  | 'signpost'
  | 'townsign';

/** Art der Siedlung (Altwasser ist die Stadt, der Rest kleine Orte; `road` = Dinge an den Wegen). */
export type SettlementKind = 'town' | 'farm' | 'hamlet' | 'camp' | 'sawmill' | 'road';

export interface TownBuilding {
  /** Fortlaufende Nummer (stabil für Spielstände und Zufall). */
  index: number;
  kind: BuildingKind;
  /** Mitte der Grundfläche (lokal). */
  x: number;
  z: number;
  /** Drehung im Ortssystem: lokal +Z des Gebäudes zeigt zur Straße. */
  rotation: number;
  /** Breite (entlang der Straße) und Tiefe. */
  w: number;
  d: number;
  /** Fassadenfarbe. */
  color: number;
  /** Notiz, die in diesem Gebäude liegt. */
  note?: string;
}

export interface TownStreet {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  width: number;
  /** Feldweg statt Asphalt (nur Bodenfarbe, keine Fahrbahn). */
  dirt?: boolean;
}

export interface TownProp {
  kind: PropKind;
  x: number;
  z: number;
  rotation: number;
  /** Lack/Farbe (Autos). */
  color: number;
  /** Autos: Kofferraum durchsuchbar. */
  loot: boolean;
  /** Bodenhöhe relativ zur Ortsmitte (an Wegen, wo nicht eingeebnet ist). */
  y?: number;
  /** Länge (Zaun, Feld) bzw. Tiefe (Feld). */
  length?: number;
  depth?: number;
  /** Strommast: Spitze des nächsten Masts (lokal) für die Leitung. */
  link?: [number, number, number];
  /** Schilder: Aufschrift (Zeilen). */
  text?: string[];
  /** Umgestürzt bzw. schief (Masten, Schilder). */
  tilt?: number;
}

export interface TownLayout {
  name: string;
  /** Ohne Angabe: die Stadt. */
  kind?: SettlementKind;
  /** Ortsmitte in Weltkoordinaten (y = eingeebnete Bodenhöhe). */
  center: THREE.Vector3;
  rotation: number;
  /** Ausdehnung (m) – bis hierhin ist eingeebnet und kein Wald. */
  radius: number;
  streets: TownStreet[];
  buildings: TownBuilding[];
  props: TownProp[];
  /** Marktplatz (lokal): hier haben sich die Schrate eingerichtet. */
  plaza: { x: number; z: number; radius: number };
  /** Zufahrten (lokal), an denen das Wegenetz andockt. */
  entries?: { x: number; z: number }[];
}

export const TOWN_NAME = 'Altwasser';
/** Eingeebneter Radius und Übergang ins Gelände. */
export const TOWN_FLAT_RADIUS = 66;
export const TOWN_FLAT_BLEND = 28;

const MAIN_HALF = 55;
const CROSS_Z = [-20, 22];
const CROSS_HALF = 37;
const FACADES = [0xb7a68a, 0x93a08f, 0xa5836d, 0x9aa4aa, 0xc4b69a, 0x8e8577, 0xa99a7c, 0x7f8f98];
const CAR_COLORS = [0x6b2a24, 0x2d4a5e, 0x5d6062, 0x8a7a54, 0x2f4a33, 0x9a9890];

// ---------------------------------------------------------------------------
// Ortssuche
// ---------------------------------------------------------------------------

export interface TownSite {
  x: number;
  z: number;
  y: number;
  rotation: number;
}

/**
 * Sucht einen möglichst ebenen, trockenen Platz für die Stadt (geringe Höhenspanne im Umkreis),
 * weit weg vom bevorzugten Spawn an der Südküste und von `avoid`.
 */
export function findTownSite(hm: HeightMap, seed: number, avoid: { x: number; z: number; radius: number }[] = []): TownSite | null {
  const rng = mulberry32(deriveSeed(seed, 'town-site'));
  const spawnPref = { x: 0, z: hm.half * 0.42 };
  let best: TownSite | null = null;
  let bestScore = Infinity;
  const reach = hm.half * 0.55;
  for (let z = -reach; z <= reach; z += 24) {
    for (let x = -reach; x <= reach; x += 24) {
      if (Math.hypot(x - spawnPref.x, z - spawnPref.z) < 320) continue;
      if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.radius)) continue;
      const samples: number[] = [];
      for (const r of [0, 25, 50, 70]) {
        const n = r === 0 ? 1 : 10;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          samples.push(hm.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
        }
      }
      const min = Math.min(...samples);
      const max = Math.max(...samples);
      if (min < hm.waterLevel + 3 || max > 30) continue;
      // Spanne der Höhen, mit etwas Zufall für Abwechslung zwischen Seeds.
      const score = max - min + rng() * 0.5;
      if (score < bestScore) {
        bestScore = score;
        samples.sort((a, b) => a - b);
        best = { x, z, y: samples[Math.floor(samples.length / 2)], rotation: rng() * Math.PI * 2 };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Stadtplan
// ---------------------------------------------------------------------------

export function generateTown(seed: number, site: TownSite): TownLayout {
  const rng = mulberry32(deriveSeed(seed, 'town'));
  const streets: TownStreet[] = [
    { ax: 0, az: -MAIN_HALF, bx: 0, bz: MAIN_HALF, width: 7 },
    ...CROSS_Z.map((z) => ({ ax: -CROSS_HALF, az: z, bx: CROSS_HALF, bz: z, width: 6 })),
  ];
  const plaza = { x: 13, z: 0, radius: 9 };
  const buildings: TownBuilding[] = [];
  const add = (kind: BuildingKind, x: number, z: number, rotation: number, w: number, d: number) => {
    buildings.push({ index: buildings.length, kind, x, z, rotation, w, d, color: FACADES[Math.floor(rng() * FACADES.length)] });
  };

  // Hauptstraße: Häuser links und rechts, Laden in der Mitte, Platz gegenüber, Tankstelle am Nordende.
  const mainZ: number[] = [];
  for (let z = -48; z <= 48.01; z += 12.5) if (CROSS_Z.every((c) => Math.abs(z - c) > 6.5)) mainZ.push(z);
  for (const side of [-1, 1]) {
    const rotation = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    for (const z of mainZ) {
      const x = side * 11;
      // Marktplatz bzw. Laden brauchen den Platz in der Ortsmitte.
      if (Math.abs(z) < 12) continue;
      if (side > 0 && z === mainZ[mainZ.length - 1]) continue; // Tankstelle
      if (rng() < 0.12) continue; // leeres Grundstück
      add('house', x, z, rotation, randRange(rng, 8, 9.2), 7);
    }
  }
  add('shop', -12.5, 0, Math.PI / 2, 12, 10);
  add('gas', 16, mainZ[mainZ.length - 1] + 2, -Math.PI / 2, 8, 6);
  // Querstraßen: Häuser auf beiden Seiten, das Gemeindehaus mit Funkmast an der südlichen.
  for (const cz of CROSS_Z) {
    for (const side of [-1, 1]) {
      const rotation = side > 0 ? Math.PI : 0;
      for (const x of [-31, -21, 21, 31]) {
        const z = cz + side * 10;
        if (cz === CROSS_Z[0] && side < 0 && x === -21) {
          add('hall', -24, z - 1, rotation, 12, 9);
          continue;
        }
        if (cz === CROSS_Z[0] && side < 0 && x === -31) continue; // gehört zum Gemeindehaus
        if (rng() < 0.15) continue;
        add('house', x, z, rotation, randRange(rng, 7.6, 8.6), 7);
      }
    }
  }
  // Zwei abgebrannte Ruinen.
  const houses = buildings.filter((b) => b.kind === 'house');
  for (let i = 0; i < 2 && houses.length > 4; i++) {
    const b = houses.splice(Math.floor(rng() * houses.length), 1)[0];
    b.kind = 'ruin';
    b.color = 0x4a4540;
  }

  // Requisiten
  const props: TownProp[] = [];
  const prop = (kind: PropKind, x: number, z: number, rotation: number, loot = false) =>
    props.push({ kind, x, z, rotation, color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)], loot });
  for (let i = 0; i < 7; i++) {
    // Liegengebliebene Autos: am Straßenrand oder schräg mitten auf der Fahrbahn.
    const onMain = i < 5;
    const along = randRange(rng, -45, 45);
    const lane = rng() < 0.5 ? randRange(rng, -2.4, 2.4) : (rng() < 0.5 ? -1 : 1) * 4.6;
    const crossZ = CROSS_Z[i % 2];
    const [x, z] = onMain ? [lane, along] : [randRange(rng, -30, 30), crossZ + (rng() < 0.5 ? -1 : 1) * 1.6];
    if (CROSS_Z.some((c) => Math.abs(z - c) < 5) && onMain) continue;
    const heading = (onMain ? 0 : Math.PI / 2) + (rng() < 0.5 ? 0 : Math.PI) + randRange(rng, -0.35, 0.35);
    prop('car', x, z, heading, rng() < 0.7);
  }
  for (let z = -48; z <= 48; z += 16) {
    prop('lamp', -5.4, z, Math.PI / 2);
    prop('lamp', 5.4, z + 8, -Math.PI / 2);
  }
  for (const b of buildings) {
    if (b.kind !== 'house') continue;
    // Mülltonne und Briefkasten vor dem Haus (in Blickrichtung des Hauses = Straßenseite).
    const fx = Math.sin(b.rotation);
    const fz = Math.cos(b.rotation);
    const rx = Math.cos(b.rotation);
    const rz = -Math.sin(b.rotation);
    const front = b.d / 2 + 1.6;
    if (rng() < 0.6) prop('bin', b.x + fx * front + rx * (b.w / 2 - 0.6), b.z + fz * front + rz * (b.w / 2 - 0.6), b.rotation);
    if (rng() < 0.5) prop('mailbox', b.x + fx * (front + 1.2) - rx * 1.6, b.z + fz * (front + 1.2) - rz * 1.6, b.rotation);
  }
  prop('bench', plaza.x + 4, plaza.z - 6, Math.PI);
  prop('bench', plaza.x + 4, plaza.z + 6, 0);

  return {
    name: TOWN_NAME,
    center: new THREE.Vector3(site.x, site.y, site.z),
    rotation: site.rotation,
    radius: 62,
    streets,
    buildings,
    props,
    plaza,
    entries: [
      { x: 0, z: -MAIN_HALF - 2 },
      { x: 0, z: MAIN_HALF + 2 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Abfragen (Weltkoordinaten)
// ---------------------------------------------------------------------------

/** Welt → Ortssystem. */
export function townLocal(t: TownLayout, x: number, z: number): { x: number; z: number } {
  const dx = x - t.center.x;
  const dz = z - t.center.z;
  const c = Math.cos(t.rotation);
  const s = Math.sin(t.rotation);
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}

/** Ortssystem → Welt (wie `makeRotationY(rotation)` + Verschiebung). */
export function townWorld(t: TownLayout, x: number, z: number): { x: number; z: number } {
  const c = Math.cos(t.rotation);
  const s = Math.sin(t.rotation);
  return { x: c * x + s * z + t.center.x, z: -s * x + c * z + t.center.z };
}

function streetDistance(st: TownStreet, x: number, z: number): number {
  const abx = st.bx - st.ax;
  const abz = st.bz - st.az;
  const u = Math.max(0, Math.min(1, ((x - st.ax) * abx + (z - st.az) * abz) / (abx * abx + abz * abz)));
  return Math.hypot(x - st.ax - abx * u, z - st.az - abz * u);
}

/** Liegt (lokal) innerhalb der Grundfläche eines Gebäudes (plus Rand)? */
function inFootprint(b: TownBuilding, x: number, z: number, margin: number): boolean {
  const c = Math.cos(b.rotation);
  const s = Math.sin(b.rotation);
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  // Tankstelle: Dach über den Zapfsäulen reicht weit zur Straße.
  const front = b.kind === 'gas' ? 9 : b.kind === 'sawmill' ? 3 : 0;
  return Math.abs(lx) < b.w / 2 + margin && lz > -b.d / 2 - margin && lz < b.d / 2 + margin + front;
}

/** Straße oder Marktplatz (gepflastert). */
export function pavedAt(t: TownLayout, x: number, z: number): boolean {
  const p = townLocal(t, x, z);
  if (Math.hypot(p.x - t.plaza.x, p.z - t.plaza.z) < t.plaza.radius) return true;
  return t.streets.some((st) => !st.dirt && streetDistance(st, p.x, p.z) < st.width / 2);
}

/** Bebauung 0..1: 1 auf Straßen und unter Gebäuden, im Ort zertretener Boden, außerhalb 0. */
export function urbanAt(t: TownLayout, x: number, z: number): number {
  const r = Math.hypot(x - t.center.x, z - t.center.z);
  if (r > t.radius + 8) return 0;
  const p = townLocal(t, x, z);
  if (t.streets.some((st) => streetDistance(st, p.x, p.z) < st.width / 2 + 0.8)) return 1;
  if (t.plaza.radius > 0 && Math.hypot(p.x - t.plaza.x, p.z - t.plaza.z) < t.plaza.radius + 1) return 1;
  if (t.buildings.some((b) => inFootprint(b, p.x, p.z, 1.2))) return 1;
  // Äcker: umgegrabene Erde.
  for (const f of t.props) {
    if (f.kind !== 'field') continue;
    const c = Math.cos(f.rotation);
    const sn = Math.sin(f.rotation);
    const dx = p.x - f.x;
    const dz = p.z - f.z;
    if (Math.abs(c * dx - sn * dz) < (f.length ?? 10) / 2 && Math.abs(sn * dx + c * dz) < (f.depth ?? 10) / 2) return 0.9;
  }
  return 0.4 * (1 - smoothstep(t.radius - 12, t.radius + 6, r));
}

/** Zufall je Gebäude (für Ausstattung und Beute). */
export function buildingRng(seed: number, b: TownBuilding): RandomFn {
  return mulberry32(deriveSeed(seed, `town-building-${b.index}`));
}
