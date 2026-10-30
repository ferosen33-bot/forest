import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HeightMap } from '../world/HeightMap';
import { planIsland } from '../world/IslandPlan';
import { CONFIG } from '../config';
import { WeaponSpots } from './WeaponSpots';
import { isWeapon } from '../entities/items/Weapons';
import type { WorldItem } from '../entities/items/WorldItems';

const w = CONFIG.world;
const hm = new HeightMap({ size: w.size, cellSize: w.cellSize, seed: CONFIG.seed, waterLevel: w.waterLevel });
const plan = planIsland(hm, CONFIG.seed);
const caches = plan.landmarks.filter((l) => l.cache);

function setup() {
  const scene = new THREE.Group();
  const items = {
    spawn: (itemId: string, count: number, position: THREE.Vector3, opts: { transient?: boolean; fixed?: boolean } = {}) => {
      const mesh = new THREE.Object3D();
      mesh.position.copy(position);
      scene.add(mesh);
      return { itemId, count, mesh, transient: opts.transient, fixed: opts.fixed } as unknown as WorldItem;
    },
    remove: (it: WorldItem) => void scene.remove(it.mesh),
  };
  const spots = new WeaponSpots(items, plan.landmarks, hm, CONFIG.seed);
  return { spots, scene };
}

describe('Waffenfundstellen (Meilenstein 60)', () => {
  it('gibt es reichlich, über die ganze Insel verteilt', () => {
    expect(caches.length).toBeGreaterThanOrEqual(35);
    for (const c of caches) expect(isWeapon(c.cache!.weapon) || c.cache!.weapon === 'bow' || c.cache!.weapon === 'spear').toBe(true);
    // In jedem Viertel der Insel liegen welche.
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      expect(caches.filter((c) => Math.sign(c.x) === sx && Math.sign(c.z) === sz).length).toBeGreaterThan(3);
    }
  });

  it('eine liegt gleich beim Erwachen', () => {
    const near = caches.filter((c) => Math.hypot(c.x - plan.spawn.x, c.z - plan.spawn.z) < 50);
    expect(near.length).toBeGreaterThanOrEqual(1);
    expect(near.some((c) => c.kind === 'chopblock')).toBe(true);
  });

  it('von fast überall ist die nächste Waffe nicht weit', () => {
    // Stichproben an Land: Die nächste Fundstelle liegt im Mittel unter 200 m entfernt.
    const dists: number[] = [];
    for (let z = -w.size * 0.4; z < w.size * 0.4; z += 97) {
      for (let x = -w.size * 0.4; x < w.size * 0.4; x += 97) {
        if (hm.heightAt(x, z) < w.waterLevel + 2) continue;
        dists.push(Math.min(...caches.map((c) => Math.hypot(c.x - x, c.z - z))));
      }
    }
    dists.sort((a, b) => a - b);
    const median = dists[Math.floor(dists.length / 2)];
    expect(median).toBeLessThan(200);
  });

  it('Waffen erscheinen in der Nähe, verschwinden in der Ferne und bleiben genommen', () => {
    const { spots, scene } = setup();
    const first = spots.spots[0];
    const at = new THREE.Vector3(first.landmark.x, first.landmark.y, first.landmark.z);
    spots.update(0.1, new THREE.Vector3(9999, 0, 9999), 1);
    expect(scene.children.length).toBe(0);
    spots.update(0.1, at, 1);
    const weapon = first.pieces[0].item!;
    expect(weapon).not.toBeNull();
    expect(weapon.transient).toBe(true);
    expect(weapon.itemId).toBe(first.landmark.cache!.weapon);
    // Weit weg: wieder fort (wird nicht gespeichert, kommt beim nächsten Besuch wieder).
    spots.update(0.1, new THREE.Vector3(9999, 0, 9999), 1);
    expect(first.pieces[0].item).toBeNull();
    expect(first.pieces[0].taken).toBe(false);
    // Aufheben: das Item verschwindet aus der Welt, ohne dass die Fundstelle es entfernt hat.
    spots.update(0.1, at, 1);
    const before = spots.remaining;
    scene.remove(first.pieces[0].item!.mesh);
    spots.update(0.1, at, 1);
    expect(first.pieces[0].taken).toBe(true);
    expect(spots.remaining).toBe(before - 1);
    // Gespeichert und geladen: bleibt genommen.
    const save = spots.serialize();
    const again = setup();
    again.spots.load(save);
    again.spots.update(0.1, at, 1);
    expect(again.spots.spots[0].pieces[0].item).toBeNull();
    expect(again.spots.remaining).toBe(before - 1);
  });
});
