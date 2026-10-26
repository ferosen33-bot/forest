import * as THREE from 'three';
import type { ItemId } from './items/ItemDefs';
import { createItemMesh } from './items/ItemMeshes';
import { FireEffect } from './FireEffect';
import { FOREARM, type FirstPersonArm, type HandPose } from './characters/FirstPersonArm';
import { damp, smoothstep } from '../utils/math';

/** Ruhepose eines gehaltenen Items relativ zur Kamera. */
interface HoldPose {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  /** Punkt am Modell, an dem die Hand zugreift (Modellkoordinaten). */
  grip: THREE.Vector3;
  scale: number;
  /** Haltung der Hand (ohne Angabe: Faust um die Längsachse des Items). */
  hand?: HandPose;
  /** Eigene Richtung von der Hand zum Ellbogen (ohne Angabe: schräg nach hinten unten). */
  forearm?: THREE.Vector3;
}

/** Offene Hand unter der Schale: Unterarm steiler nach unten. */
const PALM_FOREARM = new THREE.Vector3(0.18, -0.62, 0.76).normalize();
/** Linke Hand am Bogengriff: Arm nach vorne gestreckt (im Spiegelraum angegeben → nach links unten hinten). */
const BOW_FOREARM = new THREE.Vector3(0.32, -0.55, 0.77).normalize();
/** Bogen (Modellraum): halbe Sehnenlänge; bei voller Spannung liegt die Sehne an der Wange. */
const BOW_HALF = 0.62 * Math.sin(0.75);
const BOW_PULL = 0.85;
/** Eingelegter Pfeil im (verkleinerten) Bogenraum: länger als der volle Auszug. */
const NOCKED_SCALE = 1.4;

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
  // Schale liegt auf der offenen Hand (Boden auf der Handfläche, nichts ragt ins Wasser).
  bowl: { position: new THREE.Vector3(0.17, -0.23, -0.42), rotation: new THREE.Euler(0.3, 0, 0), grip: new THREE.Vector3(0, -0.05, 0), scale: 1.2, hand: 'palm' },
  bowlWater: { position: new THREE.Vector3(0.17, -0.23, -0.42), rotation: new THREE.Euler(0.3, 0, 0), grip: new THREE.Vector3(0, -0.05, 0), scale: 1.2, hand: 'palm' },
  // Bogen in der linken Hand, senkrecht links der Mitte, Wölbung nach vorne (lokal +X → Blickrichtung).
  // Leicht nach rechts gekantet – um die Pfeilachse (lokal X), damit die Sehne beim Spannen gerade zurückläuft.
  bow: { position: new THREE.Vector3(-0.08, -0.14, -0.6), rotation: new THREE.Euler(-0.2, Math.PI / 2 + 0.1, 0, 'YXZ'), grip: new THREE.Vector3(0.18, 0, 0), scale: 0.62 },
  arrow: { position: new THREE.Vector3(0.26, -0.3, -0.48), rotation: new THREE.Euler(-1.3, 0.1, 0), grip: new THREE.Vector3(0, -0.15, 0), scale: 1 },
  log: { position: new THREE.Vector3(0.05, -0.45, -0.75), rotation: new THREE.Euler(0, 0, Math.PI / 2 - 0.1), grip: new THREE.Vector3(0, 0, 0), scale: 0.8 },
  // Rute schräg nach vorne oben, etwas zur Mitte geneigt.
  fishingRod: { position: new THREE.Vector3(0.32, -0.38, -0.5), rotation: new THREE.Euler(-1.0, 0, 0.22), grip: new THREE.Vector3(0, -0.56, 0), scale: 0.7 },
  flintAxe: { position: new THREE.Vector3(0.32, -0.38, -0.52), rotation: new THREE.Euler(-0.9, 2.3, 0.25, 'XYZ'), grip: new THREE.Vector3(0, -0.2, 0), scale: 0.9 },
  flint: { position: new THREE.Vector3(0.26, -0.27, -0.45), rotation: new THREE.Euler(0.2, 0.5, 0), grip: new THREE.Vector3(0, -0.05, 0), scale: 1.1 },
  mushroom: { position: new THREE.Vector3(0.24, -0.26, -0.42), rotation: new THREE.Euler(0.25, 0.4, 0), grip: new THREE.Vector3(0, -0.04, 0), scale: 1.3 },
  medkit: { position: new THREE.Vector3(0.22, -0.27, -0.44), rotation: new THREE.Euler(0.35, 0.5, 0), grip: new THREE.Vector3(0, -0.05, 0), scale: 1 },
  cannedFood: { position: new THREE.Vector3(0.24, -0.27, -0.44), rotation: new THREE.Euler(0.3, 0.4, 0), grip: new THREE.Vector3(0, -0.05, 0), scale: 1.1 },
  waterBottle: { position: new THREE.Vector3(0.24, -0.3, -0.45), rotation: new THREE.Euler(0.15, 0, -0.1), grip: new THREE.Vector3(0, -0.08, 0), scale: 1 },
  bottle: { position: new THREE.Vector3(0.24, -0.3, -0.45), rotation: new THREE.Euler(0.15, 0, -0.1), grip: new THREE.Vector3(0, -0.08, 0), scale: 1 },
  molotov: { position: new THREE.Vector3(0.24, -0.3, -0.45), rotation: new THREE.Euler(0.15, 0, -0.1), grip: new THREE.Vector3(0, -0.08, 0), scale: 1 },
  painkillers: { position: new THREE.Vector3(0.22, -0.26, -0.42), rotation: new THREE.Euler(0.4, 0.5, 0), grip: new THREE.Vector3(0, -0.03, 0), scale: 1.3 },
  machete: { position: new THREE.Vector3(0.3, -0.36, -0.5), rotation: new THREE.Euler(-0.75, 0.1, -0.25), grip: new THREE.Vector3(0, -0.24, 0), scale: 1 },
  boneClub: { position: new THREE.Vector3(0.32, -0.38, -0.52), rotation: new THREE.Euler(-0.8, 0.2, -0.25), grip: new THREE.Vector3(0, -0.2, 0), scale: 0.95 },
  // Lampe zeigt nach vorne (Längsachse +Y → Blickrichtung); die Faust umschließt den Bügel unter dem Gehäuse.
  // Der Bügel läuft nach vorne – die Faust umschließt ihn von unten, der Unterarm hängt darunter.
  flashlight: {
    position: new THREE.Vector3(0.24, -0.2, -0.46),
    rotation: new THREE.Euler(-1.5, 0.05, 0),
    grip: new THREE.Vector3(0, -0.02, -0.05),
    scale: 1,
    forearm: new THREE.Vector3(0.18, -0.95, 0.25).normalize(),
  },
  battery: { position: new THREE.Vector3(0.24, -0.27, -0.44), rotation: new THREE.Euler(0.3, 0.4, 0.5), grip: new THREE.Vector3(0, 0, 0), scale: 1.4 },
  rawFish: { position: new THREE.Vector3(0.24, -0.27, -0.44), rotation: new THREE.Euler(0.2, 0.3, 1.3), grip: new THREE.Vector3(0, -0.05, 0), scale: 1 },
  cookedFish: { position: new THREE.Vector3(0.24, -0.27, -0.44), rotation: new THREE.Euler(0.2, 0.3, 1.3), grip: new THREE.Vector3(0, -0.05, 0), scale: 1 },
};

/** Versatz aller Halte-Posen, sobald die echte Hand sichtbar ist. */
const HAND_LIFT = new THREE.Vector3(-0.025, 0.13, 0.04);
const ZERO = new THREE.Vector3();
const UP_Y = new THREE.Vector3(0, 1, 0);
const STRING_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.6 });

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

/** Auswerfen: Rute über die Schulter zurück, dann nach vorne schnellen. */
const CAST_KEYS: typeof SWING_KEYS = [
  { t: 0, pos: [0, 0, 0], rot: [0, 0, 0] },
  { t: 0.38, pos: [0.02, 0.1, 0.12], rot: [0.95, 0, -0.1] },
  { t: 0.55, pos: [-0.02, 0.02, -0.1], rot: [-0.55, 0, 0.05] },
  { t: 1, pos: [0, 0, 0], rot: [-0.25, 0, 0] },
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
  /** Echter Arm mit Hand (ersetzt den Quader-Arm, sobald die Figuren geladen sind). */
  private fpArm: FirstPersonArm | null = null;
  /** Linke Hand (gespiegelter Arm) – hält den Bogen. */
  private leftArm: FirstPersonArm | null = null;
  private readonly leftHolder = new THREE.Group();
  /** Bogen: Sehne in zwei Hälften (zur Zughand hin ausgezogen) und der eingelegte Pfeil im Bogenraum. */
  private bowString: THREE.Mesh[] = [];
  private readonly nock = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
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
  /** Spannung des Bogens 0..1 */
  private draw = 0;
  /** Angel: Schnur draußen (Rute gesenkt) und Zug am Haken (Rute biegt und zittert). */
  private rodOut = 0;
  private rodPull = 0;
  private rodOutTarget = false;
  private rodPullTarget = 0;
  private readonly tipPos = new THREE.Vector3();
  /** Eingelegter Pfeil (sichtbar, solange gespannt wird). */
  private readonly nocked = createItemMesh('arrow').clone();
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private time = 0;

  private readonly flame = new FireEffect(0.16, { smoke: false, sparks: false, heat: false });
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
    // Pfeil zeigt entlang der Blickrichtung (seine Längsachse ist +Y).
    this.nocked.rotation.x = -Math.PI / 2;
    this.nocked.visible = false;
    this.pose.add(this.nocked);
    this.arm = this.createArm();
    this.pose.add(this.arm);
    this.arm.visible = false;
  }

  /** Echte Arme einsetzen (statt des einfachen Quader-Arms); der linke ist gespiegelt. */
  setArm(arm: FirstPersonArm, left?: FirstPersonArm): void {
    this.fpArm = arm;
    this.arm.clear();
    this.arm.add(arm.object);
    if (left) {
      this.leftArm = left;
      this.leftHolder.clear();
      this.leftHolder.scale.x = -1;
      this.leftHolder.add(left.object);
      this.leftHolder.visible = false;
      this.pose.add(this.leftHolder);
    }
    this.alignHands();
  }

  /** Hände ans gehaltene Item legen. */
  private alignHands(): void {
    const id = this.currentId;
    const pose = id ? POSES[id] : undefined;
    if (!pose || !this.fpArm) return;
    const axis = new THREE.Vector3(0, 1, 0).applyEuler(pose.rotation);
    if (id === 'bow' && this.leftArm) {
      // Links: Faust um den Griff. Der Arm hängt in einem gespiegelten Knoten (x → −x): die Griffachse
      // wird dorthin umgerechnet, der Unterarm ist schon im Spiegelraum angegeben.
      this.leftHolder.visible = true;
      this.arm.visible = false;
      // Das Handgelenk knickt ab: Die Faust liegt oben etwas zum Körper gekippt am Griff, damit der Arm
      // nach unten aus dem Bild laufen kann (bei exakt senkrechtem Griff stünde er waagerecht).
      const tilted = axis.clone().lerp(new THREE.Vector3(0, 0, 1), 0.35).normalize();
      this.leftArm.align(tilted.setX(-tilted.x), 'fist', BOW_FOREARM);
      return;
    }
    this.leftHolder.visible = false;
    this.arm.position.set(0, 0, 0);
    this.fpArm.align(axis, pose.hand ?? 'fist', pose.forearm ?? (pose.hand === 'palm' ? PALM_FOREARM : FOREARM));
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

  /** Weltposition der Lampe (Taschenlampe in der Hand), sonst null. */
  getLampPosition(out: THREE.Vector3): THREE.Vector3 | null {
    const lamp = this.currentId === 'flashlight' && this.raise > 0.5 ? this.model?.getObjectByName('lamp') : undefined;
    if (!lamp) return null;
    this.scene.updateMatrixWorld();
    return lamp.getWorldPosition(out);
  }

  get flameFlicker(): number {
    return this.flame.flicker;
  }

  playCast(duration: number): void {
    this.action = { keys: CAST_KEYS, time: 0, duration };
  }

  /** Angelzustand: `out` = Köder im Wasser, `pull` 0..1 = Fisch zieht. */
  setRod(out: boolean, pull: number): void {
    this.rodOutTarget = out;
    this.rodPullTarget = pull;
  }

  /**
   * Spitze der Angelrute als Weltpunkt, passend zur Spielkamera (für die Schnur in der Welt).
   * Das ViewModel hat ein eigenes Sichtfeld – der Punkt wird daher über den Bildschirm
   * auf die Spielkamera übertragen, damit die Schnur exakt an der sichtbaren Spitze ansetzt.
   */
  getRodTip(out: THREE.Vector3, main: THREE.PerspectiveCamera): THREE.Vector3 | null {
    const tip = this.currentId === 'fishingRod' && this.raise > 0.5 ? this.model?.getObjectByName('tip') : undefined;
    if (!tip) return null;
    this.scene.updateMatrixWorld();
    tip.getWorldPosition(this.tipPos);
    this.camera.worldToLocal(this.tipPos);
    const k = Math.tan(THREE.MathUtils.degToRad(main.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    out.set(this.tipPos.x * k, this.tipPos.y * k, this.tipPos.z);
    return main.localToWorld(out);
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

  /** Bogen spannen (0 = locker, 1 = voll gespannt). */
  setDraw(charge: number): void {
    this.draw = charge;
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
    // Bogen: beim Spannen zur Mitte schwenken, bis der Pfeil von der Wange aufs Fadenkreuz zeigt.
    const bowHeld = this.currentId === 'bow';
    if (bowHeld && this.draw > 0) {
      this.animPos.x += 0.07 * this.draw;
      this.animPos.y -= 0.03 * this.draw;
      this.animPos.z += 0.04 * this.draw;
    }
    this.nocked.visible = bowHeld && this.raise > 0.9 && (this.draw > 0.02 || !!this.leftArm);
    // Angel: mit Köder im Wasser etwas gesenkt; beißt ein Fisch, ruckt die Rute nach vorne.
    this.rodOut = damp(this.rodOut, this.rodOutTarget ? 1 : 0, 6, dt);
    this.rodPull = damp(this.rodPull, this.rodPullTarget, 12, dt);
    if (this.currentId === 'fishingRod') {
      const jerk = Math.sin(this.time * 38) * 0.03 * this.rodPull;
      this.animRot.x -= 0.22 * this.rodOut + 0.35 * this.rodPull + jerk;
      this.animPos.y -= 0.03 * this.rodOut;
    }
    if (bowHeld) this.updateBow();
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

    // Mit echter Hand etwas höher und näher halten, damit Faust und Handgelenk im Bild sind.
    const lift = this.fpArm ? HAND_LIFT : ZERO;
    this.root.position.set(
      this.swayX * 0.4 + bobX + lift.x,
      breathe - bobY - lowered * 0.55 - this.swayY * 0.3 + lift.y,
      this.recoil * 0.06 + lift.z,
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
    // Den Bogen hält die linke Hand; die rechte zieht die Sehne an die Wange – außerhalb des Blickfelds.
    this.arm.visible = this.currentId !== 'log' && !(this.currentId === 'bow' && this.leftArm);
    // Bogen: gerade Sehne durch zwei Hälften ersetzen, die zur Zughand hin ausgezogen werden;
    // der Pfeil liegt im Bogenraum auf der Sehne.
    this.bowString = [];
    if (this.currentId === 'bow') {
      const inner = grip.children[0];
      inner.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry.type === 'CylinderGeometry' && (m.geometry as THREE.CylinderGeometry).parameters.radiusTop < 0.005) m.visible = false;
      });
      for (let i = 0; i < 2; i++) {
        const half = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 1, 3), STRING_MATERIAL);
        inner.add(half);
        this.bowString.push(half);
      }
      this.nocked.removeFromParent();
      this.nocked.rotation.set(0, 0, -Math.PI / 2);
      this.nocked.scale.setScalar(NOCKED_SCALE);
      inner.add(this.nocked);
    } else if (this.nocked.parent !== this.pose) {
      this.nocked.removeFromParent();
      this.nocked.rotation.set(-Math.PI / 2, 0, 0);
      this.nocked.scale.setScalar(1);
      this.pose.add(this.nocked);
    }
    // Hände: Faust um den Stiel (Griffachse = Item-Längsachse nach der Ruhe-Drehung), Schale auf der Hand, Bogen mit zwei Händen.
    this.alignHands();
  }

  /**
   * Bogen: Sehne zum Zugpunkt ausziehen, Pfeil einlegen, rechte Hand an die Sehne.
   * Bogenraum: Sehne entlang Y bei x = 0, Wölbung nach +X (vorne); der Griff liegt bei x ≈ 0,18.
   */
  private updateBow(): void {
    const inner = this.model?.children[0];
    if (!inner || this.bowString.length < 2) return;
    const pull = BOW_PULL * this.draw;
    this.nock.set(-pull, 0, 0);
    const tips = [new THREE.Vector3(0, BOW_HALF, 0), new THREE.Vector3(0, -BOW_HALF, 0)];
    this.bowString.forEach((m, i) => {
      const dir = this.tmpA.subVectors(this.nock, tips[i]);
      m.scale.set(1, dir.length(), 1);
      m.position.copy(tips[i]).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(UP_Y, dir.normalize());
    });
    // Pfeil: Nocke auf der Sehne, Spitze nach vorne (+X); Mitte des Schafts 0,34 vor der Nocke.
    this.nocked.position.set(this.nock.x + 0.34 * NOCKED_SCALE, 0.01, 0);
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
