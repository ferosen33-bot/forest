import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNoise3D } from 'simplex-noise';
import { mulberry32 } from '../utils/random';

/**
 * Prozedurale Low-Poly-Geometrien für die Vegetation.
 * Jede Pflanzenart wird zu EINER Geometrie mit Vertex-Farben verschmolzen,
 * damit pro Chunk und Art nur ein einziger (instanzierter) Draw Call nötig ist.
 */

const COLORS = {
  bark: new THREE.Color(0x46321f),
  barkLight: new THREE.Color(0x6b5640),
  pine: new THREE.Color(0x24412a),
  pineTip: new THREE.Color(0x335a35),
  leaf: new THREE.Color(0x3d5f26),
  leafLight: new THREE.Color(0x58782f),
  bush: new THREE.Color(0x34522a),
  rock: new THREE.Color(0x7a776f),
};

/** Färbt eine Geometrie einheitlich ein und entfernt UVs (nicht benötigt, spart Speicher). */
function paint(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Verschiebt Vertices zufällig, um die perfekte Grundform aufzubrechen. */
function jitter(geometry: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const noise = createNoise3D(mulberry32(seed));
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Positionsbasiertes Rauschen: identische Positionen bekommen identische Offsets,
    // dadurch bleiben die Flächen geschlossen.
    pos.setXYZ(
      i,
      x + noise(x * 1.3, y * 1.3, z * 1.3) * amount,
      y + noise(y * 1.3 + 17, z * 1.3, x * 1.3) * amount,
      z + noise(z * 1.3, x * 1.3 + 31, y * 1.3) * amount,
    );
  }
  return geometry;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('Vegetation: Geometrien konnten nicht verschmolzen werden');
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  for (const p of parts) p.dispose();
  return merged;
}

/** Nadelbaum: schlanker Stamm + drei gestapelte Kegel. Höhe ≈ 9 m bei Skalierung 1. */
export function createPineGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.3, 4.5, 6, 1);
  trunk.translate(0, 2.25, 0);
  const parts = [paint(trunk, COLORS.bark)];

  const layers = [
    { r: 2.3, h: 3.6, y: 3.6 },
    { r: 1.8, h: 3.2, y: 5.3 },
    { r: 1.2, h: 2.8, y: 7.2 },
  ];
  layers.forEach((l, i) => {
    const cone = new THREE.ConeGeometry(l.r, l.h, 8, 1, false);
    cone.translate(0, l.y, 0);
    const color = COLORS.pine.clone().lerp(COLORS.pineTip, i / (layers.length - 1));
    parts.push(paint(jitter(cone.toNonIndexed(), 0.18, 11 + i), color));
  });
  return merge(parts);
}

/** Laubbaum: kräftigerer Stamm mit mehreren unregelmäßigen Blätterbällen. Höhe ≈ 8 m. */
export function createBroadleafGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.22, 0.36, 4.6, 7, 1);
  trunk.translate(0, 2.3, 0);
  const parts = [paint(trunk, COLORS.barkLight)];

  const blobs = [
    { x: 0, y: 5.6, z: 0, r: 2.3 },
    { x: 1.1, y: 4.9, z: 0.6, r: 1.6 },
    { x: -0.9, y: 5.0, z: -0.8, r: 1.7 },
    { x: 0.2, y: 6.8, z: -0.3, r: 1.5 },
  ];
  blobs.forEach((b, i) => {
    // Nur der Hauptball bekommt mehr Unterteilung; der Rest bleibt grob (spart ~50 % Dreiecke).
    const ico = new THREE.IcosahedronGeometry(b.r, i === 0 ? 1 : 0);
    jitter(ico, b.r * 0.18, 21 + i);
    ico.translate(b.x, b.y, b.z);
    parts.push(paint(ico, COLORS.leaf.clone().lerp(COLORS.leafLight, i / blobs.length)));
  });
  return merge(parts);
}

/** Busch: kleiner Cluster aus Blätterbällen. */
export function createBushGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blobs = [
    { x: 0, y: 0.45, z: 0, r: 0.75 },
    { x: 0.55, y: 0.35, z: 0.25, r: 0.55 },
    { x: -0.45, y: 0.32, z: -0.3, r: 0.5 },
  ];
  blobs.forEach((b, i) => {
    const ico = new THREE.IcosahedronGeometry(b.r, 0);
    jitter(ico, b.r * 0.2, 41 + i);
    ico.translate(b.x, b.y, b.z);
    parts.push(paint(ico, COLORS.bush));
  });
  return merge(parts);
}

/** Felsbrocken: verbeulter Ikosaeder mit Radius ≈ 1. */
export function createRockGeometry(): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, 1);
  jitter(ico, 0.28, 61);
  return merge([paint(ico, COLORS.rock)]);
}
