import { describe, expect, it } from 'vitest';
import { createNoise2D } from 'simplex-noise';
import { HeightMap } from './HeightMap';
import { grassDensity } from './Grass';
import { mulberry32 } from '../utils/random';

describe('grassDensity', () => {
  const hm = new HeightMap({ size: 512, cellSize: 2, seed: 7, waterLevel: 0 });
  const noise = createNoise2D(mulberry32(1));

  it('wächst auf Wiesen, nicht unter Wasser, am Strand oder an Steilhängen', () => {
    let meadow = 0;
    let forbidden = 0;
    for (let iz = 0; iz < hm.samples; iz += 3) {
      for (let ix = 0; ix < hm.samples; ix += 3) {
        const h = hm.getSample(ix, iz);
        const n: [number, number, number] = [0, 1, 0];
        hm.normalAtSample(ix, iz, n);
        const d = grassDensity(hm, ix, iz, noise);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
        if (h < 1.5 || 1 - n[1] > 0.35) forbidden = Math.max(forbidden, d);
        if (h > 4 && h < 30 && 1 - n[1] < 0.1) meadow = Math.max(meadow, d);
      }
    }
    expect(forbidden).toBe(0);
    expect(meadow).toBeGreaterThan(0.8);
  });
});
