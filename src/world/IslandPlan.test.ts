import { describe, expect, it } from 'vitest';
import { HeightMap } from './HeightMap';
import { planIsland } from './IslandPlan';
import { townWorld, type TownBuilding } from './Town';
import { CONFIG } from '../config';

const w = CONFIG.world;
const hm = new HeightMap({ size: w.size, cellSize: w.cellSize, seed: CONFIG.seed, waterLevel: w.waterLevel });
const plan = planIsland(hm, CONFIG.seed);

/** Ecken einer Grundfläche (lokal im Ort). */
function corners(b: TownBuilding): [number, number][] {
  const c = Math.cos(b.rotation);
  const s = Math.sin(b.rotation);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const lx = (u * b.w) / 2;
    const lz = (v * b.d) / 2;
    return [b.x + c * lx + s * lz, b.z - s * lx + c * lz];
  });
}

/** Trennende Achse zweier Rechtecke (SAT). */
function overlap(a: TownBuilding, b: TownBuilding): boolean {
  const ca = corners(a);
  const cb = corners(b);
  for (const poly of [ca, cb]) {
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = poly[i];
      const [x1, z1] = poly[(i + 1) % 4];
      const nx = z1 - z0;
      const nz = x0 - x1;
      const pa = ca.map(([x, z]) => x * nx + z * nz);
      const pb = cb.map(([x, z]) => x * nx + z * nz);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  }
  return true;
}

describe('Inselplan: Dörfer und Wege', () => {
  it('legt Gehöfte, Weiler, Campingplatz und Sägewerk an, ohne Überschneidungen', () => {
    const kinds = plan.hamlets.map((h) => h.kind);
    expect(kinds).toEqual(expect.arrayContaining(['farm', 'hamlet', 'camp', 'sawmill']));
    for (const h of plan.hamlets) {
      for (const b of h.buildings) {
        for (const [x, z] of corners(b)) expect(Math.hypot(x, z)).toBeLessThan(h.radius);
      }
      for (let i = 0; i < h.buildings.length; i++)
        for (let j = i + 1; j < h.buildings.length; j++) expect(overlap(h.buildings[i], h.buildings[j]), `${h.name}: ${i}/${j}`).toBe(false);
      // Eingeebnet: das Gelände in der Mitte liegt auf Ortshöhe.
      expect(Math.abs(hm.heightAt(h.center.x, h.center.z) - h.center.y)).toBeLessThan(0.3);
    }
    // Orte halten Abstand zur Stadt und untereinander.
    const t = plan.town!;
    for (const h of plan.hamlets) expect(Math.hypot(h.center.x - t.center.x, h.center.z - t.center.z)).toBeGreaterThan(t.radius + h.radius);
  });

  it('jeder Ort hat eine Zufahrt, die Wege liegen auf trockenem Land', () => {
    for (const h of plan.hamlets) {
      const e = townWorld(h, h.entries![0].x, h.entries![0].z);
      expect(plan.roads.distance(e.x, e.z, 30), h.name).toBeLessThan(8);
    }
    for (const r of plan.roads.roads) {
      for (const p of r.points) expect(p.y).toBeGreaterThan(hm.waterLevel);
      // Fahrbahn quer eben ins Gelände gelegt.
      const k = Math.floor(r.points.length / 2);
      expect(Math.abs(hm.heightAt(r.points[k].x, r.points[k].z) - r.points[k].y)).toBeLessThan(0.2);
    }
    expect(plan.roads.roads.some((r) => r.asphalt)).toBe(true);
    expect(plan.roads.distance(plan.roads.roads[0].points[3].x, plan.roads.roads[0].points[3].z)).toBeLessThan(0.01);
  });

  it('stellt Strommasten, Wegweiser und Ortsschilder an die Wege', () => {
    const kinds = new Set(plan.roadside.props.map((p) => p.kind));
    for (const k of ['pole', 'signpost', 'townsign'] as const) expect(kinds.has(k), k).toBe(true);
    // Masten stehen neben, nicht auf der Fahrbahn.
    for (const p of plan.roadside.props.filter((q) => q.kind === 'pole')) expect(plan.roads.distance(p.x, p.z)).toBeGreaterThan(2);
  });
});
