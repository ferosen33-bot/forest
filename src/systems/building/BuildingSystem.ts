import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../../core/Physics';
import type { EventBus } from '../../core/EventBus';
import type { HeightMap } from '../../world/HeightMap';
import type { WorldItems } from '../../entities/items/WorldItems';
import { FireEffect } from '../../entities/FireEffect';
import type { Crafting } from '../Crafting';
import type { Particles } from '../Particles';
import type { LightPool, LightRequest } from '../LightPool';
import type { Audio } from '../Audio';
import { getStructure, WALL_HALF_WIDTH, type StructureDef, type StructureId } from './StructureDefs';

/** Ein platziertes Bauwerk. */
export interface Structure {
  readonly id: number;
  readonly def: StructureDef;
  readonly object: THREE.Group;
  readonly body: RAPIER.RigidBody;
  readonly position: THREE.Vector3;
  readonly rotation: number;
  health: number;
  /** Nur Lagerfeuer. */
  lit: boolean;
  fire?: FireEffect;
  light?: LightRequest;
  emberTimer: number;
  crackleTimer: number;
  shake: number;
}

export interface Placement {
  valid: boolean;
  /** Grund, warum nicht gebaut werden kann (für das HUD). */
  reason?: string;
  position: THREE.Vector3;
  rotation: number;
  /** Ist an eine bestehende Wand eingerastet. */
  snapped: boolean;
}

/** Maximale Bau-Reichweite (horizontal, m). */
const BUILD_REACH = 7;
const ROTATE_STEP = THREE.MathUtils.degToRad(15);
const SNAP_DISTANCE = 1.3;
/** Radius, in dem ein Lagerfeuer wärmt (m). */
export const FIRE_WARMTH_RADIUS = 4.5;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Bausystem: Vorschau ("Ghost") vor dem Spieler, Platzierungsprüfung, Einrasten von Wänden,
 * Bauen, Abreißen sowie das Laufzeitverhalten von Bauwerken (Lagerfeuer).
 *
 * Material wird erst beim tatsächlichen Platzieren verbraucht.
 */
export class BuildingSystem {
  readonly group = new THREE.Group();
  readonly structures: Structure[] = [];

  /** Aktiver Bauplan im Baumodus (null = kein Baumodus). */
  active: StructureDef | null = null;
  placement: Placement | null = null;

  /** Erst nach Loslassen der Maustaste "scharf" – der Klick, der den Bauplan wählt, baut nicht sofort. */
  armed = false;
  private ghost: THREE.Group | null = null;
  private readonly ghostMaterial = new THREE.MeshBasicMaterial({
    color: 0x7dd87d,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  private userRotation = 0;
  private nextId = 1;
  private readonly byCollider = new Map<number, Structure>();

  private readonly tmp = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();

  constructor(
    private readonly physics: Physics,
    private readonly heightMap: HeightMap,
    private readonly crafting: Crafting,
    private readonly worldItems: WorldItems,
    private readonly particles: Particles,
    private readonly embers: Particles,
    private readonly lights: LightPool,
    private readonly audio: Audio,
    private readonly events: EventBus,
  ) {
    this.group.name = 'Structures';
  }

  // ---------------------------------------------------------------------------
  // Baumodus
  // ---------------------------------------------------------------------------

  get isActive(): boolean {
    return this.active !== null;
  }

  begin(id: StructureId): void {
    this.cancel();
    this.armed = false;
    this.active = getStructure(id);
    this.ghost = this.active.build();
    this.ghost.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = this.ghostMaterial;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = 5;
      }
    });
    this.group.add(this.ghost);
  }

  cancel(): void {
    if (this.ghost) this.group.remove(this.ghost);
    this.ghost = null;
    this.active = null;
    this.placement = null;
  }

  rotate(steps: number): void {
    this.userRotation += steps * ROTATE_STEP;
  }

  /**
   * Pro Frame im Baumodus: Zielpunkt bestimmen, prüfen, Ghost aktualisieren.
   * @param playerYaw Blickrichtung – das Bauwerk zeigt standardmäßig mit der Vorderseite zum Spieler.
   */
  updateGhost(origin: THREE.Vector3, dir: THREE.Vector3, playerYaw: number, exclude: RAPIER.Collider): void {
    const def = this.active;
    if (!def || !this.ghost) return;

    // Zielpunkt: Treffer des Blickstrahls, auf den Boden projiziert; Blick in den Himmel → 4 m vor dem Spieler.
    const hit = this.physics.raycast(origin, dir, BUILD_REACH + 2, exclude);
    const point = new THREE.Vector3();
    if (hit) point.set(hit.point.x, 0, hit.point.z);
    else point.set(origin.x + dir.x * 4, 0, origin.z + dir.z * 4);

    // Abstand zum Spieler begrenzen: nicht weiter als die Reichweite, nicht unter die eigenen Füße.
    const dx = point.x - origin.x;
    const dz = point.z - origin.z;
    const horizontal = Math.hypot(dx, dz);
    const minDist = Math.max(def.halfExtents.x, def.halfExtents.z) + 0.9;
    const clamped = THREE.MathUtils.clamp(horizontal, minDist, BUILD_REACH);
    if (horizontal > 0.001) {
      point.x = origin.x + (dx / horizontal) * clamped;
      point.z = origin.z + (dz / horizontal) * clamped;
    } else {
      point.x = origin.x - Math.sin(playerYaw) * minDist;
      point.z = origin.z - Math.cos(playerYaw) * minDist;
    }
    point.y = this.heightMap.heightAt(point.x, point.z);

    const placement = this.evaluate(def, point, playerYaw + this.userRotation);
    if (placement.valid && !this.crafting.canAfford(def.cost)) {
      placement.valid = false;
      placement.reason = 'Material fehlt';
    }
    this.placement = placement;

    this.ghost.position.copy(placement.position);
    this.ghost.rotation.set(0, placement.rotation, 0);
    this.ghostMaterial.color.set(placement.valid ? 0x7dd87d : 0xe0584f);
  }

  /** Versucht, am aktuellen Ghost zu bauen. */
  confirm(): Structure | null {
    const def = this.active;
    const p = this.placement;
    if (!def || !p) return null;
    if (!p.valid) {
      this.audio.play('denied');
      this.events.emit('hud:message', { text: p.reason ?? 'Hier kann nicht gebaut werden.' });
      return null;
    }
    if (!this.crafting.consume(def.cost)) return null;
    const structure = this.place(def.id, p.position, p.rotation);
    this.audio.play('place');
    this.particles.burst(p.position.clone().add(new THREE.Vector3(0, 0.2, 0)), {
      count: 14,
      color: 0x6b5a45,
      speed: 2.5,
      spread: 1.4,
      size: 0.05,
    });
    this.events.emit('hud:message', { text: `${def.name} gebaut.` });
    // Für Wände bleibt der Baumodus aktiv, solange Material für ein weiteres Stück reicht.
    if (!this.crafting.canAfford(def.cost)) this.cancel();
    return structure;
  }

  /**
   * Prüft, ob `def` an `point` (Bodenpunkt) mit Rotation `rotation` gebaut werden kann.
   * Bei Wänden wird ggf. an benachbarte Wandenden eingerastet.
   */
  evaluate(def: StructureDef, point: THREE.Vector3, rotation: number): Placement {
    const position = point.clone();
    let snapped = false;
    if (def.snap === 'wall') snapped = this.snapWall(position, rotation);

    // Bodenhöhen unter der Grundfläche (Ecken + Mitte).
    const he = def.halfExtents;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    let min = Infinity;
    let max = -Infinity;
    for (const [lx, lz] of [
      [0, 0],
      [-he.x, -he.z],
      [he.x, -he.z],
      [-he.x, he.z],
      [he.x, he.z],
    ]) {
      const h = this.heightMap.heightAt(position.x + lx * cos + lz * sin, position.z - lx * sin + lz * cos);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    // Wände/Unterstand reichen in den Boden (tiefster Punkt), kleine Objekte sitzen auf dem Mittel.
    position.y = def.snap === 'wall' || def.id === 'shelter' ? min : (min + max) / 2 - 0.02;

    const result: Placement = { valid: true, position, rotation, snapped };
    if (max - min > def.maxStep) return { ...result, valid: false, reason: 'Untergrund zu steil' };
    if (min < this.heightMap.waterLevel + 0.15) return { ...result, valid: false, reason: 'Nicht im Wasser' };
    if (!this.heightMap.isInside(position.x, position.z)) return { ...result, valid: false, reason: 'Außerhalb der Insel' };

    const blocker = this.findBlocker(def, position, rotation, snapped);
    if (blocker === 'player') return { ...result, valid: false, reason: 'Du stehst im Weg' };
    if (blocker) return { ...result, valid: false, reason: 'Kein Platz' };
    return result;
  }

  /** Rastet die Wand an das nächste freie Wandende in Reichweite ein (verschiebt `position`). */
  private snapWall(position: THREE.Vector3, rotation: number): boolean {
    const ownEnds = [-1, 1].map((sign) =>
      new THREE.Vector3(sign * WALL_HALF_WIDTH, 0, 0).applyAxisAngle(UP, rotation),
    );
    let best: THREE.Vector3 | null = null;
    let bestDist = SNAP_DISTANCE;
    for (const s of this.structures) {
      if (s.def.snap !== 'wall' || s.position.distanceTo(position) > 4) continue;
      for (const sign of [-1, 1]) {
        const end = new THREE.Vector3(sign * WALL_HALF_WIDTH, 0, 0).applyAxisAngle(UP, s.rotation).add(s.position);
        for (const own of ownEnds) {
          const dx = position.x + own.x - end.x;
          const dz = position.z + own.z - end.z;
          const d = Math.hypot(dx, dz);
          if (d < bestDist) {
            bestDist = d;
            best = new THREE.Vector3(end.x - own.x, 0, end.z - own.z);
          }
        }
      }
    }
    if (!best) return false;
    position.x = best.x;
    position.z = best.z;
    return true;
  }

  /** Überschneidung mit Bäumen, Felsen, Bauwerken oder dem Spieler (Terrain und lose Items zählen nicht). */
  private findBlocker(def: StructureDef, position: THREE.Vector3, rotation: number, snapped: boolean): 'player' | 'object' | null {
    const he = def.halfExtents;
    // Leicht verkleinert und angehoben: Bodenwellen und angrenzende (eingerastete) Wände stören nicht.
    const shape = new RAPIER.Cuboid(he.x * 0.9 - (snapped ? 0.12 : 0), he.y * 0.8, he.z * 0.9);
    this.tmpQuat.setFromAxisAngle(UP, rotation);
    let result: 'player' | 'object' | null = null;
    this.physics.world.intersectionsWithShape(
      { x: position.x, y: position.y + he.y + 0.15, z: position.z },
      { x: this.tmpQuat.x, y: this.tmpQuat.y, z: this.tmpQuat.z, w: this.tmpQuat.w },
      shape,
      (collider) => {
        const membership = collider.collisionGroups() >>> 16;
        result = membership & CollisionGroup.PLAYER ? 'player' : 'object';
        // false beendet die Abfrage: bei einem Objekt sofort, beim Spieler weitersuchen.
        return result !== 'object';
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      interactionGroups(CollisionGroup.STATIC, CollisionGroup.STATIC | CollisionGroup.PLAYER),
    );
    return result;
  }

  // ---------------------------------------------------------------------------
  // Bauwerke
  // ---------------------------------------------------------------------------

  /** Erzeugt ein Bauwerk (ohne Prüfung und ohne Materialverbrauch). */
  place(id: StructureId, position: THREE.Vector3, rotation: number): Structure {
    const def = getStructure(id);
    const object = def.build();
    object.position.copy(position);
    object.rotation.y = rotation;
    this.group.add(object);

    const q = this.tmpQuat.setFromAxisAngle(UP, rotation);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    const structure: Structure = {
      id: this.nextId++,
      def,
      object,
      body,
      position: position.clone(),
      rotation,
      health: def.maxHealth,
      lit: false,
      emberTimer: 0,
      crackleTimer: 0,
      shake: 0,
    };
    for (const desc of def.colliders()) {
      const collider = this.physics.world.createCollider(
        desc.setCollisionGroups(interactionGroups(CollisionGroup.STATIC)).setFriction(0.8),
        body,
      );
      this.byCollider.set(collider.handle, structure);
    }

    if (def.interaction === 'fire') {
      structure.fire = new FireEffect(0.6);
      structure.fire.object.position.set(0, 0.04, 0);
      object.add(structure.fire.object);
      structure.light = {
        position: position.clone().add(new THREE.Vector3(0, 0.7, 0)),
        color: new THREE.Color(0xff8a3a),
        intensity: 0,
        distance: 26,
      };
      this.setLit(structure, true);
    }

    this.structures.push(structure);
    this.events.emit('structure:placed', { id });
    return structure;
  }

  getByCollider(collider: RAPIER.Collider): Structure | undefined {
    return this.byCollider.get(collider.handle);
  }

  setLit(s: Structure, lit: boolean): void {
    if (!s.fire) return;
    s.lit = lit;
    s.fire.visible = lit;
    if (lit) this.audio.play('ignite');
  }

  /** `E` auf ein Bauwerk: Feuer an/aus. (Schlafen übernimmt das Spiel selbst.) */
  toggleFire(s: Structure): void {
    this.setLit(s, !s.lit);
    if (!s.lit) this.particles.burst(s.position.clone().add(new THREE.Vector3(0, 0.3, 0)), { count: 10, color: 0x444040, speed: 1.2, size: 0.06, gravity: -1, life: 1.4 });
  }

  /** Schaden durch Werkzeuge; bei 0 wird das Bauwerk abgerissen und gibt die Hälfte des Materials zurück. */
  damage(s: Structure, amount: number, point: THREE.Vector3, normal: THREE.Vector3): void {
    s.health -= amount;
    s.shake = 0.3;
    this.audio.play('chop');
    this.particles.burst(point, { count: 8, color: 0xa88158, direction: normal, speed: 3, size: 0.03 });
    this.events.emit('tool:hit', { target: 'other' });
    if (s.health <= 0) this.demolish(s);
  }

  demolish(s: Structure): void {
    const index = this.structures.indexOf(s);
    if (index < 0) return;
    this.structures.splice(index, 1);
    for (let i = 0; i < s.body.numColliders(); i++) this.byCollider.delete(s.body.collider(i).handle);
    this.physics.world.removeRigidBody(s.body);
    this.group.remove(s.object);

    // Hälfte des Materials (mindestens 1 je Sorte) fällt als Items heraus.
    for (const c of s.def.cost) {
      const count = Math.max(1, Math.floor(c.count / 2));
      for (let i = 0; i < count; i++) {
        const pos = s.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6 + i * 0.25, (Math.random() - 0.5) * 1.2));
        this.worldItems.spawn(c.item, 1, pos, {
          rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, Math.random() * 6, 0)),
        });
      }
    }
    this.particles.burst(s.position.clone().add(new THREE.Vector3(0, 0.8, 0)), { count: 24, color: 0x6b5a45, speed: 3.5, spread: 1.4, size: 0.06 });
    this.audio.play('treeCrack');
    this.events.emit('hud:message', { text: `${s.def.name} abgerissen.` });
  }

  /** Steht `pos` in der Wärme eines brennenden Lagerfeuers? */
  isNearLitFire(pos: THREE.Vector3, radius = FIRE_WARMTH_RADIUS): boolean {
    return this.structures.some((s) => s.lit && s.position.distanceTo(pos) < radius);
  }

  update(dt: number, viewer: THREE.Vector3): void {
    for (const s of this.structures) {
      // Treffer-Wackeln
      if (s.shake > 0) {
        s.shake = Math.max(0, s.shake - dt);
        const k = s.shake / 0.3;
        s.object.position.set(
          s.position.x + Math.sin(s.shake * 90) * 0.03 * k,
          s.position.y,
          s.position.z + Math.cos(s.shake * 80) * 0.03 * k,
        );
      }

      if (!s.fire || !s.lit || !s.light) continue;
      const dist = s.position.distanceTo(viewer);
      if (dist > 120) continue; // weit weg: keine Effekte berechnen

      s.fire.update(dt);
      s.light.intensity = 38 * s.fire.flicker;
      this.lights.request(s.light);

      // Glut steigt auf
      s.emberTimer -= dt;
      if (s.emberTimer <= 0 && dist < 60) {
        s.emberTimer = 0.08 + Math.random() * 0.12;
        this.tmp.copy(s.position).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4));
        this.embers.burst(this.tmp, { count: 1, color: 0xff7a2a, speed: 0.6, spread: 0.6, size: 0.025, life: 1.6, gravity: -0.6 });
      }
      // Knistern, leiser mit der Entfernung
      s.crackleTimer -= dt;
      if (s.crackleTimer <= 0 && dist < 14) {
        s.crackleTimer = 0.08 + Math.random() * 0.5;
        this.audio.play('crackle', (1 - dist / 14) * 0.8);
      }
    }
  }
}
