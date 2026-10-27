import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import type { Enemy } from '../entities/enemies/Enemy';
import { severChance, type GoreHit, type Limb } from '../entities/enemies/Gore';
import type { SeveredPart } from '../entities/characters/EnemyAvatars';
import type { EnemyDirector } from './ai/EnemyDirector';
import type { Audio } from './Audio';
import type { Blood } from './Blood';
import type { Particles } from './Particles';

export interface GoreDeps {
  physics: Physics;
  enemies: EnemyDirector;
  blood?: Pick<Blood, 'spray' | 'pool'>;
  particles: Particles;
  audio: Audio;
}

/** Abgetrenntes Stück mit eigenem Körper in der Physik. */
interface Piece {
  part: SeveredPart;
  body: RAPIER.RigidBody;
  /** Lage der Figur relativ zum Physikkörper. */
  offset: THREE.Matrix4;
  age: number;
  drip: number;
}

/** Blut schießt aus einem frischen Stumpf. */
interface Spurt {
  enemy: Enemy;
  limb: Limb;
  time: number;
  next: number;
}

const MAX_PIECES = 14;
/** Tödlicher Rumpftreffer: was dabei abgeht (Arme doppelt so oft wie der Kopf). */
const TORSO_KILL: Limb[] = ['head', 'armL', 'armR', 'armL', 'armR'];
const PIECE_LIFE = 50;
const SPURT_TIME = 3;
const DEBRIS_GROUPS = interactionGroups(CollisionGroup.DEBRIS, CollisionGroup.TERRAIN | CollisionGroup.STATIC | CollisionGroup.DEBRIS);

/**
 * Zerstückelung im Spiel:
 * - **Klingen** trennen Arme, Beine und Köpfe ab – an Ellbogen und Knie oder, je nach Trefferpunkt, an Schulter
 *   und Hüfte. Das Stück fliegt davon und bleibt liegen, aus dem Stumpf schießt Blut. Ohne Bein kriecht der
 *   Gegner weiter, ohne Arm schlägt er schwächer.
 * - **Wuchtwaffen** zertrümmern beim tödlichen Kopftreffer den Schädel.
 * - **Jeder Treffer** hinterlässt eine Wunde am Körper: Schnitte bei Klingen, Quetschungen bei Wucht.
 */
export class Gore {
  readonly group = new THREE.Group();
  /** Einstellungen: Blut & Zerstückelung. */
  enabled = true;
  private readonly pieces: Piece[] = [];
  private readonly spurts: Spurt[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(private readonly d: GoreDeps) {
    this.group.name = 'Gore';
  }

  /**
   * Nahkampftreffer (nach dem Schaden): Wunde, und mit etwas Glück geht etwas ab.
   * @param from Position des Angreifers (die Stücke fliegen von ihm weg).
   */
  onHit(enemy: Enemy, point: THREE.Vector3, from: THREE.Vector3, hit: Omit<GoreHit, 'fraction' | 'killed'> & { damage: number }): void {
    if (!this.enabled) return;
    const avatars = this.d.enemies.avatars;
    const killed = enemy.isDead;
    avatars?.wound(enemy.id, point, hit.cut, 0.055 + 0.035 * hit.heavy);
    let target = hit.headshot ? { limb: 'head' as Limb, level: 'low' as const } : avatars?.nearestLimb(enemy.id, point);
    // Ein tödlicher Hieb in den Rumpf kostet Kopf oder Arm, ein Lebender verliert nur, was getroffen wurde.
    if (!target && killed && avatars) {
      const options = TORSO_KILL.filter((l) => !enemy.severed.has(l));
      if (options.length) target = { limb: options[Math.floor(Math.random() * options.length)], level: 'high' };
    }
    if (!target || enemy.severed.has(target.limb)) return;
    // Ein Kopf geht nur beim tödlichen Treffer ab, Gliedmaßen auch Lebenden.
    const chance = severChance({ ...hit, fraction: hit.damage / enemy.maxHealth, killed }, target.limb);
    if (Math.random() >= chance) return;
    if (target.limb === 'head' && !hit.cut) this.crushHead(enemy);
    else this.sever(enemy, target.limb, target.level, from);
  }

  /** Bodenstampfer, Vorschlaghammer: der Schädel zerplatzt. */
  crushHead(enemy: Enemy): void {
    if (!this.enabled || enemy.severed.has('head')) return;
    const head = enemy.rig.headPosition(new THREE.Vector3());
    enemy.sever('head');
    const p = this.d.particles;
    p.burst(head, { count: 22, color: 0x5c0f10, speed: 4.5, size: 0.05, gravity: 12 });
    p.burst(head, { count: 10, color: 0xb0504a, speed: 3.5, size: 0.04, gravity: 12 });
    p.burst(head, { count: 7, color: 0xe6dcc6, speed: 3, size: 0.025, gravity: 12 });
    for (let i = 0; i < 3; i++) this.d.blood?.spray(head, this.dir.set(Math.random() - 0.5, 0.6, Math.random() - 0.5).normalize(), 1);
    this.d.blood?.pool(enemy.feet, 1.6);
    this.d.audio.play('crush', { position: head });
    this.spurts.push({ enemy, limb: 'head', time: SPURT_TIME * 0.6, next: 0 });
  }

  /** Trennt ein Glied ab; das Stück fliegt vom Angreifer weg. */
  sever(enemy: Enemy, limb: Limb, level: 'high' | 'low', from: THREE.Vector3): void {
    if (!enemy.sever(limb)) return;
    const part = this.d.enemies.avatars?.cut(enemy.id, limb, level) ?? null;
    const joint = part?.joint ?? enemy.rig.headPosition(new THREE.Vector3());
    this.d.audio.play('sever', { position: joint });
    const away = this.dir.subVectors(joint, from).setY(0).normalize();
    this.d.blood?.spray(joint, away, 1);
    this.d.particles.burst(joint, { count: 12, color: 0x5c0f10, speed: 3, size: 0.035, direction: away });
    this.spurts.push({ enemy, limb, time: SPURT_TIME, next: 0 });
    if (part) this.launch(part, away);
  }

  private launch(part: SeveredPart, away: THREE.Vector3): void {
    this.group.add(part.object);
    const center = part.joint.clone().add(part.end).multiplyScalar(0.5);
    const axis = part.end.clone().sub(part.joint);
    const length = axis.length();
    const rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
    const body = this.d.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setLinvel(away.x * (2.5 + Math.random() * 2), 2 + Math.random() * 2, away.z * (2.5 + Math.random() * 2))
        .setAngvel({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 12 })
        .setLinearDamping(0.2)
        .setAngularDamping(0.8)
        .setCcdEnabled(true),
    );
    this.d.physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(Math.max(0.02, length / 2 - part.radius), part.radius)
        .setDensity(1000)
        .setFriction(0.9)
        .setRestitution(0.12)
        .setCollisionGroups(DEBRIS_GROUPS),
      body,
    );
    const start = new THREE.Matrix4().compose(center, rot, new THREE.Vector3(1, 1, 1));
    const offset = start.invert().multiply(part.object.matrixWorld);
    this.pieces.push({ part, body, offset, age: 0, drip: 0 });
    if (this.pieces.length > MAX_PIECES) this.remove(0);
  }

  private remove(i: number): void {
    const p = this.pieces[i];
    this.d.physics.world.removeRigidBody(p.body);
    p.part.dispose();
    this.pieces.splice(i, 1);
  }

  update(dt: number): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.age += dt;
      if (p.age > PIECE_LIFE) {
        this.remove(i);
        continue;
      }
      const t = p.body.translation();
      const r = p.body.rotation();
      this.m.compose(this.v.set(t.x, t.y, t.z), this.q.set(r.x, r.y, r.z, r.w), this.s.set(1, 1, 1)).multiply(p.offset);
      this.m.decompose(p.part.object.position, p.part.object.quaternion, p.part.object.scale);
      // Im Flug tropft es aus dem Stück.
      p.drip -= dt;
      if (p.age < 1.5 && p.drip <= 0) {
        p.drip = 0.08;
        this.d.particles.burst(this.v, { count: 2, color: 0x5c0f10, speed: 0.6, size: 0.025 });
      }
      if (p.age > 0.4 && p.age - dt <= 0.4) this.d.blood?.pool(this.v, 0.5);
    }
    // Stümpfe spritzen im Takt des Herzschlags, immer schwächer.
    for (let i = this.spurts.length - 1; i >= 0; i--) {
      const s = this.spurts[i];
      s.time -= dt;
      s.next -= dt;
      if (s.time <= 0) {
        this.spurts.splice(i, 1);
        continue;
      }
      if (s.next > 0) continue;
      s.next = 0.32;
      const at = this.d.enemies.avatars?.jointPosition(s.enemy.id, s.limb, this.v) ?? null;
      if (!at) continue;
      const strength = s.time / SPURT_TIME;
      this.dir.set((Math.random() - 0.5) * 0.8, 0.7, (Math.random() - 0.5) * 0.8).normalize();
      this.d.blood?.spray(at, this.dir, 0.15 + 0.3 * strength);
    }
  }

  clear(): void {
    while (this.pieces.length) this.remove(0);
    this.spurts.length = 0;
  }
}
