import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HeightMap } from './HeightMap';
import { SnowTracks } from './SnowTracks';

describe('SnowTracks', () => {
  const hm = new HeightMap({ size: 512, cellSize: 2, seed: 7, waterLevel: 0 });
  // Flache Stelle oberhalb des Strands suchen.
  let spot: THREE.Vector3 | null = null;
  const n: [number, number, number] = [0, 1, 0];
  for (let z = -200; z < 200 && !spot; z += 4) {
    for (let x = -200; x < 200 && !spot; x += 4) {
      const h = hm.heightAt(x, z);
      if (h > 4 && hm.normalAt(x, z, n)[1] > 0.95) spot = new THREE.Vector3(x, h, z);
    }
  }

  it('hinterlässt nur bei genug Schnee Abdrücke', () => {
    const t = new SnowTracks(hm);
    t.snow = 0.1;
    t.add('boot', spot!, 0, 0.1);
    expect(t.mesh.count).toBe(0);
    t.snow = 0.9;
    t.add('boot', spot!, 0, 0.1);
    t.add('paw', spot!, 1, -0.08);
    expect(t.mesh.count).toBe(2);
  });

  it('Neuschnee deckt Spuren schneller zu', () => {
    const calm = new SnowTracks(hm);
    const storm = new SnowTracks(hm);
    for (const t of [calm, storm]) {
      t.snow = 0.9;
      t.add('hoof', spot!, 0);
    }
    storm.snowfall = 1;
    for (let i = 0; i < 120; i++) {
      calm.update(1);
      storm.update(1);
    }
    const fade = (t: SnowTracks) => (t.mesh.geometry.getAttribute('aFade') as THREE.BufferAttribute).getX(0);
    expect(fade(calm)).toBeGreaterThan(0.3);
    expect(fade(storm)).toBe(0);
  });

  it('keine Spuren am Strand', () => {
    const t = new SnowTracks(hm);
    t.snow = 1;
    let beach: THREE.Vector3 | null = null;
    for (let x = -250; x < 250 && !beach; x += 2) {
      const h = hm.heightAt(x, 0);
      if (h > 0.2 && h < 1.5) beach = new THREE.Vector3(x, h, 0);
    }
    if (beach) {
      t.add('boot', beach, 0);
      expect(t.mesh.count).toBe(0);
    }
  });
});
