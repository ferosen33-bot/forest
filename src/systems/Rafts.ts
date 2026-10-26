import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { Player, PlayerCarrier } from '../entities/Player';
import type { HeightMap } from '../world/HeightMap';
import type { BuildingSystem, Structure } from './building/BuildingSystem';
import type { Audio } from './Audio';
import type { Particles } from './Particles';
import type { Prompt } from './InteractionSystem';

/** Paddelgeschwindigkeit (m/s): normal und mit Kraft (Shift, kostet Ausdauer). */
export const RAFT_SPEED = 3.8;
export const RAFT_SPRINT_SPEED = 5.6;
const RAFT_ACCEL = 1.6;
const RAFT_TURN = 0.75;
/** Deckhöhe über dem Ursprung des Floßes. */
const DECK = 0.24;
/** Unter diesem Wasserstand (Grund näher als das) läuft das Floß auf. */
const DRAFT = 0.35;
const UP = new THREE.Vector3(0, 1, 0);

export interface RaftDeps {
  building: BuildingSystem;
  player: Player;
  heightMap: HeightMap;
  audio: Audio;
  events: EventBus;
  particles: Particles;
}

/**
 * Flöße: Bauwerke, die sich bewegen. `E` besteigt ein Floß – dann trägt es den Spieler (W/S paddeln,
 * A/D lenken, Shift kräftiger paddeln), `E` steigt wieder ab, am liebsten aufs nächste Ufer.
 * Position und Richtung stehen im Bauwerk selbst und werden so mit dem Spielstand gesichert.
 */
export class Rafts implements PlayerCarrier {
  riding: Structure | null = null;
  private speed = 0;
  private stroke = 0;
  private aground = false;
  private time = 0;
  private readonly feet = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(private readonly d: RaftDeps) {
    // Tod oder Neustart an Land: nicht mehr an Bord.
    d.events.on('player:respawned', () => {
      this.riding = null;
      d.player.carrier = null;
    });
  }

  prompt(s: Structure): Prompt {
    return { key: 'E', action: 'Floß besteigen', label: s.def.name };
  }

  /** Hinweis während der Fahrt (ersetzt das anvisierte Ziel). */
  get ridePrompt(): Prompt | null {
    if (!this.riding) return null;
    const action = this.landNear() ? 'An Land gehen' : this.shallow() ? 'Absteigen (flaches Wasser)' : 'Ins Wasser springen';
    return { key: 'E', action, label: this.aground ? 'Floß · auf Grund' : 'Floß' };
  }

  board(s: Structure): void {
    if (this.riding || this.d.player.stats.isDead) return;
    this.riding = s;
    this.speed = 0;
    this.aground = false;
    this.d.player.carrier = this;
    this.d.player.spawn(this.deck(s, this.feet), this.d.player.yaw);
    this.d.audio.play('stepWater', { volume: 0.8, position: s.position });
    this.d.events.emit('hud:message', { text: 'W/S paddeln, A/D lenken, Shift paddelt kräftiger. E steigt ab.' });
  }

  /** Absteigen: aufs nächste Ufer, sonst neben dem Floß ins Wasser. */
  dismount(): void {
    const s = this.riding;
    if (!s) return;
    this.riding = null;
    this.speed = 0;
    const player = this.d.player;
    player.carrier = null;
    const land = this.landNear();
    if (land) player.spawn(land, player.yaw);
    else {
      const hm = this.d.heightMap;
      const side = this.tmp.set(Math.cos(s.rotation), 0, -Math.sin(s.rotation)).multiplyScalar(2.2).add(s.position);
      side.y = Math.max(hm.heightAt(side.x, side.z) + 0.02, hm.waterLevel - 1.1);
      player.spawn(side, player.yaw);
    }
    this.d.audio.play('stepWater', { volume: 0.9, position: s.position });
  }

  /** Unter dem Floß kann man stehen. */
  private shallow(): boolean {
    const s = this.riding;
    return !!s && this.d.heightMap.waterLevel - this.d.heightMap.heightAt(s.position.x, s.position.z) < 1.2;
  }

  /** Nächstes Stück Ufer in Reichweite (Fußposition) oder null. */
  private landNear(): THREE.Vector3 | null {
    const s = this.riding;
    if (!s) return null;
    const hm = this.d.heightMap;
    let best: THREE.Vector3 | null = null;
    let bestH = -Infinity;
    for (const r of [2.2, 3.2, 4.4]) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = s.position.x + Math.cos(a) * r;
        const z = s.position.z + Math.sin(a) * r;
        const h = hm.heightAt(x, z);
        if (h > hm.waterLevel + 0.05 && h > bestH && h < s.position.y + 2.5) {
          bestH = h;
          best = new THREE.Vector3(x, h, z);
        }
      }
      if (best) return best;
    }
    return null;
  }

  private deck(s: Structure, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(s.position).setY(s.object.position.y + DECK);
  }

  /** Vom Spieler pro Physikschritt aufgerufen: bewegt das Floß und liefert die neue Fußposition. */
  carry(dt: number, input: THREE.Vector2, sprint: boolean): THREE.Vector3 {
    const s = this.riding!;
    const hm = this.d.heightMap;
    const player = this.d.player;
    const strong = sprint && input.y > 0 && player.stats.useStamina(7 * dt);
    const target = input.y * (input.y > 0 ? (strong ? RAFT_SPRINT_SPEED : RAFT_SPEED) : RAFT_SPEED * 0.45);
    this.speed = THREE.MathUtils.damp(this.speed, target, RAFT_ACCEL, dt);
    // Lenken geht auch im Stand, in Fahrt aber besser.
    const turn = -input.x * RAFT_TURN * (0.45 + 0.55 * Math.min(1, Math.abs(this.speed) / 2)) * dt;
    const rotation = s.rotation + turn;
    (s as { rotation: number }).rotation = rotation;
    player.yaw += turn;

    // Bug bzw. Heck voraus: läuft dort Grund auf, bleibt das Floß stehen.
    const fx = -Math.sin(rotation);
    const fz = -Math.cos(rotation);
    const dir = Math.sign(this.speed) || 1;
    const nx = s.position.x + fx * this.speed * dt;
    const nz = s.position.z + fz * this.speed * dt;
    const probe = hm.heightAt(nx + fx * dir * 1.5, nz + fz * dir * 1.5);
    const limit = hm.half - 12;
    const blocked = probe > hm.waterLevel - DRAFT || Math.abs(nx) > limit || Math.abs(nz) > limit;
    if (blocked) {
      if (!this.aground && Math.abs(this.speed) > 0.6) this.d.audio.play('chop', { volume: 0.5, position: s.position });
      this.speed = 0;
    } else s.position.set(nx, s.position.y, nz);
    this.aground = blocked;

    // Paddelschläge: Plätschern und eine kleine Bugwelle.
    if (Math.abs(input.y) > 0.1) {
      this.stroke -= dt;
      if (this.stroke <= 0) {
        this.stroke = strong ? 0.6 : 0.85;
        const side = this.tmp.set(Math.cos(rotation), 0, -Math.sin(rotation)).multiplyScalar(Math.random() < 0.5 ? 1.1 : -1.1);
        side.add(s.position).setY(hm.waterLevel + 0.05);
        this.d.audio.play('stepWater', { volume: strong ? 0.75 : 0.5, position: side });
        this.d.particles.burst(side, { count: 5, color: 0xcfdadc, speed: 1.4, spread: 0.6, size: 0.03, life: 0.6 });
      }
    }
    this.place(s);
    player.velocity.set(0, 0, 0);
    return this.deck(s, this.feet);
  }

  /** Schwanken auf den Wellen; Modell und Collider folgen der Position. */
  update(dt: number): void {
    this.time += dt;
    for (const s of this.d.building.structures) if (s.def.interaction === 'raft') this.place(s);
    // Floß abgerissen, während man darauf steht.
    if (this.riding && !this.d.building.structures.includes(this.riding)) {
      this.riding = null;
      this.d.player.carrier = null;
    }
  }

  private place(s: Structure): void {
    const water = this.d.heightMap.waterLevel;
    const phase = this.time * 1.3 + s.id * 1.7;
    const y = water - (s.def.inWater?.sink ?? 0.1) + Math.sin(phase) * 0.035;
    s.position.y = y;
    s.object.position.set(s.position.x, y, s.position.z);
    this.euler.set(Math.sin(phase * 0.8) * 0.02, s.rotation, Math.cos(phase * 0.6) * 0.025);
    s.object.quaternion.setFromEuler(this.euler);
    s.body.setTranslation({ x: s.position.x, y, z: s.position.z }, true);
    this.quat.setFromAxisAngle(UP, s.rotation);
    s.body.setRotation({ x: this.quat.x, y: this.quat.y, z: this.quat.z, w: this.quat.w }, true);
  }
}
