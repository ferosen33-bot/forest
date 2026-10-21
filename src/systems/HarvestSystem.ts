import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import type { EventBus } from '../core/EventBus';
import type { Vegetation, VegetationInstance } from '../world/Vegetation';
import type { WorldItems } from '../entities/items/WorldItems';
import type { ToolStats } from '../entities/items/ItemDefs';
import { LOG_LENGTH } from '../entities/items/ItemMeshes';
import type { ItemService } from './ItemService';
import type { Particles } from './Particles';
import type { Audio } from './Audio';

/** Höhe, auf der der Stamm durchtrennt wird (Stumpfhöhe bei Skalierung 1). */
const CUT_HEIGHT = 0.45;
/** Ungefähre Gesamthöhe der Baummodelle bei Skalierung 1. */
const TREE_HEIGHT = { pine: 8.6, broadleaf: 8.2 } as const;
const TRUNK_LENGTH = { pine: 4.5, broadleaf: 4.6 } as const;

interface FallingTree {
  instance: VegetationInstance;
  kind: 'pine' | 'broadleaf';
  object: THREE.Group;
  body: RAPIER.RigidBody;
  age: number;
  /** Zeit seit dem Aufschlag am Boden (−1 = noch im Fallen). */
  landedFor: number;
}

/**
 * Ressourcenabbau: Bäume fällen und Steine von Felsen schlagen.
 *
 * Ein gefällter Baum wird zum dynamischen Rapier-Körper, der realistisch umkippt.
 * Sobald er liegt, zerfällt er in einzelne Holzstämme (physische Items) und Äste;
 * zurück bleibt ein begehbarer Baumstumpf.
 */
export class HarvestSystem {
  readonly group = new THREE.Group();
  private readonly treeHealth = new Map<number, number>();
  private readonly rockStones = new Map<number, number>();
  private readonly falling: FallingTree[] = [];

  private readonly stumpGeometry = new THREE.CylinderGeometry(0.27, 0.34, CUT_HEIGHT, 8);
  private readonly stumpMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.95, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0xb48c5a, roughness: 0.9, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.95 }),
  ];

  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly physics: Physics,
    private readonly vegetation: Vegetation,
    private readonly worldItems: WorldItems,
    private readonly items: ItemService,
    private readonly particles: Particles,
    private readonly audio: Audio,
    private readonly events: EventBus,
  ) {
    this.group.name = 'Harvest';
  }

  // ---------------------------------------------------------------------------
  // Bäume
  // ---------------------------------------------------------------------------

  /** Maximale Lebenspunkte eines Baums (größere Bäume halten mehr aus). */
  maxTreeHealth(tree: VegetationInstance): number {
    const s = tree.scale.y;
    return tree.kind === 'pine' ? 45 + 30 * s : 55 + 38 * s;
  }

  /** Verbleibender Anteil an Lebenspunkten in [0, 1] (für eine spätere Anzeige). */
  treeHealthRatio(tree: VegetationInstance): number {
    return (this.treeHealth.get(tree.id) ?? this.maxTreeHealth(tree)) / this.maxTreeHealth(tree);
  }

  /**
   * @param from Schlagrichtung (vom Spieler zum Baum, horizontal).
   * @returns true, wenn der Baum durch diesen Schlag gefällt wurde.
   */
  hitTree(tree: VegetationInstance, tool: ToolStats, point: THREE.Vector3, normal: THREE.Vector3, from: THREE.Vector3): boolean {
    if (!tree.alive || (tree.kind !== 'pine' && tree.kind !== 'broadleaf')) return false;

    const health = (this.treeHealth.get(tree.id) ?? this.maxTreeHealth(tree)) - tool.treeDamage;
    this.treeHealth.set(tree.id, health);

    this.audio.play('chop');
    this.particles.burst(point, { count: 12, color: 0xc49a62, direction: normal, speed: 3.5, size: 0.028 });
    this.particles.burst(point, { count: 4, color: 0x3d2a18, direction: normal, speed: 2.5, size: 0.04 });
    this.vegetation.shake(tree, from, 1);
    this.events.emit('tool:hit', { target: 'tree' });
    this.events.emit('noise', { position: point.clone(), radius: 30 });

    if (health > 0) return false;
    this.treeHealth.delete(tree.id);
    this.fell(tree, from);
    return true;
  }

  private fell(tree: VegetationInstance, from: THREE.Vector3): void {
    const kind = tree.kind as 'pine' | 'broadleaf';
    const s = tree.scale;
    const world = this.physics.world;

    // Statischen Baum entfernen, Stumpf an seine Stelle setzen.
    const matrix = this.vegetation.getMatrix(tree, this.tmpMatrix);
    matrix.decompose(this.tmpPos, this.tmpQuat, this.tmpScale);
    this.vegetation.remove(tree);
    this.createStump(tree);

    // Fallender Baum: Körperursprung auf Schnitthöhe, Mesh um diese Höhe nach unten versetzt.
    const cut = CUT_HEIGHT * s.y;
    const base = this.tmpPos.clone().add(new THREE.Vector3(0, cut, 0).applyQuaternion(this.tmpQuat));
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(base.x, base.y, base.z)
        .setRotation({ x: this.tmpQuat.x, y: this.tmpQuat.y, z: this.tmpQuat.z, w: this.tmpQuat.w })
        .setAngularDamping(0.4)
        .setLinearDamping(0.2),
    );

    // Nur mit dem Terrain kollidieren: Nachbarbäume würden den Stamm sonst verkeilen.
    const groups = interactionGroups(CollisionGroup.ITEM, CollisionGroup.TERRAIN);
    // Quader statt Zylinder/Kugel: runde Formen würden am Hang endlos weiterrollen.
    const height = TREE_HEIGHT[kind] * s.y - cut;
    const trunkHalf = height / 2;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.28 * s.x, trunkHalf, 0.28 * s.x)
        .setTranslation(0, trunkHalf, 0)
        .setDensity(600)
        .setFriction(1.4)
        .setCollisionGroups(groups),
      body,
    );
    // Krone als leichter Block, damit sie auf dem Boden aufliegt statt einzusinken.
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(1.1 * s.x, height * 0.22, 1.1 * s.x)
        .setTranslation(0, height * 0.62, 0)
        .setDensity(30)
        .setFriction(1.6)
        .setCollisionGroups(groups),
      body,
    );

    // Anschubsen: um die Achse ⟂ zur Schlagrichtung kippen (weg vom Spieler).
    const fallDir = from.clone().setY(0).normalize();
    const axis = new THREE.Vector3().crossVectors(this.up, fallDir).normalize();
    body.setAngvel({ x: axis.x * 0.7, y: 0, z: axis.z * 0.7 }, true);

    const { geometry, material } = this.vegetation.getRenderData(kind);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.copy(this.tmpScale);
    mesh.position.set(0, -cut, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const object = new THREE.Group();
    object.add(mesh);
    object.position.copy(base);
    object.quaternion.copy(this.tmpQuat);
    this.group.add(object);

    this.falling.push({ instance: tree, kind, object, body, age: 0, landedFor: -1 });
    this.audio.play('treeCrack');
    this.events.emit('tree:felled', { kind, position: tree.position.clone() });
  }

  private createStump(tree: VegetationInstance): void {
    const s = tree.scale;
    const stump = new THREE.Mesh(this.stumpGeometry, this.stumpMaterials);
    stump.scale.set(s.x, s.y, s.x);
    stump.position.copy(tree.position).add(new THREE.Vector3(0, (CUT_HEIGHT * s.y) / 2, 0));
    stump.rotation.y = tree.rotationY;
    stump.castShadow = true;
    stump.receiveShadow = true;
    this.group.add(stump);

    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cylinder((CUT_HEIGHT * s.y) / 2, 0.32 * s.x)
        .setTranslation(stump.position.x, stump.position.y, stump.position.z)
        .setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
    );
  }

  /** Zerlegt einen liegenden Baum in Holzstämme (+ Äste aus der Krone). */
  private splitIntoLogs(f: FallingTree): void {
    const t = f.body.translation();
    const r = f.body.rotation();
    const base = new THREE.Vector3(t.x, t.y, t.z);
    const rot = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const axis = this.up.clone().applyQuaternion(rot);
    const s = f.instance.scale.y;

    const trunk = TRUNK_LENGTH[f.kind] * s;
    const logs = Math.max(2, Math.min(4, Math.round(trunk / LOG_LENGTH)));
    for (let i = 0; i < logs; i++) {
      const pos = base.clone().addScaledVector(axis, LOG_LENGTH * (i + 0.5) + 0.05).add(new THREE.Vector3(0, 0.25, 0));
      this.worldItems.spawn('log', 1, pos, { rotation: rot });
    }

    const crown = base.clone().addScaledVector(axis, TREE_HEIGHT[f.kind] * s * 0.6).add(new THREE.Vector3(0, 0.6, 0));
    const sticks = 1 + Math.round(Math.random() * 2);
    for (let i = 0; i < sticks; i++) {
      const offset = new THREE.Vector3((Math.random() - 0.5) * 2, 0.2 * i, (Math.random() - 0.5) * 2);
      this.worldItems.spawn('stick', 1, crown.clone().add(offset), {
        rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, Math.random() * 6, 0)),
      });
    }
    this.particles.burst(crown, {
      count: 30,
      color: f.kind === 'pine' ? 0x2c4a2c : 0x4a6a2a,
      speed: 4,
      spread: 1.2,
      size: 0.09,
      life: 1.6,
      gravity: 3,
    });

    this.physics.world.removeRigidBody(f.body);
    this.group.remove(f.object);
  }

  // ---------------------------------------------------------------------------
  // Felsen
  // ---------------------------------------------------------------------------

  private stonesIn(rock: VegetationInstance): number {
    let stones = this.rockStones.get(rock.id);
    if (stones === undefined) {
      const size = (rock.scale.x + rock.scale.y + rock.scale.z) / 3;
      stones = Math.max(2, Math.min(8, Math.round(1 + size * 2.5)));
      this.rockStones.set(rock.id, stones);
    }
    return stones;
  }

  isRockDepleted(rock: VegetationInstance): boolean {
    return this.stonesIn(rock) <= 0;
  }

  /** Schlägt einen Stein vom Felsen ab (solange er nicht erschöpft ist). */
  hitRock(rock: VegetationInstance, tool: ToolStats, point: THREE.Vector3, normal: THREE.Vector3): number {
    this.audio.play('stoneHit');
    this.particles.burst(point, { count: 8, color: 0x8a877f, direction: normal, speed: 4, size: 0.035 });
    this.particles.burst(point, { count: 3, color: 0xffd27a, direction: normal, speed: 6, size: 0.015, life: 0.25 });
    this.events.emit('tool:hit', { target: 'rock' });
    this.events.emit('noise', { position: point.clone(), radius: 22 });

    const stones = this.stonesIn(rock);
    if (stones <= 0) {
      this.events.emit('hud:message', { text: 'Hier lässt sich nichts mehr abschlagen.' });
      return 0;
    }
    const yieldCount = Math.min(stones, tool.rockYield);
    this.rockStones.set(rock.id, stones - yieldCount);
    this.items.give('stone', yieldCount, point.clone().addScaledVector(normal, 0.4));
    return yieldCount;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.age += dt;
      const t = f.body.translation();
      const r = f.body.rotation();
      f.object.position.set(t.x, t.y, t.z);
      f.object.quaternion.set(r.x, r.y, r.z, r.w);

      // Neigung gegenüber der Senkrechten.
      const axisY = this.up.clone().applyQuaternion(f.object.quaternion).y;
      if (f.landedFor < 0 && axisY < 0.45) {
        f.landedFor = 0;
        // Aufschlag: stark dämpfen, damit der Stamm liegen bleibt statt sich zu überschlagen.
        f.body.setAngularDamping(4);
        f.body.setLinearDamping(1.5);
        this.audio.play('treeFall', { position: f.object.position });
        this.events.emit('noise', { position: f.object.position.clone(), radius: 45 });
        this.events.emit('tree:landed', { position: f.object.position.clone() });
      } else if (f.landedFor >= 0) {
        f.landedFor += dt;
      }
      // Zerlegen, sobald der Stamm zur Ruhe gekommen ist (spätestens 2,5 s nach dem Aufschlag).
      const w = f.body.angvel();
      const resting = f.landedFor > 0.6 && Math.hypot(w.x, w.y, w.z) < 0.2;
      if (resting || f.landedFor > 2.5 || f.age > 9) {
        this.splitIntoLogs(f);
        this.falling.splice(i, 1);
      }
    }
  }

  get fallingCount(): number {
    return this.falling.length;
  }
}
