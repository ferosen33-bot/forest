import * as THREE from 'three';
import type { ItemId } from './items/ItemDefs';
import { createItemMesh } from './items/ItemMeshes';
import { FireEffect } from './FireEffect';
import { damp, smoothstep } from '../utils/math';

/** Ruhepose eines gehaltenen Items relativ zur Kamera. */
interface HoldPose {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  /** Punkt am Modell, an dem die Hand zugreift (Modellkoordinaten). */
  grip: THREE.Vector3;
  scale: number;
}

const POSES: Partial<Record<ItemId, HoldPose>> = {
  // Stiel schräg von rechts unten, Kopf nach vorne gekippt, Schneide zeigt nach links.
  axe: { position: new THREE.Vector3(0.32, -0.38, -0.52), rotation: new THREE.Euler(-0.9, 2.3, 0.25, 'XYZ'), grip: new THREE.Vector3(0, -0.21, 0), scale: 0.9 },
  berries: { position: new THREE.Vector3(0.24, -0.25, -0.42), rotation: new THREE.Euler(0.3, 0.4, 0), grip: new THREE.Vector3(0, -0.04, 0), scale: 1.3 },
  stick: { position: new THREE.Vector3(0.28, -0.32, -0.5), rotation: new THREE.Euler(-0.5, 0, -0.3), grip: new THREE.Vector3(0, -0.3, 0), scale: 1 },
  stone: { position: new THREE.Vector3(0.26, -0.27, -0.45), rotation: new THREE.Euler(0.2, 0.5, 0), grip: new THREE.Vector3(0, -0.06, 0), scale: 1 },
  stoneAxe: { position: new THREE.Vector3(0.32, -0.38, -0.52), rotation: new THREE.Euler(-0.9, 2.3, 0.25, 'XYZ'), grip: new THREE.Vector3(0, -0.2, 0), scale: 0.9 },
  // Speer zeigt nach vorne, leicht nach innen gedreht.
  spear: { position: new THREE.Vector3(0.26, -0.3, -0.45), rotation: new THREE.Euler(-1.45, 0.08, 0, 'XYZ'), grip: new THREE.Vector3(0, -0.2, 0), scale: 1 },
  torch: { position: new THREE.Vector3(0.36, -0.44, -0.66), rotation: new THREE.Euler(-0.55, 0, -0.3), grip: new THREE.Vector3(0, -0.15, 0), scale: 0.85 },
  log: { position: new THREE.Vector3(0.05, -0.45, -0.75), rotation: new THREE.Euler(0, 0, Math.PI / 2 - 0.1), grip: new THREE.Vector3(0, 0, 0), scale: 0.8 },
};

/** Schlag-Keyframes (horizontaler Hieb von rechts nach links): Positions- und Rotationsversatz. */
const SWING_KEYS: { t: number; pos: [number, number, number]; rot: [number, number, number] }[] = [
  { t: 0, pos: [0, 0, 0], rot: [0, 0, 0] },
  { t: 0.34, pos: [0.16, 0.07, 0.14], rot: [0.2, 0.75, -0.3] }, // ausholen
  { t: 0.48, pos: [-0.24, -0.02, -0.24], rot: [-0.15, -0.95, 0.35] }, // zuschlagen
  { t: 0.62, pos: [-0.28, -0.06, -0.2], rot: [-0.15, -1.05, 0.4] }, // durchziehen
  { t: 1, pos: [0, 0, 0], rot: [0, 0, 0] },
];

/** Stoß (Speer): zurückziehen, nach vorne stoßen, zurück. */
const THRUST_KEYS: typeof SWING_KEYS = [
  { t: 0, pos: [0, 0, 0], rot: [0, 0, 0] },
  { t: 0.3, pos: [0.02, 0.02, 0.18], rot: [0.06, 0, 0] },
  { t: 0.45, pos: [-0.06, 0.04, -0.42], rot: [-0.05, 0, 0] },
  { t: 0.6, pos: [-0.06, 0.03, -0.38], rot: [-0.05, 0, 0] },
  { t: 1, pos: [0, 0, 0], rot: [0, 0, 0] },
];

/** Essen: zum Mund führen und zurück. */
const EAT_KEYS: typeof SWING_KEYS = [
  { t: 0, pos: [0, 0, 0], rot: [0, 0, 0] },
  { t: 0.45, pos: [-0.22, 0.2, 0.25], rot: [0.6, 0, 0.3] },
  { t: 0.6, pos: [-0.22, 0.17, 0.25], rot: [0.6, 0, 0.3] },
  { t: 1, pos: [0, 0, 0], rot: [0, 0, 0] },
];

function sampleKeys(keys: typeof SWING_KEYS, u: number, pos: THREE.Vector3, rot: THREE.Vector3): void {
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (u <= b.t) {
      const k = smoothstep(a.t, b.t, u);
      pos.set(a.pos[0] + (b.pos[0] - a.pos[0]) * k, a.pos[1] + (b.pos[1] - a.pos[1]) * k, a.pos[2] + (b.pos[2] - a.pos[2]) * k);
      rot.set(a.rot[0] + (b.rot[0] - a.rot[0]) * k, a.rot[1] + (b.rot[1] - a.rot[1]) * k, a.rot[2] + (b.rot[2] - a.rot[2]) * k);
      return;
    }
  }
  pos.set(0, 0, 0);
  rot.set(0, 0, 0);
}

/** Lichtquellen der Hauptszene, deren Werte das ViewModel übernimmt. */
export interface LightSource {
  hemi: THREE.HemisphereLight;
  light: THREE.DirectionalLight;
}

/**
 * First-Person-Darstellung des gehaltenen Items ("Viewmodel").
 *
 * Wird in einer eigenen Szene mit eigener Kamera (fester FOV) NACH der Welt gerendert,
 * mit vorher geleertem Tiefenpuffer – so ragt die Axt nie in Bäume oder Wände.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);

  private readonly root = new THREE.Group(); // folgt der Kamera-Pose (inkl. Sway/Bob)
  private readonly pose = new THREE.Group(); // Ruhepose + Animationsversatz
  private readonly arm: THREE.Group;
  private model: THREE.Object3D | null = null;
  private currentId: ItemId | null = null;
  private pendingId: ItemId | null = null;
  private hasPending = false;

  /** 0 = weggesteckt, 1 = in der Hand. */
  private raise = 0;
  private action: { keys: typeof SWING_KEYS; time: number; duration: number } | null = null;
  private recoil = 0;
  private block = 0;
  private blocking = false;
  private aim = 0;
  private aiming = false;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private time = 0;

  private readonly flame = new FireEffect(0.16);
  /** Licht der Fackel für Hand und Item (eigene Szene → eigenes Licht, Anzahl bleibt fix). */
  private readonly handLight = new THREE.PointLight(0xffa04a, 0, 3, 2);
  private readonly hemi = new THREE.HemisphereLight();
  private readonly light = new THREE.DirectionalLight();
  private readonly animPos = new THREE.Vector3();
  private readonly animRot = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();

  constructor() {
    this.scene.add(this.camera, this.hemi, this.light, this.light.target);
    this.camera.add(this.handLight);
    this.handLight.position.set(0.25, -0.05, -0.45);
    this.camera.add(this.root);
    this.root.add(this.pose);
    this.arm = this.createArm();
    this.pose.add(this.arm);
    this.arm.visible = false;
  }

  get busy(): boolean {
    return this.action !== null || this.hasPending;
  }

  /** Wechselt das gehaltene Item (mit Weg-/Hervorhol-Animation). */
  equip(id: ItemId | null): void {
    if (id === this.currentId && !this.hasPending) return;
    this.pendingId = id;
    this.hasPending = true;
    this.action = null;
  }

  /** Startet eine Schlag- bzw. Stoßanimation über `duration` Sekunden. */
  playSwing(duration: number, style: 'swing' | 'thrust' = 'swing'): void {
    this.action = { keys: style === 'thrust' ? THRUST_KEYS : SWING_KEYS, time: 0, duration };
  }

  /** Weltposition der Fackelflamme (gleiches Koordinatensystem wie die Spielwelt), sonst null. */
  getFlamePosition(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.flame.object.parent || this.raise < 0.5) return null;
    this.scene.updateMatrixWorld();
    return this.flame.object.getWorldPosition(out);
  }

  get flameFlicker(): number {
    return this.flame.flicker;
  }

  playEat(duration: number): void {
    this.action = { keys: EAT_KEYS, time: 0, duration };
  }

  /** Rückstoß beim Auftreffen (kurzes Zurückfedern + "Hit-Stop"). */
  playHit(): void {
    this.recoil = 1;
    if (this.action) this.action.time -= 0.05;
  }

  /** Deckung: Waffe quer vor den Körper halten. */
  setBlocking(on: boolean): void {
    this.blocking = on;
  }

  /** Wurfhaltung: Speer über der Schulter zurückgezogen. */
  setAiming(on: boolean): void {
    this.aiming = on;
  }

  /** Abwurf: sofort aus der Zielhaltung nach vorne schnellen. */
  playThrow(): void {
    this.aiming = false;
    this.aim = 0;
    this.recoil = -1.5;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param main Spielkamera (Position/Rotation werden übernommen)
   * @param bob  Head-Bob des Spielers für synchrones Wippen
   */
  update(
    dt: number,
    main: THREE.PerspectiveCamera,
    look: { yaw: number; pitch: number },
    bob: { phase: number; amount: number },
    lights: LightSource,
  ): void {
    this.time += dt;
    this.camera.position.copy(main.position);
    this.camera.quaternion.copy(main.quaternion);

    // Item-Wechsel: erst absenken, dann tauschen, dann anheben.
    if (this.hasPending) {
      this.raise = Math.max(0, this.raise - dt * 7);
      if (this.raise === 0) this.swapModel();
    } else if (this.model) {
      this.raise = Math.min(1, this.raise + dt * 5);
    }

    // Aktion (Schlag, Essen)
    this.animPos.set(0, 0, 0);
    this.animRot.set(0, 0, 0);
    if (this.action) {
      this.action.time += dt;
      const u = Math.max(0, this.action.time) / this.action.duration;
      if (u >= 1) this.action = null;
      else sampleKeys(this.action.keys, u, this.animPos, this.animRot);
    }
    this.recoil = damp(this.recoil, 0, 14, dt);
    this.block = damp(this.block, this.blocking ? 1 : 0, 14, dt);
    if (this.block > 0.001) {
      this.animPos.x -= 0.22 * this.block;
      this.animPos.y += 0.16 * this.block;
      this.animPos.z += 0.06 * this.block;
      this.animRot.z += 1.25 * this.block;
      this.animRot.x += 0.2 * this.block;
    }
    this.aim = damp(this.aim, this.aiming ? 1 : 0, 10, dt);
    if (this.aim > 0.001) {
      // Ausholen: hoch über die Schulter, nach hinten gezogen, leicht zitternd.
      const shake = Math.sin(this.time * 31) * 0.002 * this.aim;
      this.animPos.x += 0.06 * this.aim;
      this.animPos.y += 0.2 * this.aim + shake;
      this.animPos.z += 0.22 * this.aim;
      this.animRot.x -= 0.12 * this.aim;
    }

    // Sway: das Item hinkt der Blickbewegung leicht hinterher.
    const dYaw = look.yaw - this.lastYaw;
    const dPitch = look.pitch - this.lastPitch;
    this.lastYaw = look.yaw;
    this.lastPitch = look.pitch;
    this.swayX = damp(this.swayX + dYaw * 0.6, 0, 9, dt);
    this.swayY = damp(this.swayY + dPitch * 0.6, 0, 9, dt);

    const breathe = Math.sin(this.time * 1.6) * 0.006;
    const bobX = Math.cos(bob.phase) * 0.018 * bob.amount;
    const bobY = Math.abs(Math.sin(bob.phase)) * 0.025 * bob.amount;
    const lowered = 1 - smoothstep(0, 1, this.raise);

    this.root.position.set(
      this.swayX * 0.4 + bobX,
      breathe - bobY - lowered * 0.55 - this.swayY * 0.3,
      this.recoil * 0.06,
    );
    this.root.rotation.set(-lowered * 0.6 + this.recoil * 0.12, this.swayX * 0.8, -this.swayX * 0.4);

    // Pose-Knoten: Position + Animation. Die Ruhe-Ausrichtung des Items sitzt am Griff-Knoten,
    // damit der Arm (ebenfalls am Pose-Knoten) immer natürlich nach hinten unten zeigt.
    const pose = this.currentId ? POSES[this.currentId] : undefined;
    if (pose) {
      this.pose.position.copy(pose.position).add(this.animPos);
      this.pose.rotation.set(this.animRot.x, this.animRot.y, this.animRot.z);
    }

    // Beleuchtung aus der Welt übernehmen (ohne Schatten).
    this.hemi.color.copy(lights.hemi.color);
    this.hemi.groundColor.copy(lights.hemi.groundColor);
    this.hemi.intensity = lights.hemi.intensity;
    this.light.color.copy(lights.light.color);
    this.light.intensity = lights.light.intensity;
    this.tmpDir.subVectors(lights.light.position, lights.light.target.position).normalize();
    this.light.position.copy(this.camera.position).addScaledVector(this.tmpDir, 5);
    this.light.target.position.copy(this.camera.position);
    this.light.target.updateMatrixWorld();

    // Fackel: Flamme animieren und Hand/Item beleuchten.
    const torchLit = this.flame.object.parent !== null;
    if (torchLit) this.flame.update(dt);
    this.handLight.intensity = torchLit ? 0.45 * this.flame.flicker * smoothstep(0, 1, this.raise) : 0;
  }

  get visible(): boolean {
    return this.model !== null;
  }

  private swapModel(): void {
    if (this.model) this.pose.remove(this.model);
    this.flame.object.removeFromParent();
    this.model = null;
    this.currentId = this.pendingId;
    this.hasPending = false;

    const pose = this.currentId ? POSES[this.currentId] : undefined;
    if (!this.currentId || !pose) {
      this.arm.visible = false;
      return;
    }
    this.model = createItemMesh(this.currentId);
    this.model.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    this.model.position.copy(pose.grip).multiplyScalar(-1);
    if (this.currentId === 'torch') {
      this.flame.object.position.set(0, 0.32, 0);
      this.model.add(this.flame.object);
    }
    this.model.scale.setScalar(pose.scale);
    // Griff-Gruppe trägt die Ruhe-Ausrichtung; gedreht wird um den Griffpunkt (= Hand).
    const grip = new THREE.Group();
    grip.rotation.copy(pose.rotation);
    grip.add(this.model);
    this.model = grip;
    this.pose.add(grip);
    this.arm.visible = this.currentId !== 'log';
  }

  /** Einfacher Unterarm mit Hand – hält das Item im Ursprung der Pose. */
  private createArm(): THREE.Group {
    const skin = new THREE.MeshStandardMaterial({ color: 0xc69276, roughness: 0.8, flatShading: true });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x3b4a3a, roughness: 0.95, flatShading: true });
    const arm = new THREE.Group();
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.09), skin);
    arm.add(hand);
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.32), skin);
    forearm.position.set(0.02, -0.05, 0.19);
    forearm.rotation.x = 0.35;
    arm.add(forearm);
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.095, 0.3), sleeve);
    cuff.position.set(0.03, -0.14, 0.42);
    cuff.rotation.x = 0.35;
    arm.add(cuff);
    return arm;
  }
}
