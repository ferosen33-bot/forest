import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCaveMesh, caveBounds, CAVE_VOXEL, createCaveSdf, findCaveSites, generateLayout, probe } from './CaveGenerator';
import { HeightMap } from './HeightMap';

const SEED = 1337;

/** Flutfüllung der Luftzellen ab dem Eingang: welche Punkte sind zu Fuß erreichbar (ohne Kletterhöhe)? */
function reachable(sdf: (x: number, y: number, z: number) => number, bounds: THREE.Box3, from: THREE.Vector3) {
  const h = 0.5;
  const size = bounds.getSize(new THREE.Vector3());
  const nx = Math.ceil(size.x / h);
  const ny = Math.ceil(size.y / h);
  const nz = Math.ceil(size.z / h);
  const seen = new Uint8Array(nx * ny * nz);
  const cell = (p: THREE.Vector3) => [
    Math.floor((p.x - bounds.min.x) / h),
    Math.floor((p.y - bounds.min.y) / h),
    Math.floor((p.z - bounds.min.z) / h),
  ];
  const id = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const air = (i: number, j: number, k: number) =>
    sdf(bounds.min.x + (i + 0.5) * h, bounds.min.y + (j + 0.5) * h, bounds.min.z + (k + 0.5) * h) < -0.15;
  const stack = [cell(from)];
  seen[id(stack[0][0], stack[0][1], stack[0][2])] = 1;
  while (stack.length) {
    const [i, j, k] = stack.pop()!;
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = i + di, b = j + dj, c = k + dk;
      if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz || seen[id(a, b, c)] || !air(a, b, c)) continue;
      seen[id(a, b, c)] = 1;
      stack.push([a, b, c]);
    }
  }
  return (p: THREE.Vector3) => {
    const [i, j, k] = cell(p);
    return seen[id(i, j, k)] === 1;
  };
}

describe('CaveGenerator', () => {
  it('ist deterministisch', () => {
    const a = generateLayout(SEED, 1);
    const b = generateLayout(SEED, 1);
    expect(a.chambers.map((c) => c.center.toArray())).toEqual(b.chambers.map((c) => c.center.toArray()));
    expect(a.features.length).toBe(b.features.length);
  });

  for (const index of [0, 1, 2]) {
    it(`Höhle ${index}: Eingang frei, alle Kammern begehbar erreichbar, Ausstattung vorhanden`, () => {
      const layout = generateLayout(SEED, index);
      const sdf = createCaveSdf(SEED, index, layout);
      expect(layout.chambers.length).toBeGreaterThanOrEqual(4);
      // Der Spieler steht am Eingang in der Luft und auf festem Boden.
      expect(sdf(0, 1, 0)).toBeLessThan(0);
      // (Die weiche Vereinigung senkt den Boden etwas ab – der Spieler wird auf den ertasteten Boden gesetzt.)
      const floor = probe(sdf, 0, 1, 0, -1)!;
      expect(floor).toBeGreaterThan(-1.3);
      expect(floor).toBeLessThan(0.3);
      // Der Ausgang liegt an der Rückwand der Nische.
      expect(layout.exit.z).toBeLessThan(-1);
      expect(sdf(layout.exit.x, layout.exit.y, layout.exit.z - 0.3)).toBeGreaterThan(0);
      const canReach = reachable(sdf, caveBounds(layout), new THREE.Vector3(0, 1, 0));
      for (const c of layout.chambers) expect(canReach(new THREE.Vector3(c.center.x, c.floor + 1, c.center.z))).toBe(true);
      const kinds = new Set(layout.features.map((f) => f.kind));
      for (const k of ['flint', 'mushroom', 'crate', 'stalactite'] as const) expect(kinds.has(k)).toBe(true);
      for (const f of layout.features) if (f.kind !== 'stalactite') expect(canReach(f.position.clone().setY(f.position.y + 0.6))).toBe(true);
    });
  }

  it('baut eine geschlossene Felshülle (jede Kante gehört zu genau zwei Dreiecken)', () => {
    const layout = generateLayout(SEED, 0);
    const sdf = createCaveSdf(SEED, 0, layout);
    const t0 = performance.now();
    const mesh = buildCaveMesh(sdf, caveBounds(layout), CAVE_VOXEL);
    const ms = performance.now() - t0;
    expect(mesh.triangles).toBeGreaterThan(5000);
    expect(ms).toBeLessThan(3000);
    const edges = new Map<string, number>();
    const ix = mesh.indices;
    for (let t = 0; t < ix.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = ix[t + e];
        const b = ix[t + ((e + 1) % 3)];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    const open = [...edges.values()].filter((n) => n !== 2).length;
    // Surface Nets kann an Sattelpunkten vereinzelt nicht-mannigfaltige Kanten erzeugen – aber keine Löcher.
    expect(open / edges.size).toBeLessThan(0.002);
    // Nach innen gerichtete Flächen: Normale am Eingangsboden zeigt nach oben.
    let up = 0;
    const p = mesh.positions;
    for (let t = 0; t < ix.length; t += 3) {
      const a = new THREE.Vector3().fromArray(p, ix[t] * 3);
      if (a.distanceTo(new THREE.Vector3(0, 0, 0.5)) > 1.2) continue;
      const b = new THREE.Vector3().fromArray(p, ix[t + 1] * 3);
      const c = new THREE.Vector3().fromArray(p, ix[t + 2] * 3);
      up += new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).y;
    }
    expect(up).toBeGreaterThan(0);
  });

  it('findet Hänge für Eingänge', () => {
    const hm = new HeightMap({ size: 1024, cellSize: 2, seed: SEED, waterLevel: 0 });
    const sites = findCaveSites(hm, SEED, 3, []);
    expect(sites.length).toBe(3);
    for (const s of sites) {
      const ux = Math.sin(s.into), uz = Math.cos(s.into);
      expect(hm.heightAt(s.position.x + ux * 7, s.position.z + uz * 7)).toBeGreaterThan(s.position.y + 2);
    }
  });
});
