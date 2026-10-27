import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp, smoothstep } from '../../utils/math';
import { jitter } from '../../world/VegetationGeometry';

/** Körperteil-Typen. Jeder Typ wird für alle Gegner als ein InstancedMesh gerendert. */
export type PartType = 'torso' | 'head' | 'eyes' | 'hips' | 'upperArm' | 'forearm' | 'thigh' | 'shin' | 'club';

/**
 * Geometrien der Körperteile. Jede ist so verschoben, dass ihr Ursprung im Gelenk
 * (Drehpunkt) liegt – die Teilmatrix ist dann einfach die Weltmatrix des Knochens.
 * Blickrichtung des Modells: +Z.
 */
function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  return g;
}

/** Konisches Glied (oben → unten), hängt vom Gelenk nach unten. */
function limb(rTop: number, rBottom: number, length: number, segments = 6, depth = 1): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, length, segments, 1).toNonIndexed();
  g.scale(1, 1, depth);
  g.translate(0, -length / 2, 0);
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  g.computeVertexNormals();
  return g;
}

/** Hagerer Schädel: gestreckter, leicht verbeulter Ikosaeder mit Kiefer und Wangenknochen. */
function skull(): THREE.BufferGeometry {
  const head = jitter(new THREE.IcosahedronGeometry(0.13, 1), 0.012, 31);
  head.scale(0.85, 1.12, 1.0);
  head.translate(0, 0.15, 0.01);
  const jaw = new THREE.CylinderGeometry(0.07, 0.04, 0.09, 6).toNonIndexed();
  jaw.scale(1, 1, 0.9);
  jaw.translate(0, 0.04, 0.06);
  const brow = box(0.2, 0.035, 0.05, 0, 0.19, 0.1);
  return merge([head, jaw, brow]);
}

function torso(): THREE.BufferGeometry {
  // Breite Schultern, schmale Taille, abgeflacht (Brust/Rücken).
  const chest = new THREE.CylinderGeometry(0.22, 0.14, 0.56, 7, 1).toNonIndexed();
  chest.scale(1, 1, 0.62);
  chest.translate(0, 0.3, 0);
  const shoulders = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6).toNonIndexed();
  shoulders.rotateZ(Math.PI / 2);
  shoulders.translate(0, 0.55, -0.01);
  // Leichter Buckel – gibt die lauernde Silhouette.
  const hump = jitter(new THREE.IcosahedronGeometry(0.12, 0), 0.02, 41);
  hump.scale(1.4, 0.9, 0.8);
  hump.translate(0, 0.5, -0.07);
  return merge([chest, shoulders, hump]);
}

function forearm(): THREE.BufferGeometry {
  const arm = limb(0.045, 0.035, 0.28, 5);
  const hand = box(0.08, 0.09, 0.05, 0, -0.32, 0.01);
  // Lange Krallen
  const claws: THREE.BufferGeometry[] = [];
  for (let i = -1; i <= 1; i++) {
    const c = new THREE.ConeGeometry(0.012, 0.09, 4).toNonIndexed();
    c.rotateX(Math.PI);
    c.translate(i * 0.025, -0.41, 0.02);
    claws.push(c);
  }
  return merge([arm, hand, ...claws]);
}

function shin(): THREE.BufferGeometry {
  const leg = limb(0.055, 0.04, 0.44, 5);
  const foot = new THREE.CylinderGeometry(0.04, 0.055, 0.22, 5).toNonIndexed();
  foot.rotateX(Math.PI / 2);
  foot.translate(0, -0.45, 0.05);
  return merge([leg, foot]);
}

export const PART_GEOMETRY: Record<PartType, THREE.BufferGeometry> = {
  torso: torso(),
  head: skull(),
  // Tiefliegende, glimmende Augen
  eyes: merge([box(0.04, 0.018, 0.02, -0.045, 0.165, 0.118), box(0.04, 0.018, 0.02, 0.045, 0.165, 0.118)]),
  hips: (() => {
    const g = new THREE.CylinderGeometry(0.16, 0.19, 0.22, 7).toNonIndexed();
    g.scale(1, 1, 0.75);
    g.translate(0, -0.06, 0);
    return merge([g]);
  })(),
  upperArm: merge([limb(0.055, 0.045, 0.32, 5)]),
  forearm: forearm(),
  thigh: merge([limb(0.075, 0.055, 0.45, 6)]),
  shin: shin(),
  club: (() => {
    const g = new THREE.CylinderGeometry(0.06, 0.028, 0.75, 6).toNonIndexed();
    g.rotateX(Math.PI / 2);
    g.translate(0, -0.02, 0.3);
    const knot = jitter(new THREE.IcosahedronGeometry(0.07, 0), 0.02, 53);
    knot.translate(0, -0.02, 0.66);
    return merge([g, knot]);
  })(),
};

/** Animationseingaben, die der Gegner jedes Frame setzt. */
export interface AnimState {
  /** Horizontale Geschwindigkeit in m/s. */
  speed: number;
  /** Fortschritt des Angriffs in [0, 1] oder < 0, wenn kein Angriff läuft. */
  attack: number;
  /** Treffer-Zucken (wird intern abgeklungen). */
  hit: number;
  /** Fortschritt der Todesanimation in [0, 1] oder < 0. */
  death: number;
  /** Umgeworfen: wie weit er am Boden liegt (0 … 1) oder < 0. */
  down: number;
  /** Aufrappeln nach dem Umwerfen in [0, 1] oder < 0. */
  rise: number;
  /** Schreien/Alarm in [0, 1]. */
  alert: number;
  /** Kopfdrehung relativ zum Körper (rad). */
  lookYaw: number;
}

/**
 * Prozedurales Skelett eines Schrats. Die Knochen sind normale Object3Ds (nicht in der Szene);
 * der EnemyRenderer liest ihre Weltmatrizen und schreibt sie in die Instanced Meshes.
 */
export class EnemyRig {
  /** Fußpunkt + Blickrichtung (vom Gegner gesetzt). */
  readonly root = new THREE.Object3D();
  readonly parts: { type: PartType; bone: THREE.Object3D }[] = [];
  readonly anim: AnimState = { speed: 0, attack: -1, hit: 0, death: -1, down: -1, rise: -1, alert: 0, lookYaw: 0 };

  private readonly body = new THREE.Object3D(); // Drehpunkt für das Umfallen
  private readonly pelvis = new THREE.Object3D();
  private readonly torso = new THREE.Object3D();
  private readonly neck = new THREE.Object3D();
  private readonly shoulderL = new THREE.Object3D();
  private readonly shoulderR = new THREE.Object3D();
  private readonly elbowL = new THREE.Object3D();
  private readonly elbowR = new THREE.Object3D();
  private readonly hand = new THREE.Object3D();
  private readonly hipL = new THREE.Object3D();
  private readonly hipR = new THREE.Object3D();
  private readonly kneeL = new THREE.Object3D();
  private readonly kneeR = new THREE.Object3D();
  private phase = Math.random() * 10;
  /** Zählt Fußaufsetzer (für Schrittgeräusche). */
  steps = 0;
  private lastStepIndex = 0;
  private time = Math.random() * 10;
  private hitDecay = 0;
  /** Körperbau-Variation pro Gegner. */
  readonly scale: number;

  /** Geduckte Haltung 0..1 (Kriecher: tief gebeugt, Knie angewinkelt, Arme pendeln vor dem Körper). */
  readonly hunch: number;

  /** @param club Trägt eine Keule (Späher kämpfen mit bloßen Klauen). */
  constructor(scale = 1, club = true, hunch = 0) {
    this.scale = scale;
    this.hunch = hunch;
    const link = (parent: THREE.Object3D, child: THREE.Object3D, x: number, y: number, z: number) => {
      child.position.set(x, y, z);
      parent.add(child);
    };
    this.root.add(this.body);
    link(this.body, this.pelvis, 0, 0.95, 0);
    link(this.pelvis, this.torso, 0, 0.05, 0);
    link(this.torso, this.neck, 0, 0.6, 0.02);
    link(this.torso, this.shoulderL, -0.26, 0.54, 0);
    link(this.torso, this.shoulderR, 0.26, 0.54, 0);
    link(this.shoulderL, this.elbowL, 0, -0.32, 0);
    link(this.shoulderR, this.elbowR, 0, -0.32, 0);
    link(this.elbowR, this.hand, 0, -0.3, 0.02);
    link(this.pelvis, this.hipL, -0.11, -0.05, 0);
    link(this.pelvis, this.hipR, 0.11, -0.05, 0);
    link(this.hipL, this.kneeL, 0, -0.45, 0);
    link(this.hipR, this.kneeR, 0, -0.45, 0);
    this.body.scale.setScalar(scale);

    this.parts.push(
      { type: 'hips', bone: this.pelvis },
      { type: 'torso', bone: this.torso },
      { type: 'head', bone: this.neck },
      { type: 'eyes', bone: this.neck },
      { type: 'upperArm', bone: this.shoulderL },
      { type: 'upperArm', bone: this.shoulderR },
      { type: 'forearm', bone: this.elbowL },
      { type: 'forearm', bone: this.elbowR },
      { type: 'thigh', bone: this.hipL },
      { type: 'thigh', bone: this.hipR },
      { type: 'shin', bone: this.kneeL },
      { type: 'shin', bone: this.kneeR },
    );
    if (club) this.parts.push({ type: 'club', bone: this.hand });
  }

  /** Abklingender Treffer-Impuls 0..1 (für die Figuren-Darstellung). */
  get hitPulse(): number {
    return this.hitDecay;
  }

  /** Weltposition der Kopfmitte (für Sichtlinien). */
  headPosition(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.neck.getWorldPosition(out).add(new THREE.Vector3(0, 0.15 * this.scale, 0));
  }

  /** Berechnet die Pose aus `anim` und aktualisiert alle Weltmatrizen. */
  update(dt: number): void {
    const a = this.anim;
    this.time += dt;
    if (a.hit > this.hitDecay) this.hitDecay = a.hit;
    this.hitDecay = damp(this.hitDecay, 0, 7, dt);
    a.hit = 0;

    // --- Fortbewegung ---
    const run = clamp(a.speed / 5, 0, 1);
    const moving = smoothstep(0.05, 0.6, a.speed);
    this.phase += dt * (a.speed * 2.1 + 0.5 * moving);
    const swing = Math.sin(this.phase) * (0.35 + 0.5 * run) * moving;
    const stepIndex = Math.floor(this.phase / Math.PI);
    if (stepIndex !== this.lastStepIndex) {
      this.lastStepIndex = stepIndex;
      if (a.speed > 0.6 && a.death < 0) this.steps++;
    }

    this.hipL.rotation.set(-swing, 0, 0);
    this.hipR.rotation.set(swing, 0, 0);
    this.kneeL.rotation.set(Math.max(0, Math.sin(this.phase + 0.9)) * (0.5 + 0.9 * run) * moving, 0, 0);
    this.kneeR.rotation.set(Math.max(0, Math.sin(this.phase + 0.9 + Math.PI)) * (0.5 + 0.9 * run) * moving, 0, 0);
    this.shoulderL.rotation.set(swing * 0.9, 0, 0.12);
    this.shoulderR.rotation.set(-swing * 0.9, 0, -0.12);
    this.elbowL.rotation.set(-0.35 - run * 0.7, 0, 0);
    this.elbowR.rotation.set(-0.35 - run * 0.7, 0, 0);

    const breathe = Math.sin(this.time * 1.7) * 0.025;
    this.pelvis.position.y = 0.95 + Math.abs(Math.sin(this.phase)) * 0.05 * moving - 0.02 * run;
    // Gebückte, lauernde Haltung – beim Rennen stärker nach vorne gelehnt.
    this.torso.rotation.set(0.12 + run * 0.3 + breathe, 0, Math.sin(this.phase) * 0.05 * moving);
    this.neck.rotation.set(-0.1 - run * 0.2, a.lookYaw, 0);
    const h = this.hunch;
    if (h > 0) {
      this.pelvis.position.y -= 0.24 * h;
      this.torso.rotation.x += 0.6 * h;
      this.neck.rotation.x -= 0.55 * h;
      this.hipL.rotation.x -= 0.55 * h;
      this.hipR.rotation.x -= 0.55 * h;
      this.kneeL.rotation.x += 0.75 * h;
      this.kneeR.rotation.x += 0.75 * h;
      this.shoulderL.rotation.x -= 0.5 * h;
      this.shoulderR.rotation.x -= 0.5 * h;
    }

    // --- Angriff: Keule über den Kopf, dann herunterschlagen ---
    if (a.attack >= 0) {
      const u = a.attack;
      const wind = smoothstep(0, 0.5, u) * (1 - smoothstep(0.55, 0.68, u));
      const strike = smoothstep(0.55, 0.68, u) * (1 - smoothstep(0.75, 1, u));
      this.shoulderR.rotation.x = -2.7 * wind - 0.6 * strike + this.shoulderR.rotation.x * (1 - wind - strike);
      this.elbowR.rotation.x = -0.5 * wind - 0.1 * strike - 0.35 * (1 - wind - strike);
      this.torso.rotation.y = -0.45 * wind + 0.35 * strike;
      this.torso.rotation.x += -0.15 * wind + 0.35 * strike;
      this.shoulderL.rotation.x = 0.4 * wind - 0.3 * strike;
    }

    // --- Schreien ---
    if (a.alert > 0) {
      this.neck.rotation.x -= 0.5 * a.alert;
      this.shoulderL.rotation.z += 0.7 * a.alert;
      this.shoulderR.rotation.z -= 0.7 * a.alert;
      this.torso.rotation.x -= 0.2 * a.alert;
    }

    // --- Treffer: nach hinten zucken ---
    if (this.hitDecay > 0.01) {
      this.torso.rotation.x -= this.hitDecay * 0.5;
      this.neck.rotation.x -= this.hitDecay * 0.4;
      this.shoulderL.rotation.z += this.hitDecay * 0.4;
      this.shoulderR.rotation.z -= this.hitDecay * 0.4;
    }

    // --- Tod: rückwärts umfallen, Arme ausgebreitet ---
    // Umgeworfen liegt er wie ein Toter – nur steht er wieder auf.
    const fallen = a.death >= 0 ? a.death : a.down;
    if (fallen >= 0) {
      const t = 1 - (1 - Math.min(1, fallen)) ** 3;
      this.body.rotation.set(-t * Math.PI * 0.48, 0, 0);
      this.body.position.y = 0.12 * t;
      this.shoulderL.rotation.set(-1.2 * t, 0, 1.0 * t);
      this.shoulderR.rotation.set(-1.4 * t, 0, -0.9 * t);
      this.neck.rotation.x = 0.5 * t;
    } else {
      this.body.rotation.set(0, 0, 0);
      this.body.position.y = 0;
    }

    this.root.updateMatrixWorld(true);
  }
}
