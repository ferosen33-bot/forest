import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../../core/Physics';
import type { NavPoint, NavQuery } from '../../systems/ai/NavGrid';
import type { Structure } from '../../systems/building/BuildingSystem';
import type { GameConfig } from '../../config';
import { EnemyRig } from './EnemyRig';
import { ENEMY_KINDS, type EnemyKind, type EnemyKindDef } from './EnemyKinds';
import { aimBallistic } from '../../utils/ballistics';
import { clamp, damp } from '../../utils/math';

export type EnemyState =
  | 'idle'
  | 'patrol'
  | 'investigate'
  | 'alert'
  | 'chase'
  | 'attack'
  | 'stagger'
  | 'flee'
  | 'breach'
  | 'throw'
  | 'dead';

/** Was ein Gegner über den Spieler wissen darf. */
export interface PlayerTarget {
  position: THREE.Vector3;
  eye: THREE.Vector3;
  collider: RAPIER.Collider;
  isDead: boolean;
  /** Schleicht (geduckt, nicht rennend) – im Rücken erst ganz nah bemerkbar. */
  stealthy: boolean;
  /** Bewegung (für vorausschauendes Zielen beim Steinwurf). */
  velocity: THREE.Vector3;
  receiveHit(amount: number, from: THREE.Vector3): void;
}

/** Vom EnemyDirector bereitgestellte Umgebung. */
export interface EnemyContext {
  time: number;
  physics: Physics;
  nav: NavQuery;
  player: PlayerTarget;
  /** Aktuelle Sichtweite auf den Spieler (Tageszeit, Licht, Ducken). */
  sightRange: number;
  isNight: boolean;
  /** Brennendes Feuer im Umkreis `radius` um `pos` (oder null). */
  fireNear(pos: THREE.Vector3, radius: number): THREE.Vector3 | null;
  structureByCollider(collider: RAPIER.Collider): Structure | undefined;
  damageStructure(s: Structure, amount: number, point: THREE.Vector3): void;
  /** Ruft Artgenossen in der Nähe zur Hilfe. */
  alertAllies(source: Enemy): void;
  others: readonly Enemy[];
  /** Globales Budget: darf in diesem Takt noch ein Pfad geplant werden? */
  allowPathPlan(): boolean;
  sound(id: 'growl' | 'scream' | 'enemyAttack', position: THREE.Vector3): void;
  /** Feuert ein feindliches Wurfgeschoss ab. */
  throwStone(origin: THREE.Vector3, velocity: THREE.Vector3, damage: number): void;
}

/** Dauer eines Wurfs (Ausholen bis Ausschwingen) und Zeitpunkt des Loslassens. */
const THROW_TIME = 0.95;
const RELEASE_AT = 0.55;

const UP = new THREE.Vector3(0, 1, 0);
const STRIKE_AT = 0.6;
const RADIUS = 0.32;
const HEIGHT = 1.8;

/**
 * Ein Schrat: kinematischer Rapier-Körper mit eigenem Character Controller,
 * Wahrnehmung (Sicht + Gehör) und Zustandsautomat.
 *
 * Bewegung läuft im festen Physik-Takt; die Darstellung wird interpoliert.
 */
export class Enemy {
  readonly rig: EnemyRig;
  /** Typ (Schrat, Späher, Koloss) mit seinen Kampf- und Wahrnehmungswerten. */
  readonly kind: EnemyKindDef;
  private readonly walkSpeed: number;
  private readonly runSpeed: number;
  private readonly attackRange: number;
  state: EnemyState = 'idle';
  health: number;
  readonly maxHealth: number;
  yaw = Math.random() * Math.PI * 2;
  /** Fußposition für die Darstellung (interpoliert). */
  readonly position = new THREE.Vector3();
  readonly home: THREE.Vector3;
  /** Wird pausiert, wenn der Spieler weit weg ist. */
  active = true;
  /** Zeit seit dem Tod (Leiche verschwindet danach). */
  deadFor = 0;

  /** Wachsamkeit 0–1: ab 0,4 nachsehen, bei 1 Jagd. */
  suspicion = 0;
  private readonly lastSeen = new THREE.Vector3();
  private lastSeenTime = -Infinity;
  private investigateTarget = new THREE.Vector3();
  private wanderTarget = new THREE.Vector3();
  private timer = 0;
  private attackTime = 0;
  private struck = false;
  private provokedUntil = 0;
  private fled = false;
  private breachTarget: Structure | null = null;
  private trapCooldown = 0;
  private throwCooldown = 1 + Math.random() * 2;
  private growlTimer = 3 + Math.random() * 8;
  private senseTimer = Math.random() * 0.15;

  // Pfad
  private path: NavPoint[] | null = null;
  private pathIndex = 0;
  private readonly pathGoal = new THREE.Vector3(Infinity, 0, 0);
  private repathTimer = 0;
  private pathFailed = false;

  // Physik
  private readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly headCollider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly groups = interactionGroups(CollisionGroup.ENEMY, 0xffff & ~CollisionGroup.ITEM);
  private readonly velocity = new THREE.Vector3();
  private readonly knockback = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private readonly curr = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private desiredSpeed = 0;
  private faceTarget: THREE.Vector3 | null = null;
  private grounded = false;

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(
    readonly id: number,
    private readonly physics: Physics,
    spawn: THREE.Vector3,
    home: THREE.Vector3,
    private readonly cfg: GameConfig['ai'],
    readonly tone: number,
    scale: number,
    kind: EnemyKind = 'schrat',
  ) {
    const def = (this.kind = ENEMY_KINDS[kind]);
    this.rig = new EnemyRig(scale, def.club, def.hunch ?? 0);
    this.home = home.clone();
    // Lebenspunkte nach Typ; die kleine Größenvariation innerhalb des Typs wirkt mit.
    this.maxHealth = this.health = cfg.health * def.health * (scale / def.scale);
    this.walkSpeed = cfg.walkSpeed * def.speed;
    this.runSpeed = cfg.runSpeed * def.speed;
    this.attackRange = cfg.attackRange * def.attackRange;

    const world = physics.world;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + 0.05, spawn.z),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(((HEIGHT / 2 - RADIUS) * scale), RADIUS * scale)
        .setTranslation(0, (HEIGHT / 2) * scale, 0)
        .setCollisionGroups(this.groups),
      this.body,
    );
    // Kopf als Sensor: wird von Waffen-Raycasts getroffen (Kopftreffer), blockiert aber nichts.
    this.headCollider = world.createCollider(
      RAPIER.ColliderDesc.ball(0.17 * scale)
        .setTranslation(0, 1.68 * scale, 0.03)
        .setSensor(true)
        .setCollisionGroups(interactionGroups(CollisionGroup.ENEMY)),
      this.body,
    );
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.45 * Math.max(1, scale), 0.2, false);
    this.controller.enableSnapToGround(0.5);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(52));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(58));

    this.curr.set(spawn.x, spawn.y + 0.05, spawn.z);
    this.prev.copy(this.curr);
    this.position.copy(this.curr);
    this.wanderTarget.copy(home);
    this.timer = Math.random() * 3;
  }

  get isDead(): boolean {
    return this.state === 'dead';
  }

  /** Aktuelle physikalische Fußposition (nicht interpoliert). */
  get feet(): THREE.Vector3 {
    return this.curr;
  }

  get isAggressive(): boolean {
    return (
      this.state === 'chase' || this.state === 'attack' || this.state === 'alert' || this.state === 'breach' || this.state === 'throw'
    );
  }

  /** Hat den Spieler (noch) nicht bemerkt → Schleichangriff möglich. */
  get unaware(): boolean {
    return !this.isDead && !this.isAggressive && this.state !== 'stagger' && this.state !== 'flee' && this.suspicion < 0.6;
  }

  get forward(): THREE.Vector3 {
    return this.tmp2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  // ---------------------------------------------------------------------------
  // Wahrnehmung & Reaktionen (von außen)
  // ---------------------------------------------------------------------------

  /** Ein Geräusch wurde gehört (Sprinten, Holzhacken, Kampf …). */
  hear(position: THREE.Vector3, strength = 0.35): void {
    if (this.isDead || this.isAggressive) return;
    this.suspicion = Math.min(1, this.suspicion + strength * this.kind.hearing);
    this.investigateTarget.copy(position);
    if (this.state !== 'investigate') this.setState('investigate');
  }

  /** Von einem Artgenossen alarmiert. */
  alertedBy(position: THREE.Vector3, ctx: EnemyContext): void {
    if (this.isDead || this.isAggressive) return;
    this.lastSeen.copy(position);
    this.lastSeenTime = ctx.time;
    this.suspicion = 1;
    this.setState('chase');
  }

  /** Schickt den Gegner auf die Jagd zu einem Ort (nächtliche Jagdgruppen). */
  hunt(position: THREE.Vector3): void {
    if (this.isDead || this.isAggressive) return;
    this.investigateTarget.copy(position);
    this.suspicion = Math.max(this.suspicion, 0.5);
    this.setState('investigate');
  }

  /**
   * Schaden durch den Spieler.
   * @returns true, wenn der Gegner dadurch gestorben ist.
   */
  takeDamage(amount: number, from: THREE.Vector3, ctx: EnemyContext): boolean {
    if (this.isDead) return false;
    this.health -= amount;
    this.rig.anim.hit = 1;
    if (this.health <= 0) {
      this.die();
      return true;
    }
    this.provokedUntil = ctx.time + 20;
    this.suspicion = 1;
    this.lastSeen.copy(ctx.player.position);
    this.lastSeenTime = ctx.time;
    // Leichte Treffer bringen schwere Gegner nicht aus dem Tritt – sie greifen einfach weiter an.
    if (amount < this.kind.staggerThreshold) {
      if (!this.isAggressive) this.setState('chase');
      return false;
    }
    // Rückstoß vom Spieler weg, Angriff wird unterbrochen.
    this.knockback.subVectors(this.curr, from).setY(0).normalize().multiplyScalar(4 / this.rig.scale);
    this.setState('stagger');
    this.timer = 0.38;
    return false;
  }

  /** In eine Fallgrube gestürzt: steckt eine Weile fest. */
  stun(seconds: number): void {
    if (this.isDead) return;
    this.knockback.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.rig.anim.attack = -1;
    this.setState('stagger');
    this.timer = seconds;
  }

  /** Fiebernacht: rasend – fürchtet kein Feuer mehr. */
  enrage(): void {
    this.provokedUntil = Infinity;
  }

  /** Setzt den Gegner zurück ins Lager (z. B. nach dem Tod des Spielers). */
  calmDown(): void {
    if (this.isDead) return;
    this.suspicion = 0;
    this.path = null;
    this.setState('patrol');
    this.wanderTarget.copy(this.home);
  }

  teleport(pos: THREE.Vector3): void {
    this.body.setTranslation({ x: pos.x, y: pos.y + 0.05, z: pos.z }, true);
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y + 0.05, z: pos.z });
    this.curr.set(pos.x, pos.y + 0.05, pos.z);
    this.prev.copy(this.curr);
    this.position.copy(this.curr);
    this.path = null;
  }

  // ---------------------------------------------------------------------------
  // Fester Takt: Denken + Bewegen
  // ---------------------------------------------------------------------------

  fixedUpdate(dt: number, ctx: EnemyContext): void {
    if (this.isDead) {
      this.deadFor += dt;
      return;
    }
    this.perceive(dt, ctx);
    this.think(dt, ctx);
    this.move(dt, ctx);
  }

  afterPhysicsStep(): void {
    if (this.isDead) return;
    this.prev.copy(this.curr);
    const t = this.body.translation();
    this.curr.set(t.x, t.y, t.z);
  }

  private perceive(dt: number, ctx: EnemyContext): void {
    this.senseTimer -= dt;
    if (this.senseTimer > 0) return;
    const interval = 0.15;
    this.senseTimer = interval;

    const seen = this.canSee(ctx);
    if (seen) {
      const dist = this.curr.distanceTo(ctx.player.position);
      const closeness = 1 - clamp(dist / (ctx.sightRange * this.kind.sight), 0, 1);
      // Weit entfernt baut sich Misstrauen langsam auf (Schleichen lohnt sich), nah sehr schnell.
      this.suspicion = Math.min(1, this.suspicion + interval * (0.45 + 2.6 * closeness * closeness));
      this.lastSeen.copy(ctx.player.position);
      this.lastSeenTime = ctx.time;
    } else if (!this.isAggressive) {
      this.suspicion = Math.max(0, this.suspicion - interval * 0.12);
    }
  }

  /** Sichtkegel + Sichtlinie (Raycast vom Kopf zum Spieler). */
  private canSee(ctx: EnemyContext): boolean {
    const player = ctx.player;
    if (player.isDead) return false;
    const head = this.tmp.copy(this.curr).add(new THREE.Vector3(0, 1.65 * this.rig.scale, 0));
    const toPlayer = new THREE.Vector3().subVectors(player.eye, head);
    const dist = toPlayer.length();
    if (dist > ctx.sightRange * this.kind.sight) return false;
    toPlayer.divideScalar(dist);
    const fov = Math.cos(THREE.MathUtils.degToRad(this.cfg.fieldOfViewDeg / 2));
    const facing = this.forward.dot(new THREE.Vector3(toPlayer.x, 0, toPlayer.z).normalize());
    // Ganz nah wird man immer bemerkt – außer man schleicht sich von hinten an (Schleichangriff).
    if (facing < fov && dist > (player.stealthy ? 1.2 : 2.5)) return false;

    // Sensoren ignorieren: der Strahl startet im eigenen Kopf-Hitbox-Sensor.
    const hit = this.physics.raycast(head, toPlayer, dist + 0.5, this.collider, true);
    return !hit || hit.collider.handle === player.collider.handle || hit.distance >= dist - 0.3;
  }

  private setState(state: EnemyState): void {
    if (this.state === state) return;
    this.state = state;
    this.path = null;
    if (state !== 'attack') this.rig.anim.attack = -1;
  }

  private seesPlayerNow(ctx: EnemyContext): boolean {
    return ctx.time - this.lastSeenTime < 0.35;
  }

  private think(dt: number, ctx: EnemyContext): void {
    const player = ctx.player;
    this.desiredSpeed = 0;
    this.faceTarget = null;
    this.trapCooldown -= dt;
    this.throwCooldown -= dt;
    this.timer -= dt;
    this.rig.anim.alert = damp(this.rig.anim.alert, this.state === 'alert' ? 1 : 0, 10, dt);

    if (player.isDead && this.isAggressive) this.calmDown();

    // Gelegentliches Knurren in Hörweite.
    this.growlTimer -= dt;
    if (this.growlTimer <= 0) {
      this.growlTimer = 6 + Math.random() * 10;
      if (this.curr.distanceTo(player.position) < 30) ctx.sound('growl', this.curr);
    }

    // Misstrauen wechselt den Zustand.
    if (!this.isAggressive && this.state !== 'stagger' && this.state !== 'flee') {
      if (this.suspicion >= 1) this.startChase(ctx);
      else if (this.suspicion > 0.4 && this.state !== 'investigate' && this.seesPlayerNow(ctx)) {
        this.investigateTarget.copy(this.lastSeen);
        this.setState('investigate');
      }
    }

    switch (this.state) {
      case 'idle':
        if (this.timer <= 0) this.pickWanderTarget(ctx);
        break;

      case 'patrol':
        if (this.moveTo(this.wanderTarget, this.walkSpeed, ctx)) {
          this.setState('idle');
          this.timer = 2 + Math.random() * 5;
        }
        break;

      case 'investigate':
        // Vorsichtig hingehen, dann umsehen.
        if (this.moveTo(this.investigateTarget, 2.6 * this.kind.speed, ctx) || this.pathFailed) {
          if (this.timer <= 0) this.timer = 3.5;
          this.yaw += dt * 1.4 * Math.sin(ctx.time * 1.3);
          if (this.timer < 0.2) {
            this.suspicion = Math.min(this.suspicion, 0.3);
            this.pickWanderTarget(ctx);
          }
        } else {
          this.timer = 0;
        }
        break;

      case 'alert':
        // Kurz schreien, dann losrennen.
        this.faceTarget = this.lastSeen;
        if (this.timer <= 0) this.setState('chase');
        break;

      case 'chase':
        this.updateChase(ctx);
        break;

      case 'attack':
        this.updateAttack(dt, ctx);
        break;

      case 'stagger':
        if (this.timer <= 0) {
          if (!this.fled && this.health < this.maxHealth * 0.3 && Math.random() < 0.5) {
            this.fled = true;
            this.setState('flee');
            this.timer = 7;
          } else {
            this.setState('chase');
          }
        }
        break;

      case 'flee': {
        const away = this.tmp.subVectors(this.curr, player.position).setY(0).normalize().multiplyScalar(25).add(this.curr);
        this.moveTo(away, this.runSpeed, ctx);
        if (this.timer <= 0) this.setState('chase');
        break;
      }

      case 'breach':
        this.updateBreach(dt, ctx);
        break;

      case 'throw':
        this.updateThrow(dt, ctx);
        break;
    }
  }

  private startChase(ctx: EnemyContext): void {
    if (this.isAggressive) return;
    this.suspicion = 1;
    this.setState('alert');
    this.timer = 0.75;
    ctx.sound('scream', this.curr);
    ctx.alertAllies(this);
  }

  private pickWanderTarget(ctx: EnemyContext): void {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 20;
      const x = this.home.x + Math.cos(a) * r;
      const z = this.home.z + Math.sin(a) * r;
      if (ctx.nav.isWalkable(x, z)) {
        this.wanderTarget.set(x, 0, z);
        this.setState('patrol');
        return;
      }
    }
    this.timer = 2;
  }

  private updateChase(ctx: EnemyContext): void {
    const player = ctx.player;
    const seen = this.seesPlayerNow(ctx);
    if (!seen && ctx.time - this.lastSeenTime > 7) {
      // Spur verloren: zum letzten bekannten Ort und dort suchen.
      this.suspicion = 0.6;
      this.investigateTarget.copy(this.lastSeen);
      this.setState('investigate');
      return;
    }
    const target = seen ? player.position : this.lastSeen;
    const dist = this.curr.distanceTo(player.position);

    // Nachts halten Schrate Abstand zu brennenden Feuern – außer sie wurden provoziert.
    const fire = this.kind.fearsFire && ctx.isNight && ctx.time > this.provokedUntil ? ctx.fireNear(player.position, 5.5) : null;
    if (fire) {
      const fromFire = this.curr.distanceTo(fire);
      if (fromFire < 8) {
        const away = this.tmp.subVectors(this.curr, fire).setY(0).normalize().multiplyScalar(10).add(fire);
        this.moveTo(away, this.walkSpeed * 1.5, ctx);
      }
      this.faceTarget = player.position;
      return;
    }

    // Fernkampf: aus mittlerer Distanz Steine werfen, statt heranzustürmen.
    const ranged = this.kind.ranged;
    if (ranged && seen && this.throwCooldown <= 0 && dist >= ranged.minRange && dist <= ranged.maxRange) {
      this.setState('throw');
      this.attackTime = 0;
      this.struck = false;
      return;
    }
    if (seen && dist < this.attackRange) {
      this.setState('attack');
      this.attackTime = 0;
      this.struck = false;
      ctx.sound('enemyAttack', this.curr);
      return;
    }
    this.moveTo(target, this.runSpeed, ctx);
  }

  private updateAttack(dt: number, ctx: EnemyContext): void {
    const player = ctx.player;
    this.attackTime += dt;
    const u = this.attackTime / this.kind.attackTime;
    this.rig.anim.attack = u;
    // Während des Ausholens zum Spieler drehen – danach ist die Richtung festgelegt (ausweichbar!).
    if (u < STRIKE_AT - 0.08) this.faceTarget = player.position;

    if (!this.struck && u >= STRIKE_AT) {
      this.struck = true;
      const to = this.tmp.subVectors(player.position, this.curr).setY(0);
      const dist = to.length();
      const angle = this.forward.angleTo(to.normalize());
      if (dist < this.attackRange + 0.65 * this.rig.scale && angle < THREE.MathUtils.degToRad(70) && !player.isDead) {
        player.receiveHit(this.cfg.attackDamage * this.kind.damage * (0.85 + Math.random() * 0.3), this.curr);
      }
    }
    if (u >= 1) {
      this.rig.anim.attack = -1;
      if (this.kind.hitAndRun) {
        // Späher: nach dem Hieb kurz Abstand gewinnen, dann erneut zustoßen.
        this.setState('flee');
        this.timer = 1.6 + Math.random() * 0.8;
      } else {
        this.setState('chase');
      }
    }
  }

  /** Steinwurf: ausholen (Richtung wird nachgeführt), loslassen, ausschwingen. */
  private updateThrow(dt: number, ctx: EnemyContext): void {
    const ranged = this.kind.ranged!;
    const player = ctx.player;
    this.attackTime += dt;
    const u = this.attackTime / THROW_TIME;
    this.rig.anim.attack = u;
    if (u < RELEASE_AT) this.faceTarget = player.position;
    if (!this.struck && u >= RELEASE_AT) {
      this.struck = true;
      const origin = this.tmp.copy(this.curr).addScaledVector(this.forward, 0.35);
      origin.y += 1.55 * this.rig.scale;
      // Vorhalt: dorthin zielen, wo der Spieler bei Ankunft des Steins sein wird – mit etwas Streuung.
      const flight = origin.distanceTo(player.position) / ranged.speed;
      const target = player.position.clone().addScaledVector(player.velocity, flight * 0.8);
      target.y += 1.1;
      target.x += (Math.random() - 0.5) * 1.2;
      target.z += (Math.random() - 0.5) * 1.2;
      const v = aimBallistic(origin, target, ranged.speed);
      if (v) ctx.throwStone(origin.clone(), v, ranged.damage);
    }
    if (u >= 1) {
      this.rig.anim.attack = -1;
      this.throwCooldown = ranged.cooldown * (0.8 + Math.random() * 0.4);
      this.setState('chase');
    }
  }

  /** Durchbrechen: auf ein Bauwerk einschlagen, das den Weg zum Spieler versperrt. */
  private updateBreach(dt: number, ctx: EnemyContext): void {
    const s = this.breachTarget;
    // Abbruch, wenn das Bauwerk weg ist oder der Spieler wieder auf normalem Weg erreichbar ist.
    if (!s || s.health <= 0 || (this.seesPlayerNow(ctx) && !this.pathFailed)) {
      this.breachTarget = null;
      this.setState('chase');
      return;
    }
    this.faceTarget = s.position;
    this.attackTime += dt;
    const u = this.attackTime / this.kind.attackTime;
    this.rig.anim.attack = u;
    if (!this.struck && u >= STRIKE_AT) {
      this.struck = true;
      ctx.damageStructure(s, this.kind.structureDamage, this.tmp.copy(this.curr).addScaledVector(this.forward, 0.8).setY(this.curr.y + 1));
      // Wer auf Spieße einschlägt, reißt sich selbst auf.
      if (s.def.thorns) this.takeDamage(s.def.thorns * 0.5, s.position, ctx);
    }
    if (u >= 1) {
      this.attackTime = 0;
      this.struck = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Fortbewegung
  // ---------------------------------------------------------------------------

  /**
   * Läuft (mit Pfadsuche) Richtung `goal`.
   * @returns true, wenn das Ziel erreicht ist.
   */
  private moveTo(goal: THREE.Vector3, speed: number, ctx: EnemyContext): boolean {
    const dx = goal.x - this.curr.x;
    const dz = goal.z - this.curr.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.0) return true;
    this.desiredSpeed = speed;

    // Freie Strecke auf kurze Distanz → direkt hinlaufen, ohne A*.
    if (dist < 22 && ctx.nav.lineWalkable({ x: this.curr.x, z: this.curr.z }, { x: goal.x, z: goal.z })) {
      this.desired.set(dx, 0, dz).divideScalar(dist);
      this.path = null;
      this.pathFailed = false;
      return false;
    }

    this.repathTimer -= ctx.physics.world.timestep;
    const goalMoved = this.pathGoal.distanceToSquared(goal) > 4;
    if ((!this.path || (this.repathTimer <= 0 && goalMoved)) && ctx.allowPathPlan()) this.planPath(goal, ctx);

    if (this.path && this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex];
      const wx = wp.x - this.curr.x;
      const wz = wp.z - this.curr.z;
      const wd = Math.hypot(wx, wz);
      if (wd < (speed > 3 ? 1.2 : 0.7)) {
        this.pathIndex++;
        // Etappe erreicht, Ziel aber noch weit (lange Strecken werden stückweise geplant).
        if (this.pathIndex >= this.path.length) this.path = null;
      }
      this.desired.set(wx, 0, wz).divideScalar(Math.max(wd, 0.001));
    } else {
      // Kein Weg: direkt drauf zu (z. B. gegen eine Wand → Durchbrechen).
      this.desired.set(dx, 0, dz).divideScalar(dist);
    }
    return false;
  }

  private planPath(goal: THREE.Vector3, ctx: EnemyContext): void {
    this.pathGoal.copy(goal);
    this.repathTimer = 0.7 + Math.random() * 0.3;
    // Weite Ziele in Etappen von ~50 m planen, damit das Suchbudget reicht.
    let target: NavPoint = { x: goal.x, z: goal.z };
    const d = Math.hypot(goal.x - this.curr.x, goal.z - this.curr.z);
    if (d > 55) {
      const k = 50 / d;
      target = ctx.nav.nearestWalkable(this.curr.x + (goal.x - this.curr.x) * k, this.curr.z + (goal.z - this.curr.z) * k, 8) ?? target;
    }
    this.path = ctx.nav.findPath({ x: this.curr.x, z: this.curr.z }, target, 8000);
    this.pathIndex = 0;
    this.pathFailed = this.path === null;
  }

  private move(dt: number, ctx: EnemyContext): void {
    // Drehen: zur Laufrichtung bzw. zum Blickziel.
    let turnTo: number | null = null;
    if (this.faceTarget) turnTo = Math.atan2(this.faceTarget.x - this.curr.x, this.faceTarget.z - this.curr.z);
    else if (this.desiredSpeed > 0.1) turnTo = Math.atan2(this.desired.x, this.desired.z);
    if (turnTo !== null) {
      let diff = turnTo - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const rate = this.state === 'attack' ? 4 : 7;
      this.yaw += clamp(diff, -rate * dt, rate * dt);
    }

    // Erst ausrichten, dann loslaufen – verhindert seitliches "Gleiten".
    const facing = this.desiredSpeed > 0 ? Math.max(0, this.forward.dot(this.desired)) : 0;
    const targetSpeed = this.desiredSpeed * (0.3 + 0.7 * facing);
    const tvx = this.desired.x * targetSpeed;
    const tvz = this.desired.z * targetSpeed;

    // Abstand zu Artgenossen halten.
    for (const o of ctx.others) {
      if (o === this || o.isDead || !o.active) continue;
      const ox = this.curr.x - o.feet.x;
      const oz = this.curr.z - o.feet.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 1.4 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        this.knockback.x += (ox / d) * (1.2 - d) * 6 * dt;
        this.knockback.z += (oz / d) * (1.2 - d) * 6 * dt;
      }
    }

    const accel = 18 * dt;
    this.velocity.x += clamp(tvx - this.velocity.x, -accel, accel);
    this.velocity.z += clamp(tvz - this.velocity.z, -accel, accel);
    this.velocity.y = this.grounded ? -1 : this.velocity.y - 20 * dt;
    this.knockback.multiplyScalar(Math.exp(-6 * dt));

    const desired = {
      x: (this.velocity.x + this.knockback.x) * dt,
      y: this.velocity.y * dt,
      z: (this.velocity.z + this.knockback.z) * dt,
    };
    this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, this.groups);
    const mv = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    this.handleCollisions(ctx);

    this.body.setNextKinematicTranslation({ x: this.curr.x + mv.x, y: this.curr.y + mv.y, z: this.curr.z + mv.z });
    this.rig.anim.speed = Math.hypot(mv.x, mv.z) / dt;
  }

  /** Kontakte mit Bauwerken: Fallen verletzen, versperrende Wände werden angegriffen. */
  private handleCollisions(ctx: EnemyContext): void {
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const c = this.controller.computedCollision(i);
      if (!c?.collider) continue;
      const s = ctx.structureByCollider(c.collider);
      if (!s) continue;
      if (s.def.thorns && this.trapCooldown <= 0) {
        // Hineingelaufen: Pfähle verletzen, die Falle nutzt sich ab.
        this.trapCooldown = 1.2;
        ctx.damageStructure(s, s.def.id === 'spikeTrap' ? 12 : 4, this.curr.clone().add(new THREE.Vector3(0, 0.5, 0)));
        this.takeDamage(s.def.thorns, s.position, ctx);
        if (this.isDead) return;
      }
      if (s.def.id === 'spikeTrap') {
        continue;
      } else if (this.state === 'chase' && (this.pathFailed || !this.seesPlayerNow(ctx))) {
        this.breachTarget = s;
        this.setState('breach');
        this.attackTime = 0;
        this.struck = false;
      }
    }
  }

  private die(): void {
    this.state = 'dead';
    this.health = 0;
    this.rig.anim.attack = -1;
    this.rig.anim.death = 0;
    this.physics.world.removeRigidBody(this.body);
  }

  /** Physik freigeben (nach dem Verschwinden der Leiche bzw. beim Entfernen). */
  dispose(): void {
    if (!this.isDead) this.physics.world.removeRigidBody(this.body);
  }

  // ---------------------------------------------------------------------------
  // Darstellung (pro Frame)
  // ---------------------------------------------------------------------------

  updateVisual(dt: number, alpha: number, player: THREE.Vector3): void {
    if (this.isDead) {
      this.rig.anim.death = Math.min(1, this.rig.anim.death + dt * 1.4);
      this.rig.anim.speed = 0;
      // Leiche versinkt am Ende langsam im Boden.
      if (this.deadFor > 40) this.position.y -= dt * 0.3;
    } else {
      this.position.lerpVectors(this.prev, this.curr, alpha);
    }
    // Kopf zum Spieler drehen, wenn aufmerksam.
    let look = 0;
    if (this.suspicion > 0.3 && !this.isDead) {
      const a = Math.atan2(player.x - this.position.x, player.z - this.position.z) - this.yaw;
      look = clamp(Math.atan2(Math.sin(a), Math.cos(a)), -1, 1);
    }
    this.rig.anim.lookYaw = damp(this.rig.anim.lookYaw, look, 6, dt);
    this.rig.root.position.copy(this.position);
    this.rig.root.quaternion.setFromAxisAngle(UP, this.yaw);
    this.rig.update(dt);
  }
}
