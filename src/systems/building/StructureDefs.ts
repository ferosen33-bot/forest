import * as THREE from 'three';
import { texturize } from '../../world/SurfaceTextures';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER } from '../../core/Physics';
import type { ItemCost } from '../../entities/items/ItemDefs';
import { jitter } from '../../world/VegetationGeometry';
import { mulberry32 } from '../../utils/random';

export type StructureId =
  | 'campfire'
  | 'wall'
  | 'shelter'
  | 'spikeTrap'
  | 'floor'
  | 'gate'
  | 'stairs'
  | 'chest'
  | 'snare'
  | 'fishTrap'
  | 'torchPost';

/** Offenes Feuer eines Bauwerks (Lagerfeuer, Standfackel). */
export interface FlameDef {
  /** Größe des Flammeneffekts. */
  size: number;
  /** Höhe der Flamme bzw. des Lichts über dem Ursprung (m). */
  height: number;
  lightHeight: number;
  intensity: number;
  distance: number;
  /** Wärmt (Kälte, Regeneration) und lässt sich zum Kochen nutzen. */
  warmth: boolean;
}

export interface StructureDef {
  id: StructureId;
  name: string;
  description: string;
  cost: ItemCost[];
  /** Halbe Ausdehnung des Platzbedarfs (lokal; Ursprung = Bodenmitte). */
  halfExtents: THREE.Vector3;
  /** Maximal erlaubter Höhenunterschied des Bodens unter der Grundfläche. */
  maxStep: number;
  maxHealth: number;
  /** Wände/Tore rasten an Wandenden und Bodenkanten ein, Böden an Nachbarböden. */
  snap?: 'wall' | 'floor' | 'stairs';
  /** Interaktion per `E`. */
  interaction?: 'fire' | 'light' | 'sleep' | 'door' | 'storage' | 'snare' | 'trap';
  /** Brennt nach dem Bauen (an/aus mit `E`, Regen löscht es). */
  flame?: FlameDef;
  /**
   * Steht im flachen Wasser (Fischreuse): Mindest- und Höchsttiefe an der Mitte (m). Der Ursprung
   * liegt `sink` m unter dem Wasserspiegel (aber nie unter dem Grund), damit der Korb herausragt.
   */
  inWater?: { minDepth: number; maxDepth: number; sink: number };
  /** Kein Hindernis für die Wegfindung (Böden, Treppen, Fallen am Boden). */
  walkable?: boolean;
  /** Lagerplätze (nur Kisten). */
  storageSlots?: number;
  /** Böden: Oberseite trägt andere Bauwerke und den Spieler (Ursprung = Oberkante der Dielen). */
  support?: boolean;
  /** Darf über flachem Wasser stehen (Stege). */
  overWater?: boolean;
  /** Tore: Index des Torflügel-Colliders in `colliders()`. */
  doorCollider?: number;
  /** Erzeugt das Modell (Ursprung = Mitte der Grundfläche auf Bodenhöhe, Vorderseite = +Z). */
  build(): THREE.Group;
  /** Collider in lokalen Koordinaten des Bauwerks. */
  colliders(): RAPIER.ColliderDesc[];
}

// ---------------------------------------------------------------------------
// Materialien & Bausteine
// ---------------------------------------------------------------------------

const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, flatShading: true });
const M = {
  bark: texturize(mat(0x4f3823), 'bark', 0.4),
  barkDark: texturize(mat(0x3e2c1b), 'bark', 0.4),
  cut: texturize(mat(0xb08a5a), 'planks', 0.3, 0.6),
  stone: texturize(mat(0x7d7a73), 'mossyRock', 0.5),
  ash: mat(0x2c2826),
  leaves: mat(0x3e5e2a),
  leavesDark: mat(0x2f4a22),
  rope: mat(0x7b6646),
};

const LOG_GEOMETRY = new THREE.CylinderGeometry(1, 1.06, 1, 8);
const STAKE_TIP = new THREE.ConeGeometry(1, 1, 8);
const STONE_GEOMETRY = jitter(new THREE.IcosahedronGeometry(1, 0), 0.22, 5);

/** Holzstamm von `a` nach `b` mit Radius `r` (Mantel Rinde, Enden Schnittholz). */
function log(a: THREE.Vector3, b: THREE.Vector3, r: number, material = M.bark): THREE.Mesh {
  const mesh = new THREE.Mesh(LOG_GEOMETRY, [material, M.cut, M.cut]);
  const dir = new THREE.Vector3().subVectors(b, a);
  mesh.scale.set(r, dir.length(), r);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/** Angespitzter Pfahl von `base` aus in Richtung `dir`. */
function stake(base: THREE.Vector3, dir: THREE.Vector3, length: number, r: number): THREE.Group {
  const g = new THREE.Group();
  const d = dir.clone().normalize();
  const shaftEnd = base.clone().addScaledVector(d, length - r * 3);
  g.add(log(base, shaftEnd, r));
  const tip = new THREE.Mesh(STAKE_TIP, M.cut);
  tip.scale.set(r, r * 3, r);
  tip.position.copy(shaftEnd).addScaledVector(d, r * 1.5);
  tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  g.add(tip);
  return g;
}

/**
 * Verschmilzt alle Teile eines Bauwerks zu EINEM Mesh pro Material.
 * Eine Wand besteht sonst aus ~12 Einzel-Meshes – mit Schattenpass wären das 24 Draw Calls.
 */
function finish(root: THREE.Group, name: string): THREE.Group {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const local = new THREE.Matrix4();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.clone().applyMatrix4(local.multiplyMatrices(inverse, mesh.matrixWorld));
    const flat = geo.index ? geo.toNonIndexed() : geo;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const vertexCount = flat.getAttribute('position').count;
    const groups = flat.groups.length ? flat.groups : [{ start: 0, count: vertexCount, materialIndex: 0 }];
    // Jede Materialgruppe (z. B. Rinde vs. Schnittfläche) landet im Topf ihres Materials.
    for (const group of groups) {
      const part = new THREE.BufferGeometry();
      for (const attr of ['position', 'normal']) {
        const src = flat.getAttribute(attr).array as Float32Array;
        part.setAttribute(attr, new THREE.BufferAttribute(src.slice(group.start * 3, (group.start + group.count) * 3), 3));
      }
      // Ein einzelnes Material gilt für alle Gruppen (BoxGeometry hat z. B. sechs).
      const material = Array.isArray(mesh.material) ? materials[group.materialIndex ?? 0] : mesh.material;
      let list = buckets.get(material);
      if (!list) buckets.set(material, (list = []));
      list.push(part);
    }
  });

  const out = new THREE.Group();
  out.name = name;
  for (const [material, parts] of buckets) {
    const merged = mergeGeometries(parts, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
    parts.forEach((p) => p.dispose());
  }
  return out;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Bauwerke
// ---------------------------------------------------------------------------

/** Breite eines Wandsegments – die Enden (±WALL_HALF_WIDTH) sind Einrastpunkte. */
export const WALL_HALF_WIDTH = 1.1;
const WALL_HEIGHT = 2.2;
/** Halbe Kantenlänge eines Bodenelements – passt genau zur Wandbreite. */
export const FLOOR_HALF = WALL_HALF_WIDTH;
const FLOOR_THICKNESS = 0.16;
/** Torflügel: Scharnier links (lokal x = -GATE_LEAF_HALF*2 + …), Öffnungswinkel. */
const GATE_POST_X = WALL_HALF_WIDTH - 0.12;
export const GATE_OPEN_ANGLE = Math.PI * 0.55;
/** Treppe: Länge (nach außen) und Höhenunterschied. */
const STAIRS_RUN = 1.7;
const STAIRS_RISE = 1.1;

/** Torflügel als eigenes (animiertes) Teil: Ursprung am Scharnier, Flügel reicht nach +X. */
function gateLeaf(): THREE.Group {
  const g = new THREE.Group();
  const width = GATE_POST_X * 2 - 0.12;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const x = 0.12 + (i * (width - 0.24)) / (n - 1);
    g.add(stake(v(x, 0.05, 0), v(0, 1, 0), WALL_HEIGHT - 0.25, 0.11));
  }
  g.add(log(v(0.02, 0.5, 0.12), v(width, 0.5, 0.12), 0.055, M.barkDark));
  g.add(log(v(0.02, 1.5, 0.12), v(width, 1.5, 0.12), 0.055, M.barkDark));
  // Diagonale Strebe
  g.add(log(v(0.1, 0.55, 0.15), v(width - 0.1, 1.45, 0.15), 0.045, M.barkDark));
  const leaf = finish(g, 'GateLeaf');
  leaf.name = 'leaf';
  return leaf;
}

export const STRUCTURES: Record<StructureId, StructureDef> = {
  campfire: {
    id: 'campfire',
    name: 'Lagerfeuer',
    description: 'Licht und Wärme. In der Nähe regenerieren sich Gesundheit und Ausdauer schneller.',
    cost: [
      { item: 'stick', count: 3 },
      { item: 'stone', count: 4 },
    ],
    halfExtents: v(0.6, 0.3, 0.6),
    maxStep: 0.5,
    maxHealth: 60,
    interaction: 'fire',
    flame: { size: 0.6, height: 0.04, lightHeight: 0.7, intensity: 38, distance: 26, warmth: true },
    build() {
      const g = new THREE.Group();
      const rng = mulberry32(3);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const s = new THREE.Mesh(STONE_GEOMETRY, M.stone);
        const r = 0.1 + rng() * 0.04;
        s.scale.set(r * 1.2, r * 0.8, r);
        s.position.set(Math.cos(a) * 0.48, r * 0.5, Math.sin(a) * 0.48);
        s.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        g.add(s);
      }
      const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.04, 10), M.ash);
      ash.position.y = 0.02;
      g.add(ash);
      // Tipi aus Ästen
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        g.add(log(v(Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3), v(Math.cos(a) * 0.04, 0.42, Math.sin(a) * 0.04), 0.03, M.barkDark));
      }
      return finish(g, 'Campfire');
    },
    colliders: () => [RAPIER.ColliderDesc.cylinder(0.15, 0.58).setTranslation(0, 0.15, 0)],
  },

  wall: {
    id: 'wall',
    name: 'Holzwand',
    description: 'Ein Palisadenstück aus Stämmen. Rastet an anderen Wänden ein.',
    cost: [{ item: 'log', count: 2 }],
    halfExtents: v(WALL_HALF_WIDTH, WALL_HEIGHT / 2, 0.22),
    maxStep: 1.0,
    maxHealth: 120,
    snap: 'wall',
    build() {
      const g = new THREE.Group();
      const n = 5;
      const rng = mulberry32(9);
      for (let i = 0; i < n; i++) {
        const x = -WALL_HALF_WIDTH + 0.22 + (i * (WALL_HALF_WIDTH * 2 - 0.44)) / (n - 1);
        const h = WALL_HEIGHT + (rng() - 0.5) * 0.25;
        // Stämme reichen etwas in den Boden, damit an Hängen keine Lücken entstehen.
        g.add(stake(v(x, -0.6, 0), v(0, 1, 0), h + 0.6, 0.2));
      }
      g.add(log(v(-WALL_HALF_WIDTH, 1.55, 0.2), v(WALL_HALF_WIDTH, 1.55, 0.2), 0.07, M.barkDark));
      g.add(log(v(-WALL_HALF_WIDTH, 0.55, 0.2), v(WALL_HALF_WIDTH, 0.55, 0.2), 0.07, M.barkDark));
      return finish(g, 'Wall');
    },
    colliders: () => [RAPIER.ColliderDesc.cuboid(WALL_HALF_WIDTH, WALL_HEIGHT / 2, 0.2).setTranslation(0, WALL_HEIGHT / 2, 0)],
  },

  shelter: {
    id: 'shelter',
    name: 'Unterstand',
    description: 'Ein schräges Blätterdach. Hier kannst du die Nacht durchschlafen – und hier wachst du nach dem Tod auf.',
    cost: [
      { item: 'log', count: 3 },
      { item: 'stick', count: 4 },
    ],
    halfExtents: v(1.35, 1.0, 1.15),
    maxStep: 0.8,
    maxHealth: 150,
    interaction: 'sleep',
    build() {
      const g = new THREE.Group();
      const front = 0.95;
      const back = -1.1;
      const top = 1.95;
      // Pfosten vorne, Firststange
      g.add(log(v(-1.2, -0.3, front), v(-1.2, top + 0.15, front), 0.09));
      g.add(log(v(1.2, -0.3, front), v(1.2, top + 0.15, front), 0.09));
      g.add(log(v(-1.4, top, front), v(1.4, top, front), 0.08, M.barkDark));
      // Dachstämme vom First schräg nach hinten auf den Boden
      for (let i = 0; i < 6; i++) {
        const x = -1.05 + i * 0.42;
        g.add(log(v(x, top + 0.05, front + 0.1), v(x, -0.05, back), 0.075));
      }
      // Blätter-Abdeckung als flache, leicht versetzte Platten
      const roofLen = Math.hypot(top, front - back);
      const angle = Math.atan2(top, front - back);
      for (let i = 0; i < 3; i++) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.06, roofLen / 3 + 0.15), i % 2 ? M.leaves : M.leavesDark);
        const t = (i + 0.5) / 3;
        plate.position.set(0, top * (1 - t) + 0.09, front + (back - front) * t);
        // Negativ um X: die lokale +Z-Achse (nach vorne) steigt zum First hin an.
        plate.rotation.x = -angle;
        g.add(plate);
      }
      return finish(g, 'Shelter');
    },
    colliders: () => {
      const front = 0.95;
      const back = -1.1;
      const top = 1.95;
      const roofLen = Math.hypot(top, front - back);
      const angle = Math.atan2(top, front - back);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -angle);
      return [
        RAPIER.ColliderDesc.cuboid(1.4, 0.06, roofLen / 2)
          .setTranslation(0, top / 2, (front + back) / 2)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        RAPIER.ColliderDesc.cylinder(1.1, 0.09).setTranslation(-1.2, 1.0, front),
        RAPIER.ColliderDesc.cylinder(1.1, 0.09).setTranslation(1.2, 1.0, front),
      ];
    },
  },

  spikeTrap: {
    id: 'spikeTrap',
    name: 'Stachelfalle',
    description: 'Nach außen gerichtete Pfähle. Versperrt Wege und wird Angreifern gefährlich.',
    cost: [
      { item: 'stick', count: 6 },
      { item: 'stone', count: 2 },
    ],
    halfExtents: v(0.8, 0.45, 0.8),
    maxStep: 0.6,
    maxHealth: 80,
    build() {
      const g = new THREE.Group();
      g.add(log(v(-0.75, 0.08, -0.7), v(0.75, 0.08, -0.7), 0.06, M.barkDark));
      g.add(log(v(-0.75, 0.08, 0.7), v(0.75, 0.08, 0.7), 0.06, M.barkDark));
      g.add(log(v(-0.7, 0.14, -0.75), v(-0.7, 0.14, 0.75), 0.06, M.barkDark));
      g.add(log(v(0.7, 0.14, -0.75), v(0.7, 0.14, 0.75), 0.06, M.barkDark));
      for (let ix = -1; ix <= 1; ix++) {
        for (let iz = -1; iz <= 1; iz++) {
          const base = v(ix * 0.5, 0, iz * 0.5);
          const dir = v(ix * 0.45, 1, iz * 0.45);
          g.add(stake(base, dir, 0.95, 0.045));
        }
      }
      return finish(g, 'SpikeTrap');
    },
    colliders: () => [RAPIER.ColliderDesc.cuboid(0.75, 0.4, 0.75).setTranslation(0, 0.4, 0)],
  },
  floor: {
    id: 'floor',
    name: 'Holzboden',
    description: 'Eine Plattform auf Pfählen. Gleicht Hänge aus, trägt Wände und Bauwerke – auch als Steg über flachem Wasser.',
    cost: [
      { item: 'log', count: 2 },
      { item: 'stick', count: 2 },
    ],
    halfExtents: v(FLOOR_HALF, FLOOR_THICKNESS / 2, FLOOR_HALF),
    maxStep: 1.2,
    maxHealth: 160,
    snap: 'floor',
    support: true,
    walkable: true,
    overWater: true,
    build() {
      const g = new THREE.Group();
      // Dielen aus halben Stämmen quer zur Z-Achse
      const n = 6;
      for (let i = 0; i < n; i++) {
        const z = -FLOOR_HALF + FLOOR_HALF / n + (i * 2 * FLOOR_HALF) / n;
        const plank = log(v(-FLOOR_HALF, -FLOOR_THICKNESS / 2, z), v(FLOOR_HALF, -FLOOR_THICKNESS / 2, z), FLOOR_HALF / n);
        plank.scale.x *= 0.98;
        plank.scale.z *= 0.45; // abgeflacht → ebene Lauffläche
        g.add(plank);
      }
      // Tragbalken und Pfähle (reichen tief genug in den Boden, um jede erlaubte Neigung abzudecken)
      for (const x of [-FLOOR_HALF + 0.15, FLOOR_HALF - 0.15]) {
        g.add(log(v(x, -FLOOR_THICKNESS - 0.08, -FLOOR_HALF), v(x, -FLOOR_THICKNESS - 0.08, FLOOR_HALF), 0.09, M.barkDark));
        for (const z of [-FLOOR_HALF + 0.15, FLOOR_HALF - 0.15]) g.add(log(v(x, -3.2, z), v(x, -FLOOR_THICKNESS, z), 0.1, M.barkDark));
      }
      return finish(g, 'Floor');
    },
    colliders: () => [RAPIER.ColliderDesc.cuboid(FLOOR_HALF, FLOOR_THICKNESS / 2, FLOOR_HALF).setTranslation(0, -FLOOR_THICKNESS / 2, 0)],
  },

  chest: {
    id: 'chest',
    name: 'Lagerkiste',
    description: 'Eine Kiste aus Brettern mit 16 Lagerplätzen. E öffnet sie; wird sie zerstört, fällt der Inhalt heraus.',
    cost: [
      { item: 'log', count: 2 },
      { item: 'stick', count: 2 },
    ],
    halfExtents: v(0.55, 0.32, 0.35),
    maxStep: 0.5,
    maxHealth: 100,
    interaction: 'storage',
    storageSlots: 16,
    build() {
      const g = new THREE.Group();
      // Wände aus liegenden, abgeflachten Stämmen
      for (const [z, len] of [[-0.3, 0.55], [0.3, 0.55]] as const) {
        for (let i = 0; i < 3; i++) {
          const b = log(v(-len, 0.08 + i * 0.16, z), v(len, 0.08 + i * 0.16, z), 0.08);
          b.scale.z *= 0.5;
          g.add(b);
        }
      }
      for (const x of [-0.5, 0.5]) {
        for (let i = 0; i < 3; i++) {
          const b = log(v(x, 0.08 + i * 0.16, -0.3), v(x, 0.08 + i * 0.16, 0.3), 0.08, M.barkDark);
          b.scale.x *= 0.5;
          g.add(b);
        }
      }
      // Deckel mit Querleisten
      for (let i = 0; i < 4; i++) {
        const z = -0.27 + i * 0.18;
        const plank = log(v(-0.56, 0.56, z), v(0.56, 0.56, z), 0.1);
        plank.scale.z *= 0.9;
        plank.scale.x *= 0.35;
        g.add(plank);
      }
      g.add(log(v(-0.35, 0.62, -0.33), v(-0.35, 0.62, 0.33), 0.03, M.rope));
      g.add(log(v(0.35, 0.62, -0.33), v(0.35, 0.62, 0.33), 0.03, M.rope));
      return finish(g, 'Chest');
    },
    colliders: () => [RAPIER.ColliderDesc.cuboid(0.56, 0.32, 0.36).setTranslation(0, 0.32, 0)],
  },

  snare: {
    id: 'snare',
    name: 'Schlingfalle',
    description: 'Eine Schlinge an einem gebogenen Ast. Lockt Hasen aus der Umgebung an; E spannt sie nach einem Fang neu.',
    cost: [{ item: 'stick', count: 3 }],
    halfExtents: v(0.35, 0.25, 0.35),
    maxStep: 0.6,
    maxHealth: 30,
    interaction: 'snare',
    walkable: true,
    build() {
      const g = new THREE.Group();
      g.add(stake(v(-0.25, -0.1, 0), v(0, 1, 0), 0.32, 0.025));
      g.add(stake(v(0.25, -0.1, 0), v(0, 1, 0), 0.32, 0.025));
      g.add(log(v(-0.27, 0.16, 0), v(0.27, 0.16, 0), 0.015, M.barkDark));
      const frame = finish(g, 'Snare');
      // Gebogener Ast mit Schlinge (eigenes Teil: schnellt beim Fang hoch)
      const s = new THREE.Group();
      s.add(log(v(0, 0, 0), v(0, 0.75, 0), 0.018, M.bark));
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 4, 12), M.rope);
      loop.position.set(0, 0.8, 0);
      s.add(loop);
      const spring = finish(s, 'SnareSpring');
      spring.name = 'spring';
      spring.position.set(0.5, 0, 0.12);
      frame.add(spring);
      return frame;
    },
    colliders: () => [RAPIER.ColliderDesc.cuboid(0.32, 0.2, 0.3).setTranslation(0, 0.2, 0).setSensor(true)],
  },

  fishTrap: {
    id: 'fishTrap',
    name: 'Fischreuse',
    description: 'Ein Korb aus Ästen für flaches Wasser. Fängt mit der Zeit von selbst Fische; E nimmt sie heraus.',
    cost: [{ item: 'stick', count: 6 }],
    halfExtents: v(0.45, 0.35, 0.65),
    maxStep: 0.9,
    maxHealth: 40,
    interaction: 'trap',
    walkable: true,
    inWater: { minDepth: 0.25, maxDepth: 1.3, sink: 0.42 },
    // Liegender Kegel entlang Z: Öffnung vorne (+Z), Spitze hinten, zwei Pflöcke bis zum Grund.
    build() {
      const g = new THREE.Group();
      const ribs = 12;
      const back = v(0, 0.3, -0.62);
      for (let i = 0; i < ribs; i++) {
        const a = (i / ribs) * Math.PI * 2;
        const front = v(Math.cos(a) * 0.32, 0.3 + Math.sin(a) * 0.28, 0.55);
        g.add(log(front, back, 0.013, i % 2 ? M.bark : M.cut));
      }
      // Geflochtene Reifen halten die Ruten zusammen.
      for (const [z, r] of [
        [0.52, 1],
        [0.18, 0.72],
        [-0.2, 0.42],
      ] as const) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 3, 14), M.rope);
        ring.scale.set(0.33 * r, 0.29 * r, 0.33);
        ring.position.set(0, 0.3, z);
        g.add(ring);
      }
      const knot = new THREE.Mesh(STONE_GEOMETRY, M.rope);
      knot.scale.setScalar(0.05);
      knot.position.copy(back);
      g.add(knot);
      for (const x of [-0.42, 0.42]) g.add(stake(v(x, -1.3, 0.1), v(0, 1, 0), 2.05, 0.025));
      return finish(g, 'FishTrap');
    },
    colliders: () => [RAPIER.ColliderDesc.cuboid(0.36, 0.3, 0.6).setTranslation(0, 0.3, 0).setSensor(true)],
  },

  torchPost: {
    id: 'torchPost',
    name: 'Standfackel',
    description: 'Ein Pfahl mit Fackelkopf. Leuchtet die Umgebung aus und hält Schrate nachts auf Abstand – wärmt aber nicht.',
    cost: [
      { item: 'stick', count: 4 },
      { item: 'stone', count: 2 },
    ],
    halfExtents: v(0.25, 0.9, 0.25),
    maxStep: 0.6,
    maxHealth: 40,
    interaction: 'light',
    flame: { size: 0.24, height: 1.66, lightHeight: 1.8, intensity: 16, distance: 18, warmth: false },
    build() {
      const g = new THREE.Group();
      const rng = mulberry32(11);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.3;
        const st = new THREE.Mesh(STONE_GEOMETRY, M.stone);
        const r = 0.08 + rng() * 0.03;
        st.scale.set(r * 1.2, r * 0.8, r);
        st.position.set(Math.cos(a) * 0.13, r * 0.4, Math.sin(a) * 0.13);
        st.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        g.add(st);
      }
      g.add(log(v(0, -0.1, 0), v(0, 1.58, 0), 0.03, M.bark));
      // Fackelkopf: umwickeltes Bündel, an der Spitze verkohlt.
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.16, 7), M.rope);
      head.position.y = 1.56;
      g.add(head);
      const char = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.04, 7), M.ash);
      char.position.y = 1.65;
      g.add(char);
      return finish(g, 'TorchPost');
    },
    colliders: () => [RAPIER.ColliderDesc.cylinder(0.85, 0.08).setTranslation(0, 0.85, 0)],
  },

  stairs: {
    id: 'stairs',
    name: 'Holztreppe',
    description: 'Stufen von einer Bodenkante hinab. Ohne sie kommt man auf hohe Plattformen nur springend.',
    cost: [
      { item: 'log', count: 1 },
      { item: 'stick', count: 3 },
    ],
    halfExtents: v(FLOOR_HALF * 0.8, STAIRS_RISE / 2, STAIRS_RUN / 2),
    maxStep: 10,
    maxHealth: 90,
    snap: 'stairs',
    walkable: true,
    // Ursprung = Mitte der oberen Kante auf Dielenhöhe; die Treppe führt nach +Z hinab.
    build() {
      const g = new THREE.Group();
      const w = FLOOR_HALF * 0.8;
      for (const x of [-w, w]) {
        g.add(log(v(x, -0.12, 0), v(x, -STAIRS_RISE - 0.12, STAIRS_RUN), 0.08, M.barkDark));
        g.add(log(v(x, -STAIRS_RISE - 0.12, STAIRS_RUN - 0.1), v(x, -STAIRS_RISE - 1.6, STAIRS_RUN - 0.1), 0.08, M.barkDark));
      }
      const steps = 4;
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const tread = log(v(-w - 0.08, -STAIRS_RISE * t, STAIRS_RUN * t), v(w + 0.08, -STAIRS_RISE * t, STAIRS_RUN * t), 0.13);
        tread.scale.z *= 0.45;
        g.add(tread);
      }
      return finish(g, 'Stairs');
    },
    colliders: () => {
      // Massiver Keil statt einzelner Stufen: glatt für den Character Controller. Die Schräge läuft
      // unter dem Gelände weiter, damit am unteren Ende keine Kante herausragt, an der man hängen bleibt.
      const w = FLOOR_HALF * 0.8;
      const depth = STAIRS_RISE + 0.6;
      const reach = (STAIRS_RUN * depth) / STAIRS_RISE;
      const points: number[] = [];
      for (const x of [-w, w]) points.push(x, 0, 0, x, -depth, reach, x, -depth, 0);
      return [RAPIER.ColliderDesc.convexHull(new Float32Array(points))!];
    },
  },

  gate: {
    id: 'gate',
    name: 'Holztor',
    description: 'Ein Wandstück mit Torflügel. E öffnet und schließt es – Schrate kommen nur durch, wenn es offen steht.',
    cost: [
      { item: 'log', count: 3 },
      { item: 'stick', count: 2 },
    ],
    halfExtents: v(WALL_HALF_WIDTH, WALL_HEIGHT / 2, 0.22),
    maxStep: 0.8,
    maxHealth: 140,
    snap: 'wall',
    interaction: 'door',
    doorCollider: 2,
    build() {
      const g = new THREE.Group();
      for (const x of [-WALL_HALF_WIDTH + 0.1, WALL_HALF_WIDTH - 0.1]) g.add(stake(v(x, -0.6, 0), v(0, 1, 0), WALL_HEIGHT + 0.85, 0.16));
      g.add(log(v(-WALL_HALF_WIDTH, WALL_HEIGHT + 0.05, 0), v(WALL_HALF_WIDTH, WALL_HEIGHT + 0.05, 0), 0.09, M.barkDark));
      const frame = finish(g, 'Gate');
      const leaf = gateLeaf();
      leaf.position.set(-GATE_POST_X + 0.06, 0, 0);
      frame.add(leaf);
      return frame;
    },
    colliders: () => [
      RAPIER.ColliderDesc.cylinder(WALL_HEIGHT / 2 + 0.1, 0.16).setTranslation(-WALL_HALF_WIDTH + 0.1, WALL_HEIGHT / 2, 0),
      RAPIER.ColliderDesc.cylinder(WALL_HEIGHT / 2 + 0.1, 0.16).setTranslation(WALL_HALF_WIDTH - 0.1, WALL_HEIGHT / 2, 0),
      // Torflügel (wird beim Öffnen zum Sensor: weiter anvisierbar, aber durchlässig)
      RAPIER.ColliderDesc.cuboid(GATE_POST_X - 0.12, WALL_HEIGHT / 2 - 0.1, 0.13).setTranslation(0, WALL_HEIGHT / 2, 0),
    ],
  },
};

export const getStructure = (id: StructureId): StructureDef => STRUCTURES[id];

/** Typwächter für Daten von außen (Spielstände). */
export const isStructureId = (id: string): id is StructureId => Object.prototype.hasOwnProperty.call(STRUCTURES, id);
