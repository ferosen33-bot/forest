import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimalRig } from './AnimalRig';

/**
 * Realistische Tiere von OpenGameArt („created for the wonderful world of Kelgar“, CC0): Hirsch mit
 * Geweih, Ricke und Hase mit Fell- und Normalen-Texturen und eigenen Bewegungen. Aufbereitet mit
 * `scripts/prepare-animals.py` (dem Rotwild fehlte ein Schritt – der Gang wurde dort über die Fuß-IK
 * erzeugt) und `scripts/compress-animals.mjs`.
 *
 * Wie bei den Schraten bleibt die KI samt Prozedur-Skelett (Position, Schritte für die Hufgeräusche)
 * unverändert; hier wird ihr Zustand in überblendete Bewegungen übersetzt.
 */

export type AnimalModelId = 'stag' | 'doe' | 'rabbit';
const MODEL_IDS: AnimalModelId[] = ['stag', 'doe', 'rabbit'];

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

const CAST: Record<AnimalModelId, Cast> = {
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
  cast: Cast;
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
      idle,
      death: cast.deaths[t.id % cast.deaths.length],
      wasDead: false,
      weights: new Map(),
      used: true,
      pending: 0,
    };
  }

  private drive(d: Driven, t: AnimalTarget, dt: number, viewer: THREE.Vector3): void {
    const { cast } = d;
    const a = t.rig.anim;
    const obj = d.avatar.object;
    obj.position.copy(t.rig.root.position);
    obj.quaternion.copy(t.rig.root.quaternion);

    const dist = obj.position.distanceTo(viewer);
    d.pending += dt;
    const step = dist > 80 ? 0.1 : dist > 40 ? 0.05 : 0;
    if (d.pending < step) return;
    const frame = d.pending;
    d.pending = 0;

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

  dispose(): void {
    for (const d of this.driven.values()) d.avatar.dispose();
    this.driven.clear();
  }
}
