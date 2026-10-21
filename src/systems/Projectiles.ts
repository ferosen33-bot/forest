import * as THREE from 'three';
import type { Physics, RAPIER } from '../core/Physics';
import type { EventBus } from '../core/EventBus';
import type { ItemId } from '../entities/items/ItemDefs';
import { createItemMesh } from '../entities/items/ItemMeshes';
import type { WorldItems } from '../entities/items/WorldItems';
import type { EnemyDirector } from './ai/EnemyDirector';
import type { AnimalDirector } from './AnimalDirector';
import type { BuildingSystem } from './building/BuildingSystem';
import type { Audio } from './Audio';
import type { Particles } from './Particles';

interface Projectile {
  itemId: ItemId;
  durability: number | undefined;
  damage: number;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly prev: THREE.Vector3;
  mesh: THREE.Object3D;
  age: number;
}

export interface ProjectileDeps {
  physics: Physics;
  worldItems: WorldItems;
  enemies: EnemyDirector;
  animals: AnimalDirector;
  building: BuildingSystem;
  audio: Audio;
  particles: Particles;
  events: EventBus;
  /** Collider des Werfers (wird vom Strahl ignoriert). */
  thrower: () => RAPIER.Collider;
  waterLevel: number;
}

/** Etwas weniger als echte Schwerkraft: Würfe sollen sich gut anfühlen, nicht realistisch abfallen. */
const GRAVITY = 9.81 * 0.6;
const UP = new THREE.Vector3(0, 1, 0);
/** Abnutzung des Speers pro Treffer. */
const WEAR_PER_HIT = 2;

/**
 * Wurfgeschosse (Speer): fliegen ballistisch und richten sich nach ihrer Flugbahn aus.
 * Treffer werden pro Physik-Takt mit einem Strahl über das zurückgelegte Segment geprüft –
 * so gehen auch schnelle Würfe nicht durch dünne Ziele hindurch. Danach wird der Speer
 * wieder ein normales, aufhebbares Item (im Boden/Baum steckend oder vom Ziel abprallend).
 */
export class Projectiles {
  readonly group = new THREE.Group();
  private readonly active: Projectile[] = [];
  private readonly dir = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();

  constructor(private readonly d: ProjectileDeps) {
    this.group.name = 'Projectiles';
  }

  get count(): number {
    return this.active.length;
  }

  launch(itemId: ItemId, durability: number | undefined, damage: number, origin: THREE.Vector3, velocity: THREE.Vector3): void {
    const mesh = createItemMesh(itemId);
    mesh.position.copy(origin);
    this.group.add(mesh);
    this.active.push({
      itemId,
      durability,
      damage,
      position: origin.clone(),
      prev: origin.clone(),
      velocity: velocity.clone(),
      mesh,
      age: 0,
    });
    this.d.audio.play('throw');
  }

  fixedUpdate(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.age += dt;
      p.prev.copy(p.position);
      // Im Wasser stark gebremst
      const drag = p.position.y < this.d.waterLevel ? Math.exp(-4 * dt) : Math.exp(-0.05 * dt);
      p.velocity.multiplyScalar(drag);
      p.velocity.y -= GRAVITY * dt;
      const step = p.velocity.length() * dt;
      this.dir.copy(p.velocity).normalize();
      // Die Spitze sitzt ~0,8 m vor dem Mittelpunkt: Strahl von dort aus prüfen.
      if (this.trace(p, step) || p.age > 6) {
        this.active.splice(i, 1);
        this.group.remove(p.mesh);
        if (p.age > 6) this.drop(p, false);
      } else {
        p.position.addScaledVector(p.velocity, dt);
      }
    }
  }

  /** @returns true, wenn das Geschoss getroffen hat (und damit beendet ist). */
  private trace(p: Projectile, step: number): boolean {
    const tip = this.point.copy(p.position).addScaledVector(this.dir, 0.75);
    const origin = { x: tip.x, y: tip.y, z: tip.z };
    let remaining = step;
    // Sensoren von Pflanzen/Stöcken überspringen, Kopf-Sensoren der Schrate aber treffen.
    for (let guard = 0; guard < 4 && remaining > 0; guard++) {
      const hit = this.d.physics.raycast(origin, this.dir, remaining, this.d.thrower());
      if (!hit) return false;
      const point = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
      this.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
      const c = hit.collider;
      const enemy = this.d.enemies.getHitTarget(c);
      if (enemy) {
        this.d.enemies.damage(enemy.enemy, p.damage, enemy.zone, p.prev, point, this.normal);
        this.bounce(p, point);
        return true;
      }
      const animal = this.d.animals.getByCollider(c);
      if (animal && !animal.isDead) {
        this.d.animals.damage(animal, p.damage, p.prev, point, this.normal);
        this.bounce(p, point);
        return true;
      }
      if (c.isSensor() || this.d.worldItems.getByCollider(c)) {
        // Weiter hinter dem Sensor/Item suchen.
        const advance = hit.distance + 0.05;
        origin.x += this.dir.x * advance;
        origin.y += this.dir.y * advance;
        origin.z += this.dir.z * advance;
        remaining -= advance;
        continue;
      }
      // Boden, Baum, Fels oder Bauwerk: steckenbleiben.
      const structure = this.d.building.getByCollider(c);
      if (structure) this.d.building.damage(structure, 3, point, this.normal, true);
      this.d.audio.play(structure ? 'chop' : 'stoneHit', { volume: 0.6, position: point });
      this.d.particles.burst(point, { count: 5, color: 0x6b5a45, direction: this.normal, speed: 1.5, size: 0.025 });
      this.d.events.emit('noise', { position: point, radius: 12 });
      p.position.copy(point).addScaledVector(this.dir, -0.75 + 0.18);
      this.drop(p, true);
      return true;
    }
    return false;
  }

  /** Treffer an Lebewesen: Speer fällt herab, nutzt sich ab. */
  private bounce(p: Projectile, point: THREE.Vector3): void {
    p.position.copy(point).addScaledVector(this.dir, -0.8);
    p.velocity.multiplyScalar(-0.08).setY(1);
    this.drop(p, false);
  }

  private drop(p: Projectile, stuck: boolean): void {
    if (p.durability !== undefined) {
      p.durability -= WEAR_PER_HIT;
      if (p.durability <= 0) {
        this.d.audio.play('treeCrack', 0.6);
        this.d.events.emit('hud:message', { text: 'Der Speer ist zerbrochen.' });
        return;
      }
    }
    this.quat.setFromUnitVectors(UP, this.dir);
    this.d.worldItems.spawn(p.itemId, 1, p.position, {
      durability: p.durability,
      rotation: this.quat,
      velocity: stuck ? undefined : p.velocity,
      fixed: stuck,
    });
  }

  /** Darstellung: Mesh entlang der Flugbahn ausrichten (interpoliert). */
  update(alpha: number): void {
    for (const p of this.active) {
      p.mesh.position.lerpVectors(p.prev, p.position, alpha);
      this.dir.copy(p.velocity).normalize();
      p.mesh.quaternion.setFromUnitVectors(UP, this.dir);
    }
  }
}
