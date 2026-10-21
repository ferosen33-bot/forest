import * as THREE from 'three';
import type { Physics, RAPIER } from '../../core/Physics';
import type { EventBus } from '../../core/EventBus';
import type { GameConfig } from '../../config';
import type { HeightMap } from '../../world/HeightMap';
import type { Vegetation } from '../../world/Vegetation';
import { isTree } from '../../world/Vegetation';
import type { Player } from '../../entities/Player';
import { Enemy, type EnemyContext, type PlayerTarget } from '../../entities/enemies/Enemy';
import { EnemyRenderer } from '../../entities/enemies/EnemyRenderer';
import { FireEffect } from '../../entities/FireEffect';
import type { BuildingSystem } from '../building/BuildingSystem';
import { getStructure } from '../building/StructureDefs';
import type { Particles } from '../Particles';
import type { LightPool, LightRequest } from '../LightPool';
import type { Audio, SoundId } from '../Audio';
import type { DayNightCycle } from '../DayNightCycle';
import { NavGrid } from './NavGrid';
import { CAMP_OBSTACLES, createCampModel } from './CampModel';
import { deriveSeed, mulberry32 } from '../../utils/random';
import { lerp } from '../../utils/math';

export type HitZone = 'head' | 'body';

export interface EnemySave {
  camp: number;
  p: [number, number, number];
  health: number;
  tone: number;
  scale: number;
}

interface Camp {
  center: THREE.Vector3;
  fire: FireEffect;
  light: LightRequest;
  members: Set<Enemy>;
  respawnTimer: number;
}

export interface DirectorDeps {
  physics: Physics;
  heightMap: HeightMap;
  vegetation: Vegetation;
  building: BuildingSystem;
  player: Player;
  camera: THREE.Camera;
  particles: Particles;
  audio: Audio;
  events: EventBus;
  lights: LightPool;
  dayNight: DayNightCycle;
  config: GameConfig;
  spawnPoint: THREE.Vector3;
  /** Trägt der Spieler gerade eine brennende Fackel? */
  isPlayerLit: () => boolean;
}

const MAX_ENEMIES = 24;
const ALERT_RADIUS = 25;

/**
 * Regie über alle Schrate: Lager, Spawns, Wahrnehmungs-Kontext, Geräusche,
 * nächtliche Jagdgruppen, Treffer durch den Spieler und Leistungs-LOD.
 */
export class EnemyDirector {
  readonly group = new THREE.Group();
  readonly nav: NavGrid;
  readonly enemies: Enemy[] = [];
  readonly camps: Camp[] = [];

  private readonly renderer = new EnemyRenderer(MAX_ENEMIES);
  private readonly byCollider = new Map<number, { enemy: Enemy; zone: HitZone }>();
  private readonly ctx: EnemyContext;
  private readonly cfg: GameConfig['ai'];
  private readonly rng: () => number;
  private nextId = 1;
  private readonly stepCounts = new WeakMap<Enemy, number>();
  /** Wird bei jedem Schritt eines Gegners in Hörweite aufgerufen. */
  onEnemyStep: ((position: THREE.Vector3, speed: number) => void) | null = null;
  private noiseTimer = 0;
  /** A*-Anfragen im aktuellen Takt (Budget gegen Lastspitzen). */
  private pathPlansThisTick = 0;
  private huntTimer = 40;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly d: DirectorDeps) {
    this.cfg = d.config.ai;
    this.rng = mulberry32(deriveSeed(d.config.seed, 'enemies'));
    this.group.name = 'EnemyDirector';
    this.group.add(this.renderer.group);

    this.nav = new NavGrid(d.heightMap);
    this.markVegetation();
    d.events.on('structure:placed', ({ id, position, rotation }) => this.markStructure(id, position, rotation, 1));
    d.events.on('structure:removed', ({ id, position, rotation }) => this.markStructure(id, position, rotation, -1));
    d.events.on('noise', ({ position, radius }) => this.propagateNoise(position, radius, 0.55));

    const player = d.player;
    const target: PlayerTarget = {
      get position() {
        return player.position;
      },
      get eye() {
        return d.camera.position;
      },
      get collider() {
        return player.collisionShape;
      },
      get isDead() {
        return player.stats.isDead;
      },
      receiveHit: (amount, from) => {
        player.receiveHit(amount, from);
        d.audio.play('hurt');
      },
    };

    this.ctx = {
      time: 0,
      physics: d.physics,
      nav: this.nav,
      player: target,
      sightRange: this.cfg.sightDay,
      isNight: false,
      fireNear: (pos, radius) => {
        for (const s of d.building.structures) if (s.lit && s.position.distanceTo(pos) < radius) return s.position;
        return null;
      },
      structureByCollider: (c) => d.building.getByCollider(c),
      damageStructure: (s, amount, point) => d.building.damage(s, amount, point, new THREE.Vector3(0, 1, 0), false),
      alertAllies: (source) => {
        for (const e of this.enemies) {
          if (e !== source && e.feet.distanceTo(source.feet) < ALERT_RADIUS) e.alertedBy(player.position, this.ctx);
        }
      },
      others: this.enemies,
      allowPathPlan: () => this.pathPlansThisTick++ < 2,
      sound: (id, pos) => this.playAt(id, pos),
    };

    this.createCamps();
  }

  // ---------------------------------------------------------------------------
  // Aufbau
  // ---------------------------------------------------------------------------

  /** Baumstämme und Felsen sind Hindernisse für die Wegfindung. */
  private markVegetation(): void {
    for (const v of this.d.vegetation.instances) {
      if (!v.alive) continue;
      if (isTree(v.kind)) this.nav.markCircle(v.position.x, v.position.z, 0.35 * v.scale.x, 1);
      else if (v.kind === 'rock') this.nav.markCircle(v.position.x, v.position.z, ((v.scale.x + v.scale.z) / 2) * 0.95, 1);
    }
  }

  private markStructure(id: Parameters<typeof getStructure>[0], pos: THREE.Vector3, rotation: number, delta: 1 | -1): void {
    const he = getStructure(id).halfExtents;
    this.nav.markBox(pos.x, pos.z, rotation, he.x, he.z, delta);
  }

  /** Lager deterministisch auf flachem, trockenem Land weit weg vom Spawn verteilen. */
  private createCamps(): void {
    const hm = this.d.heightMap;
    const n: [number, number, number] = [0, 1, 0];
    for (let attempt = 0; attempt < 4000 && this.camps.length < this.cfg.camps; attempt++) {
      const x = (this.rng() - 0.5) * hm.size * 0.8;
      const z = (this.rng() - 0.5) * hm.size * 0.8;
      const h = hm.heightAt(x, z);
      if (h < 4 || h > 30 || hm.normalAt(x, z, n)[1] < 0.985) continue;
      const c = new THREE.Vector3(x, h, z);
      if (c.distanceTo(this.d.spawnPoint) < this.cfg.campMinDistance) continue;
      if (this.camps.some((o) => o.center.distanceTo(c) < 140)) continue;
      // Rund ums Lager muss genug begehbarer Platz sein.
      let free = 0;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        if (this.nav.isWalkable(x + Math.cos(a) * 8, z + Math.sin(a) * 8)) free++;
      }
      if (free < 13) continue;
      this.addCamp(c);
    }
  }

  private addCamp(center: THREE.Vector3): void {
    // Bäume im Lager entfernen (Lichtung).
    for (const v of this.d.vegetation.instances) {
      if (v.alive && v.position.distanceTo(center) < 7.5 && v.kind !== 'stick' && v.kind !== 'pebble') {
        if (isTree(v.kind)) this.nav.markCircle(v.position.x, v.position.z, 0.35 * v.scale.x, -1);
        else if (v.kind === 'rock') this.nav.markCircle(v.position.x, v.position.z, ((v.scale.x + v.scale.z) / 2) * 0.95, -1);
        this.d.vegetation.remove(v);
      }
    }
    const model = createCampModel();
    model.position.copy(center);
    this.group.add(model);
    for (const o of CAMP_OBSTACLES) this.nav.markCircle(center.x + o.x, center.z + o.z, o.r, 1);

    const fire = new FireEffect(0.7);
    fire.object.position.copy(center);
    this.group.add(fire.object);
    const camp: Camp = {
      center,
      fire,
      light: { position: center.clone().add(new THREE.Vector3(0, 0.8, 0)), color: new THREE.Color(0xff7a30), intensity: 0, distance: 28 },
      members: new Set(),
      respawnTimer: 0,
    };
    this.camps.push(camp);
    for (let i = 0; i < this.cfg.perCamp; i++) this.spawnAt(camp);
  }

  private spawnAt(camp: Camp): Enemy | null {
    if (this.enemies.length >= MAX_ENEMIES) return null;
    for (let i = 0; i < 10; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = 2.5 + this.rng() * 4;
      const x = camp.center.x + Math.cos(a) * r;
      const z = camp.center.z + Math.sin(a) * r;
      if (!this.nav.isWalkable(x, z)) continue;
      const pos = new THREE.Vector3(x, this.d.heightMap.heightAt(x, z), z);
      const enemy = new Enemy(
        this.nextId++,
        this.d.physics,
        pos,
        camp.center,
        this.cfg,
        Math.floor(this.rng() * 4),
        0.92 + this.rng() * 0.16,
      );
      this.enemies.push(enemy);
      camp.members.add(enemy);
      this.byCollider.set(enemy.collider.handle, { enemy, zone: 'body' });
      this.byCollider.set(enemy.headCollider.handle, { enemy, zone: 'head' });
      return enemy;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Kampf
  // ---------------------------------------------------------------------------

  getHitTarget(collider: RAPIER.Collider): { enemy: Enemy; zone: HitZone } | undefined {
    return this.byCollider.get(collider.handle);
  }

  /** Treffer durch eine Waffe des Spielers. */
  damage(enemy: Enemy, amount: number, zone: HitZone, from: THREE.Vector3, point: THREE.Vector3, normal: THREE.Vector3): void {
    if (enemy.isDead) return;
    const headshot = zone === 'head';
    const wasAggressive = enemy.isAggressive;
    const killed = enemy.takeDamage(amount * (headshot ? this.cfg.headshotMultiplier : 1), from, this.ctx);

    this.d.particles.burst(point, { count: headshot ? 16 : 10, color: 0x5c0f10, direction: normal, speed: 3, size: 0.035 });
    this.d.audio.play('fleshHit');
    this.d.events.emit('tool:hit', { target: 'creature' });
    this.d.events.emit('enemy:hit', { health: Math.max(0, enemy.health), maxHealth: enemy.maxHealth, killed, headshot });
    this.propagateNoise(point, 15, 0.6);

    if (killed) {
      this.byCollider.delete(enemy.collider.handle);
      this.byCollider.delete(enemy.headCollider.handle);
      this.playAt('enemyDeath', enemy.feet);
    } else if (!wasAggressive) {
      this.ctx.alertAllies(enemy);
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /** Fester Physik-Takt: Wahrnehmung, Entscheidungen, Bewegung. */
  fixedUpdate(dt: number): void {
    this.ctx.time += dt;
    this.pathPlansThisTick = 0;
    // Tote erhalten den Takt weiter (Leichen-Timer), pausierte Gegner nicht.
    for (const e of this.enemies) if (e.active || e.isDead) e.fixedUpdate(dt, this.ctx);
  }

  afterPhysicsStep(): void {
    for (const e of this.enemies) if (e.active) e.afterPhysicsStep();
  }

  update(dt: number, alpha: number): void {
    const d = this.d;
    const player = d.player;
    const night = d.dayNight.daylight < 0.5;
    this.ctx.isNight = d.dayNight.isNight;

    // Sichtweite: tagsüber weit, nachts kurz – außer der Spieler trägt Licht oder steht am Feuer.
    let range = lerp(this.cfg.sightNight, this.cfg.sightDay, d.dayNight.daylight);
    if (night && (d.isPlayerLit() || d.building.isNearLitFire(player.position, 6))) range = Math.max(range, this.cfg.sightLit);
    this.ctx.sightRange = range * player.visibility;

    // Schritte des Spielers sind hörbar.
    this.noiseTimer -= dt;
    if (this.noiseTimer <= 0) {
      this.noiseTimer = 0.3;
      const r = player.noiseRadius;
      if (r > 0) this.propagateNoise(player.position, r, player.sprinting ? 0.4 : 0.18);
    }

    this.updateHunts(dt, night);
    this.updateCamps(dt);

    // LOD, Leichen, Darstellung
    const visible: { rig: Enemy['rig']; tone: number }[] = [];
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dist = e.feet.distanceTo(player.position);
      e.active = !e.isDead && (dist < this.cfg.activeRadius || e.isAggressive || e.state === 'investigate');
      if (e.isDead && e.deadFor > 48) {
        this.removeEnemy(i);
        continue;
      }
      if (dist < 220) {
        e.updateVisual(dt, alpha, player.position);
        // Schritte hörbar machen (nur in der Nähe – leise genug, um Schleichende zu verraten).
        if (e.rig.steps !== (this.stepCounts.get(e) ?? 0)) {
          this.stepCounts.set(e, e.rig.steps);
          if (dist < 35) this.onEnemyStep?.(e.position, e.rig.anim.speed);
        }
        visible.push({ rig: e.rig, tone: e.tone });
      }
    }
    this.renderer.render(visible);
  }

  private updateCamps(dt: number): void {
    const player = this.d.player.position;
    for (const camp of this.camps) {
      const dist = camp.center.distanceTo(player);
      if (dist < 200) {
        camp.fire.update(dt);
        camp.light.intensity = 36 * camp.fire.flicker;
        this.d.lights.request(camp.light);
      }
      // Gefallene Mitglieder werden ersetzt, wenn der Spieler weit genug weg ist.
      for (const m of camp.members) if (!this.enemies.includes(m)) camp.members.delete(m);
      const alive = [...camp.members].filter((m) => !m.isDead).length;
      if (alive < this.cfg.perCamp) {
        camp.respawnTimer += dt;
        if (camp.respawnTimer > this.cfg.respawnTime && dist > 90) {
          camp.respawnTimer = 0;
          this.spawnAt(camp);
        }
      } else {
        camp.respawnTimer = 0;
      }
    }
  }

  /** Nachts schickt das nächstgelegene Lager regelmäßig eine Jagdgruppe zum Spieler. */
  private updateHunts(dt: number, night: boolean): void {
    if (!night || this.d.player.stats.isDead) {
      this.huntTimer = Math.max(this.huntTimer, 30);
      return;
    }
    this.huntTimer -= dt;
    if (this.huntTimer > 0) return;
    this.huntTimer = 100 + this.rng() * 60;

    const player = this.d.player.position;
    const camp = this.camps
      .filter((c) => c.center.distanceTo(player) < 280)
      .sort((a, b) => a.center.distanceTo(player) - b.center.distanceTo(player))[0];
    if (!camp) return;
    let sent = 0;
    for (const m of camp.members) {
      if (sent >= 2 || m.isDead || m.isAggressive) continue;
      const offset = new THREE.Vector3((this.rng() - 0.5) * 16, 0, (this.rng() - 0.5) * 16);
      m.active = true;
      m.hunt(player.clone().add(offset));
      sent++;
    }
    if (sent > 0) this.d.events.emit('hud:message', { text: 'In der Ferne ertönt ein Schrei …' });
  }

  private propagateNoise(position: THREE.Vector3, radius: number, strength: number): void {
    for (const e of this.enemies) {
      if (!e.isDead && e.feet.distanceTo(position) < radius) e.hear(position, strength);
    }
  }

  private removeEnemy(index: number): void {
    const e = this.enemies[index];
    this.enemies.splice(index, 1);
    e.dispose();
    this.byCollider.delete(e.collider.handle);
    this.byCollider.delete(e.headCollider.handle);
  }

  /** Spielstand: lebende Schrate mit Lager-Zugehörigkeit (Leichen und Jagdzustand entfallen). */
  serialize(): EnemySave[] {
    const out: EnemySave[] = [];
    for (const e of this.enemies) {
      if (e.isDead) continue;
      const camp = this.camps.findIndex((c) => c.members.has(e));
      const f = e.feet;
      out.push({ camp, p: [f.x, f.y, f.z], health: e.health, tone: e.tone, scale: e.rig.scale });
    }
    return out;
  }

  /** Ersetzt alle Schrate durch die gespeicherten. */
  load(list: EnemySave[]): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) this.removeEnemy(i);
    for (const c of this.camps) c.members.clear();
    for (const d of list) {
      const camp = this.camps[d.camp];
      if (!camp || this.enemies.length >= MAX_ENEMIES) continue;
      const enemy = new Enemy(this.nextId++, this.d.physics, new THREE.Vector3(...d.p), camp.center, this.cfg, d.tone, d.scale);
      enemy.health = Math.min(enemy.maxHealth, d.health);
      this.enemies.push(enemy);
      camp.members.add(enemy);
      this.byCollider.set(enemy.collider.handle, { enemy, zone: 'body' });
      this.byCollider.set(enemy.headCollider.handle, { enemy, zone: 'head' });
    }
  }

  /** Nach dem Tod des Spielers: alle beruhigen; wer am Aufwachpunkt lauert, geht nach Hause. */
  onPlayerRespawn(respawn: THREE.Vector3): void {
    for (const e of this.enemies) {
      if (e.isDead) continue;
      e.calmDown();
      if (e.feet.distanceTo(respawn) < 70) {
        const h = this.d.heightMap.heightAt(e.home.x + 3, e.home.z + 3);
        e.teleport(this.tmp.set(e.home.x + 3, h, e.home.z + 3));
      }
    }
  }

  /** Spielt einen Sound räumlich an der Kopfhöhe des Gegners (3D-Ortung über HRTF). */
  private playAt(id: SoundId, pos: THREE.Vector3): void {
    if (pos.distanceTo(this.d.player.position) > 80) return;
    this.d.audio.play(id, { position: this.tmp.copy(pos).add(new THREE.Vector3(0, 1.5, 0)) });
  }

  /** Aktuelle Sichtweite der Gegner auf den Spieler (m). */
  get sightRange(): number {
    return this.ctx.sightRange;
  }

  get aliveCount(): number {
    return this.enemies.filter((e) => !e.isDead).length;
  }

  get aggressiveCount(): number {
    return this.enemies.filter((e) => e.isAggressive).length;
  }
}
