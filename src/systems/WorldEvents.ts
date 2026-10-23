import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import type { EventBus } from '../core/EventBus';
import type { HeightMap } from '../world/HeightMap';
import type { Vegetation } from '../world/Vegetation';
import { isTree } from '../world/Vegetation';
import { FireEffect } from '../entities/FireEffect';
import type { ItemId } from '../entities/items/ItemDefs';
import { createCampModel } from './ai/CampModel';
import type { EnemyDirector } from './ai/EnemyDirector';
import type { Enemy } from '../entities/enemies/Enemy';
import type { ItemService } from './ItemService';
import type { Particles } from './Particles';
import type { LightPool, LightRequest } from './LightPool';
import type { Audio } from './Audio';

/**
 * Die Insel lebt: Zufallsereignisse, damit immer etwas passiert.
 * - **Versorgungsabwurf:** Ein Flugzeug wirft eine Kiste am Fallschirm ab, roter Rauch markiert sie –
 *   und lockt Schrate aus dem nächsten Lager an.
 * - **Schrat-Ritual** (nachts): Trommeln, ein großes Feuer, tanzende Schrate und eine Opfergabe.
 * - **Verlassenes Lager:** Zelt, kalte Feuerstelle, Rucksack und die letzte Notiz eines Überlebenden.
 */

export type WorldEventKind = 'drop' | 'ritual' | 'camp';

export interface EventTarget {
  event: WorldEvent;
  part: 'loot' | 'note';
}

interface WorldEvent {
  id: number;
  kind: WorldEventKind;
  position: THREE.Vector3;
  group: THREE.Group;
  /** Auf der Karte (gesehen/gehört). */
  marked: boolean;
  looted: boolean;
  /** Verbleibende Lebenszeit (s Spielzeit). */
  life: number;
  colliders: RAPIER.Collider[];
  // Abwurf
  plane?: THREE.Group;
  planeT?: number;
  planeFrom?: THREE.Vector3;
  planeTo?: THREE.Vector3;
  crate?: THREE.Group;
  falling?: boolean;
  smoke?: number;
  engineTimer?: number;
  // Ritual
  fire?: FireEffect;
  light?: LightRequest;
  enemies?: Enemy[];
  drumTimer?: number;
  // Lager
  note?: number;
}

export interface WorldEventSave {
  kind: 'drop' | 'camp';
  p: [number, number, number];
  looted: boolean;
  life: number;
  note?: number;
}

export interface WorldEventsDeps {
  physics: Physics;
  heightMap: HeightMap;
  vegetation: Vegetation;
  enemies: EnemyDirector;
  items: ItemService;
  particles: Particles;
  lights: LightPool;
  audio: Audio;
  events: EventBus;
  /** Gebiete ohne Ereignisse (Stadt, Lager). */
  avoid: { x: number; z: number; radius: number }[];
  /** Zeigt eine Notiz in der Leseansicht. */
  showNote: (title: string, text: string) => void;
}

export interface WorldEventsFrame {
  dt: number;
  player: THREE.Vector3;
  hour: number;
  isNight: boolean;
  /** Spieler in einer Höhle: draußen passiert nichts Neues. */
  inCave: boolean;
}

/** Letzte Aufzeichnungen der Überlebenden (zufällig je Lager). */
const SURVIVOR_NOTES: [string, string][] = [
  ['Zettel im Zelt', 'Tag 12. Das Wasser aus dem See macht mich krank, ich koche es jetzt ab. Nachts kreisen sie ums Lager, aber das Feuer hält sie draußen. Holz wird knapp.'],
  ['Durchnässte Seite', 'Wir waren zu viert, als die Fähre nicht kam. Jetzt bin ich allein. Ich gehe zum Steg in der Nordbucht. Wenn dort kein Boot liegt, weiß ich nicht weiter.'],
  ['Kritzelei auf einer Landkarte', 'Höhle am Hang: NICHT reingehen. Stadt: Supermarkt geplündert, Tankstelle noch nicht. Die Schrate auf dem Marktplatz zählen: fünf, vielleicht mehr.'],
  ['Letzter Eintrag', 'Das Fieber hat mich erwischt. Licht tut weh. Ich höre sie im Wald singen, und ein Teil von mir will hingehen. Wer das liest: Nimm meine Sachen. Ich brauche sie nicht mehr.'],
];

const LOOT: Record<'drop' | 'ritual' | 'camp', [ItemId, number, number][]> = {
  // [Item, Anzahl, Chance]
  drop: [['medkit', 2, 1], ['cannedFood', 3, 1], ['waterBottle', 2, 1], ['arrow', 10, 0.8], ['battery', 2, 0.8], ['flashlight', 1, 0.4], ['machete', 1, 0.3], ['jacket', 1, 0.3]],
  ritual: [['hide', 2, 1], ['flint', 3, 1], ['painkillers', 1, 0.7], ['medkit', 1, 0.5], ['arrow', 6, 0.6], ['cookedMeat', 2, 0.8]],
  camp: [['cannedFood', 1, 0.8], ['waterBottle', 1, 0.8], ['medkit', 1, 0.5], ['arrow', 5, 0.5], ['battery', 1, 0.5], ['torch', 1, 0.6], ['bow', 1, 0.25]],
};

const LIFE = { drop: 20 * 60, ritual: 0, camp: 3 * 20 * 60 } as const;
const COMPASS = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });
const M = {
  crate: mat(0x5d6a4a),
  stripe: mat(0xc9a23a),
  chute: mat(0xd8622a, { side: THREE.DoubleSide }),
  line: mat(0xdddddd),
  plane: mat(0x4a4f55, { metalness: 0.3, roughness: 0.6 }),
  tent: mat(0x56684a, { side: THREE.DoubleSide }),
  ash: mat(0x2c2826),
  stone: mat(0x77736b),
  pack: mat(0x6b4f33),
  body: mat(0x3a3a36),
  bundle: mat(0x6e5a3e),
  paper: mat(0xd9d1bc, { roughness: 1 }),
};

function crateModel(): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.8), M.crate);
  box.position.y = 0.4;
  g.add(box);
  for (const x of [-0.35, 0.35]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.82, 0.82), M.stripe);
    s.position.set(x, 0.4, 0);
    g.add(s);
  }
  const chute = new THREE.Group();
  chute.name = 'chute';
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.4, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2.6), M.chute);
  canopy.position.y = 5;
  chute.add(canopy);
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    const len = Math.hypot(x, 4.3, z);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, len, 3), M.line);
    l.position.set(x / 2, 0.8 + 4.3 / 2, z / 2);
    l.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, 4.3, z).normalize());
    chute.add(l);
  }
  g.add(chute);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function planeModel(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.8, 16, 8), M.plane);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(26, 0.35, 3.2), M.plane);
  wing.position.set(0, 0.4, 1);
  g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(8, 0.25, 1.8), M.plane);
  tail.position.set(0, 0.4, -7);
  g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3, 2), M.plane);
  fin.position.set(0, 1.8, -7);
  g.add(fin);
  return g;
}

function survivorCampModel(): THREE.Group {
  const g = new THREE.Group();
  // A-Zelt aus zwei Planen
  for (const s of [-1, 1]) {
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.7), M.tent);
    sheet.position.set(s * 0.55, 0.75, -1.5);
    sheet.rotation.set(0, Math.PI / 2, s * -0.62);
    g.add(sheet);
  }
  // Kalte Feuerstelle
  const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.05, 10), M.ash);
  ash.position.set(1.6, 0.03, 0.4);
  g.add(ash);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), M.stone);
    st.position.set(1.6 + Math.cos(a) * 0.48, 0.06, 0.4 + Math.sin(a) * 0.48);
    g.add(st);
  }
  // Rucksack und eine zusammengesunkene Gestalt am Zelteingang
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.3), M.pack);
  pack.position.set(-0.9, 0.3, 0.2);
  pack.rotation.y = 0.4;
  g.add(pack);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.25, 0.8), M.body);
  torso.position.set(0.2, 0.14, -0.3);
  torso.rotation.y = 0.7;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), M.body);
  head.position.set(0.5, 0.14, 0.05);
  g.add(head);
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.006, 0.3), M.paper);
  paper.position.set(-0.3, 0.02, 0.6);
  paper.rotation.y = -0.3;
  g.add(paper);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export class WorldEvents {
  readonly group = new THREE.Group();
  private readonly list: WorldEvent[] = [];
  private readonly targets = new Map<number, EventTarget>();
  private nextId = 1;
  /** Bis zum nächsten Ereignis (s); das erste lässt ein paar Minuten auf sich warten. */
  private timer = 240;
  private readonly tmp = new THREE.Vector3();
  private readonly body: RAPIER.RigidBody;

  constructor(private readonly d: WorldEventsDeps) {
    this.group.name = 'WorldEvents';
    this.body = d.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  get active(): number {
    return this.list.length;
  }

  getTarget(collider: RAPIER.Collider): EventTarget | undefined {
    return this.targets.get(collider.handle);
  }

  /** Was der Hinweis zeigt. */
  describe(t: EventTarget): { action: string; label: string } | null {
    if (t.part === 'note') return { action: 'Lesen', label: SURVIVOR_NOTES[t.event.note ?? 0][0] };
    if (t.event.looted) return null;
    switch (t.event.kind) {
      case 'drop':
        return { action: 'Öffnen', label: 'Versorgungskiste' };
      case 'ritual':
        return { action: 'Nehmen', label: 'Opfergabe' };
      case 'camp':
        return { action: 'Durchsuchen', label: 'Rucksack' };
    }
  }

  interact(t: EventTarget): void {
    const e = t.event;
    if (t.part === 'note') {
      const [title, text] = SURVIVOR_NOTES[e.note ?? 0];
      this.d.showNote(title, text);
      return;
    }
    if (e.looted) return;
    e.looted = true;
    const at = this.tmp.copy(e.position).setY(e.position.y + 0.8);
    for (const [item, count, chance] of LOOT[e.kind]) if (Math.random() < chance) this.d.items.give(item, count, at);
    this.d.audio.play('door', { position: at });
    this.d.events.emit('world:event', { kind: e.kind, phase: 'looted' });
  }

  /** Karte: markierte Ereignisse. */
  markers(): { x: number; z: number; kind: WorldEventKind }[] {
    return this.list.filter((e) => e.marked && !(e.kind !== 'ritual' && e.looted)).map((e) => ({ x: e.position.x, z: e.position.z, kind: e.kind }));
  }

  /** Erzwingt ein Ereignis (Debug). */
  trigger(kind: WorldEventKind, player: THREE.Vector3): boolean {
    const p = this.findSpot(player, kind === 'ritual' ? 60 : 120, kind === 'ritual' ? 140 : 260);
    if (!p) return false;
    this.start(kind, p, player);
    return true;
  }

  update(f: WorldEventsFrame): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (!this.updateEvent(this.list[i], f)) this.remove(i);
    }
    if (f.inCave) return;
    this.timer -= f.dt;
    if (this.timer > 0 || this.list.length >= 3) return;
    this.timer = 300 + Math.random() * 300;
    const ritualTime = f.hour >= 21 || f.hour < 2;
    const kind: WorldEventKind = ritualTime && !this.list.some((e) => e.kind === 'ritual') && Math.random() < 0.5 ? 'ritual' : Math.random() < 0.45 ? 'drop' : 'camp';
    this.trigger(kind, f.player);
  }

  // ---------------------------------------------------------------------------
  // Aufbau
  // ---------------------------------------------------------------------------

  /** Freier, ebener, trockener Platz in einem Ring um den Spieler (nicht in Stadt und Lagern, nicht unter Bäumen). */
  private findSpot(player: THREE.Vector3, rMin: number, rMax: number): THREE.Vector3 | null {
    const hm = this.d.heightMap;
    const n: [number, number, number] = [0, 1, 0];
    for (let attempt = 0; attempt < 60; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = rMin + Math.random() * (rMax - rMin);
      const x = player.x + Math.cos(a) * r;
      const z = player.z + Math.sin(a) * r;
      if (!hm.isInside(x * 1.15, z * 1.15)) continue;
      const h = hm.heightAt(x, z);
      if (h < hm.waterLevel + 2 || hm.normalAt(x, z, n)[1] < 0.93) continue;
      if (this.d.avoid.some((v) => Math.hypot(v.x - x, v.z - z) < v.radius)) continue;
      if (this.list.some((e) => Math.hypot(e.position.x - x, e.position.z - z) < 60)) continue;
      const crowded = this.d.vegetation.instances.some(
        (v) => v.alive && isTree(v.kind) && Math.abs(v.position.x - x) < 5 && Math.abs(v.position.z - z) < 5,
      );
      if (crowded) continue;
      return new THREE.Vector3(x, h, z);
    }
    return null;
  }

  private addCollider(e: WorldEvent, desc: RAPIER.ColliderDesc, at: THREE.Vector3, part?: EventTarget['part']): void {
    const c = this.d.physics.world.createCollider(
      desc.setTranslation(at.x, at.y, at.z).setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
      this.body,
    );
    e.colliders.push(c);
    if (part) this.targets.set(c.handle, { event: e, part });
  }

  private direction(from: THREE.Vector3, to: THREE.Vector3): string {
    // Peilung im Uhrzeigersinn ab Norden (−Z).
    const deg = ((Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI + 360) % 360;
    return COMPASS[Math.round(deg / 45) % 8];
  }

  private start(kind: WorldEventKind, position: THREE.Vector3, player: THREE.Vector3): WorldEvent {
    const e: WorldEvent = {
      id: this.nextId++,
      kind,
      position,
      group: new THREE.Group(),
      marked: false,
      looted: false,
      life: LIFE[kind],
      colliders: [],
    };
    e.group.position.copy(position);
    this.group.add(e.group);
    this.list.push(e);
    if (kind === 'drop') this.startDrop(e, player);
    else if (kind === 'ritual') this.startRitual(e);
    else this.buildCamp(e, Math.floor(Math.random() * SURVIVOR_NOTES.length));
    this.d.events.emit('world:event', { kind, phase: 'start' });
    return e;
  }

  /** Flugzeug über die Abwurfstelle; die Kiste fällt, sobald es darüber ist. */
  private startDrop(e: WorldEvent, player: THREE.Vector3): void {
    const heading = Math.random() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const alt = Math.max(e.position.y, this.d.heightMap.maxHeight) + 70;
    e.planeFrom = e.position.clone().addScaledVector(dir, -700).setY(alt);
    e.planeTo = e.position.clone().addScaledVector(dir, 700).setY(alt);
    e.planeT = 0;
    e.plane = planeModel();
    e.plane.rotation.y = heading;
    this.group.add(e.plane);
    e.engineTimer = 0;
    e.falling = false;
    this.d.events.emit('hud:message', { text: `Ein Flugzeug! Es fliegt tief über die Insel – Richtung ${this.direction(player, e.position)}.` });
  }

  private releaseCrate(e: WorldEvent): void {
    e.crate = crateModel();
    e.crate.position.set(0, e.plane!.position.y - e.position.y - 4, 0);
    e.group.add(e.crate);
    e.falling = true;
    e.marked = true;
    this.d.events.emit('hud:message', { text: 'Etwas schwebt am Fallschirm herab – auf der Karte (M) markiert.' });
  }

  private landCrate(e: WorldEvent, quiet = false): void {
    e.falling = false;
    e.crate!.position.y = 0;
    const chute = e.crate!.getObjectByName('chute');
    if (chute) {
      // Der Schirm sinkt zur Seite und bleibt als Stoff am Boden liegen.
      chute.position.set(2.2, -4.7, 0);
      chute.rotation.z = -1.2;
    }
    e.smoke = 240;
    this.addCollider(e, RAPIER.ColliderDesc.cuboid(0.55, 0.4, 0.4), this.tmp.copy(e.position).setY(e.position.y + 0.4), 'loot');
    if (quiet) return;
    this.d.audio.play('place', { volume: 1, position: e.position });
    // Der Lärm lockt Schrate aus dem nächsten Lager an.
    this.d.enemies.sendGroupTo(e.position, 3);
  }

  private startRitual(e: WorldEvent): void {
    const model = createCampModel();
    e.group.add(model);
    e.fire = new FireEffect(1.3);
    e.group.add(e.fire.object);
    e.light = { position: e.position.clone().setY(e.position.y + 1.2), color: new THREE.Color(0xff6a2a), intensity: 0, distance: 34 };
    const bundle = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35, 0), M.bundle);
    bundle.position.set(-1.8, 0.3, 1.4);
    e.group.add(bundle);
    this.addCollider(e, RAPIER.ColliderDesc.ball(0.45), this.tmp.copy(e.position).add(new THREE.Vector3(-1.8, 0.35, 1.4)), 'loot');
    e.enemies = this.d.enemies.spawnGroup(e.position, ['schrat', 'schrat', 'spaeher', 'schrat']);
    e.drumTimer = 0;
  }

  private buildCamp(e: WorldEvent, note: number): void {
    e.note = note;
    e.group.add(survivorCampModel());
    this.addCollider(e, RAPIER.ColliderDesc.cuboid(0.3, 0.35, 0.25), this.tmp.copy(e.position).add(new THREE.Vector3(-0.9, 0.3, 0.2)), 'loot');
    this.addCollider(e, RAPIER.ColliderDesc.cuboid(0.18, 0.06, 0.2).setSensor(true), this.tmp.copy(e.position).add(new THREE.Vector3(-0.3, 0.05, 0.6)), 'note');
  }

  // ---------------------------------------------------------------------------
  // Ablauf
  // ---------------------------------------------------------------------------

  /** @returns false, wenn das Ereignis vorbei ist. */
  private updateEvent(e: WorldEvent, f: WorldEventsFrame): boolean {
    const dist = Math.hypot(e.position.x - f.player.x, e.position.z - f.player.z);
    if (e.kind === 'drop') {
      if (e.plane) {
        e.planeT! += f.dt / 20;
        e.plane.position.lerpVectors(e.planeFrom!, e.planeTo!, e.planeT!);
        e.engineTimer! -= f.dt;
        if (e.engineTimer! <= 0) {
          e.engineTimer = 1.4;
          this.d.audio.play('plane', { volume: 3, position: e.plane.position });
        }
        if (!e.crate && e.planeT! >= 0.5) this.releaseCrate(e);
        if (e.planeT! >= 1) {
          this.group.remove(e.plane);
          e.plane = undefined;
        }
      }
      if (e.falling && e.crate) {
        e.crate.position.y = Math.max(0, e.crate.position.y - f.dt * 7);
        e.crate.rotation.y += f.dt * 0.3;
        if (e.crate.position.y <= 0) this.landCrate(e);
      }
      // Roter Rauch steigt auf und ist weithin zu sehen.
      if (e.smoke !== undefined && e.smoke > 0 && !e.looted) {
        e.smoke -= f.dt;
        if (Math.random() < f.dt * 14) {
          this.d.particles.burst(this.tmp.copy(e.position).setY(e.position.y + 0.9), { count: 1, color: 0xa8443a, speed: 2.6, spread: 0.7, size: 0.3, life: 5, gravity: -0.35 });
        }
      }
      e.life -= f.dt;
      return e.life > 0 || dist < 40;
    }
    if (e.kind === 'ritual') {
      const night = f.hour >= 20 || f.hour < 5;
      if (night) {
        e.fire!.update(f.dt);
        e.light!.intensity = 40 * e.fire!.flicker;
        if (dist < 200) this.d.lights.request(e.light!);
        // Trommeln tragen weit durch die Nacht.
        e.drumTimer! -= f.dt;
        if (e.drumTimer! <= 0) {
          e.drumTimer = 0.42 + (Math.random() < 0.25 ? 0.42 : 0);
          if (dist < 320) this.d.audio.play('drum', { volume: 2.2, position: this.tmp.copy(e.position).setY(e.position.y + 1) });
        }
        if (!e.marked && dist < 260) {
          e.marked = true;
          this.d.events.emit('hud:message', { text: `In der Ferne dröhnen Trommeln – im ${this.direction(f.player, e.position)}.` });
        }
      } else {
        // Morgengrauen: Feuer aus, die Schrate verschwinden (sobald niemand hinsieht).
        e.fire!.visible = false;
        e.enemies = this.d.enemies.despawnGroup(e.enemies ?? [], 50);
        return e.enemies.length > 0 || dist < 50;
      }
      e.enemies = (e.enemies ?? []).filter((x) => !x.isDead || x.deadFor < 40);
      return true;
    }
    // Verlassenes Lager: wird entdeckt, wenn man vorbeikommt.
    if (!e.marked && dist < 40) {
      e.marked = true;
      this.d.events.emit('hud:message', { text: 'Ein verlassenes Lager. Jemand hat hier ausgeharrt …' });
    }
    e.life -= f.dt;
    return e.life > 0 || dist < 40;
  }

  private remove(index: number): void {
    const e = this.list[index];
    this.list.splice(index, 1);
    this.group.remove(e.group);
    if (e.plane) this.group.remove(e.plane);
    for (const c of e.colliders) {
      this.targets.delete(c.handle);
      this.d.physics.world.removeCollider(c, false);
    }
    if (e.enemies) this.d.enemies.despawnGroup(e.enemies, 0);
  }

  // ---------------------------------------------------------------------------
  // Spielstand (Abwürfe und Lager; Rituale enden ohnehin vor dem Morgen)
  // ---------------------------------------------------------------------------

  serialize(): WorldEventSave[] {
    const out: WorldEventSave[] = [];
    for (const e of this.list) {
      if (e.kind === 'ritual' || (e.kind === 'drop' && !e.crate)) continue;
      out.push({ kind: e.kind, p: [e.position.x, e.position.y, e.position.z], looted: e.looted, life: e.life, ...(e.note !== undefined ? { note: e.note } : {}) });
    }
    return out;
  }

  load(list: WorldEventSave[]): void {
    for (const s of list ?? []) {
      if (s.kind !== 'drop' && s.kind !== 'camp') continue;
      const e: WorldEvent = {
        id: this.nextId++,
        kind: s.kind,
        position: new THREE.Vector3(...s.p),
        group: new THREE.Group(),
        marked: true,
        looted: s.looted === true,
        life: Math.max(60, s.life ?? LIFE[s.kind]),
        colliders: [],
      };
      e.group.position.copy(e.position);
      this.group.add(e.group);
      this.list.push(e);
      if (s.kind === 'camp') this.buildCamp(e, Math.max(0, Math.min(SURVIVOR_NOTES.length - 1, s.note ?? 0)));
      else {
        e.crate = crateModel();
        e.group.add(e.crate);
        e.falling = false;
        this.landCrate(e, true);
        if (e.looted) e.smoke = 0;
      }
    }
  }
}
