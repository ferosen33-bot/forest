import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { deriveSeed, mulberry32, randRange, type RandomFn } from '../utils/random';
import type { HeightMap } from './HeightMap';

/**
 * Prozedurale Höhlen – reine Geometrie-Logik ohne Grafik und Physik (getestet).
 *
 * Eine Höhle ist eine Kette aus Kammern (gestauchte Ellipsoide mit ebenem Boden) und
 * Tunneln (Kapseln), die als vorzeichenbehaftete Abstandsfunktion (SDF) weich vereinigt
 * und mit 3D-Rauschen zu Fels verformt werden. Negativ = Luft, positiv = Gestein.
 * Die Felshülle entsteht daraus per "Surface Nets" (eine Ecke pro Gitterzelle, ein Viereck
 * pro Kante mit Vorzeichenwechsel) – ohne Tabellen, mit geschlossener, wasserdichter Hülle.
 *
 * Lokales Koordinatensystem: Der Spieler betritt die Höhle bei (0, 0, 0) mit Blick nach +Z;
 * hinter ihm (−Z) liegt die helle Öffnung zum Ausgang.
 */

export interface Chamber {
  center: THREE.Vector3;
  radius: THREE.Vector3;
  /** Höhe des ebenen Bodens. */
  floor: number;
}

export interface Tunnel {
  a: THREE.Vector3;
  b: THREE.Vector3;
  radius: number;
}

export type CaveFeatureKind = 'flint' | 'mushroom' | 'crate' | 'stalactite' | 'stalagmite' | 'bones';

export interface CaveFeature {
  kind: CaveFeatureKind;
  /** Bodenpunkt (Tropfsteine an der Decke: Deckenpunkt). */
  position: THREE.Vector3;
  rotation: number;
  scale: number;
}

export interface CaveLayout {
  chambers: Chamber[];
  tunnels: Tunnel[];
  /** Nische am Eingang (gehört nicht zu den Kammern). */
  alcove: Chamber;
  /** Mitte der hellen Öffnung in der Rückwand der Nische. */
  exit: THREE.Vector3;
  features: CaveFeature[];
}

export interface CaveMesh {
  positions: Float32Array;
  indices: Uint32Array;
  /** Anzahl Dreiecke. */
  triangles: number;
  /** Abgetastete Abstandsfunktion (Gitterpunkte, x schnell, dann y, dann z) – Grundlage der Bodenkarte. */
  field: Float32Array;
  dims: [number, number, number];
  min: THREE.Vector3;
  h: number;
}

/** Begehbarer Boden je Säule des Gitters (lokale Koordinaten); NaN = kein Boden mit genug Kopffreiheit. */
export interface CaveFloor {
  min: THREE.Vector3;
  h: number;
  nx: number;
  nz: number;
  floor: Float32Array;
  /** Bodenhöhe an (x, z) (nächste Säule) oder NaN. */
  heightAt(x: number, z: number): number;
}

/**
 * Bodenkarte für die Wegfindung: In jeder senkrechten Gittersäule wird der höchste Luftraum mit
 * mindestens `headroom` m gesucht; sein Boden (Nulldurchgang, interpoliert) ist die Bodenhöhe.
 */
export function caveFloor(mesh: CaveMesh, headroom = 1.6): CaveFloor {
  const [nx, ny, nz] = mesh.dims;
  const { field, min, h } = mesh;
  const floor = new Float32Array(nx * nz).fill(NaN);
  const at = (i: number, j: number, k: number) => field[i + nx * (j + ny * k)];
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      let best = -1;
      let bestFloor = NaN;
      let j = 0;
      while (j < ny) {
        if (at(i, j, k) > 0) {
          j++;
          continue;
        }
        const start = j;
        while (j < ny && at(i, j, k) <= 0) j++;
        // Nulldurchgänge unten und oben interpolieren.
        const a0 = at(i, start - 1, k);
        const a1 = at(i, start, k);
        const bottom = min.y + (start - 1 + a0 / (a0 - a1)) * h;
        const b0 = at(i, j - 1, k);
        const b1 = j < ny ? at(i, j, k) : 1;
        const top = min.y + (j - 1 + b0 / (b0 - b1)) * h;
        if (top - bottom >= headroom && top - bottom > best) {
          best = top - bottom;
          bestFloor = bottom;
        }
      }
      floor[i + nx * k] = bestFloor;
    }
  }
  return {
    min,
    h,
    nx,
    nz,
    floor,
    heightAt(x, z) {
      const i = Math.round((x - min.x) / h);
      const k = Math.round((z - min.z) / h);
      if (i < 0 || k < 0 || i >= nx || k >= nz) return NaN;
      return floor[i + nx * k];
    },
  };
}

/** Gitterweite der Felshülle (m) – grob genug für Low-Poly-Fels, fein genug für Tunnel. */
export const CAVE_VOXEL = 0.7;

// ---------------------------------------------------------------------------
// Grundformen
// ---------------------------------------------------------------------------

/** Glatte Vereinigung zweier Abstände (weiche Übergänge Kammer ↔ Tunnel). */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

function ellipsoid(px: number, py: number, pz: number, c: Chamber): number {
  const r = c.radius;
  const qx = (px - c.center.x) / r.x;
  const qy = (py - c.center.y) / r.y;
  const qz = (pz - c.center.z) / r.z;
  const d = (Math.sqrt(qx * qx + qy * qy + qz * qz) - 1) * Math.min(r.x, r.y, r.z);
  // Unterhalb des Bodens ist Fels.
  return Math.max(d, c.floor - py);
}

function capsule(px: number, py: number, pz: number, t: Tunnel): number {
  const abx = t.b.x - t.a.x;
  const aby = t.b.y - t.a.y;
  const abz = t.b.z - t.a.z;
  const apx = px - t.a.x;
  const apy = py - t.a.y;
  const apz = pz - t.a.z;
  const u = THREE.MathUtils.clamp((apx * abx + apy * aby + apz * abz) / (abx * abx + aby * aby + abz * abz), 0, 1);
  const dx = apx - abx * u;
  const dy = apy - aby * u;
  const dz = apz - abz * u;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - t.radius;
  // Ebener Tunnelboden 60 % des Radius unter der Achse.
  const floor = t.a.y + aby * u - t.radius * 0.6;
  return Math.max(d, floor - py);
}

// ---------------------------------------------------------------------------
// Grundriss
// ---------------------------------------------------------------------------

/** Tunnelachse knapp über dem Boden einer Kammer (Tunnelboden = Kammerboden). */
function portal(c: Chamber, r: number): THREE.Vector3 {
  return new THREE.Vector3(c.center.x, c.floor + r * 0.6, c.center.z);
}

export function generateLayout(seed: number, index: number): CaveLayout {
  const rng = mulberry32(deriveSeed(seed, `cave-${index}`));
  const alcove: Chamber = {
    center: new THREE.Vector3(0, 1.2, -0.6),
    radius: new THREE.Vector3(2.8, 2.4, 2.8),
    floor: 0,
  };
  const chambers: Chamber[] = [];
  const tunnels: Tunnel[] = [];
  const count = 4 + Math.floor(rng() * 3);
  let heading = randRange(rng, -0.4, 0.4);

  for (let i = 0; i < count; i++) {
    // Meist geht es weiter vom letzten Raum aus, manchmal zweigt ein Gang früher ab.
    const from = i === 0 ? alcove : rng() < 0.3 && i > 1 ? chambers[Math.floor(rng() * (i - 1))] : chambers[i - 1];
    let placed: Chamber | null = null;
    for (let attempt = 0; attempt < 12 && !placed; attempt++) {
      const turn = heading + randRange(rng, -1.0, 1.0);
      const dist = i === 0 ? randRange(rng, 11, 14) : randRange(rng, 14, 21);
      const radius = new THREE.Vector3(randRange(rng, 5, 8.5), randRange(rng, 3.1, 4.4), randRange(rng, 5, 8.5));
      const floor = THREE.MathUtils.clamp(from.floor + randRange(rng, -2.2, 1.4), -9, 4);
      const center = new THREE.Vector3(
        from.center.x + Math.sin(turn) * dist,
        floor + radius.y * 0.55,
        from.center.z + Math.cos(turn) * dist,
      );
      const candidate: Chamber = { center, radius, floor };
      // Abstand zu allen Räumen, damit sie nicht zu einem einzigen Saal verschmelzen.
      const clear = [alcove, ...chambers].every(
        (o) => o === from || Math.hypot(o.center.x - center.x, o.center.z - center.z) > Math.max(o.radius.x, o.radius.z) + Math.max(radius.x, radius.z),
      );
      if (clear || attempt === 11) {
        placed = candidate;
        if (from === chambers[i - 1] || i === 0) heading = turn;
      }
    }
    const c = placed!;
    chambers.push(c);
    const r = randRange(rng, 1.9, 2.4);
    const a = portal(from, r);
    const b = portal(c, r);
    // Leicht geschwungener Gang: zwei Abschnitte über einen seitlich versetzten Mittelpunkt.
    const mid = a.clone().lerp(b, 0.5);
    const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(randRange(rng, -3, 3));
    mid.add(side);
    tunnels.push({ a, b: mid, radius: r }, { a: mid, b, radius: r });
  }

  const layout: CaveLayout = { chambers, tunnels, alcove, exit: new THREE.Vector3(0, 1.25, -2), features: [] };
  const sdf = createCaveSdf(seed, index, layout);
  // Die Öffnung sitzt direkt vor der Rückwand der Nische (dort, wo der Fels beginnt).
  for (let z = 0; z > -6; z -= 0.05) {
    if (sdf(0, 1.25, z) > 0) {
      layout.exit.z = z + 0.12;
      break;
    }
  }
  layout.features = placeFeatures(layout, rng, sdf);
  return layout;
}

// ---------------------------------------------------------------------------
// Abstandsfunktion
// ---------------------------------------------------------------------------

export type CaveSdf = (x: number, y: number, z: number) => number;

export function createCaveSdf(seed: number, index: number, layout: CaveLayout): CaveSdf {
  const noise = createNoise3D(mulberry32(deriveSeed(seed, `cave-noise-${index}`)));
  const { chambers, tunnels, alcove } = layout;
  return (x, y, z) => {
    let d = ellipsoid(x, y, z, alcove);
    let floor = alcove.floor;
    let best = d;
    for (const c of chambers) {
      const e = ellipsoid(x, y, z, c);
      if (e < best) {
        best = e;
        floor = c.floor;
      }
      d = smin(d, e, 1.6);
    }
    for (const t of tunnels) {
      const e = capsule(x, y, z, t);
      if (e < best) {
        best = e;
        floor = Math.min(t.a.y, t.b.y) - t.radius * 0.6;
      }
      d = smin(d, e, 1.6);
    }
    // Wände und Decke schroff, der Boden nur leicht uneben (begehbar).
    const rough = 0.12 + 0.6 * THREE.MathUtils.smoothstep(y - floor, 0.3, 1.8);
    const n = noise(x * 0.21, y * 0.27, z * 0.21) * 0.8 + noise(x * 0.7, y * 0.7, z * 0.7) * 0.25;
    return d + n * rough;
  };
}

// ---------------------------------------------------------------------------
// Ausstattung
// ---------------------------------------------------------------------------

/** Von (x, y, z) senkrecht nach unten (dir = −1) bzw. oben (+1) bis zum Fels. */
export function probe(sdf: CaveSdf, x: number, y: number, z: number, dir: 1 | -1, max = 12): number | null {
  if (sdf(x, y, z) > 0) return null;
  for (let s = 0; s < max; s += 0.08) {
    if (sdf(x, y + dir * s, z) > 0) return y + dir * s;
  }
  return null;
}

function placeFeatures(layout: CaveLayout, rng: RandomFn, sdf: CaveSdf): CaveFeature[] {
  const out: CaveFeature[] = [];
  const add = (kind: CaveFeatureKind, c: Chamber, spread: number, scale: number): boolean => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * spread;
      const x = c.center.x + Math.cos(a) * r * c.radius.x;
      const z = c.center.z + Math.sin(a) * r * c.radius.z;
      const y = probe(sdf, x, c.floor + 1.2, z, kind === 'stalactite' ? 1 : -1);
      if (y === null) continue;
      // Am Boden: nur auf ebenem Grund mit Kopffreiheit.
      if (kind !== 'stalactite' && (sdf(x, y + 2, z) > 0 || Math.abs(y - c.floor) > 0.8)) continue;
      out.push({ kind, position: new THREE.Vector3(x, y, z), rotation: rng() * Math.PI * 2, scale });
      return true;
    }
    return false;
  };

  layout.chambers.forEach((c, i) => {
    const last = i === layout.chambers.length - 1;
    for (let n = 0; n < 7 + Math.floor(rng() * 5); n++) add('stalactite', c, 0.8, randRange(rng, 0.6, 1.5));
    for (let n = 0; n < 2 + Math.floor(rng() * 3); n++) add('stalagmite', c, 0.75, randRange(rng, 0.5, 1.2));
    for (let n = 0; n < 1 + Math.floor(rng() * 2); n++) add('flint', c, 0.7, randRange(rng, 0.85, 1.15));
    for (let n = 0; n < 2 + Math.floor(rng() * 2); n++) add('mushroom', c, 0.7, randRange(rng, 0.8, 1.3));
    if (rng() < 0.35) add('bones', c, 0.5, 1);
    // Vorratskisten: immer im hintersten Raum, manchmal zusätzlich unterwegs.
    if (last || (i > 0 && rng() < 0.3)) add('crate', c, 0.45, 1);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Felshülle (Surface Nets)
// ---------------------------------------------------------------------------

/** Begrenzungsbox aller Räume und Gänge (mit Rand für die geschlossene Hülle). */
export function caveBounds(layout: CaveLayout): THREE.Box3 {
  const box = new THREE.Box3();
  for (const c of [layout.alcove, ...layout.chambers]) {
    box.expandByPoint(c.center.clone().sub(c.radius));
    box.expandByPoint(c.center.clone().add(c.radius));
  }
  for (const t of layout.tunnels) {
    const r = new THREE.Vector3(t.radius, t.radius, t.radius);
    box.expandByPoint(t.a.clone().sub(r)).expandByPoint(t.a.clone().add(r));
    box.expandByPoint(t.b.clone().sub(r)).expandByPoint(t.b.clone().add(r));
  }
  return box.expandByScalar(2.5);
}

export function buildCaveMesh(sdf: CaveSdf, bounds: THREE.Box3, h = CAVE_VOXEL): CaveMesh {
  const min = bounds.min;
  const size = bounds.getSize(new THREE.Vector3());
  const nx = Math.ceil(size.x / h) + 1;
  const ny = Math.ceil(size.y / h) + 1;
  const nz = Math.ceil(size.z / h) + 1;
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        // Der äußerste Gitterrand ist immer Fels → die Hülle bleibt geschlossen.
        const edge = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1;
        field[idx(i, j, k)] = edge ? 1 : sdf(min.x + i * h, min.y + j * h, min.z + k * h);
      }
    }
  }

  // 1. Ein Eckpunkt je Zelle mit Vorzeichenwechsel: Mittel der Kantenschnittpunkte.
  const cx = nx - 1;
  const cy = ny - 1;
  const cidx = (i: number, j: number, k: number) => i + cx * (j + cy * k);
  const cellVertex = new Int32Array(cx * cy * (nz - 1)).fill(-1);
  const positions: number[] = [];
  const corner = new Float32Array(8);
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7], // entlang x
    [0, 2], [1, 3], [4, 6], [5, 7], // entlang y
    [0, 4], [1, 5], [2, 6], [3, 7], // entlang z
  ];
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let solid = 0;
        for (let c = 0; c < 8; c++) {
          const v = field[idx(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          corner[c] = v;
          if (v > 0) solid++;
        }
        if (solid === 0 || solid === 8) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a];
          const vb = corner[b];
          if (va > 0 === vb > 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          n++;
        }
        cellVertex[cidx(i, j, k)] = positions.length / 3;
        positions.push(min.x + (i + sx / n) * h, min.y + (j + sy / n) * h, min.z + (k + sz / n) * h);
      }
    }
  }

  // 2. Ein Viereck je Gitterkante mit Vorzeichenwechsel; Vorderseite zeigt in die Luft.
  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, d, c, a, c, b);
    else indices.push(a, b, c, a, c, d);
  };
  const cell = (i: number, j: number, k: number) => cellVertex[cidx(i, j, k)];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const s0 = field[idx(i, j, k)] > 0;
        if (i < nx - 1 && j > 0 && k > 0 && j < ny - 1 && k < nz - 1 && s0 !== field[idx(i + 1, j, k)] > 0) {
          quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), !s0);
        }
        if (j < ny - 1 && i > 0 && k > 0 && i < nx - 1 && k < nz - 1 && s0 !== field[idx(i, j + 1, k)] > 0) {
          quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), !s0);
        }
        if (k < nz - 1 && i > 0 && j > 0 && i < nx - 1 && j < ny - 1 && s0 !== field[idx(i, j, k + 1)] > 0) {
          quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), !s0);
        }
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    triangles: indices.length / 3,
    field,
    dims: [nx, ny, nz],
    min: min.clone(),
    h,
  };
}

// ---------------------------------------------------------------------------
// Eingänge an der Oberfläche
// ---------------------------------------------------------------------------

export interface CaveSite {
  /** Bodenpunkt vor der Öffnung. */
  position: THREE.Vector3;
  /** Gierwinkel der Richtung in den Hang hinein (lokal +Z der Höhle). */
  into: number;
}

/**
 * Sucht Hänge für Höhleneingänge: deutlich geneigt, trocken, bergauf wirklich ansteigend,
 * weit genug weg vom Spawn, von `avoid` und voneinander.
 */
export function findCaveSites(
  hm: HeightMap,
  seed: number,
  count: number,
  avoid: { x: number; z: number; radius: number }[],
): CaveSite[] {
  const rng = mulberry32(deriveSeed(seed, 'cave-sites'));
  const sites: CaveSite[] = [];
  const n: [number, number, number] = [0, 1, 0];
  for (let attempt = 0; attempt < 20000 && sites.length < count; attempt++) {
    const x = (rng() - 0.5) * hm.size * 0.8;
    const z = (rng() - 0.5) * hm.size * 0.8;
    const h = hm.heightAt(x, z);
    if (h < hm.waterLevel + 5 || h > 50) continue;
    hm.normalAt(x, z, n);
    if (n[1] < 0.7 || n[1] > 0.9) continue;
    // Bergauf zeigt entgegen der waagerechten Normalen.
    const into = Math.atan2(-n[0], -n[2]);
    const ux = Math.sin(into);
    const uz = Math.cos(into);
    if (hm.heightAt(x + ux * 7, z + uz * 7) - h < 2.5) continue;
    // Vor dem Eingang ein paar Meter halbwegs begehbarer Grund.
    if (Math.abs(hm.heightAt(x - ux * 3, z - uz * 3) - h) > 2.2) continue;
    if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.radius)) continue;
    if (sites.some((s) => Math.hypot(s.position.x - x, s.position.z - z) < 160)) continue;
    sites.push({ position: new THREE.Vector3(x, h, z), into });
  }
  return sites;
}
