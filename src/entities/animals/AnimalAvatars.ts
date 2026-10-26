import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimalRig } from './AnimalRig';
import { WolfPose } from './WolfPose';

/**
 * Realistische Tiere von OpenGameArt („created for the wonderful world of Kelgar“, CC0): Hirsch mit
 * Geweih, Ricke und Hase mit Fell- und Normalen-Texturen und eigenen Bewegungen. Aufbereitet mit
 * `scripts/prepare-animals.py` (dem Rotwild fehlte ein Schritt – der Gang wurde dort über die Fuß-IK
 * erzeugt) und `scripts/compress-animals.mjs`.
 *
 * Der Wolf stammt aus „3d wolf“ (OpenGameArt, CC0): ein Hundemodell mit Skelett, dessen gemalte Textur
 * `scripts/prepare-wolf-texture.py` in ein graues Wolfsfell verwandelt. Bewegungen hat es keine – die
 * berechnet {@link WolfPose}.
 *
 * Wie bei den Schraten bleibt die KI samt Prozedur-Skelett (Position, Schritte für die Hufgeräusche)
 * unverändert; hier wird ihr Zustand in überblendete Bewegungen übersetzt.
 */

export type AnimalModelId = 'stag' | 'doe' | 'rabbit' | 'wolf';
const MODEL_IDS: AnimalModelId[] = ['stag', 'doe', 'rabbit', 'wolf'];

/** Höhe des Wolfs bis zu den Ohrspitzen bei Skalierung 1 (Schulter ≈ 0,7 m). */
const WOLF_HEIGHT = 0.95;
/** Augenleuchten: das Restlicht spiegelt sich gelbgrün im Augenhintergrund. */
const EYESHINE = new THREE.Color(0xc8d860);
const EYE_GEOMETRY = new THREE.SphereGeometry(1, 6, 4);

interface Cast {
  /** Höhe im Ruhezustand bei Skalierung 1 (m). */
  height: number;
  idle: string[];
  graze: string;
  alert: string;
  walk: string;
  run: string;
  deaths: string[];
  /** Tempo (m/s), bei dem Geh- bzw. Laufbewegung ohne Beschleunigung passt. */
  walkSpeed: number;
  runSpeed: number;
  /** Ab diesem Tempo wird aus Gehen Rennen. */
  runFrom: [number, number];
}

const DEER = {
  idle: ['Idle', 'Idle2'],
  graze: 'Eat',
  alert: 'Look',
  walk: 'Walk',
  run: 'Run',
  deaths: ['Die', 'Die2'],
  walkSpeed: 0.86,
  runSpeed: 6,
  runFrom: [2.2, 4.2] as [number, number],
};

const CAST: Record<Exclude<AnimalModelId, 'wolf'>, Cast> = {
  // Der erste Tod des Hirschs endet liegend mit erhobenem Haupt – wirkt wie Ruhen, nicht wie erlegt.
  stag: { ...DEER, height: 1.9, deaths: ['Die2'] },
  doe: { ...DEER, height: 1.5 },
  rabbit: {
    height: 0.34,
    idle: ['Idle', 'Idle2'],
    graze: 'Idle2',
    alert: 'Look',
    // Hasen hoppeln auch gemächlich – dieselbe Bewegung, nur langsamer.
    walk: 'Run',
    run: 'Run',
    deaths: ['Die', 'Die2'],
    walkSpeed: 1.6,
    runSpeed: 4.5,
    runFrom: [1.5, 3],
  },
};

interface Template {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  /** Höhe im Ruhezustand (Modelleinheiten). */
  height: number;
}

export class AnimalModels {
  private constructor(private readonly templates: Map<AnimalModelId, Template>) {}

  static async load(base = `${import.meta.env.BASE_URL}models/animals/`): Promise<AnimalModels> {
    const loader = new GLTFLoader();
    const files = await Promise.all(MODEL_IDS.map((id) => loader.loadAsync(`${base}${id}.glb`)));
    const templates = new Map<AnimalModelId, Template>();
    MODEL_IDS.forEach((id, i) => {
      const { scene, animations } = files[i];
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      // Grenzkugel des ganzen Tiers (etwas größer) für jedes Teil: Kopf und Beine bewegen sich weit
      // aus ihrer Ruhelage (Grasen, Galopp) – sonst würden sie am Bildrand zu früh ausgeblendet.
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      sphere.radius *= 1.35;
      scene.traverse((o) => {
        const mesh = o as THREE.SkinnedMesh;
        if (!mesh.isSkinnedMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.boundingSphere = sphere.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.metalness = 0;
        if (mat.name !== 'Eye') mat.roughness = 0.9;
        // Fellkarten des Hasen: Kanten weich, aber ohne Sortierprobleme.
        if (mat.alphaTest > 0) mat.side = THREE.DoubleSide;
      });
      templates.set(id, {
        scene,
        clips: new Map(animations.map((c) => [c.name, c])),
        height: box.max.y - box.min.y,
      });
    });
    return new AnimalModels(templates);
  }

  create(id: AnimalModelId, height: number, tint: THREE.Color): AnimalAvatar {
    const t = this.templates.get(id)!;
    const object = cloneSkinned(t.scene);
    object.scale.setScalar(height / t.height);
    const root = new THREE.Group();
    root.name = `Animal_${id}`;
    root.add(object);
    const materials: THREE.Material[] = [];
    object.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      if (mat.name !== 'Eye') mat.color.copy(tint);
      mesh.material = mat;
      materials.push(mat);
    });
    return new AnimalAvatar(root, t.clips, materials);
  }
}

export class AnimalAvatar {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();

  constructor(
    readonly object: THREE.Object3D,
    clips: Map<string, THREE.AnimationClip>,
    private readonly materials: THREE.Material[],
  ) {
    this.mixer = new THREE.AnimationMixer(object);
    for (const [name, clip] of clips) this.actions.set(name, this.mixer.clipAction(clip));
  }

  action(name: string): THREE.AnimationAction | undefined {
    return this.actions.get(name);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.object);
    for (const m of this.materials) m.dispose();
    this.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh.material as THREE.Material).dispose();
    });
    this.object.removeFromParent();
  }
}

export interface AnimalTarget {
  id: number;
  rig: AnimalRig;
  model: AnimalModelId;
  tint: THREE.Color;
}

interface Driven {
  avatar: AnimalAvatar;
  /** Bewegungen aus Animationen (Rotwild, Hase) … */
  cast: Cast | null;
  /** … oder prozedural (Wolf). */
  pose: WolfPose | null;
  eyes: THREE.MeshBasicMaterial | null;
  /** Leuchtpunkte der Augen und ihre Grundgröße. */
  eyeMeshes: THREE.Mesh[];
  eyeScale: number;
  idle: string;
  death: string;
  wasDead: boolean;
  weights: Map<string, number>;
  used: boolean;
  pending: number;
}

const damp = (a: number, b: number, rate: number, dt: number) => b + (a - b) * Math.exp(-rate * dt);

export class AnimalAvatars {
  readonly group = new THREE.Group();
  private readonly driven = new Map<number, Driven>();
  /** Dunkelheit (0..1) – nur dann leuchten Wolfsaugen auf. */
  night = 0;
  private readonly toViewer = new THREE.Vector3();

  constructor(private readonly models: AnimalModels) {
    this.group.name = 'AnimalAvatars';
  }

  /** Jedes Bild: alle sichtbaren Tiere darstellen; verschwundene werden entfernt. */
  render(targets: AnimalTarget[], dt: number, viewer: THREE.Vector3): void {
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

  private create(t: AnimalTarget): Driven {
    if (t.model === 'wolf') return this.createWolf(t);
    const cast = CAST[t.model];
    const avatar = this.models.create(t.model, cast.height * t.rig.scale, t.tint);
    this.group.add(avatar.object);
    const idle = cast.idle[t.id % cast.idle.length];
    for (const name of new Set([idle, cast.graze, cast.alert, cast.walk, cast.run])) {
      const a = avatar.action(name);
      if (a) {
        a.play();
        a.setEffectiveWeight(0);
      }
    }
    // Phase je Tier versetzen, damit ein Rudel nicht im Gleichschritt grast.
    avatar.mixer.update((t.id * 1.37) % 5);
    return {
      avatar,
      cast,
      pose: null,
      eyes: null,
      eyeMeshes: [],
      eyeScale: 1,
      idle,
      death: cast.deaths[t.id % cast.deaths.length],
      wasDead: false,
      weights: new Map(),
      used: true,
      pending: 0,
    };
  }

  private createWolf(t: AnimalTarget): Driven {
    const height = WOLF_HEIGHT * t.rig.scale;
    const avatar = this.models.create('wolf', height, t.tint);
    this.group.add(avatar.object);
    const model = avatar.object.children[0];
    // Augen: kleine leuchtende Kugeln am Kopf, an der Stelle der Augapfel-Knochen.
    model.updateMatrixWorld(true);
    let head: THREE.Bone | null = null;
    const eyeBones: THREE.Bone[] = [];
    model.traverse((o) => {
      if (o.name === 'b_Head') head = o as THREE.Bone;
      if (o.name === 'b_LeftEye' || o.name === 'b_RightEye') eyeBones.push(o as THREE.Bone);
    });
    let eyes: THREE.MeshBasicMaterial | null = null;
    const eyeMeshes: THREE.Mesh[] = [];
    let eyeScale = 1;
    if (head) {
      const h = head as THREE.Bone;
      eyes = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
      const headScale = new THREE.Vector3().setFromMatrixScale(h.matrixWorld).x;
      for (const b of eyeBones) {
        const eye = new THREE.Mesh(EYE_GEOMETRY, eyes);
        const p = b.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, 0.032 * height));
        eye.position.copy(h.worldToLocal(p));
        eyeScale = (0.016 * height) / headScale;
        eye.scale.setScalar(eyeScale);
        eye.visible = false;
        eyeMeshes.push(eye);
        h.add(eye);
      }
    }
    const pose = new WolfPose(model, height * 0.55);
    return { avatar, cast: null, pose, eyes, eyeMeshes, eyeScale, idle: '', death: '', wasDead: false, weights: new Map(), used: true, pending: 0 };
  }

  private drive(d: Driven, t: AnimalTarget, dt: number, viewer: THREE.Vector3): void {
    const a = t.rig.anim;
    const obj = d.avatar.object;
    obj.position.copy(t.rig.root.position);
    obj.quaternion.copy(t.rig.root.quaternion);
    if (d.eyes) this.updateEyes(d, t, viewer);

    const dist = obj.position.distanceTo(viewer);
    d.pending += dt;
    const step = dist > 80 ? 0.1 : dist > 40 ? 0.05 : 0;
    if (d.pending < step) return;
    const frame = d.pending;
    d.pending = 0;
    if (d.pose) {
      d.pose.update(frame, a, t.rig.scale);
      return;
    }
    const cast = d.cast!;

    const target = new Map<string, number>();
    const add = (name: string, w: number) => target.set(name, (target.get(name) ?? 0) + w);
    if (a.death >= 0) {
      if (!d.wasDead) {
        d.wasDead = true;
        const death = d.avatar.action(d.death);
        if (death) {
          death.reset();
          death.setLoop(THREE.LoopOnce, 1);
          death.clampWhenFinished = true;
          death.play();
          // Aus dem Spielstand geladen: schon liegend.
          if (a.death >= 1) death.time = death.getClip().duration;
        }
      }
      target.set(d.death, 1);
    } else {
      const speed = a.speed / t.rig.scale;
      const move = THREE.MathUtils.smoothstep(speed, 0.1, 0.6);
      const run = THREE.MathUtils.smoothstep(speed, cast.runFrom[0], cast.runFrom[1]);
      const still = 1 - move;
      const alert = still * THREE.MathUtils.clamp(a.alert, 0, 1);
      const graze = (still - alert) * THREE.MathUtils.clamp(a.graze, 0, 1);
      add(cast.alert, alert);
      add(cast.graze, graze);
      add(d.idle, still - alert - graze);
      add(cast.walk, move * (1 - run));
      add(cast.run, move * run);
      const walk = d.avatar.action(cast.walk);
      const runA = d.avatar.action(cast.run);
      if (cast.walk === cast.run) {
        if (walk) walk.timeScale = THREE.MathUtils.clamp(THREE.MathUtils.lerp(speed / cast.walkSpeed, speed / cast.runSpeed, run), 0.55, 1.6);
      } else {
        if (walk) walk.timeScale = THREE.MathUtils.clamp(speed / cast.walkSpeed, 0.6, 2.2);
        if (runA) runA.timeScale = THREE.MathUtils.clamp(speed / cast.runSpeed, 0.75, 1.5);
      }
    }

    const weights = d.weights;
    const names = new Set([...weights.keys(), ...target.keys()]);
    for (const name of names) {
      const action = d.avatar.action(name);
      if (!action) continue;
      const w = damp(weights.get(name) ?? 0, target.get(name) ?? 0, name === d.death ? 14 : 6, frame);
      weights.set(name, w);
      action.setEffectiveWeight(w);
      if (!action.isRunning() && w > 0.001 && name !== d.death) action.play();
    }
    d.avatar.mixer.update(frame);
  }

  /** Wolfsaugen leuchten nur nachts und nur, wenn der Wolf zum Betrachter schaut. */
  private updateEyes(d: Driven, t: AnimalTarget, viewer: THREE.Vector3): void {
    const obj = d.avatar.object;
    // Die Wurzel dreht nur um die Hochachse.
    const yaw = 2 * Math.atan2(obj.quaternion.y, obj.quaternion.w) + t.rig.anim.lookYaw * 0.9;
    this.toViewer.subVectors(viewer, obj.position).setY(0);
    const dist = this.toViewer.length();
    const facing = (Math.sin(yaw) * this.toViewer.x + Math.cos(yaw) * this.toViewer.z) / Math.max(0.01, dist);
    const alive = t.rig.anim.death < 0 ? 1 : 0;
    const glow = this.night * alive * Math.max(0, (facing - 0.45) / 0.55) ** 1.5 * THREE.MathUtils.clamp(1.5 - dist / 70, 0, 1);
    // Hell genug, dass das Bloom einen Schimmer darum legt.
    d.eyes!.color.copy(EYESHINE).multiplyScalar(glow * 6);
    const visible = glow > 0.02;
    // In der Ferne wachsen die Punkte mit, damit sie nicht unter einen Pixel schrumpfen.
    const grow = Math.max(1, dist / 7);
    for (const eye of d.eyeMeshes) {
      eye.visible = visible;
      eye.scale.setScalar(d.eyeScale * grow);
    }
  }

  dispose(): void {
    for (const d of this.driven.values()) d.avatar.dispose();
    this.driven.clear();
  }
}
