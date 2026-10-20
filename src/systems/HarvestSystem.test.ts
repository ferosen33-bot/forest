import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Physics } from '../core/Physics';
import { EventBus } from '../core/EventBus';
import { HeightMap } from '../world/HeightMap';
import { Vegetation, isTree, type VegetationInstance } from '../world/Vegetation';
import { WorldItems } from '../entities/items/WorldItems';
import { ITEMS } from '../entities/items/ItemDefs';
import { Inventory } from './Inventory';
import { ItemService } from './ItemService';
import { HarvestSystem } from './HarvestSystem';
import { Particles } from './Particles';
import { Audio } from './Audio';

const AXE = ITEMS.axe.tool!;

/** Kleine Testwelt mit echter Physik (Rapier läuft auch in Node). */
async function createWorld() {
  const physics = await Physics.create();
  physics.timestep = 1 / 60;
  const heightMap = new HeightMap({ size: 512, cellSize: 2, seed: 7, waterLevel: 0 });
  physics.addTerrain(heightMap);
  const vegetation = new Vegetation(heightMap, physics, { seed: 7, cellSize: 64, cullDistance: 300, clearings: [] });
  const events = new EventBus();
  const audio = new Audio(); // ohne resume() stumm
  const inventory = new Inventory();
  const worldItems = new WorldItems(physics);
  const items = new ItemService(inventory, worldItems, events, audio);
  const harvest = new HarvestSystem(physics, vegetation, worldItems, items, new Particles(), audio, events);
  physics.step();
  return { physics, vegetation, worldItems, inventory, harvest, events };
}

const firstOf = (vegetation: Vegetation, pred: (v: VegetationInstance) => boolean) =>
  vegetation.instances.find((v) => v.alive && pred(v))!;

describe('HarvestSystem', () => {
  let w: Awaited<ReturnType<typeof createWorld>>;
  beforeAll(async () => {
    w = await createWorld();
  });

  it('fällt einen Baum nach mehreren Treffern und zerlegt ihn in Holzstämme', () => {
    const tree = firstOf(w.vegetation, (v) => isTree(v.kind));
    const hitPoint = tree.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    const from = new THREE.Vector3(1, 0, 0);
    let felledEvents = 0;
    w.events.on('tree:felled', () => felledEvents++);

    let hits = 0;
    while (tree.alive && hits < 20) {
      w.harvest.hitTree(tree, AXE, hitPoint, new THREE.Vector3(-1, 0, 0), from);
      hits++;
    }
    expect(tree.alive).toBe(false);
    expect(hits).toBeGreaterThanOrEqual(3);
    expect(felledEvents).toBe(1);
    expect(w.harvest.fallingCount).toBe(1);

    // Simulieren, bis der Baum liegt und zerlegt wurde (muss zur Ruhe kommen, nicht nur per Timeout).
    let t = 0;
    while (w.harvest.fallingCount > 0 && t < 12) {
      w.physics.step();
      w.harvest.update(1 / 60);
      t += 1 / 60;
    }
    expect(w.harvest.fallingCount).toBe(0);
    expect(t).toBeLessThan(7);

    const logs = [...w.worldItems.all()].filter((i) => i.itemId === 'log');
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });

  it('liefert Steine aus Felsen, bis sie erschöpft sind', () => {
    const rock = firstOf(w.vegetation, (v) => v.kind === 'rock');
    const point = rock.position.clone();
    let stones = 0;
    for (let i = 0; i < 20 && !w.harvest.isRockDepleted(rock); i++) {
      stones += w.harvest.hitRock(rock, AXE, point, new THREE.Vector3(0, 1, 0));
    }
    expect(stones).toBeGreaterThanOrEqual(2);
    expect(w.inventory.count('stone')).toBe(stones);
    expect(w.harvest.hitRock(rock, AXE, point, new THREE.Vector3(0, 1, 0))).toBe(0);
  });

  it('Beeren lassen sich pflücken und wachsen nach', () => {
    const bush = firstOf(w.vegetation, (v) => v.kind === 'bush' && v.berries !== null);
    expect(w.vegetation.harvestBerries(bush)).toBe(true);
    expect(w.vegetation.hasRipeBerries(bush)).toBe(false);
    expect(w.vegetation.harvestBerries(bush)).toBe(false);
    w.vegetation.update(0.016, 10_000, new THREE.Vector3());
    expect(w.vegetation.hasRipeBerries(bush)).toBe(true);
  });
});
