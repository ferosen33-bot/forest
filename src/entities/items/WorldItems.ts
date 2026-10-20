import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../../core/Physics';
import type { ItemId } from './ItemDefs';
import { createItemCollider, createItemMesh } from './ItemMeshes';

/** Ein physikalisches Item, das in der Welt liegt (fallengelassen oder gedroppt). */
export interface WorldItem {
  readonly id: number;
  readonly itemId: ItemId;
  count: number;
  readonly mesh: THREE.Object3D;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
}

export interface SpawnOptions {
  rotation?: THREE.Quaternion;
  velocity?: THREE.Vector3;
  angularVelocity?: THREE.Vector3;
}

/** Obergrenze für gleichzeitig liegende Items; die ältesten verschwinden zuerst. */
const MAX_ITEMS = 250;

/**
 * Verwaltet alle losen Items: Three.js-Mesh + dynamischer Rapier-Rigidbody.
 * Items kollidieren mit Terrain, statischen Objekten und untereinander, nicht aber mit dem Spieler.
 */
export class WorldItems {
  readonly group = new THREE.Group();
  private readonly items = new Map<number, WorldItem>();
  private readonly byCollider = new Map<number, WorldItem>();
  private nextId = 1;

  constructor(private readonly physics: Physics) {
    this.group.name = 'WorldItems';
  }

  get size(): number {
    return this.items.size;
  }

  spawn(itemId: ItemId, count: number, position: THREE.Vector3, opts: SpawnOptions = {}): WorldItem {
    const world = this.physics.world;
    const rot = opts.rotation ?? new THREE.Quaternion();

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
      .setLinearDamping(0.15)
      .setAngularDamping(0.6)
      .setCcdEnabled(true); // kleine, schnelle Objekte sollen nicht durchs Terrain tunneln
    if (opts.velocity) bodyDesc.setLinvel(opts.velocity.x, opts.velocity.y, opts.velocity.z);
    if (opts.angularVelocity) bodyDesc.setAngvel(opts.angularVelocity);
    const body = world.createRigidBody(bodyDesc);

    const collider = world.createCollider(
      createItemCollider(itemId)
        .setFriction(0.9)
        .setRestitution(0.1)
        .setCollisionGroups(
          interactionGroups(CollisionGroup.ITEM, CollisionGroup.TERRAIN | CollisionGroup.STATIC | CollisionGroup.ITEM),
        ),
      body,
    );

    const mesh = createItemMesh(itemId);
    mesh.position.copy(position);
    mesh.quaternion.copy(rot);
    this.group.add(mesh);

    const item: WorldItem = { id: this.nextId++, itemId, count, mesh, body, collider };
    this.items.set(item.id, item);
    this.byCollider.set(collider.handle, item);

    if (this.items.size > MAX_ITEMS) {
      const oldest = this.items.values().next().value;
      if (oldest) this.remove(oldest);
    }
    return item;
  }

  /** Alle aktuell in der Welt liegenden Items. */
  all(): IterableIterator<WorldItem> {
    return this.items.values();
  }

  getByCollider(collider: RAPIER.Collider): WorldItem | undefined {
    return this.byCollider.get(collider.handle);
  }

  remove(item: WorldItem): void {
    if (!this.items.delete(item.id)) return;
    this.byCollider.delete(item.collider.handle);
    this.physics.world.removeRigidBody(item.body);
    this.group.remove(item.mesh);
  }

  /**
   * Fester Physik-Takt: Holz schwimmt. Untergetauchte Holz-Items bekommen Auftrieb
   * proportional zur Eintauchtiefe und werden im Wasser gebremst.
   */
  fixedUpdate(dt: number, waterLevel: number): void {
    for (const item of this.items.values()) {
      if (item.itemId !== 'log' && item.itemId !== 'stick') continue;
      const t = item.body.translation();
      const depth = waterLevel - t.y;
      if (depth <= -0.3) continue;
      const submerged = Math.min(1, (depth + 0.3) / 0.5);
      const mass = item.body.mass();
      item.body.applyImpulse({ x: 0, y: mass * 9.81 * 1.6 * submerged * dt, z: 0 }, true);
      const v = item.body.linvel();
      const drag = Math.exp(-1.8 * submerged * dt);
      item.body.setLinvel({ x: v.x * drag, y: v.y * drag, z: v.z * drag }, true);
    }
  }

  /** Überträgt Position/Rotation der Rigidbodies auf die Meshes (schlafende Körper werden übersprungen). */
  update(): void {
    for (const item of this.items.values()) {
      if (item.body.isSleeping()) continue;
      const t = item.body.translation();
      const r = item.body.rotation();
      item.mesh.position.set(t.x, t.y, t.z);
      item.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      // Ins Meer gefallene Items gehen unter und verschwinden.
      if (t.y < -30) this.remove(item);
    }
  }
}
