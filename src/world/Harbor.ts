import * as THREE from 'three';
import { deriveSeed, mulberry32 } from '../utils/random';
import type { HeightMap } from './HeightMap';
import { injectSeason } from './SeasonShader';
import { Builder, sign, type ColliderSpec } from './TownMeshes';

/**
 * Die Nordbucht: Leuchtturm, Steg, Bootshaus und das Lager der letzten Überlebenden.
 * Ortssystem: Ursprung = Lagerfeuer, +Z zeigt zum Meer.
 */

export interface HarborLayout {
  /** Lagerfeuer in Weltkoordinaten. */
  center: THREE.Vector3;
  /** Gierwinkel Richtung Meer. */
  rotation: number;
  /** Abstand vom Lager bis zur Uferlinie (m, entlang +Z). */
  shore: number;
  /** Länge des Stegs ab dem Ufer. */
  pier: number;
  lighthouse: { x: number; z: number };
}

export const HARBOR_FLAT_RADIUS = 13;
export const HARBOR_FLAT_BLEND = 9;

/**
 * Sucht im Norden der Insel einen ebenen Platz am Meer: trocken, mit Ufer in 10–25 m und tiefem
 * Wasser dahinter (für den Steg). Bevorzugt den nördlichsten Kandidaten.
 */
export function findHarborSite(
  hm: HeightMap,
  seed: number,
  avoid: { x: number; z: number; radius: number }[] = [],
): { x: number; z: number; y: number; rotation: number } | null {
  const rng = mulberry32(deriveSeed(seed, 'harbor'));
  let best: { x: number; z: number; y: number; rotation: number } | null = null;
  let bestScore = Infinity;
  for (let z = -hm.half * 0.8; z < -hm.half * 0.15; z += 8) {
    for (let x = -hm.half * 0.6; x <= hm.half * 0.6; x += 8) {
      const h = hm.heightAt(x, z);
      if (h < 2.5 || h > 9) continue;
      if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.radius)) continue;
      // Ebenheit im Lagerbereich
      let min = h;
      let max = h;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const s = hm.heightAt(x + Math.cos(a) * 10, z + Math.sin(a) * 10);
        min = Math.min(min, s);
        max = Math.max(max, s);
      }
      if (max - min > 3 || min < 1) continue;
      for (let k = 0; k < 16; k++) {
        const yaw = (k / 16) * Math.PI * 2;
        const dx = Math.sin(yaw);
        const dz = Math.cos(yaw);
        const near = hm.heightAt(x + dx * 12, z + dz * 12);
        const shore = hm.heightAt(x + dx * 24, z + dz * 24);
        const deep = hm.heightAt(x + dx * 45, z + dz * 45);
        if (near < 0.8 || shore > -0.5 || deep > -4) continue;
        // Nach Norden schauend (−Z) bevorzugt, etwas Zufall für Abwechslung.
        const score = z + Math.abs(yaw - Math.PI) * 10 + rng() * 6;
        if (score < bestScore) {
          bestScore = score;
          best = { x, z, y: h, rotation: yaw };
        }
      }
    }
  }
  return best;
}

/** Plan nach dem Einebnen: Uferlinie und Steglänge aus der Höhenkarte. */
export function generateHarbor(hm: HeightMap, site: { x: number; z: number; y: number; rotation: number }): HarborLayout {
  const dx = Math.sin(site.rotation);
  const dz = Math.cos(site.rotation);
  let shore = 10;
  for (let s = 6; s < 40; s += 0.5) {
    if (hm.heightAt(site.x + dx * s, site.z + dz * s) < hm.waterLevel + 0.3) {
      shore = s;
      break;
    }
  }
  return {
    center: new THREE.Vector3(site.x, site.y, site.z),
    rotation: site.rotation,
    shore,
    pier: 22,
    lighthouse: { x: -9, z: Math.min(shore - 4, 4) },
  };
}

/** Ortssystem → Welt. */
export function harborWorld(h: HarborLayout, x: number, z: number): { x: number; z: number } {
  const c = Math.cos(h.rotation);
  const s = Math.sin(h.rotation);
  return { x: c * x + s * z + h.center.x, z: -s * x + c * z + h.center.z };
}

/** Grasdichte: im Lager zertreten, unter Gebäuden keines. */
export function harborGrass(h: HarborLayout, x: number, z: number): number {
  const c = Math.cos(h.rotation);
  const s = Math.sin(h.rotation);
  const dx = x - h.center.x;
  const dz = z - h.center.z;
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  const r = Math.hypot(lx, lz);
  if (Math.hypot(lx - h.lighthouse.x, lz - h.lighthouse.z) < 4.5) return 0;
  if (Math.abs(lx - 9) < 4.5 && Math.abs(lz - 2) < 3.8) return 0;
  return r < 9 ? 0.25 : r < 16 ? 0.6 : 1;
}

export interface HarborModel {
  group: THREE.Group;
  colliders: ColliderSpec[];
  /** Lampe oben im Leuchtturm (Welt). */
  lamp: THREE.Vector3;
  /** Drehender Lichtkegel. */
  beam: THREE.Group;
  /** Weltpositionen der Lagerplätze der Überlebenden (Index = Reihenfolge der NPCs). */
  spots: { position: THREE.Vector3; yaw: number }[];
}

const C = {
  white: 0xd9d4c8,
  red: 0xa8352a,
  stone: 0x7a766e,
  glass: 0xe8d9a0,
  wood: 0x5c4733,
  plank: 0x7a6248,
  darkWood: 0x3f3124,
  tent: 0x5d6a52,
  canvas: 0x8a7b5c,
  crate: 0x6b5a3e,
  hull: 0x3e5566,
  hullRed: 0x8a2f26,
  rope: 0x9a8a62,
  iron: 0x55585a,
};

export function buildHarbor(h: HarborLayout): HarborModel {
  const origin = new THREE.Matrix4()
    .makeTranslation(h.center.x, h.center.y, h.center.z)
    .multiply(new THREE.Matrix4().makeRotationY(h.rotation));
  const b = new Builder(origin);
  const signs = new THREE.Group();

  // --- Leuchtturm: weiß-rot geringelt, Galerie, Laternenhaus ---
  const L = h.lighthouse;
  b.at(L.x, L.z, 0);
  const rings = 6;
  const towerH = 15;
  for (let i = 0; i < rings; i++) {
    const r0 = 2.6 - (i / rings) * 0.9;
    const r1 = 2.6 - ((i + 1) / rings) * 0.9;
    b.mesh(new THREE.CylinderGeometry(r1, r0, towerH / rings, 14), 0, (i + 0.5) * (towerH / rings), 0, i % 2 ? C.red : C.white, 'in');
  }
  b.box(3.6, towerH, 3.6, 0, towerH / 2, 0, { color: C.white, collide: true, nav: true, invisible: true });
  b.mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.25, 16), 0, towerH + 0.1, 0, C.iron, 'out');
  b.mesh(new THREE.CylinderGeometry(1.25, 1.25, 1.8, 10), 0, towerH + 1.15, 0, C.glass, 'in');
  b.mesh(new THREE.ConeGeometry(1.6, 1.2, 10), 0, towerH + 2.65, 0, C.red, 'out');
  b.box(1.0, 2.1, 0.2, 0, 1.05, 2.45, { color: C.darkWood });
  const lamp = new THREE.Vector3(L.x, towerH + 1.2, L.z).applyMatrix4(origin);

  // --- Lager: Zelte, Kisten, Tisch, Sitzstämme rund ums Feuer ---
  b.at(0, 0, 0);
  for (const [x, z, yaw] of [[-4.5, -4, 0.4], [4.2, -4.6, -0.3]] as const) {
    b.at(x, z, yaw);
    for (const s of [-1, 1]) b.box(0.05, 1.9, 2.8, s * 0.62, 0.8, 0, { color: C.tent, bucket: 'out', rz: s * -0.62 });
    b.box(1.9, 0.05, 2.8, 0, 0.03, 0, { color: C.canvas });
  }
  b.at(0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    b.box(1.6, 0.35, 0.4, Math.cos(a) * 2.4, 0.2, Math.sin(a) * 2.4, { color: C.wood, ry: -a + Math.PI / 2, collide: true, nav: true });
  }
  // Steinring der Feuerstelle
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.mesh(new THREE.IcosahedronGeometry(0.16, 0), Math.cos(a) * 0.6, 0.1, Math.sin(a) * 0.6, C.stone, 'out');
  }
  b.box(1.6, 0.06, 0.9, 5.2, 0.78, 1.8, { color: C.wood, collide: true });
  for (const [x, z] of [[-0.7, -0.4], [0.7, -0.4], [-0.7, 0.4], [0.7, 0.4]]) b.box(0.07, 0.76, 0.07, 5.2 + x, 0.38, 1.8 + z, { color: C.darkWood });
  for (const [x, z, s] of [[-6.5, 1.5, 1], [-6.2, 2.6, 0.8], [6.8, -1.4, 0.9]] as const) {
    b.box(0.8 * s, 0.6 * s, 0.6 * s, x, 0.3 * s, z, { color: C.crate, bucket: 'out', collide: true, nav: true, ry: x * 0.3 });
  }

  // --- Bootshaus aus Brettern ---
  b.at(9, 2, -Math.PI / 2);
  b.box(7, 0.12, 5, 0, 0.06, 0, { color: C.plank, collide: true });
  b.wall(0, 2.4, true, 7, 2.6, [{ at: 0, width: 2.2, y0: 0, y1: 2.2 }], C.wood);
  b.wall(0, -2.4, true, 7, 2.6, [{ at: 1.5, width: 1.0, y0: 1.0, y1: 1.8 }], C.wood);
  b.wall(-3.4, 0, false, 4.6, 2.6, [], C.wood);
  b.wall(3.4, 0, false, 4.6, 2.6, [], C.wood);
  for (const s of [-1, 1]) b.box(7.6, 0.12, 3.0, 0, 3.25, s * 1.35, { color: C.darkWood, bucket: 'out', rx: s * 0.52, collide: true });
  const s1 = sign('NORDBUCHT', 3.2, '#e8dfc4', '#2e3e4a');
  b.at(9, 2, -Math.PI / 2);
  s1.position.set(0, 2.55, 2.53).applyMatrix4(b.base);
  s1.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(b.base));
  signs.add(s1);

  // --- Steg ins tiefe Wasser, dahinter das alte Boot ---
  // Der Steg beginnt am Strand (die ersten Bohlen verschwinden im Sand).
  b.at(0, h.shore - 3, 0);
  const deck = 0.55; // über dem Wasserspiegel, relativ zur Lagerhöhe umgerechnet
  const y = deck - h.center.y;
  const len = h.pier + 2;
  b.box(2.6, 0.14, len, 0, y, len / 2, { color: C.plank, bucket: 'out', collide: true });
  for (let z = 1; z < len; z += 3) {
    for (const x of [-1.2, 1.2]) b.box(0.22, 4, 0.22, x, y - 2, z, { color: C.darkWood });
  }
  // Das Boot: Rumpf mit Schlagseite, ohne Motor
  const bz = len - 5;
  b.box(2.2, 0.9, 6.5, 3.2, deck - h.center.y - 0.35, bz, { color: C.hull, bucket: 'out', rz: 0.08, collide: true });
  b.box(2.25, 0.18, 6.55, 3.2, deck - h.center.y + 0.15, bz, { color: C.hullRed, rz: 0.08 });
  b.box(1.4, 0.9, 1.6, 3.2, deck - h.center.y + 0.5, bz - 0.8, { color: C.white, bucket: 'out', rz: 0.08 });
  b.mesh(new THREE.ConeGeometry(1.1, 1.6, 4), 3.2, deck - h.center.y - 0.35, bz + 3.9, C.hull, 'out', Math.PI / 2, Math.PI / 4, 0);
  b.box(0.06, 0.06, 2.4, 1.8, deck - h.center.y + 0.1, bz - 2, { color: C.rope, ry: 0.5 });

  const material = (snow: boolean) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    if (snow) m.onBeforeCompile = (shader) => injectSeason(shader, { snowBias: 0.1 });
    return m;
  };
  const group = b.finish({ in: material(false), out: material(true) });
  group.name = 'Harbor';
  group.add(signs);

  // Lichtkegel des Leuchtturms: zwei gegenläufige, additive Kegel, die sich nachts drehen.
  const beam = new THREE.Group();
  // Weicher Kegel: hell an der Lampe, zum Ende und zu den Rändern hin auslaufend (additiv, kein Nebel).
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xfff2c8) }, uStrength: { value: 0.2 } },
    vertexShader: /* glsl */ `
      varying float vT;
      varying vec3 vNormalView;
      varying vec3 vViewPos;
      void main() {
        vT = clamp(-position.y / 70.0, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        vNormalView = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying float vT;
      varying vec3 vNormalView;
      varying vec3 vViewPos;
      void main() {
        float facing = abs(dot(normalize(vNormalView), normalize(-vViewPos)));
        float a = pow(facing, 2.0) * pow(1.0 - vT, 1.8) * uStrength;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (const s of [-1, 1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(9, 70, 32, 1, true).translate(0, -35, 0), beamMat);
    cone.rotation.z = (s * Math.PI) / 2;
    beam.add(cone);
  }
  beam.position.copy(lamp);
  beam.visible = false;
  group.add(beam);

  const spots: HarborModel['spots'] = [];
  for (const [x, z] of [[-2.2, 1.6], [2.4, 1.2], [0.3, -2.6]] as const) {
    const p = new THREE.Vector3(x, 0, z).applyMatrix4(origin);
    const toFire = Math.atan2(h.center.x - p.x, h.center.z - p.z);
    spots.push({ position: p, yaw: toFire });
  }
  return { group, colliders: b.colliders, lamp, beam, spots };
}
