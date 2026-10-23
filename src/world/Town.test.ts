import { describe, expect, it } from 'vitest';
import { HeightMap } from './HeightMap';
import { findTownSite, generateTown, pavedAt, TOWN_FLAT_BLEND, TOWN_FLAT_RADIUS, townLocal, townWorld, urbanAt, type TownBuilding } from './Town';

const SEED = 1337;
const hm = new HeightMap({ size: 1536, cellSize: 2, seed: SEED, waterLevel: 0 });
const site = findTownSite(hm, SEED)!;
const town = generateTown(SEED, site);

/** Ecken einer Gebäude-Grundfläche im Ortssystem (Tankstelle samt Dach über den Zapfsäulen). */
function corners(b: TownBuilding): [number, number][] {
  const c = Math.cos(b.rotation);
  const s = Math.sin(b.rotation);
  const front = b.kind === 'gas' ? 9 : 0;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const lx = (u * b.w) / 2;
    const lz = v < 0 ? -b.d / 2 : b.d / 2 + front;
    return [b.x + c * lx + s * lz, b.z - s * lx + c * lz];
  });
}

/** Trennende Achse für zwei konvexe Vierecke. */
function overlap(a: [number, number][], b: [number, number][]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = poly[i];
      const [x2, z2] = poly[(i + 1) % 4];
      const nx = z2 - z1;
      const nz = x1 - x2;
      const pa = a.map(([x, z]) => x * nx + z * nz);
      const pb = b.map(([x, z]) => x * nx + z * nz);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
    }
  }
  return true;
}

describe('Town', () => {
  it('findet einen trockenen Bauplatz weit weg vom Spawn', () => {
    expect(site).not.toBeNull();
    expect(site.y).toBeGreaterThan(hm.waterLevel + 2);
    expect(Math.hypot(site.x, site.z - hm.half * 0.42)).toBeGreaterThan(300);
  });

  it('hat alle Gebäudetypen und keine Überschneidungen', () => {
    const kinds = new Set(town.buildings.map((b) => b.kind));
    for (const k of ['house', 'shop', 'gas', 'hall', 'ruin'] as const) expect(kinds.has(k)).toBe(true);
    expect(town.buildings.length).toBeGreaterThan(14);
    const polys = town.buildings.map(corners);
    for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) expect(overlap(polys[i], polys[j]), `${i}/${j}`).toBe(false);
    }
  });

  it('Gebäude stehen nicht auf der Straße, Straßen sind gepflastert', () => {
    for (const b of town.buildings) {
      // Gebäudemitte (bei der Tankstelle: der Verkaufsraum) liegt abseits der Fahrbahn.
      const w = townWorld(town, b.x, b.z);
      expect(pavedAt(town, w.x, w.z), `${b.kind} ${b.index}`).toBe(false);
    }
    const road = townWorld(town, 0, 30);
    expect(pavedAt(town, road.x, road.z)).toBe(true);
    expect(urbanAt(town, road.x, road.z)).toBe(1);
    expect(urbanAt(town, town.center.x + 500, town.center.z)).toBe(0);
  });

  it('Orts- und Weltkoordinaten passen zusammen', () => {
    const w = townWorld(town, 12, -7);
    const l = townLocal(town, w.x, w.z);
    expect(l.x).toBeCloseTo(12, 6);
    expect(l.z).toBeCloseTo(-7, 6);
  });

  it('ebnet den Bauplatz ein', () => {
    const flat = new HeightMap({ size: 1536, cellSize: 2, seed: SEED, waterLevel: 0 });
    flat.flatten(site.x, site.z, TOWN_FLAT_RADIUS, TOWN_FLAT_BLEND, site.y);
    for (const [dx, dz] of [[0, 0], [40, 10], [-30, -45], [55, 0]]) expect(flat.heightAt(site.x + dx, site.z + dz)).toBeCloseTo(site.y, 3);
  });
});
