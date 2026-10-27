import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import type { EventBus } from '../core/EventBus';
import type { Player } from '../entities/Player';
import type { Enemy } from '../entities/enemies/Enemy';
import { createItemMesh } from '../entities/items/ItemMeshes';
import { cutsLimbs, getItem, type ItemId } from '../entities/items/ItemDefs';
import { cloneWeapon, isWeapon, sanitizeWeapon, weaponName, weaponStats, type WeaponMeta } from '../entities/items/Weapons';
import type { Avatar, CharacterLibrary } from '../entities/characters/CharacterLibrary';
import type { Vegetation, VegetationInstance } from '../world/Vegetation';
import type { NavPoint, NavQuery } from './ai/NavGrid';
import type { EnemyDirector } from './ai/EnemyDirector';
import type { BuildingSystem, Structure } from './building/BuildingSystem';
import type { Inventory } from './Inventory';
import type { ItemService } from './ItemService';
import type { Audio } from './Audio';
import type { Particles } from './Particles';
import type { HarvestSystem } from './HarvestSystem';
import type { WorldItems } from '../entities/items/WorldItems';
import type { Gore } from './Gore';
import type { DialogueOption } from './Survivors';

export type CompanionOrder = 'follow' | 'wait' | 'base' | 'gather';

/** Was der Begleiter gerade tut (für Anzeige und Animation). */
type Task =
  | { kind: 'fight'; enemy: Enemy; cooldown: number; swing: number }
  | { kind: 'repair'; structure: Structure; time: number }
  | { kind: 'harvest'; target: VegetationInstance; time: number; tick: number }
  | { kind: 'collect'; at: THREE.Vector3; time: number }
  | { kind: 'deliver'; chest: Structure };

export interface CompanionSave {
  recruited: boolean;
  p: [number, number, number];
  order: CompanionOrder;
  carry: { log: number; stick: number; stone: number };
  weapon?: { id: ItemId; durability?: number; weapon?: WeaponMeta } | null;
  gatherAt?: [number, number, number];
}

export interface CompanionDeps {
  physics: Physics;
  nav: NavQuery;
  characters: CharacterLibrary | null;
  player: Player;
  inventory: Inventory;
  items: ItemService;
  enemies: EnemyDirector;
  building: BuildingSystem;
  vegetation: Vegetation;
  harvest: HarvestSystem;
  worldItems: WorldItems;
  audio: Audio;
  events: EventBus;
  particles: Particles;
  gore?: Gore;
  /** Hier findet man ihn: Ort und Blickrichtung. */
  spawn: { position: THREE.Vector3; yaw: number };
  /** Zuhause: die Basis bzw. der Aufwachpunkt. */
  home: () => THREE.Vector3;
  /** Spieler in einer Höhle (dorthin folgt er nicht). */
  playerHidden: () => boolean;
}

export const COMPANION_ID = 'ben';
const NAME = 'Ben Hartmann';
const RADIUS = 0.3;
const HEIGHT = 1.78;
const WALK = 1.7;
const RUN = 4.6;
const CARRY_MAX = 12;
/** Wie weit er nach Arbeit sucht und Feinde angeht (m). */
const WORK_RANGE = 32;
const FIGHT_RANGE = 14;
/** Schaden je Axthieb am Baum und Steine je Fels-Durchgang. */
const CHOP_DAMAGE = 14;
const STONES_PER_GO = 2;

/**
 * Ben Hartmann, der Funker: hat sich verletzt in der Funkstation verschanzt. Wer ihm etwas gegen die
 * Schmerzen bringt, hat einen Begleiter. Er folgt, wartet, hält die Basis oder sammelt Holz und Steine,
 * kämpft gegen Schrate (mit der Waffe, die man ihm gibt), bessert Bauwerke aus und hilft beim Bauen
 * (in seiner Nähe kostet jedes Bauwerk ein Viertel weniger Material).
 */
export class Companion {
  readonly group = new THREE.Group();
  readonly def = { id: COMPANION_ID, name: NAME };
  recruited = false;
  order: CompanionOrder = 'follow';
  readonly carry = { log: 0, stick: 0, stone: 0 };
  /** Waffe, die man ihm gegeben hat. */
  weapon: { id: ItemId; durability?: number; weapon?: WeaponMeta } | null = null;

  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly groups = interactionGroups(CollisionGroup.ANIMAL, CollisionGroup.TERRAIN | CollisionGroup.STATIC);
  private readonly prev = new THREE.Vector3();
  private readonly curr = new THREE.Vector3();
  readonly position = new THREE.Vector3();
  private yaw: number;
  private readonly velocity = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private desiredSpeed = 0;
  private grounded = false;
  private faceTarget: THREE.Vector3 | null = null;

  private path: NavPoint[] | null = null;
  private pathIndex = 0;
  private readonly pathGoal = new THREE.Vector3(Infinity, 0, 0);
  private repath = 0;
  private task: Task | null = null;
  private think = 0;
  private readonly waitAt = new THREE.Vector3();
  private readonly gatherAt = new THREE.Vector3();
  private callTimer = 0;
  private fullHint = false;
  /** Zuletzt volle Kiste (wird nicht erneut angesteuert, bis er etwas losgeworden ist). */
  private fullChest: Structure | null = null;
  private alternate = 0;

  private avatar: Avatar | null = null;
  private weaponMesh: THREE.Object3D | null = null;
  private readonly weights = new Map<string, number>();
  private speedVisual = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly d: CompanionDeps) {
    this.group.name = 'Companion';
    const s = d.spawn.position;
    this.yaw = d.spawn.yaw;
    const world = d.physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(s.x, s.y + 0.05, s.z));
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(HEIGHT / 2 - RADIUS, RADIUS).setTranslation(0, HEIGHT / 2, 0).setCollisionGroups(this.groups),
      this.body,
    );
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.45, 0.2, false);
    this.controller.enableSnapToGround(0.5);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(52));
    this.curr.set(s.x, s.y + 0.05, s.z);
    this.prev.copy(this.curr);
    this.position.copy(this.curr);
    this.waitAt.copy(s);
    this.gatherAt.copy(s);
    this.createFigure();
  }

  private createFigure(): void {
    const lib = this.d.characters;
    if (!lib) return;
    const avatar = lib.create('male_15', HEIGHT, { tint: new THREE.Color(1, 0.97, 0.93) });
    this.avatar = avatar;
    this.group.add(avatar.object);
    for (const name of ANIMS) {
      const a = avatar.action(name);
      if (!a) continue;
      a.play();
      a.setEffectiveWeight(name === SIT ? 1 : 0);
    }
  }

  /** Collider → Gesprächspartner (für das Anvisieren). */
  getNpc(collider: RAPIER.Collider): { id: string; name: string } | undefined {
    return collider.handle === this.collider.handle ? this.def : undefined;
  }

  /** In der Nähe des Spielers: Bauwerke kosten weniger. */
  get helpsBuilding(): boolean {
    return this.recruited && this.curr.distanceTo(this.d.player.position) < 12;
  }

  get carried(): number {
    return this.carry.log + this.carry.stick + this.carry.stone;
  }

  // ---------------------------------------------------------------------------
  // Gespräch
  // ---------------------------------------------------------------------------

  greeting(): string {
    if (!this.recruited) return 'Bleib stehen! … Du bist keiner von denen. Gott sei Dank. Mein Bein – ich bin vom Mast gestürzt, als die Schrate kamen. Seit Tagen sitze ich hier fest.';
    const busy = this.task?.kind === 'fight' ? 'Später reden – erst die da!' : '';
    const say: Record<CompanionOrder, string> = {
      follow: 'Ich bin direkt hinter dir.',
      wait: 'Ich warte hier, wie besprochen.',
      base: 'Ich halte die Stellung. Alles ruhig – noch.',
      gather: 'Holz und Steine, kommt sofort.',
    };
    return busy || say[this.order];
  }

  options(): DialogueOption[] {
    const inv = this.d.inventory;
    if (!this.recruited) {
      const cure: ItemId | null = inv.has('painkillers') ? 'painkillers' : inv.has('medkit') ? 'medkit' : null;
      const list: DialogueOption[] = [
        {
          text: 'Was ist hier passiert?',
          run: () => ({
            text: 'Ich habe bis zuletzt gefunkt. Festland, Küstenwache, irgendwer. Keiner hat geantwortet – oder sie wollten nicht. Dann standen sie vor der Tür. Ich bin auf den Mast und abgerutscht.',
          }),
        },
      ];
      if (cure) {
        list.push({
          text: `Hier, nimm das (${getItem(cure).name}).`,
          run: () => {
            inv.remove(cure, 1);
            this.recruit();
            return { text: 'Das … das hilft. Danke. Ich bin Ben. Ich kann Holz hacken, Steine schlagen, ausbessern und zuschlagen, wenn es sein muss. Sag mir, was ich tun soll.' };
          },
        });
      } else {
        list.push({ text: 'Ich suche dir etwas gegen die Schmerzen.', run: () => ({ text: 'Schmerzmittel oder einen Verbandskasten – irgendwas. Ich laufe nicht weg. Kann ich ja nicht.', close: false }) });
      }
      list.push({ text: 'Halt durch. Ich komme wieder.', run: () => ({ close: true }) });
      return list;
    }
    const list: DialogueOption[] = [];
    if (this.order !== 'follow') list.push({ text: 'Komm mit, folge mir.', run: () => this.setOrder('follow', 'Bin hinter dir.') });
    if (this.order !== 'wait') list.push({ text: 'Warte hier.', run: () => this.setOrder('wait', 'Ich rühr mich nicht vom Fleck.') });
    if (this.order !== 'base') list.push({ text: 'Halte die Basis.', run: () => this.setOrder('base', 'Ich gehe zurück und halte sie. Ich bessere aus, was sie kaputt machen.') });
    if (this.order !== 'gather') list.push({ text: 'Sammle hier Holz und Steine.', run: () => this.setOrder('gather', 'Mach ich. Volle Taschen bringe ich in die nächste Kiste.') });
    if (this.carried > 0) {
      list.push({
        text: `Gib mir, was du gesammelt hast (${this.carryText()}).`,
        run: () => {
          this.handOver();
          return { text: 'Bitte schön. Geht ganz schön in die Arme.' };
        },
      });
    }
    // Höchstens sechs Antworten (Zifferntasten): Waffe geben oder zurücknehmen, nicht beides.
    const held = this.d.inventory.get(this.heldSlot());
    if (held && isWeapon(held.id) && getItem(held.id).tool) {
      list.push({
        text: `${this.weapon ? 'Tausch' : 'Nimm'} meine Waffe (${weaponName(held.id, held.weapon)}).`,
        run: () => {
          const stack = this.d.inventory.takeFromSlot(this.heldSlot(), 1);
          if (!stack) return { text: 'Welche Waffe?' };
          this.giveBack();
          this.weapon = { id: stack.id, durability: stack.durability, weapon: cloneWeapon(stack.weapon) };
          this.attachWeapon();
          return { text: 'Liegt gut in der Hand. Damit komme ich klar.' };
        },
      });
    } else if (this.weapon) {
      list.push({
        text: `Gib mir die Waffe zurück (${weaponName(this.weapon.id, this.weapon.weapon)}).`,
        run: () => {
          this.giveBack();
          return { text: 'Hier. Dann eben mit den Fäusten.' };
        },
      });
    }
    list.push({ text: 'Bis später.', run: () => ({ close: true }) });
    return list;
  }

  /** Schnellzugriff-Slot, den der Spieler gerade hält (vom Spiel gesetzt). */
  heldSlot: () => number = () => 0;

  private setOrder(order: CompanionOrder, text: string): { text: string } {
    this.order = order;
    this.task = null;
    this.path = null;
    if (order === 'wait') this.waitAt.copy(this.curr);
    if (order === 'gather') this.gatherAt.copy(this.curr);
    this.fullHint = false;
    return { text };
  }

  private recruit(): void {
    this.recruited = true;
    this.order = 'follow';
    this.d.audio.play('craft');
    this.d.events.emit('hud:message', { text: 'Ben Hartmann begleitet dich. Sprich ihn mit E an, um ihm Anweisungen zu geben.' });
  }

  private carryText(): string {
    const parts: string[] = [];
    if (this.carry.log) parts.push(`${this.carry.log} Stämme`);
    if (this.carry.stick) parts.push(`${this.carry.stick} Stöcke`);
    if (this.carry.stone) parts.push(`${this.carry.stone} Steine`);
    return parts.join(', ');
  }

  /** Gesammeltes an den Spieler (was nicht passt, fällt vor die Füße). */
  private handOver(): void {
    const at = this.d.player.position;
    for (const id of ['log', 'stick', 'stone'] as const) {
      if (this.carry[id] > 0) this.d.items.give(id, this.carry[id], at);
      this.carry[id] = 0;
    }
    this.fullHint = false;
    this.fullChest = null;
  }

  private giveBack(): void {
    if (!this.weapon) return;
    this.d.items.give(this.weapon.id, 1, this.d.player.position, this.weapon.durability, this.weapon.weapon);
    this.weapon = null;
    this.weaponMesh?.removeFromParent();
    this.weaponMesh = null;
  }

  private attachWeapon(): void {
    this.weaponMesh?.removeFromParent();
    this.weaponMesh = null;
    const hand = this.avatar?.bones.get('hand_r');
    if (!this.weapon || !hand) return;
    const mesh = createItemMesh(this.weapon.id);
    // Griff in die Faust, Klinge nach vorne-oben; der Handknochen ist in Modelleinheiten skaliert.
    const holder = new THREE.Group();
    holder.add(mesh);
    mesh.position.y = 0.18;
    holder.rotation.set(0, 0, -Math.PI / 2);
    this.avatar!.object.updateMatrixWorld(true);
    holder.scale.setScalar(1 / new THREE.Vector3().setFromMatrixScale(hand.matrixWorld).x);
    hand.add(holder);
    this.weaponMesh = holder;
  }

  // ---------------------------------------------------------------------------
  // Takt
  // ---------------------------------------------------------------------------

  fixedUpdate(dt: number): void {
    this.desiredSpeed = 0;
    this.faceTarget = null;
    if (!this.recruited) {
      this.callForHelp(dt);
    } else {
      this.decide(dt);
      this.act(dt);
    }
    this.move(dt);
  }

  afterPhysicsStep(): void {
    this.prev.copy(this.curr);
    const t = this.body.translation();
    this.curr.set(t.x, t.y, t.z);
  }

  /** Noch nicht gefunden: ruft um Hilfe, wenn der Spieler in der Nähe ist. */
  private callForHelp(dt: number): void {
    this.callTimer -= dt;
    const dist = this.curr.distanceTo(this.d.player.position);
    if (dist < 50 && dist > 4 && this.callTimer <= 0) {
      this.callTimer = 28;
      this.d.events.emit('hud:message', { text: 'Aus der Funkstation ruft jemand: „Hilfe! Ist da draußen jemand?“' });
    }
    this.faceTarget = dist < 12 ? this.d.player.position : null;
  }

  /** Wahl der nächsten Aufgabe: Kampf vor Ausbessern vor Befehl. */
  private decide(dt: number): void {
    this.think -= dt;
    if (this.task?.kind === 'fight' && (this.task.enemy.isDead || this.task.enemy.feet.distanceTo(this.curr) > FIGHT_RANGE * 1.6)) this.task = null;
    if (this.task?.kind === 'repair' && (this.task.structure.health >= this.task.structure.def.maxHealth * 0.98 || !this.d.building.structures.includes(this.task.structure))) this.task = null;
    if (this.think > 0) return;
    this.think = 0.5;
    if (this.d.playerHidden() && this.order === 'follow') return;
    const enemy = this.findEnemy();
    if (enemy && this.task?.kind !== 'fight') {
      this.task = { kind: 'fight', enemy, cooldown: 0.3, swing: -1 };
      return;
    }
    if (this.task) return;
    const damaged = this.findDamaged();
    if (damaged) {
      this.task = { kind: 'repair', structure: damaged, time: 0 };
      return;
    }
    if (this.order === 'gather') this.planGather();
  }

  private findEnemy(): Enemy | null {
    const player = this.d.player.position;
    let best: Enemy | null = null;
    let bestD = FIGHT_RANGE;
    for (const e of this.d.enemies.enemies) {
      if (e.isDead || !e.active) continue;
      const d = e.feet.distanceTo(this.curr);
      // Er greift an, wer kämpft oder wer dem Spieler auf die Pelle rückt.
      if (!e.isAggressive && e.feet.distanceTo(player) > 6) continue;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Beschädigtes Bauwerk in der Nähe (unter 70 %). */
  private findDamaged(): Structure | null {
    let best: Structure | null = null;
    let bestD = 12;
    for (const s of this.d.building.structures) {
      if (s.health > s.def.maxHealth * 0.7 || !s.def.repair) continue;
      const d = s.position.distanceTo(this.curr);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private planGather(): void {
    if (this.carried >= CARRY_MAX) {
      const chest = this.nearestChest();
      if (chest) this.task = { kind: 'deliver', chest };
      else if (!this.fullHint) {
        this.fullHint = true;
        this.d.events.emit('hud:message', { text: 'Ben: „Meine Taschen sind voll – bau eine Kiste in der Nähe oder hol dir die Sachen bei mir ab.“' });
      }
      return;
    }
    // Abwechselnd Baum und Fels, jeweils das Nächste rund um den Sammelplatz.
    this.alternate++;
    const wantRock = this.alternate % 3 === 0;
    let best: VegetationInstance | null = null;
    let bestD = WORK_RANGE;
    for (const v of this.d.vegetation.instances) {
      if (!v.alive) continue;
      const ok = wantRock ? v.kind === 'rock' : v.kind === 'pine' || v.kind === 'broadleaf';
      if (!ok || (wantRock && this.d.harvest.isRockDepleted(v)) || Math.abs(v.position.x - this.gatherAt.x) > bestD || Math.abs(v.position.z - this.gatherAt.z) > bestD) continue;
      const d = Math.hypot(v.position.x - this.gatherAt.x, v.position.z - this.gatherAt.z);
      if (d < bestD && this.d.nav.nearestWalkable(v.position.x, v.position.z, 3)) {
        bestD = d;
        best = v;
      }
    }
    if (best) this.task = { kind: 'harvest', target: best, time: 0, tick: 0 };
  }

  private nearestChest(): Structure | null {
    let best: Structure | null = null;
    let bestD = 30;
    for (const s of this.d.building.structures) {
      if (!s.storage || s === this.fullChest) continue;
      const d = s.position.distanceTo(this.curr);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private act(dt: number): void {
    const t = this.task;
    if (t?.kind === 'fight') return this.fight(t, dt);
    if (t?.kind === 'repair') {
      if (this.reach(t.structure.position, 1.8, RUN)) {
        t.time += dt;
        this.faceTarget = t.structure.position;
        if (t.time > 0.7 && Math.floor(t.time / 0.7) !== Math.floor((t.time - dt) / 0.7)) this.d.audio.play('chop', { position: t.structure.position, volume: 0.6 });
        if (t.time >= 3) {
          const s = t.structure;
          s.health = Math.min(s.def.maxHealth, s.health + s.def.maxHealth * 0.4);
          this.d.particles.burst(s.position.clone().setY(s.position.y + 1), { count: 8, color: 0x8a6a45, speed: 1.5, size: 0.03 });
          this.task = null;
        }
      }
      return;
    }
    if (t?.kind === 'harvest') {
      const p = t.target.position;
      const rock = t.target.kind === 'rock';
      if (!t.target.alive) {
        this.task = null;
        return;
      }
      if (this.reach(p, rock ? 1.9 : 1.5, WALK * 1.4)) {
        this.faceTarget = p;
        t.time += dt;
        t.tick -= dt;
        if (t.tick > 0) return;
        t.tick = 0.8;
        this.d.audio.play(rock ? 'stoneHit' : 'chop', { position: p, volume: 0.6 });
        this.d.events.emit('noise', { position: p.clone(), radius: 18 });
        this.d.particles.burst(this.tmp.copy(p).setY(this.curr.y + 1), { count: 6, color: rock ? 0x8a877f : 0xc49a62, speed: 2.5, size: 0.03 });
        if (rock) {
          // Ein paar Schläge, dann sind zwei Steine heraus.
          if (t.time < 4) return;
          this.carry.stone += this.d.harvest.takeStones(t.target, STONES_PER_GO);
          this.task = null;
        } else if (this.d.harvest.chopBy(t.target, CHOP_DAMAGE, this.curr)) {
          // Gefällt: warten, bis der Stamm liegt und zerlegt ist, dann Stämme und Äste aufsammeln.
          this.task = { kind: 'collect', at: p.clone(), time: 0 };
        }
      }
      return;
    }
    if (t?.kind === 'collect') {
      t.time += dt;
      this.faceTarget = t.at;
      if (t.time < 2.5 || (this.d.harvest.fallingCount > 0 && t.time < 10)) return;
      const loot = [...this.d.worldItems.all()]
        .filter((w) => (w.itemId === 'log' || w.itemId === 'stick') && w.mesh.position.distanceTo(t.at) < 9)
        .sort((a, b) => a.mesh.position.distanceTo(this.curr) - b.mesh.position.distanceTo(this.curr))[0];
      if (!loot || this.carried >= CARRY_MAX || t.time > 40) {
        this.task = null;
        return;
      }
      if (this.reach(loot.mesh.position, 1.3, WALK * 1.4)) {
        const id = loot.itemId as 'log' | 'stick';
        const take = Math.min(loot.count, CARRY_MAX - this.carried);
        this.carry[id] += take;
        if (take >= loot.count) this.d.worldItems.remove(loot);
        else loot.count -= take;
        this.d.audio.play('pickup', { position: loot.mesh.position, volume: 0.5 });
      }
      return;
    }
    if (t?.kind === 'deliver') {
      if (!this.d.building.structures.includes(t.chest)) {
        this.task = null;
        return;
      }
      if (this.reach(t.chest.position, 1.6, WALK * 1.4)) {
        const before = this.carried;
        for (const id of ['log', 'stick', 'stone'] as const) {
          if (this.carry[id] > 0) this.carry[id] = t.chest.storage!.add(id, this.carry[id]);
        }
        this.task = null;
        if (this.carried === before) {
          // Kiste voll: nicht ständig hin und her laufen.
          this.fullChest = t.chest;
          this.fullHint = true;
          this.d.events.emit('hud:message', { text: 'Ben: „Die Kiste ist voll. Ich halte den Rest fest, bis du ihn holst.“' });
          return;
        }
        this.d.audio.play('pickup', { position: t.chest.position });
        if (t.chest.position.distanceTo(this.d.player.position) < 40) this.d.events.emit('hud:message', { text: 'Ben hat Holz und Steine in die Kiste gelegt.' });
        this.fullHint = false;
      }
      return;
    }
    // Befehl ohne besondere Aufgabe.
    switch (this.order) {
      case 'follow': {
        if (this.d.playerHidden()) return;
        const p = this.d.player.position;
        const dist = this.curr.distanceTo(p);
        // Weit zurückgefallen: unbemerkt hinter den Spieler setzen.
        if (dist > 55) this.teleportNear(p);
        else if (dist > 3.2) this.reach(p, 2.6, dist > 9 ? RUN : WALK * 1.5);
        else this.faceTarget = p;
        return;
      }
      case 'wait':
        this.reach(this.waitAt, 1, WALK);
        return;
      case 'base':
        this.reach(this.d.home(), 1.5, RUN * 0.8);
        return;
      case 'gather':
        this.reach(this.gatherAt, 3, WALK);
        return;
    }
  }

  private fight(t: Extract<Task, { kind: 'fight' }>, dt: number): void {
    const e = t.enemy;
    const close = this.reach(e.feet, 1.45, RUN);
    this.faceTarget = e.feet;
    t.cooldown -= dt;
    if (t.swing >= 0) {
      t.swing += dt;
      if (t.swing >= 0.38 && t.swing - dt < 0.38 && e.feet.distanceTo(this.curr) < 2.2 && !e.isDead) this.strike(e);
      if (t.swing >= 0.9) t.swing = -1;
      return;
    }
    if (close && t.cooldown <= 0) {
      t.swing = 0;
      t.cooldown = 1.05;
      this.d.audio.play('swing', { position: this.curr, volume: 0.6 });
    }
  }

  private strike(e: Enemy): void {
    const w = this.weapon;
    const tool = w ? weaponStats(w.id, w.weapon).tool : null;
    const damage = (tool ? tool.damage : 16) * 0.85;
    const point = e.feet.clone().setY(e.feet.y + 1.2 * e.rig.scale);
    const normal = this.tmp.subVectors(this.curr, e.feet).setY(0).normalize().clone();
    this.d.enemies.damage(e, damage, 'body', this.curr.clone(), point, normal);
    if (tool) this.d.gore?.onHit(e, point, this.curr.clone(), { cut: cutsLimbs(tool), heavy: 0, damage: e.lastDamage, headshot: false });
    if (!e.isDead && tool?.stun) e.stun(tool.stun);
    if (w?.durability !== undefined) {
      w.durability -= 1;
      if (w.durability <= 0) {
        this.d.events.emit('hud:message', { text: `Ben: „Mist – ${getItem(w.id).name} ist hin.“` });
        this.weapon = null;
        this.weaponMesh?.removeFromParent();
        this.weaponMesh = null;
      }
    }
  }

  /**
   * Läuft zum Ziel (mit Wegfindung). @returns true, wenn er nah genug ist.
   */
  private reach(goal: THREE.Vector3, within: number, speed: number): boolean {
    const dx = goal.x - this.curr.x;
    const dz = goal.z - this.curr.z;
    const dist = Math.hypot(dx, dz);
    if (dist < within) return true;
    this.desiredSpeed = speed;
    if (dist < 25 && this.d.nav.lineWalkable({ x: this.curr.x, z: this.curr.z }, { x: goal.x, z: goal.z })) {
      this.desired.set(dx, 0, dz).divideScalar(dist);
      this.path = null;
      return false;
    }
    this.repath -= 1 / 60;
    if (!this.path || (this.repath <= 0 && this.pathGoal.distanceToSquared(goal) > 4)) {
      this.pathGoal.copy(goal);
      this.repath = 0.8;
      const target = this.d.nav.nearestWalkable(goal.x, goal.z, 4) ?? { x: goal.x, z: goal.z };
      this.path = this.d.nav.findPath({ x: this.curr.x, z: this.curr.z }, target, 9000);
      this.pathIndex = 0;
    }
    if (this.path && this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex];
      const wx = wp.x - this.curr.x;
      const wz = wp.z - this.curr.z;
      const wd = Math.hypot(wx, wz);
      if (wd < 0.9) this.pathIndex++;
      this.desired.set(wx, 0, wz).divideScalar(Math.max(wd, 0.001));
    } else {
      this.desired.set(dx, 0, dz).divideScalar(dist);
    }
    return false;
  }

  private teleportNear(p: THREE.Vector3): void {
    const back = new THREE.Vector3(Math.sin(this.d.player.yaw), 0, Math.cos(this.d.player.yaw)).multiplyScalar(6);
    const spot = this.d.nav.nearestWalkable(p.x + back.x, p.z + back.z, 6);
    if (!spot) return;
    const y = this.d.building.supportHeight(spot.x, spot.z);
    this.teleport(new THREE.Vector3(spot.x, y, spot.z));
  }

  teleport(pos: THREE.Vector3): void {
    this.body.setTranslation({ x: pos.x, y: pos.y + 0.05, z: pos.z }, true);
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y + 0.05, z: pos.z });
    this.curr.set(pos.x, pos.y + 0.05, pos.z);
    this.prev.copy(this.curr);
    this.path = null;
  }

  private move(dt: number): void {
    let turnTo: number | null = null;
    if (this.faceTarget) turnTo = Math.atan2(this.faceTarget.x - this.curr.x, this.faceTarget.z - this.curr.z);
    else if (this.desiredSpeed > 0.1) turnTo = Math.atan2(this.desired.x, this.desired.z);
    if (turnTo !== null) {
      const diff = Math.atan2(Math.sin(turnTo - this.yaw), Math.cos(turnTo - this.yaw));
      this.yaw += THREE.MathUtils.clamp(diff, -8 * dt, 8 * dt);
    }
    const tvx = this.desired.x * this.desiredSpeed;
    const tvz = this.desired.z * this.desiredSpeed;
    const accel = 16 * dt;
    this.velocity.x += THREE.MathUtils.clamp(tvx - this.velocity.x, -accel, accel);
    this.velocity.z += THREE.MathUtils.clamp(tvz - this.velocity.z, -accel, accel);
    this.velocity.y = this.grounded ? -1 : this.velocity.y - 20 * dt;
    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, this.groups);
    const mv = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    // Aus der Welt gefallen (sollte nie passieren): zurück zum Spieler.
    if (this.curr.y < -50) this.teleportNear(this.d.player.position);
    this.body.setNextKinematicTranslation({ x: this.curr.x + mv.x, y: this.curr.y + mv.y, z: this.curr.z + mv.z });
    this.speedVisual = Math.hypot(mv.x, mv.z) / dt;
  }

  // ---------------------------------------------------------------------------
  // Darstellung
  // ---------------------------------------------------------------------------

  update(dt: number, alpha: number): void {
    this.position.lerpVectors(this.prev, this.curr, alpha);
    const a = this.avatar;
    if (!a) return;
    a.object.position.copy(this.position);
    a.object.rotation.y = this.yaw;
    const target = new Map<string, number>();
    const t = this.task;
    if (!this.recruited) target.set(SIT, 1);
    else if (t?.kind === 'fight' && t.swing >= 0) {
      const atk = a.action(ATTACK);
      if (atk) {
        atk.time = Math.min(0.999, t.swing / 0.9) * atk.getClip().duration;
        atk.timeScale = 0;
      }
      target.set(ATTACK, 1);
    } else if ((t?.kind === 'harvest' && t.time > 0) || (t?.kind === 'repair' && t.time > 0)) {
      target.set(WORK, 1);
    } else {
      const s = this.speedVisual;
      const move = THREE.MathUtils.smoothstep(s, 0.2, 0.8);
      const run = THREE.MathUtils.smoothstep(s, 2.4, 3.8);
      target.set(this.weapon ? IDLE_ARMED : IDLE, 1 - move);
      target.set(WALK_ANIM, move * (1 - run));
      target.set(RUN_ANIM, move * run);
      const walk = a.action(WALK_ANIM);
      if (walk) walk.timeScale = THREE.MathUtils.clamp(s / 1.4, 0.6, 1.8);
    }
    for (const name of ANIMS) {
      const action = a.action(name);
      if (!action) continue;
      const w = THREE.MathUtils.damp(this.weights.get(name) ?? (name === SIT ? 1 : 0), target.get(name) ?? 0, 8, dt);
      this.weights.set(name, w);
      action.setEffectiveWeight(w);
    }
    a.mixer.update(dt);
  }

  // ---------------------------------------------------------------------------
  // Spielstand
  // ---------------------------------------------------------------------------

  serialize(): CompanionSave {
    return {
      recruited: this.recruited,
      p: [this.curr.x, this.curr.y, this.curr.z],
      order: this.order,
      carry: { ...this.carry },
      weapon: this.weapon ? { id: this.weapon.id, durability: this.weapon.durability, weapon: cloneWeapon(this.weapon.weapon) } : null,
      gatherAt: [this.gatherAt.x, this.gatherAt.y, this.gatherAt.z],
    };
  }

  load(data: Partial<CompanionSave> | undefined, isItemId: (id: string) => id is ItemId): void {
    if (!data) return;
    this.recruited = data.recruited === true;
    if (data.order && ['follow', 'wait', 'base', 'gather'].includes(data.order)) this.order = data.order;
    for (const id of ['log', 'stick', 'stone'] as const) this.carry[id] = Math.max(0, Math.floor(Number(data.carry?.[id]) || 0));
    if (Array.isArray(data.p) && data.p.every(Number.isFinite) && this.recruited) this.teleport(new THREE.Vector3(...data.p));
    if (Array.isArray(data.gatherAt) && data.gatherAt.every(Number.isFinite)) this.gatherAt.set(...data.gatherAt);
    this.waitAt.copy(this.curr);
    const w = data.weapon;
    if (w && typeof w.id === 'string' && isItemId(w.id)) {
      this.weapon = { id: w.id, durability: typeof w.durability === 'number' ? w.durability : undefined, weapon: sanitizeWeapon(w.weapon) };
      this.attachWeapon();
    }
  }
}

const SIT = 'Kneeling Tired';
const IDLE = 'Idle_A';
const IDLE_ARMED = 'Idle_Sword';
const WALK_ANIM = 'Walk_Large';
const RUN_ANIM = 'Jog';
const ATTACK = 'Melee_Hook';
const WORK = 'Interact';
const ANIMS = [SIT, IDLE, IDLE_ARMED, WALK_ANIM, RUN_ANIM, ATTACK, WORK];
