import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import type { Avatar, CharacterLibrary, CharacterId } from '../entities/characters/CharacterLibrary';
import type { PlayerTarget, HitOutcome } from '../entities/enemies/Enemy';
import { createItemMesh } from '../entities/items/ItemMeshes';
import type { ItemId } from '../entities/items/ItemDefs';
import type { PlayerState } from './Protocol';

/**
 * Die Figuren der Mitspieler: animierte Menschen mit Namensschild, dem Gegenstand in der Hand und
 * einer Kapsel, an der sich Gegner (beim Gastgeber) orientieren. Gemeldete Positionen kommen etwa
 * 15-mal pro Sekunde; dazwischen gleitet die Figur weich hinterher.
 */

const HEIGHT = 1.78;
const RADIUS = 0.3;
const LOOKS: CharacterId[] = ['police_male', 'male_10', 'female_9', 'hazmat_suit_male'];

const IDLE = 'Idle_A';
const IDLE_ARMED = 'Idle_Sword';
const WALK = 'Walk_Large';
const RUN = 'Jog';
const SPRINT = 'Sprint';
const CROUCH = 'Crouch_Idle';
const CROUCH_WALK = 'Crouch_Walk';
const ATTACK = 'Melee_Hook';
const DEATH = 'Death_D';
const ANIMS = [IDLE, IDLE_ARMED, WALK, RUN, SPRINT, CROUCH, CROUCH_WALK, ATTACK, DEATH];

export class RemotePlayer {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  state: PlayerState;
  private readonly target = new THREE.Vector3();
  private yaw = 0;
  private avatar: Avatar | null = null;
  private fallback: THREE.Mesh | null = null;
  private readonly weights = new Map<string, number>();
  private item: ItemId | null = null;
  private itemMesh: THREE.Object3D | null = null;
  private swing = 0;
  private dying = 0;
  private readonly tag: THREE.Sprite;
  private readonly tagCanvas: HTMLCanvasElement | null;
  private tagText = '';
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** Für die Gegner beim Gastgeber. */
  readonly asTarget: PlayerTarget;

  constructor(
    initial: PlayerState,
    index: number,
    private readonly physics: Physics,
    characters: CharacterLibrary | null,
    /** Ein Gegner hat diesen Spieler getroffen (Gastgeber leitet es weiter). */
    onHurt: (amount: number, from: THREE.Vector3) => void,
  ) {
    this.state = initial;
    this.group.name = `Mitspieler ${initial.name}`;
    this.position.set(...initial.p);
    this.target.copy(this.position);
    this.yaw = initial.yaw;

    const look = LOOKS[index % LOOKS.length];
    if (characters?.has(look)) {
      const avatar = characters.create(look, HEIGHT, { tint: new THREE.Color(1, 0.98, 0.95) });
      this.avatar = avatar;
      this.group.add(avatar.object);
      for (const name of ANIMS) {
        const a = avatar.action(name);
        if (!a) continue;
        if (name === DEATH || name === ATTACK) {
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
        }
        a.play();
        a.setEffectiveWeight(name === IDLE ? 1 : 0);
        this.weights.set(name, name === IDLE ? 1 : 0);
      }
    } else {
      // Ohne geladene Figuren (Tests, Fehler beim Laden): schlichte Kapsel.
      this.fallback = new THREE.Mesh(new THREE.CapsuleGeometry(RADIUS, HEIGHT - RADIUS * 2, 4, 8), new THREE.MeshStandardMaterial({ color: 0x4a6a8a }));
      this.fallback.position.y = HEIGHT / 2;
      this.group.add(this.fallback);
    }

    this.tagCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const tex = this.tagCanvas ? new THREE.CanvasTexture(this.tagCanvas) : null;
    if (tex) tex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
    this.tag.renderOrder = 10;
    this.tag.position.y = HEIGHT + 0.45;
    this.group.add(this.tag);
    this.drawTag();

    const world = physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.position.x, this.position.y + 0.05, this.position.z));
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(HEIGHT / 2 - RADIUS, RADIUS)
        .setTranslation(0, HEIGHT / 2, 0)
        .setCollisionGroups(interactionGroups(CollisionGroup.ANIMAL, CollisionGroup.TERRAIN | CollisionGroup.STATIC)),
      this.body,
    );

    const self = this;
    const eye = new THREE.Vector3();
    this.asTarget = {
      get position() {
        return self.position;
      },
      get eye() {
        return eye.copy(self.position).setY(self.position.y + (self.state.crouch ? 1.0 : 1.6));
      },
      get collider() {
        return self.collider;
      },
      get isDead() {
        return self.state.dead || self.state.hidden;
      },
      get stealthy() {
        return self.state.crouch && self.state.speed < 3;
      },
      get velocity() {
        return self.velocity;
      },
      receiveHit(amount: number, from: THREE.Vector3): HitOutcome {
        onHurt(amount, from);
        return 'hit';
      },
    };
  }

  /** Neuer Zustand vom Netz. */
  apply(s: PlayerState): void {
    const prev = this.state;
    this.state = s;
    this.target.set(...s.p);
    // Teleport (Wiederbeleben, Höhle): nicht quer durch die Welt gleiten.
    if (this.target.distanceTo(this.position) > 15) this.position.copy(this.target);
    if (s.swings !== prev.swings) this.swing = 0.55;
    if (s.item !== this.item) this.setItem(s.item);
    if (s.name !== prev.name || Math.round(s.hp * 20) !== Math.round(prev.hp * 20) || s.dead !== prev.dead) this.drawTag();
    if (s.dead && !prev.dead) this.dying = 0.001;
    if (!s.dead) this.dying = 0;
  }

  update(dt: number, camera: THREE.Camera): void {
    const s = this.state;
    const before = this.tmp.copy(this.position);
    // Weich zur gemeldeten Position (etwa 100 ms hinterher).
    this.position.lerp(this.target, Math.min(1, dt * 10));
    this.velocity.subVectors(this.position, before).divideScalar(Math.max(dt, 1e-3));
    const d = Math.atan2(Math.sin(s.yaw - this.yaw), Math.cos(s.yaw - this.yaw));
    this.yaw += d * Math.min(1, dt * 12);
    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + 0.05, z: this.position.z });

    this.group.visible = !s.hidden;
    this.group.position.copy(this.position);
    // Die Figur schaut in Blickrichtung (Kamera: −Z vorne, Figur: +Z vorne).
    this.group.rotation.y = this.yaw + Math.PI;
    if (this.fallback) this.fallback.scale.y = s.crouch ? 0.65 : 1;

    // Namensschild: aus der Ferne größer, damit man den anderen findet.
    const dist = camera.position.distanceTo(this.position);
    const k = THREE.MathUtils.clamp(dist * 0.035, 0.45, 3.2);
    this.tag.scale.set(1.6 * k, 0.4 * k, 1);
    this.tag.position.y = (s.crouch ? 1.3 : HEIGHT) + 0.35 + k * 0.1;

    this.animate(dt);
  }

  private readonly tmp = new THREE.Vector3();

  private animate(dt: number): void {
    const a = this.avatar;
    if (!a) return;
    const s = this.state;
    const target = new Map<string, number>();
    if (s.dead) {
      target.set(DEATH, 1);
      if (this.dying > 0 && this.dying < 1) {
        const death = a.action(DEATH);
        if (death && this.dying === 0.001) death.reset().play();
        this.dying = Math.min(1, this.dying + dt);
      }
    } else {
      const speed = s.speed;
      const move = THREE.MathUtils.smoothstep(speed, 0.3, 1.0);
      if (s.crouch) {
        target.set(CROUCH, 1 - move);
        target.set(CROUCH_WALK, move);
      } else {
        const run = THREE.MathUtils.smoothstep(speed, 3.2, 4.6);
        const sprint = THREE.MathUtils.smoothstep(speed, 5.4, 6.6);
        target.set(this.item ? IDLE_ARMED : IDLE, 1 - move);
        target.set(WALK, move * (1 - run));
        target.set(RUN, move * run * (1 - sprint));
        target.set(SPRINT, move * run * sprint);
        const walk = a.action(WALK);
        if (walk) walk.timeScale = THREE.MathUtils.clamp(speed / 1.5, 0.6, 2);
      }
      if (this.swing > 0) {
        const atk = a.action(ATTACK);
        if (atk && this.swing === 0.55) atk.reset().play();
        this.swing = Math.max(0, this.swing - dt);
        // Der Schlag liegt über allem anderen (Oberkörper), kurz und deutlich.
        target.set(ATTACK, 1);
        for (const n of [IDLE, IDLE_ARMED, WALK, RUN, SPRINT, CROUCH, CROUCH_WALK]) target.set(n, (target.get(n) ?? 0) * 0.3);
      }
    }
    for (const name of ANIMS) {
      const action = a.action(name);
      if (!action) continue;
      const w = THREE.MathUtils.damp(this.weights.get(name) ?? 0, target.get(name) ?? 0, 10, dt);
      this.weights.set(name, w);
      action.setEffectiveWeight(w);
    }
    a.mixer.update(dt);
  }

  private setItem(id: ItemId | null): void {
    this.item = id;
    this.itemMesh?.removeFromParent();
    this.itemMesh = null;
    const hand = this.avatar?.bones.get('hand_r');
    if (!id || !hand) return;
    let mesh: THREE.Object3D;
    try {
      mesh = createItemMesh(id);
    } catch {
      return;
    }
    const holder = new THREE.Group();
    holder.add(mesh);
    mesh.position.y = 0.18;
    holder.rotation.set(0, 0, -Math.PI / 2);
    this.avatar!.object.updateMatrixWorld(true);
    holder.scale.setScalar(1 / new THREE.Vector3().setFromMatrixScale(hand.matrixWorld).x);
    hand.add(holder);
    this.itemMesh = holder;
  }

  private drawTag(): void {
    const c = this.tagCanvas;
    if (!c) return;
    const s = this.state;
    const text = `${s.name}|${Math.round(s.hp * 20)}|${s.dead}`;
    if (text === this.tagText) return;
    this.tagText = text;
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, 256, 64);
    g.font = '600 26px Oswald, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.fillStyle = s.dead ? '#d05040' : '#efe6cf';
    const label = s.dead ? `${s.name} †` : s.name;
    g.strokeText(label, 128, 24);
    g.fillText(label, 128, 24);
    // Lebensleiste
    if (!s.dead) {
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(68, 46, 120, 8);
      g.fillStyle = s.hp > 0.5 ? '#7fbf5a' : s.hp > 0.25 ? '#d9b62a' : '#d05040';
      g.fillRect(70, 48, 116 * THREE.MathUtils.clamp(s.hp, 0, 1), 4);
    }
    const tex = this.tag.material.map;
    if (tex) tex.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.physics.world.removeRigidBody(this.body);
    this.avatar?.dispose();
    this.tag.material.map?.dispose();
    this.tag.material.dispose();
  }
}
