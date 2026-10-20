import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CollisionGroup, interactionGroups, Physics, RAPIER } from '../../core/Physics';
import { HeightMap } from '../../world/HeightMap';
import { NavGrid } from '../../systems/ai/NavGrid';
import { CONFIG } from '../../config';
import { Enemy, type EnemyContext, type PlayerTarget } from './Enemy';

const DT = 1 / 60;

async function setup() {
  const physics = await Physics.create();
  physics.timestep = DT;
  const heightMap = new HeightMap({ size: 512, cellSize: 2, seed: 7, waterLevel: 0 });
  physics.addTerrain(heightMap);
  const nav = new NavGrid(heightMap);

  // Freie, ebene Fläche für den Test suchen (30 × 30 m begehbar).
  let origin: THREE.Vector3 | null = null;
  for (let z = -150; z < 150 && !origin; z += 6) {
    for (let x = -150; x < 150 && !origin; x += 6) {
      let ok = true;
      for (let dz = -15; dz <= 15 && ok; dz += 3) for (let dx = -15; dx <= 15 && ok; dx += 3) ok = nav.isWalkable(x + dx, z + dz);
      if (ok) origin = new THREE.Vector3(x, heightMap.heightAt(x, z), z);
    }
  }
  return { physics, heightMap, nav, origin: origin! };
}

describe('Enemy (KI)', () => {
  let w: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    w = await setup();
  });

  /** Spieler-Attrappe: Kapsel-Collider in der Spieler-Gruppe + Trefferzähler. */
  function makePlayer(pos: THREE.Vector3) {
    const collider = w.physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.35)
        .setTranslation(pos.x, pos.y + 0.9, pos.z)
        .setCollisionGroups(interactionGroups(CollisionGroup.PLAYER, 0xffff & ~CollisionGroup.PLAYER)),
    );
    const hits: number[] = [];
    const target: PlayerTarget = {
      position: pos.clone(),
      eye: pos.clone().add(new THREE.Vector3(0, 1.65, 0)),
      collider,
      isDead: false,
      receiveHit: (amount) => hits.push(amount),
    };
    return { target, hits, dispose: () => w.physics.world.removeCollider(collider, false) };
  }

  function makeCtx(player: PlayerTarget, others: Enemy[]): EnemyContext {
    return {
      time: 0,
      physics: w.physics,
      nav: w.nav,
      player,
      sightRange: 30,
      isNight: false,
      fireNear: () => null,
      structureByCollider: () => undefined,
      damageStructure: () => {},
      alertAllies: () => {},
      others,
      allowPathPlan: () => true,
      sound: () => {},
    };
  }

  function run(enemy: Enemy, ctx: EnemyContext, seconds: number, until?: () => boolean) {
    for (let i = 0; i < seconds / DT; i++) {
      ctx.time += DT;
      enemy.fixedUpdate(DT, ctx);
      w.physics.step();
      enemy.afterPhysicsStep();
      if (until?.()) return true;
    }
    return false;
  }

  function spawnFacing(pos: THREE.Vector3, yaw: number): Enemy {
    const e = new Enemy(1, w.physics, pos, pos, CONFIG.ai, 0, 1);
    e.yaw = yaw;
    w.physics.step();
    return e;
  }

  it('entdeckt den Spieler im Sichtfeld und geht zur Jagd über', () => {
    const p = makePlayer(w.origin.clone().add(new THREE.Vector3(0, 0, 8)));
    const e = spawnFacing(w.origin, 0); // Blick nach +Z → auf den Spieler
    const ctx = makeCtx(p.target, [e]);
    expect(run(e, ctx, 4, () => e.isAggressive)).toBe(true);
    e.dispose();
    p.dispose();
  });

  it('übersieht den Spieler im Rücken, hört aber Geräusche', () => {
    const p = makePlayer(w.origin.clone().add(new THREE.Vector3(0, 0, -10)));
    const e = spawnFacing(w.origin, 0); // Spieler hinter ihm
    const ctx = makeCtx(p.target, [e]);
    run(e, ctx, 2);
    expect(e.suspicion).toBeLessThan(0.05);
    e.hear(p.target.position, 0.35);
    expect(e.state).toBe('investigate');
    e.dispose();
    p.dispose();
  });

  it('verfolgt und greift an, wenn der Spieler stehen bleibt', () => {
    const p = makePlayer(w.origin.clone().add(new THREE.Vector3(0, 0, 9)));
    const e = spawnFacing(w.origin, 0);
    const ctx = makeCtx(p.target, [e]);
    expect(run(e, ctx, 12, () => p.hits.length > 0)).toBe(true);
    expect(p.hits[0]).toBeGreaterThan(5);
    e.dispose();
    p.dispose();
  });

  it('taumelt bei Treffern und stirbt bei 0 Lebenspunkten', () => {
    const p = makePlayer(w.origin.clone().add(new THREE.Vector3(0, 0, 3)));
    const e = spawnFacing(w.origin, 0);
    const ctx = makeCtx(p.target, [e]);
    expect(e.takeDamage(20, p.target.position, ctx)).toBe(false);
    expect(e.state).toBe('stagger');
    const bodies = w.physics.world.bodies.len();
    expect(e.takeDamage(1000, p.target.position, ctx)).toBe(true);
    expect(e.isDead).toBe(true);
    expect(w.physics.world.bodies.len()).toBe(bodies - 1);
    p.dispose();
  });

  it('verletzt sich an einer Stachelfalle, die im Weg steht', () => {
    const trapPos = w.origin.clone().add(new THREE.Vector3(0, 0, 4));
    const trapCollider = w.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.75, 0.4, 0.75)
        .setTranslation(trapPos.x, trapPos.y + 0.4, trapPos.z)
        .setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
    );
    const trap = { def: { id: 'spikeTrap' }, position: trapPos, health: 80 } as unknown as import('../../systems/building/BuildingSystem').Structure;
    const p = makePlayer(w.origin.clone().add(new THREE.Vector3(0, 0, 9)));
    const e = spawnFacing(w.origin, 0);
    const ctx = makeCtx(p.target, [e]);
    ctx.structureByCollider = (c) => (c.handle === trapCollider.handle ? trap : undefined);
    ctx.damageStructure = (s, amount) => {
      s.health -= amount;
    };
    e.alertedBy(p.target.position, ctx);
    const start = e.health;
    run(e, ctx, 6, () => e.health < start);
    expect(e.health).toBeLessThan(start);
    expect(trap.health).toBeLessThan(80);
    w.physics.world.removeCollider(trapCollider, false);
    e.dispose();
    p.dispose();
  });

  it('läuft um eine Wand herum zum Ziel', () => {
    const goal = w.origin.clone().add(new THREE.Vector3(0, 0, 12));
    // 12 m breite Wand zwischen Gegner und Ziel (im Navigationsraster und als Collider).
    const wallPos = w.origin.clone().add(new THREE.Vector3(0, 0, 6));
    w.nav.markBox(wallPos.x, wallPos.z, 0, 6, 0.3, 1);
    const wall = w.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(6, 1.5, 0.3)
        .setTranslation(wallPos.x, wallPos.y + 1.5, wallPos.z)
        .setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
    );
    const p = makePlayer(w.origin.clone().add(new THREE.Vector3(40, 0, 40))); // weit weg, irrelevant
    const e = spawnFacing(w.origin, 0);
    const ctx = makeCtx(p.target, [e]);
    e.hunt(goal);
    const arrived = run(e, ctx, 20, () => e.feet.distanceTo(goal) < 2);
    expect(arrived).toBe(true);
    w.nav.markBox(wallPos.x, wallPos.z, 0, 6, 0.3, -1);
    w.physics.world.removeCollider(wall, false);
    e.dispose();
    p.dispose();
  });
});
