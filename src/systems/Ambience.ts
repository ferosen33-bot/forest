import * as THREE from 'three';
import type { Audio } from './Audio';
import type { HeightMap } from '../world/HeightMap';
import type { Vegetation } from '../world/Vegetation';
import { isTree } from '../world/Vegetation';
import { clamp, smoothstep } from '../utils/math';

export interface AmbienceState {
  /** Hörerposition (Kamera). */
  listener: THREE.Vector3;
  /** Tageslicht in [0, 1]. */
  daylight: number;
  underwater: boolean;
  /** Regenstärke 0..1 */
  rain: number;
  /** Windstärke 0..1 */
  wind: number;
  /** Unter einem Dach (Regen klingt dumpfer, prasselt auf Holz). */
  sheltered: boolean;
}

/** Endlos laufende Rausch-Schleife mit Filter und Lautstärke (Wind, Brandung, Unterwasser). */
interface Bed {
  filter: BiquadFilterNode;
  gain: GainNode;
}

/**
 * Prozedurale Hintergrundkulisse: Wind, Brandung, Vögel am Tag, Grillen und Eulen in der Nacht.
 *
 * Die Geräuschbetten laufen als Schleifen; einzelne Tierrufe werden zufällig um den Hörer
 * herum (räumlich) erzeugt. Die Mischung folgt Tageszeit, Höhe, Walddichte und Wassernähe.
 */
export class Ambience {
  private wind: Bed | null = null;
  private surf: Bed | null = null;
  private rumble: Bed | null = null;
  private rainBed: Bed | null = null;
  private rainLow: Bed | null = null;
  private time = 0;
  private sampleTimer = 0;
  private birdTimer = 2;
  private cricketTimer = 0;
  private owlTimer = 20;
  private readonly crickets: THREE.Vector3[] = [];

  /** Zuletzt gemessene Umgebung (für Debug-Anzeige und Mischung). */
  readonly env = { forest: 0, water: 0, ocean: 0, height: 0 };

  constructor(
    private readonly audio: Audio,
    private readonly heightMap: HeightMap,
    private readonly vegetation: Vegetation,
  ) {}

  update(dt: number, s: AmbienceState): void {
    const ctx = this.audio.context;
    if (!ctx) return;
    if (!this.wind) this.createBeds(ctx);
    this.time += dt;
    const t = ctx.currentTime;

    this.sampleTimer -= dt;
    if (this.sampleTimer <= 0) {
      this.sampleTimer = 0.5;
      this.sampleEnvironment(s.listener);
    }
    const e = this.env;
    const under = s.underwater ? 1 : 0;

    // Wind: böig, stärker in der Höhe und im Offenen, im dichten Wald gedämpft.
    const gust = 0.55 + 0.25 * Math.sin(this.time * 0.21) + 0.2 * Math.sin(this.time * 0.57 + 1.3);
    const exposure = clamp(0.25 + smoothstep(8, 45, e.height) * 0.6 + (1 - e.forest) * 0.35, 0, 1);
    // Sturm: deutlich lauter, heftigere Böen.
    const windGain = 0.14 * (0.6 + 1.6 * s.wind) * (gust + s.wind * 0.3 * Math.sin(this.time * 1.7));
    this.set(this.wind!, (1 - under) * windGain * exposure, 280 + 600 * gust + 300 * s.wind, t);

    // Regen: breites Rauschen; unter dem Dach dumpfes Prasseln, im Wald etwas gedämpft.
    const rain = (1 - under) * s.rain;
    this.set(this.rainBed!, rain * 0.16 * (s.sheltered ? 0.35 : 1 - 0.25 * e.forest), s.sheltered ? 1400 : 3200, t);
    this.set(this.rainLow!, rain * (s.sheltered ? 0.18 : 0.07), s.sheltered ? 420 : 650, t);

    // Brandung: Wellen rollen an (langsame Hüllkurve), am Meer lauter als am See.
    const swell = 0.55 + 0.45 * Math.sin(this.time * 0.42 + Math.sin(this.time * 0.13) * 2);
    const surf = e.water * (0.35 + 0.65 * e.ocean) * (0.4 + 0.6 * swell);
    this.set(this.surf!, (1 - under) * 0.22 * surf, 380 + 500 * e.ocean * swell, t);

    this.set(this.rumble!, 0.35 * under, 160, t);

    if (!s.underwater) this.updateCreatures(dt, s);
  }

  private set(bed: Bed, gain: number, freq: number, t: number): void {
    bed.gain.gain.setTargetAtTime(gain, t, 0.3);
    bed.filter.frequency.setTargetAtTime(freq, t, 0.3);
  }

  private createBeds(ctx: AudioContext): void {
    const make = (type: BiquadFilterType, q: number): Bed => {
      const src = ctx.createBufferSource();
      src.buffer = this.audio.noiseBuffer;
      src.loop = true;
      src.playbackRate.value = 0.5 + Math.random() * 0.2;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.audio.ambienceBus!);
      src.start();
      return { filter, gain };
    };
    this.wind = make('bandpass', 0.6);
    this.surf = make('lowpass', 0.5);
    this.rumble = make('lowpass', 0.7);
    this.rainBed = make('bandpass', 0.35);
    this.rainLow = make('lowpass', 0.6);
  }

  /** Wassernähe (Kreisabtastung der Höhenkarte), Walddichte und Höhe um den Hörer. */
  private sampleEnvironment(p: THREE.Vector3): void {
    const hm = this.heightMap;
    let nearest = Infinity;
    let oceanDepth = 0;
    for (const r of [3, 8, 16, 28, 42]) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const h = hm.heightAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
        if (h < hm.waterLevel) {
          if (r < nearest) nearest = r;
          oceanDepth = Math.max(oceanDepth, hm.waterLevel - h);
        }
      }
      if (nearest < Infinity) break;
    }
    this.env.water = nearest === Infinity ? 0 : (1 - nearest / 48) ** 2;
    // Tiefes Wasser in der Nähe = Meer (Binnenseen sind nur ~4,5 m tief).
    this.env.ocean = smoothstep(5, 9, oceanDepth);
    this.env.height = hm.heightAt(p.x, p.z);

    let trees = 0;
    for (const v of this.vegetation.instances) {
      if (v.alive && isTree(v.kind) && Math.abs(v.position.x - p.x) < 15 && Math.abs(v.position.z - p.z) < 15) trees++;
    }
    this.env.forest = clamp(trees / 18, 0, 1);
  }

  private updateCreatures(dt: number, s: AmbienceState): void {
    const day = s.daylight;
    const onLand = this.env.height > this.heightMap.waterLevel + 0.5;

    // Vögel: tagsüber, häufiger im Wald.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = (1.2 + Math.random() * 4) / (0.4 + this.env.forest);
      if (day > 0.35 && onLand) this.bird(this.around(s.listener, 8, 30, 3, 10), day);
    }

    // Grillen: nachts, ein kleiner Chor an festen Plätzen in der Nähe.
    if (day < 0.3 && onLand) {
      if (this.crickets.length === 0 || this.crickets[0].distanceTo(s.listener) > 30) {
        this.crickets.length = 0;
        for (let i = 0; i < 4; i++) this.crickets.push(this.around(s.listener, 5, 18, -1, 0.5));
      }
      this.cricketTimer -= dt;
      if (this.cricketTimer <= 0) {
        this.cricketTimer = 0.12 + Math.random() * 0.35;
        this.cricket(this.crickets[Math.floor(Math.random() * this.crickets.length)], 1 - day / 0.3);
      }
      this.owlTimer -= dt;
      if (this.owlTimer <= 0) {
        this.owlTimer = 25 + Math.random() * 30;
        this.owl(this.around(s.listener, 25, 50, 6, 14));
      }
    }
  }

  /** Zufällige Position im Ring [rMin, rMax] um `center`, Höhe relativ zum Boden. */
  private around(center: THREE.Vector3, rMin: number, rMax: number, hMin: number, hMax: number): THREE.Vector3 {
    const a = Math.random() * Math.PI * 2;
    const r = rMin + Math.random() * (rMax - rMin);
    const x = center.x + Math.cos(a) * r;
    const z = center.z + Math.sin(a) * r;
    return new THREE.Vector3(x, this.heightMap.heightAt(x, z) + hMin + Math.random() * (hMax - hMin), z);
  }

  /** Vogelruf: Folge kurzer Pfeiftöne mit schnellen Tonhöhen-Sprüngen. */
  private bird(pos: THREE.Vector3, level: number): void {
    const ctx = this.audio.context!;
    const out = this.audio.createSpatialOutput(pos, 'ambience');
    if (!out) return;
    const notes = 2 + Math.floor(Math.random() * 5);
    const base = 2400 + Math.random() * 2200;
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < notes; i++) {
      const dur = 0.05 + Math.random() * 0.1;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f0 = base * (0.85 + Math.random() * 0.3);
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * (0.7 + Math.random() * 0.7), t + dur);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.4 * level, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(env).connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur + 0.03 + Math.random() * 0.08;
    }
    setTimeout(() => out.disconnect(), (t - ctx.currentTime + 0.5) * 1000);
  }

  /** Grillenzirpen: 3–4 sehr kurze, hohe Pulse. */
  private cricket(pos: THREE.Vector3, level: number): void {
    const ctx = this.audio.context!;
    const out = this.audio.createSpatialOutput(pos, 'ambience');
    if (!out) return;
    const f = 4300 + Math.random() * 500;
    let t = ctx.currentTime + 0.01;
    const pulses = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < pulses; i++) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.14 * level, t + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
      osc.connect(env).connect(out);
      osc.start(t);
      osc.stop(t + 0.03);
      t += 0.035;
    }
    setTimeout(() => out.disconnect(), 400);
  }

  /** Eule: drei weiche, tiefe Rufe ("huu – hu – huuu"). */
  private owl(pos: THREE.Vector3): void {
    const ctx = this.audio.context!;
    const out = this.audio.createSpatialOutput(pos, 'ambience');
    if (!out) return;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 900;
    lowpass.connect(out);
    let t = ctx.currentTime + 0.05;
    for (const [f, dur, gap] of [
      [390, 0.45, 0.25],
      [365, 0.2, 0.15],
      [375, 0.6, 0],
    ]) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.linearRampToValueAtTime(f * 0.94, t + dur);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.6, t + 0.08);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(env).connect(lowpass);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      t += dur + gap;
    }
    setTimeout(() => out.disconnect(), 2500);
  }
}
