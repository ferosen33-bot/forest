import * as THREE from 'three';
import type { Avatar, CharacterId, CharacterLibrary } from './CharacterLibrary';
import type { EnemyKind } from '../enemies/EnemyKinds';
import type { EnemyRig } from '../enemies/EnemyRig';
import { LIMB_BONES, LIMBS, type Limb } from '../enemies/Gore';

/**
 * Darstellung der Schrate als animierte Figuren. Die KI und das bisherige Prozedur-Skelett bleiben
 * unverändert (Sichtlinien, Schritte, Trefferzonen); hier wird nur ihr Zustand – Tempo, Angriff,
 * Treffer, Schrei, Tod – in überblendete Bewegungen übersetzt.
 */

interface Cast {
  /** Figuren, aus denen je Gegner eine gewählt wird. */
  models: CharacterId[];
  idle: string;
  walk: string;
  run: string;
  attack: string;
  /** Tempo (m/s), bei dem Geh- bzw. Laufanimation ohne Beschleunigung passt. */
  walkSpeed: number;
  runSpeed: number;
}

const CAST: Record<EnemyKind, Cast> = {
  schrat: {
    models: ['monster_5', 'killer_6', 'killer_4', 'monster', 'killer_7'],
    idle: 'Zombie_Idle_Crouch',
    walk: 'Zombie_Walk_2',
    run: 'Sprint',
    attack: 'Melee_Hook',
    walkSpeed: 1.1,
    runSpeed: 5.5,
  },
  spaeher: {
    models: ['monster_3'],
    idle: 'Idle_A',
    walk: 'Walk_Stealth',
    run: 'Sprint',
    attack: 'OverhandThrow',
    walkSpeed: 1.2,
    runSpeed: 5.5,
  },
  koloss: {
    models: ['killer_5'],
    idle: 'Idle_A',
    walk: 'Walk_Large',
    run: 'Jog',
    attack: 'Punch_Cross',
    walkSpeed: 1.2,
    runSpeed: 3.2,
  },
  // Verwandelte Dorfbewohner: der Polizist und ein junger Mann aus dem Ort, bleich und gebückt.
  hetzer: {
    models: ['police_male', 'male_15'],
    idle: 'Zombie_Idle',
    walk: 'Zombie_Walk',
    run: 'Sprint',
    attack: 'Zombie_Scratch',
    walkSpeed: 1.1,
    runSpeed: 6.5,
  },
  // Ihr „Angriff“ aus der Ferne ist der Schrei.
  schreier: {
    models: ['female_8'],
    idle: 'Idle_Subtle',
    walk: 'Walk_Female',
    run: 'Run_Female',
    attack: 'Zombie Yell',
    walkSpeed: 1.1,
    runSpeed: 4.5,
  },
  hansen: {
    models: ['hazmat_suit_male'],
    idle: 'Zombie_Idle',
    walk: 'Walk_Large',
    run: 'Walk_Large',
    attack: 'Attack_Ground_Pound',
    walkSpeed: 1.6,
    runSpeed: 2.4,
  },
  kriecher: {
    models: ['monster_4'],
    idle: 'Zombie_Idle_Crouch',
    walk: 'Crawl',
    run: 'Crawl',
    attack: 'Punch_Jab',
    walkSpeed: 0.8,
    runSpeed: 0.8,
  },
};

const KIND_TINT: Partial<Record<EnemyKind, [number, number, number]>> = {
  hetzer: [0.82, 0.84, 0.8],
  schreier: [0.9, 0.9, 0.92],
  hansen: [0.42, 0.55, 0.38],
};

const DEATHS = ['Death_A', 'Death_B', 'Death_C', 'Death_D'];
const HIT = 'Hit_Chest';
const YELL = 'Zombie Yell';
/** Aufrappeln nach dem Umwerfen. */
const RISE = 'Zombie_Rise';
/** Ohne Bein: kriechen. */
const CRAWL = 'Crawl';

/** Dicke am Schnitt (m bei 1,8 m Körpergröße): Hals, Ober-/Unterarm, Ober-/Unterschenkel. */
const CUT_RADIUS: Record<Limb, { high: number; low: number }> = {
  head: { high: 0.06, low: 0.06 },
  armL: { high: 0.05, low: 0.042 },
  armR: { high: 0.05, low: 0.042 },
  legL: { high: 0.075, low: 0.058 },
  legR: { high: 0.075, low: 0.058 },
};
/** Knochen für Wunden: Knochen → Nachfolger (Segment) und Dicke (m bei 1,8 m). */
const WOUND_BONES: [string, string, number][] = [
  ['pelvis', 'spine_01', 0.13],
  ['spine_01', 'spine_02', 0.13],
  ['spine_02', 'spine_03', 0.14],
  ['spine_03', 'neck_01', 0.13],
  ['neck_01', 'head', 0.055],
  ['head', 'head_leaf', 0.09],
  ['upperarm_l', 'lowerarm_l', 0.05],
  ['lowerarm_l', 'hand_l', 0.042],
  ['upperarm_r', 'lowerarm_r', 0.05],
  ['lowerarm_r', 'hand_r', 0.042],
  ['thigh_l', 'calf_l', 0.075],
  ['calf_l', 'foot_l', 0.058],
  ['thigh_r', 'calf_r', 0.075],
  ['calf_r', 'foot_r', 0.058],
];
const MAX_WOUNDS = 10;

const FLESH = new THREE.MeshStandardMaterial({ color: 0x5e0d0b, roughness: 0.28 });
const FLESH_DARK = new THREE.MeshStandardMaterial({ color: 0x3e0605, roughness: 0.3 });
const BONE = new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.6 });
const WOUND_BRUISE = new THREE.MeshStandardMaterial({ color: 0x3a0a14, roughness: 0.5 });
const SPHERE = new THREE.SphereGeometry(1, 12, 8);

/** Blutiger Stumpf: rohes Fleisch mit dem Knochen in der Mitte (Größe in Metern). */
function createStump(radius: number): THREE.Group {
  const g = new THREE.Group();
  const flesh = new THREE.Mesh(SPHERE, FLESH);
  flesh.scale.setScalar(radius * 0.85);
  const rim = new THREE.Mesh(SPHERE, FLESH_DARK);
  rim.scale.setScalar(radius * 1.08);
  rim.scale.y = radius * 0.5;
  const bone = new THREE.Mesh(SPHERE, BONE);
  bone.scale.setScalar(radius * 0.38);
  bone.position.y = radius * 0.55;
  g.add(flesh, rim, bone);
  return g;
}

/** Weltmaßstab eines Knochens (Figuren sind in Modelleinheiten skaliert). */
const worldScale = (o: THREE.Object3D): number => new THREE.Vector3().setFromMatrixScale(o.matrixWorld).x;

/** Abstand eines Punkts zur Strecke a–b; `t` wird auf den Anteil entlang der Strecke gesetzt. */
function segmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out?: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(p, a).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
  const c = a.clone().addScaledVector(ab, t);
  out?.copy(c);
  return c.distanceTo(p);
}

/** Abgetrenntes Körperteil: eigene Figur in eingefrorener Pose, nur das Glied ist sichtbar. */
export interface SeveredPart {
  object: THREE.Object3D;
  /** Schnittstelle und Ende des Glieds (Welt). */
  joint: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
  dispose(): void;
}
/** Körperhöhe eines Schrats bei Skalierung 1 (wie das Prozedur-Skelett). */
const BASE_HEIGHT = 1.8;

export interface AvatarTarget {
  id: number;
  rig: EnemyRig;
  kind: EnemyKind;
  tone: number;
  /** Werfer (Späher) nutzen beim Angriff die Wurfbewegung. */
  ranged: boolean;
  dead: boolean;
  severed: ReadonlySet<Limb>;
  crawling: boolean;
}

interface Driven {
  avatar: Avatar;
  kind: EnemyKind;
  model: CharacterId;
  height: number;
  tint: THREE.Color;
  /** Abgetrennte Glieder und wo geschnitten wurde; Stümpfe, die schon sitzen; Zahl der Wunden. */
  cuts: Map<Limb, 'high' | 'low'>;
  stumps: Set<Limb>;
  wounds: number;
  death: string;
  wasDead: boolean;
  /** Liegt gerade umgeworfen am Boden (die Fall-Animation läuft einmal ab). */
  downed: boolean;
  hitTimer: number;
  lastHit: number;
  weights: Map<string, number>;
  used: boolean;
  /** Fernoptimierung: Mischer seltener aktualisieren. */
  pending: number;
}

const damp = (a: number, b: number, rate: number, dt: number) => b + (a - b) * Math.exp(-rate * dt);

export class EnemyAvatars {
  readonly group = new THREE.Group();
  private readonly driven = new Map<number, Driven>();
  private readonly tint = new THREE.Color();

  constructor(private readonly lib: CharacterLibrary) {
    this.group.name = 'EnemyAvatars';
  }

  /** Jedes Bild: alle sichtbaren Gegner darstellen; nicht mehr vorhandene werden entfernt. */
  render(targets: AvatarTarget[], dt: number, viewer: THREE.Vector3): void {
    for (const d of this.driven.values()) d.used = false;
    for (const t of targets) {
      let d = this.driven.get(t.id);
      if (!d) {
        d = this.create(t);
        this.driven.set(t.id, d);
      }
      d.used = true;
      this.drive(d, t, dt, viewer);
    }
    for (const [id, d] of this.driven) {
      if (!d.used) {
        d.avatar.dispose();
        this.driven.delete(id);
      }
    }
  }

  get count(): number {
    return this.driven.size;
  }

  private create(t: AvatarTarget): Driven {
    const cast = CAST[t.kind];
    const model = cast.models[t.id % cast.models.length];
    // Leichte Farbvariation je Gegner (wie früher die Hauttöne)
    const v = 0.85 + ((t.tone * 37 + t.id * 11) % 7) * 0.03;
    // Verwandelte sind fahl und grau, Hansen ist von Pilzen grünlich durchzogen.
    const [r, g, b] = KIND_TINT[t.kind] ?? [1, 0.98, 0.95];
    this.tint.setRGB(v * r, v * g, v * b);
    const avatar = this.lib.create(model, BASE_HEIGHT * t.rig.scale, { eyes: true, tint: this.tint });
    this.group.add(avatar.object);
    for (const name of [cast.idle, cast.walk, cast.run, cast.attack, HIT, YELL, RISE, CRAWL]) {
      const a = avatar.action(name);
      if (a) {
        a.play();
        a.setEffectiveWeight(0);
      }
    }
    // Phase je Gegner versetzen, damit eine Horde nicht im Gleichschritt geht.
    avatar.mixer.update((t.id * 0.37) % 2);
    return {
      avatar,
      kind: t.kind,
      model,
      height: BASE_HEIGHT * t.rig.scale,
      tint: this.tint.clone(),
      cuts: new Map(),
      stumps: new Set(),
      wounds: 0,
      death: DEATHS[t.id % DEATHS.length],
      wasDead: false,
      downed: false,
      hitTimer: 0,
      lastHit: 0,
      weights: new Map(),
      used: true,
      pending: 0,
    };
  }

  private drive(d: Driven, t: AvatarTarget, dt: number, viewer: THREE.Vector3): void {
    const cast = CAST[t.kind];
    const a = t.rig.anim;
    const obj = d.avatar.object;
    obj.position.copy(t.rig.root.position);
    obj.quaternion.copy(t.rig.root.quaternion);

    // Ferne Figuren seltener rechnen (spart bei Horden viel Zeit).
    const dist = obj.position.distanceTo(viewer);
    d.pending += dt;
    const step = dist > 70 ? 0.1 : dist > 35 ? 0.05 : 0;
    if (d.pending < step) return;
    const frame = d.pending;
    d.pending = 0;

    const weights = d.weights;
    const target = new Map<string, number>();
    const add = (name: string, w: number) => target.set(name, (target.get(name) ?? 0) + w);
    if (t.dead || a.death >= 0) {
      if (!d.wasDead) {
        d.wasDead = true;
        const death = d.avatar.action(d.death);
        // Wer schon am Boden liegt, bleibt einfach liegen.
        if (death && !d.downed) {
          death.reset();
          death.timeScale = 1;
          death.setLoop(THREE.LoopOnce, 1);
          death.clampWhenFinished = true;
          death.play();
        }
      }
      target.set(d.death, 1);
    } else if (a.down >= 0) {
      // Umgeworfen: fällt hin wie ein Toter, bleibt liegen und rappelt sich dann auf.
      if (a.rise >= 0) {
        const rise = d.avatar.action(RISE);
        if (rise) {
          rise.time = Math.min(0.999, a.rise) * rise.getClip().duration;
          rise.timeScale = 0;
          target.set(RISE, 1);
        }
      } else {
        if (!d.downed) {
          d.downed = true;
          const fall = d.avatar.action(d.death);
          if (fall) {
            fall.reset();
            fall.setLoop(THREE.LoopOnce, 1);
            fall.clampWhenFinished = true;
            fall.timeScale = 1.6;
            fall.play();
          }
        }
        target.set(d.death, 1);
      }
    } else {
      d.downed = false;
      // Treffer: kurzes Zusammenzucken
      const hit = t.rig.hitPulse;
      if (hit > 0.6 && d.lastHit <= 0.6) {
        d.hitTimer = 0.35;
        d.avatar.action(HIT)?.reset().play();
      }
      d.lastHit = hit;
      d.hitTimer = Math.max(0, d.hitTimer - frame);

      if (t.crawling) {
        // Ohne Bein: kriechen – beim Angriff hastiger.
        const crawl = d.avatar.action(CRAWL);
        if (crawl) crawl.timeScale = a.attack >= 0 ? 2.2 : THREE.MathUtils.clamp(a.speed / 0.5, 0.15, 2.2);
        target.set(CRAWL, 1);
      } else if (a.attack >= 0) {
        // Angriff: die Bewegung folgt genau dem Fortschritt der KI (Treffer im richtigen Moment).
        const atk = d.avatar.action(cast.attack);
        if (atk) {
          atk.time = Math.min(0.999, a.attack) * atk.getClip().duration;
          atk.timeScale = 0;
        }
        target.set(cast.attack, 1);
      } else if (d.hitTimer > 0) {
        target.set(HIT, 1);
      } else if (a.alert > 0.6 && a.speed < 0.6 && t.kind !== 'kriecher') {
        target.set(YELL, 1);
      } else {
        const speed = a.speed;
        const run = THREE.MathUtils.smoothstep(speed, 2.2, 3.6);
        const move = THREE.MathUtils.smoothstep(speed, 0.15, 0.7);
        add(cast.idle, 1 - move);
        add(cast.walk, move * (1 - run));
        add(cast.run, move * run);
        const walk = d.avatar.action(cast.walk);
        if (walk) walk.timeScale = THREE.MathUtils.clamp(speed / cast.walkSpeed, 0.6, 2.2);
        const runA = d.avatar.action(cast.run);
        if (runA && cast.run !== cast.walk) runA.timeScale = THREE.MathUtils.clamp(speed / cast.runSpeed, 0.6, 1.6);
      }
    }

    // Gewichte weich überblenden
    const names = new Set([...weights.keys(), ...target.keys()]);
    for (const name of names) {
      const action = d.avatar.action(name);
      if (!action) continue;
      const w = damp(weights.get(name) ?? 0, target.get(name) ?? 0, name === d.death ? 14 : 9, frame);
      weights.set(name, w);
      action.setEffectiveWeight(w);
      if (!action.isRunning() && w > 0.001 && name !== d.death) action.play();
    }
    d.avatar.mixer.update(frame);
    this.applyCuts(d, t);
  }

  /** Abgetrennte Glieder fallen im Gelenk zusammen (Knochen auf null skaliert), dort sitzt ein Stumpf. */
  private applyCuts(d: Driven, t: AvatarTarget): void {
    for (const limb of t.severed) if (!d.cuts.has(limb)) d.cuts.set(limb, 'low');
    for (const [limb, level] of d.cuts) {
      const bone = d.avatar.bones.get(LIMB_BONES[limb][level]);
      if (!bone) continue;
      bone.scale.setScalar(1e-4);
      if (d.stumps.has(limb) || !bone.parent) continue;
      d.stumps.add(limb);
      d.avatar.object.updateMatrixWorld(true);
      const stump = createStump(1);
      stump.position.copy(bone.position);
      stump.scale.setScalar((CUT_RADIUS[limb][level] * d.height) / 1.8 / worldScale(bone.parent));
      bone.parent.add(stump);
    }
  }

  /** Schnittstelle eines abgetrennten Glieds am Körper (Welt), solange die Figur sichtbar ist. */
  jointPosition(id: number, limb: Limb, out: THREE.Vector3): THREE.Vector3 | null {
    const d = this.driven.get(id);
    const level = d?.cuts.get(limb);
    const bone = level ? d!.avatar.bones.get(LIMB_BONES[limb][level]) : undefined;
    return bone ? bone.getWorldPosition(out) : null;
  }

  /** Welches Glied liegt einem Trefferpunkt am nächsten (null = Rumpf)? */
  nearestLimb(id: number, point: THREE.Vector3): { limb: Limb; level: 'high' | 'low' } | null {
    const d = this.driven.get(id);
    if (!d) return null;
    const bones = d.avatar.bones;
    const pos = (name: string) => bones.get(name)?.getWorldPosition(new THREE.Vector3()) ?? null;
    let best: { limb: Limb; level: 'high' | 'low' } | null = null;
    let bestD = Infinity;
    // Rumpf zuerst: Wer ihn trifft, trennt nichts ab.
    const pelvis = pos('pelvis');
    const chest = pos('spine_03');
    if (pelvis && chest) bestD = segmentDistance(point, pelvis, chest) - 0.06 * (d.height / 1.8);
    for (const limb of LIMBS) {
      if (d.cuts.has(limb)) continue;
      const b = LIMB_BONES[limb];
      const high = pos(limb === 'head' ? 'neck_01' : b.high);
      const low = pos(b.low);
      const end = pos(b.end);
      if (!high || !low || !end) continue;
      const upper = segmentDistance(point, high, low);
      const lower = segmentDistance(point, low, end);
      if (upper < bestD) {
        bestD = upper;
        best = { limb, level: 'high' };
      }
      if (lower < bestD) {
        bestD = lower;
        best = { limb, level: 'low' };
      }
    }
    return best;
  }

  /**
   * Trennt ein Glied ab: Am Körper fällt es im Gelenk zusammen, und eine eigene Figur in der aktuellen
   * Pose zeigt nur das abgetrennte Stück (der Rest fällt in die Schnittstelle zusammen).
   */
  cut(id: number, limb: Limb, level: 'high' | 'low'): SeveredPart | null {
    const d = this.driven.get(id);
    if (!d || d.cuts.has(limb)) return null;
    d.cuts.set(limb, level);
    const src = d.avatar;
    const part = this.lib.create(d.model, d.height, { eyes: limb === 'head', tint: d.tint });
    part.object.position.copy(src.object.position);
    part.object.quaternion.copy(src.object.quaternion);
    for (const [name, b] of src.bones) {
      const pb = part.bones.get(name);
      if (!pb) continue;
      pb.position.copy(b.position);
      pb.quaternion.copy(b.quaternion);
      pb.scale.copy(b.scale);
    }
    this.group.add(part.object);
    part.object.updateMatrixWorld(true);
    const cutBone = part.bones.get(LIMB_BONES[limb][level]);
    const endBone = part.bones.get(LIMB_BONES[limb].end);
    const root = part.bones.get('root') ?? part.bones.get('pelvis');
    if (!cutBone || !endBone || !root?.parent) {
      part.dispose();
      return null;
    }
    // Andere abgetrennte Glieder sind auch am Teil nicht mehr dran.
    for (const [other, l] of d.cuts) if (other !== limb) part.bones.get(LIMB_BONES[other][l])?.scale.setScalar(1e-4);
    const joint = cutBone.getWorldPosition(new THREE.Vector3());
    const end = endBone.getWorldPosition(new THREE.Vector3());
    // Glied vom Skelett lösen (Weltlage bleibt), den Rest in die Schnittstelle zusammenfallen lassen.
    part.object.attach(cutBone);
    root.parent.updateMatrixWorld(true);
    root.position.copy(root.parent.worldToLocal(joint.clone()));
    root.scale.setScalar(1e-4);
    part.object.updateMatrixWorld(true);
    const radius = (CUT_RADIUS[limb][level] * d.height) / 1.8;
    const stump = createStump(1);
    stump.scale.setScalar(radius / worldScale(cutBone));
    cutBone.add(stump);
    for (const m of part.meshes) m.castShadow = true;
    return { object: part.object, joint, end, radius, dispose: () => part.dispose() };
  }

  /** Wunde am Körper: blutiger Riss (Klinge) oder dunkle Quetschung (Wucht) am nächsten Knochen. */
  wound(id: number, point: THREE.Vector3, cut: boolean, size: number): void {
    const d = this.driven.get(id);
    if (!d || d.wounds >= MAX_WOUNDS) return;
    const bones = d.avatar.bones;
    const k = d.height / 1.8;
    let best: { bone: THREE.Bone; at: THREE.Vector3; radius: number } | null = null;
    let bestD = Infinity;
    const at = new THREE.Vector3();
    for (const [a, b, r] of WOUND_BONES) {
      const ba = bones.get(a);
      const bb = bones.get(b);
      if (!ba || !bb || ba.scale.x < 0.01) continue;
      const dist = segmentDistance(point, ba.getWorldPosition(new THREE.Vector3()), bb.getWorldPosition(new THREE.Vector3()), at) - r * k;
      if (dist < bestD) {
        bestD = dist;
        best = { bone: ba, at: at.clone(), radius: r * k };
      }
    }
    if (!best) return;
    d.wounds++;
    // Auf die Körperoberfläche, zur Trefferseite hin.
    const dir = point.clone().sub(best.at);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const mesh = new THREE.Mesh(SPHERE, cut ? FLESH : WOUND_BRUISE);
    mesh.position.copy(best.at).addScaledVector(dir, best.radius * 0.82);
    mesh.lookAt(mesh.position.clone().add(dir));
    const w = size * k;
    // Klingen reißen lange Schnitte, Wucht hinterlässt runde Quetschungen.
    mesh.scale.set(cut ? w * 1.6 : w, cut ? w * 0.32 : w * 0.9, w * 0.35);
    mesh.rotateZ(Math.random() * Math.PI);
    best.bone.attach(mesh);
  }

  dispose(): void {
    for (const d of this.driven.values()) d.avatar.dispose();
    this.driven.clear();
  }
}
