import * as THREE from 'three';
import type { Physics, RAPIER } from '../core/Physics';
import type { EventBus } from '../core/EventBus';
import type { GameConfig } from '../config';
import type { HeightMap } from '../world/HeightMap';
import type { Player } from '../entities/Player';
import { Animal, type AnimalContext } from '../entities/animals/Animal';
import { ANIMAL_GEOMETRY, type AnimalPart, type Species } from '../entities/animals/AnimalRig';
import { RigRenderer } from '../entities/RigRenderer';
import type { NavGrid } from './ai/NavGrid';
import type { Particles } from './Particles';
import type { Audio, SoundId } from './Audio';
import type { ItemService } from './ItemService';
import { deriveSeed, mulberry32 } from '../utils/random';

export interface AnimalDeps {
  physics: Physics;
  heightMap: HeightMap;
  nav: NavGrid;
  player: Player;
  particles: Particles;
  audio: Audio;
  events: EventBus;
  items: ItemService;
  config: GameConfig;
  spawnPoint: THREE.Vector3;
  /** Mittelpunkte der Schrat-Lager – dort gibt es kein Wild. */
  avoid: THREE.Vector3[];
}

export interface AnimalSave {
  species: Species;
  p: [number, number, number];
  home: [number, number, number];
  health: number;
  scale: number;
  tint: number;
  /** Sekunden seit dem Tod (nur erlegte Tiere). */
  deadFor?: number;
}

const fur = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true });

/** Pro Art: Material je Körperteil (Fellteile werden pro Tier eingefärbt). */
function speciesMaterials(species: Species): Record<AnimalPart, THREE.Material> {
  const body = fur(0xffffff);
  return {
    body,
    neck: body,
    head: body,
    upperLeg: body,
    lowerLeg: species === 'deer' ? fur(0x4a3a2c) : body,
    // Weißer "Spiegel" bzw. Blume
    tail: fur(0xe8e2d6),
    antlers: new THREE.MeshStandardMaterial({ color: 0xcfbf9c, roughness: 0.8, flatShading: true }),
  };
}

const TINTS: Record<Species, THREE.Color[]> = {
  deer: [0x8a5a35, 0x7d5332, 0x93633d, 0x6f4a2e].map((c) => new THREE.Color(c)),
  rabbit: [0x8b7b66, 0x7a6d5d, 0x9a8b74, 0x6e6458].map((c) => new THREE.Color(c)),
};

const MAX_PER_SPECIES = 32;

/**
 * Wild der Insel: Hirschrudel und Hasen. Verteilt sie auf offenem Gelände, lässt sie
 * auf Geräusche und den Spieler reagieren, zeichnet sie instanziert und regelt das
 * Ausnehmen erlegter Tiere sowie das Nachwachsen der Bestände.
 */
export class AnimalDirector {
  readonly group = new THREE.Group();
  readonly animals: Animal[] = [];
  private readonly renderers: Record<Species, RigRenderer<AnimalPart>>;
  private readonly byCollider = new Map<number, Animal>();
  private readonly ctx: AnimalContext;
  private readonly cfg: GameConfig['animals'];
  private readonly rng: () => number;
  private readonly stepCounts = new WeakMap<Animal, number>();
  private respawnTimer = 0;
  private pathPlans = 0;
  private nextId = 1;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly d: AnimalDeps) {
    this.cfg = d.config.animals;
    this.rng = mulberry32(deriveSeed(d.config.seed, 'animals'));
    this.group.name = 'Animals';
    const tinted = new Set<AnimalPart>(['body', 'neck', 'head', 'upperLeg', 'lowerLeg']);
    const make = (species: Species, perEntity: Record<AnimalPart, number>) => {
      const r = new RigRenderer<AnimalPart>(
        { name: species, geometry: ANIMAL_GEOMETRY[species], materials: speciesMaterials(species), perEntity, tinted },
        MAX_PER_SPECIES,
      );
      this.group.add(r.group);
      return r;
    };
    const legs = { body: 1, neck: 1, head: 1, upperLeg: 4, lowerLeg: 4, tail: 1 };
    this.renderers = { deer: make('deer', { ...legs, antlers: 1 }), rabbit: make('rabbit', { ...legs, antlers: 0 }) };

    const player = d.player;
    this.ctx = {
      time: 0,
      physics: d.physics,
      nav: d.nav,
      player: {
        get position() {
          return player.position;
        },
        get crouching() {
          return player.crouching;
        },
        get sprinting() {
          return player.sprinting;
        },
        get isDead() {
          return player.stats.isDead;
        },
      },
      allowPathPlan: () => this.pathPlans++ < 1,
      warnHerd: (source, threat) => {
        for (const a of this.animals) {
          if (a !== source && a.species === 'deer' && !a.isDead && a.state !== 'flee' && a.feet.distanceTo(source.feet) < 35) a.scare(threat);
        }
      },
      sound: (id, pos) => this.playAt(id, pos, 1),
    };

    // Lärm (Bäume fällen, Kämpfe, Steine) verscheucht Wild im weiten Umkreis.
    d.events.on('noise', ({ position, radius }) => this.scareAround(position, radius * 1.4));

    for (let i = 0; i < this.cfg.herds; i++) this.spawnHerd(false);
    for (let i = 0; i < this.cfg.rabbits; i++) this.spawnRabbit(false);
  }

  // ---------------------------------------------------------------------------
  // Spawns
  // ---------------------------------------------------------------------------

  /** Sucht offenes, trockenes, flaches Gelände (optional außer Sichtweite des Spielers). */
  private findSpot(minPlayerDist: number): THREE.Vector3 | null {
    const hm = this.d.heightMap;
    const n: [number, number, number] = [0, 1, 0];
    for (let attempt = 0; attempt < 300; attempt++) {
      const x = (this.rng() - 0.5) * hm.size * 0.85;
      const z = (this.rng() - 0.5) * hm.size * 0.85;
      const h = hm.heightAt(x, z);
      if (h < 2.5 || h > 34 || hm.normalAt(x, z, n)[1] < 0.95 || !this.d.nav.isWalkable(x, z)) continue;
      const p = new THREE.Vector3(x, h, z);
      if (p.distanceTo(this.d.spawnPoint) < 45 || p.distanceTo(this.d.player.position) < minPlayerDist) continue;
      if (this.d.avoid.some((c) => c.distanceTo(p) < 60)) continue;
      return p;
    }
    return null;
  }

  private spawnHerd(awayFromPlayer: boolean): void {
    const center = this.findSpot(awayFromPlayer ? 160 : 0);
    if (!center) return;
    const count = this.cfg.perHerd + (this.rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const p = this.offset(center, 6);
      if (p) this.add('deer', p, center.clone(), 0.9 + this.rng() * 0.2);
    }
  }

  private spawnRabbit(awayFromPlayer: boolean): void {
    const p = this.findSpot(awayFromPlayer ? 90 : 0);
    if (p) this.add('rabbit', p, p.clone(), 0.85 + this.rng() * 0.3);
  }

  private offset(center: THREE.Vector3, radius: number): THREE.Vector3 | null {
    for (let i = 0; i < 8; i++) {
      const x = center.x + (this.rng() - 0.5) * 2 * radius;
      const z = center.z + (this.rng() - 0.5) * 2 * radius;
      if (this.d.nav.isWalkable(x, z)) return new THREE.Vector3(x, this.d.heightMap.heightAt(x, z), z);
    }
    return null;
  }

  private add(species: Species, pos: THREE.Vector3, home: THREE.Vector3, scale: number): Animal | null {
    if (this.count(species) >= MAX_PER_SPECIES) return null;
    const a = new Animal(this.nextId++, this.d.physics, species, pos, home, scale);
    a.tint = Math.floor(this.rng() * 4);
    this.animals.push(a);
    this.byCollider.set(a.collider.handle, a);
    return a;
  }

  private count(species: Species): number {
    let n = 0;
    for (const a of this.animals) if (a.species === species && !a.isDead) n++;
    return n;
  }

  // ---------------------------------------------------------------------------
  // Jagd
  // ---------------------------------------------------------------------------

  getByCollider(collider: RAPIER.Collider): Animal | undefined {
    return this.byCollider.get(collider.handle);
  }

  /** Treffer durch den Spieler (Nahkampf oder Wurfspeer). @returns true bei tödlichem Treffer. */
  damage(animal: Animal, amount: number, from: THREE.Vector3, point: THREE.Vector3, normal: THREE.Vector3): boolean {
    if (animal.isDead) return false;
    const killed = animal.takeDamage(amount, from);
    this.d.particles.burst(point, { count: 10, color: 0x6a1010, direction: normal, speed: 2.5, size: 0.03 });
    this.d.audio.play('fleshHit', 0.8);
    this.d.events.emit('tool:hit', { target: 'creature' });
    if (killed) {
      this.byCollider.delete(animal.collider.handle);
      this.byCollider.set(animal.corpse!.handle, animal);
      this.d.events.emit('hud:message', { text: `${animal.name} erlegt.` });
    }
    // Die Herde flieht mit.
    if (animal.species === 'deer') this.ctx.warnHerd(animal, from);
    return killed;
  }

  /** Erlegtes Tier ausnehmen → rohes Fleisch. */
  butcher(animal: Animal): void {
    if (!animal.isDead || !this.animals.includes(animal)) return;
    const meat = Math.max(1, Math.round(animal.stats.meat * animal.rig.scale));
    this.tmp.copy(animal.feet).add(new THREE.Vector3(0, 0.4, 0));
    this.d.particles.burst(this.tmp, { count: 14, color: 0x6a1010, direction: new THREE.Vector3(0, 1, 0), speed: 1.8, size: 0.03 });
    this.d.audio.play('fleshHit');
    this.remove(animal);
    this.d.items.give('rawMeat', meat, this.tmp);
  }

  private scareAround(position: THREE.Vector3, radius: number): void {
    for (const a of this.animals) if (!a.isDead && a.state !== 'flee' && a.feet.distanceTo(position) < radius) a.scare(position);
  }

  private remove(animal: Animal): void {
    const i = this.animals.indexOf(animal);
    if (i < 0) return;
    this.animals.splice(i, 1);
    this.byCollider.delete(animal.collider.handle);
    if (animal.corpse) this.byCollider.delete(animal.corpse.handle);
    animal.dispose();
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  fixedUpdate(dt: number): void {
    this.ctx.time += dt;
    this.pathPlans = 0;
    for (const a of this.animals) if (a.active || a.isDead) a.fixedUpdate(dt, this.ctx);
  }

  afterPhysicsStep(): void {
    for (const a of this.animals) if (a.active) a.afterPhysicsStep();
  }

  update(dt: number, alpha: number): void {
    const player = this.d.player.position;
    const visible: Record<Species, { parts: Animal['rig']['parts']; tint: THREE.Color }[]> = { deer: [], rabbit: [] };
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      const dist = a.feet.distanceTo(player);
      a.active = !a.isDead && (dist < this.cfg.activeRadius || a.state === 'flee');
      if (a.isDead && a.deadFor > this.cfg.corpseTime) {
        this.remove(a);
        continue;
      }
      if (dist > 200) continue;
      a.updateVisual(dt, alpha);
      if (a.species === 'deer' && a.rig.steps !== (this.stepCounts.get(a) ?? 0)) {
        this.stepCounts.set(a, a.rig.steps);
        if (dist < 30) this.playAt('hoof', a.feet, Math.min(1, a.rig.anim.speed / 6), 0.2);
      }
      visible[a.species].push({ parts: a.rig.parts, tint: TINTS[a.species][a.tint % 4] });
    }
    this.renderers.deer.render(visible.deer);
    this.renderers.rabbit.render(visible.rabbit);

    // Bestände fernab des Spielers wieder auffüllen.
    this.respawnTimer += dt;
    if (this.respawnTimer > this.cfg.respawnTime) {
      this.respawnTimer = 0;
      if (this.count('deer') < this.cfg.herds * this.cfg.perHerd) this.spawnHerd(true);
      if (this.count('rabbit') < this.cfg.rabbits) this.spawnRabbit(true);
    }
  }

  private playAt(id: SoundId, pos: THREE.Vector3, volume: number, height = 1.2): void {
    if (pos.distanceTo(this.d.player.position) > 70) return;
    this.d.audio.play(id, { volume, position: this.tmp.copy(pos).add(new THREE.Vector3(0, height, 0)) });
  }

  serialize(): AnimalSave[] {
    return this.animals.map((a) => {
      const f = a.feet;
      const save: AnimalSave = {
        species: a.species,
        p: [f.x, f.y, f.z],
        home: [a.home.x, a.home.y, a.home.z],
        health: a.health,
        scale: a.rig.scale,
        tint: a.tint,
      };
      if (a.isDead) save.deadFor = a.deadFor;
      return save;
    });
  }

  /** Ersetzt den Wildbestand durch den gespeicherten (Leichen bleiben ausnehmbar). */
  load(list: AnimalSave[]): void {
    for (const a of [...this.animals]) this.remove(a);
    for (const d of list) {
      if (d.species !== 'deer' && d.species !== 'rabbit') continue;
      const a = this.add(d.species, new THREE.Vector3(...d.p), new THREE.Vector3(...d.home), d.scale);
      if (!a) continue;
      a.tint = d.tint;
      a.health = Math.min(a.health, d.health);
      if (d.deadFor !== undefined) {
        a.takeDamage(Infinity, a.feet);
        a.deadFor = d.deadFor;
        // Ohne Todesanimation direkt liegend
        a.rig.anim.death = 1;
        this.byCollider.delete(a.collider.handle);
        this.byCollider.set(a.corpse!.handle, a);
      }
    }
  }

  get aliveCount(): number {
    return this.animals.filter((a) => !a.isDead).length;
  }
}
