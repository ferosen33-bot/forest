import type { HeightMap } from './HeightMap';
import type { BiomeWeights } from './Biomes';
import { deriveSeed, mulberry32 } from '../utils/random';

/**
 * Das Wegenetz der Insel – reine Daten ohne Grafik (getestet): Landstraßen zwischen Altwasser und den
 * Dörfern, Schotterwege zu Höfen, Campingplatz, Sägewerk und den besonderen Orten. Die Wege suchen sich
 * per A* über ein grobes Raster einen Verlauf mit wenig Steigung, meiden Wasser, Sumpf und steile Hänge
 * und laufen, wo es geht, in vorhandene Wege ein (so entstehen Kreuzungen statt Parallelwege).
 * Danach werden sie geglättet, in 2-m-Schritten abgetastet und flach ins Gelände gelegt.
 */

export interface RoadNode {
  id: string;
  /** Knoten desselben Ortes (mehrere Zufahrten) werden nicht direkt verbunden. */
  group?: string;
  /** Angezeigter Name (Wegweiser). */
  name: string;
  x: number;
  z: number;
  /** Ortschaften bekommen Asphalt, Ziele in der Wildnis nur Schotter. */
  major: boolean;
}

export interface Road {
  /** Abtastpunkte im 2-m-Abstand (y = Fahrbahnhöhe). */
  points: { x: number; y: number; z: number }[];
  width: number;
  asphalt: boolean;
  /** Verbundene Knoten (Ids). */
  from: string;
  to: string;
}

export interface RoadJunction {
  x: number;
  z: number;
  /** Richtungen (Gierwinkel) und Ziele der abgehenden Wege. */
  arms: { yaw: number; target: string; distance: number }[];
}

export interface RoadNetwork {
  roads: Road[];
  junctions: RoadJunction[];
  /** Abstand zur nächsten Fahrbahnmitte (m), bis `max`. */
  distance(x: number, z: number, max?: number): number;
}

type Avoid = { x: number; z: number; radius: number };

const GRID = 8;
const SAMPLE = 2;

/** Grob abgetastete Höhe → Kosten je Rasterschritt. */
function buildCost(hm: HeightMap, avoid: Avoid[]): { n: number; cost: Float32Array } {
  const n = Math.floor(hm.size / GRID) + 1;
  const cost = new Float32Array(n * n);
  const b: BiomeWeights = { highland: 0, swamp: 0, cliffs: 0 };
  const nrm: [number, number, number] = [0, 1, 0];
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = ix * GRID - hm.half;
      const z = iz * GRID - hm.half;
      const h = hm.heightAt(x, z);
      let c = 1;
      if (h < hm.waterLevel + 0.8) c = Infinity;
      else {
        hm.normalAt(x, z, nrm);
        const slope = Math.sqrt(Math.max(0, 1 - nrm[1] * nrm[1])) / Math.max(0.2, nrm[1]);
        if (slope > 0.7) c = Infinity;
        else {
          // Steile Stücke nur, wenn es nicht anders geht (Serpentinen zum Labor, Hohlwege).
          c += slope * slope * 60 + (slope > 0.4 ? 40 : 0);
          hm.biomes.weights(x, z, b);
          c += b.swamp * 5 + b.highland * 1.5 + Math.max(0, h - 45) * 0.08;
          // Nah am Ufer ungern (Strand, Steilküste).
          if (h < hm.waterLevel + 2.5) c += 4;
        }
      }
      for (const a of avoid) if ((x - a.x) ** 2 + (z - a.z) ** 2 < a.radius * a.radius) c += 12;
      cost[iz * n + ix] = c;
    }
  }
  return { n, cost };
}

/** Binärer Heap für A*. */
class Heap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, key: number): void {
    const it = this.items;
    const ks = this.keys;
    it.push(item);
    ks.push(key);
    let i = it.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= ks[i]) break;
      [it[p], it[i]] = [it[i], it[p]];
      [ks[p], ks[i]] = [ks[i], ks[p]];
      i = p;
    }
  }
  pop(): number {
    const it = this.items;
    const ks = this.keys;
    const top = it[0];
    const lastI = it.pop()!;
    const lastK = ks.pop()!;
    if (it.length) {
      it[0] = lastI;
      ks[0] = lastK;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < it.length && ks[l] < ks[m]) m = l;
        if (r < it.length && ks[r] < ks[m]) m = r;
        if (m === i) break;
        [it[m], it[i]] = [it[i], it[m]];
        [ks[m], ks[i]] = [ks[i], ks[m]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

function astar(n: number, cost: Float32Array, road: Uint8Array, from: number, to: number): number[] | null {
  const g = new Float32Array(n * n).fill(Infinity);
  const prev = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  const heap = new Heap();
  const tx = to % n;
  const tz = Math.floor(to / n);
  // Heuristik mit dem günstigsten Faktor (vorhandene Wege kosten 0,35).
  const h = (i: number) => Math.hypot((i % n) - tx, Math.floor(i / n) - tz) * 0.35;
  g[from] = 0;
  heap.push(from, h(from));
  let expanded = 0;
  while (heap.size) {
    const i = heap.pop();
    if (closed[i]) continue;
    if (i === to) break;
    closed[i] = 1;
    if (++expanded > 200000) return null;
    const ix = i % n;
    const iz = Math.floor(i / n);
    for (const [dx, dz, len] of DIRS) {
      const jx = ix + dx;
      const jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
      const j = jz * n + jx;
      if (closed[j]) continue;
      const c = cost[j];
      if (c === Infinity) continue;
      const step = len * (road[j] ? 0.35 : c);
      const ng = g[i] + step;
      if (ng < g[j]) {
        g[j] = ng;
        prev[j] = i;
        heap.push(j, ng + h(j));
      }
    }
  }
  if (prev[to] < 0 && from !== to) return null;
  const path: number[] = [];
  for (let i = to; i >= 0; i = prev[i]) {
    path.push(i);
    if (i === from) break;
  }
  return path.reverse();
}

/** Chaikin-Glättung (Endpunkte bleiben). */
function chaikin(pts: { x: number; z: number }[], iterations: number): { x: number; z: number }[] {
  let p = pts;
  for (let k = 0; k < iterations; k++) {
    if (p.length < 3) return p;
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

function resample(pts: { x: number; z: number }[], step: number): { x: number; z: number }[] {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let t = step - carry;
    while (t <= len) {
      out.push({ x: a.x + ((b.x - a.x) * t) / len, z: a.z + ((b.z - a.z) * t) / len });
      t += step;
    }
    carry = len - (t - step);
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(out[out.length - 1].x - last.x, out[out.length - 1].z - last.z) > step * 0.3) out.push(last);
  return out;
}

/**
 * Erzeugt das Wegenetz und legt die Fahrbahnen ins Gelände (Höhenkarte wird verändert – vor Terrain und
 * Physik aufrufen).
 * @param avoid Ortskerne, durch die kein Weg führen soll (außer zu ihren Zufahrten).
 */
export function buildRoads(hm: HeightMap, seed: number, nodes: RoadNode[], avoid: Avoid[]): RoadNetwork {
  const rng = mulberry32(deriveSeed(seed, 'roads'));
  const { n, cost } = buildCost(hm, avoid);
  const cell = (x: number, z: number) =>
    Math.min(n - 1, Math.max(0, Math.round((z + hm.half) / GRID))) * n + Math.min(n - 1, Math.max(0, Math.round((x + hm.half) / GRID)));
  // Knoten liegen manchmal knapp im Wasser oder am Hang: auf die nächste gangbare Zelle setzen.
  const nodeCell = (nd: RoadNode) => {
    let best = cell(nd.x, nd.z);
    if (cost[best] !== Infinity) return best;
    let bestD = Infinity;
    const c0 = best;
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        const j = c0 + dz * n + dx;
        if (j < 0 || j >= n * n || cost[j] === Infinity) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
    }
    return best;
  };
  const cells = nodes.map(nodeCell);

  // Verbindungen: minimaler Spannbaum (Luftlinie) plus ein paar Querverbindungen für Rundwege.
  const pairs: [number, number, number][] = [];
  const sameGroup = (i: number, j: number) => !!nodes[i].group && nodes[i].group === nodes[j].group;
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) if (!sameGroup(i, j)) {
        // Landstraßen zwischen Ortschaften zuerst (sie bilden das Rückgrat, Schotterwege zweigen ab).
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
        pairs.push([i, j, nodes[i].major && nodes[j].major ? d * 0.3 : d]);
      }
  pairs.sort((a, b) => a[2] - b[2]);
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const edges: [number, number][] = [];
  const extra: [number, number][] = [];
  for (const [i, j, d] of pairs) {
    if (find(i) !== find(j)) {
      parent[find(i)] = find(j);
      edges.push([i, j]);
    } else if (extra.length < 3 && d < 700 && rng() < 0.5) extra.push([i, j]);
  }
  // Bauen: erst die Landstraßen, dann kurze vor langen Wegen (die langen münden in die kurzen).
  const len = (e: [number, number]) => Math.hypot(nodes[e[0]].x - nodes[e[1]].x, nodes[e[0]].z - nodes[e[1]].z);
  const isMajor = (e: [number, number]) => (nodes[e[0]].major && nodes[e[1]].major ? 0 : 1);
  const all = [...edges, ...extra].sort((a, b) => isMajor(a) - isMajor(b) || len(a) - len(b));

  const onRoad = new Uint8Array(n * n);
  const roads: Road[] = [];
  const connected = new Set<number>();
  const connect = (i: number, j: number): boolean => {
    const path = astar(n, cost, onRoad, cells[i], cells[j]);
    if (!path || path.length < 2) return false;
    connected.add(i);
    connected.add(j);
    // Nur der neue Teil wird gebaut: wo der Weg in einen vorhandenen einmündet, beginnt bzw. endet er.
    let a = 0;
    let b = path.length - 1;
    while (a < b && onRoad[path[a + 1]]) a++;
    while (b > a && onRoad[path[b - 1]]) b--;
    const part = path.slice(a, b + 1);
    if (part.length < 2) return true;
    for (const c of part) onRoad[c] = 1;
    const raw = part.map((c) => ({ x: (c % n) * GRID - hm.half, z: Math.floor(c / n) * GRID - hm.half }));
    // Echte Endpunkte (Zufahrt des Ortes) statt Rastermitte.
    if (a === 0) raw[0] = { x: nodes[i].x, z: nodes[i].z };
    if (b === path.length - 1) raw[raw.length - 1] = { x: nodes[j].x, z: nodes[j].z };
    const smooth = resample(chaikin(raw, 3), SAMPLE);
    const major = nodes[i].major && nodes[j].major;
    roads.push({
      points: smooth.map((p) => ({ x: p.x, y: hm.heightAt(p.x, p.z), z: p.z })),
      width: major ? 5.2 : 3.6,
      asphalt: major,
      from: a === 0 ? nodes[i].id : '',
      to: b === path.length - 1 ? nodes[j].id : '',
    });
    return true;
  };
  for (const [i, j] of all) connect(i, j);
  // Wer übrig blieb (Weg unmöglich, z. B. übers Wasser), versucht es bei den nächsten angebundenen Knoten.
  for (let i = 0; i < nodes.length; i++) {
    if (connected.has(i)) continue;
    const others = [...connected].filter((j) => !sameGroup(i, j)).sort((a, b) => Math.hypot(nodes[a].x - nodes[i].x, nodes[a].z - nodes[i].z) - Math.hypot(nodes[b].x - nodes[i].x, nodes[b].z - nodes[i].z));
    for (const j of others.slice(0, 4)) if (connect(i, j)) break;
  }

  // Längsprofil glätten und die Fahrbahn quer eben ins Gelände legen.
  for (const r of roads) {
    const ys = r.points.map((p) => p.y);
    for (let pass = 0; pass < 3; pass++) {
      const copy = ys.slice();
      for (let k = 1; k < ys.length - 1; k++) {
        let sum = 0;
        let cnt = 0;
        for (let m = -4; m <= 4; m++) {
          const q = copy[Math.min(ys.length - 1, Math.max(0, k + m))];
          sum += q;
          cnt++;
        }
        ys[k] = sum / cnt;
      }
    }
    r.points.forEach((p, k) => (p.y = ys[k]));
  }
  for (const r of roads) {
    for (let k = 0; k < r.points.length; k += 1) {
      const p = r.points[k];
      hm.flatten(p.x, p.z, r.width / 2 + 0.6, 2.6, p.y);
    }
  }
  for (const r of roads) for (const p of r.points) p.y = hm.heightAt(p.x, p.z);

  const network = createNetwork(roads);
  network.junctions.push(...findJunctions(roads, nodes));
  return network;
}

/** Räumliches Raster der Fahrbahn-Abschnitte für schnelle Abstandsabfragen. */
export function createNetwork(roads: Road[]): RoadNetwork {
  const BIN = 24;
  const bins = new Map<number, [number, number][]>();
  const key = (bx: number, bz: number) => bx * 100003 + bz;
  roads.forEach((r, ri) => {
    for (let k = 0; k < r.points.length - 1; k++) {
      const a = r.points[k];
      const b = r.points[k + 1];
      const bx0 = Math.floor((Math.min(a.x, b.x) - 6) / BIN);
      const bx1 = Math.floor((Math.max(a.x, b.x) + 6) / BIN);
      const bz0 = Math.floor((Math.min(a.z, b.z) - 6) / BIN);
      const bz1 = Math.floor((Math.max(a.z, b.z) + 6) / BIN);
      for (let bz = bz0; bz <= bz1; bz++)
        for (let bx = bx0; bx <= bx1; bx++) {
          let list = bins.get(key(bx, bz));
          if (!list) bins.set(key(bx, bz), (list = []));
          list.push([ri, k]);
        }
    }
  });
  return {
    roads,
    junctions: [],
    distance(x: number, z: number, max = 20): number {
      max = Math.min(max, 400);
      let best = max;
      const r0 = Math.ceil(max / BIN);
      const cx = Math.floor(x / BIN);
      const cz = Math.floor(z / BIN);
      for (let bz = cz - r0; bz <= cz + r0; bz++)
        for (let bx = cx - r0; bx <= cx + r0; bx++) {
          const list = bins.get(key(bx, bz));
          if (!list) continue;
          for (const [ri, k] of list) {
            const a = roads[ri].points[k];
            const b = roads[ri].points[k + 1];
            const abx = b.x - a.x;
            const abz = b.z - a.z;
            const l2 = abx * abx + abz * abz || 1;
            const u = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / l2));
            const d = Math.hypot(x - a.x - abx * u, z - a.z - abz * u);
            if (d < best) best = d;
          }
        }
      return best;
    },
  };
}

/** Kreuzungen: wo ein Weg in einen anderen mündet. Mit Zielen für die Wegweiser. */
function findJunctions(roads: Road[], nodes: RoadNode[]): RoadJunction[] {
  const out: RoadJunction[] = [];
  for (const r of roads) {
    for (const end of [0, r.points.length - 1]) {
      const id = end === 0 ? r.from : r.to;
      if (id) continue; // Endet an einem Ort, nicht an einem Weg.
      const p = r.points[end];
      if (out.some((j) => Math.hypot(j.x - p.x, j.z - p.z) < 30)) continue;
      // Ziele: der nächste Ort in Richtung jedes Arms (grob: nächstgelegene Orte nach Richtung).
      const arms: RoadJunction['arms'] = [];
      const byDistance = [...nodes].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      for (const nd of byDistance) {
        const d = Math.hypot(nd.x - p.x, nd.z - p.z);
        if (d < 60 || d > 1400) continue;
        const yaw = Math.atan2(nd.x - p.x, nd.z - p.z);
        if (arms.some((a) => Math.abs(Math.atan2(Math.sin(a.yaw - yaw), Math.cos(a.yaw - yaw))) < 0.6)) continue;
        arms.push({ yaw, target: nd.name, distance: d });
        if (arms.length >= 3) break;
      }
      if (arms.length) out.push({ x: p.x, z: p.z, arms });
    }
  }
  return out;
}
