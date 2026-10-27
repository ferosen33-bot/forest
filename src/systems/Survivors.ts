import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import type { EventBus } from '../core/EventBus';
import { buildHarbor, harborWorld, type HarborLayout, type HarborModel } from '../world/Harbor';
import { FireEffect } from '../entities/FireEffect';
import { getItem, type ItemId } from '../entities/items/ItemDefs';
import { getQuest, QUESTS, type NpcId, type Quests } from './Quests';
import type { Inventory } from './Inventory';
import type { ItemService } from './ItemService';
import type { Skills } from './Skills';
import type { LightPool, LightRequest } from './LightPool';
import type { Audio } from './Audio';
import type { Avatar, CharacterId, CharacterLibrary } from '../entities/characters/CharacterLibrary';

/**
 * Die letzten Überlebenden in der Nordbucht: Lager am Fuß des Leuchtturms mit wärmendem Feuer
 * (die Schrate halten nachts Abstand), Leuchtfeuer, dessen Kegel nachts über die Insel streicht,
 * und drei Menschen, mit denen man reden kann – mit Aufträgen, Belohnungen und Geschichte.
 */

export interface NpcDef {
  id: NpcId;
  name: string;
  /** Wer sie sind (Antwort auf „Wer bist du?“). */
  who: string;
  /** Was sie über das Geschehene sagen. */
  lore: string;
  /** Begrüßung beim ersten bzw. bei späteren Treffen. */
  first: string;
  hello: string;
  look: { shirt: number; pants: number; skin: number; hair: number; scale: number; hat?: number };
  /** Animierte Figur (Mesh2Motion) und ihre Ruhebewegung. */
  figure: { model: CharacterId; idle: string };
}

export const NPCS: NpcDef[] = [
  {
    id: 'jonas',
    name: 'Jonas Petersen',
    who: 'Jonas Petersen. Mir gehörte die Tankstelle in Altwasser. Ich bin zum Steg gelaufen, wie alle – aber als ich ankam, war das Boot schon weg. Seitdem halte ich hier das Feuer am Brennen.',
    lore: 'Erst wurden die Bergleute krank, dann ihre Familien. Sie sind nachts in den Wald gegangen und als etwas anderes zurückgekommen. Das Festland hat die Insel gesperrt, statt zu helfen.',
    first: 'Bleib, wo du bist! … Du bist keiner von denen. Bei Gott – ein Mensch. Komm ans Feuer.',
    hello: 'Da bist du ja wieder. Das Feuer brennt, solange ich lebe.',
    look: { shirt: 0x4f5f6e, pants: 0x3a3f44, skin: 0xc49a7c, hair: 0x6b5a48, scale: 1.02, hat: 0x7a3f2a },
    figure: { model: 'male_10', idle: 'Idle_A' },
  },
  {
    id: 'albers',
    name: 'Dr. Imke Albers',
    who: 'Imke Albers, ich war die Ärztin hier. Ich habe die ersten Fälle behandelt und den Stollen schließen lassen – zu spät. Jetzt versuche ich herauszufinden, was es ist. Und ob man es aufhalten kann.',
    lore: 'Fieber, Lichtscheu, dann verstummen sie. Wer es in den Wald schafft, wird zum Schrat. Die, die sich in die Höhlen flüchteten, sind … bleicher geworden. Blind. Es ist dieselbe Krankheit, nur ein anderer Weg.',
    first: 'Oh. Sie sind gesund? Lassen Sie sich ansehen … Keine Erweiterung der Pupillen. Gut. Sehr gut.',
    hello: 'Wie geht es Ihnen? Kein Fieber, keine Kopfschmerzen? Gut.',
    look: { shirt: 0xd8d6cf, pants: 0x4a4d55, skin: 0xd8b49a, hair: 0x9a9690, scale: 0.97 },
    figure: { model: 'hazmat_female', idle: 'Idle_Subtle' },
  },
  {
    id: 'mia',
    name: 'Mia',
    who: 'Ich bin Mia. Ich bin acht. Mama hat gesagt, wir nehmen das letzte Boot, aber dann … Jonas passt jetzt auf mich auf.',
    lore: 'Herr Brandt hat an unser Fenster geklopft, mit so leuchtenden Augen. Papa hat die Fenster zugenagelt. Und dann ist Papa auch krank geworden.',
    first: 'Hallo … Bist du auch vom Flugzeug? Jonas sagt, Flugzeuge kommen keine mehr.',
    hello: 'Hast du heute Schrate gesehen? Ich nicht. Ich bleib beim Feuer.',
    look: { shirt: 0xb85a4a, pants: 0x3e5a7a, skin: 0xe0b89c, hair: 0x5a3a24, scale: 0.68 },
    figure: { model: 'female_9', idle: 'Shivering' },
  },
];

const NPC_BY_ID = new Map(NPCS.map((n) => [n.id, n]));
/** Bewegung beim Reden. */
const TALK = 'Idle_Talking';

/** Eine Wahl im Gespräch. */
export interface DialogueOption {
  text: string;
  /** Nach der Wahl: Antwort, ggf. weitere Optionen; `close` beendet das Gespräch. */
  run: () => { text?: string; close?: boolean };
}

export interface DialogueView {
  /** Gesprächspartner (Überlebende im Hafen oder der Begleiter). */
  npc: { id: string; name: string };
  text: string;
  options: DialogueOption[];
}

export interface SurvivorsSave {
  found: boolean;
  met: NpcId[];
}

export interface SurvivorsDeps {
  physics: Physics;
  layout: HarborLayout;
  quests: Quests;
  inventory: Inventory;
  items: ItemService;
  skills: Skills;
  lights: LightPool;
  audio: Audio;
  events: EventBus;
  markObstacle: (x: number, z: number, yaw: number, halfX: number, halfZ: number) => void;
  /** Animierte Figuren (fehlen sie, bleiben die Quader-Figuren). */
  characters?: CharacterLibrary | null;
  /** Ist der Kutter bereit und die Geschichte noch nicht zu Ende? */
  canDepart?: () => boolean;
  /** Ablegen: das Ende der Geschichte. */
  onDepart?: () => void;
}

interface Npc {
  def: NpcDef;
  root: THREE.Object3D;
  head: THREE.Object3D;
  arm: THREE.Object3D;
  yaw: number;
  talking: number;
  phase: number;
  /** Animierte Figur (falls geladen) mit Halsknochen und dessen lokaler Hochachse für den Blick. */
  avatar?: Avatar;
  neck?: THREE.Bone;
  neckAxis?: THREE.Vector3;
  neckRest?: THREE.Quaternion;
  lookYaw: number;
  talkWeight: number;
}

const skinMat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true });

function npcModel(d: NpcDef): { root: THREE.Group; head: THREE.Object3D; arm: THREE.Object3D } {
  const l = d.look;
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(l.scale);
  root.add(body);
  const shirt = skinMat(l.shirt);
  const pants = skinMat(l.pants);
  const skin = skinMat(l.skin);
  const hair = skinMat(l.hair);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.85, 0.18), pants);
    leg.position.set(s * 0.1, 0.43, 0);
    body.add(leg);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.26), shirt);
  torso.position.y = 1.16;
  body.add(torso);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.14), shirt);
  armL.position.set(-0.3, 1.14, 0);
  body.add(armL);
  // Rechter Arm am Schultergelenk (gestikuliert beim Reden).
  const arm = new THREE.Group();
  arm.position.set(0.3, 1.42, 0);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.14), shirt);
  armR.position.y = -0.28;
  arm.add(armR);
  body.add(arm);
  const head = new THREE.Group();
  head.position.y = 1.5;
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.27, 0.24), skin);
  face.position.y = 0.14;
  head.add(face);
  const hairCap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.26), hair);
  hairCap.position.set(0, 0.3, -0.01);
  head.add(hairCap);
  if (l.hat) {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 8), skinMat(l.hat));
    hat.position.y = 0.34;
    head.add(hat);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.14), skinMat(l.hat));
    brim.position.set(0, 0.3, 0.16);
    head.add(brim);
  }
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.01), skinMat(0x2a2420));
    eye.position.set(s * 0.055, 0.17, 0.121);
    head.add(eye);
  }
  body.add(head);
  root.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return { root, head, arm };
}

export class Survivors {
  readonly group = new THREE.Group();
  readonly layout: HarborLayout;
  found = false;
  private readonly met = new Set<NpcId>();
  private readonly npcs: Npc[] = [];
  private readonly byCollider = new Map<number, Npc>();
  private readonly model: HarborModel;
  private readonly fire = new FireEffect(0.8);
  private readonly fireLight: LightRequest;
  private readonly lampLight: LightRequest;
  private time = 0;
  private emberTimer = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  constructor(private readonly d: SurvivorsDeps) {
    this.layout = d.layout;
    this.model = buildHarbor(d.layout);
    this.group.add(this.model.group);
    this.group.name = 'Survivors';
    const body = d.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const s of this.model.colliders) {
      d.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(s.half.x, s.half.y, s.half.z)
          .setTranslation(s.position.x, s.position.y, s.position.z)
          .setRotation(s.quaternion)
          .setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
        body,
      );
      if (s.nav) d.markObstacle(s.position.x, s.position.z, s.yaw, s.half.x, s.half.z);
    }
    this.fire.object.position.copy(d.layout.center);
    this.group.add(this.fire.object);
    this.fireLight = { position: d.layout.center.clone().setY(d.layout.center.y + 0.9), color: new THREE.Color(0xff8a3a), intensity: 0, distance: 24 };
    this.lampLight = { position: this.model.lamp.clone(), color: new THREE.Color(0xfff0c0), intensity: 0, distance: 45 };

    NPCS.forEach((def, i) => {
      const spot = this.model.spots[i];
      const h = 1.7 * def.look.scale;
      let npc: Npc;
      if (d.characters?.has(def.figure.model)) {
        const avatar = d.characters.create(def.figure.model, h + 0.05);
        avatar.object.position.copy(spot.position);
        avatar.object.rotation.y = spot.yaw;
        this.group.add(avatar.object);
        for (const name of [def.figure.idle, TALK]) avatar.action(name)?.play();
        avatar.action(TALK)?.setEffectiveWeight(0);
        avatar.mixer.update(i * 0.9);
        avatar.object.updateMatrixWorld(true);
        const neck = avatar.bones.get('neck_01');
        const neckAxis = neck ? new THREE.Vector3(0, 1, 0).applyQuaternion(neck.getWorldQuaternion(new THREE.Quaternion()).invert()) : undefined;
        npc = { def, root: avatar.object, head: avatar.object, arm: avatar.object, yaw: spot.yaw, talking: 0, phase: i * 2.1, avatar, neck, neckAxis, neckRest: neck?.quaternion.clone(), lookYaw: 0, talkWeight: 0 };
      } else {
        const m = npcModel(def);
        m.root.position.copy(spot.position);
        m.root.rotation.y = spot.yaw;
        this.group.add(m.root);
        npc = { def, root: m.root, head: m.head, arm: m.arm, yaw: spot.yaw, talking: 0, phase: i * 2.1, lookYaw: 0, talkWeight: 0 };
      }
      this.npcs.push(npc);
      const c = d.physics.world.createCollider(
        RAPIER.ColliderDesc.capsule(h / 2 - 0.25, 0.25)
          .setTranslation(spot.position.x, spot.position.y + h / 2, spot.position.z)
          .setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
        body,
      );
      this.byCollider.set(c.handle, npc);
    });
  }

  /** Lagerfeuer (Wärme und Schutz vor Schraten). */
  get fireCenter(): THREE.Vector3 {
    return this.d.layout.center;
  }

  isNearFire(p: THREE.Vector3, radius = 5): boolean {
    return p.distanceTo(this.d.layout.center) < radius;
  }

  /** Überlebender mit dieser Id (oder undefined). */
  getDef(id: string): NpcDef | undefined {
    return NPCS.find((n) => n.id === id);
  }

  getNpc(collider: RAPIER.Collider): NpcDef | undefined {
    return this.byCollider.get(collider.handle)?.def;
  }

  /** Lichtkegel und Laternen: nachts an. */
  update(dt: number, viewer: THREE.Vector3, night: number): void {
    this.time += dt;
    const dist = viewer.distanceTo(this.d.layout.center);
    if (dist < 160) {
      this.fire.update(dt);
      this.fireLight.intensity = 34 * this.fire.flicker;
      this.d.lights.request(this.fireLight);
      this.emberTimer -= dt;
      if (this.emberTimer <= 0 && dist < 40) {
        this.emberTimer = 0.4 + Math.random() * 0.6;
        this.d.audio.play('crackle', { volume: 0.7, position: this.d.layout.center });
      }
    }
    const beam = this.model.beam;
    beam.visible = night > 0.3;
    if (beam.visible) {
      beam.rotation.y += dt * 0.5;
      this.lampLight.intensity = 30 * night;
      if (dist < 400) this.d.lights.request(this.lampLight);
    }
    // Leute: atmen, schauen den Spieler an, gestikulieren beim Reden.
    for (const n of this.npcs) {
      n.phase += dt;
      const toPlayer = Math.atan2(viewer.x - n.root.position.x, viewer.z - n.root.position.z);
      const near = viewer.distanceTo(n.root.position) < 7;
      let look = near ? toPlayer - n.yaw : 0;
      look = Math.atan2(Math.sin(look), Math.cos(look));
      n.talking = Math.max(0, n.talking - dt);
      if (n.avatar) {
        // Ruhebewegung ↔ Gesprächsbewegung überblenden, danach den Hals zum Spieler drehen.
        n.talkWeight += ((n.talking > 0 ? 1 : 0) - n.talkWeight) * Math.min(1, dt * 3);
        n.avatar.action(n.def.figure.idle)?.setEffectiveWeight(1 - n.talkWeight);
        n.avatar.action(TALK)?.setEffectiveWeight(n.talkWeight);
        if (n.neck && n.neckRest) n.neck.quaternion.copy(n.neckRest);
        n.avatar.mixer.update(dt);
        n.lookYaw += (THREE.MathUtils.clamp(look, -1.0, 1.0) - n.lookYaw) * Math.min(1, dt * 4);
        if (n.neck && n.neckAxis) n.neck.quaternion.multiply(this.tmpQ.setFromAxisAngle(n.neckAxis, n.lookYaw));
        continue;
      }
      n.head.rotation.y += (THREE.MathUtils.clamp(look, -1.1, 1.1) - n.head.rotation.y) * Math.min(1, dt * 4);
      n.root.children[0].position.y = Math.sin(n.phase * 1.5) * 0.008;
      n.arm.rotation.x = n.talking > 0 ? -0.6 - Math.sin(n.phase * 5) * 0.25 : -0.05;
    }
    if (!this.found && dist < (night > 0.5 ? 220 : 70)) {
      this.found = true;
      this.d.events.emit('hud:message', {
        text: night > 0.5 ? 'Ein Licht in der Nacht – der Leuchtturm in der Nordbucht. Da sind Menschen!' : 'Rauch über der Nordbucht – und ein Leuchtturm. Da sind Menschen!',
      });
      this.d.events.emit('harbor:found', {});
    }
  }

  // ---------------------------------------------------------------------------
  // Gespräche
  // ---------------------------------------------------------------------------

  /** Beginnt ein Gespräch: Begrüßung und Wahlmöglichkeiten. */
  talk(id: NpcId): DialogueView {
    const def = NPC_BY_ID.get(id)!;
    const first = !this.met.has(id);
    this.met.add(id);
    this.gesture(id);
    if (first) this.d.events.emit('npc:met', { id });
    return { npc: def, text: first ? def.first : def.hello, options: this.options(def) };
  }

  /** Wahlmöglichkeiten im aktuellen Zustand der Aufträge. */
  options(def: NpcDef): DialogueOption[] {
    const q = this.d.quests;
    const inv = this.d.inventory;
    const out: DialogueOption[] = [];
    if (def.id === 'jonas' && q.state('boat') === 'completed' && this.d.canDepart?.()) {
      out.push({
        text: '[Ablegen] Ich bin bereit. Bringen wir euch nach Hause.',
        run: () => {
          this.d.onDepart?.();
          return { close: true };
        },
      });
    }
    let offered = false;
    for (const quest of QUESTS.filter((x) => x.giver === def.id)) {
      const state = q.state(quest.id, inv);
      if (state === 'ready') {
        out.push({ text: `[Abgeben] ${quest.title}`, run: () => ({ text: this.turnIn(quest.id) }) });
      } else if (state === 'active') {
        const p = q.progress(quest.id, inv);
        out.push({ text: `Wegen „${quest.title}“ … (${p.have}/${p.need})`, run: () => ({ text: quest.waiting }) });
      } else if (state === 'available' && !offered) {
        // Ein Angebot nach dem anderen – laufende und fertige Aufträge erscheinen trotzdem alle.
        offered = true;
        out.push({
          text: 'Kann ich irgendwie helfen?',
          run: () => {
            q.accept(quest.id);
            this.d.audio.play('pickup', 0.6);
            this.d.events.emit('hud:message', { text: `Neuer Auftrag: ${quest.title}` });
            return { text: quest.offer };
          },
        });
      }
    }
    out.push({ text: 'Wer bist du?', run: () => ({ text: def.who }) });
    out.push({ text: 'Was ist hier passiert?', run: () => ({ text: def.lore }) });
    out.push({ text: 'Bis später.', run: () => ({ close: true }) });
    return out;
  }

  /** Auftrag abgeben: Abgabe-Gegenstände entnehmen, Belohnung geben. @returns Dankestext. */
  private turnIn(id: string): string {
    const quest = getQuest(id)!;
    const g = quest.goal;
    const take: [ItemId, number][] = g.type === 'deliver' ? g.items.map((c) => [c.item, c.count]) : g.type === 'collect' ? [[g.item, g.count]] : [];
    const reward = this.d.quests.complete(id, this.d.inventory);
    if (!reward) return quest.waiting;
    for (const [item, count] of take) this.d.inventory.remove(item, count);
    const at = this.tmp.copy(this.d.layout.center).setY(this.d.layout.center.y + 1);
    for (const [item, count] of reward.items) this.d.items.give(item, count, at);
    for (const [skill, xp] of reward.xp ?? []) this.d.skills.gain(skill, xp);
    this.d.audio.play('craft');
    this.d.events.emit('hud:message', { text: `Auftrag erledigt: ${quest.title} (${reward.items.map(([i, n]) => `${n}× ${getItem(i).name}`).join(', ')})` });
    this.d.events.emit('quest:completed', { id });
    return quest.thanks;
  }

  gesture(id: NpcId): void {
    const n = this.npcs.find((x) => x.def.id === id);
    if (n) n.talking = 2.5;
  }

  /** Kartenmarkierung (sobald gefunden). */
  marker(): { x: number; z: number } | null {
    if (!this.found) return null;
    const p = harborWorld(this.d.layout, this.d.layout.lighthouse.x, this.d.layout.lighthouse.z);
    return { x: p.x, z: p.z };
  }

  serialize(): SurvivorsSave {
    return { found: this.found, met: [...this.met] };
  }

  load(d: SurvivorsSave): void {
    this.found = d.found === true;
    for (const id of d.met ?? []) if (NPC_BY_ID.has(id)) this.met.add(id);
  }
}
