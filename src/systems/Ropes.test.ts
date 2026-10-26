import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ropePath } from './Ropes';
import type { HeightMap } from '../world/HeightMap';

// Eine 10 m hohe Wand bei x = 2, davor flacher Grund.
const cliff = { waterLevel: 0, heightAt: (x: number) => (x < 2 ? 10 : x < 3 ? 10 - (x - 2) * 9 : 1) } as unknown as HeightMap;

describe('Kletterseil', () => {
  it('hängt über eine Steilkante bis zum Grund', () => {
    const path = ropePath(cliff, new THREE.Vector3(1, 10, 0), Math.PI / 2)!;
    expect(path).not.toBeNull();
    expect(path.drop).toBeCloseTo(9, 0);
    expect(path.bottom.y).toBeCloseTo(1, 1);
    expect(path.bottom.x).toBeGreaterThan(3);
    // Das Seil schneidet nie ins Gelände.
    for (const p of path.points) expect(p.y).toBeGreaterThanOrEqual(cliff.heightAt(p.x, p.z));
  });

  it('braucht eine Kante in Blickrichtung', () => {
    expect(ropePath(cliff, new THREE.Vector3(1, 10, 0), -Math.PI / 2)).toBeNull();
    const flat = { waterLevel: 0, heightAt: () => 5 } as unknown as HeightMap;
    expect(ropePath(flat, new THREE.Vector3(0, 5, 0), 0)).toBeNull();
    // Unten nur Wasser: kein Seil.
    const sea = { waterLevel: 0, heightAt: (x: number) => (x < 2 ? 10 : -5) } as unknown as HeightMap;
    expect(ropePath(sea, new THREE.Vector3(1, 10, 0), Math.PI / 2)).toBeNull();
  });
});
