import * as THREE from 'three';
import type { Grade, Mist } from './PostFX';
import { clamp, lerp, smoothstep } from '../utils/math';

/**
 * Filmlook je nach Lage: kühl-entsättigter Tag, blaustichige Nacht, grünlich-fahle Höhle,
 * blutrote Fiebernacht. Angst verstärkt Korn, Vignette und Farbsäume. Dazu der Bodennebel:
 * dicht im Morgengrauen und nachts, dünn am hellen Tag, im Regen dichter.
 *
 * Reine Funktion (getestet); Game reicht das Ergebnis an PostFX weiter.
 */

export interface LookContext {
  /** Tageslicht 0 (Nacht) … 1 (Mittag). */
  daylight: number;
  /** Uhrzeit 0–24. */
  hour: number;
  /** Fiebernacht 0..1. */
  fever: number;
  cave: boolean;
  underwater: boolean;
  /** Angst 0..1. */
  fear: number;
  /** Regen 0..1. */
  rain: number;
  /** Schneesturm 0..1: weißer, dichter Schleier. */
  blizzard?: number;
  /** Höhe der Kamera (Welt-Y). */
  cameraY: number;
  /** Nebelfarbe der Szene (linear). */
  fogColor: THREE.Color;
}

export interface Look {
  grade: Grade;
  mist: Mist;
}

interface Tone {
  saturation: number;
  contrast: number;
  shadows: [number, number, number];
  highlights: [number, number, number];
  grain: number;
  vignette: number;
  aberration: number;
}

const DAY: Tone = { saturation: 0.74, contrast: 1.08, shadows: [0.0, 0.012, 0.02], highlights: [1.0, 0.97, 0.9], grain: 0.035, vignette: 0.8, aberration: 0.003 };
const NIGHT: Tone = { saturation: 0.45, contrast: 1.05, shadows: [0.0, 0.01, 0.032], highlights: [0.86, 0.93, 1.06], grain: 0.075, vignette: 1.1, aberration: 0.004 };
const CAVE: Tone = { saturation: 0.5, contrast: 1.12, shadows: [0.006, 0.012, 0.004], highlights: [1.02, 0.96, 0.8], grain: 0.065, vignette: 1.2, aberration: 0.004 };
const FEVER: Tone = { saturation: 0.85, contrast: 1.18, shadows: [0.035, 0.0, 0.0], highlights: [1.12, 0.78, 0.72], grain: 0.08, vignette: 1.25, aberration: 0.006 };
const WATER: Tone = { saturation: 0.6, contrast: 1.0, shadows: [0.0, 0.02, 0.03], highlights: [0.85, 1.0, 1.0], grain: 0.03, vignette: 1.0, aberration: 0.008 };

function mixTone(a: Tone, b: Tone, t: number): Tone {
  const m3 = (x: [number, number, number], y: [number, number, number]): [number, number, number] => [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
  return {
    saturation: lerp(a.saturation, b.saturation, t),
    contrast: lerp(a.contrast, b.contrast, t),
    shadows: m3(a.shadows, b.shadows),
    highlights: m3(a.highlights, b.highlights),
    grain: lerp(a.grain, b.grain, t),
    vignette: lerp(a.vignette, b.vignette, t),
    aberration: lerp(a.aberration, b.aberration, t),
  };
}

/** Morgennebel: am dichtesten kurz vor Sonnenaufgang, gegen 9 Uhr verflogen. */
export function morningMist(hour: number): number {
  return smoothstep(3, 5.5, hour) * (1 - smoothstep(7, 9.5, hour));
}

const WHITEOUT = new THREE.Color();

export function filmLook(c: LookContext, out?: Look): Look {
  let tone = mixTone(NIGHT, DAY, smoothstep(0.15, 0.7, c.daylight));
  if (c.cave) tone = CAVE;
  if (c.fever > 0) tone = mixTone(tone, FEVER, c.fever);
  if (c.underwater) tone = WATER;
  const fear = clamp(c.fear, 0, 1);
  const blizzard = c.cave || c.underwater ? 0 : clamp(c.blizzard ?? 0, 0, 1);

  const look = out ?? {
    grade: { saturation: 1, contrast: 1, shadows: new THREE.Color(), highlights: new THREE.Color(), grain: 0, vignette: 0, aberration: 0 },
    mist: { color: new THREE.Color(), density: 0, height: 6, base: 0 },
  };
  const g = look.grade;
  g.saturation = tone.saturation * (1 - 0.35 * fear) * (1 - 0.3 * blizzard);
  g.contrast = tone.contrast + 0.06 * fear;
  g.shadows.setRGB(...tone.shadows);
  g.highlights.setRGB(...tone.highlights);
  g.grain = tone.grain + 0.05 * fear;
  g.vignette = tone.vignette + 0.9 * fear;
  g.aberration = tone.aberration + 0.012 * fear;

  const m = look.mist;
  m.color.copy(c.fogColor);
  if (c.cave) {
    // Staub, der in Bodennähe hängt
    m.density = 0.03;
    m.height = 2.5;
    m.base = c.cameraY - 1.8;
  } else {
    const night = 1 - smoothstep(0.1, 0.6, c.daylight);
    m.density = 0.0015 + 0.011 * night + 0.032 * morningMist(c.hour) + 0.01 * c.rain + 0.01 * c.fever;
    m.height = 5 + 3 * c.rain;
    // Schneesturm: Sicht nur noch wenige Dutzend Meter, alles verschwimmt im fahlen Weiß.
    m.density += 0.05 * blizzard;
    m.height += 14 * blizzard;
    m.color.lerp(WHITEOUT.setRGB(0.6, 0.64, 0.7).multiplyScalar(0.12 + 0.88 * c.daylight), 0.65 * blizzard);
    // Der Nebel folgt dem Gelände unter dem Spieler (Bezug knapp unter den Füßen) und sammelt sich in Senken.
    m.base = c.cameraY - 2.2;
  }
  return look;
}
