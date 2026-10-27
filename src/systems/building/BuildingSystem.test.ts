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
import { FLOOR_HALF, getStructure, STORY, WALL_HALF_WIDTH } from './StructureDefs';

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

  it('baut in die Höhe: Decke über dem Boden, Wände oben, Treppe durchs Loch, Kiste unten', () => {
    const b = w.building;
    for (const s of [...b.structures]) b.demolish(s);
    const base = w.flat.clone().add(new THREE.Vector3(10, 0, 10));
    const floor = b.place('floor', base.clone().setY(base.y + 0.2), 0);
    const next = b.place('floor', floor.position.clone().add(new THREE.Vector3(FLOOR_HALF * 2, 0, 0)), 0);
    // Decke rastet über dem Boden ein, ein Stockwerk höher.
    b.refY = floor.position.y + 2;
    const c = b.evaluate(getStructure('ceiling'), floor.position.clone().add(new THREE.Vector3(0.4, 0, 0.3)), 0);
    expect(c.valid).toBe(true);
    expect(c.position.y).toBeCloseTo(floor.position.y + STORY);
    const ceiling = b.place('ceiling', c.position, c.rotation);
    // Neben der Decke ist das Treppenloch über dem zweiten Boden: dort hängt die Treppe nach oben.
    const st = b.evaluate(getStructure('upStairs'), next.position.clone(), 0);
    expect(st.valid).toBe(true);
    expect(st.position.y).toBeCloseTo(ceiling.position.y);
    // Wände rasten oben an der Deckenkante ein, wenn man aufs obere Stockwerk zielt …
    b.refY = ceiling.position.y;
    const wall = b.evaluate(getStructure('wall'), ceiling.position.clone().add(new THREE.Vector3(0, 0, FLOOR_HALF)), 0);
    expect(wall.position.y).toBeCloseTo(ceiling.position.y);
    // … und eine Kiste unten landet auf dem Boden, nicht auf der Decke.
    b.refY = floor.position.y;
    const chest = b.evaluate(getStructure('chest'), floor.position.clone(), 0);
    expect(chest.position.y).toBeLessThan(floor.position.y + 0.3);
    // Ohne Boden darunter gibt es keine Decke.
    b.refY = null;
    expect(b.evaluate(getStructure('ceiling'), base.clone().add(new THREE.Vector3(-20, 0, -20)), 0).valid).toBe(false);
    for (const s of [...b.structures]) b.demolish(s);
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

  describe('Böden und Tore', () => {
    const clear = () => {
      for (const s of [...w.building.structures]) w.building.demolish(s);
      w.physics.step();
    };

    it('Boden liegt knapp über dem höchsten Punkt und trägt andere Bauwerke', () => {
      clear();
      const pos = w.flat.clone();
      const p = w.building.evaluate(getStructure('floor'), pos, 0.3);
      expect(p.valid).toBe(true);
      expect(p.position.y).toBeGreaterThan(w.heightMap.heightAt(pos.x, pos.z));
      const floor = w.building.place('floor', p.position, p.rotation);
      w.physics.step();
      // Ein Lagerfeuer auf dem Boden steht auf den Dielen, nicht im Gelände darunter.
      const fire = w.building.evaluate(getStructure('campfire'), pos.clone(), 0);
      expect(fire.valid).toBe(true);
      expect(fire.position.y).toBeCloseTo(floor.position.y - 0.02, 2);
    });

    it('Böden rasten Kante an Kante ein, Wände auf die Bodenkante', () => {
      const floor = w.building.structures.find((s) => s.def.id === 'floor')!;
      const right = new THREE.Vector3(FLOOR_HALF * 2, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), floor.rotation);
      const aim = floor.position.clone().add(right).add(new THREE.Vector3(0.5, 0, -0.4));
      const p = w.building.evaluate(getStructure('floor'), aim, 1.7);
      expect(p.snapped).toBe(true);
      expect(p.rotation).toBeCloseTo(floor.rotation, 5);
      expect(p.position.y).toBeCloseTo(floor.position.y, 5);
      expect(p.position.distanceTo(floor.position)).toBeCloseTo(FLOOR_HALF * 2, 3);

      // Wand nahe der vorderen Kante (lokal +Z): exakt bündig, auf Dielenhöhe, parallel zur Kante.
      const front = new THREE.Vector3(0.3, 0, FLOOR_HALF + 0.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), floor.rotation);
      const wall = w.building.evaluate(getStructure('wall'), floor.position.clone().add(front), floor.rotation + 0.2);
      expect(wall.snapped).toBe(true);
      expect(wall.valid).toBe(true);
      expect(wall.position.y).toBeCloseTo(floor.position.y, 5);
      expect(Math.cos(wall.rotation - floor.rotation)).toBeCloseTo(1, 5);
      expect(wall.position.distanceTo(floor.position)).toBeCloseTo(FLOOR_HALF, 3);
    });

    it('Tor öffnet und schließt (Flügel wird zum Sensor) und meldet es der Wegfindung', () => {
      clear();
      const events = new EventBus();
      const doors: boolean[] = [];
      // Eigenes System mit Ereignis-Zähler
      const b = new BuildingSystem(
        w.physics,
        w.heightMap,
        new Crafting(w.inventory),
        w.worldItems,
        new Particles(),
        new Particles(50, true),
        new LightPool(new THREE.Scene(), 2),
        new Audio(),
        events,
      );
      events.on('structure:door', ({ open }) => doors.push(open));
      const pos = w.flat.clone();
      const gate = b.place('gate', pos, 0);
      expect(gate.doorCollider?.isSensor()).toBe(false);
      b.toggleDoor(gate);
      expect(gate.open).toBe(true);
      expect(gate.doorCollider?.isSensor()).toBe(true);
      // Abriss eines offenen Tors schließt es zuerst → Ereignisse bleiben ausgeglichen.
      b.demolish(gate);
      expect(doors).toEqual([true, false]);
    });
  });

  describe('Fischreuse & Standfackel', () => {
    /** Stelle mit ~0,6 m tiefem, ebenem Grund. */
    function shallow(): THREE.Vector3 {
      for (let z = -250; z < 250; z += 2) {
        for (let x = -250; x < 250; x += 2) {
          const h = w.heightMap.heightAt(x, z);
          if (h > -0.5 || h < -0.8) continue;
          const around = [-0.7, 0.7].flatMap((dx) => [-0.7, 0.7].map((dz) => w.heightMap.heightAt(x + dx, z + dz)));
          if (Math.max(...around) - Math.min(...around) < 0.5) return new THREE.Vector3(x, h, z);
        }
      }
      throw new Error('kein flaches Wasser gefunden');
    }

    it('Reuse nur in flachem Wasser', () => {
      const def = getStructure('fishTrap');
      const water = shallow();
      const p = w.building.evaluate(def, water, 0);
      expect(p.reason).toBeUndefined();
      expect(p.valid).toBe(true);
      // Der Korb sitzt knapp unter dem Wasserspiegel (über dem Grund), nicht auf dem Grund.
      expect(p.position.y).toBeCloseTo(w.heightMap.waterLevel - def.inWater!.sink, 3);
      expect(p.position.y).toBeGreaterThan(water.y);
      expect(w.building.evaluate(def, w.flat, 0).reason).toBe('Nur in flachem Wasser');
    });

    it('Reuse speichert ihren Fang und verliert ihn beim Abriss nicht', () => {
      const trap = w.building.place('fishTrap', shallow(), 0);
      trap.catch = 2;
      const save = w.building.serialize().find((s) => s.id === 'fishTrap')!;
      expect(save.catch).toBe(2);
      const before = w.worldItems.size;
      w.building.demolish(trap);
      expect(w.worldItems.serialize().some((i) => i.id === 'rawFish' && i.count === 2)).toBe(true);
      expect(w.worldItems.size).toBeGreaterThan(before);
    });

    it('Standfackel brennt, wärmt aber nicht', () => {
      const pos = w.flat.clone().add(new THREE.Vector3(3, 0, 3));
      pos.y = w.heightMap.heightAt(pos.x, pos.z);
      const post = w.building.place('torchPost', pos, 0);
      expect(post.lit).toBe(true);
      expect(post.light?.position.y).toBeCloseTo(pos.y + 1.8, 3);
      expect(w.building.isNearLitFire(pos)).toBe(false);
      const fire = w.building.place('campfire', pos.clone().add(new THREE.Vector3(8, 0, 0)), 0);
      expect(w.building.isNearLitFire(fire.position)).toBe(true);
      w.building.demolish(post);
      w.building.demolish(fire);
    });
  });

  describe('Verteidigung', () => {
    const spot = (dx: number, dz: number) => {
      const p = w.flat.clone().add(new THREE.Vector3(dx, 0, dz));
      p.y = w.heightMap.heightAt(p.x, p.z);
      return p;
    };

    it('Reparieren kostet Material und stellt die Hälfte der Haltbarkeit wieder her', () => {
      const wall = w.building.place('spikeWall', spot(-3, -3), 0);
      expect(w.building.needsRepair(wall)).toBe(false);
      wall.health = 40;
      w.inventory.remove('log', 99);
      expect(w.building.repair(wall)).toBe(false);
      w.inventory.add('log', 2);
      expect(w.building.repair(wall)).toBe(true);
      expect(wall.health).toBe(40 + getStructure('spikeWall').maxHealth / 2);
      expect(w.inventory.count('log')).toBe(1);
      w.building.demolish(wall);
    });

    it('Fallgrube: Tarnung verschwindet beim Zuschnappen und lässt sich neu legen', () => {
      const pit = w.building.place('pitTrap', spot(-3, 3), 0);
      expect(pit.armed).toBe(true);
      expect(pit.cover?.visible).toBe(true);
      w.building.setArmed(pit, false);
      expect(pit.cover?.visible).toBe(false);
      expect(w.building.serialize().find((x) => x.id === 'pitTrap')?.armed).toBe(false);
      w.inventory.remove('stick', 99);
      expect(w.building.rearmPit(pit)).toBe(false);
      w.inventory.add('stick', 2);
      expect(w.building.rearmPit(pit)).toBe(true);
      expect(pit.cover?.visible).toBe(true);
      w.building.demolish(pit);
    });

    it('Barrikade, Stachelwand und Klapperleine lassen sich bauen', () => {
      for (const id of ['barricade', 'spikeWall', 'rattleLine'] as const) {
        const s = w.building.place(id, spot(4, -4), 0);
        expect(s.health).toBe(getStructure(id).maxHealth);
        w.building.demolish(s);
      }
      expect(getStructure('barricade').thorns).toBeGreaterThan(0);
      expect(getStructure('rattleLine').walkable).toBe(true);
    });
  });
});
