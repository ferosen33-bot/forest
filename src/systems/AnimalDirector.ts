import * as THREE from 'three';
import type { Physics, RAPIER } from '../core/Physics';
import type { EventBus } from '../core/EventBus';
import type { GameConfig } from '../config';
import type { HeightMap } from '../world/HeightMap';
import type { Player } from '../entities/Player';
import { Animal, type AnimalContext, type AnimalSound } from '../entities/animals/Animal';
import { Wolf, WolfPack } from '../entities/animals/Wolf';
import { ANIMAL_GEOMETRY, type AnimalPart, type Species } from '../entities/animals/AnimalRig';
import { RigRenderer } from '../entities/RigRenderer';
import { AnimalAvatars, type AnimalModels, type AnimalTarget } from '../entities/animals/AnimalAvatars';
import type { NavGrid } from './ai/NavGrid';
import type { Particles } from './Particles';
import type { Audio, SoundId } from './Audio';
import type { ItemService } from './ItemService';
import type { TrackKind } from '../world/SnowTracks';
import { deriveSeed, mulberry32 } from '../utils/random';

export interface AnimalDeps {
  /** Realistische Tiermodelle (fehlen sie, bleiben die einfachen Körper). */
  models: AnimalModels | null;
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
  /** Gespannte Schlingfallen. */
  snares: () => { position: THREE.Vector3; armed?: boolean }[];
  /** Eine Falle hat zugeschnappt. */
  onSnared: (snare: { position: THREE.Vector3 }) => void;
  /** Biss eines Wolfs. */
  hitPlayer: (amount: number, from: THREE.Vector3) => void;
  /** Brennt im Umkreis ein Feuer (Lagerfeuer, Standfackel)? */
  fireNear: (pos: THREE.Vector3, radius: number) => boolean;
  /** Spieler hält eine brennende Fackel. */
  playerTorch: () => boolean;
  /** Spieler ist in einer Höhle. */
  playerHidden: () => boolean;
  isNight: () => boolean;
  /** Kühnheit der Wölfe (Jahreszeit, Schneesturm). */
  wolfBoldness: () => number;
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
  wolf: [0x6d665c, 0x5a544c, 0x7a7266, 0x4c4842].map((c) => new THREE.Color(c)),
};

/** Feine Fellvariation auf den Texturen der Modelle. */
const MODEL_TINTS = [0xffffff, 0xeae2da, 0xfff4ea, 0xd8d0c8].map((c) => new THREE.Color(c));

const MAX_PER_SPECIES = 32;

/** Laute der Tiere: wie weit sie tragen (m). */
const SOUND_RANGE: Record<AnimalSound, number> = { deerAlarm: 70, wolfHowl: 420, wolfGrowl: 30, wolfBite: 30 };

/**
 * Wild der Insel: Hirschrudel, Hasen und Wolfsrudel. Verteilt sie auf offenem Gelände, lässt sie
 * auf Geräusche und den Spieler reagieren, zeichnet sie instanziert und regelt das
 * Ausnehmen erlegter Tiere sowie das Nachwachsen der Bestände.
 */
export class AnimalDirector {
  readonly group = new THREE.Group();
  readonly animals: Animal[] = [];
  private readonly renderers: Record<Species, RigRenderer<AnimalPart>>;
  private readonly avatars: AnimalAvatars | null;
  private readonly byCollider = new Map<number, Animal>();
  private readonly ctx: AnimalContext;
  private readonly cfg: GameConfig['animals'];
  private readonly rng: () => number;
  private readonly stepCounts = new WeakMap<Animal, number>();
  readonly packs: WolfPack[] = [];
  /** Abdruck eines Tiers (Spuren im Schnee). */
  onTrack: ((kind: TrackKind, pos: THREE.Vector3, heading: number, side: number, scale: number) => void) | null = null;
  private warnedWolves = false;
  private respawnTimer = 0;
  private lureTimer = 0;
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
    this.renderers = {
      deer: make('deer', { ...legs, antlers: 1 }),
      rabbit: make('rabbit', { ...legs, antlers: 0 }),
      wolf: make('wolf', { ...legs, antlers: 0 }),
    };
    this.avatars = d.models ? new AnimalAvatars(d.models) : null;
    if (this.avatars) {
      for (const r of Object.values(this.renderers)) r.group.removeFromParent();
      this.group.add(this.avatars.group);
    }

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
        get hidden() {
          return d.playerHidden();
        },
        get torch() {
          return d.playerTorch();
        },
      },
      isNight: false,
      boldness: 1,
      hitPlayer: (amount, from) => d.hitPlayer(amount, from),
      fireNear: (pos, radius) => d.fireNear(pos, radius),
      prey: (pos, radius) => {
        let best: Animal | null = null;
        let bestD = radius;
        for (const a of this.animals) {
          if (a.species !== 'deer' || a.isDead) continue;
          const dist = a.feet.distanceTo(pos);
          if (dist < bestD) {
            bestD = dist;
            best = a;
          }
        }
        return best;
      },
      allowPathPlan: () => this.pathPlans++ < 1,
      warnHerd: (source, threat) => {
        for (const a of this.animals) {
          if (a !== source && a.species === 'deer' && !a.isDead && a.state !== 'flee' && a.feet.distanceTo(source.feet) < 35) a.scare(threat);
        }
      },
      sound: (id, pos) => this.playAt(id, pos, id === 'wolfHowl' ? 1 : 0.9, 0.6, SOUND_RANGE[id]),
    };

    // Lärm (Bäume fällen, Kämpfe, Steine) verscheucht Wild im weiten Umkreis.
    d.events.on('noise', ({ position, radius }) => this.scareAround(position, radius * 1.4));

    for (let i = 0; i < this.cfg.herds; i++) this.spawnHerd(false);
    for (let i = 0; i < this.cfg.rabbits; i++) this.spawnRabbit(false);
    for (let i = 0; i < this.cfg.wolfPacks; i++) this.spawnPack(true);
  }

  // ---------------------------------------------------------------------------
  // Spawns
  // ---------------------------------------------------------------------------

  /** Sucht offenes, trockenes, flaches Gelände (optional außer Sichtweite des Spielers). */
  private findSpot(minPlayerDist: number, minSpawnDist = 45): THREE.Vector3 | null {
    const hm = this.d.heightMap;
    const n: [number, number, number] = [0, 1, 0];
    for (let attempt = 0; attempt < 300; attempt++) {
      const x = (this.rng() - 0.5) * hm.size * 0.85;
      const z = (this.rng() - 0.5) * hm.size * 0.85;
      const h = hm.heightAt(x, z);
      if (h < 2.5 || h > 34 || hm.normalAt(x, z, n)[1] < 0.95 || !this.d.nav.isWalkable(x, z)) continue;
      const p = new THREE.Vector3(x, h, z);
      if (p.distanceTo(this.d.spawnPoint) < minSpawnDist || p.distanceTo(this.d.player.position) < minPlayerDist) continue;
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

  /** Wolfsrudel: fern vom Spieler und vom Strand, wo man anfängt. */
  private spawnPack(awayFromPlayer: boolean): void {
    const center = this.findSpot(awayFromPlayer ? 170 : 0, 150);
    if (!center) return;
    const pack = new WolfPack(center.clone());
    const count = this.cfg.wolvesPerPack + (this.rng() < 0.4 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const p = this.offset(center, 5);
      // Der Leitwolf ist der Größte.
      const a = p ? this.add('wolf', p, center.clone(), i === 0 ? 1.08 : 0.88 + this.rng() * 0.16) : null;
      if (a) this.join(a as Wolf, pack);
    }
    if (pack.members.length) this.addPack(pack);
  }

  private join(w: Wolf, pack: WolfPack): void {
    w.pack = pack;
    pack.members.push(w);
  }

  private addPack(pack: WolfPack): void {
    pack.onFirstEngage = () => {
      if (this.warnedWolves) return;
      this.warnedWolves = true;
      this.d.events.emit('hud:message', { text: 'Wölfe! Sie kreisen dich ein – Feuer und Fackeln halten sie auf Abstand.' });
    };
    this.packs.push(pack);
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
    const a =
      species === 'wolf'
        ? new Wolf(this.nextId++, this.d.physics, species, pos, home, scale)
        : new Animal(this.nextId++, this.d.physics, species, pos, home, scale);
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
      this.d.events.emit('animal:killed', { species: animal.species });
      if (animal instanceof Wolf) animal.pack.lost(from);
    }
    // Die Herde flieht mit.
    if (animal.species === 'deer') this.ctx.warnHerd(animal, from);
    return killed;
  }

  /** Erlegtes Tier ausnehmen → rohes Fleisch. */
  butcher(animal: Animal): void {
    if (!animal.isDead || !this.animals.includes(animal)) return;
    const meat = Math.max(1, Math.round(animal.stats.meat * animal.rig.scale));
    const hides = animal.species === 'rabbit' ? 1 : 2;
    this.tmp.copy(animal.feet).add(new THREE.Vector3(0, 0.4, 0));
    this.d.particles.burst(this.tmp, { count: 14, color: 0x6a1010, direction: new THREE.Vector3(0, 1, 0), speed: 1.8, size: 0.03 });
    this.d.audio.play('fleshHit');
    this.remove(animal);
    this.d.items.give('rawMeat', meat, this.tmp);
    this.d.items.give('hide', hides, this.tmp);
  }

  private scareAround(position: THREE.Vector3, radius: number): void {
    for (const a of this.animals) {
      if (a.isDead || a.state === 'flee') continue;
      const dist = a.feet.distanceTo(position);
      // Wölfe hören weiter – und kommen nachts nachsehen, statt zu fliehen.
      if (a instanceof Wolf) {
        if (dist < radius * 1.5) a.hear(position, this.ctx);
      } else if (dist < radius) a.scare(position);
    }
  }

  private remove(animal: Animal): void {
    const i = this.animals.indexOf(animal);
    if (i < 0) return;
    this.animals.splice(i, 1);
    this.byCollider.delete(animal.collider.handle);
    if (animal.corpse) this.byCollider.delete(animal.corpse.handle);
    animal.dispose();
    if (animal instanceof Wolf) {
      const members = animal.pack.members;
      members.splice(members.indexOf(animal), 1);
      if (members.length === 0) this.packs.splice(this.packs.indexOf(animal.pack), 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  fixedUpdate(dt: number): void {
    this.ctx.time += dt;
    this.ctx.isNight = this.d.isNight();
    this.ctx.boldness = this.d.wolfBoldness();
    this.pathPlans = 0;
    for (const pack of this.packs) pack.update(dt, this.ctx);
    for (const a of this.animals) if (a.active || a.isDead) a.fixedUpdate(dt, this.ctx);
  }

  afterPhysicsStep(): void {
    for (const a of this.animals) if (a.active) a.afterPhysicsStep();
  }

  update(dt: number, alpha: number): void {
    const player = this.d.player.position;
    const visible: Record<Species, { parts: Animal['rig']['parts']; tint: THREE.Color }[]> = { deer: [], rabbit: [], wolf: [] };
    const targets: AnimalTarget[] = [];
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      const dist = a.feet.distanceTo(player);
      a.active = !a.isDead && (dist < this.cfg.activeRadius || a.state === 'flee');
      if (a.isDead && a.deadFor > this.cfg.corpseTime) {
        this.remove(a);
        continue;
      }
      // Hasen sind auf 80 m kaum ein Pixel groß.
      if (dist > (a.species === 'rabbit' ? 80 : 200)) continue;
      a.updateVisual(dt, alpha);
      if (a.rig.steps !== (this.stepCounts.get(a) ?? 0)) {
        this.stepCounts.set(a, a.rig.steps);
        if (a.species === 'deer' && dist < 30) this.playAt('hoof', a.feet, Math.min(1, a.rig.anim.speed / 6), 0.2);
        if (dist < 90) {
          const s = a.rig.scale;
          const foot = a.rig.steps % 2 === 0 ? 1 : -1;
          if (a.species === 'rabbit') this.onTrack?.('rabbit', a.feet, a.yaw, 0, s);
          else this.onTrack?.(a.species === 'deer' ? 'hoof' : 'paw', a.feet, a.yaw, foot * (a.species === 'deer' ? 0.12 : 0.08) * s, s);
        }
      }
      if (this.avatars) {
        const model = a.species === 'deer' ? (a.rig.antlers ? 'stag' : 'doe') : a.species;
        targets.push({ id: a.id, rig: a.rig, model, tint: MODEL_TINTS[a.tint % 4] });
      } else {
        visible[a.species].push({ parts: a.rig.parts, tint: TINTS[a.species][a.tint % 4] });
      }
    }
    if (this.avatars) {
      this.avatars.night += ((this.ctx.isNight ? 1 : 0) - this.avatars.night) * Math.min(1, dt * 0.5);
      this.avatars.render(targets, dt, player);
    } else {
      this.renderers.deer.render(visible.deer);
      this.renderers.rabbit.render(visible.rabbit);
      this.renderers.wolf.render(visible.wolf);
    }

    this.updateSnares(dt);

    // Bestände fernab des Spielers wieder auffüllen.
    this.respawnTimer += dt;
    if (this.respawnTimer > this.cfg.respawnTime) {
      this.respawnTimer = 0;
      if (this.count('deer') < this.cfg.herds * this.cfg.perHerd) this.spawnHerd(true);
      if (this.count('rabbit') < this.cfg.rabbits) this.spawnRabbit(true);
      if (this.packs.length < this.cfg.wolfPacks && this.rng() < 0.35) this.spawnPack(true);
    }
  }

  /** Schlingfallen: Hasen der Umgebung schnuppern gelegentlich heran; wer hineinläuft, ist gefangen. */
  private updateSnares(dt: number): void {
    const snares = this.d.snares().filter((s) => s.armed);
    if (snares.length === 0) return;
    this.lureTimer -= dt;
    const lure = this.lureTimer <= 0;
    if (lure) this.lureTimer = 6;
    for (const a of this.animals) {
      if (a.species !== 'rabbit' || a.isDead) continue;
      for (const s of snares) {
        if (!s.armed) continue;
        const d = Math.hypot(a.feet.x - s.position.x, a.feet.z - s.position.z);
        // Tiere gelten bei 1,2 m als „angekommen“ – das reicht für die Schlinge.
        if (d < 1.3) {
          a.takeDamage(Infinity, s.position);
          this.byCollider.delete(a.collider.handle);
          if (a.corpse) this.byCollider.set(a.corpse.handle, a);
          s.armed = false;
          this.d.onSnared(s);
          this.d.events.emit('animal:killed', { species: 'rabbit' });
          break;
        }
        // Köder: etwa alle 6 s mit etwas Glück zur Falle hin (nur Hasen im Umkreis von 45 m).
        if (lure && d < 45 && Math.random() < 0.35) a.lure(s.position);
      }
    }
  }

  private playAt(id: SoundId, pos: THREE.Vector3, volume: number, height = 1.2, range = 70): void {
    const dist = pos.distanceTo(this.d.player.position);
    if (dist > range) return;
    // Ferne Laute (Heulen) werden leiser, statt erst bei 70 m abzubrechen.
    if (range > 70) volume *= Math.min(1, 1.25 - dist / range);
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
    this.packs.length = 0;
    for (const d of list) {
      if (d.species !== 'deer' && d.species !== 'rabbit' && d.species !== 'wolf') continue;
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
    this.regroupWolves();
    // Ältere Spielstände kennen noch keine Wölfe.
    if (!list.some((d) => d.species === 'wolf')) for (let i = 0; i < this.cfg.wolfPacks; i++) this.spawnPack(true);
  }

  /** Geladene Wölfe wieder zu Rudeln zusammenfassen (Nachbarn im selben Revier). */
  private regroupWolves(): void {
    for (const a of this.animals) {
      if (!(a instanceof Wolf) || a.pack) continue;
      const pack = new WolfPack(a.home.clone());
      for (const b of this.animals) {
        if (b instanceof Wolf && !b.pack && b.home.distanceTo(a.home) < 40) this.join(b, pack);
      }
      this.addPack(pack);
    }
  }

  get aliveCount(): number {
    return this.animals.filter((a) => !a.isDead).length;
  }
}
