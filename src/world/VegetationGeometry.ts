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
  berry: new THREE.Color(0x9a1b35),
  berryDark: new THREE.Color(0x4a1550),
  stick: new THREE.Color(0x6a4e33),
};

/**
 * Lage der Blätterbälle eines Busches – wird auch für die Beeren genutzt,
 * damit diese genau auf der Busch-Oberfläche sitzen.
 */
export const BUSH_BLOBS = [
  { x: 0, y: 0.45, z: 0, r: 0.75 },
  { x: 0.55, y: 0.35, z: 0.25, r: 0.55 },
  { x: -0.45, y: 0.32, z: -0.3, r: 0.5 },
];

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
export function jitter(geometry: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
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
  BUSH_BLOBS.forEach((b, i) => {
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

/**
 * Beeren-Trauben, die im Strauch hängen (gleiche Skalierung wie der Busch). Der realistische
 * Strauch ist vasenförmig (≈ 1,5 m hoch, oben breiter) – die Trauben sitzen am Rand seiner Krone.
 */
export function createBerryGeometry(): THREE.BufferGeometry {
  const rng = mulberry32(77);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const theta = rng() * Math.PI * 2;
    const y = 0.55 + rng() * 0.75;
    const r = (0.25 + (y - 0.4) * 0.55) * (0.75 + rng() * 0.3);
    const cx = Math.cos(theta) * r;
    const cz = Math.sin(theta) * r;
    // Je Traube zwei bis vier kleine, runde Beeren
    const n = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const berry = new THREE.IcosahedronGeometry(0.026 + rng() * 0.008, 1);
      berry.translate(cx + (rng() - 0.5) * 0.07, y - k * 0.035, cz + (rng() - 0.5) * 0.07);
      parts.push(paint(berry, (i + k) % 3 === 0 ? COLORS.berryDark : COLORS.berry));
    }
  }
  return merge(parts);
}

/** Herumliegender Ast (flach am Boden, Länge ≈ 0,9 m entlang X). */
export function createStickGeometry(): THREE.BufferGeometry {
  const main = new THREE.CylinderGeometry(0.022, 0.034, 0.9, 5);
  main.rotateZ(Math.PI / 2);
  main.translate(0, 0.03, 0);
  const twig = new THREE.CylinderGeometry(0.008, 0.014, 0.2, 4);
  twig.rotateZ(Math.PI / 2 - 0.7);
  twig.translate(0.12, 0.05, 0.05);
  return merge([paint(main, COLORS.stick), paint(twig, COLORS.stick)]);
}

/** Kleiner, aufsammelbarer Stein. */
export function createPebbleGeometry(): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(0.13, 0);
  jitter(ico, 0.03, 91);
  ico.scale(1.15, 0.7, 1);
  ico.translate(0, 0.05, 0);
  return merge([paint(ico, COLORS.rock)]);
}
