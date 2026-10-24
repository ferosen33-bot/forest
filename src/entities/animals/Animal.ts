import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../../core/Physics';
import type { NavGrid } from '../../systems/ai/NavGrid';
import { AnimalRig, type Species } from './AnimalRig';
import { clamp } from '../../utils/math';

export type AnimalState = 'graze' | 'wander' | 'alert' | 'flee' | 'dead';

interface SpeciesStats {
  name: string;
  health: number;
  walkSpeed: number;
  runSpeed: number;
  /** Fluchtdistanz zum Spieler (m) – geduckt deutlich kleiner. */
  fear: number;
  radius: number;
  height: number;
  /** Fleisch beim Ausnehmen. */
  meat: number;
  wanderRadius: number;
}

export const SPECIES: Record<Species, SpeciesStats> = {
  deer: { name: 'Hirsch', health: 60, walkSpeed: 1.3, runSpeed: 9, fear: 22, radius: 0.38, height: 1.5, meat: 3, wanderRadius: 30 },
  rabbit: { name: 'Hase', health: 12, walkSpeed: 0.9, runSpeed: 6.5, fear: 9, radius: 0.16, height: 0.34, meat: 1, wanderRadius: 15 },
};

export interface AnimalContext {
  time: number;
  physics: Physics;
  nav: NavGrid;
  player: { position: THREE.Vector3; crouching: boolean; sprinting: boolean; isDead: boolean };
  allowPathPlan(): boolean;
  /** Warnruf eines Hirsches erreicht die Herde. */
  warnHerd(source: Animal, threat: THREE.Vector3): void;
  sound(id: 'deerAlarm', position: THREE.Vector3): void;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Wildtier (Hirsch, Hase): grast, streift umher und flieht vor dem Spieler und vor Lärm.
 * Hirsche sind schneller als der rennende Spieler – erlegen klappt mit Anschleichen
 * (geduckt) oder einem geworfenen Speer.
 */
export class Animal {
  readonly rig: AnimalRig;
  readonly stats: SpeciesStats;
  state: AnimalState = 'graze';
  health: number;
  yaw = Math.random() * Math.PI * 2;
  readonly position = new THREE.Vector3();
  active = true;
  /** Fellton-Index. */
  tint = 0;
  deadFor = 0;
  /** Sensor-Collider der Leiche (zum Anvisieren/Ausnehmen). */
  corpse: RAPIER.Collider | null = null;

  private readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly groups = interactionGroups(CollisionGroup.ANIMAL, 0xffff & ~CollisionGroup.ITEM);
  private readonly prev = new THREE.Vector3();
  private readonly curr = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly threat = new THREE.Vector3();
  private desiredSpeed = 0;
  private timer = Math.random() * 4;
  private senseTimer = Math.random() * 0.2;
  private path: { x: number; z: number }[] | null = null;
  private pathIndex = 0;
  private grounded = false;
  private hitTimer = 0;

  constructor(
    readonly id: number,
    private readonly physics: Physics,
    readonly species: Species,
    spawn: THREE.Vector3,
    readonly home: THREE.Vector3,
    scale: number,
  ) {
    this.stats = SPECIES[species];
    this.health = this.stats.health * scale;
    this.rig = new AnimalRig(species, scale, species === 'deer' && Math.random() < 0.45);
    const s = this.stats;
    const world = physics.world;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + 0.05, spawn.z),
    );
    const r = s.radius * scale;
    const h = s.height * scale;
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(Math.max(0.01, h / 2 - r), r)
        .setTranslation(0, h / 2, 0)
        .setCollisionGroups(this.groups),
      this.body,
    );
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.4 * scale, 0.15, false);
    this.controller.enableSnapToGround(0.5);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(50));
    this.curr.set(spawn.x, spawn.y + 0.05, spawn.z);
    this.prev.copy(this.curr);
    this.position.copy(this.curr);
  }

  get isDead(): boolean {
    return this.state === 'dead';
  }

  get feet(): THREE.Vector3 {
    return this.curr;
  }

  get name(): string {
    return this.species === 'deer' && !this.rig.antlers ? 'Hirschkuh' : this.stats.name;
  }

  /** Köder: ruhige Tiere laufen gemächlich dorthin (Schlingfalle). @returns true, wenn es folgt. */
  lure(target: THREE.Vector3): boolean {
    if (this.state !== 'graze' && this.state !== 'wander') return false;
    this.target.set(target.x, 0, target.z);
    this.state = 'wander';
    this.path = null;
    return true;
  }

  /** Schreck: Flucht weg von `from`. */
  scare(from: THREE.Vector3): void {
    if (this.isDead) return;
    this.threat.copy(from);
    this.pickFleeTarget();
    this.state = 'flee';
    this.timer = 6 + Math.random() * 3;
  }

  /** @returns true, wenn das Tier dadurch gestorben ist. */
  takeDamage(amount: number, from: THREE.Vector3): boolean {
    if (this.isDead) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.die();
      return true;
    }
    this.hitTimer = 0.25;
    this.scare(from);
    return false;
  }

  fixedUpdate(dt: number, ctx: AnimalContext): void {
    if (this.isDead) {
      this.deadFor += dt;
      return;
    }
    this.sense(dt, ctx);
    this.think(dt, ctx);
    this.move(dt, ctx);
  }

  afterPhysicsStep(): void {
    if (this.isDead) return;
    this.prev.copy(this.curr);
    const t = this.body.translation();
    this.curr.set(t.x, t.y, t.z);
  }

  private sense(dt: number, ctx: AnimalContext): void {
    this.senseTimer -= dt;
    if (this.senseTimer > 0) return;
    this.senseTimer = 0.2;
    const p = ctx.player;
    if (p.isDead) return;
    const fear = this.stats.fear * (p.crouching ? 0.4 : 1) * (p.sprinting ? 1.4 : 1);
    const d = this.curr.distanceTo(p.position);
    if (d < fear && this.state !== 'flee') {
      if (this.species === 'deer' && this.state !== 'alert' && d > fear * 0.5) {
        // Hirsch sichert erst kurz (Kopf hoch, Schwanz hoch) und warnt dann die Herde.
        this.state = 'alert';
        this.threat.copy(p.position);
        this.timer = 0.7;
      } else if (this.state !== 'alert') {
        this.scare(p.position);
        if (this.species === 'deer') ctx.warnHerd(this, p.position);
      }
    }
  }

  private think(dt: number, ctx: AnimalContext): void {
    this.timer -= dt;
    this.hitTimer -= dt;
    this.desiredSpeed = 0;
    switch (this.state) {
      case 'graze':
        this.rig.blend({ graze: 1, alert: 0 }, dt);
        if (this.timer <= 0) this.pickWander(ctx);
        break;
      case 'wander':
        this.rig.blend({ graze: 0, alert: 0 }, dt);
        if (this.moveTo(this.target, this.stats.walkSpeed, ctx)) {
          this.state = 'graze';
          this.timer = 3 + Math.random() * 7;
        }
        break;
      case 'alert': {
        this.rig.blend({ graze: 0, alert: 1 }, dt);
        // Zum Störenfried blicken
        const a = Math.atan2(this.threat.x - this.curr.x, this.threat.z - this.curr.z) - this.yaw;
        this.rig.blend({ lookYaw: clamp(Math.atan2(Math.sin(a), Math.cos(a)), -1.2, 1.2) }, dt);
        if (this.timer <= 0) {
          ctx.sound('deerAlarm', this.curr);
          ctx.warnHerd(this, this.threat);
          this.scare(this.threat);
        }
        break;
      }
      case 'flee':
        this.rig.blend({ graze: 0, alert: 1, lookYaw: 0 }, dt);
        if (this.moveTo(this.target, this.stats.runSpeed, ctx)) {
          // Ziel erreicht: weiterfliehen, falls die Gefahr noch nah ist.
          if (this.curr.distanceTo(ctx.player.position) < this.stats.fear * 1.6 && this.timer > 0) this.pickFleeTarget();
          else this.timer = 0;
        }
        if (this.timer <= 0) {
          this.state = 'graze';
          this.timer = 2 + Math.random() * 3;
          // Neues Revier dort, wo es zur Ruhe kam.
          this.home.copy(this.curr);
        }
        break;
    }
  }

  private pickWander(ctx: AnimalContext): void {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * this.stats.wanderRadius;
      const x = this.home.x + Math.cos(a) * r;
      const z = this.home.z + Math.sin(a) * r;
      if (ctx.nav.isWalkable(x, z)) {
        this.target.set(x, 0, z);
        this.state = 'wander';
        this.path = null;
        return;
      }
    }
    this.timer = 2;
  }

  private pickFleeTarget(): void {
    const away = new THREE.Vector3().subVectors(this.curr, this.threat).setY(0);
    if (away.lengthSq() < 0.01) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    away.normalize().applyAxisAngle(UP, (Math.random() - 0.5) * 0.8);
    this.target.copy(this.curr).addScaledVector(away, 28 + Math.random() * 12);
    this.path = null;
  }

  /** Läuft zum Ziel; bei Hindernissen per A*. @returns true bei Ankunft. */
  private moveTo(goal: THREE.Vector3, speed: number, ctx: AnimalContext): boolean {
    const dx = goal.x - this.curr.x;
    const dz = goal.z - this.curr.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.2) return true;
    this.desiredSpeed = speed;
    const from = { x: this.curr.x, z: this.curr.z };
    if (ctx.nav.lineWalkable(from, { x: goal.x, z: goal.z })) {
      this.desired.set(dx / dist, 0, dz / dist);
      return false;
    }
    if (!this.path && ctx.allowPathPlan()) {
      this.path = ctx.nav.findPath(from, { x: goal.x, z: goal.z }, 4000);
      this.pathIndex = 0;
      // Unerreichbar (Wasser, eingezäunt): neues Ziel suchen.
      if (!this.path) {
        this.timer = Math.min(this.timer, 0.5);
        return true;
      }
    }
    if (this.path && this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex];
      const wx = wp.x - this.curr.x;
      const wz = wp.z - this.curr.z;
      const wd = Math.hypot(wx, wz);
      if (wd < 1) this.pathIndex++;
      this.desired.set(wx, 0, wz).divideScalar(Math.max(wd, 0.001));
    }
    return false;
  }

  private move(dt: number, ctx: AnimalContext): void {
    if (this.desiredSpeed > 0.05) {
      const turnTo = Math.atan2(this.desired.x, this.desired.z);
      let diff = turnTo - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const rate = this.state === 'flee' ? 6 : 2.5;
      this.yaw += clamp(diff, -rate * dt, rate * dt);
    }
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const align = Math.max(0, forward.dot(this.desired));
    const speed = this.hitTimer > 0 ? this.desiredSpeed * 0.3 : this.desiredSpeed * (0.25 + 0.75 * align);
    const accel = (this.state === 'flee' ? 14 : 5) * dt;
    this.velocity.x += clamp(forward.x * speed - this.velocity.x, -accel, accel);
    this.velocity.z += clamp(forward.z * speed - this.velocity.z, -accel, accel);
    this.velocity.y = this.grounded ? -1 : this.velocity.y - 20 * dt;

    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, this.groups);
    const mv = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    // Nicht ins Wasser laufen.
    if (!ctx.nav.isWalkable(this.curr.x + mv.x * 8, this.curr.z + mv.z * 8) && ctx.nav.isWalkable(this.curr.x, this.curr.z)) {
      mv.x = 0;
      mv.z = 0;
      if (this.state === 'flee') this.pickFleeTarget();
    }
    this.body.setNextKinematicTranslation({ x: this.curr.x + mv.x, y: this.curr.y + mv.y, z: this.curr.z + mv.z });
    this.rig.anim.speed = Math.hypot(mv.x, mv.z) / dt;
  }

  private die(): void {
    this.state = 'dead';
    this.health = 0;
    this.rig.anim.death = 0;
    const p = this.curr;
    const world = this.physics.world;
    world.removeRigidBody(this.body);
    // Leiche: Sensor zum Anvisieren ("Ausnehmen"), blockiert nichts.
    this.corpse = world.createCollider(
      RAPIER.ColliderDesc.ball(Math.max(0.25, this.stats.height * 0.45 * this.rig.scale))
        .setTranslation(p.x, p.y + 0.25 * this.rig.scale, p.z)
        .setSensor(true)
        .setCollisionGroups(interactionGroups(CollisionGroup.ANIMAL)),
    );
  }

  /** Entfernt das Tier vollständig aus der Physik. */
  dispose(): void {
    const world = this.physics.world;
    if (this.corpse) world.removeCollider(this.corpse, false);
    else if (!this.isDead) world.removeRigidBody(this.body);
    this.corpse = null;
  }

  updateVisual(dt: number, alpha: number): void {
    if (this.isDead) this.rig.anim.death = Math.min(1, this.rig.anim.death + dt * 2);
    else this.position.lerpVectors(this.prev, this.curr, alpha);
    this.rig.root.position.copy(this.position);
    this.rig.root.quaternion.setFromAxisAngle(UP, this.yaw);
    this.rig.update(dt);
  }
}
