import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Arm mit Hand für die Ich-Ansicht – aus einem realistischen MakeHuman-Menschen (MPFB-Avatar aus
 * TalkingHead, CC0), mit `scripts/prepare-fp-arm.mjs` auf Ober-, Unterarm und Hand zugeschnitten.
 * Die linke Hand (am Bogen) ist derselbe Arm, gespiegelt.
 *
 * Die Haltungen entstehen prozedural, indem die Fingerglieder um die Knöchellinie zur Handfläche
 * gekrümmt werden:
 * - **Faust** um einen Stiel (Werkzeuge, Fackel, Taschenlampe, Bogengriff),
 * - **offene Hand**, die etwas von unten trägt (Schale).
 *
 * Für jedes Item wird der Arm so gedreht, dass der Griffpunkt der Hand an der richtigen Stelle sitzt,
 * die Hand richtig liegt und der Unterarm zur Kamera hin nach unten zeigt.
 */

export type HandPose = 'fist' | 'palm';

/** Unterarm-Richtung (von der Hand zum Ellbogen) im Raum der Halte-Pose: nach hinten, unten, außen. */
export const FOREARM = new THREE.Vector3(0.22, -0.36, 0.9).normalize();
/** Krümmung je Fingerglied (rad): Grund-, Mittel-, Endglied. */
const CURL: Record<HandPose, number[]> = {
  fist: [1.25, 1.45, 0.9],
  palm: [0.18, 0.25, 0.15],
};
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

/** Lage einer Haltung im Raum des Modells (ohne Ausrichtung). */
interface Frame {
  /** Griffpunkt: Mitte der Faust bzw. Mitte der Handfläche. */
  point: THREE.Vector3;
  /** Faust: Knöchellinie (entlang des Stiels). Offene Hand: Normale der Handfläche. */
  axis: THREE.Vector3;
  toElbow: THREE.Vector3;
}

export class FirstPersonArm {
  readonly object = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly rest = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly frames = new Map<HandPose, Frame>();
  private pose: HandPose = 'fist';

  private constructor(model: THREE.Object3D) {
    this.model = model;
    this.object.name = 'FirstPersonArm';
    this.object.add(model);
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        this.bones.set(o.name, o as THREE.Bone);
        this.rest.set(o as THREE.Bone, (o as THREE.Bone).quaternion.clone());
      }
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isMesh) {
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.roughness = 0.62;
        // Wochen auf der Insel: gebräunt, schmutzig – nicht porzellanhell.
        mat.color.setRGB(0.78, 0.66, 0.56);
        mat.metalness = 0;
        mat.side = THREE.DoubleSide;
      }
    });
    this.straightenElbow();
    for (const p of ['palm', 'fist'] as HandPose[]) this.frames.set(p, this.measure(p));
  }

  /**
   * Im Ruhezustand des Modells ist der Ellbogen angewinkelt – der Oberarm stünde dann quer im Bild.
   * Den Unterarm daher in die Verlängerung des Oberarms drehen: ein gerader Arm verschwindet
   * hinter dem Bildrand, egal wie die Hand gehalten wird.
   */
  private straightenElbow(): void {
    const fore = this.bones.get('RightForeArm');
    if (!fore || !this.bones.get('RightArm') || !fore.parent) return;
    this.model.updateMatrixWorld(true);
    const upper = new THREE.Vector3().subVectors(this.pos('RightForeArm'), this.pos('RightArm')).normalize();
    const lower = new THREE.Vector3().subVectors(this.pos('RightHand'), this.pos('RightForeArm')).normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(lower, upper);
    const world = fore.getWorldQuaternion(new THREE.Quaternion()).premultiply(turn);
    const parent = fore.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    fore.quaternion.copy(parent.multiply(world));
    this.rest.set(fore, fore.quaternion.clone());
    this.model.updateMatrixWorld(true);
  }

  static async load(url = `${import.meta.env.BASE_URL}models/characters/fp_arm.glb`): Promise<FirstPersonArm> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new FirstPersonArm(gltf.scene);
  }

  /** Zweite, unabhängige Hand aus derselben Datei (wird für die linke Hand gespiegelt). */
  static async loadPair(url?: string): Promise<[FirstPersonArm, FirstPersonArm]> {
    return Promise.all([FirstPersonArm.load(url), FirstPersonArm.load(url)]);
  }

  private pos(name: string): THREE.Vector3 {
    return this.bones.get(name)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  }

  /** Haltung einnehmen und ihre Griffdaten im Modellraum bestimmen. */
  private measure(pose: HandPose): Frame {
    this.model.quaternion.identity();
    this.model.position.set(0, 0, 0);
    this.applyPose(pose);
    this.model.updateMatrixWorld(true);
    const hand = this.pos('RightHand');
    const elbow = this.pos('RightForeArm');
    const knuckles = new THREE.Vector3().subVectors(this.pos('RightHandIndex1'), this.pos('RightHandPinky1')).normalize();
    let point: THREE.Vector3;
    let axis = knuckles;
    if (pose === 'fist') {
      // Der Stiel liegt zwischen Handfläche und gekrümmten Mittelgliedern.
      point = hand.clone().lerp(this.pos('RightHandMiddle2'), 0.62);
    } else {
      axis = this.palmNormal();
      // Mitte der Handfläche, eine Fingerdicke davor (dort liegt der Boden der Schale).
      point = hand.clone().lerp(this.pos('RightHandMiddle1'), 0.55).addScaledVector(axis, 0.018);
    }
    const toElbow = new THREE.Vector3().subVectors(elbow, point).normalize();
    return { point, axis, toElbow };
  }

  /** Normale der Handfläche (zeigt aus der Handinnenfläche heraus). */
  private palmNormal(): THREE.Vector3 {
    const knuckles = new THREE.Vector3().subVectors(this.pos('RightHandIndex1'), this.pos('RightHandPinky1')).normalize();
    const finger = new THREE.Vector3().subVectors(this.pos('RightHandMiddle2'), this.pos('RightHandMiddle1')).normalize();
    const palm = new THREE.Vector3().crossVectors(knuckles, finger).normalize();
    const thumb = new THREE.Vector3().subVectors(this.pos('RightHandThumb1'), this.pos('RightHand'));
    if (thumb.dot(palm) < 0) palm.negate();
    return palm;
  }

  /** Finger in eine Haltung krümmen (vorher zurück in die Ruhelage). */
  private applyPose(pose: HandPose): void {
    for (const [bone, q] of this.rest) if (/Hand(Index|Middle|Ring|Pinky|Thumb)/.test(bone.name)) bone.quaternion.copy(q);
    this.model.updateMatrixWorld(true);
    const knuckles = new THREE.Vector3().subVectors(this.pos('RightHandIndex1'), this.pos('RightHandPinky1')).normalize();
    const finger = new THREE.Vector3().subVectors(this.pos('RightHandMiddle2'), this.pos('RightHandMiddle1')).normalize();
    const palm = this.palmNormal();
    // Drehsinn so wählen, dass die Fingerspitzen zur Handfläche wandern.
    const test = finger.clone().applyAxisAngle(knuckles, 0.5);
    const sign = test.dot(palm) > finger.dot(palm) ? 1 : -1;

    const q = new THREE.Quaternion();
    const wq = new THREE.Quaternion();
    const bend = (name: string, axisWorld: THREE.Vector3, angle: number) => {
      const bone = this.bones.get(name);
      if (!bone) return;
      bone.updateWorldMatrix(true, false);
      bone.getWorldQuaternion(wq);
      const local = axisWorld.clone().applyQuaternion(wq.invert());
      bone.quaternion.multiply(q.setFromAxisAngle(local, angle));
      bone.updateMatrixWorld(true);
    };
    const curl = CURL[pose];
    for (const f of FINGERS) {
      for (let k = 0; k < 3; k++) bend(`RightHand${f}${k + 1}`, knuckles, sign * curl[k] * (f === 'Pinky' ? 1.08 : 1));
    }
    if (pose === 'fist') {
      // Daumen: zur Handfläche und über die Finger legen.
      bend('RightHandThumb1', finger, sign * 0.55);
      bend('RightHandThumb2', knuckles, sign * 0.5);
      bend('RightHandThumb3', knuckles, sign * 0.6);
    } else {
      // Offene Hand: Daumen leicht abgespreizt.
      bend('RightHandThumb1', finger, -sign * 0.15);
    }
  }

  /**
   * Arm ausrichten.
   * @param axis Faust: Richtung des Stiels. Offene Hand: wohin die Handfläche zeigt.
   * @param forearm Richtung von der Hand zum Ellbogen (Raum der Halte-Pose).
   */
  align(axis: THREE.Vector3, pose: HandPose = 'fist', forearm: THREE.Vector3 = FOREARM): void {
    if (pose !== this.pose) {
      this.pose = pose;
      this.applyPose(pose);
    }
    const f = this.frames.get(pose)!;
    const src = basis(f.axis, f.toElbow);
    const dst = basis(axis.clone().normalize(), forearm);
    const r = new THREE.Matrix4().multiplyMatrices(dst, src.clone().transpose());
    this.model.quaternion.setFromRotationMatrix(r);
    this.model.position.copy(f.point).multiplyScalar(-1).applyQuaternion(this.model.quaternion);
  }
}

/** Orthonormalbasis aus Hauptachse `a` und Hilfsrichtung `b` (als Rotationsmatrix in Spalten). */
function basis(a: THREE.Vector3, b: THREE.Vector3): THREE.Matrix4 {
  const x = a.clone().normalize();
  const y = b.clone().addScaledVector(x, -b.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z);
}
