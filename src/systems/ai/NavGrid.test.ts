import { beforeAll, describe, expect, it } from 'vitest';
import { HeightMap } from '../../world/HeightMap';
import { NavGrid, type NavPoint } from './NavGrid';

describe('NavGrid', () => {
  let hm: HeightMap;
  let nav: NavGrid;
  let a: NavPoint;
  let b: NavPoint;

  beforeAll(() => {
    hm = new HeightMap({ size: 512, cellSize: 2, seed: 7, waterLevel: 0 });
    nav = new NavGrid(hm);
    // Zwei Punkte im Abstand von 30 m mit komplett begehbarer Verbindung suchen.
    for (let z = -150; z < 150 && !a; z += 4) {
      for (let x = -150; x < 150 && !a; x += 4) {
        const p = { x, z };
        const q = { x: x + 30, z };
        if (nav.lineWalkable(p, q) && nav.lineWalkable({ x, z: z - 12 }, { x: x + 30, z: z - 12 }) && nav.lineWalkable({ x, z: z + 12 }, { x: x + 30, z: z + 12 })) {
          a = p;
          b = q;
        }
      }
    }
  });

  const length = (from: NavPoint, path: NavPoint[]) => {
    let d = 0;
    let prev = from;
    for (const p of path) {
      d += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
    }
    return d;
  };

  it('findet auf freiem Gelände einen (fast) geraden Weg', () => {
    const path = nav.findPath(a, b)!;
    expect(path).not.toBeNull();
    expect(path.at(-1)).toEqual(b);
    expect(length(a, path)).toBeLessThan(32);
  });

  it('läuft um eine Wand herum, ohne sie zu schneiden', () => {
    const mid = { x: a.x + 15, z: a.z };
    nav.markBox(mid.x, mid.z, Math.PI / 2, 8, 0.4, 1); // 16 m lange Wand quer zum Weg
    const path = nav.findPath(a, b)!;
    expect(path).not.toBeNull();
    expect(length(a, path)).toBeGreaterThan(33);
    let prev = a;
    for (const p of path) {
      expect(nav.lineWalkable(prev, p)).toBe(true);
      prev = p;
    }
    nav.markBox(mid.x, mid.z, Math.PI / 2, 8, 0.4, -1);
    expect(length(a, nav.findPath(a, b)!)).toBeLessThan(32);
  });

  it('meldet eingeschlossene Ziele als unerreichbar', () => {
    for (const [dx, dz, rot] of [
      [0, 4, 0],
      [0, -4, 0],
      [4, 0, Math.PI / 2],
      [-4, 0, Math.PI / 2],
    ] as const) {
      nav.markBox(b.x + dx, b.z + dz, rot, 4.5, 0.4, 1);
    }
    expect(nav.findPath(a, b)).toBeNull();
  });

  it('ein Durchgang (offenes Tor) öffnet eingeschlossene Ziele wieder', () => {
    // Fortsetzung des vorigen Tests: b ist eingemauert. Durchgang in der Südwand (z = b.z + 4).
    nav.markPassage(b.x, b.z + 4, 0, 1.0, 0.4, 1);
    const path = nav.findPath(a, b);
    expect(path).not.toBeNull();
    nav.markPassage(b.x, b.z + 4, 0, 1.0, 0.4, -1);
    expect(nav.findPath(a, b)).toBeNull();
  });

  it('Wasser ist nicht begehbar', () => {
    expect(nav.isWalkable(250, 250)).toBe(false);
  });
});
