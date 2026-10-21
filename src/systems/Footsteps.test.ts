import { describe, expect, it } from 'vitest';
import { HeightMap } from '../world/HeightMap';
import { surfaceAt } from './Footsteps';

describe('surfaceAt', () => {
  const hm = new HeightMap({ size: 512, cellSize: 2, seed: 7, waterLevel: 0 });
  const find = (pred: (h: number, slope: number) => boolean) => {
    for (let z = -240; z < 240; z += 3)
      for (let x = -240; x < 240; x += 3) {
        const h = hm.heightAt(x, z);
        if (pred(h, 1 - hm.normalAt(x, z)[1])) return { x, z };
      }
    throw new Error('keine passende Stelle');
  };

  it('erkennt Wasser, Holz, Strand, Fels und Gras', () => {
    const beach = find((h, s) => h > 0.5 && h < 1.5 && s < 0.1);
    const meadow = find((h, s) => h > 6 && h < 20 && s < 0.05);
    const cliff = find((h, s) => h > 5 && s > 0.4);
    expect(surfaceAt(hm, meadow.x, meadow.z, 0.3, false)).toBe('water');
    expect(surfaceAt(hm, meadow.x, meadow.z, 0, true)).toBe('wood');
    expect(surfaceAt(hm, beach.x, beach.z, 0, false)).toBe('sand');
    expect(surfaceAt(hm, cliff.x, cliff.z, 0, false)).toBe('rock');
    expect(surfaceAt(hm, meadow.x, meadow.z, 0, false)).toBe('grass');
  });
});
