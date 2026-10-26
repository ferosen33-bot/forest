import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { deriveSeed, mulberry32 } from '../utils/random';
import { clamp, lerp, smoothstep } from '../utils/math';
import { BiomeMap, type BiomeWeights } from './Biomes';

export interface HeightMapOptions {
  /** Kantenlänge der Welt in Metern (Welt reicht von -size/2 bis +size/2). */
  size: number;
  /** Abstand zweier Samples in Metern. */
  cellSize: number;
  seed: number;
  waterLevel: number;
}

/**
 * Prozedurale Insel-Höhenkarte.
 *
 * Die Höhen werden einmal auf einem regelmäßigen Raster vorberechnet. Render-Mesh,
 * Physik-Heightfield und Objektplatzierung lesen alle aus diesem Raster und
 * interpolieren mit derselben Dreiecksaufteilung wie Rapier – dadurch gibt es
 * keine Abweichungen zwischen dem, was man sieht, und dem, worauf man läuft.
 *
 * Speicherlayout: zeilenweise, `heights[iz * samples + ix]`.
 */
export class HeightMap {
  readonly size: number;
  readonly cellSize: number;
  readonly half: number;
  /** Anzahl Zellen pro Kante. */
  readonly cells: number;
  /** Anzahl Samples pro Kante (= cells + 1). */
  readonly samples: number;
  readonly waterLevel: number;
  readonly heights: Float32Array;
  /** Gebiete der Insel (Gebirge, Sumpf, Klippen, Wald). */
  readonly biomes: BiomeMap;
  minHeight = Infinity;
  maxHeight = -Infinity;

  private readonly warpNoise: NoiseFunction2D;
  private readonly hillNoise: NoiseFunction2D;
  private readonly ridgeNoise: NoiseFunction2D;
  private readonly detailNoise: NoiseFunction2D;
  private readonly lakeNoise: NoiseFunction2D;
  private readonly peakNoise: NoiseFunction2D;
  private readonly swampNoise: NoiseFunction2D;
  private readonly bw: BiomeWeights = { highland: 0, swamp: 0, cliffs: 0 };

  constructor(opts: HeightMapOptions) {
    this.size = opts.size;
    this.cellSize = opts.cellSize;
    this.half = opts.size / 2;
    this.cells = Math.round(opts.size / opts.cellSize);
    this.samples = this.cells + 1;
    this.waterLevel = opts.waterLevel;

    const noise = (name: string) => createNoise2D(mulberry32(deriveSeed(opts.seed, name)));
    this.warpNoise = noise('warp');
    this.hillNoise = noise('hills');
    this.ridgeNoise = noise('ridges');
    this.detailNoise = noise('detail');
    this.lakeNoise = noise('lakes');
    this.peakNoise = noise('peaks');
    this.swampNoise = noise('swamp');
    this.biomes = new BiomeMap(opts.seed, this.half);

    this.heights = new Float32Array(this.samples * this.samples);
    for (let iz = 0; iz < this.samples; iz++) {
      const z = iz * this.cellSize - this.half;
      for (let ix = 0; ix < this.samples; ix++) {
        const x = ix * this.cellSize - this.half;
        const h = this.generate(x, z);
        this.heights[iz * this.samples + ix] = h;
        if (h < this.minHeight) this.minHeight = h;
        if (h > this.maxHeight) this.maxHeight = h;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Generierung
  // ---------------------------------------------------------------------------

  /** Fraktales Rauschen (fBm), Ergebnis grob in [-1, 1]. */
  private fbm(noise: NoiseFunction2D, x: number, z: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03; // leicht krumm, um Raster-Artefakte zu vermeiden
    }
    return sum / norm;
  }

  /** Ridged-Noise für Gebirgsgrate, Ergebnis in [0, 1]. */
  private ridged(noise: NoiseFunction2D, x: number, z: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let weight = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(noise(x * freq, z * freq));
      n *= n * weight;
      weight = clamp(n * 2, 0, 1);
      sum += n * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / norm;
  }

  /** Höhe in Metern an einer Weltposition (rohe Funktion, nicht gerastert). */
  private generate(x: number, z: number): number {
    const nx = x / this.half;
    const nz = z / this.half;
    const b = this.biomes.weights(x, z, this.bw);

    // Radiale Inselmaske; die Küstenlinie wird per Noise verbogen, damit sie nicht rund wirkt.
    const warp = this.fbm(this.warpNoise, x * 0.0022, z * 0.0022, 3);
    const d = Math.sqrt(nx * nx + nz * nz) + warp * 0.2;
    let island = 1 - smoothstep(0.56, 0.9, d);
    // Klippen: Die Küste bricht auf wenigen Metern ab, statt flach ins Meer zu laufen.
    island = lerp(island, 1 - smoothstep(0.785, 0.81, d), b.cliffs);

    // Sanfte Hügel überall an Land.
    const hills = this.fbm(this.hillNoise, x * 0.0045, z * 0.0045, 5) * 0.5 + 0.5;
    // Gebirgsgrate nur im Inselinneren.
    const ridge = this.ridged(this.ridgeNoise, x * 0.0032, z * 0.0032, 4);
    const mountainMask = (1 - smoothstep(0.05, 0.5, d)) * (1 - b.swamp);

    let land = 4 + hills * 16 + ridge * ridge * 48 * mountainMask;
    // Gebirge: hohe, scharfe Grate (bis gut 130 m) mit Tälern dazwischen.
    if (b.highland > 0) {
      const peaks = this.ridged(this.peakNoise, x * 0.0022, z * 0.0022, 5);
      land += b.highland * (10 + Math.pow(peaks, 1.4) * 125);
    }
    // Klippen: Hochfläche über der Steilküste.
    land += b.cliffs * smoothstep(0.45, 0.72, d) * (16 + hills * 10);
    land += this.detailNoise(x * 0.06, z * 0.06) * 0.35;

    // Übergang Meeresgrund -> Land.
    let h = lerp(-22, land, island);

    // Strände: Höhen knapp über dem Wasser werden abgeflacht.
    if (h > 0) h *= lerp(0.15, 1, smoothstep(0, 7, h));

    // Binnenseen: Senken, die unter den Wasserspiegel reichen (nicht im Sumpf – der hat eigene Tümpel).
    const lake = smoothstep(0.36, 0.7, this.lakeNoise(x * 0.005, z * 0.005));
    const lakeMask = lake * (1 - smoothstep(0.35, 0.62, d)) * (1 - b.swamp);
    h = lerp(h, this.waterLevel - 4.5, lakeMask * lakeMask * (3 - 2 * lakeMask));

    // Sumpf: flaches Tiefland knapp über dem Wasser, durchsetzt von knietiefen Tümpeln.
    if (b.swamp > 0) {
      const s1 = this.fbm(this.swampNoise, x * 0.018, z * 0.018, 3);
      const s2 = this.swampNoise(x * 0.09, z * 0.09);
      const wet = Math.max(this.waterLevel + 0.25 + s1 * 1.1 + s2 * 0.15, this.waterLevel - 0.6);
      h = lerp(h, wet, smoothstep(0, 1, b.swamp) * smoothstep(0.35, 0.85, island));
    }

    return h;
  }

  /**
   * Ebnet eine runde Fläche auf Höhe `y` ein (Bauplatz der Stadt) und lässt sie über `blend` m
   * weich ins Gelände übergehen. Muss vor dem Aufbau von Terrain und Physik aufgerufen werden.
   */
  flatten(cx: number, cz: number, radius: number, blend: number, y: number): void {
    const r = radius + blend;
    const i0 = Math.max(0, Math.floor((cx - r + this.half) / this.cellSize));
    const i1 = Math.min(this.cells, Math.ceil((cx + r + this.half) / this.cellSize));
    const k0 = Math.max(0, Math.floor((cz - r + this.half) / this.cellSize));
    const k1 = Math.min(this.cells, Math.ceil((cz + r + this.half) / this.cellSize));
    for (let iz = k0; iz <= k1; iz++) {
      for (let ix = i0; ix <= i1; ix++) {
        const x = ix * this.cellSize - this.half;
        const z = iz * this.cellSize - this.half;
        const d = Math.hypot(x - cx, z - cz);
        if (d >= r) continue;
        const t = 1 - smoothstep(radius, r, d);
        const i = iz * this.samples + ix;
        this.heights[i] = lerp(this.heights[i], y, t);
      }
    }
    this.minHeight = Math.min(this.minHeight, y);
    this.maxHeight = Math.max(this.maxHeight, y);
  }

  // ---------------------------------------------------------------------------
  // Abfragen
  // ---------------------------------------------------------------------------

  /** Roh-Sample am Rasterpunkt (Indizes werden auf den gültigen Bereich begrenzt). */
  getSample(ix: number, iz: number): number {
    const cx = ix < 0 ? 0 : ix > this.cells ? this.cells : ix;
    const cz = iz < 0 ? 0 : iz > this.cells ? this.cells : iz;
    return this.heights[cz * this.samples + cx];
  }

  isInside(x: number, z: number): boolean {
    return Math.abs(x) <= this.half && Math.abs(z) <= this.half;
  }

  /**
   * Interpolierte Höhe an einer Weltposition.
   * Jede Zelle ist entlang der Diagonale (x0,z1)–(x1,z0) geteilt – exakt wie
   * Rapiers Heightfield –, sodass Ergebnis und Kollision übereinstimmen.
   */
  heightAt(x: number, z: number): number {
    const gx = clamp((x + this.half) / this.cellSize, 0, this.cells);
    const gz = clamp((z + this.half) / this.cellSize, 0, this.cells);
    const ix = Math.min(Math.floor(gx), this.cells - 1);
    const iz = Math.min(Math.floor(gz), this.cells - 1);
    const fx = gx - ix;
    const fz = gz - iz;

    const i = iz * this.samples + ix;
    const h00 = this.heights[i];
    const h10 = this.heights[i + 1];
    const h01 = this.heights[i + this.samples];
    const h11 = this.heights[i + this.samples + 1];

    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /**
   * Geglättete Oberflächennormale (zentrale Differenzen über das Raster).
   * Wird für Beleuchtung und Platzierungsregeln genutzt; gibt [nx, ny, nz] zurück.
   */
  normalAt(x: number, z: number, out: [number, number, number] = [0, 1, 0]): [number, number, number] {
    const e = this.cellSize;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    const nx = hl - hr;
    const ny = 2 * e;
    const nz = hd - hu;
    const len = Math.hypot(nx, ny, nz);
    out[0] = nx / len;
    out[1] = ny / len;
    out[2] = nz / len;
    return out;
  }

  /** Normale direkt an einem Rasterpunkt (schneller, für Mesh-Aufbau). */
  normalAtSample(ix: number, iz: number, out: [number, number, number]): [number, number, number] {
    const nx = this.getSample(ix - 1, iz) - this.getSample(ix + 1, iz);
    const ny = 2 * this.cellSize;
    const nz = this.getSample(ix, iz - 1) - this.getSample(ix, iz + 1);
    const len = Math.hypot(nx, ny, nz);
    out[0] = nx / len;
    out[1] = ny / len;
    out[2] = nz / len;
    return out;
  }

  /**
   * Höhen im von Rapier erwarteten Layout: spaltenweise (column-major),
   * Zeilen entlang Z, Spalten entlang X → Index `iz + ix * samples`.
   */
  toRapierHeights(): Float32Array {
    const n = this.samples;
    const out = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        out[iz + ix * n] = this.heights[iz * n + ix];
      }
    }
    return out;
  }
}
