import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { deriveSeed, mulberry32 } from '../utils/random';
import { smoothstep } from '../utils/math';

/**
 * Gebiete der Insel. Überall, wo keines der besonderen Gebiete liegt, ist Wald.
 * - **Gebirge** (Norden): hohe Grate mit Schneegipfeln, Fels und Nadelbäume.
 * - **Sumpf** (Südwesten): flaches, nasses Tiefland voller seichter Tümpel, tote Bäume, Schilf, Nebel.
 * - **Klippen** (Ostküste): Statt Strand fällt das Land in steilen Felswänden ins Meer.
 *
 * Die Gebiete gehen weich ineinander über; ihre Ränder sind mit Rauschen verbogen, damit sie nicht
 * wie Kreise wirken. Koordinaten in Metern, Norden ist −Z.
 */

export type BiomeName = 'forest' | 'highland' | 'swamp' | 'cliffs';

export interface BiomeWeights {
  highland: number;
  swamp: number;
  cliffs: number;
}

export const BIOME_LABELS: Record<BiomeName, string> = {
  forest: 'Wald',
  highland: 'Gebirge',
  swamp: 'Sumpf',
  cliffs: 'Klippenküste',
};

/** Mittelpunkte in normierten Koordinaten (−1 … 1 der halben Weltgröße). */
const HIGHLAND = { x: 0.04, z: -0.32, r0: 0.24, r1: 0.5 };
const SWAMP = { x: -0.44, z: 0.27, r0: 0.13, r1: 0.3 };
/** Klippen: Winkel (rad, 0 = Osten, im Uhrzeigersinn nach Süden) und Breite des Küstenabschnitts. */
const CLIFFS = { angle: -0.1, width0: 0.45, width1: 0.85 };

/** Erst ab dieser halben Weltgröße (m) gibt es Gebiete – kleine Testwelten bleiben reiner Wald. */
const MIN_HALF = 700;

export class BiomeMap {
  private readonly warp: NoiseFunction2D;
  readonly enabled: boolean;

  constructor(
    seed: number,
    private readonly half: number,
  ) {
    this.warp = createNoise2D(mulberry32(deriveSeed(seed, 'biomes')));
    this.enabled = half >= MIN_HALF;
  }

  /** Anteile der besonderen Gebiete an einer Stelle (je 0..1; der Rest ist Wald). */
  weights(x: number, z: number, out: BiomeWeights = { highland: 0, swamp: 0, cliffs: 0 }): BiomeWeights {
    if (!this.enabled) {
      out.highland = out.swamp = out.cliffs = 0;
      return out;
    }
    const nx = x / this.half;
    const nz = z / this.half;
    const w = this.warp(x * 0.0025, z * 0.0025) * 0.07 + this.warp(x * 0.008 + 31, z * 0.008) * 0.025;
    out.highland = 1 - smoothstep(HIGHLAND.r0, HIGHLAND.r1, Math.hypot(nx - HIGHLAND.x, (nz - HIGHLAND.z) * 1.25) + w);
    out.swamp = 1 - smoothstep(SWAMP.r0, SWAMP.r1, Math.hypot(nx - SWAMP.x, nz - SWAMP.z) + w);
    let da = Math.atan2(nz, nx) - CLIFFS.angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    out.cliffs = 1 - smoothstep(CLIFFS.width0, CLIFFS.width1, Math.abs(da) + w * 2);
    return out;
  }

  /** Vorherrschendes Gebiet (für Meldungen und die Karte). */
  dominant(x: number, z: number): BiomeName {
    const b = this.weights(x, z);
    const n = Math.hypot(x, z) / this.half;
    // Klippen zählen nur am Küstensaum.
    const cliffs = b.cliffs * smoothstep(0.62, 0.72, n);
    const best = Math.max(b.highland, b.swamp, cliffs);
    if (best < 0.5) return 'forest';
    return best === b.highland ? 'highland' : best === b.swamp ? 'swamp' : 'cliffs';
  }
}
