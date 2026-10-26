import * as THREE from 'three';
import type { AnimalAnim } from './AnimalRig';

/**
 * Prozedurale Bewegung des Wolfsmodells. Das CC0-Modell bringt ein Skelett, aber keine Animationen
 * mit – Gangarten, Anschleichen, Biss, Heulen, Fressen und Sterben entstehen hier aus dem Zustand der KI.
 *
 * Alle Drehungen werden im Raum des Modells angegeben (X = seitlich, Y = oben, Z = vorne) und für jeden
 * Knochen über seine Ruhelage in dessen eigenes System umgerechnet – so spielen die beliebigen
 * Knochenrollen des Modells keine Rolle.
 *
 * Gangarten (Phasen der Beine, 0..1):
 * - Schritt: hinten links, vorne links, hinten rechts, vorne rechts (je eine Viertelphase versetzt),
 * - Trab: diagonale Paare gleichzeitig,
 * - Galopp: Hinterläufe kurz nacheinander, dann die Vorderläufe – mit federndem Rücken.
 */

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

type LegId = 'LF' | 'RF' | 'LH' | 'RH';
const LEGS: LegId[] = ['LF', 'RF', 'LH', 'RH'];
const WALK: Record<LegId, number> = { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 };
const TROT: Record<LegId, number> = { LH: 0, RF: 0, RH: 0.5, LF: 0.5 };
const GALLOP: Record<LegId, number> = { LH: 0, RH: 0.12, RF: 0.45, LF: 0.57 };

interface Joint {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  /** Ruhelage im Modellraum (zum Umrechnen der Achsen). */
  restWorldInv: THREE.Quaternion;
}

const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

export class WolfPose {
  private readonly joints = new Map<string, Joint>();
  private phase = Math.random();
  private time = Math.random() * 10;
  private readonly q = new THREE.Quaternion();
  private readonly qa = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  /** Gedämpfte Werte, damit Übergänge weich bleiben. */
  private speed = 0;
  private stalk = 0;
  private chew = 0;
  /** Drehpunkt für Sturz und Sprung (liegt in Körperhöhe). */
  readonly pivot = new THREE.Group();

  constructor(
    model: THREE.Object3D,
    private readonly bodyHeight: number,
  ) {
    model.updateMatrixWorld(true);
    const rootInv = new THREE.Quaternion();
    model.getWorldQuaternion(rootInv).invert();
    model.traverse((o) => {
      const bone = o as THREE.Bone;
      if (!bone.isBone) return;
      const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInv);
      this.joints.set(bone.name, { bone, rest: bone.quaternion.clone(), restWorldInv: world.invert() });
    });
    // Modell an den Drehpunkt hängen: Pivot in Körperhöhe, Modell darunter.
    const parent = model.parent;
    this.pivot.position.y = bodyHeight;
    model.position.y -= bodyHeight;
    parent?.add(this.pivot);
    this.pivot.add(model);
  }

  /** Knochen auf die Ruhelage zurücksetzen und dann Drehungen im Modellraum anhängen. */
  private set(name: string, rotations: [THREE.Vector3, number][]): void {
    const j = this.joints.get(name);
    if (!j) return;
    j.bone.quaternion.copy(j.rest);
    for (const [axis, angle] of rotations) {
      if (angle === 0) continue;
      this.axis.copy(axis).applyQuaternion(j.restWorldInv);
      j.bone.quaternion.multiply(this.qa.setFromAxisAngle(this.axis, angle));
    }
  }

  update(dt: number, a: AnimalAnim, scale: number): void {
    this.time += dt;
    const v = a.speed / scale;
    this.speed += (v - this.speed) * Math.min(1, dt * 6);
    const sp = this.speed;
    this.stalk += ((a.alert > 0.5 ? 1 : 0) - this.stalk) * Math.min(1, dt * 3);
    const moving = smooth(0.08, 0.6, sp);
    const trot = smooth(1.8, 3.4, sp);
    const gallop = smooth(5, 7, sp);
    const dead = a.death >= 0 ? 1 - (1 - Math.min(1, a.death)) ** 3 : 0;

    // Schrittfrequenz (Doppelschritte je Sekunde)
    this.phase += dt * (1 + 0.27 * sp) * moving;
    const amp = (0.22 + 0.05 * sp) * moving * (1 - 0.25 * this.stalk * (1 - trot));

    for (const leg of LEGS) {
      const off = THREE.MathUtils.lerp(THREE.MathUtils.lerp(WALK[leg], TROT[leg], trot), GALLOP[leg], gallop);
      const u = (this.phase + off) % 1;
      const s = Math.sin(u * Math.PI * 2);
      const swing = Math.max(0, -Math.cos(u * Math.PI * 2)) * moving;
      const front = leg[1] === 'F';
      const side = leg[0] === 'L' ? 'Left' : 'Right';
      const reach = s * amp * (front ? 1 : 1.1);
      if (dead > 0) {
        // Liegend: Beine gestreckt und etwas nach vorne.
        const r = -0.25 * dead;
        this.set(front ? `b_${side}UpperArm` : `b_${side}Leg01`, [[X, r]]);
        this.set(front ? `b_${side}ForeArm` : `b_${side}Leg02`, [[X, 0.1 * dead]]);
        this.set(front ? `b_${side}Hand01` : `b_${side}Foot01`, [[X, 0.2 * dead]]);
        continue;
      }
      // Geduckt: Beine stärker angewinkelt, Körper tiefer.
      const crouch = this.stalk * 0.18;
      if (front) {
        this.set(`b_${side}UpperArm`, [[X, reach - crouch * 0.6]]);
        this.set(`b_${side}ForeArm`, [[X, swing * (0.35 + 0.3 * gallop) + crouch]]);
        this.set(`b_${side}Hand01`, [[X, swing * (1.1 + 0.4 * gallop)]]);
      } else {
        this.set(`b_${side}Leg01`, [[X, reach - crouch]]);
        this.set(`b_${side}Leg02`, [[X, swing * (0.6 + 0.3 * gallop) + crouch * 1.6]]);
        this.set(`b_${side}Foot01`, [[X, -swing * (0.7 + 0.3 * gallop) - crouch * 0.8]]);
      }
    }

    // Rücken: beim Galopp beugt und streckt er sich, im Stand atmet er.
    const flex = Math.sin(this.phase * Math.PI * 2) * 0.12 * gallop;
    const breath = Math.sin(this.time * 2.2) * 0.012 * (1 - moving);
    this.set('b_Spine01', [[X, flex + breath]]);
    this.set('b_Spine02', [[X, flex * 0.6 - breath]]);

    // Hals und Kopf
    const attack = a.attack >= 0 ? a.attack : -1;
    const lunge = attack >= 0 ? Math.sin(Math.PI * Math.min(1, attack)) : 0;
    this.chew += dt * 7;
    let neck = 0.05 + this.stalk * 0.7 + gallop * 0.25 + a.graze * 0.95 - a.howl * 0.95 - lunge * 0.15;
    let head = -this.stalk * 0.45 - gallop * 0.1 + a.graze * 0.25 - a.howl * 0.35 + lunge * 0.1;
    neck += dead * 0.4;
    head += dead * 0.2;
    const look = a.lookYaw * (1 - dead);
    this.set('b_Neck', [[Y, look * 0.5], [X, neck]]);
    this.set('b_Head', [[Y, look * 0.4], [X, head]]);
    // Kiefer: Biss (weit auf, dann zuschnappen), Heulen, Kauen, Zähnefletschen beim Anschleichen.
    const bite = attack >= 0 ? (attack < 0.45 ? attack / 0.45 : Math.max(0, 1 - (attack - 0.45) / 0.12)) : 0;
    const jaw = bite * 0.55 + a.howl * 0.35 + a.graze * (0.08 + 0.08 * Math.sin(this.chew)) + this.stalk * 0.06 + dead * 0.15;
    this.set('b_Jaw', [[X, jaw]]);

    // Rute: hängt locker, beim Anschleichen tief, im Lauf gestreckt
    const tail = -0.55 + 0.35 * moving + 0.3 * gallop - 0.25 * this.stalk + 0.25 * dead;
    const wag = Math.sin(this.time * 2.5) * 0.08 * (1 - moving) + Math.sin(this.phase * Math.PI * 4) * 0.05 * moving;
    this.set('b_Tail01', [[X, tail], [Y, wag]]);
    this.set('b_Tail02', [[X, tail * 0.35], [Y, wag]]);
    this.set('b_Tail03', [[X, -0.1 + 0.1 * moving], [Y, wag * 0.6]]);

    // Körper: Auf und Ab, geduckter Gang, Sprung beim Biss, Sturz zur Seite.
    const h = this.bodyHeight;
    const bob = Math.abs(Math.sin(this.phase * Math.PI * 2)) * 0.03 * h * (trot + gallop) * moving;
    const low = this.stalk * 0.12 * h;
    this.pivot.position.set(0, h + bob - low + lunge * 0.08 * h, lunge * 0.35 * h);
    this.pivot.rotation.set(-lunge * 0.12 + Math.sin(this.phase * Math.PI * 2) * 0.04 * gallop, 0, 0);
    if (dead > 0) {
      // Zur Seite kippen; der Rumpf liegt danach knapp über dem Boden.
      this.q.setFromAxisAngle(Z, dead * Math.PI * 0.48);
      this.pivot.quaternion.copy(this.q);
      this.pivot.position.y = h + (0.32 * h - h) * dead;
    }
  }
}
