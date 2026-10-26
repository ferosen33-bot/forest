import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Animierte Figuren aus Mesh2Motion (CC0): fotobasiert texturierte Menschen und Monster im Stil früher
 * Horrorspiele, alle auf demselben Skelett. Die Bewegungen (Gehen, Rennen, Zombie-Gang, Schläge,
 * Werfen, Treffer, Tode, Sitzen, Reden …) stammen aus den Animationsbibliotheken des Projekts und
 * wurden mit `scripts/prepare-characters.mjs` auf das Nötige reduziert.
 */

export type CharacterId =
  | 'monster'
  | 'monster_3'
  | 'monster_4'
  | 'monster_5'
  | 'killer_4'
  | 'killer_5'
  | 'killer_6'
  | 'killer_7'
  | 'male_10'
  | 'hazmat_female'
  | 'female_9'
  | 'male_15'
  | 'police_male'
  | 'female_8'
  | 'hazmat_suit_male';

export const CHARACTER_IDS: CharacterId[] = [
  'monster', 'monster_3', 'monster_4', 'monster_5', 'killer_4', 'killer_5', 'killer_6', 'killer_7',
  'male_10', 'hazmat_female', 'female_9', 'male_15', 'police_male', 'female_8', 'hazmat_suit_male',
];

interface Template {
  scene: THREE.Group;
  /** Bewegungen, gefiltert auf die Knochen dieser Figur. */
  clips: Map<string, THREE.AnimationClip>;
  /** Höhe im Ruhezustand (Modelleinheiten). */
  height: number;
  /** Augen im Raum des Kopfknochens (aus der Bind-Pose berechnet). */
  eyes: THREE.Vector3[] | null;
}

/** Eine Figur in der Welt: Objekt, Mischer, Aktionen nach Namen, Knochen nach Namen. */
export class Avatar {
  readonly mixer: THREE.AnimationMixer;
  readonly actions = new Map<string, THREE.AnimationAction>();
  readonly bones = new Map<string, THREE.Bone>();
  readonly meshes: THREE.SkinnedMesh[] = [];

  constructor(
    readonly object: THREE.Object3D,
    clips: Map<string, THREE.AnimationClip>,
  ) {
    this.mixer = new THREE.AnimationMixer(object);
    for (const [name, clip] of clips) this.actions.set(name, this.mixer.clipAction(clip));
    object.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) this.meshes.push(o as THREE.SkinnedMesh);
    });
  }

  action(name: string): THREE.AnimationAction | undefined {
    return this.actions.get(name);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.object);
    for (const m of this.meshes) (m.material as THREE.Material).dispose();
    this.object.removeFromParent();
  }
}

const EYE_MATERIAL = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb070).multiplyScalar(4), fog: false });
const EYE_GEOMETRY = new THREE.SphereGeometry(0.016, 6, 4);
const EYE_COLOR = new THREE.Color(0xffb070);

/** Leuchtkraft der Augen (nachts hell, am Tag nur ein Schimmer). */
export function setEyeGlow(strength: number): void {
  EYE_MATERIAL.color.copy(EYE_COLOR).multiplyScalar(0.25 + 3.75 * strength);
}

export class CharacterLibrary {
  private constructor(private readonly templates: Map<CharacterId, Template>) {}

  static async load(base = `${import.meta.env.BASE_URL}models/characters/`): Promise<CharacterLibrary> {
    const loader = new GLTFLoader();
    const [baseAnims, addonAnims, ...models] = await Promise.all([
      loader.loadAsync(`${base}base-anims.glb`),
      loader.loadAsync(`${base}addon-anims.glb`),
      ...CHARACTER_IDS.map((id) => loader.loadAsync(`${base}${id}.glb`)),
    ]);
    // Die Wurzel darf nicht wandern (die Spielfigur bewegt die KI, nicht die Animation).
    const clips = [...baseAnims.animations, ...addonAnims.animations].map((c) => {
      c.tracks = c.tracks.filter((t) => t.name !== 'root.position');
      return c;
    });
    const templates = new Map<CharacterId, Template>();
    CHARACTER_IDS.forEach((id, i) => {
      const scene = models[i].scene;
      const bones = new Set<string>();
      scene.traverse((o) => {
        if ((o as THREE.Bone).isBone) bones.add(o.name);
        if ((o as THREE.Mesh).isMesh) {
          const mesh = o as THREE.SkinnedMesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          mat.roughness = 0.85;
          mat.metalness = 0;
        }
      });
      const own = new Map<string, THREE.AnimationClip>();
      for (const c of clips) {
        const tracks = c.tracks.filter((t) => bones.has(t.name.split('.')[0]));
        own.set(c.name, new THREE.AnimationClip(c.name, c.duration, tracks));
      }
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      templates.set(id, { scene, clips: own, height: box.max.y - box.min.y, eyes: findEyes(scene) });
    });
    return new CharacterLibrary(templates);
  }

  has(id: CharacterId): boolean {
    return this.templates.has(id);
  }

  /**
   * Neue Figur mit eigener Pose.
   * @param height Zielhöhe in Metern.
   * @param opts.eyes leuchtende Augen (Schrate), opts.tint Farbton auf der Textur.
   */
  create(id: CharacterId, height: number, opts: { eyes?: boolean; tint?: THREE.Color } = {}): Avatar {
    const t = this.templates.get(id)!;
    const object = cloneSkinned(t.scene);
    const root = new THREE.Group();
    root.name = `Avatar_${id}`;
    object.scale.setScalar(height / t.height);
    root.add(object);
    object.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) {
        mesh.material = (mesh.material as THREE.Material).clone();
        if (opts.tint) (mesh.material as THREE.MeshStandardMaterial).color.copy(opts.tint);
      }
    });
    const avatar = new Avatar(root, t.clips);
    if (opts.eyes && t.eyes) {
      const head = avatar.bones.get('head');
      if (head) {
        root.updateMatrixWorld(true);
        for (const e of t.eyes) {
          const eye = new THREE.Mesh(EYE_GEOMETRY, EYE_MATERIAL);
          eye.position.copy(e);
          // Knochen sind in Modellmaßstab skaliert: Augengröße zurückrechnen.
          eye.scale.setScalar(1 / new THREE.Vector3().setFromMatrixScale(head.matrixWorld).x);
          head.add(eye);
        }
      }
    }
    return avatar;
  }
}

/**
 * Augen aus der Bind-Pose schätzen: auf ~92,5 % der Körperhöhe die vorderste Stelle nahe der
 * Mittellinie suchen; dort sitzen zwei Augen ±3,2 cm seitlich. Ergebnis im Raum des Kopfknochens
 * (über dessen inverse Bind-Matrix) – unabhängig davon, in welcher Pose die Knochen gerade stehen.
 */
function findEyes(scene: THREE.Object3D): THREE.Vector3[] | null {
  let mesh: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => {
    if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  const m = mesh as THREE.SkinnedMesh | null;
  if (!m) return null;
  const headIndex = m.skeleton.bones.findIndex((b) => b.name === 'head');
  if (headIndex < 0) return null;
  // Bind-Raum: Geometrie · bindMatrix
  const p = m.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m.bindMatrix));
  const height = box.max.y - box.min.y;
  const cx = (box.min.x + box.max.x) / 2;
  const y = box.min.y + height * 0.925;
  let front = -Infinity;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m.bindMatrix);
    if (Math.abs(v.y - y) < height * 0.02 && Math.abs(v.x - cx) < height * 0.03) front = Math.max(front, v.z);
  }
  if (!Number.isFinite(front)) return null;
  const s = height / 1.8;
  const toHead = m.skeleton.boneInverses[headIndex];
  return [-1, 1].map((side) => new THREE.Vector3(cx + side * 0.032 * s, y, front - 0.004 * s).applyMatrix4(toHead));
}
