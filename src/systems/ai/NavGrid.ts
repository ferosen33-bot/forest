import type { HeightMap } from '../../world/HeightMap';

export interface NavPoint {
  x: number;
  z: number;
}

/** Binärer Min-Heap über Zellindizes, sortiert nach f-Wert (allokationsfrei wiederverwendbar). */
class IndexHeap {
  private items: number[] = [];
  constructor(private readonly score: Float32Array) {}

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }

  push(i: number): void {
    const a = this.items;
    a.push(i);
    let n = a.length - 1;
    const item = a[n];
    const f = this.score[item];
    // Hochsieben ohne Tausch-Allokationen.
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.score[a[p]] <= f) break;
      a[n] = a[p];
      n = p;
    }
    a[n] = item;
  }

  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      const f = this.score[last];
      const len = a.length;
      let n = 0;
      for (;;) {
        const l = n * 2 + 1;
        if (l >= len) break;
        const r = l + 1;
        const m = r < len && this.score[a[r]] < this.score[a[l]] ? r : l;
        if (this.score[a[m]] >= f) break;
        a[n] = a[m];
        n = m;
      }
      a[n] = last;
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;
const NEIGHBORS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/**
 * Navigationsraster für die Gegner-KI.
 *
 * Eine Zelle ist begehbar, wenn sie trocken, nicht zu steil und frei von Hindernissen
 * (Baumstämme, Felsen, Bauwerke) ist. Hindernisse können zur Laufzeit gesetzt und
 * entfernt werden (Baum gefällt, Wand gebaut/abgerissen).
 *
 * Pfadsuche: A* mit 8er-Nachbarschaft (keine Ecken-Abkürzungen durch Hindernisse),
 * begrenztem Suchbudget und anschließender Glättung per Sichtlinie.
 */
export class NavGrid {
  readonly cellSize: number;
  readonly size: number;
  readonly half: number;
  /** Zellen pro Kante. */
  readonly cells: number;
  /** 0 = frei, 1 = Gelände unbegehbar (Wasser/Steilhang). Statisch. */
  private readonly terrainBlocked: Uint8Array;
  /** Anzahl der Hindernisse in der Zelle (Bäume, Bauwerke …) – Zähler erlauben Überlappungen. */
  private readonly obstacles: Uint16Array;
  /** Zähler offener Durchgänge (überstimmen Hindernisse). */
  private readonly passages: Uint16Array;

  // A*-Arbeitsspeicher (einmal angelegt, per Generationszähler "geleert").
  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly parent: Int32Array;
  private readonly visited: Uint32Array;
  private readonly closed: Uint32Array;
  private generation = 0;
  private readonly heap: IndexHeap;

  constructor(heightMap: HeightMap, opts: { cellSize?: number; maxStep?: number; minHeight?: number } = {}) {
    this.cellSize = opts.cellSize ?? 2;
    this.size = heightMap.size;
    this.half = heightMap.half;
    this.cells = Math.round(this.size / this.cellSize);
    const n = this.cells * this.cells;
    this.terrainBlocked = new Uint8Array(n);
    this.obstacles = new Uint16Array(n);
    this.passages = new Uint16Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.visited = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new IndexHeap(this.f);

    const maxStep = opts.maxStep ?? 1.3;
    const minHeight = opts.minHeight ?? heightMap.waterLevel + 0.25;
    for (let cz = 0; cz < this.cells; cz++) {
      for (let cx = 0; cx < this.cells; cx++) {
        const { x, z } = this.cellCenter(cx, cz);
        const h = heightMap.heightAt(x, z);
        const e = this.cellSize / 2;
        const slope = Math.max(
          Math.abs(heightMap.heightAt(x + e, z) - heightMap.heightAt(x - e, z)),
          Math.abs(heightMap.heightAt(x, z + e) - heightMap.heightAt(x, z - e)),
        );
        if (h < minHeight || slope > maxStep) this.terrainBlocked[cz * this.cells + cx] = 1;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Koordinaten
  // ---------------------------------------------------------------------------

  cellOf(x: number, z: number): number {
    const cx = Math.floor((x + this.half) / this.cellSize);
    const cz = Math.floor((z + this.half) / this.cellSize);
    if (cx < 0 || cz < 0 || cx >= this.cells || cz >= this.cells) return -1;
    return cz * this.cells + cx;
  }

  cellCenter(cx: number, cz: number): NavPoint {
    return { x: (cx + 0.5) * this.cellSize - this.half, z: (cz + 0.5) * this.cellSize - this.half };
  }

  private centerOf(index: number): NavPoint {
    return this.cellCenter(index % this.cells, Math.floor(index / this.cells));
  }

  isWalkableCell(index: number): boolean {
    return index >= 0 && this.terrainBlocked[index] === 0 && (this.obstacles[index] === 0 || this.passages[index] > 0);
  }

  isWalkable(x: number, z: number): boolean {
    return this.isWalkableCell(this.cellOf(x, z));
  }

  // ---------------------------------------------------------------------------
  // Dynamische Hindernisse
  // ---------------------------------------------------------------------------

  /** Markiert (delta = +1) bzw. entfernt (delta = −1) ein kreisförmiges Hindernis. */
  markCircle(x: number, z: number, radius: number, delta: 1 | -1): void {
    const r = Math.max(radius, this.cellSize * 0.25);
    this.forCellsInRect(x - r, z - r, x + r, z + r, (i, c) => {
      // Zelle betroffen, wenn ihr nächster Punkt zum Kreismittelpunkt innerhalb des Radius liegt.
      const e = this.cellSize / 2;
      const dx = Math.max(Math.abs(c.x - x) - e, 0);
      const dz = Math.max(Math.abs(c.z - z) - e, 0);
      if (dx * dx + dz * dz <= r * r) this.obstacles[i] = Math.max(0, this.obstacles[i] + delta);
    });
  }

  /** Markiert ein gedrehtes Rechteck (Grundfläche eines Bauwerks). */
  markBox(x: number, z: number, rotation: number, halfX: number, halfZ: number, delta: 1 | -1): void {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const ext = Math.hypot(halfX, halfZ);
    const e = this.cellSize * 0.5;
    this.forCellsInRect(x - ext, z - ext, x + ext, z + ext, (i, c) => {
      // In lokale Koordinaten des Rechtecks drehen (Inverse der Y-Rotation).
      const dx = c.x - x;
      const dz = c.z - z;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (Math.abs(lx) <= halfX + e * 0.7 && Math.abs(lz) <= halfZ + e * 0.7) {
        this.obstacles[i] = Math.max(0, this.obstacles[i] + delta);
      }
    });
  }

  /**
   * Durchgang (offenes Tor): Zellen in der Öffnung gelten als begehbar, auch wenn der Sicherheitsrand
   * benachbarter Wände sie überdeckt. Bei 2-m-Zellen läge sonst oft kein Zellmittelpunkt frei.
   */
  markPassage(x: number, z: number, rotation: number, halfX: number, halfZ: number, delta: 1 | -1): void {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const ext = Math.hypot(halfX, halfZ) + this.cellSize;
    const e = this.cellSize * 0.5;
    this.forCellsInRect(x - ext, z - ext, x + ext, z + ext, (i, c) => {
      const dx = c.x - x;
      const dz = c.z - z;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      // Quer zur Öffnung je eine Zellreihe innen und außen (verbindet beide Seiten sicher),
      // längs nur knapp über die Öffnung hinaus.
      if (Math.abs(lx) <= halfX + e * 0.3 && Math.abs(lz) <= halfZ + e * 1.05) {
        this.passages[i] = Math.max(0, this.passages[i] + delta);
      }
    });
  }

  private forCellsInRect(x0: number, z0: number, x1: number, z1: number, fn: (i: number, c: NavPoint) => void): void {
    const cx0 = Math.max(0, Math.floor((x0 + this.half) / this.cellSize));
    const cz0 = Math.max(0, Math.floor((z0 + this.half) / this.cellSize));
    const cx1 = Math.min(this.cells - 1, Math.floor((x1 + this.half) / this.cellSize));
    const cz1 = Math.min(this.cells - 1, Math.floor((z1 + this.half) / this.cellSize));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) fn(cz * this.cells + cx, this.cellCenter(cx, cz));
    }
  }

  // ---------------------------------------------------------------------------
  // Suche
  // ---------------------------------------------------------------------------

  /** Nächste begehbare Zelle (Ringsuche), z. B. wenn das Ziel neben einem Baum steht. */
  nearestWalkable(x: number, z: number, maxRadius = 6): NavPoint | null {
    const start = this.cellOf(x, z);
    if (this.isWalkableCell(start)) return this.centerOf(start);
    if (start < 0) return null;
    const sx = start % this.cells;
    const sz = Math.floor(start / this.cells);
    for (let r = 1; r <= maxRadius; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = sx + dx;
          const cz = sz + dz;
          if (cx < 0 || cz < 0 || cx >= this.cells || cz >= this.cells) continue;
          const i = cz * this.cells + cx;
          const d = dx * dx + dz * dz;
          if (d < bestD && this.isWalkableCell(i)) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best >= 0) return this.centerOf(best);
    }
    return null;
  }

  /**
   * A*-Pfad von `from` nach `to` (Weltkoordinaten).
   * @param maxExpansions Suchbudget – begrenzt die Kosten pro Anfrage.
   * @returns geglättete Wegpunkte (ohne Startpunkt) oder null, wenn kein Weg gefunden wurde.
   */
  findPath(from: NavPoint, to: NavPoint, maxExpansions = 6000): NavPoint[] | null {
    const startP = this.nearestWalkable(from.x, from.z, 3);
    const goalP = this.nearestWalkable(to.x, to.z, 4);
    if (!startP || !goalP) return null;
    const start = this.cellOf(startP.x, startP.z);
    const goal = this.cellOf(goalP.x, goalP.z);
    if (start === goal) return [{ x: to.x, z: to.z }];

    const gen = ++this.generation;
    const n = this.cells;
    const gx = goal % n;
    const gz = Math.floor(goal / n);
    const heuristic = (i: number) => {
      const dx = Math.abs((i % n) - gx);
      const dz = Math.abs(Math.floor(i / n) - gz);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };

    this.heap.clear();
    this.g[start] = 0;
    this.f[start] = heuristic(start);
    this.parent[start] = -1;
    this.visited[start] = gen;
    this.heap.push(start);

    let expansions = 0;
    let found = false;
    while (this.heap.size > 0 && expansions < maxExpansions) {
      const cur = this.heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) {
        found = true;
        break;
      }
      expansions++;
      const cx = cur % n;
      const cz = Math.floor(cur / n);
      for (let k = 0; k < 8; k++) {
        const nb = NEIGHBORS[k];
        const dx = nb[0];
        const dz = nb[1];
        const cost = nb[2];
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const ni = nz * n + nx;
        if (!this.isWalkableCell(ni) || this.closed[ni] === gen) continue;
        // Diagonal nur, wenn beide angrenzenden Zellen frei sind (keine Ecken schneiden).
        if (dx !== 0 && dz !== 0 && (!this.isWalkableCell(cz * n + nx) || !this.isWalkableCell(nz * n + cx))) continue;
        const ng = this.g[cur] + cost;
        if (this.visited[ni] === gen && ng >= this.g[ni]) continue;
        this.visited[ni] = gen;
        this.g[ni] = ng;
        this.f[ni] = ng + heuristic(ni);
        this.parent[ni] = cur;
        this.heap.push(ni);
      }
    }
    if (!found) return null;

    const cells: number[] = [];
    for (let i = goal; i !== -1; i = this.parent[i]) cells.push(i);
    cells.reverse();
    const points = this.smooth(cells);
    // Letzten Wegpunkt exakt aufs Ziel setzen, falls dieses selbst begehbar ist.
    if (this.isWalkable(to.x, to.z)) points[points.length - 1] = { x: to.x, z: to.z };
    return points;
  }

  /** Entfernt Zwischenpunkte, solange eine freie Sichtlinie über das Raster besteht. */
  private smooth(cells: number[]): NavPoint[] {
    const out: NavPoint[] = [];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) {
      if (!this.lineWalkable(this.centerOf(cells[anchor]), this.centerOf(cells[i]))) {
        out.push(this.centerOf(cells[i - 1]));
        anchor = i - 1;
      }
    }
    out.push(this.centerOf(cells[cells.length - 1]));
    return out;
  }

  /** Sind alle Zellen entlang der Strecke begehbar? (Abtastung im Viertel-Zellraster) */
  lineWalkable(a: NavPoint, b: NavPoint): boolean {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(dist / (this.cellSize * 0.25)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (!this.isWalkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }
}
