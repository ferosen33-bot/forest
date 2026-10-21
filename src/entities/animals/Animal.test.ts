import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Physics } from '../../core/Physics';
import { HeightMap } from '../../world/HeightMap';
import { NavGrid } from '../../systems/ai/NavGrid';
import { Animal, SPECIES, type AnimalContext } from './Animal';
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
      player: { position: playerPos, crouching, sprinting: false, isDead: false },
      allowPathPlan: () => true,
      warnHerd: () => void ctx.warned++,
      sound: () => {},
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
});
