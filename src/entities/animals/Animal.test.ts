import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Physics } from '../../core/Physics';
import { HeightMap } from '../../world/HeightMap';
import { NavGrid } from '../../systems/ai/NavGrid';
import { Animal, SPECIES, type AnimalContext } from './Animal';
import { Wolf, WolfPack, wolfBoldness } from './Wolf';
import { mulberry32 } from '../../utils/random';

const DT = 1 / 60;

async function setup() {
  const physics = await Physics.create();
  physics.timestep = DT;
  const heightMap = new HeightMap({ size: 512, cellSize: 2, seed: 7, waterLevel: 0 });
  physics.addTerrain(heightMap);
  const nav = new NavGrid(heightMap);
  // Freie, ebene Fläche (60 × 60 m begehbar) – Platz zum Fliehen.
  let origin: THREE.Vector3 | null = null;
  for (let z = -180; z < 180 && !origin; z += 6) {
    for (let x = -180; x < 180 && !origin; x += 6) {
      let ok = true;
      for (let dz = -30; dz <= 30 && ok; dz += 4) for (let dx = -30; dx <= 30 && ok; dx += 4) ok = nav.isWalkable(x + dx, z + dz);
      if (ok) origin = new THREE.Vector3(x, heightMap.heightAt(x, z), z);
    }
  }
  return { physics, heightMap, nav, origin: origin! };
}

describe('Animal (Wild)', () => {
  let w: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    w = await setup();
  });
  // Fluchtwinkel und Wartezeiten sind zufällig: fester Seed für reproduzierbare Tests.
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(99));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeCtx(playerPos: THREE.Vector3, crouching = false): AnimalContext & { warned: number } {
    const ctx = {
      warned: 0,
      time: 0,
      physics: w.physics,
      nav: w.nav,
      player: { position: playerPos, crouching, sprinting: false, isDead: false, hidden: false, torch: false },
      allowPathPlan: () => true,
      warnHerd: () => void ctx.warned++,
      sound: () => {},
      isNight: false,
      boldness: 1,
      hitPlayer: () => {},
      fireNear: () => false,
      prey: () => null,
    };
    return ctx;
  }

  function run(animals: Animal[], ctx: AnimalContext, seconds: number) {
    for (let i = 0; i < seconds * 60; i++) {
      for (const a of animals) a.fixedUpdate(DT, ctx);
      w.physics.step();
      for (const a of animals) a.afterPhysicsStep();
    }
  }

  it('flieht vor dem Spieler und entfernt sich dabei', () => {
    const start = w.origin.clone();
    const rabbit = new Animal(1, w.physics, 'rabbit', start, start.clone(), 1);
    const player = start.clone().add(new THREE.Vector3(5, 0, 0));
    run([rabbit], makeCtx(player), 0.5);
    expect(rabbit.state).toBe('flee');
    run([rabbit], makeCtx(player), 2);
    expect(rabbit.feet.distanceTo(player)).toBeGreaterThan(12);
    rabbit.dispose();
  });

  it('bemerkt einen geduckten Spieler erst viel später', () => {
    const start = w.origin.clone();
    const deer = new Animal(2, w.physics, 'deer', start, start.clone(), 1);
    // Aufrecht in 15 m: Hirsch wird aufmerksam; geduckt bleibt er ruhig.
    const player = start.clone().add(new THREE.Vector3(15, 0, 0));
    run([deer], makeCtx(player, true), 1);
    expect(['graze', 'wander']).toContain(deer.state);
    const ctx = makeCtx(player, false);
    run([deer], ctx, 0.5);
    expect(deer.state).toBe('alert');
    // Nach dem Sichern flieht er und warnt die Herde.
    run([deer], ctx, 1);
    expect(deer.state).toBe('flee');
    expect(ctx.warned).toBeGreaterThan(0);
    deer.dispose();
  });

  it('stirbt bei genug Schaden und hinterlässt eine ausnehmbare Leiche', () => {
    const start = w.origin.clone();
    const deer = new Animal(3, w.physics, 'deer', start, start.clone(), 1);
    expect(deer.takeDamage(20, start.clone().add(new THREE.Vector3(5, 0, 0)))).toBe(false);
    expect(deer.state).toBe('flee');
    expect(deer.takeDamage(SPECIES.deer.health, start)).toBe(true);
    expect(deer.isDead).toBe(true);
    expect(deer.corpse?.isSensor()).toBe(true);
    deer.dispose();
    expect(deer.corpse).toBeNull();
  });

  /** Rudel aus `n` Wölfen 30 m vom Spieler entfernt. */
  function makePack(n: number, idBase: number): { pack: WolfPack; wolves: Wolf[] } {
    const center = w.origin.clone().add(new THREE.Vector3(-15, 0, 0));
    const pack = new WolfPack(center.clone());
    const wolves: Wolf[] = [];
    for (let i = 0; i < n; i++) {
      const p = center.clone().add(new THREE.Vector3(0, 0, i * 2 - n));
      p.y = w.heightMap.heightAt(p.x, p.z);
      const wolf = new Wolf(idBase + i, w.physics, 'wolf', p, center.clone(), 1);
      wolf.pack = pack;
      pack.members.push(wolf);
      wolves.push(wolf);
    }
    return { pack, wolves };
  }

  function runPack(pack: WolfPack, ctx: AnimalContext, seconds: number) {
    for (let i = 0; i < seconds * 60; i++) {
      pack.update(DT, ctx);
      for (const a of pack.members) a.fixedUpdate(DT, ctx);
      w.physics.step();
      for (const a of pack.members) a.afterPhysicsStep();
    }
  }

  it('Wolfsrudel kreist den Spieler nachts ein und beißt zu', () => {
    const { pack, wolves } = makePack(3, 10);
    const player = w.origin.clone().add(new THREE.Vector3(15, 0, 0));
    let bites = 0;
    const ctx = { ...makeCtx(player), isNight: true, boldness: 1.4, hitPlayer: () => void bites++ };
    runPack(pack, ctx, 1);
    expect(pack.engaged).toBe(true);
    expect(wolves.every((x) => x.state === 'stalk' || x.state === 'attack')).toBe(true);
    runPack(pack, ctx, 40);
    expect(bites).toBeGreaterThan(0);
    // Nie mehrere gleichzeitig im Angriff.
    expect(wolves.filter((x) => x.state === 'attack').length).toBeLessThanOrEqual(1);
    wolves.forEach((x) => x.dispose());
  });

  it('Feuer hält die Wölfe auf Abstand', () => {
    const { pack, wolves } = makePack(3, 20);
    const player = w.origin.clone().add(new THREE.Vector3(15, 0, 0));
    let bites = 0;
    const ctx = { ...makeCtx(player), isNight: true, boldness: 1.4, hitPlayer: () => void bites++, fireNear: () => true };
    runPack(pack, ctx, 30);
    expect(pack.engaged).toBe(true);
    expect(bites).toBe(0);
    for (const x of wolves) expect(x.feet.distanceTo(player)).toBeGreaterThan(6);
    wolves.forEach((x) => x.dispose());
  });

  it('nach Verlusten flieht das Rudel', () => {
    const { pack, wolves } = makePack(3, 30);
    const player = w.origin.clone().add(new THREE.Vector3(15, 0, 0));
    const ctx = { ...makeCtx(player), isNight: true, boldness: 1 };
    runPack(pack, ctx, 1);
    expect(pack.engaged).toBe(true);
    for (const x of wolves.slice(0, 2)) {
      x.takeDamage(Infinity, player);
      pack.lost(player);
    }
    expect(pack.engaged).toBe(false);
    expect(wolves[2].state).toBe('flee');
    expect(pack.willing).toBe(false);
    wolves.forEach((x) => x.dispose());
  });

  it('Wölfe sind im Winter und im Schneesturm kühner', () => {
    expect(wolfBoldness(0, 0)).toBe(1);
    expect(wolfBoldness(0.9, 0)).toBeGreaterThan(1.4);
    expect(wolfBoldness(0.9, 1)).toBeGreaterThan(wolfBoldness(0.9, 0));
    // Ein Sommergewitter macht sie nicht dreister.
    expect(wolfBoldness(0, 1)).toBe(1);
  });
});
