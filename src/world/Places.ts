import * as THREE from 'three';
import type { HeightMap } from './HeightMap';
import type { BiomeWeights } from './Biomes';
import { deriveSeed, mulberry32 } from '../utils/random';

/**
 * Besondere Orte der Insel – jeder in seinem Gebiet:
 * - **Absturzstelle** (Wald): das Wrack der Chartermaschine, verstreute Koffer, ein schwelendes Triebwerk.
 * - **Zeche** (Gebirge): Stollenmundloch am Hang (führt in den Feuersteinstollen), Zechenhaus, Gleise.
 * - **Hütte im Sumpf**: auf Pfählen über einem Tümpel, ein Bohlensteg führt hin.
 * - **Funkstation** (Klippen): Gittermast mit Warnlicht, Betonbaracke, Zaun – hoch über dem Meer.
 *
 * Hier werden nur die Bauplätze gesucht und eingeebnet (vor Gelände und Physik); Modelle, Beute und
 * Notizen baut `systems/Places`.
 */

export type PlaceKind = 'crash' | 'mine' | 'hut' | 'radio';

export interface PlaceSite {
  kind: PlaceKind;
  name: string;
  /** Mittelpunkt bzw. Bodenpunkt (Zeche: vor dem Mundloch). */
  position: THREE.Vector3;
  /** Gierwinkel: lokales +Z zeigt … (Zeche: in den Hang, Hütte: vom Ufer zur Hütte, Funk: aufs Meer). */
  yaw: number;
  /** Radius des Ortes (Entdeckung, Karte, Freiflächen). */
  radius: number;
}

export const PLACE_NAMES: Record<PlaceKind, string> = {
  crash: 'Absturzstelle',
  mine: 'Zeche Altwasser',
  hut: 'Hütte im Moor',
  radio: 'Funkstation Klippenkopf',
};

type Avoid = { x: number; z: number; radius: number };

/** Höhenspanne in einem Kreis (Ebenheit). */
function spread(hm: HeightMap, x: number, z: number, r: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const rr of [0, r * 0.5, r]) {
    const n = rr === 0 ? 1 : 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const h = hm.heightAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  }
  return { min, max };
}

/**
 * Bauplätze suchen und – wo nötig – einebnen. Muss vor dem Aufbau von Gelände und Physik laufen.
 * @param avoid Spawn, Stadt, Hafen …
 */
export function placeSites(hm: HeightMap, seed: number, avoid: Avoid[]): PlaceSite[] {
  if (!hm.biomes.enabled) return [];
  const rng = mulberry32(deriveSeed(seed, 'places'));
  const b: BiomeWeights = { highland: 0, swamp: 0, cliffs: 0 };
  const n: [number, number, number] = [0, 1, 0];
  const sites: PlaceSite[] = [];
  const taken = (x: number, z: number, r: number) =>
    avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.radius + r) || sites.some((s) => Math.hypot(s.position.x - x, s.position.z - z) < s.radius + r + 120);
  const water = hm.waterLevel;

  /** Bester Kandidat aus einem Raster über die Insel. */
  const search = (step: number, score: (x: number, z: number) => { s: number; yaw: number; y?: number } | null) => {
    let best: { x: number; z: number; s: number; yaw: number; y?: number } | null = null;
    for (let z = -hm.half * 0.85; z < hm.half * 0.85; z += step) {
      for (let x = -hm.half * 0.85; x < hm.half * 0.85; x += step) {
        const jx = x + rng() * step * 0.5;
        const jz = z + rng() * step * 0.5;
        const r = score(jx, jz);
        if (r && (!best || r.s < best.s)) best = { x: jx, z: jz, ...r };
      }
    }
    return best;
  };

  // Absturzstelle: ebener Waldboden, möglichst mitten im Wald und ein Stück vom Spawn entfernt.
  const crash = search(20, (x, z) => {
    hm.biomes.weights(x, z, b);
    if (b.highland > 0.15 || b.swamp > 0.15 || b.cliffs > 0.2) return null;
    const h = hm.heightAt(x, z);
    if (h < 4 || h > 35 || taken(x, z, 30)) return null;
    const { min, max } = spread(hm, x, z, 22);
    if (min < 2.5 || max - min > 6) return null;
    return { s: max - min + rng() * 2, yaw: rng() * Math.PI * 2, y: h };
  });
  if (crash) {
    hm.flatten(crash.x, crash.z, 16, 14, crash.y!);
    sites.push({ kind: 'crash', name: PLACE_NAMES.crash, position: new THREE.Vector3(crash.x, crash.y!, crash.z), yaw: crash.yaw, radius: 34 });
  }

  // Zeche: Hang im Gebirgsvorland, der wirklich ansteigt (wie ein Höhleneingang), davor ein Hof.
  const mine = search(12, (x, z) => {
    hm.biomes.weights(x, z, b);
    if (b.highland < 0.3) return null;
    const h = hm.heightAt(x, z);
    if (h < 14 || h > 60 || taken(x, z, 30)) return null;
    hm.normalAt(x, z, n);
    if (n[1] < 0.72 || n[1] > 0.9) return null;
    const into = Math.atan2(-n[0], -n[2]);
    const ux = Math.sin(into);
    const uz = Math.cos(into);
    if (hm.heightAt(x + ux * 8, z + uz * 8) - h < 3.5) return null;
    // Hof vor dem Mundloch: halbwegs eben.
    const yard = spread(hm, x - ux * 12, z - uz * 12, 9);
    if (yard.max - yard.min > 5) return null;
    return { s: yard.max - yard.min + Math.abs(h - 35) * 0.05 + rng(), yaw: into, y: h };
  });
  if (mine) {
    const ux = Math.sin(mine.yaw);
    const uz = Math.cos(mine.yaw);
    // Nur den Hof einebnen – der Hang über dem Mundloch bleibt stehen.
    hm.flatten(mine.x - ux * 13, mine.z - uz * 13, 8, 6, mine.y! - 0.2);
    sites.push({ kind: 'mine', name: PLACE_NAMES.mine, position: new THREE.Vector3(mine.x, mine.y!, mine.z), yaw: mine.yaw, radius: 30 });
  }

  // Hütte im Moor: ein Tümpel mitten im Sumpf, festes Ufer in Steglänge.
  const hut = search(10, (x, z) => {
    hm.biomes.weights(x, z, b);
    if (b.swamp < 0.7) return null;
    const h = hm.heightAt(x, z);
    if (h > water - 0.15 || h < water - 0.65 || taken(x, z, 25)) return null;
    // Rings um die Hütte Wasser oder Matsch (kein Hügel unter dem Boden).
    const around = spread(hm, x, z, 3.5);
    if (around.max > water + 0.4) return null;
    for (let k = 0; k < 12; k++) {
      const yaw = (k / 12) * Math.PI * 2;
      // yaw zeigt vom Ufer zur Hütte: Ufer liegt in −yaw-Richtung.
      const sx = x - Math.sin(yaw) * 11;
      const sz = z - Math.cos(yaw) * 11;
      if (hm.heightAt(sx, sz) > water + 0.5) return { s: around.max - around.min + rng() * 0.3, yaw, y: water };
    }
    return null;
  });
  if (hut) sites.push({ kind: 'hut', name: PLACE_NAMES.hut, position: new THREE.Vector3(hut.x, hut.y!, hut.z), yaw: hut.yaw, radius: 22 });

  // Funkstation: Hochfläche über der Steilküste, das Meer direkt vor der Kante.
  const radio = search(12, (x, z) => {
    hm.biomes.weights(x, z, b);
    if (b.cliffs < 0.6) return null;
    const h = hm.heightAt(x, z);
    if (h < 16 || h > 50 || taken(x, z, 25)) return null;
    const { min, max } = spread(hm, x, z, 13);
    if (max - min > 4) return null;
    // Zum Meer schauen: in einer Richtung fällt das Gelände nach 30–45 m unter den Wasserspiegel.
    for (let k = 0; k < 16; k++) {
      const yaw = (k / 16) * Math.PI * 2;
      const dx = Math.sin(yaw);
      const dz = Math.cos(yaw);
      if (hm.heightAt(x + dx * 18, z + dz * 18) < h - 4) continue;
      if (hm.heightAt(x + dx * 42, z + dz * 42) > water) continue;
      return { s: max - min + rng(), yaw, y: h };
    }
    return null;
  });
  if (radio) {
    hm.flatten(radio.x, radio.z, 11, 6, radio.y!);
    sites.push({ kind: 'radio', name: PLACE_NAMES.radio, position: new THREE.Vector3(radio.x, radio.y!, radio.z), yaw: radio.yaw, radius: 26 });
  }
  return sites;
}

/** Bodenbeschaffenheit der Orte für das Gelände: zertretene Erde, Brandspuren, Schotter (0..1). */
export function placeGround(sites: PlaceSite[], x: number, z: number): number {
  let u = 0;
  for (const s of sites) {
    const d = Math.hypot(x - s.position.x, z - s.position.z);
    if (s.kind === 'crash') u = Math.max(u, 1 - THREE.MathUtils.smoothstep(d, 8, 22));
    else if (s.kind === 'radio') u = Math.max(u, 1 - THREE.MathUtils.smoothstep(d, 9, 14));
    else if (s.kind === 'mine') {
      const yx = s.position.x - Math.sin(s.yaw) * 12;
      const yz = s.position.z - Math.cos(s.yaw) * 12;
      u = Math.max(u, 1 - THREE.MathUtils.smoothstep(Math.hypot(x - yx, z - yz), 7, 12));
    }
  }
  return u;
}
