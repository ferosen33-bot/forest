import * as THREE from 'three';
import { deriveSeed, mulberry32, randRange, type RandomFn } from '../utils/random';
import type { HeightMap } from './HeightMap';
import type { BiomeWeights } from './Biomes';
import type { RoadNetwork } from './Roads';
import type { TownLayout, TownProp } from './Town';
import type { ItemId } from '../entities/items/ItemDefs';

/**
 * Fundorte im Wald – kleine Orte mit einer Geschichte, verteilt über die Insel, damit zwischen Dörfern
 * und besonderen Orten nicht nur Bäume stehen (reine Daten, getestet):
 * - **Hochsitz** mit Treppe und Munitionskiste oben, Blick über eine Lichtung.
 * - **Verlassenes Zeltlager**: Zelt, kalte Feuerstelle, Wäscheleine, Rucksack, manchmal ein Tagebuch.
 * - **Unfallwagen** abseits des Weges, mit der Nase im Graben.
 * - **Wegkreuz** mit Kerzen (die nachts noch brennen – wer zündet sie an?).
 * - **Schrat-Zeichen**: Totems aus Ästen und Geweih, Knochen, ein Steinkreis.
 * - **Steinruine**: Mauerreste eines alten Gehöfts mit Kamin.
 * - **Holzfällerplatz**: Stümpfe, Stammholz, eine Werkzeugkiste.
 * - **Warnschild**: handgemalt, an den Waldrändern der Wege.
 * - **Verschwunden**: ein Rucksack, eine Taschenlampe, die noch leuchtet, und sonst nichts.
 * - **Strichmännchen**: ein toter Baum, an dem Figuren aus Zweigen hängen.
 * - **Frisches Grab**: Erdhügel, Kreuz mit Hut, Schaufel, eine Laterne, die noch brennt.
 * - **Kadaver**: ein aufgerissener Hirsch, Fliegen, Krähen.
 * - **Pilzring**: ein Kreis bleicher Pilze, in der Mitte sitzt eine Puppe.
 * - **Nest**: viel zu groß für einen Vogel, mit Knochen, Stofffetzen und bleichen Eiern.
 *
 * Waffenfundstellen (Meilenstein 60), dichter verteilt und gern nahe den Wegen – man soll nicht ewig
 * nach einer Waffe suchen müssen:
 * - **Hackklotz**: ein Klotz mit Spänen und Brennholz, darin steckt eine Axt, Machete oder ein Beil.
 * - **Überreste**: Jemand hat es nicht geschafft. Neben den Knochen liegt seine Waffe, dazu ein Rucksack.
 * - **Jagdversteck**: ein Unterstand aus Ästen und Plane, auf der Kiste liegt ein Gewehr, Bogen oder Speer.
 */

export type LandmarkKind =
  | 'stand'
  | 'camp'
  | 'wreck'
  | 'shrine'
  | 'totems'
  | 'ruin'
  | 'woodcut'
  | 'warning'
  | 'lost'
  // Meilenstein 57: Unheimliches im Wald
  | 'effigies'
  | 'grave'
  | 'carcass'
  | 'fairyring'
  | 'nest'
  // Meilenstein 60: Waffenfundstellen
  | 'chopblock'
  | 'remains'
  | 'blind';

/** Was an einer Waffenfundstelle liegt (die Waffe selbst legt `WeaponSpots` als echtes Item hin). */
export interface WeaponCache {
  weapon: ItemId;
  ammo?: [ItemId, number];
}

export interface Landmark {
  kind: LandmarkKind;
  x: number;
  z: number;
  y: number;
  yaw: number;
  /** Freifläche (keine Bäume). */
  radius: number;
  /** Nur Waffenfundstellen. */
  cache?: WeaponCache;
}

type Avoid = { x: number; z: number; radius: number };

/** Notizen, die an Fundorten liegen (in dieser Reihenfolge vergeben). */
export const LANDMARK_NOTES = { camp: ['wald1', 'wald2'], lost: ['wald3'], stand: ['wald4'], ruin: ['wald5'] } as const;

const WARNINGS = ['UMKEHREN', 'NICHT NACHTS', 'SIE RUFEN MIT UNSEREN STIMMEN', 'NICHT ANTWORTEN', 'HIER NICHT SCHLAFEN', 'LICHT AN LASSEN', 'GEHT WEG'];

const RADIUS: Record<LandmarkKind, number> = {
  stand: 8,
  camp: 7,
  wreck: 5,
  shrine: 3.5,
  totems: 7,
  ruin: 8,
  woodcut: 8,
  warning: 1.5,
  lost: 3,
  effigies: 6,
  grave: 3,
  carcass: 4,
  fairyring: 4,
  nest: 4,
  chopblock: 3,
  remains: 3,
  blind: 4.5,
};

/** Waffen je Fundstelle: [Waffe, Gewicht, Munition, min, max]. */
const CACHE_TABLES: Record<'chopblock' | 'remains' | 'blind', [ItemId, number, ItemId?, number?, number?][]> = {
  chopblock: [
    ['axe', 3],
    ['fireAxe', 2],
    ['machete', 2],
    ['cleaver', 1],
    ['sledgehammer', 1],
  ],
  remains: [
    ['baseballBat', 2],
    ['crowbar', 2],
    ['machete', 1.5],
    ['pipeWrench', 1.5],
    ['kitchenKnife', 1],
    ['golfClub', 1],
    ['baton', 1],
    ['nailBat', 0.8],
    ['pistol', 1.4, 'pistolAmmo', 6, 12],
    ['revolver', 0.6, 'pistolAmmo', 4, 8],
    ['shotgun', 0.5, 'shells', 3, 6],
    ['katana', 0.25],
  ],
  blind: [
    ['bow', 2, 'arrow', 6, 12],
    ['huntingRifle', 1.2, 'rifleAmmo', 4, 8],
    ['spear', 1.5],
    ['shotgun', 0.8, 'shells', 3, 6],
    ['pitchfork', 0.8],
  ],
};

function rollCache(kind: 'chopblock' | 'remains' | 'blind', rng: RandomFn): WeaponCache {
  const table = CACHE_TABLES[kind];
  const total = table.reduce((s, e) => s + e[1], 0);
  let r = rng() * total;
  const [weapon, , ammo, min = 1, max = 1] = table.find((e) => (r -= e[1]) < 0) ?? table[0];
  return ammo ? { weapon, ammo: [ammo, min + Math.floor(rng() * (max - min + 1))] } : { weapon };
}

/**
 * Waffenfundstellen: eine gleich beim Erwachen, der Rest auf einem dichteren Raster als die übrigen
 * Fundorte (eigener Zufallsstrom, damit die alten Fundorte unverändert bleiben).
 */
export function placeWeaponSpots(
  hm: HeightMap,
  seed: number,
  roads: RoadNetwork,
  avoid: Avoid[],
  spawn: { x: number; z: number },
  existing: Landmark[],
): Landmark[] {
  if (!hm.biomes.enabled) return [];
  const rng = mulberry32(deriveSeed(seed, 'weaponspots'));
  const b: BiomeWeights = { highland: 0, swamp: 0, cliffs: 0 };
  const n: [number, number, number] = [0, 1, 0];
  avoid = [...avoid, ...hm.islets.map((i) => ({ x: i.x, z: i.z, radius: i.radius + 30 }))];
  const out: Landmark[] = [];
  const ok = (x: number, z: number, r: number) => {
    if (!hm.isInside(x, z) || Math.abs(x) > hm.half * 0.92 || Math.abs(z) > hm.half * 0.92) return false;
    const h = hm.heightAt(x, z);
    if (h < hm.waterLevel + 2 || h > 60) return false;
    if (hm.normalAt(x, z, n)[1] < 0.93) return false;
    if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.radius + r)) return false;
    if (existing.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + r + 25)) return false;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + r + 55)) return false;
    // Nicht auf dem Weg, aber gern daneben.
    return roads.distance(x, z, 8) >= 6;
  };
  const push = (kind: 'chopblock' | 'remains' | 'blind', x: number, z: number) =>
    out.push({ kind, x, z, y: hm.heightAt(x, z), yaw: rng() * Math.PI * 2, radius: RADIUS[kind], cache: rollCache(kind, rng) });

  // Gleich in der Nähe des Erwachens: ein Hackklotz mit einer Axt oder Machete.
  for (let i = 0; i < 60; i++) {
    const a = rng() * Math.PI * 2;
    const r = randRange(rng, 24, 45);
    const x = spawn.x + Math.cos(a) * r;
    const z = spawn.z + Math.sin(a) * r;
    if (!ok(x, z, RADIUS.chopblock)) continue;
    out.push({ kind: 'chopblock', x, z, y: hm.heightAt(x, z), yaw: rng() * Math.PI * 2, radius: RADIUS.chopblock, cache: { weapon: rng() < 0.5 ? 'machete' : 'fireAxe' } });
    break;
  }

  const step = 115;
  for (let z = -hm.half * 0.88; z < hm.half * 0.88; z += step) {
    for (let x = -hm.half * 0.88; x < hm.half * 0.88; x += step) {
      if (rng() > 0.85) continue;
      const jx = x + rng() * step;
      const jz = z + rng() * step;
      hm.biomes.weights(jx, jz, b);
      const roll = rng() * 3.5;
      const kind = roll < 1.1 * (1 - b.highland * 0.5) ? 'chopblock' : roll < 2.5 ? 'remains' : 'blind';
      if (!ok(jx, jz, RADIUS[kind])) continue;
      push(kind, jx, jz);
    }
  }
  return out;
}

/**
 * Sucht Plätze für die Fundorte. Läuft nach Orten und Wegen, aber vor Vegetation (für die Lichtungen).
 * @param avoid Orte, Stadt, Hafen …
 */
export function placeLandmarks(hm: HeightMap, seed: number, roads: RoadNetwork, avoid: Avoid[], spawn: { x: number; z: number }): Landmark[] {
  if (!hm.biomes.enabled) return [];
  const rng = mulberry32(deriveSeed(seed, 'landmarks'));
  const b: BiomeWeights = { highland: 0, swamp: 0, cliffs: 0 };
  const n: [number, number, number] = [0, 1, 0];
  avoid = [...avoid, ...hm.islets.map((i) => ({ x: i.x, z: i.z, radius: i.radius + 30 }))];
  const out: Landmark[] = [];
  const counts = new Map<LandmarkKind, number>();
  const ok = (x: number, z: number, r: number, roadMin: number, roadMax: number) => {
    if (!hm.isInside(x, z) || Math.abs(x) > hm.half * 0.92 || Math.abs(z) > hm.half * 0.92) return false;
    const h = hm.heightAt(x, z);
    if (h < hm.waterLevel + 2 || h > 60) return false;
    if (hm.normalAt(x, z, n)[1] < 0.93) return false;
    if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.radius + r)) return false;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + r + 60)) return false;
    // Abfrage nur so weit wie nötig (die Suche wächst mit dem Radius).
    const d = roads.distance(x, z, (Number.isFinite(roadMax) ? roadMax : roadMin) + 1);
    return d >= roadMin && d <= roadMax;
  };
  const push = (kind: LandmarkKind, x: number, z: number, yaw: number) => {
    out.push({ kind, x, z, y: hm.heightAt(x, z), yaw, radius: RADIUS[kind] });
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  };

  // Ein Lager gleich in der Nähe des Erwachens: der erste Fund.
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2;
    const r = randRange(rng, 55, 90);
    const x = spawn.x + Math.cos(a) * r;
    const z = spawn.z + Math.sin(a) * r;
    if (ok(x, z, RADIUS.camp, 0, Infinity)) {
      push('camp', x, z, rng() * Math.PI * 2);
      break;
    }
  }

  // Warnschilder, Wegkreuze und Unfallwagen an den Wegen, abseits der Orte.
  const caps: Partial<Record<LandmarkKind, number>> = { wreck: 6, warning: 9, shrine: 6 };
  for (const r of roads.roads) {
    for (let k = 25; k < r.points.length - 25; k += 45) {
      if (rng() > 0.7) continue;
      const a = r.points[Math.max(0, k - 2)];
      const c = r.points[Math.min(r.points.length - 1, k + 2)];
      const yaw = Math.atan2(c.x - a.x, c.z - a.z);
      const side = rng() < 0.5 ? -1 : 1;
      const roll = rng();
      const kind: LandmarkKind = roll < 0.3 ? 'wreck' : roll < 0.55 ? 'shrine' : 'warning';
      if ((counts.get(kind) ?? 0) >= (caps[kind] ?? 5)) continue;
      const off = kind === 'wreck' ? r.width / 2 + randRange(rng, 7, 11) : r.width / 2 + (kind === 'shrine' ? 2.8 : 2.2);
      const x = r.points[k].x + Math.cos(yaw) * off * side;
      const z = r.points[k].z - Math.sin(yaw) * off * side;
      if (!ok(x, z, RADIUS[kind], off - 1.5, off + 2)) continue;
      // Schild und Wegkreuz schauen zum Weg, das Auto ist vom Weg abgekommen (schräg weg).
      push(kind, x, z, kind === 'wreck' ? yaw + side * randRange(rng, 0.4, 0.9) + (rng() < 0.5 ? Math.PI : 0) : yaw - side * Math.PI / 2);
    }
  }

  // Der Rest im Wald: grobes, verwackeltes Raster, Art nach Gebiet.
  const step = 140;
  for (let z = -hm.half * 0.85; z < hm.half * 0.85; z += step) {
    for (let x = -hm.half * 0.85; x < hm.half * 0.85; x += step) {
      const jx = x + rng() * step;
      const jz = z + rng() * step;
      hm.biomes.weights(jx, jz, b);
      const w: [LandmarkKind, number][] = [
        ['stand', 3 * (1 - b.highland)],
        ['camp', 2],
        ['totems', 1.4 + b.swamp * 2],
        ['ruin', 1.2 * (1 - b.swamp)],
        ['woodcut', 1.6 * (1 - b.highland) * (1 - b.swamp)],
        ['lost', 1],
        ['effigies', 1.2 + b.swamp],
        ['grave', 1],
        ['carcass', 1 * (1 - b.highland * 0.5)],
        ['fairyring', 0.8 * (1 - b.highland)],
        ['nest', 0.7 + b.swamp * 0.6],
      ];
      const max: Partial<Record<LandmarkKind, number>> = { stand: 8, camp: 6, shrine: 5, totems: 6, ruin: 4, woodcut: 5, lost: 4, effigies: 6, grave: 5, carcass: 5, fairyring: 4, nest: 3 };
      const total = w.reduce((s, e) => s + e[1], 0);
      let roll = rng() * total;
      const kind = w.find((e) => (roll -= e[1]) < 0)?.[0] ?? 'camp';
      if ((counts.get(kind) ?? 0) >= (max[kind] ?? 4)) continue;
      // Ein Stück im Wald, nicht direkt am Weg.
      if (!ok(jx, jz, RADIUS[kind], 18, Infinity)) continue;
      push(kind, jx, jz, rng() * Math.PI * 2);
    }
  }
  // Jede Art mit Notiz kommt mindestens einmal vor (sonst fehlte eine Seite der Geschichte).
  for (const kind of Object.keys(LANDMARK_NOTES) as LandmarkKind[]) {
    for (let i = 0; i < 600 && !counts.get(kind); i++) {
      const x = (rng() - 0.5) * hm.size * 0.8;
      const z = (rng() - 0.5) * hm.size * 0.8;
      if (ok(x, z, RADIUS[kind], 18, Infinity)) push(kind, x, z, rng() * Math.PI * 2);
    }
  }
  return out;
}

/** Was an einem Fundort steht – als Requisiten eines „Ortes“ ohne Häuser (gleicher Baukasten wie die Dörfer). */
export function landmarkLayout(list: Landmark[], hm: HeightMap, seed: number): TownLayout {
  const rng = mulberry32(deriveSeed(seed, 'landmark-props'));
  const props: TownProp[] = [];
  const notes: Record<string, string[]> = Object.fromEntries(Object.entries(LANDMARK_NOTES).map(([k, v]) => [k, [...v]]));
  for (const l of list) {
    const c = Math.cos(l.yaw);
    const s = Math.sin(l.yaw);
    /** Lokal (x quer, z vorwärts) → Welt, Bodenhöhe dort. */
    const put = (kind: TownProp['kind'], lx: number, lz: number, rot: number, extra: Partial<TownProp> = {}) => {
      const x = l.x + c * lx + s * lz;
      const z = l.z - s * lx + c * lz;
      props.push({ kind, x, z, rotation: l.yaw + rot, y: hm.heightAt(x, z), color: 0x5d6062, loot: false, ...extra });
    };
    const note = (lx: number, lz: number) => {
      const id = notes[l.kind]?.shift();
      if (id) put('note', lx, lz, rng() * 3, { text: [id] });
    };
    landmarkProps(l, put, note, rng);
  }
  return {
    name: 'Wildnis',
    kind: 'road',
    center: new THREE.Vector3(0, 0, 0),
    rotation: 0,
    radius: 0,
    streets: [],
    buildings: [],
    props,
    plaza: { x: 0, z: 0, radius: 0 },
  };
}

type Put = (kind: TownProp['kind'], lx: number, lz: number, rot: number, extra?: Partial<TownProp>) => void;

function landmarkProps(l: Landmark, put: Put, note: (lx: number, lz: number) => void, rng: RandomFn): void {
  switch (l.kind) {
    case 'stand':
      put('hunterstand', 0, 0, 0, { loot: true });
      put('stump', randRange(rng, 3, 5), randRange(rng, 2, 4), 0);
      if (rng() < 0.5) put('woodpile', -3, -1.5, Math.PI / 2);
      note(0.4, 0.2);
      break;
    case 'camp':
      put('tent', 0, 0, 0, { color: [0x3f6a4a, 0x9a5a2a, 0x2f4f7a, 0x8a3a34][Math.floor(rng() * 4)], tilt: rng() < 0.5 ? 1 : 0 });
      put('firepit', 2.6, 2.2, 0);
      put('backpack', 1.4, 1.0, rng() * 6, { loot: true });
      if (rng() < 0.6) put('clothesline', -2.8, 1.5, 0.3);
      if (rng() < 0.5) put('tent', -1.5, -3.2, 0.6, { color: 0x5a5a3a, tilt: 1 });
      note(2.0, 1.4);
      break;
    case 'wreck':
      put('car', 0, 0, 0, { loot: true, tilt: 0.18, color: [0x6b2a24, 0x2d4a5e, 0x8a7a54, 0x9a9890][Math.floor(rng() * 4)] });
      put('bones', randRange(rng, -3, 3), randRange(rng, -4, -2), 0);
      break;
    case 'shrine':
      put('shrine', 0, 0, 0);
      break;
    case 'totems':
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + rng();
        put('totem', Math.cos(a) * 3.2, Math.sin(a) * 3.2, rng() * 6);
      }
      put('firepit', 0, 0, 0);
      put('bones', 0.8, -1.4, 0);
      put('bones', -1.6, 0.6, 1);
      break;
    case 'ruin':
      put('stonewall', 0, 0, 0, { length: randRange(rng, 6, 8), depth: randRange(rng, 5, 6.5) });
      put('chimney', -2.4, -1.8, 0);
      put('crate', 1.5, 0.8, rng() * 3, { loot: true });
      note(0.9, 1.6);
      break;
    case 'woodcut':
      put('logpile', 0, 0, 0);
      for (let i = 0; i < 4; i++) put('stump', randRange(rng, -6, 6), randRange(rng, 2, 6), 0, { tilt: i === 0 ? 1 : 0 });
      put('toolchest', 2.8, -1.8, 0.4, { loot: true });
      break;
    case 'warning':
      put('warnsign', 0, 0, 0, { text: [WARNINGS[Math.floor(rng() * WARNINGS.length)]], tilt: randRange(rng, -0.15, 0.15) });
      break;
    case 'effigies':
      put('stickmen', 0, 0, 0);
      if (rng() < 0.6) put('stickmen', randRange(rng, 3, 4.5) * (rng() < 0.5 ? -1 : 1), randRange(rng, -3, 3), rng() * 6);
      put('bones', 1.2, 1.8, rng() * 3);
      break;
    case 'grave':
      put('grave', 0, 0, 0);
      break;
    case 'carcass':
      put('carcass', 0, 0, 0);
      put('bones', randRange(rng, 1.5, 2.5), randRange(rng, -1, 1), rng() * 3);
      break;
    case 'fairyring':
      put('fairyring', 0, 0, 0);
      break;
    case 'nest':
      put('nest', 0, 0, 0);
      put('bones', -2.2, 0.8, rng() * 3);
      break;
    case 'chopblock':
      put('chopblock', 0, 0, 0);
      break;
    case 'remains':
      put('remains', 0, 0, 0);
      put('backpack', -0.9, 0.7, rng() * 6, { loot: true });
      if (rng() < 0.5) put('droplight', 0.8, -0.6, rng() * 6);
      break;
    case 'blind':
      put('blind', 0, 0, 0);
      put('crate', 0, 0.2, 0, { loot: true });
      break;
    case 'lost':
      put('backpack', 0, 0, rng() * 6, { loot: true });
      put('droplight', 0.9, 0.5, rng() * 6);
      note(-0.6, 0.4);
      break;
  }
}
