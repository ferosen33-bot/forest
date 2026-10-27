import * as THREE from 'three';
import type { Avatar, CharacterId, CharacterLibrary } from './CharacterLibrary';
import type { EnemyKind } from '../enemies/EnemyKinds';
import type { EnemyRig } from '../enemies/EnemyRig';

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
}

interface Driven {
  avatar: Avatar;
  kind: EnemyKind;
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
    for (const name of [cast.idle, cast.walk, cast.run, cast.attack, HIT, YELL, RISE]) {
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

      if (a.attack >= 0) {
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
  }

  dispose(): void {
    for (const d of this.driven.values()) d.avatar.dispose();
    this.driven.clear();
  }
}
