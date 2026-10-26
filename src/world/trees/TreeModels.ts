import * as THREE from 'three';
import { generateTree, type TreeParams } from './TreeGenerator';

/**
 * Realistische Nahbäume: je Art zwei Varianten aus dem Baumgenerator, auf die Maße der bisherigen
 * Bäume gebracht (Höhe, Stammdicke – passend zu den Kollidern). Rinde und Blätter sind Fotos
 * (EZ-Tree-Texturen: Kiefer von TextureCan, Eiche von Poly Haven, beide CC0).
 *
 * Für Tausende Bäume sind die Parameter sparsam gewählt (≈ 4–5 Tsd. Dreiecke je Baum: weniger
 * Abschnitte, größere Blatt-Karten). In der Ferne zeigt die Vegetation weiterhin die einfachen Formen.
 */

export type TreeKind = 'pine' | 'broadleaf' | 'bush';

export interface TreeModel {
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
}

const PINE: TreeParams = {
  seed: 13977,
  type: 'evergreen',
  branch: {
    levels: 1,
    angle: [0, 110],
    children: [46],
    force: { direction: { x: 0, y: 1, z: 0 }, strength: -0.003 },
    gnarliness: [0.05, 0.08],
    length: [50, 23],
    radius: [1.7, 0.34],
    sections: [10, 5],
    segments: [7, 4],
    start: [0, 0.27],
    taper: [0.7, 0.7],
    twist: [0, 0],
  },
  leaves: { billboard: 'double', angle: 39, count: 12, start: 0.09, size: 2.8, sizeVariance: 0.25 },
};

const BROADLEAF: TreeParams = {
  seed: 35729,
  type: 'deciduous',
  branch: {
    levels: 3,
    angle: [0, 54, 58, 32],
    children: [5, 4, 3],
    force: { direction: { x: 0, y: 1, z: 0 }, strength: -0.01 },
    gnarliness: [0, -0.1, -0.15, 0.09],
    length: [37, 11, 12.4, 7.2],
    radius: [1.6, 0.9, 0.69, 1.19],
    sections: [8, 5, 3, 1],
    segments: [7, 4, 3, 3],
    start: [0, 0.49, 0.06, 0.12],
    taper: [0.73, 0.42, 0.69, 0.75],
    twist: [-0.23, 0.42, 0, 0],
  },
  leaves: { billboard: 'double', angle: 42, count: 7, start: 0.16, size: 4.0, sizeVariance: 0.6 },
};

const BUSH: TreeParams = {
  seed: 4242,
  type: 'deciduous',
  branch: {
    levels: 2,
    angle: [0, 20, 27],
    children: [9, 3, 2],
    force: { direction: { x: 0, y: 1, z: 0 }, strength: -0.02 },
    gnarliness: [0.02, 0.11, 0.05],
    length: [0.1, 19.6, 7.7],
    radius: [0.58, 0.95, 0.76],
    sections: [3, 3, 4],
    segments: [4, 4, 3],
    start: [0, 0.64, 0.7],
    taper: [0.7, 0.7, 0.7],
    twist: [0.36, -0.04, 0],
  },
  leaves: { billboard: 'double', angle: 55, count: 6, start: 0, size: 3.4, sizeVariance: 0.6 },
};

/** Zielhöhe (m bei Skalierung 1) – wie die bisherigen Bäume und Büsche. */
const HEIGHT: Record<TreeKind, number> = { pine: 10, broadleaf: 8.6, bush: 1.5 };
const PARAMS: Record<TreeKind, TreeParams> = { pine: PINE, broadleaf: BROADLEAF, bush: BUSH };

/** Vertexfarben: Rinde weiß, Blätter mit Grünüberschuss (daran erkennt der Jahreszeiten-Shader das Laub). */
function paint(g: THREE.BufferGeometry, r: number, gr: number, b: number): void {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([r, gr, b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

export function createTreeModel(kind: TreeKind, variant: number): TreeModel {
  const base = PARAMS[kind];
  const { branches, leaves } = generateTree({ ...base, seed: base.seed + variant * 7919 });
  branches.computeBoundingBox();
  leaves.computeBoundingBox();
  const box = branches.boundingBox!.clone().union(leaves.boundingBox!);
  const s = HEIGHT[kind] / Math.max(1, box.max.y - box.min.y);
  const m = new THREE.Matrix4().makeScale(s, s, s);
  branches.applyMatrix4(m);
  leaves.applyMatrix4(m);
  paint(branches, 1, 1, 1);
  paint(leaves, 0.86, 1, 0.82);
  branches.computeBoundingSphere();
  leaves.computeBoundingSphere();
  return { bark: branches, leaves };
}

/** Dreiecke eines Modells (für Tests und die Debug-Anzeige). */
export const triangleCount = (m: TreeModel): number => ((m.bark.index?.count ?? 0) + (m.leaves.index?.count ?? 0)) / 3;

const loader = new THREE.TextureLoader();
const base = () => `${import.meta.env.BASE_URL}textures/trees/`;

function tex(file: string, srgb: boolean, repeat?: [number, number]): THREE.Texture {
  // Ohne DOM (Unit-Tests der Spielsysteme) bleibt die Textur leer.
  const t = typeof document === 'undefined' ? new THREE.Texture() : loader.load(base() + file);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(...repeat);
  return t;
}

/** Rinde mit Foto-Textur und Normalen. */
export function createBarkMaterial(kind: TreeKind): THREE.MeshStandardMaterial {
  const name = kind === 'pine' ? 'pine' : 'oak';
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: tex(`${name}_bark_d.jpg`, true, [2, 1]),
    normalMap: tex(`${name}_bark_n.jpg`, false, [2, 1]),
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: 0.95,
  });
}

/**
 * Blatt-Karten: Fotos mit Alphakanal, beidseitig, mit Alpha-Test (auch im Schatten). Alpha-to-Coverage
 * glättet die Blattränder über die Mehrfachabtastung, statt sie hart auszuschneiden (kein Flimmern).
 */
export function createLeafMaterial(kind: TreeKind): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: tex(kind === 'pine' ? 'pine_leaves.png' : kind === 'bush' ? 'ash_leaves.png' : 'oak_leaves.png', true),
    alphaTest: 0.5,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.75,
  });
}
