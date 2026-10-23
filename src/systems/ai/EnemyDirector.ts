import * as THREE from 'three';
import type { Physics, RAPIER } from '../../core/Physics';
import type { EventBus } from '../../core/EventBus';
import type { GameConfig } from '../../config';
import type { HeightMap } from '../../world/HeightMap';
import type { Vegetation } from '../../world/Vegetation';
import { isTree } from '../../world/Vegetation';
import type { Player } from '../../entities/Player';
import { Enemy, type EnemyContext, type PlayerTarget } from '../../entities/enemies/Enemy';
import { ENEMY_KINDS, isEnemyKind, SNEAK_MULTIPLIER, type EnemyKind } from '../../entities/enemies/EnemyKinds';
import { EnemyRenderer } from '../../entities/enemies/EnemyRenderer';
import { FireEffect } from '../../entities/FireEffect';
import type { BuildingSystem } from '../building/BuildingSystem';
import { getStructure } from '../building/StructureDefs';
import type { Particles } from '../Particles';
import type { LightPool, LightRequest } from '../LightPool';
import type { Audio, SoundId } from '../Audio';
import type { DayNightCycle } from '../DayNightCycle';
import { NavGrid, type NavQuery } from './NavGrid';
import { CAMP_OBSTACLES, createCampModel } from './CampModel';
import { deriveSeed, mulberry32 } from '../../utils/random';
import { lerp } from '../../utils/math';

export type HitZone = 'head' | 'body';

/** Startplatz eines Höhlenbewohners (`slot` = fester Platz in der Höhle, für Tod und Wiederkehr). */
export interface CaveSpawn {
  slot: number;
  position: THREE.Vector3;
  home: THREE.Vector3;
}

/** Bewohner der Höhle, in der sich der Spieler gerade befindet. */
interface CavePopulation {
  index: number;
  enemies: Enemy[];
  slots: Map<Enemy, number>;
  ctx: EnemyContext;
}

export interface EnemySave {
  camp: number;
  /** Seit Meilenstein 11 (fehlt in älteren Ständen → Schrat). */
  kind?: EnemyKind;
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
  /** Soll-Besetzung (Typen); Gefallene werden durch denselben Typ ersetzt. */
  roster: EnemyKind[];
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
  /** Regenstärke 0..1: schränkt Sicht und Gehör der Schrate ein. */
  rain: () => number;
  /** Spieler ist in einer Höhle (für Schrate draußen unauffindbar). */
  playerHidden: () => boolean;
  /** Spieler hält eine brennende Fackel (Kriecher scheuen nur Feuer, kein Lampenlicht). */
  isPlayerFire: () => boolean;
  /** Die verlassene Stadt: Plünderer haben sich auf dem Marktplatz eingerichtet. */
  town?: { center: THREE.Vector3; radius: number; plaza: THREE.Vector3 } | null;
  /** Das Lager der Überlebenden: kein Schratlager in der Nähe, sein Feuer schreckt sie ab. */
  harbor?: { center: THREE.Vector3; radius: number } | null;
}

const MAX_ENEMIES = 24;
/** Zusätzliche Horden-Schrate in der Fiebernacht (gleichzeitig). */
const MAX_HORDE = 14;

/**
 * Regie über alle Schrate: Lager, Spawns, Wahrnehmungs-Kontext, Geräusche,
 * nächtliche Jagdgruppen, Treffer durch den Spieler und Leistungs-LOD.
 */
export class EnemyDirector {
  readonly group = new THREE.Group();
  readonly nav: NavGrid;
  readonly enemies: Enemy[] = [];
  readonly camps: Camp[] = [];

  private readonly renderer = new EnemyRenderer(MAX_ENEMIES + MAX_HORDE + 8);
  private readonly byCollider = new Map<number, { enemy: Enemy; zone: HitZone }>();
  private readonly ctx: EnemyContext;
  private readonly cfg: GameConfig['ai'];
  private readonly rng: () => number;
  private nextId = 1;
  private readonly stepCounts = new WeakMap<Enemy, number>();
  /** Feindliche Würfe (vom Spiel an das Geschoss-System angebunden). */
  onThrow: ((origin: THREE.Vector3, velocity: THREE.Vector3, damage: number) => void) | null = null;
  /** Wird bei jedem Schritt eines Gegners in Hörweite aufgerufen. */
  onEnemyStep: ((position: THREE.Vector3, speed: number) => void) | null = null;
  private noiseTimer = 0;
  /** A*-Anfragen im aktuellen Takt (Budget gegen Lastspitzen). */
  private pathPlansThisTick = 0;
  private huntTimer = 40;
  private readonly tmp = new THREE.Vector3();
  private cave: CavePopulation | null = null;
  /** Fiebernacht: Horden-Schrate (gehören zu keinem Lager, werden nicht gespeichert). */
  private readonly horde = new Set<Enemy>();
  private hordeActive = false;
  private hordeTimer = 0;
  private hordeEndedFor = 0;
  /** Ein Horden-Schrat ist gefallen (Beute). */
  onHordeKill: ((position: THREE.Vector3) => void) | null = null;
  private caveNoiseTimer = 0;
  /** Ein Höhlenbewohner ist gestorben (für die Wiederkehr nach einigen Tagen). */
  onCaveDwellerKilled: ((cave: number, slot: number) => void) | null = null;

  constructor(private readonly d: DirectorDeps) {
    this.cfg = d.config.ai;
    this.rng = mulberry32(deriveSeed(d.config.seed, 'enemies'));
    this.group.name = 'EnemyDirector';
    this.group.add(this.renderer.group);

    this.nav = new NavGrid(d.heightMap);
    this.markVegetation();
    d.events.on('structure:placed', ({ id, position, rotation }) => this.markStructure(id, position, rotation, 1));
    d.events.on('structure:removed', ({ id, position, rotation }) => this.markStructure(id, position, rotation, -1));
    // Offenes Tor = Durchgang
    d.events.on('structure:door', ({ id, position, rotation, open }) => {
      this.markStructure(id, position, rotation, open ? -1 : 1);
      const he = getStructure(id).halfExtents;
      this.nav.markPassage(position.x, position.z, rotation, he.x - 0.25, he.z, open ? 1 : -1);
    });
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
      // In einer Höhle ist der Spieler für die Schrate draußen verschwunden.
      get isDead() {
        return player.stats.isDead || d.playerHidden();
      },
      get stealthy() {
        return player.crouching && !player.sprinting;
      },
      get velocity() {
        return player.velocity;
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
        if (d.harbor && d.harbor.center.distanceTo(pos) < radius) return d.harbor.center;
        return null;
      },
      structureByCollider: (c) => d.building.getByCollider(c),
      damageStructure: (s, amount, point) => d.building.damage(s, amount, point, new THREE.Vector3(0, 1, 0), false),
      alertAllies: (source) => {
        for (const e of this.enemies) {
          // Der Warnschrei eines Spähers trägt doppelt so weit.
        if (e !== source && e.feet.distanceTo(source.feet) < source.kind.alertRadius) e.alertedBy(player.position, this.ctx);
        }
      },
      others: this.enemies,
      allowPathPlan: () => this.pathPlansThisTick++ < 2,
      sound: (id, pos) => this.playAt(id, pos),
      throwStone: (origin, velocity, damage) => this.onThrow?.(origin, velocity, damage),
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
    const def = getStructure(id);
    // Böden, Treppen und Bodenfallen sind begehbar – kein Hindernis für die Wegfindung.
    if (def.walkable) return;
    const he = def.halfExtents;
    this.nav.markBox(pos.x, pos.z, rotation, he.x, he.z, delta);
  }

  /** Lager deterministisch auf flachem, trockenem Land weit weg vom Spawn verteilen. */
  private createCamps(): void {
    const hm = this.d.heightMap;
    const town = this.d.town;
    // Das Lager der Plünderer in der Stadt ist größer als die im Wald.
    if (town) this.addCamp(town.plaza.clone(), ['schrat', 'spaeher', 'schrat', 'spaeher', 'koloss']);
    const n: [number, number, number] = [0, 1, 0];
    for (let attempt = 0; attempt < 4000 && this.camps.length < this.cfg.camps + (town ? 1 : 0); attempt++) {
      const x = (this.rng() - 0.5) * hm.size * 0.8;
      const z = (this.rng() - 0.5) * hm.size * 0.8;
      const h = hm.heightAt(x, z);
      if (h < 4 || h > 30 || hm.normalAt(x, z, n)[1] < 0.985) continue;
      const c = new THREE.Vector3(x, h, z);
      if (c.distanceTo(this.d.spawnPoint) < this.cfg.campMinDistance) continue;
      if (town && Math.hypot(x - town.center.x, z - town.center.z) < town.radius + 80) continue;
      if (this.d.harbor && Math.hypot(x - this.d.harbor.center.x, z - this.d.harbor.center.z) < this.d.harbor.radius + 120) continue;
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

  private addCamp(center: THREE.Vector3, roster?: EnemyKind[]): void {
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
      roster: roster ?? this.rosterFor(this.camps.length),
      respawnTimer: 0,
    };
    this.camps.push(camp);
    for (let i = 0; i < (roster ? roster.length : this.cfg.perCamp); i++) this.spawnAt(camp);
  }

  /** Gemischte Besetzung: jedes Lager hat einen Späher, jedes zweite einen Koloss. */
  private rosterFor(index: number): EnemyKind[] {
    const base: EnemyKind[] = index % 2 === 1 ? ['koloss', 'spaeher'] : ['spaeher'];
    while (base.length < this.cfg.perCamp) base.push('schrat');
    return base.slice(0, this.cfg.perCamp);
  }

  /** Typ, der in der Lagerbesetzung gerade fehlt. */
  private missingKind(camp: Camp): EnemyKind {
    const present = [...camp.members].filter((m) => !m.isDead).map((m) => m.kind.kind);
    for (const k of camp.roster) {
      const i = present.indexOf(k);
      if (i < 0) return k;
      present.splice(i, 1);
    }
    return 'schrat';
  }

  private spawnAt(camp: Camp, kind = this.missingKind(camp)): Enemy | null {
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
        ENEMY_KINDS[kind].scale * (0.92 + this.rng() * 0.16),
        kind,
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

  /** Kontext, in dem ein Gegner denkt (Oberfläche oder Höhle). */
  private ctxFor(enemy: Enemy): EnemyContext {
    return this.cave?.slots.has(enemy) ? this.cave.ctx : this.ctx;
  }

  // ---------------------------------------------------------------------------
  // Höhlen
  // ---------------------------------------------------------------------------

  /**
   * Der Spieler betritt eine Höhle: Ihre Bewohner erscheinen und nutzen die Wegfindung der Höhle.
   * Sie sind fast blind (kurze Sicht), hören aber gut – und scheuen den Schein einer Fackel.
   */
  enterCave(index: number, nav: NavQuery, spawns: CaveSpawn[]): void {
    this.leaveCave();
    const d = this.d;
    const player = d.player;
    const enemies: Enemy[] = [];
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
      get stealthy() {
        return player.crouching && !player.sprinting;
      },
      get velocity() {
        return player.velocity;
      },
      receiveHit: (amount, from) => {
        player.receiveHit(amount, from);
        d.audio.play('hurt');
      },
    };
    const ctx: EnemyContext = {
      ...this.ctx,
      time: this.ctx.time,
      nav,
      player: target,
      isNight: true,
      // Die einzige Flamme unter Tage ist die Fackel des Spielers.
      fireNear: (pos, radius) => (d.isPlayerFire() && pos.distanceTo(player.position) < radius ? player.position : null),
      structureByCollider: () => undefined,
      damageStructure: () => {},
      alertAllies: (source) => {
        for (const e of enemies) if (e !== source && e.feet.distanceTo(source.feet) < source.kind.alertRadius) e.alertedBy(player.position, ctx);
      },
      others: enemies,
    };
    const pop: CavePopulation = { index, enemies, slots: new Map(), ctx };
    for (const s of spawns) {
      const kind: EnemyKind = 'kriecher';
      const enemy = new Enemy(this.nextId++, d.physics, s.position, s.home, this.cfg, Math.floor(this.rng() * 3), ENEMY_KINDS[kind].scale * (0.92 + this.rng() * 0.16), kind);
      enemies.push(enemy);
      pop.slots.set(enemy, s.slot);
      this.byCollider.set(enemy.collider.handle, { enemy, zone: 'body' });
      this.byCollider.set(enemy.headCollider.handle, { enemy, zone: 'head' });
    }
    this.cave = pop;
  }

  /** Höhle verlassen: Bewohner verschwinden (tote bleiben tot, bis die Höhle sie ersetzt). */
  leaveCave(): void {
    const pop = this.cave;
    if (!pop) return;
    for (const e of pop.enemies) {
      e.dispose();
      this.byCollider.delete(e.collider.handle);
      this.byCollider.delete(e.headCollider.handle);
    }
    this.cave = null;
  }

  // ---------------------------------------------------------------------------
  // Fiebernacht
  // ---------------------------------------------------------------------------

  /** Horden ab jetzt rasend auf den Spieler hetzen (Wellen schickt das Spiel mit `spawnHorde`). */
  startHorde(): void {
    this.hordeActive = true;
    this.hordeEndedFor = 0;
  }

  /** Morgengrauen: Überlebende ziehen sich zurück und verschwinden außer Sicht. */
  endHorde(): void {
    this.hordeActive = false;
    this.hordeEndedFor = 0;
    for (const e of this.horde) e.calmDown();
  }

  get hordeCount(): number {
    let n = 0;
    for (const e of this.horde) if (!e.isDead) n++;
    return n;
  }

  /**
   * Eine Welle: `count` Schrate erscheinen 40–65 m um `around` (auf begehbarem Grund) und jagen los.
   * Ab der zweiten Fiebernacht sind auch Kolosse dabei. @returns Anzahl erschienener.
   */
  spawnHorde(count: number, around: THREE.Vector3, fever: number): number {
    let spawned = 0;
    for (let n = 0; n < count && this.hordeCount < MAX_HORDE; n++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const a = this.rng() * Math.PI * 2;
        const r = 40 + this.rng() * 25;
        const x = around.x + Math.cos(a) * r;
        const z = around.z + Math.sin(a) * r;
        if (!this.nav.isWalkable(x, z)) continue;
        const roll = this.rng();
        const kind: EnemyKind = fever >= 2 && roll < 0.12 ? 'koloss' : roll < 0.4 ? 'spaeher' : 'schrat';
        const pos = new THREE.Vector3(x, this.d.heightMap.heightAt(x, z), z);
        const enemy = new Enemy(this.nextId++, this.d.physics, pos, around.clone(), this.cfg, Math.floor(this.rng() * 4), ENEMY_KINDS[kind].scale * (0.92 + this.rng() * 0.16), kind);
        enemy.enrage();
        enemy.alertedBy(this.d.player.position, this.ctx);
        this.enemies.push(enemy);
        this.horde.add(enemy);
        this.byCollider.set(enemy.collider.handle, { enemy, zone: 'body' });
        this.byCollider.set(enemy.headCollider.handle, { enemy, zone: 'head' });
        spawned++;
        break;
      }
    }
    if (spawned > 0) for (let i = 0; i < 3; i++) this.playAt('scream', new THREE.Vector3(around.x + (this.rng() - 0.5) * 60, around.y, around.z + (this.rng() - 0.5) * 60));
    return spawned;
  }

  // ---------------------------------------------------------------------------
  // Zufallsereignisse
  // ---------------------------------------------------------------------------

  /** Gruppe ohne Lager an einem Ort (z. B. Ritual); wird nicht gespeichert. */
  spawnGroup(center: THREE.Vector3, kinds: EnemyKind[]): Enemy[] {
    const out: Enemy[] = [];
    for (const kind of kinds) {
      if (this.enemies.length >= MAX_ENEMIES + MAX_HORDE) break;
      for (let attempt = 0; attempt < 12; attempt++) {
        const a = this.rng() * Math.PI * 2;
        const r = 3 + this.rng() * 4;
        const x = center.x + Math.cos(a) * r;
        const z = center.z + Math.sin(a) * r;
        if (!this.nav.isWalkable(x, z)) continue;
        const pos = new THREE.Vector3(x, this.d.heightMap.heightAt(x, z), z);
        const enemy = new Enemy(this.nextId++, this.d.physics, pos, center.clone(), this.cfg, Math.floor(this.rng() * 4), ENEMY_KINDS[kind].scale * (0.92 + this.rng() * 0.16), kind);
        this.enemies.push(enemy);
        this.byCollider.set(enemy.collider.handle, { enemy, zone: 'body' });
        this.byCollider.set(enemy.headCollider.handle, { enemy, zone: 'head' });
        out.push(enemy);
        break;
      }
    }
    return out;
  }

  /** Entfernt Gegner einer Gruppe, die weit genug vom Spieler weg sind (Leichen bleiben liegen). @returns verbliebene. */
  despawnGroup(group: Enemy[], minDistance: number): Enemy[] {
    return group.filter((e) => {
      if (!this.enemies.includes(e)) return false;
      if (e.isDead || e.feet.distanceTo(this.d.player.position) < minDistance) return true;
      this.removeEnemy(this.enemies.indexOf(e));
      return false;
    });
  }

  /** Das nächste Lager (bis 450 m) schickt bis zu `count` ruhige Mitglieder, um nachzusehen. */
  sendGroupTo(position: THREE.Vector3, count: number): number {
    const camp = this.camps
      .filter((c) => c.center.distanceTo(position) < 450)
      .sort((a, b) => a.center.distanceTo(position) - b.center.distanceTo(position))[0];
    if (!camp) return 0;
    let sent = 0;
    for (const m of camp.members) {
      if (sent >= count || m.isDead || m.isAggressive) continue;
      m.active = true;
      m.hunt(position.clone().add(new THREE.Vector3((this.rng() - 0.5) * 8, 0, (this.rng() - 0.5) * 8)));
      sent++;
    }
    return sent;
  }

  /** Horden-Schrate verlieren nie die Witterung (außer der Spieler ist in einer Höhle). */
  private updateHorde(dt: number): void {
    if (this.horde.size === 0) return;
    const player = this.d.player.position;
    this.hordeTimer -= dt;
    if (!this.hordeActive) this.hordeEndedFor += dt;
    const tick = this.hordeTimer <= 0;
    if (tick) this.hordeTimer = 2;
    for (const e of [...this.horde]) {
      if (e.isDead) continue;
      const dist = e.feet.distanceTo(player);
      if (!this.hordeActive) {
        // Nach Sonnenaufgang: abseits des Spielers (oder spätestens nach einer Minute) verschwinden.
        if (dist > 45 || this.hordeEndedFor > 60) this.removeEnemy(this.enemies.indexOf(e));
        continue;
      }
      if (tick && !e.isAggressive && !this.d.playerHidden()) e.alertedBy(player, this.ctx);
    }
  }

  /** Lebende Bewohner der aktuellen Höhle. */
  get caveDwellers(): readonly Enemy[] {
    return this.cave?.enemies ?? [];
  }

  /** Treffer durch eine Waffe des Spielers. */
  damage(enemy: Enemy, amount: number, zone: HitZone, from: THREE.Vector3, point: THREE.Vector3, normal: THREE.Vector3): void {
    if (enemy.isDead) return;
    const ctx = this.ctxFor(enemy);
    const headshot = zone === 'head';
    const wasAggressive = enemy.isAggressive;
    // Schleichangriff: wer den Spieler nicht bemerkt hat, trifft es dreifach – und leise.
    const sneak = enemy.unaware;
    const total = amount * (headshot ? this.cfg.headshotMultiplier : 1) * (sneak ? SNEAK_MULTIPLIER : 1);
    const killed = enemy.takeDamage(total, from, ctx);

    this.d.particles.burst(point, { count: headshot ? 16 : 10, color: 0x5c0f10, direction: normal, speed: 3, size: 0.035 });
    this.d.audio.play('fleshHit');
    this.d.events.emit('tool:hit', { target: 'creature' });
    this.d.events.emit('enemy:hit', {
      health: Math.max(0, enemy.health),
      maxHealth: enemy.maxHealth,
      killed,
      headshot,
      sneak,
      name: enemy.kind.name,
    });
    if (sneak) this.d.events.emit('hud:message', { text: killed ? `Lautlos ausgeschaltet: ${enemy.kind.name}` : 'Schleichangriff! (×3)' });
    // Ein lautloser Kill ist kaum zu hören; sonst lockt der Kampflärm die Umgebung an.
    this.propagateNoise(point, sneak && killed ? 5 : 15, 0.6);

    if (killed) {
      this.byCollider.delete(enemy.collider.handle);
      this.byCollider.delete(enemy.headCollider.handle);
      this.playAt('enemyDeath', enemy.feet);
      if (this.horde.has(enemy)) this.onHordeKill?.(enemy.feet.clone());
      const slot = this.cave?.slots.get(enemy);
      if (slot !== undefined) this.onCaveDwellerKilled?.(this.cave!.index, slot);
    } else if (!wasAggressive) {
      ctx.alertAllies(enemy);
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
    const cave = this.cave;
    if (cave) {
      cave.ctx.time = this.ctx.time;
      for (const e of cave.enemies) e.fixedUpdate(dt, cave.ctx);
    }
  }

  afterPhysicsStep(): void {
    for (const e of this.enemies) if (e.active) e.afterPhysicsStep();
    for (const e of this.cave?.enemies ?? []) e.afterPhysicsStep();
  }

  update(dt: number, alpha: number): void {
    const d = this.d;
    const player = d.player;
    const night = d.dayNight.daylight < 0.5;
    this.ctx.isNight = d.dayNight.isNight;

    // Sichtweite: tagsüber weit, nachts kurz – außer der Spieler trägt Licht oder steht am Feuer.
    let range = lerp(this.cfg.sightNight, this.cfg.sightDay, d.dayNight.daylight);
    const atHarbor = !!d.harbor && d.harbor.center.distanceTo(player.position) < 8;
    if (night && (d.isPlayerLit() || atHarbor || d.building.isNearLitFire(player.position, 6))) range = Math.max(range, this.cfg.sightLit);
    const rain = d.rain();
    this.ctx.sightRange = range * player.visibility * (1 - 0.35 * rain);

    // Schritte des Spielers sind hörbar.
    this.noiseTimer -= dt;
    if (this.noiseTimer <= 0 && !d.playerHidden()) {
      this.noiseTimer = 0.3;
      // Prasselnder Regen übertönt Schritte.
      const r = player.noiseRadius * (1 - 0.4 * rain);
      if (r > 0) this.propagateNoise(player.position, r, player.sprinting ? 0.4 : 0.18);
    }

    this.updateHunts(dt, night);
    this.updateCamps(dt);
    this.updateHorde(dt);

    // Höhle: kurze Sicht (mit Fackel etwas weiter – Licht verrät), Schritte tragen im Fels weit.
    const cave = this.cave;
    if (cave) {
      cave.ctx.sightRange = (d.isPlayerLit() ? 16 : 9) * player.visibility;
      this.caveNoiseTimer -= dt;
      if (this.caveNoiseTimer <= 0) {
        this.caveNoiseTimer = 0.3;
        const r = player.noiseRadius * 1.3;
        if (r > 0) for (const e of cave.enemies) if (!e.isDead && e.feet.distanceTo(player.position) < r) e.hear(player.position, player.sprinting ? 0.4 : 0.2);
      }
    }

    // LOD, Leichen, Darstellung
    const visible: { rig: Enemy['rig']; tone: number; kind: EnemyKind }[] = [];
    if (cave) {
      for (let i = cave.enemies.length - 1; i >= 0; i--) {
        const e = cave.enemies[i];
        if (e.isDead && e.deadFor > 48) {
          cave.enemies.splice(i, 1);
          e.dispose();
          continue;
        }
        e.active = !e.isDead;
        e.updateVisual(dt, alpha, player.position);
        if (e.rig.steps !== (this.stepCounts.get(e) ?? 0)) {
          this.stepCounts.set(e, e.rig.steps);
          this.onEnemyStep?.(e.position, e.rig.anim.speed);
        }
        visible.push({ rig: e.rig, tone: e.tone, kind: e.kind.kind });
      }
    }
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
        visible.push({ rig: e.rig, tone: e.tone, kind: e.kind.kind });
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
      if (alive < camp.roster.length) {
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
    if (!night || this.d.player.stats.isDead || this.d.playerHidden()) {
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
    for (const e of [...this.enemies, ...(this.cave?.enemies ?? [])]) {
      if (!e.isDead && e.feet.distanceTo(position) < radius) e.hear(position, strength);
    }
  }

  private removeEnemy(index: number): void {
    if (index < 0) return;
    const e = this.enemies[index];
    this.enemies.splice(index, 1);
    this.horde.delete(e);
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
      out.push({ camp, kind: e.kind.kind, p: [f.x, f.y, f.z], health: e.health, tone: e.tone, scale: e.rig.scale });
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
      const kind = isEnemyKind(d.kind) ? d.kind : 'schrat';
      const enemy = new Enemy(this.nextId++, this.d.physics, new THREE.Vector3(...d.p), camp.center, this.cfg, d.tone, d.scale, kind);
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
