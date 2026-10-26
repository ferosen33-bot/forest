import * as THREE from 'three';
import { FireEffect } from '../entities/FireEffect';
import type { EventBus } from '../core/EventBus';
import type { HeightMap } from '../world/HeightMap';
import type { Audio } from './Audio';
import type { LightPool, LightRequest } from './LightPool';
import type { Particles } from './Particles';
import type { BuildingSystem, Structure } from './building/BuildingSystem';

/**
 * Verteidigung des Lagers: Fallgruben, Klapperleinen und brennendes Lampenöl aus Brandflaschen.
 *
 * - **Fallgrube:** Wer auf die Tarnung tritt, stürzt auf die Pfähle (schwerer Schaden) und steckt
 *   einige Sekunden fest. Danach liegt die Grube offen, bis man sie neu tarnt.
 * - **Klapperleine:** Quert ein Schrat oder Wolf die Schnur, rasselt sie – der Spieler bekommt eine
 *   Warnung, auch wenn er gerade woanders ist.
 * - **Brandherd:** Eine zerschellte Brandflasche setzt den Boden für einige Sekunden in Flammen. Wer
 *   darin steht, verbrennt; Schrate und Wölfe meiden das Feuer (außer rasende Horden).
 *
 * Die Bewohner (Schrate, Tiere) werden über schmale Schnittstellen angebunden, damit sich die Logik
 * ohne Spielwelt testen lässt.
 */

/** Etwas, das in Fallen tappen und brennen kann. */
export interface Intruder {
  readonly feet: THREE.Vector3;
  readonly isDead: boolean;
  /** Schaden durch Falle oder Feuer. */
  hurt(amount: number, from: THREE.Vector3): void;
  /** Fallgrube: festhängen (nur Schrate). */
  stun?(seconds: number): void;
  /** Für die Klapperleine: Schrat oder Wolf? */
  readonly kind: 'schrat' | 'wolf';
}

export interface DefenseDeps {
  building: BuildingSystem;
  heightMap: HeightMap;
  lights: LightPool;
  audio: Audio;
  particles: Particles;
  events: EventBus;
  /** Alle Schrate und Wölfe in der Nähe des Spielers. */
  intruders: () => Iterable<Intruder>;
  player: {
    readonly position: THREE.Vector3;
    hurt(amount: number, from: THREE.Vector3): void;
  };
}

/** Schaden einer Fallgrube. */
export const PIT_DAMAGE = 75;
const PIT_STUN = 4;
/** Ein Brandherd: Radius (m), Brenndauer (s), Schaden je Sekunde. */
export const FIRE_RADIUS = 2.6;
export const FIRE_TIME = 12;
export const FIRE_DPS = 16;
const PLAYER_FIRE_DPS = 9;
const RATTLE_COOLDOWN = 8;

interface FireZone {
  readonly center: THREE.Vector3;
  time: number;
  readonly flames: FireEffect[];
  readonly light: LightRequest;
  tick: number;
  readonly radius: number;
  readonly duration: number;
}

export class Defenses {
  readonly group = new THREE.Group();
  readonly zones: FireZone[] = [];
  private readonly rattleTimers = new WeakMap<Structure, number>();
  private readonly local = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  /** Regen (0..1) löscht Brände schneller. */
  rain = 0;

  constructor(private readonly d: DefenseDeps) {
    this.group.name = 'Defenses';
  }

  /**
   * Brandflasche zerschellt: Brandherd am Boden unter `point`.
   * `scale` < 1 ergibt einen kleineren, kürzeren Brand (Brandpfeile).
   */
  ignite(point: THREE.Vector3, scale = 1): void {
    const ground = this.d.heightMap.heightAt(point.x, point.z);
    // Unter Tage (Höhlen schweben hoch über der Insel) brennt es dort, wo die Flasche zerschellt.
    const underground = point.y > ground + 6;
    // Im Wasser erlischt das Öl sofort.
    if (!underground && ground < this.d.heightMap.waterLevel - 0.1) {
      this.d.audio.play('sizzle', { position: point });
      return;
    }
    const center = new THREE.Vector3(point.x, underground ? point.y : Math.max(ground, Math.min(point.y, ground + 3)), point.z);
    const flames: FireEffect[] = [];
    const radius = FIRE_RADIUS * scale;
    const duration = FIRE_TIME * (0.4 + 0.6 * scale);
    const count = Math.max(2, Math.round(6 * scale));
    for (let i = 0; i < count; i++) {
      // Rauch nur aus dem Hauptherd, Funken aus jedem zweiten – sonst wird es zu viel.
      const size = (i === 0 ? 1.1 : 0.5 + Math.random() * 0.4) * (0.6 + 0.4 * scale);
      const f = new FireEffect(size, { smoke: i === 0, sparks: i % 2 === 0, heat: i === 0 });
      const a = (i / count) * Math.PI * 2 + Math.random();
      const r = i === 0 ? 0 : radius * (0.35 + Math.random() * 0.45);
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      const y = underground ? center.y : Math.max(this.d.heightMap.heightAt(x, z), center.y - 0.5);
      f.object.position.set(x, y + 0.02, z);
      this.group.add(f.object);
      flames.push(f);
    }
    this.zones.push({
      center,
      time: duration,
      flames,
      light: { position: center.clone().setY(center.y + 1), color: new THREE.Color(0xff7a2a), intensity: 0, distance: 20 * (0.5 + 0.5 * scale) },
      tick: 0,
      radius,
      duration,
    });
    this.d.audio.play('fireWhoosh', { position: center, volume: 0.5 + 0.5 * scale });
    this.d.events.emit('noise', { position: center, radius: 25 * scale });
  }

  /** Nächster Brandherd, der `pos` im Umkreis `radius` erreicht (für die Feuerscheu von Schraten und Wölfen). */
  fireNear(pos: THREE.Vector3, radius: number): THREE.Vector3 | null {
    for (const z of this.zones) if (z.center.distanceTo(pos) < radius + z.radius) return z.center;
    return null;
  }

  update(dt: number): void {
    this.updateTraps();
    this.updateFires(dt);
  }

  private updateTraps(): void {
    const structures = this.d.building.structures;
    const pits = structures.filter((s) => s.def.interaction === 'pit' && s.armed);
    const rattles = structures.filter((s) => s.def.rattle);
    if (pits.length === 0 && rattles.length === 0) return;
    for (const who of this.d.intruders()) {
      if (who.isDead) continue;
      for (const s of pits) {
        if (!s.armed) continue;
        const l = this.toLocal(s, who.feet);
        const h = s.def.halfExtents;
        if (Math.abs(l.x) < h.x * 0.85 && Math.abs(l.z) < h.z * 0.85 && Math.abs(l.y) < 1.2) this.springPit(s, who);
      }
      for (const s of rattles) {
        if ((this.rattleTimers.get(s) ?? 0) > performance.now()) continue;
        const l = this.toLocal(s, who.feet);
        if (Math.abs(l.x) < s.def.rattle! && Math.abs(l.z) < 0.35 && Math.abs(l.y) < 1.5) this.rattle(s, who);
      }
    }
  }

  /** Lage eines Punkts im Raum des Bauwerks (Drehung um die Hochachse). */
  private toLocal(s: Structure, p: THREE.Vector3): THREE.Vector3 {
    const dx = p.x - s.position.x;
    const dz = p.z - s.position.z;
    const c = Math.cos(-s.rotation);
    const n = Math.sin(-s.rotation);
    return this.local.set(dx * c + dz * n, p.y - s.position.y, -dx * n + dz * c);
  }

  private springPit(s: Structure, who: Intruder): void {
    this.d.building.setArmed(s, false);
    this.d.audio.play('pitFall', { position: s.position });
    this.d.particles.burst(this.tmp.copy(s.position).setY(s.position.y + 0.2), { count: 14, color: 0x3a2e1e, speed: 2, size: 0.04 });
    who.stun?.(PIT_STUN);
    who.hurt(PIT_DAMAGE, s.position);
    if (s.position.distanceTo(this.d.player.position) < 90) {
      this.d.events.emit('hud:message', { text: who.kind === 'wolf' ? 'Ein Wolf ist in die Fallgrube gestürzt.' : 'Ein Schrat ist in die Fallgrube gestürzt!' });
    }
  }

  private rattle(s: Structure, who: Intruder): void {
    this.rattleTimers.set(s, performance.now() + RATTLE_COOLDOWN * 1000);
    this.d.audio.play('rattle', { position: s.position.clone().setY(s.position.y + 0.4) });
    const dist = s.position.distanceTo(this.d.player.position);
    if (dist < 200) {
      const where = dist < 15 ? 'direkt neben dir' : `${Math.round(dist)} m entfernt`;
      this.d.events.emit('hud:message', { text: `Die Klapperleine rasselt (${where})${who.kind === 'wolf' ? ' – Wölfe!' : '!'}` });
    }
  }

  private updateFires(dt: number): void {
    const player = this.d.player;
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.time -= dt * (1 + 2 * this.rain);
      const strength = Math.min(1, z.time / 2.5) * Math.min(1, (z.duration - z.time) / 0.25 + 0.2);
      for (const f of z.flames) {
        f.update(dt);
        f.object.scale.setScalar(Math.max(0.01, strength));
      }
      z.light.intensity = 30 * (z.radius / FIRE_RADIUS) * strength * (z.flames[0]?.flicker ?? 1);
      this.d.lights.request(z.light);
      // Schaden in halben Sekunden.
      z.tick -= dt;
      if (z.tick <= 0) {
        z.tick = 0.5;
        for (const who of this.d.intruders()) {
          if (!who.isDead && this.inFire(z, who.feet)) who.hurt(FIRE_DPS * 0.5 * strength, z.center);
        }
        if (this.inFire(z, player.position)) player.hurt(PLAYER_FIRE_DPS * 0.5 * strength, z.center);
      }
      if (z.time <= 0) {
        for (const f of z.flames) this.group.remove(f.object);
        this.zones.splice(i, 1);
      }
    }
  }

  private inFire(z: FireZone, p: THREE.Vector3): boolean {
    return Math.hypot(p.x - z.center.x, p.z - z.center.z) < z.radius && Math.abs(p.y - z.center.y) < 2;
  }
}
