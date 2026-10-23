import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCaveMesh, caveBounds, caveFloor, createCaveSdf, generateLayout } from '../../world/CaveGenerator';
import { CaveNav } from './CaveNav';

const SEED = 1337;

describe('CaveNav', () => {
  const layout = generateLayout(SEED, 1);
  const mesh = buildCaveMesh(createCaveSdf(SEED, 1, layout), caveBounds(layout));
  const floor = caveFloor(mesh);
  const origin = new THREE.Vector3(120, 600, -40);
  const rotation = 0.7;
  const nav = new CaveNav(floor, origin, rotation);
  const toWorld = new THREE.Matrix4().makeRotationY(rotation).setPosition(origin);
  const world = (x: number, z: number) => new THREE.Vector3(x, 0, z).applyMatrix4(toWorld);

  it('Bodenkarte: Boden am Eingang, kein Boden im Fels', () => {
    expect(floor.heightAt(0, 0.5)).toBeGreaterThan(-1.5);
    expect(floor.heightAt(0, 0.5)).toBeLessThan(0.5);
    expect(Number.isNaN(floor.heightAt(0, -8))).toBe(true);
  });

  it('übersetzt Welt- und Höhlenkoordinaten verlustfrei', () => {
    const w = world(3, 7);
    const l = nav.toLocal(w.x, w.z);
    expect(l.x).toBeCloseTo(3, 5);
    expect(l.z).toBeCloseTo(7, 5);
    const back = nav.toWorld(l);
    expect(back.x).toBeCloseTo(w.x, 5);
    expect(back.z).toBeCloseTo(w.z, 5);
  });

  it('findet Wege vom Eingang in jede Kammer', () => {
    const entry = world(0, 1);
    expect(nav.isWalkable(entry.x, entry.z)).toBe(true);
    for (const c of layout.chambers) {
      const goal = world(c.center.x, c.center.z);
      const target = nav.nearestWalkable(goal.x, goal.z, 4)!;
      expect(target).not.toBeNull();
      const path = nav.findPath({ x: entry.x, z: entry.z }, target, 20000);
      expect(path).not.toBeNull();
      const last = path![path!.length - 1];
      expect(Math.hypot(last.x - target.x, last.z - target.z)).toBeLessThan(1.5);
    }
  });
});
