import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import type { Input } from '../core/Input';
import type { EventBus } from '../core/EventBus';
import type { GameConfig } from '../config';
import type { HeightMap } from '../world/HeightMap';
import { PlayerStats } from './PlayerStats';
import { approach, clamp, damp } from '../utils/math';

const DEG = Math.PI / 180;
const MAX_PITCH = 89 * DEG;
const MAX_OXYGEN = 100;

/**
 * First-Person-Spieler auf Basis von Rapiers Kinematic Character Controller.
 *
 * Ablauf pro Frame (gesteuert von `Game`):
 *   1. `handleInput()`        – Maus-Look & Tastenimpulse (framegenau)
 *   2. `fixedUpdate()` × n    – Bewegung im festen Physik-Takt, danach `world.step()`
 *   3. `afterPhysicsStep()`   – neue Position übernehmen
 *   4. `updateCamera(alpha)`  – Kamera zwischen den letzten zwei Physik-Zuständen interpolieren
 *
 * Der Rigidbody-Ursprung liegt an den FÜSSEN; die Kapsel sitzt darüber. So bleibt die
 * Fußposition beim Ducken (Kapsel schrumpft) unverändert.
 */
export class Player {
  readonly stats: PlayerStats;
  /** Interpolierte Fußposition (für Kamera, Schatten, Audio ...). */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();

  yaw = 0;
  pitch = 0;
  grounded = false;
  crouching = false;
  swimming = false;
  sprinting = false;
  /** Atemluft, sinkt wenn der Kopf unter Wasser ist. */
  oxygen = MAX_OXYGEN;

  private readonly cfg: GameConfig['player'];
  private readonly statsCfg: GameConfig['stats'];
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly filterGroups: number;

  private height: number;
  private eyeHeight: number;
  private readonly prevFeet = new THREE.Vector3();
  private readonly currFeet = new THREE.Vector3();
  private readonly moveInput = new THREE.Vector2();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly wish = new THREE.Vector3();

  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private landDip = 0;
  private landDipVel = 0;
  private fovCurrent: number;
  private wantsCrouch = false;
  private wantsSprint = false;
  private wantsUp = false;
  private submersion = 0;

  constructor(
    private readonly physics: Physics,
    readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    private readonly heightMap: HeightMap,
    private readonly events: EventBus,
    config: GameConfig,
  ) {
    this.cfg = config.player;
    this.statsCfg = config.stats;
    this.stats = new PlayerStats(config, events);
    this.height = this.cfg.standHeight;
    this.eyeHeight = this.height - this.cfg.eyeFromTop;
    this.fovCurrent = this.cfg.fov;

    const world = physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 50, 0));

    const r = this.cfg.radius;
    // Der Spieler kollidiert mit Terrain und statischen Objekten, läuft aber durch
    // lose Items hindurch (verhindert Hängenbleiben an herumliegenden Stämmen).
    this.filterGroups = interactionGroups(
      CollisionGroup.PLAYER,
      0xffff & ~(CollisionGroup.PLAYER | CollisionGroup.ITEM),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(this.halfHeightFor(this.height), r)
        .setTranslation(0, this.height / 2, 0)
        .setCollisionGroups(this.filterGroups)
        .setFriction(0),
      this.body,
    );

    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(this.cfg.stepHeight, 0.2, false);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle(this.cfg.maxSlopeDeg * DEG);
    this.controller.setMinSlopeSlideAngle((this.cfg.maxSlopeDeg + 5) * DEG);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(80);
  }

  // ---------------------------------------------------------------------------
  // Öffentliche API
  // ---------------------------------------------------------------------------

  /** Setzt den Spieler an eine Fußposition (Spawn, Respawn, Teleport). */
  spawn(feet: THREE.Vector3, yaw = this.yaw): void {
    this.body.setTranslation({ x: feet.x, y: feet.y + 0.05, z: feet.z }, true);
    this.body.setNextKinematicTranslation({ x: feet.x, y: feet.y + 0.05, z: feet.z });
    this.currFeet.set(feet.x, feet.y + 0.05, feet.z);
    this.prevFeet.copy(this.currFeet);
    this.position.copy(this.currFeet);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.oxygen = MAX_OXYGEN;
    this.setHeight(this.cfg.standHeight);
    this.crouching = false;
  }

  respawn(feet: THREE.Vector3): void {
    this.stats.reset();
    this.spawn(feet);
    this.events.emit('player:respawned', {});
  }

  /** Augenposition (interpoliert), z. B. als Ursprung für Interaktions-Raycasts. */
  get eyePosition(): THREE.Vector3 {
    return this.camera.position;
  }

  get headUnderwater(): boolean {
    return this.camera.position.y < this.heightMap.waterLevel;
  }

  /** Eigener Collider – wird bei Raycasts (Interaktion, Werkzeuge) ausgeschlossen. */
  get collisionShape(): RAPIER.Collider {
    return this.collider;
  }

  /** Steht oder schwimmt im Wasser (Füße unter dem Wasserspiegel). */
  get isInWater(): boolean {
    return this.submersion > 0.1;
  }

  /** Phase und Stärke des Head-Bobs – das ViewModel schwingt synchron mit. */
  get headBob(): { phase: number; amount: number } {
    return { phase: this.bobPhase, amount: this.bobAmount };
  }

  // ---------------------------------------------------------------------------
  // 1. Eingabe (pro Frame)
  // ---------------------------------------------------------------------------

  /** @param active false bei offenem Inventar/Menü: keine Bewegungseingaben übernehmen. */
  handleInput(active = true): void {
    if (!active) {
      this.moveInput.set(0, 0);
      this.wantsCrouch = this.wantsSprint = this.wantsUp = false;
      this.input.consumeMouseDelta();
      return;
    }
    const { dx, dy } = this.input.consumeMouseDelta();
    const sens = this.cfg.mouseSensitivity;
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch - dy * sens, -MAX_PITCH, MAX_PITCH);

    const inp = this.input;
    this.moveInput.set(
      (inp.isDown('right') ? 1 : 0) - (inp.isDown('left') ? 1 : 0),
      (inp.isDown('forward') ? 1 : 0) - (inp.isDown('backward') ? 1 : 0),
    );
    if (this.moveInput.lengthSq() > 1) this.moveInput.normalize();

    this.wantsCrouch = inp.isDown('crouch');
    this.wantsSprint = inp.isDown('sprint');
    this.wantsUp = inp.isDown('jump');
    if (inp.wasPressed('jump')) this.jumpBufferTimer = this.cfg.jumpBuffer;
  }

  // ---------------------------------------------------------------------------
  // 2. Bewegung (fester Physik-Takt)
  // ---------------------------------------------------------------------------

  fixedUpdate(dt: number): void {
    if (this.stats.isDead) {
      this.velocity.set(0, 0, 0);
      return;
    }

    const cfg = this.cfg;
    const water = this.heightMap.waterLevel;
    const feetY = this.currFeet.y;

    // Wasser: Hysterese verhindert Flackern zwischen Laufen und Schwimmen.
    this.submersion = water - feetY;
    const wasSwimming = this.swimming;
    if (this.swimming) this.swimming = this.submersion > cfg.swimDepth - 0.2;
    else this.swimming = this.submersion > cfg.swimDepth;
    // Snap-to-Ground würde den sanften Auftrieb sofort wieder zum Grund ziehen.
    if (this.swimming && !wasSwimming) this.controller.disableSnapToGround();
    else if (!this.swimming && wasSwimming) this.controller.enableSnapToGround(0.4);

    this.updateCrouch();

    // --- Horizontale Wunschrichtung relativ zur Blickrichtung ---
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.wish
      .copy(this.forward)
      .multiplyScalar(this.moveInput.y)
      .addScaledVector(this.right, this.moveInput.x);

    const moving = this.wish.lengthSq() > 0.001;
    this.sprinting =
      moving && this.wantsSprint && this.moveInput.y > 0 && !this.crouching && this.stats.canSprint;

    let speed = cfg.walkSpeed;
    if (this.swimming) speed = cfg.swimSpeed * (this.sprinting ? 1.35 : 1);
    else if (this.crouching) speed = cfg.crouchSpeed;
    else if (this.sprinting) speed = cfg.sprintSpeed;
    if (this.moveInput.y < 0) speed *= 0.75; // rückwärts langsamer

    const accel = this.grounded || this.swimming ? cfg.groundAccel : cfg.airAccel;
    const targetX = this.wish.x * speed;
    const targetZ = this.wish.z * speed;
    const dvx = targetX - this.velocity.x;
    const dvz = targetZ - this.velocity.z;
    const dvLen = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dvLen <= maxDv) {
      this.velocity.x = targetX;
      this.velocity.z = targetZ;
    } else {
      this.velocity.x += (dvx / dvLen) * maxDv;
      this.velocity.z += (dvz / dvLen) * maxDv;
    }

    // --- Vertikal: Schwerkraft, Sprung, Auftrieb ---
    this.coyoteTimer = this.grounded ? cfg.coyoteTime : this.coyoteTimer - dt;
    this.jumpBufferTimer -= dt;

    if (this.swimming) {
      // Auftrieb hält den Kopf knapp über Wasser; Leertaste = hoch, Ducken = tauchen.
      const floatDepth = cfg.swimDepth + 0.2;
      let targetVy = (this.submersion - floatDepth) * 2.5;
      if (this.wantsUp) targetVy = 2.4;
      else if (this.wantsCrouch) targetVy = -2.4;
      this.velocity.y *= Math.exp(-2.5 * dt); // Wasserwiderstand (bremst Eintauchen nach Sprüngen)
      this.velocity.y = approach(this.velocity.y, targetVy, 9 * dt);
      this.coyoteTimer = 0;
    } else {
      this.velocity.y -= cfg.gravity * dt;
      if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0 && !this.crouching) {
        if (this.stats.useStamina(this.statsCfg.staminaJumpCost)) {
          this.velocity.y = cfg.jumpSpeed;
          this.coyoteTimer = 0;
          this.jumpBufferTimer = 0;
        }
      }
    }
    this.velocity.y = Math.max(this.velocity.y, -55); // Endgeschwindigkeit

    // --- Kollisionsauflösung über den Character Controller ---
    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.controller.computeColliderMovement(
      this.collider,
      desired,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      this.filterGroups,
    );
    const mv = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();

    // Weltgrenze: nicht aus dem generierten Bereich hinausschwimmen.
    const limit = this.heightMap.half - 4;
    const nx = this.currFeet.x + mv.x;
    const nz = this.currFeet.z + mv.z;
    if (Math.abs(nx) > limit) mv.x = 0;
    if (Math.abs(nz) > limit) mv.z = 0;

    // Landung → Fallschaden & Kamera-Einfedern
    if (!wasGrounded && this.grounded && !this.swimming) {
      const impact = -this.velocity.y;
      if (impact > cfg.fallDamageSpeed) {
        this.stats.damage((impact - cfg.fallDamageSpeed) * cfg.fallDamagePerMs, 'fall');
      }
      this.landDipVel -= Math.min(impact * 0.12, 1.4);
    }

    if (!this.swimming) {
      // Decke getroffen → Aufwärtsbewegung stoppen.
      if (desired.y > 0.001 && mv.y < desired.y * 0.3) this.velocity.y = 0;
      if (this.grounded && this.velocity.y < 0) this.velocity.y = -1; // leicht an den Boden drücken
    }

    // Tatsächlich erreichte Horizontalgeschwindigkeit übernehmen (kein Aufstauen an Wänden).
    if (dt > 0) {
      this.velocity.x = mv.x / dt;
      this.velocity.z = mv.z / dt;
    }

    this.body.setNextKinematicTranslation({
      x: this.currFeet.x + mv.x,
      y: this.currFeet.y + mv.y,
      z: this.currFeet.z + mv.z,
    });

    // --- Überlebenswerte ---
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.stats.update(dt, {
      sprinting: this.sprinting && horizontalSpeed > 1,
      swimming: this.swimming && horizontalSpeed > 0.5,
    });
    this.updateOxygen(dt);
  }

  // ---------------------------------------------------------------------------
  // 3. Nach dem Physik-Schritt
  // ---------------------------------------------------------------------------

  afterPhysicsStep(): void {
    this.prevFeet.copy(this.currFeet);
    const t = this.body.translation();
    this.currFeet.set(t.x, t.y, t.z);
  }

  /** Aus der Welt gefallen (sollte nie passieren, aber sicher ist sicher). */
  get isOutOfWorld(): boolean {
    return this.currFeet.y < this.heightMap.minHeight - 30;
  }

  // ---------------------------------------------------------------------------
  // 4. Kamera (pro Frame, interpoliert)
  // ---------------------------------------------------------------------------

  updateCamera(dt: number, alpha: number): void {
    const cfg = this.cfg;
    this.position.lerpVectors(this.prevFeet, this.currFeet, alpha);

    // Augenhöhe weich an Ducken/Stehen anpassen.
    this.eyeHeight = damp(this.eyeHeight, this.height - cfg.eyeFromTop, 12, dt);

    // Head-Bob abhängig von der Laufgeschwindigkeit.
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    const bobTarget = this.grounded && hs > 0.5 ? Math.min(hs / cfg.sprintSpeed, 1) : 0;
    this.bobAmount = damp(this.bobAmount, bobTarget, 8, dt);
    if (this.bobAmount > 0.001) this.bobPhase += dt * (4 + hs * 1.1);
    const swimBob = this.swimming ? Math.sin(performance.now() * 0.0018) * 0.05 : 0;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.06 * this.bobAmount - 0.03 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.035 * this.bobAmount;

    // Landungs-Einfedern als gedämpfte Feder.
    this.landDipVel += (-this.landDip * 90 - this.landDipVel * 14) * dt;
    this.landDip += this.landDipVel * dt;

    this.camera.position.set(
      this.position.x + this.right.x * bobX,
      this.position.y + this.eyeHeight + bobY + swimBob + this.landDip,
      this.position.z + this.right.z * bobX,
    );
    this.camera.rotation.set(this.pitch, this.yaw, -bobX * 0.15, 'YXZ');

    // Sprint-FOV
    const targetFov = this.sprinting && hs > 2 ? cfg.sprintFov : cfg.fov;
    const fov = damp(this.fovCurrent, targetFov, 6, dt);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.fovCurrent = fov;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------------------
  // Interna
  // ---------------------------------------------------------------------------

  private halfHeightFor(height: number): number {
    return Math.max(0.01, (height - 2 * this.cfg.radius) / 2);
  }

  private setHeight(height: number): void {
    this.height = height;
    this.collider.setHalfHeight(this.halfHeightFor(height));
    this.collider.setTranslationWrtParent({ x: 0, y: height / 2, z: 0 });
  }

  /** Ducken/Aufstehen; Aufstehen nur, wenn über dem Kopf genug Platz ist. */
  private updateCrouch(): void {
    const crouch = this.wantsCrouch && !this.swimming;
    if (crouch && !this.crouching) {
      this.crouching = true;
      this.setHeight(this.cfg.crouchHeight);
    } else if (!crouch && this.crouching && this.hasHeadroom()) {
      this.crouching = false;
      this.setHeight(this.cfg.standHeight);
    }
  }

  private hasHeadroom(): boolean {
    const r = this.cfg.radius * 0.9;
    const headCenter = {
      x: this.currFeet.x,
      y: this.currFeet.y + this.cfg.standHeight - this.cfg.radius,
      z: this.currFeet.z,
    };
    let blocked = false;
    this.physics.world.intersectionsWithShape(
      headCenter,
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Ball(r),
      () => {
        blocked = true;
        return false; // erste Überschneidung reicht
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      this.filterGroups,
      this.collider,
    );
    return !blocked;
  }

  private updateOxygen(dt: number): void {
    const eyeY = this.currFeet.y + this.height - this.cfg.eyeFromTop;
    if (eyeY < this.heightMap.waterLevel - 0.05) {
      this.oxygen = Math.max(0, this.oxygen - 9 * dt);
      if (this.oxygen <= 0) this.stats.damage(8 * dt, 'drowning', false);
    } else {
      this.oxygen = Math.min(MAX_OXYGEN, this.oxygen + 30 * dt);
    }
  }
}
