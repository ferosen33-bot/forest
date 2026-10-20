/**
 * Deterministische Zufallszahlen. Die gesamte Welt wird aus einem Seed erzeugt,
 * damit dieselbe Insel bei jedem Laden identisch aussieht (wichtig für Savegames).
 */

export type RandomFn = () => number;

/** Mulberry32: schneller 32-bit-PRNG, liefert Werte in [0, 1). */
export function mulberry32(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Leitet aus einem Basis-Seed und einem Namen einen unabhängigen Sub-Seed ab. */
export function deriveSeed(seed: number, name: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}

export const randRange = (rng: RandomFn, min: number, max: number): number =>
  min + (max - min) * rng();
