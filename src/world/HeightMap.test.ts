import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { HeightMap } from './HeightMap';
import { mulberry32 } from '../utils/random';

const OPTS = { size: 256, cellSize: 2, seed: 42, waterLevel: 0 };

describe('HeightMap', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('ist deterministisch für denselben Seed', () => {
    const a = new HeightMap(OPTS);
    const b = new HeightMap(OPTS);
    expect(a.heights).toEqual(b.heights);
    const c = new HeightMap({ ...OPTS, seed: 43 });
    expect(c.heights).not.toEqual(a.heights);
  });

  it('trifft an Rasterpunkten exakt die Samples', () => {
    const hm = new HeightMap(OPTS);
    for (const [ix, iz] of [[0, 0], [10, 3], [hm.cells, hm.cells], [57, 101]]) {
      const x = ix * hm.cellSize - hm.half;
      const z = iz * hm.cellSize - hm.half;
      expect(hm.heightAt(x, z)).toBeCloseTo(hm.getSample(ix, iz), 5);
    }
  });

  it('deckt sich mit dem Rapier-Heightfield (gleiches Layout und gleiche Dreiecksteilung)', () => {
    const hm = new HeightMap(OPTS);
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(
      RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, hm.toRapierHeights(), {
        x: hm.size,
        y: 1,
        z: hm.size,
      }),
    );
    world.step();

    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const x = (rng() - 0.5) * hm.size * 0.98;
      const z = (rng() - 0.5) * hm.size * 0.98;
      const from = 200;
      const hit = world.castRay(new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), 1000, true);
      expect(hit).not.toBeNull();
      expect(from - hit!.timeOfImpact).toBeCloseTo(hm.heightAt(x, z), 3);
    }
    world.free();
  });

  it('erzeugt eine Insel: Ränder unter, Zentrum über Wasser', () => {
    const hm = new HeightMap({ ...OPTS, size: 1024 });
    expect(hm.heightAt(-500, -500)).toBeLessThan(0);
    expect(hm.heightAt(500, 0)).toBeLessThan(0);
    expect(hm.maxHeight).toBeGreaterThan(10);
  });
});
