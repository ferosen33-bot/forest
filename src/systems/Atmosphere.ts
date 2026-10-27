import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import { townWorld, type TownLayout, type TownProp } from '../world/Town';
import type { PlaceSite } from '../world/Places';
import { deriveSeed, mulberry32 } from '../utils/random';
import type { Audio, SoundId } from './Audio';
import type { LightPool, LightRequest } from './LightPool';
import { Crows } from './Crows';

export interface AtmosphereDeps {
  /** Altwasser, die Dörfer, die Wege und die Wildnis. */
  layouts: TownLayout[];
  places: PlaceSite[];
  lights: LightPool;
  audio: Audio;
  events: EventBus;
  seed: number;
}

export interface AtmosphereState {
  listener: THREE.Vector3;
  daylight: number;
  /** Uhrzeit 0..24. */
  hour: number;
  wind: number;
  /** In einer Höhle: oben ist alles still. */
  cave: boolean;
}

/** Lichtquelle mit eigenem Flackern. */
interface Glow {
  request: LightRequest;
  base: number;
  /** candle: ruhig flackernd; lamp: kaputte Straßenlampe (an/aus, brummt); torch: Taschenlampe mit schwacher Batterie. */
  kind: 'candle' | 'lamp' | 'torch';
  phase: number;
  on: boolean;
  timer: number;
}

/** Geräuschquelle, die gelegentlich etwas von sich gibt. */
interface Emitter {
  position: THREE.Vector3;
  sound: SoundId;
  range: number;
  /** Abstand zwischen zwei Rufen (s). */
  every: [number, number];
  volume: number;
  /** Nur nachts, nur am Tag oder nur bei Wind. */
  when?: 'night' | 'day' | 'wind';
  timer: number;
}

/** Weltposition eines Punktes im Bezugssystem einer Requisite (lokal x quer, y hoch, z vorwärts). */
export function propPoint(t: TownLayout, p: TownProp, lx: number, ly: number, lz: number): THREE.Vector3 {
  const yaw = p.rotation;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const x = p.x + c * lx + s * lz;
  const z = p.z - s * lx + c * lz;
  const w = townWorld(t, x, z);
  return new THREE.Vector3(w.x, t.center.y + (p.y ?? 0) + ly, w.z);
}

/**
 * Was die Insel lebendig (und unheimlich) macht, ohne dass es eine Aufgabe hätte:
 * - Kerzen an den Wegkreuzen brennen nachts – niemand weiß, wer sie anzündet.
 * - In Altwasser und Moorwinkel flackert je eine Straßenlampe und brummt.
 * - Die Taschenlampe beim verlorenen Rucksack leuchtet noch, mit sterbender Batterie.
 * - Windspiele am Campingplatz, knarrende Scheunentore, Flüstern und Klopfen an den Schrat-Totems.
 * - Um Mitternacht schlägt die Glocke der Kapelle zwölfmal.
 * - Krähen sitzen auf Zäunen, Masten und Vogelscheuchen und fliegen auf, wenn man kommt.
 */
export class Atmosphere {
  readonly crows: Crows;
  private readonly glows: Glow[] = [];
  private readonly emitters: Emitter[] = [];
  private readonly chapel: THREE.Vector3 | null;
  private lastHour = -1;
  private bellQueue = 0;
  private bellTimer = 0;
  private time = 0;

  constructor(private readonly d: AtmosphereDeps) {
    const rng = mulberry32(deriveSeed(d.seed, 'atmosphere'));
    const perches: THREE.Vector3[] = [];
    for (const t of d.layouts) {
      const lamps: TownProp[] = [];
      for (const p of t.props) {
        switch (p.kind) {
          case 'shrine':
            this.glow('candle', propPoint(t, p, 0, 0.42, 0.2), 0xffa04a, 1.6, 5);
            break;
          case 'droplight':
            this.glow('torch', propPoint(t, p, 0, 0.25, 0.6), 0xdfe8ff, 3.2, 9);
            break;
          case 'lamp':
            lamps.push(p);
            break;
          case 'totem':
            perches.push(propPoint(t, p, 0, 3.0, 0));
            this.emit(propPoint(t, p, 0, 1.2, 0), rng() < 0.5 ? 'whisper' : 'knock', 22, [14, 30], 0.5, 'night');
            break;
          case 'scarecrow':
            perches.push(propPoint(t, p, 0.7, 1.82, 0), propPoint(t, p, -0.7, 1.82, 0), propPoint(t, p, 0, 2.42, 0));
            break;
          case 'fence':
            if (rng() < 0.6) perches.push(propPoint(t, p, (rng() - 0.5) * (p.length ?? 4), 1.22, 0));
            break;
          case 'pole':
            if (!p.tilt && rng() < 0.3) perches.push(propPoint(t, p, (rng() - 0.5) * 1.6, 7.68, 0));
            break;
          case 'chimney':
            perches.push(propPoint(t, p, 0, 4.36, 0));
            break;
          case 'logpile':
            perches.push(propPoint(t, p, 0, 1.6, 0));
            break;
        }
      }
      // Je Ort flackert eine Straßenlampe (und brummt).
      if (lamps.length) {
        const p = lamps[Math.floor(rng() * lamps.length)];
        const at = propPoint(t, p, 0, 4.3, 1.3);
        this.glow('lamp', at, 0xffd9a0, 9, 18);
        this.emit(at, 'buzz', 14, [0.25, 0.4], 0.5, 'night');
      }
      for (const b of t.buildings) {
        const front = (lx: number, lz: number, ly = 1.5) => {
          const c = Math.cos(b.rotation);
          const s = Math.sin(b.rotation);
          const w = townWorld(t, b.x + c * lx + s * lz, b.z - s * lx + c * lz);
          return new THREE.Vector3(w.x, t.center.y + ly, w.z);
        };
        if (b.kind === 'barn') {
          this.emit(front(-2.2, b.d / 2 + 0.5, 2), 'creak', 26, [6, 14], 0.7, 'wind');
          perches.push(front(0, 0, 4.2 + 3.0 + 0.1));
        }
        if (b.kind === 'cabin' && rng() < 0.5) this.emit(front(1.2, b.d / 2 + 1.2, 2.2), 'chime', 24, [7, 15], 0.6, 'wind');
        if (b.kind === 'pub') this.emit(front(0, b.d / 2 + 0.4, 2.6), 'creak', 18, [9, 20], 0.4, 'wind');
      }
    }
    const chapel = d.places.find((p) => p.kind === 'chapel');
    this.chapel = chapel ? chapel.position.clone().setY(chapel.position.y + 8) : null;
    this.crows = new Crows({ perches, audio: d.audio, events: d.events, seed: d.seed });
  }

  get group(): THREE.Object3D {
    return this.crows.group;
  }

  private glow(kind: Glow['kind'], position: THREE.Vector3, color: number, intensity: number, distance: number): void {
    this.glows.push({ request: { position, color: new THREE.Color(color), intensity: 0, distance }, base: intensity, kind, phase: Math.random() * 10, on: true, timer: 0 });
  }

  private emit(position: THREE.Vector3, sound: SoundId, range: number, every: [number, number], volume: number, when?: Emitter['when']): void {
    this.emitters.push({ position, sound, range, every, volume, when, timer: every[0] * Math.random() });
  }

  update(dt: number, s: AtmosphereState): void {
    this.time += dt;
    const night = 1 - THREE.MathUtils.smoothstep(s.daylight, 0.15, 0.45);
    if (!s.cave) {
      this.updateGlows(dt, s, night);
      this.updateEmitters(dt, s, night);
      this.updateBell(dt, s);
    }
    this.crows.update(dt, s.listener, s.daylight, s.cave);
  }

  private updateGlows(dt: number, s: AtmosphereState, night: number): void {
    if (night < 0.05) return;
    for (const g of this.glows) {
      const dist = g.request.position.distanceTo(s.listener);
      if (dist > 70) continue;
      g.phase += dt;
      g.timer -= dt;
      let f = 1;
      if (g.kind === 'candle') {
        f = 0.75 + 0.15 * Math.sin(g.phase * 11) + 0.1 * Math.sin(g.phase * 23.7);
      } else if (g.kind === 'lamp') {
        // Meist an, manchmal ein paar Sekunden aus, beim Umschalten nervöses Flackern.
        if (g.timer <= 0) {
          g.on = !g.on;
          g.timer = g.on ? 2 + Math.random() * 7 : 0.4 + Math.random() * 2.5;
        }
        const stutter = g.timer < 0.5 ? (Math.sin(g.phase * 60) > 0 ? 1 : 0.1) : 1;
        f = g.on ? stutter * (0.92 + 0.08 * Math.sin(g.phase * 50)) : 0;
      } else {
        // Taschenlampe: schwache Batterie, gelegentlich fast aus.
        if (g.timer <= 0) g.timer = 3 + Math.random() * 6;
        f = g.timer < 0.6 ? 0.15 + 0.5 * Math.abs(Math.sin(g.phase * 31)) : 0.85 + 0.15 * Math.sin(g.phase * 3);
      }
      g.request.intensity = g.base * f * night;
      if (g.request.intensity > 0.05) this.d.lights.request(g.request);
    }
  }

  private updateEmitters(dt: number, s: AtmosphereState, night: number): void {
    for (const e of this.emitters) {
      e.timer -= dt;
      if (e.timer > 0) continue;
      e.timer = e.every[0] + Math.random() * (e.every[1] - e.every[0]);
      if (e.position.distanceTo(s.listener) > e.range) continue;
      if (e.when === 'night' && night < 0.5) continue;
      if (e.when === 'day' && night > 0.5) continue;
      if (e.when === 'wind' && s.wind < 0.25) continue;
      // Die kaputte Lampe brummt nur, wenn sie gerade an ist.
      if (e.sound === 'buzz' && !this.glows.some((g) => g.kind === 'lamp' && g.on && g.request.position.distanceTo(e.position) < 0.5)) continue;
      this.d.audio.play(e.sound, { position: e.position, volume: e.volume * (e.when === 'wind' ? Math.min(1, s.wind * 1.5) : 1) });
    }
  }

  /** Mitternacht: zwölf Glockenschläge von der Kapelle. */
  private updateBell(dt: number, s: AtmosphereState): void {
    const h = Math.floor(s.hour);
    if (this.lastHour === 23 && h === 0) this.bellQueue = 12;
    this.lastHour = h;
    if (this.bellQueue <= 0 || !this.chapel) return;
    this.bellTimer -= dt;
    if (this.bellTimer > 0) return;
    this.bellTimer = 2.6;
    this.bellQueue--;
    const dist = this.chapel.distanceTo(s.listener);
    if (dist > 900) return;
    // Aus der Ferne ohne Raumklang, aber leiser – damit man sie über die halbe Insel hört.
    if (dist < 120) this.d.audio.play('bell', { position: this.chapel, volume: 1 });
    else this.d.audio.play('bell', 0.5 * (1 - dist / 900));
  }

  /** Lichter und Rufquellen (für Tests und die Debug-Anzeige). */
  get counts(): { glows: number; emitters: number; perches: number } {
    return { glows: this.glows.length, emitters: this.emitters.length, perches: this.crows.perchCount };
  }
}
