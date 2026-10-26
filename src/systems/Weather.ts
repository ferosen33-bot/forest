import { clamp } from '../utils/math';

export type WeatherPhase = 'clear' | 'cloudy' | 'rain' | 'storm' | 'clearing';

interface PhaseDef {
  /** Zielwerte, denen sich das Wetter langsam annähert. */
  clouds: number;
  rain: number;
  wind: number;
  /** Dauer in Spielsekunden [min, max]. */
  duration: [number, number];
  /** Mögliche Folgephasen mit Gewicht. */
  next: [WeatherPhase, number][];
}

const PHASES: Record<WeatherPhase, PhaseDef> = {
  clear: { clouds: 0.18, rain: 0, wind: 0.3, duration: [300, 600], next: [['cloudy', 1]] },
  cloudy: { clouds: 0.65, rain: 0, wind: 0.5, duration: [70, 140], next: [['rain', 0.7], ['clearing', 0.3]] },
  rain: { clouds: 0.88, rain: 0.65, wind: 0.6, duration: [120, 240], next: [['storm', 0.35], ['clearing', 0.65]] },
  storm: { clouds: 1, rain: 1, wind: 1, duration: [80, 150], next: [['rain', 1]] },
  clearing: { clouds: 0.4, rain: 0, wind: 0.4, duration: [60, 100], next: [['clear', 1]] },
};

export const WEATHER_PHASES = Object.keys(PHASES) as WeatherPhase[];

export interface Lightning {
  /** Entfernung des Einschlags (m) – bestimmt Lautstärke und Donner-Verzögerung. */
  distance: number;
  /** Richtung (Winkel um die Hochachse). */
  angle: number;
}

export interface WeatherSave {
  phase: WeatherPhase;
  timer: number;
  clouds: number;
  rain: number;
  wind: number;
}

/** Schallgeschwindigkeit für die Donner-Verzögerung (m/s). */
const SPEED_OF_SOUND = 343;

/**
 * Wetter als Zustandsautomat: klar → bewölkt → Regen (→ Gewitter) → aufklarend → klar.
 * Bewölkung, Regen und Wind gleiten weich auf die Zielwerte der aktuellen Phase zu;
 * im Gewitter schlagen Blitze ein, deren Donner mit Schallgeschwindigkeit nachfolgt.
 * Reine Logik ohne Three.js → testbar; Darstellung und Ton übernehmen andere Systeme.
 */
export class Weather {
  phase: WeatherPhase = 'clear';
  /** Restdauer der aktuellen Phase (s). */
  timer: number;
  clouds = PHASES.clear.clouds;
  rain = 0;
  wind = PHASES.clear.wind;
  /** Helligkeit des aktuellen Blitzes (0 = keiner), klingt schnell ab. */
  flash = 0;
  /** Gewitter mit Blitz und Donner – im Schneesturm aus. */
  lightningEnabled = true;

  /** Wird beim Blitz aufgerufen. */
  onLightning: ((l: Lightning) => void) | null = null;
  /** Wird aufgerufen, wenn der Donner beim Spieler ankommt. */
  onThunder: ((l: Lightning) => void) | null = null;

  private lightningTimer = 8;
  private readonly pendingThunder: { at: number; l: Lightning }[] = [];
  private time = 0;

  constructor(private readonly rng: () => number = Math.random) {
    // Der erste Tag beginnt ruhig.
    this.timer = 360;
  }

  /** Stärke des Gewitters in [0, 1] (für Wind-Böen, Blitze). */
  get storm(): number {
    return clamp((this.rain - 0.7) / 0.3, 0, 1);
  }

  get name(): string {
    const names: Record<WeatherPhase, string> = {
      clear: 'Klar',
      cloudy: 'Bewölkt',
      rain: 'Regen',
      storm: 'Gewitter',
      clearing: 'Aufklarend',
    };
    return names[this.phase];
  }

  update(dt: number): void {
    this.time += dt;
    this.timer -= dt;
    if (this.timer <= 0) this.setPhase(this.pick(PHASES[this.phase].next));

    const def = PHASES[this.phase];
    // Wolken ziehen langsam auf, Regen setzt erst bei dichter Bewölkung ein und hört schneller auf.
    this.clouds = approach(this.clouds, def.clouds, dt / 45);
    const rainTarget = this.clouds > 0.75 ? def.rain : 0;
    this.rain = approach(this.rain, rainTarget, dt / (rainTarget > this.rain ? 30 : 18));
    this.wind = approach(this.wind, def.wind, dt / 25);

    this.flash = Math.max(0, this.flash - dt * 6);
    if (this.storm > 0.3 && this.lightningEnabled) {
      this.lightningTimer -= dt * this.storm;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 5 + this.rng() * 14;
        const l: Lightning = { distance: 150 + this.rng() * 1600, angle: this.rng() * Math.PI * 2 };
        // Nahe Blitze sind heller.
        this.flash = 0.45 + 0.55 * (1 - l.distance / 1750);
        this.onLightning?.(l);
        this.pendingThunder.push({ at: this.time + l.distance / SPEED_OF_SOUND, l });
      }
    }
    for (let i = this.pendingThunder.length - 1; i >= 0; i--) {
      if (this.time < this.pendingThunder[i].at) continue;
      this.onThunder?.(this.pendingThunder[i].l);
      this.pendingThunder.splice(i, 1);
    }
  }

  setPhase(phase: WeatherPhase): void {
    this.phase = phase;
    const [min, max] = PHASES[phase].duration;
    this.timer = min + this.rng() * (max - min);
  }

  /** Debug: sofort zur nächsten Phase (Regen und Bewölkung springen mit). */
  advance(): void {
    this.setPhase(this.pick(PHASES[this.phase].next));
    const def = PHASES[this.phase];
    this.clouds = def.clouds;
    this.rain = def.rain;
    this.wind = def.wind;
  }

  serialize(): WeatherSave {
    return { phase: this.phase, timer: this.timer, clouds: this.clouds, rain: this.rain, wind: this.wind };
  }

  load(d: WeatherSave): void {
    if (!(d.phase in PHASES)) return;
    this.phase = d.phase;
    this.timer = Number.isFinite(d.timer) ? d.timer : 60;
    this.clouds = clamp(d.clouds, 0, 1);
    this.rain = clamp(d.rain, 0, 1);
    this.wind = clamp(d.wind, 0, 1);
  }

  private pick(options: [WeatherPhase, number][]): WeatherPhase {
    const total = options.reduce((s, [, w]) => s + w, 0);
    let r = this.rng() * total;
    for (const [phase, w] of options) {
      r -= w;
      if (r <= 0) return phase;
    }
    return options[options.length - 1][0];
  }
}

function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}
