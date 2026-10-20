import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Physics, CollisionGroup, interactionGroups, RAPIER } from '../../core/Physics';
import { EventBus } from '../../core/EventBus';
import { HeightMap } from '../../world/HeightMap';
import { Vegetation } from '../../world/Vegetation';
import { WorldItems } from '../../entities/items/WorldItems';
import { Inventory } from '../Inventory';
import { Crafting } from '../Crafting';
import { Particles } from '../Particles';
import { LightPool } from '../LightPool';
import { Audio } from '../Audio';
import { BuildingSystem } from './BuildingSystem';
import { getStructure, WALL_HALF_WIDTH } from './StructureDefs';

async function setup() {
  const physics = await Physics.create();
  const heightMap = new HeightMap({ size: 512, cellSize: 2, seed: 7, waterLevel: 0 });
  physics.addTerrain(heightMap);
  const vegetation = new Vegetation(heightMap, physics, { seed: 7, cellSize: 64, cullDistance: 300, clearings: [] });
  const inventory = new Inventory();
  const worldItems = new WorldItems(physics);
  const building = new BuildingSystem(
    physics,
    heightMap,
    new Crafting(inventory),
    worldItems,
    new Particles(),
    new Particles(50, true),
    new LightPool(new THREE.Scene(), 2),
    new Audio(),
    new EventBus(),
  );
  physics.step();

  // Flache, trockene Stelle ohne Bäume/Felsen im Umkreis von 6 m suchen.
  const n: [number, number, number] = [0, 1, 0];
  let flat: THREE.Vector3 | null = null;
  for (let z = -200; z < 200 && !flat; z += 3) {
    for (let x = -200; x < 200 && !flat; x += 3) {
      const h = heightMap.heightAt(x, z);
      if (h < 3 || heightMap.normalAt(x, z, n)[1] < 0.995) continue;
      const blocked = vegetation.instances.some(
        (v) => (v.kind === 'pine' || v.kind === 'broadleaf' || v.kind === 'rock') && Math.hypot(v.position.x - x, v.position.z - z) < 6,
      );
      if (!blocked) flat = new THREE.Vector3(x, h, z);
    }
  }
  return { physics, heightMap, vegetation, inventory, worldItems, building, flat: flat! };
}

describe('BuildingSystem', () => {
  let w: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    w = await setup();
  });

  it('findet eine freie Teststelle', () => {
    expect(w.flat).toBeTruthy();
  });

  it('erlaubt ein Lagerfeuer auf freiem, flachem Boden', () => {
    const p = w.building.evaluate(getStructure('campfire'), w.flat, 0);
    expect(p.reason).toBeUndefined();
    expect(p.valid).toBe(true);
  });

  it('verbietet Bauen in einem Baum', () => {
    const tree = w.vegetation.instances.find((v) => v.kind === 'pine' && v.alive)!;
    const p = w.building.evaluate(getStructure('campfire'), tree.position.clone(), 0);
    expect(p.valid).toBe(false);
  });

  it('verbietet Bauen im Wasser', () => {
    const p = w.building.evaluate(getStructure('wall'), new THREE.Vector3(250, 0, 250), 0);
    expect(p.valid).toBe(false);
  });

  it('meldet, wenn der Spieler im Weg steht', () => {
    const pos = w.flat.clone().add(new THREE.Vector3(0, 0, 4));
    const player = w.physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.35)
        .setTranslation(pos.x, pos.y + 0.9, pos.z)
        .setCollisionGroups(interactionGroups(CollisionGroup.PLAYER, 0xffff & ~CollisionGroup.PLAYER)),
    );
    w.physics.step();
    const p = w.building.evaluate(getStructure('wall'), pos, 0);
    expect(p.reason).toBe('Du stehst im Weg');
    w.physics.world.removeCollider(player, false);
    w.physics.step();
  });

  it('lässt Wände an Wandenden einrasten und verhindert Doppelungen', () => {
    const wallDef = getStructure('wall');
    const base = w.flat.clone().add(new THREE.Vector3(-3, 0, -3));
    base.y = w.heightMap.heightAt(base.x, base.z);
    w.building.place('wall', base, 0);
    w.physics.step();

    // Knapp neben dem rechten Ende zielen → rastet exakt an (Abstand 2 × halbe Breite).
    const aim = base.clone().add(new THREE.Vector3(WALL_HALF_WIDTH * 2 + 0.4, 0, 0.3));
    const p = w.building.evaluate(wallDef, aim, 0);
    expect(p.snapped).toBe(true);
    expect(p.position.x).toBeCloseTo(base.x + WALL_HALF_WIDTH * 2, 5);
    expect(p.position.z).toBeCloseTo(base.z, 5);
    expect(p.valid).toBe(true);

    // Exakt auf die bestehende Wand: nicht erlaubt.
    expect(w.building.evaluate(wallDef, base.clone(), 0).valid).toBe(false);
  });

  it('reißt Bauwerke ab und gibt die Hälfte des Materials zurück', () => {
    const pos = w.flat.clone().add(new THREE.Vector3(3, 0, 3));
    const s = w.building.place('shelter', pos, 0.5);
    const before = [...w.worldItems.all()].length;
    w.building.damage(s, 1000, pos, new THREE.Vector3(0, 1, 0));
    expect(w.building.structures.includes(s)).toBe(false);
    const dropped = [...w.worldItems.all()].slice(before).map((i) => i.itemId);
    expect(dropped.filter((i) => i === 'log').length).toBe(1); // 3 Stämme → 1
    expect(dropped.filter((i) => i === 'stick').length).toBe(2); // 4 Stöcke → 2
  });

  it('Lagerfeuer brennt nach dem Bau und wärmt in der Nähe', () => {
    const pos = w.flat.clone().add(new THREE.Vector3(0, 0, -5));
    const fire = w.building.place('campfire', pos, 0);
    expect(fire.lit).toBe(true);
    expect(w.building.isNearLitFire(pos.clone().add(new THREE.Vector3(2, 0, 0)))).toBe(true);
    w.building.toggleFire(fire);
    expect(w.building.isNearLitFire(pos)).toBe(false);
  });
});
