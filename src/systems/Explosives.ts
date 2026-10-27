import * as THREE from 'three';
import { FireEffect } from '../entities/FireEffect';
import { createItemMesh } from '../entities/items/ItemMeshes';
import type { Enemy } from '../entities/enemies/Enemy';
import type { Limb } from '../entities/enemies/Gore';
import type { EventBus } from '../core/EventBus';
import type { HeightMap } from '../world/HeightMap';
import type { EnemyDirector } from './ai/EnemyDirector';
import type { AnimalDirector } from './AnimalDirector';
import type { Audio } from './Audio';
import type { BuildingSystem } from './building/BuildingSystem';
import type { Gore } from './Gore';
import type { LightPool, LightRequest } from './LightPool';
import type { Particles } from './Particles';

export interface ExplosiveDeps {
  enemies: EnemyDirector;
  animals: AnimalDirector;
  building: BuildingSystem;
  heightMap: HeightMap;
  particles: Particles;
  embers: Particles;
  lights: LightPool;
  audio: Audio;
  events: EventBus;
  gore: Gore;
  player: { readonly position: THREE.Vector3; hurt(amount: number, from: THREE.Vector3): void; addShake(amount: number): void };
  /** Brennendes Öl am Boden (Brandherd). */
  ignite?: (point: THREE.Vector3, scale: number) => void;
}

/** Zünder (s), Wirkradius (m), Schaden in der Mitte. */
export const FUSE = 2;
export const BLAST_RADIUS = 5.5;
export const BLAST_DAMAGE = 170;
const PLAYER_RADIUS = 6;
const PLAYER_DAMAGE = 70;

interface Bomb {
  mesh: THREE.Object3D;
  at: THREE.Vector3;
  time: number;
  beep: number;
  light: LightRequest;
}

interface Blast {
  fire: FireEffect;
  at: THREE.Vector3;
  time: number;
  light: LightRequest;
}

/** Was eine Explosion abreißt, wenn sie tötet bzw. jemanden aus nächster Nähe erwischt. */
const BLAST_LIMBS: Limb[] = ['armL', 'armR', 'legL', 'legR', 'head'];

/**
 * Rohrbomben: Nach dem Wurf liegt die Bombe am Boden, piept immer schneller und lockt Schrate an –
 * dann geht sie hoch. Die Druckwelle verletzt (zur Mitte hin stärker), wirft um, reißt Glieder ab und
 * beschädigt Bauwerke; wer zu nah steht, erwischt es selbst. Das Öl im Rohr brennt danach noch.
 */
export class Explosives {
  readonly group = new THREE.Group();
  private readonly bombs: Bomb[] = [];
  private readonly blasts: Blast[] = [];

  constructor(private readonly d: ExplosiveDeps) {
    this.group.name = 'Explosives';
  }

  /** Eine geworfene Rohrbombe ist gelandet: Zünder läuft. */
  arm(point: THREE.Vector3): void {
    const ground = this.d.heightMap.heightAt(point.x, point.z);
    const at = point.clone();
    if (at.y < ground + 0.05 && at.y > ground - 2) at.y = ground + 0.05;
    const mesh = createItemMesh('pipeBomb');
    mesh.position.copy(at);
    mesh.rotation.set(Math.PI / 2, Math.random() * Math.PI, 0);
    this.group.add(mesh);
    this.bombs.push({ mesh, at, time: FUSE, beep: 0, light: { position: at.clone().setY(at.y + 0.2), color: new THREE.Color(0xff2a1a), intensity: 0, distance: 4 } });
  }

  update(dt: number): void {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.time -= dt;
      b.beep -= dt;
      // Piepen wird schneller; der Lärm lockt Schrate heran.
      if (b.beep <= 0) {
        b.beep = 0.12 + 0.38 * (b.time / FUSE);
        this.d.audio.play('beep', { position: b.at });
        this.d.events.emit('noise', { position: b.at, radius: 22 });
        b.light.intensity = 6;
      }
      b.light.intensity *= Math.exp(-14 * dt);
      this.d.lights.request(b.light);
      if (b.time <= 0) {
        this.group.remove(b.mesh);
        this.bombs.splice(i, 1);
        this.explode(b.at);
      }
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const x = this.blasts[i];
      x.time += dt;
      const u = x.time / 0.9;
      if (u >= 1) {
        this.group.remove(x.fire.object);
        this.blasts.splice(i, 1);
        continue;
      }
      // Feuerball: schlagartig groß, dann sinkt er in sich zusammen.
      const size = 4.2 * Math.sin(Math.min(1, u * 4) * Math.PI * 0.5) * (1 - u * u);
      x.fire.object.scale.setScalar(Math.max(0.01, size));
      x.fire.update(dt);
      x.light.intensity = 180 * (1 - u) * (1 - u);
      this.d.lights.request(x.light);
    }
  }

  /** Detonation an `at`. */
  explode(at: THREE.Vector3): void {
    const d = this.d;
    const center = at.clone().setY(at.y + 0.4);
    const consider = (e: Enemy) => {
      if (e.isDead || !e.active) return;
      const dist = e.feet.distanceTo(at);
      if (dist > BLAST_RADIUS) return;
      const f = 1 - dist / BLAST_RADIUS;
      d.enemies.hurt(e, BLAST_DAMAGE * f * f, center);
      // Die Druckwelle reißt Glieder ab – bei Toten sicher, bei Lebenden aus nächster Nähe.
      if (e.isDead || f > 0.65) {
        const limb = BLAST_LIMBS[Math.floor(Math.random() * (e.isDead ? 5 : 4))];
        if (Math.random() < (e.isDead ? 0.85 : 0.5)) d.gore.sever(e, limb, 'high', center);
        if (e.isDead && Math.random() < 0.4) d.gore.sever(e, BLAST_LIMBS[Math.floor(Math.random() * 4)], 'low', center);
      }
      if (!e.isDead) e.knockdown(1.2 + 1.5 * f, center, 6 + 8 * f);
    };
    for (const e of d.enemies.enemies) consider(e);
    for (const e of d.enemies.caveDwellers) consider(e);
    for (const a of d.animals.animals) {
      if (a.isDead) continue;
      const dist = a.feet.distanceTo(at);
      if (dist < BLAST_RADIUS) d.animals.damage(a, BLAST_DAMAGE * (1 - dist / BLAST_RADIUS), center, a.feet.clone(), new THREE.Vector3(0, 1, 0));
    }
    for (const s of d.building.structures) {
      const dist = s.position.distanceTo(at);
      if (dist < BLAST_RADIUS) d.building.damage(s, 60 * (1 - dist / BLAST_RADIUS), s.position.clone(), new THREE.Vector3(0, 1, 0), false);
    }
    const toPlayer = d.player.position.distanceTo(at);
    if (toPlayer < PLAYER_RADIUS) d.player.hurt(PLAYER_DAMAGE * (1 - toPlayer / PLAYER_RADIUS), center);
    if (toPlayer < 40) d.player.addShake(Math.min(1, 1.4 - toPlayer / 30));

    // Feuerball, Funken, Erde, Rauch, Lichtblitz – und ein Knall, den die halbe Insel hört.
    const fire = new FireEffect(1, { smoke: true, sparks: true, heat: false });
    fire.object.position.copy(at);
    this.group.add(fire.object);
    this.blasts.push({ fire, at: at.clone(), time: 0, light: { position: center.clone().setY(center.y + 0.8), color: new THREE.Color(0xffa050), intensity: 180, distance: 40 } });
    d.embers.burst(center, { count: 60, color: 0xffa040, speed: 9, gravity: 6, life: 0.9, size: 0.03, spread: 1.5 });
    d.particles.burst(center, { count: 30, color: 0x4a3a28, speed: 7, gravity: 14, life: 1.4, size: 0.06, spread: 1.4 });
    d.particles.burst(center, { count: 12, color: 0x2a2826, speed: 1.6, gravity: -0.6, life: 2.4, size: 0.18 });
    d.audio.play('explosion', { position: center });
    d.events.emit('noise', { position: at.clone(), radius: 110 });
    d.ignite?.(at, 0.6);
  }

  clear(): void {
    for (const b of this.bombs) this.group.remove(b.mesh);
    for (const x of this.blasts) this.group.remove(x.fire.object);
    this.bombs.length = 0;
    this.blasts.length = 0;
  }

  /** Scharfe Bomben (für Tests). */
  get armed(): number {
    return this.bombs.length;
  }
}
