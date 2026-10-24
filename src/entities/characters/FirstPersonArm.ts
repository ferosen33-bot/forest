import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Rechter Unterarm mit Hand für die Ich-Ansicht – aus einem realistischen MakeHuman-Menschen
 * (MPFB-Avatar aus TalkingHead, CC0), mit `scripts/prepare-fp-arm.mjs` auf Unterarm und Hand zugeschnitten.
 *
 * Die Faust entsteht prozedural: Die Fingerglieder werden um die Knöchellinie zur Handfläche gekrümmt,
 * der Daumen legt sich darüber. Für jedes Werkzeug wird der Arm so gedreht, dass die Faust im
 * Griffpunkt sitzt, ihre Griffachse dem Stiel folgt und der Unterarm zur Kamera hin nach unten zeigt.
 */

/** Unterarm-Richtung (von der Faust zum Ellbogen) im Raum der Halte-Pose: nach hinten, unten, außen. */
const FOREARM = new THREE.Vector3(0.22, -0.36, 0.9).normalize();
/** Krümmung je Fingerglied (rad): Grund-, Mittel-, Endglied. */
const CURL = [1.25, 1.45, 0.9];
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

export class FirstPersonArm {
  readonly object = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly bones = new Map<string, THREE.Bone>();
  /** Im Raum des Modells: Mitte der Faust, Griffachse, Richtung zum Ellbogen. */
  private readonly grip = new THREE.Vector3();
  private readonly gripAxis = new THREE.Vector3();
  private readonly toElbow = new THREE.Vector3();

  private constructor(model: THREE.Object3D) {
    this.model = model;
    this.object.name = 'FirstPersonArm';
    this.object.add(model);
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
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
    model.updateMatrixWorld(true);
    this.makeFist();
    model.updateMatrixWorld(true);

    const pos = (name: string) => this.bones.get(name)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
    const hand = pos('RightHand');
    const elbow = pos('RightForeArm');
    this.gripAxis.subVectors(pos('RightHandIndex1'), pos('RightHandPinky1')).normalize();
    // Der Stiel liegt zwischen Handfläche und gekrümmten Mittelgliedern.
    this.grip.copy(hand).lerp(pos('RightHandMiddle2'), 0.62);
    this.toElbow.subVectors(elbow, this.grip).normalize();
  }

  static async load(url = `${import.meta.env.BASE_URL}models/characters/fp_arm.glb`): Promise<FirstPersonArm> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new FirstPersonArm(gltf.scene);
  }

  /** Finger zur Faust schließen (um die Knöchellinie, Richtung Handfläche). */
  private makeFist(): void {
    const world = (name: string) => this.bones.get(name)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
    const hand = world('RightHand');
    const knuckles = new THREE.Vector3().subVectors(world('RightHandIndex1'), world('RightHandPinky1')).normalize();
    const finger = new THREE.Vector3().subVectors(world('RightHandMiddle2'), world('RightHandMiddle1')).normalize();
    // Handfläche: senkrecht zu Fingern und Knöchellinie; die Seite, auf der der Daumen ansetzt.
    const palm = new THREE.Vector3().crossVectors(knuckles, finger).normalize();
    const thumb = new THREE.Vector3().subVectors(world('RightHandThumb1'), hand);
    if (thumb.dot(palm) < 0) palm.negate();
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
    for (const f of FINGERS) {
      for (let k = 0; k < 3; k++) bend(`RightHand${f}${k + 1}`, knuckles, sign * CURL[k] * (f === 'Pinky' ? 1.08 : 1));
    }
    // Daumen: zur Handfläche und über die Finger legen.
    bend('RightHandThumb1', finger, sign * 0.55);
    bend('RightHandThumb2', knuckles, sign * 0.5);
    bend('RightHandThumb3', knuckles, sign * 0.6);
  }

  /**
   * Arm auf ein Werkzeug ausrichten.
   * @param axis Richtung des Stiels im Raum der Halte-Pose (Item-Längsachse +Y nach der Griffdrehung).
   */
  align(axis: THREE.Vector3): void {
    const src = basis(this.gripAxis, this.toElbow);
    const dst = basis(axis.clone().normalize(), FOREARM);
    const r = new THREE.Matrix4().multiplyMatrices(dst, src.clone().transpose());
    this.model.quaternion.setFromRotationMatrix(r);
    this.model.position.copy(this.grip).multiplyScalar(-1).applyQuaternion(this.model.quaternion);
  }
}

/** Orthonormalbasis aus Hauptachse `a` und Hilfsrichtung `b` (als Rotationsmatrix in Spalten). */
function basis(a: THREE.Vector3, b: THREE.Vector3): THREE.Matrix4 {
  const x = a.clone().normalize();
  const y = b.clone().addScaledVector(x, -b.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z);
}
