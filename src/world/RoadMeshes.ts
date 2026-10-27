import * as THREE from 'three';
import { injectSeason } from './SeasonShader';
import { surfaceLayer } from './SurfaceTextures';
import { injectBuildingSurface } from './TownMeshes';
import type { HeightMap } from './HeightMap';
import type { Road, RoadNetwork } from './Roads';
import { deriveSeed, mulberry32 } from '../utils/random';

/**
 * Fahrbahnen als Bänder knapp über dem (eingeebneten) Gelände: Landstraßen mit rissigem Asphalt,
 * Randlinien, gestrichelter Mitte und Schlaglöchern; Feldwege mit zwei Fahrspuren und dem Grasstreifen
 * dazwischen. Je Querstreifen eigene Farben (nicht indiziert), damit Striche und Flicken scharf bleiben.
 */

/** Querschnitt: [Versatz von der Mitte, Farbe] – von links nach rechts. */
type Profile = [number, number][];

const DIRT_EDGE = 0x4b4733;
const GRAVEL = 0x6e6450;
const RUT = 0x564a3b;
const MID_GRASS = 0x585a3a;
const ASPHALT = 0x45433f;
const PATCH = 0x34322f;
const REPAIR = 0x504d47;
const LINE = 0x9e9a8c;

function gravelProfile(h: number): Profile {
  return [
    [-h - 0.45, DIRT_EDGE],
    [-h, GRAVEL],
    [-1.15, GRAVEL],
    [-0.75, RUT],
    [-0.4, GRAVEL],
    [-0.2, MID_GRASS],
    [0.2, MID_GRASS],
    [0.4, GRAVEL],
    [0.75, RUT],
    [1.15, GRAVEL],
    [h, GRAVEL],
    [h + 0.45, DIRT_EDGE],
  ];
}

function asphaltProfile(h: number): Profile {
  return [
    [-h - 0.4, DIRT_EDGE],
    [-h, LINE],
    [-h + 0.14, ASPHALT],
    [-0.07, LINE],
    [0.07, ASPHALT],
    [h - 0.14, LINE],
    [h, DIRT_EDGE],
    [h + 0.4, DIRT_EDGE],
  ];
}

/** Farbe eines Querstreifens `i` (zwischen Profilpunkt i und i+1) im Abschnitt `k`. */
function stripColor(road: Road, prof: Profile, i: number, k: number, rng: () => number): number {
  const c = prof[i][1];
  if (!road.asphalt) {
    // Feldweg: der Grasstreifen fehlt mal, Spuren mal tiefer.
    if (c === MID_GRASS && rng() < 0.15) return GRAVEL;
    return c;
  }
  // Mittellinie gestrichelt (4 m Strich, 6 m Lücke), Randlinien verblasst und lückenhaft, der Rand bröckelt.
  if (i === 3) return k % 5 < 2 && rng() > 0.1 ? LINE : ASPHALT;
  if (c === LINE) return rng() < 0.3 ? (rng() < 0.5 ? DIRT_EDGE : ASPHALT) : LINE;
  if (c === ASPHALT) {
    const r = rng();
    if (r < 0.07) return PATCH;
    if (r < 0.12) return REPAIR;
  }
  return c;
}

export function buildRoadMeshes(net: RoadNetwork, hm: HeightMap, seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Roads';
  const rng = mulberry32(deriveSeed(seed, 'road-mesh'));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  material.onBeforeCompile = (shader) => {
    injectSeason(shader, { snowBias: 0.15 });
    injectBuildingSurface(shader);
  };
  material.customProgramCacheKey = () => 'roads';
  const color = new THREE.Color();
  const CHUNK = 60;

  for (const road of net.roads) {
    const pts = road.points;
    if (pts.length < 2) continue;
    const h = road.width / 2;
    const prof = road.asphalt ? asphaltProfile(h) : gravelProfile(h);
    const surf = road.asphalt ? surfaceLayer('asphalt') + 1 : surfaceLayer('mud') + 1;
    // Querrichtung je Abtastpunkt (gemittelt, damit Kurven nicht aufreißen).
    const side = pts.map((_, k) => {
      const a = pts[Math.max(0, k - 1)];
      const b = pts[Math.min(pts.length - 1, k + 1)];
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      return { x: Math.cos(yaw), z: -Math.sin(yaw) };
    });
    for (let start = 0; start < pts.length - 1; start += CHUNK) {
      const end = Math.min(pts.length - 1, start + CHUNK);
      const pos: number[] = [];
      const col: number[] = [];
      const srf: number[] = [];
      const vert = (k: number, off: number) => {
        const p = pts[k];
        const x = p.x + side[k].x * off;
        const z = p.z + side[k].z * off;
        // Mitte etwas über dem Gelände, Ränder darauf (das Bankett geht ins Gras über).
        const y = Math.max(hm.heightAt(x, z), p.y) + (Math.abs(off) > h ? 0.02 : 0.05);
        return [x, y, z];
      };
      for (let k = start; k < end; k++) {
        for (let i = 0; i < prof.length - 1; i++) {
          const a0 = vert(k, prof[i][0]);
          const a1 = vert(k, prof[i + 1][0]);
          const b0 = vert(k + 1, prof[i][0]);
          const b1 = vert(k + 1, prof[i + 1][0]);
          color.set(stripColor(road, prof, i, k, rng));
          // Etwas Helligkeitsrauschen gegen Kachel-Look.
          const f = 0.92 + rng() * 0.14;
          for (const v of [a0, b0, a1, a1, b0, b1]) {
            pos.push(v[0], v[1], v[2]);
            col.push(color.r * f, color.g * f, color.b * f);
            srf.push(surf);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('surf', new THREE.Float32BufferAttribute(srf, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, material);
      mesh.receiveShadow = true;
      mesh.name = 'Road';
      group.add(mesh);
    }
  }
  return group;
}
