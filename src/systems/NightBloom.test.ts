import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NightBloom } from './NightBloom';
import { HeightMap } from '../world/HeightMap';
import type { WorldItem } from '../entities/items/WorldItems';
import { mulberry32 } from '../utils/random';

function setup() {
  const scene = new THREE.Group();
  const spawned: WorldItem[] = [];
  const items = {
    spawn: (itemId: string, count: number, position: THREE.Vector3) => {
      const mesh = new THREE.Object3D();
      mesh.position.copy(position);
      scene.add(mesh);
      const it = { id: spawned.length, itemId, count, mesh } as unknown as WorldItem;
      spawned.push(it);
      return it;
    },
    remove: (it: WorldItem) => void scene.remove(it.mesh),
  };
  const hm = new HeightMap({ size: 512, cellSize: 2, seed: 3, waterLevel: -1000 });
  const bloom = new NightBloom(items, hm, mulberry32(5));
  const player = new THREE.Vector3(0, hm.heightAt(0, 0), 0);
  const run = (seconds: number, night: boolean, at = player) => {
    for (let i = 0; i < seconds * 10; i++) bloom.update({ dt: 0.1, night, player: at });
  };
  return { bloom, spawned, scene, run, player };
}

describe('Mondblüten', () => {
  it('blühen nur nachts, in einigem Abstand zum Spieler', () => {
    const { bloom, spawned, run, player } = setup();
    run(60, false);
    expect(bloom.count).toBe(0);
    run(60, true);
    expect(bloom.count).toBeGreaterThan(2);
    expect(bloom.count).toBeLessThanOrEqual(5);
    expect(spawned.every((s) => s.itemId === 'moonflower')).toBe(true);
    for (const s of spawned) expect(s.mesh.position.distanceTo(player)).toBeGreaterThan(45);
  });

  it('schließen sich bei Tagesanbruch und vergehen', () => {
    const { bloom, run, scene } = setup();
    run(60, true);
    expect(bloom.flowers).toBeGreaterThan(0);
    run(20, false);
    expect(bloom.count).toBe(0);
    expect(scene.children.length).toBe(0);
  });

  it('ein leergepflücktes Feld verblasst, ein neues wächst anderswo', () => {
    const { bloom, spawned, run, scene } = setup();
    run(3, true);
    expect(bloom.count).toBe(1);
    for (const s of spawned) scene.remove(s.mesh);
    run(12, true);
    expect(bloom.flowers).toBeGreaterThan(0);
    expect(bloom.count).toBeGreaterThanOrEqual(1);
  });

  it('weit Zurückgelassenes verschwindet', () => {
    const { bloom, run } = setup();
    run(30, true);
    const before = bloom.count;
    expect(before).toBeGreaterThan(0);
    run(0.1, false, new THREE.Vector3(2000, 0, 2000));
    expect(bloom.count).toBe(0);
  });
});
