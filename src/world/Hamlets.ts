import * as THREE from 'three';
import { deriveSeed, mulberry32, randRange, type RandomFn } from '../utils/random';
import type { HeightMap } from './HeightMap';
import type { BiomeWeights } from './Biomes';
import type { BuildingKind, PropKind, SettlementKind, TownBuilding, TownLayout, TownProp, TownStreet } from './Town';

/**
 * Kleine Orte abseits von Altwasser – reine Pläne ohne Grafik (getestet), im selben Format wie die
 * Stadt (`TownLayout`), damit Bau, Beute, Türen und Verbarrikadieren gleich funktionieren:
 * - **Gehöfte**: Bauernhaus, Scheune, Schuppen, ein Acker mit Vogelscheuche, Traktor und Heuballen.
 * - **Moorwinkel**: ein Weiler an der Landstraße mit Gasthof, Bushaltestelle und Telefonzelle.
 * - **Campingplatz Seeblick**: Hütten im Halbkreis, Wohnwagen, Zelte, Feuerstellen, Rezeption.
 * - **Sägewerk Tannenfeld**: offene Halle mit Säge, Bürohütte, Stammpolter und ein Holzlaster.
 */

type HamletKind = Exclude<SettlementKind, 'town' | 'road'>;

interface HamletSpec {
  kind: HamletKind;
  name: string;
  /** Ausdehnung (eingeebnet wird etwas weniger, dann weich ins Gelände). */
  radius: number;
}

const SPECS: HamletSpec[] = [
  { kind: 'hamlet', name: 'Moorwinkel', radius: 48 },
  { kind: 'farm', name: 'Hof Hollmann', radius: 36 },
  { kind: 'camp', name: 'Campingplatz Seeblick', radius: 40 },
  { kind: 'sawmill', name: 'Sägewerk Tannenfeld', radius: 36 },
  { kind: 'farm', name: 'Hof Brinkmann', radius: 36 },
];

/** Eingeebneter Anteil des Radius und Übergang ins Gelände (m). */
export const HAMLET_FLAT = 0.95;
export const HAMLET_BLEND = 18;

const FACADES = [0xb7a68a, 0x93a08f, 0xa5836d, 0xc4b69a, 0x8e8577, 0xa99a7c, 0xd0c4a8];
const PAINT = [0x6b2a24, 0x2d4a5e, 0x5d6062, 0x8a7a54, 0x2f4a33, 0x9a9890, 0x7a6a3a];
const BARN_RED = 0x7a3328;
const TIMBER = 0x6a5440;

type Avoid = { x: number; z: number; radius: number };

/** Höhenspanne in einem Kreis (Ebenheit). */
function spread(hm: HeightMap, x: number, z: number, r: number): { min: number; max: number; mid: number } {
  const hs: number[] = [];
  for (const rr of [0, r * 0.4, r * 0.75, r]) {
    const n = rr === 0 ? 1 : 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      hs.push(hm.heightAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr));
    }
  }
  hs.sort((a, b) => a - b);
  return {
    min: hs[0],
    max: hs[hs.length - 1],
    mid: hs[Math.floor(hs.length / 2)],
  };
}

/** Rund um den Ort (in zwei Ringen) überwiegend trockenes, nicht zu steiles Land? */
function openLand(hm: HeightMap, x: number, z: number, r: number): boolean {
  const n: [number, number, number] = [0, 1, 0];
  let ok = 0;
  let total = 0;
  for (const rr of [r + 50, r + 110]) {
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const px = x + Math.cos(a) * rr;
      const pz = z + Math.sin(a) * rr;
      total++;
      if (hm.heightAt(px, pz) < hm.waterLevel + 1) continue;
      if (hm.normalAt(px, pz, n)[1] < 0.86) continue;
      ok++;
    }
  }
  return ok / total > 0.6;
}

/** Abstand zur nächsten Wasserfläche (grob, bis `max`). */
function waterDistance(hm: HeightMap, x: number, z: number, max: number): number {
  for (let r = 10; r <= max; r += 10) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      if (hm.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) < hm.waterLevel) return r;
    }
  }
  return Infinity;
}

/**
 * Sucht Bauplätze für die kleinen Orte, ebnet sie ein und erzeugt ihre Pläne.
 * Muss vor dem Aufbau von Gelände und Physik laufen.
 */
export function placeHamlets(hm: HeightMap, seed: number, avoid: Avoid[]): TownLayout[] {
  if (!hm.biomes.enabled) return [];
  const rng = mulberry32(deriveSeed(seed, 'hamlets'));
  const b: BiomeWeights = { highland: 0, swamp: 0, cliffs: 0 };
  avoid = [...avoid, ...hm.islets.map((i) => ({ x: i.x, z: i.z, radius: i.radius + 60 }))];
  const out: TownLayout[] = [];
  for (const spec of SPECS) {
    let best: { x: number; z: number; y: number; s: number } | null = null;
    const step = 22;
    // Zweiter Durchgang mit lockereren Regeln, falls die Insel keinen idealen Platz hat.
    for (let pass = 0; pass < 2 && !best; pass++) {
      const gap = pass === 0 ? 190 : 120;
      const maxSpread = pass === 0 ? 9 : 13;
      for (let z = -hm.half * 0.8; z < hm.half * 0.8; z += step) {
        for (let x = -hm.half * 0.8; x < hm.half * 0.8; x += step) {
          const jx = x + rng() * step * 0.6;
          const jz = z + rng() * step * 0.6;
          if (avoid.some((a) => Math.hypot(a.x - jx, a.z - jz) < a.radius + spec.radius + 40)) continue;
          // Untereinander Abstand halten, damit sich die Orte über die Insel verteilen.
          if (out.some((o) => Math.hypot(o.center.x - jx, o.center.z - jz) < o.radius + spec.radius + gap)) continue;
          hm.biomes.weights(jx, jz, b);
          if (b.highland > 0.35 || b.swamp > 0.25 || b.cliffs > 0.3) continue;
          const h = hm.heightAt(jx, jz);
          if (h < hm.waterLevel + 3 || h > 40) continue;
          const sp = spread(hm, jx, jz, spec.radius);
          if (sp.min < hm.waterLevel + 1.5 || sp.max - sp.min > maxSpread) continue;
          // Das Umland muss begehbar sein (sonst führt kein Weg hin): keine Landzunge, kein Kessel.
          if (!openLand(hm, jx, jz, spec.radius)) continue;
          let s = sp.max - sp.min + rng() * 1.5;
          // Der Campingplatz liegt gern am Wasser („Seeblick“), der Rest lieber im Landesinneren.
          if (spec.kind === 'camp') s += Math.min(120, waterDistance(hm, jx, jz, 120)) * 0.08;
          if (!best || s < best.s) best = { x: jx, z: jz, y: sp.mid, s };
        }
      }
    }
    if (!best) continue;
    hm.flatten(best.x, best.z, spec.radius * HAMLET_FLAT, HAMLET_BLEND, best.y);
    const center = new THREE.Vector3(best.x, best.y, best.z);
    const local = mulberry32(deriveSeed(seed, `hamlet-${spec.name}`));
    // Ausrichtung: die Zufahrt (lokal +Z) zeigt grob zur Inselmitte.
    const rotation = Math.atan2(-best.x, -best.z) + randRange(local, -0.5, 0.5);
    out.push(generateHamlet(spec, center, rotation, local));
  }
  return out;
}

/** Plan eines kleinen Ortes (lokal: Ursprung = Mitte, Zufahrt bei +Z). */
export function generateHamlet(spec: HamletSpec, center: THREE.Vector3, rotation: number, rng: RandomFn): TownLayout {
  const buildings: TownBuilding[] = [];
  const props: TownProp[] = [];
  const streets: TownStreet[] = [];
  const add = (kind: BuildingKind, x: number, z: number, rot: number, w: number, d: number, color?: number, note?: string) =>
    buildings.push({
      index: buildings.length,
      kind,
      x,
      z,
      rotation: rot,
      w,
      d,
      color: color ?? FACADES[Math.floor(rng() * FACADES.length)],
      note,
    });
  const prop = (kind: PropKind, x: number, z: number, rot: number, extra: Partial<TownProp> = {}) =>
    props.push({
      kind,
      x,
      z,
      rotation: rot,
      color: PAINT[Math.floor(rng() * PAINT.length)],
      loot: false,
      ...extra,
    });
  const R = spec.radius;

  switch (spec.kind) {
    case 'farm': {
      // Hofplatz in der Mitte; Haus hinten, Scheune rechts, Schuppen links, Acker links vorn.
      streets.push({ ax: 0, az: -4, bx: 0, bz: R, width: 4, dirt: true });
      add('house', 0, -14, 0, randRange(rng, 8.6, 9.4), 7.4, undefined, spec.name === 'Hof Hollmann' ? 'hollmann' : 'brinkmann');
      add('barn', 15, -1, -Math.PI / 2, 13, 10, BARN_RED);
      add('shed', -12, -9, Math.PI / 2, 4.4, 3.6, TIMBER);
      prop('tractor', 7, 7, randRange(rng, -0.6, 0.6) + Math.PI, {
        color: rng() < 0.5 ? 0x3d6a35 : 0xa8322a,
      });
      prop('car', -5, -5, randRange(rng, -0.3, 0.3) + Math.PI / 2, {
        loot: true,
      });
      prop('well', -4.5, 3, 0);
      prop('woodpile', 6, -13.5, 0);
      for (let i = 0; i < 6; i++) prop('hay', 21 + (i % 2) * 1.9, -8 + Math.floor(i / 2) * 1.9, rng() * 3);
      prop('hay', 9.5, 12, 0);
      // Acker mit Zaun und Vogelscheuche
      const fx = -16;
      const fz = 12.5;
      const fl = 17;
      const fd = 13;
      prop('field', fx, fz, 0, { length: fl, depth: fd });
      prop('scarecrow', fx + randRange(rng, -3, 3), fz + randRange(rng, -3, 3), rng() * 6);
      for (const [x, z, rot, len] of [
        [fx, fz - fd / 2 - 0.8, 0, fl + 1.6],
        [fx, fz + fd / 2 + 0.8, 0, fl + 1.6],
        [fx - fl / 2 - 0.8, fz, Math.PI / 2, fd + 1.6],
      ] as [number, number, number, number][]) {
        prop('fence', x, z, rot, {
          length: len,
          tilt: rng() < 0.4 ? randRange(rng, -0.25, 0.25) : 0,
        });
      }
      // Gartenzaun ums Haus (vorn mit Lücke)
      prop('fence', -7, -9.2, 0, { length: 5 });
      prop('fence', 7, -9.2, 0, { length: 5 });
      prop('mailbox', 2.5, R - 4, 0);
      break;
    }
    case 'hamlet': {
      // Dorfstraße entlang Z, eine Querstraße als Feldweg; Gasthof an der Kreuzung.
      streets.push({ ax: 0, az: -R + 4, bx: 0, bz: R, width: 6 });
      streets.push({
        ax: -R + 8,
        az: -6,
        bx: 0,
        bz: -6,
        width: 3.6,
        dirt: true,
      });
      add('pub', -11.5, 7, Math.PI / 2, 11, 9, 0xc2b08c, 'gasthof');
      const spots: [number, number, number][] = [
        [11, -30, -Math.PI / 2],
        [11, -16, -Math.PI / 2],
        [11, 2, -Math.PI / 2],
        [11, 17, -Math.PI / 2],
        [-11, -30, Math.PI / 2],
        [-11, 24, Math.PI / 2],
        [-24, -16, 0],
      ];
      const notes = ['moorwinkel1', 'moorwinkel2'];
      spots.forEach(([x, z, rot], i) => {
        if (i > 2 && rng() < 0.15) return;
        const ruin = i === 3 && rng() < 0.6;
        add(ruin ? 'ruin' : 'house', x, z, rot, randRange(rng, 7.8, 9), 7, ruin ? 0x4a4540 : undefined, ruin ? undefined : notes.shift());
      });
      add('shed', 20, -16, -Math.PI / 2, 4, 3.4, TIMBER);
      prop('busstop', 5.2, 30, -Math.PI / 2);
      prop('phonebox', -5, 15, Math.PI / 2);
      for (let z = -36; z <= 36; z += 18) prop('lamp', z % 36 === 0 ? -4.4 : 4.4, z, z % 36 === 0 ? Math.PI / 2 : -Math.PI / 2);
      for (let i = 0; i < 3; i++) {
        const z = randRange(rng, -34, 34);
        if (Math.abs(z + 6) < 5) continue;
        prop('car', rng() < 0.5 ? randRange(rng, -1.8, 1.8) : 4.2, z, (rng() < 0.5 ? 0 : Math.PI) + randRange(rng, -0.4, 0.4), { loot: rng() < 0.7 });
      }
      for (const bd of buildings) {
        if (bd.kind !== 'house') continue;
        const fx = Math.sin(bd.rotation);
        const fz = Math.cos(bd.rotation);
        if (rng() < 0.6) prop('bin', bd.x + fx * (bd.d / 2 + 1.4), bd.z + fz * (bd.d / 2 + 1.4) + 2.5, bd.rotation);
        if (rng() < 0.6) prop('mailbox', bd.x + fx * (bd.d / 2 + 2.6), bd.z + fz * (bd.d / 2 + 2.6) - 1.5, bd.rotation);
      }
      prop('bench', -5, -1, Math.PI / 2);
      prop('woodpile', -18, 13, Math.PI / 2);
      break;
    }
    case 'camp': {
      // Ringweg; Rezeption an der Einfahrt, Hütten im Halbkreis hinten, Wohnwagen und Zelte vorn.
      streets.push({ ax: 0, az: R, bx: 0, bz: 22, width: 3.6, dirt: true });
      add('kiosk', 6.5, 25, -Math.PI / 2, 5, 4, 0x8a6e4e, 'rezeption');
      const cabins = 5;
      const cabinNotes = ['camping1', 'camping2'];
      for (let i = 0; i < cabins; i++) {
        const a = Math.PI + (i - (cabins - 1) / 2) * 0.55;
        const r = 21;
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        add('cabin', x, z, a + Math.PI, 4.6, 4, [0x7a5c3e, 0x6b5039, 0x86684a][i % 3], i === 1 || i === 3 ? cabinNotes.shift() : undefined);
      }
      for (const [x, z, rot] of [
        [-16, 6, 0.4],
        [16, 4, -0.5],
        [-9, 14, 1.2],
      ] as [number, number, number][]) {
        prop('caravan', x, z, rot + randRange(rng, -0.2, 0.2), {
          loot: true,
          color: [0xd8d2c4, 0xc9c2a8, 0xb9c4c8][Math.floor(rng() * 3)],
        });
      }
      for (const [x, z] of [
        [5, 9],
        [12, 14],
        [-3, 3],
        [19, -8],
      ] as [number, number][]) {
        prop('tent', x, z, rng() * 6, {
          color: [0x3f6a4a, 0x9a5a2a, 0x2f4f7a, 0x8a3a34][Math.floor(rng() * 4)],
          tilt: rng() < 0.4 ? 1 : 0,
        });
      }
      for (const [x, z] of [
        [0, -6],
        [-8, -4],
        [9, -2],
      ] as [number, number][]) {
        prop('picnic', x, z, rng() * 3);
        prop('firepit', x + 2.4, z + 1.8, 0);
      }
      prop('car', -4, 27, Math.PI / 2 + randRange(rng, -0.2, 0.2), {
        loot: true,
      });
      prop('bin', 3, 21, 0);
      prop('woodpile', -10, 22, 0.3);
      break;
    }
    case 'sawmill': {
      streets.push({ ax: 0, az: R, bx: 0, bz: -2, width: 4.4, dirt: true });
      add('sawmill', -2, -12, 0, 16, 10, TIMBER, 'saegewerk');
      add('cabin', 15, 7, -Math.PI / 2, 5, 4.2, 0x6b5039);
      add('shed', -17, 6, Math.PI / 2, 4.4, 3.6, TIMBER);
      for (const [x, z, rot] of [
        [-12, 14, 0.1],
        [-6, 22, -0.2],
        [10, -3, Math.PI / 2],
        [14, 20, 0.3],
      ] as [number, number, number][]) {
        prop('logpile', x, z, rot);
      }
      prop('truck', 4.5, 10, Math.PI + randRange(rng, -0.3, 0.3), {
        loot: true,
        color: 0x6a6f2e,
      });
      prop('woodpile', 9, -15, 0);
      prop('bin', 12, 12, 0);
      break;
    }
  }
  // Ortsschild an der Zufahrt (gelb, wie an deutschen Landstraßen).
  prop('townsign', 3.4, R - 1, 0, { text: [spec.name] });
  return {
    name: spec.name,
    kind: spec.kind,
    center,
    rotation,
    radius: R,
    streets,
    buildings,
    props,
    plaza: { x: 0, z: 0, radius: 0 },
    entries: [{ x: 0, z: R + 2 }],
  };
}
