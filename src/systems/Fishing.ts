import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { HeightMap } from '../world/HeightMap';
import { createItemMesh } from '../entities/items/ItemMeshes';
import type { BuildingSystem, Structure } from './building/BuildingSystem';
import type { ItemService } from './ItemService';
import type { Particles } from './Particles';
import type { Audio } from './Audio';
import type { Prompt } from './InteractionSystem';

/** Wurfweite (horizontal, m). */
export const CAST_MIN = 3;
export const CAST_MAX = 16;
/** Mindesttiefe am Schwimmer – im Uferschlamm beißt nichts. */
export const MIN_DEPTH = 0.3;
/** Weiter entfernt sich der Spieler nicht vom Schwimmer, sonst wird eingeholt. */
const MAX_LINE = 24;
const FLIGHT_TIME = 0.6;
/** So lange bleibt der Schwimmer beim Biss unter Wasser (Reaktionszeit). */
export const BITE_WINDOW = 1.1;
const REEL_TIME = 0.5;
/** Anteil der angeschlagenen Fische, die nicht vom Haken gehen. */
const HOOK_CHANCE = 0.9;

export type FishingState = 'idle' | 'casting' | 'waiting' | 'bite' | 'reeling';

export type CastResult = { ok: true; point: THREE.Vector3; depth: number } | { ok: false; reason: string };

/**
 * Wurfziel: Schnitt des Blickstrahls mit dem Wasserspiegel, auf die Wurfweite begrenzt.
 * Bei flachem Blick (oder nach oben) fliegt der Köder so weit wie möglich.
 */
export function castTarget(
  eye: THREE.Vector3,
  look: THREE.Vector3,
  waterLevel: number,
  groundAt: (x: number, z: number) => number,
): CastResult {
  const flat = Math.hypot(look.x, look.z);
  if (flat < 0.15) return { ok: false, reason: 'Nach vorne zielen, nicht senkrecht nach unten.' };
  let distance = CAST_MAX;
  if (look.y < -0.02) {
    const t = (waterLevel - eye.y) / look.y;
    if (t > 0) distance = THREE.MathUtils.clamp(t * flat, CAST_MIN, CAST_MAX);
  }
  const point = new THREE.Vector3(eye.x + (look.x / flat) * distance, waterLevel, eye.z + (look.z / flat) * distance);
  const depth = waterLevel - groundAt(point.x, point.z);
  if (depth < 0) return { ok: false, reason: 'Dort ist kein Wasser.' };
  if (depth < MIN_DEPTH) return { ok: false, reason: 'Das Wasser ist dort zu flach.' };
  return { ok: true, point, depth };
}

/**
 * Wartezeit bis zum Biss (s): tieferes Wasser und Regen (trübes Wasser, Insekten) beschleunigen es.
 */
export function biteDelay(depth: number, rain: number, rng: () => number = Math.random): number {
  const base = 5 + rng() * 10;
  const deep = 1.15 - Math.min(3, Math.max(0, depth)) * 0.12;
  return base * deep * (1 - 0.3 * THREE.MathUtils.clamp(rain, 0, 1));
}

export interface FishingFrame {
  dt: number;
  /** Angelrute in der Hand? */
  holding: boolean;
  /** Spieler hat die Kontrolle (keine Menüs, nicht im Baumodus). */
  active: boolean;
  /** Linksklick in diesem Frame. */
  click: boolean;
  eye: THREE.Vector3;
  look: THREE.Vector3;
  /** Spitze der Rute (Weltkoordinaten) oder null, solange sie nicht sichtbar ist. */
  tip: THREE.Vector3 | null;
  player: THREE.Vector3;
  swimming: boolean;
  rain: number;
}

export interface FishingDeps {
  heightMap: HeightMap;
  items: ItemService;
  particles: Particles;
  audio: Audio;
  events: EventBus;
  /** Wurf verbraucht Haltbarkeit der Rute. */
  wearRod: () => void;
  /** Animation der Rute im ViewModel. */
  playCast: (duration: number) => void;
  setRod: (out: boolean, pull: number) => void;
}

/**
 * Angeln: Linksklick wirft den Schwimmer ins Wasser. Nach einer zufälligen Wartezeit (mit
 * kleinen Fehl-Zupfern) taucht er unter – wer jetzt innerhalb gut einer Sekunde klickt,
 * holt einen Fisch heraus. Die Schnur hängt als durchhängende Linie zwischen Rutenspitze
 * und Schwimmer.
 */
export class Fishing {
  readonly group = new THREE.Group();
  state: FishingState = 'idle';
  prompt: Prompt | null = null;

  private timer = 0;
  private nibble = 0;
  private nibbleTimer = 0;
  private depth = 0;
  private hooked = false;
  private time = 0;
  private readonly bobber: THREE.Group;
  private readonly fish: THREE.Object3D;
  private readonly line: THREE.Line;
  private readonly linePositions: Float32Array;
  private readonly target = new THREE.Vector3();
  private readonly start = new THREE.Vector3();
  private readonly lastTip = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly d: FishingDeps) {
    this.group.name = 'Fishing';
    this.bobber = new THREE.Group();
    // Leuchtend rot (leicht selbstleuchtend), damit er auch auf 15 m und in der Dämmerung zu sehen ist.
    const red = new THREE.MeshStandardMaterial({ color: 0xd8362a, emissive: 0x5a0c06, roughness: 0.5 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.5 });
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), red);
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 4), red);
    stem.position.y = 0.1;
    this.bobber.add(top, bottom, stem);
    this.fish = createItemMesh('rawFish');
    this.fish.position.y = -0.26;
    this.fish.visible = false;
    this.bobber.add(this.fish);
    this.bobber.visible = false;
    this.group.add(this.bobber);

    const segments = 18;
    this.linePositions = new Float32Array((segments + 1) * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    this.line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xe8e4d8, transparent: true, opacity: 0.65 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.group.add(this.line);
  }

  /** Schnur draußen (für Haltung und HUD)? */
  get busy(): boolean {
    return this.state !== 'idle';
  }

  update(f: FishingFrame): void {
    this.time += f.dt;
    if (!f.holding || f.swimming) {
      this.reset();
      this.prompt = null;
      return;
    }
    if (f.tip) this.lastTip.copy(f.tip);
    const water = this.d.heightMap.waterLevel;

    switch (this.state) {
      case 'idle': {
        const cast = castTarget(f.eye, f.look, water, (x, z) => this.d.heightMap.heightAt(x, z));
        this.prompt = cast.ok ? { key: 'LMB', action: 'Auswerfen', label: 'Angelrute' } : null;
        if (f.active && f.click) {
          if (cast.ok) this.cast(cast.point, cast.depth, f);
          else {
            this.d.audio.play('denied');
            this.d.events.emit('hud:message', { text: cast.reason });
          }
        }
        break;
      }
      case 'casting': {
        this.timer += f.dt;
        const u = Math.min(1, this.timer / FLIGHT_TIME);
        const arc = 1.2 + this.start.distanceTo(this.target) * 0.08;
        this.bobber.position.lerpVectors(this.start, this.target, u);
        this.bobber.position.y += arc * 4 * u * (1 - u);
        if (u >= 1) {
          this.state = 'waiting';
          this.timer = biteDelay(this.depth, f.rain);
          this.nibbleTimer = 1.5 + Math.random() * 2;
          this.splash(0.6);
        }
        this.prompt = null;
        break;
      }
      case 'waiting': {
        this.timer -= f.dt;
        // Fehl-Zupfer: der Schwimmer zuckt kurz – noch nicht anschlagen!
        this.nibbleTimer -= f.dt;
        if (this.nibbleTimer <= 0) {
          this.nibbleTimer = 1.8 + Math.random() * 3;
          this.nibble = 1;
          this.ripple(3);
        }
        this.nibble = Math.max(0, this.nibble - f.dt * 4);
        this.floatBobber(water, -0.035 * this.nibble);
        if (this.timer <= 0) {
          this.state = 'bite';
          this.timer = BITE_WINDOW;
          this.splash(0.9);
        }
        if (f.active && f.click) this.reel(false);
        this.prompt = { key: 'LMB', action: 'Einholen', label: 'Warten, bis etwas beißt …' };
        break;
      }
      case 'bite': {
        this.timer -= f.dt;
        this.floatBobber(water, -0.09 + Math.sin(this.time * 30) * 0.015);
        if (Math.random() < f.dt * 8) this.ripple(2);
        if (f.active && f.click) {
          const hooked = Math.random() < HOOK_CHANCE;
          if (!hooked) this.d.events.emit('hud:message', { text: 'Der Fisch hat sich losgerissen.' });
          this.reel(hooked);
        } else if (this.timer <= 0) {
          // Zu spät: der Köder ist ab, aber der Schwimmer treibt weiter.
          this.state = 'waiting';
          this.timer = biteDelay(this.depth, f.rain) * 0.8;
          this.d.events.emit('hud:message', { text: 'Zu spät – der Fisch ist weg.' });
        }
        this.prompt = { key: 'LMB', action: 'Anschlagen!', label: 'Es beißt!' };
        break;
      }
      case 'reeling': {
        this.timer += f.dt;
        const u = Math.min(1, this.timer / REEL_TIME);
        this.bobber.position.lerpVectors(this.start, this.lastTip, u * u);
        this.bobber.position.y += Math.sin(u * Math.PI) * 0.8;
        if (this.hooked) this.fish.rotation.z = Math.sin(this.time * 24) * 0.5;
        if (u >= 1) this.finishReel(f.player);
        this.prompt = null;
        break;
      }
    }

    // Zu weit weggelaufen → Schnur einholen.
    if ((this.state === 'waiting' || this.state === 'bite') && this.tmp.copy(f.player).setY(water).distanceTo(this.bobber.position) > MAX_LINE) {
      this.d.events.emit('hud:message', { text: 'Die Schnur reicht nicht weiter – eingeholt.' });
      this.reel(false);
    }

    const out = this.state === 'waiting' || this.state === 'bite';
    this.d.setRod(out, this.state === 'bite' ? 1 : 0);
    this.updateLine(f.tip, water, out);
  }

  private cast(point: THREE.Vector3, depth: number, f: FishingFrame): void {
    this.state = 'casting';
    this.timer = 0;
    this.depth = depth;
    this.hooked = false;
    this.fish.visible = false;
    this.target.copy(point);
    // Der Schwimmer startet an der Rutenspitze (bzw. vor dem Gesicht, solange sie unsichtbar ist).
    this.start.copy(f.tip ?? this.tmp.copy(f.eye).addScaledVector(f.look, 1));
    this.bobber.position.copy(this.start);
    this.bobber.visible = true;
    this.d.playCast(0.7);
    this.d.audio.play('cast');
    this.d.wearRod();
  }

  private reel(hooked: boolean): void {
    this.state = 'reeling';
    this.timer = 0;
    this.hooked = hooked;
    this.fish.visible = hooked;
    this.start.copy(this.bobber.position);
    this.d.audio.play('reel');
    if (hooked) this.splash(1);
  }

  private finishReel(player: THREE.Vector3): void {
    if (this.hooked) {
      this.d.items.give('rawFish', 1, player);
      this.d.events.emit('fish:caught', { count: 1, trap: false });
      this.d.events.emit('hud:message', { text: 'Ein Fisch!' });
    }
    this.reset();
  }

  private reset(): void {
    if (this.state === 'idle') return;
    this.state = 'idle';
    this.bobber.visible = false;
    this.fish.visible = false;
    this.line.visible = false;
    this.d.setRod(false, 0);
  }

  /** Schwimmer treibt auf der Oberfläche (leichtes Schaukeln + Versatz nach unten). */
  private floatBobber(water: number, offset: number): void {
    this.bobber.position.set(this.target.x, water + 0.012 + Math.sin(this.time * 2.3) * 0.01 + offset, this.target.z);
    this.bobber.rotation.z = Math.sin(this.time * 1.7) * 0.12;
  }

  private splash(strength: number): void {
    const at = this.tmp.copy(this.bobber.position).setY(this.d.heightMap.waterLevel + 0.03);
    this.d.particles.burst(at, { count: Math.round(10 * strength), color: 0xd4e4ea, speed: 1.6 * strength, spread: 0.25, size: 0.035, life: 0.7 });
    this.d.audio.play('splash', { volume: 0.5 + 0.5 * strength, position: at });
  }

  private ripple(count: number): void {
    const at = this.tmp.copy(this.bobber.position).setY(this.d.heightMap.waterLevel + 0.02);
    this.d.particles.burst(at, { count, color: 0xc8d8de, speed: 0.6, spread: 0.12, size: 0.025, life: 0.5 });
  }

  /** Durchhängende Schnur: Parabel zwischen Spitze und Schwimmer, nie unter der Wasseroberfläche. */
  private updateLine(tip: THREE.Vector3 | null, water: number, slack: boolean): void {
    if (!tip || !this.bobber.visible) {
      this.line.visible = false;
      return;
    }
    this.line.visible = true;
    const end = this.bobber.position;
    const sag = slack ? Math.min(1.5, tip.distanceTo(end) * 0.08) : 0.05;
    const n = this.linePositions.length / 3 - 1;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      this.tmp.lerpVectors(tip, end, u);
      this.tmp.y -= sag * 4 * u * (1 - u);
      if (i < n) this.tmp.y = Math.max(this.tmp.y, water + 0.01);
      this.linePositions.set([this.tmp.x, this.tmp.y, this.tmp.z], i * 3);
    }
    this.line.geometry.attributes.position.needsUpdate = true;
  }
}

/** Takt, in dem eine Reuse "würfelt" (s), Fangchance je Takt und Höchstzahl gefangener Fische. */
export const TRAP_INTERVAL = 100;
export const TRAP_CHANCE = 0.55;
export const TRAP_MAX = 3;

/**
 * Fischreusen fangen von selbst: alle `TRAP_INTERVAL` Sekunden mit `TRAP_CHANCE` ein Fisch
 * (im Winter seltener), höchstens `TRAP_MAX`. Gefangene Fische sind im Korb zu sehen.
 */
export class FishTraps {
  private readonly timers = new Map<Structure, number>();
  private readonly shown = new Map<Structure, THREE.Object3D[]>();

  constructor(
    private readonly building: BuildingSystem,
    events: EventBus,
    private readonly rng: () => number = Math.random,
  ) {
    // Über Nacht (Schlaf) füllen sich die Reusen.
    events.on('player:slept', () => {
      for (const s of this.traps()) for (let i = 0; i < 8; i++) this.roll(s, 0);
    });
  }

  private traps(): Structure[] {
    return this.building.structures.filter((s) => s.def.interaction === 'trap');
  }

  /** Ein Fangversuch. */
  private roll(s: Structure, winter: number): void {
    if ((s.catch ?? 0) < TRAP_MAX && this.rng() < TRAP_CHANCE * (1 - 0.4 * winter)) s.catch = (s.catch ?? 0) + 1;
  }

  /** @param winter 0..1 – im Winter fangen Reusen seltener. */
  update(dt: number, winter: number): void {
    const alive = this.traps();
    for (const s of alive) {
      let t = (this.timers.get(s) ?? this.rng() * TRAP_INTERVAL) + dt;
      if (t >= TRAP_INTERVAL) {
        t -= TRAP_INTERVAL;
        this.roll(s, winter);
      }
      this.timers.set(s, t);
      this.showCatch(s);
    }
    for (const s of [...this.timers.keys()]) {
      if (alive.includes(s)) continue;
      this.timers.delete(s);
      this.shown.delete(s);
    }
  }

  /** Fische im Korb anzeigen (liegend, leicht versetzt). */
  private showCatch(s: Structure): void {
    const list = this.shown.get(s) ?? [];
    const n = s.catch ?? 0;
    if (list.length === n) return;
    while (list.length > n) list.pop()!.removeFromParent();
    while (list.length < n) {
      const i = list.length;
      const fish = createItemMesh('rawFish');
      fish.position.set((i - 1) * 0.12, 0.3 + i * 0.03, -0.05 + i * 0.12);
      fish.rotation.set(Math.PI / 2, 0, 0.3 * (i - 1));
      s.object.add(fish);
      list.push(fish);
    }
    this.shown.set(s, list);
  }
}
