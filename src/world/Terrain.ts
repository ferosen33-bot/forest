import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import type { HeightMap } from './HeightMap';
import { deriveSeed, mulberry32 } from '../utils/random';
import { smoothstep } from '../utils/math';
import { injectSeason } from './SeasonShader';

/** Farbpalette des Bodens (sRGB-Hex, wird automatisch in Linear umgerechnet). */
const PALETTE = {
  seabedDeep: new THREE.Color(0x2c3b33),
  seabed: new THREE.Color(0x857653),
  wetSand: new THREE.Color(0x9a8858),
  sand: new THREE.Color(0xc9b37e),
  grassLight: new THREE.Color(0x5b7431),
  grassDark: new THREE.Color(0x2f4520),
  dirt: new THREE.Color(0x54452f),
  rock: new THREE.Color(0x6c6962),
  rockDark: new THREE.Color(0x48453f),
};

const tmpColor = new THREE.Color();

/** Detailstufen: Schrittweite in Höhen-Samples und ab welcher Entfernung (m) sie gilt. */
export const TERRAIN_LODS = [
  { step: 1, from: 0 },
  { step: 2, from: 160 },
  { step: 4, from: 320 },
  { step: 8, from: 560 },
] as const;
/** Puffer gegen ständiges Hin- und Herschalten an der Grenze (m). */
const LOD_HYSTERESIS = 12;

interface Chunk {
  /** Mittelpunkt (x/z) für die Entfernungsberechnung. */
  cx: number;
  cz: number;
  half: number;
  levels: THREE.Mesh[];
  level: number;
}

/**
 * Render-Repräsentation des Terrains: die Höhenkarte wird in quadratische Chunks
 * zerlegt, damit Three.js (Kamera- und Schatten-Frustum) unsichtbare Teile verwirft.
 * Normalen kommen direkt aus der Höhenkarte → keine sichtbaren Nähte an Chunk-Grenzen.
 *
 * Level of Detail: Jeder Chunk existiert in mehreren Auflösungen (jedes 1./2./4./8. Sample).
 * Nah am Spieler wird immer die volle Auflösung gezeigt – sie entspricht exakt der Kollision.
 * Gegen Risse zwischen Nachbarn unterschiedlicher Stufe hängt an jedem Chunk-Rand eine
 * senkrechte "Schürze" nach unten, die eventuelle Spalten verdeckt.
 */
export class Terrain {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  readonly chunksPerSide: number;
  private readonly chunks: Chunk[] = [];

  private readonly colorNoise;
  private readonly patchNoise;

  constructor(
    readonly heightMap: HeightMap,
    readonly chunkSize: number,
    seed: number,
  ) {
    this.group.name = 'Terrain';
    this.colorNoise = createNoise2D(mulberry32(deriveSeed(seed, 'terrain-color')));
    this.patchNoise = createNoise2D(mulberry32(deriveSeed(seed, 'terrain-patch')));

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
    });
    // Winter: Schnee auf flachen Flächen (steile Hänge bleiben felsig).
    this.material.onBeforeCompile = (shader) => injectSeason(shader, { snowBias: -0.25 });

    this.chunksPerSide = Math.round(heightMap.size / chunkSize);
    for (let cz = 0; cz < this.chunksPerSide; cz++) {
      for (let cx = 0; cx < this.chunksPerSide; cx++) {
        this.chunks.push(this.buildChunk(cx, cz));
      }
    }
  }

  /** Aktuell gewählte Detailstufen (für Debug-Anzeige): Anzahl Chunks je Stufe. */
  get lodHistogram(): number[] {
    const h = TERRAIN_LODS.map(() => 0);
    for (const c of this.chunks) h[c.level]++;
    return h;
  }

  /** Wählt pro Chunk die Detailstufe nach Entfernung zur Kamera (horizontal, bis zum Chunk-Rand). */
  update(focus: THREE.Vector3): void {
    for (const c of this.chunks) {
      const dx = Math.max(0, Math.abs(focus.x - c.cx) - c.half);
      const dz = Math.max(0, Math.abs(focus.z - c.cz) - c.half);
      const d = Math.hypot(dx, dz);
      let level = c.level;
      // Feiner werden sofort, gröber erst mit etwas Abstand zur Grenze.
      while (level > 0 && d < TERRAIN_LODS[level].from) level--;
      while (level < TERRAIN_LODS.length - 1 && d > TERRAIN_LODS[level + 1].from + LOD_HYSTERESIS) level++;
      if (level !== c.level) {
        c.levels[c.level].visible = false;
        c.levels[level].visible = true;
        c.level = level;
      }
    }
  }

  private buildChunk(cx: number, cz: number): Chunk {
    const hm = this.heightMap;
    const segs = Math.round(this.chunkSize / hm.cellSize);
    const verts = segs + 1;
    const ix0 = cx * segs;
    const iz0 = cz * segs;
    const originX = ix0 * hm.cellSize - hm.half;
    const originZ = iz0 * hm.cellSize - hm.half;

    // Volle Auflösung einmal berechnen; gröbere Stufen nehmen jedes n-te Sample daraus.
    const heights = new Float32Array(verts * verts);
    const normals = new Float32Array(verts * verts * 3);
    const colors = new Float32Array(verts * verts * 3);
    const n: [number, number, number] = [0, 1, 0];
    const color = new THREE.Color();
    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        const i = z * verts + x;
        const h = hm.getSample(ix0 + x, iz0 + z);
        hm.normalAtSample(ix0 + x, iz0 + z, n);
        heights[i] = h;
        normals.set(n, i * 3);
        this.groundColor(originX + x * hm.cellSize, originZ + z * hm.cellSize, h, 1 - n[1], color);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
    }

    const levels = TERRAIN_LODS.map(({ step }, li) => {
      const geometry = this.buildLevel(verts, step, heights, normals, colors);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = `TerrainChunk_${cx}_${cz}_L${li}`;
      mesh.position.set(originX, 0, originZ);
      mesh.receiveShadow = true;
      // Nahe Stufen werfen Schatten (Hänge, Berge); ferne liegen ohnehin außerhalb der Schattenkamera.
      mesh.castShadow = li <= 1;
      mesh.visible = li === 0;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      return mesh;
    });
    return { cx: originX + this.chunkSize / 2, cz: originZ + this.chunkSize / 2, half: this.chunkSize / 2, levels, level: 0 };
  }

  /** Gitter mit Schrittweite `step` plus Rand-Schürze. */
  private buildLevel(
    fullVerts: number,
    step: number,
    heights: Float32Array,
    normals: Float32Array,
    colors: Float32Array,
  ): THREE.BufferGeometry {
    const cell = this.heightMap.cellSize;
    const segs = (fullVerts - 1) / step;
    const verts = segs + 1;
    const ringCount = segs * 4;
    const total = verts * verts + ringCount;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);

    const copyVertex = (dst: number, x: number, z: number, drop: number) => {
      const src = z * step * fullVerts + x * step;
      pos[dst * 3] = x * step * cell;
      pos[dst * 3 + 1] = heights[src] - drop;
      pos[dst * 3 + 2] = z * step * cell;
      nor.set(normals.subarray(src * 3, src * 3 + 3), dst * 3);
      col.set(colors.subarray(src * 3, src * 3 + 3), dst * 3);
    };
    for (let z = 0; z < verts; z++) for (let x = 0; x < verts; x++) copyVertex(z * verts + x, x, z, 0);

    // Dreiecke mit derselben Diagonale wie Rapiers Heightfield: (x0,z1)–(x1,z0).
    const indices: number[] = [];
    for (let z = 0; z < segs; z++) {
      for (let x = 0; x < segs; x++) {
        const a = z * verts + x; // (x0, z0)
        const b = a + 1; // (x1, z0)
        const c = a + verts; // (x0, z1)
        const d = c + 1; // (x1, z1)
        indices.push(a, c, b, b, c, d);
      }
    }

    // Schürze: Randverlauf im Uhrzeigersinn (von oben gesehen), je Randpunkt ein abgesenkter Zwilling.
    const ring: [number, number][] = [];
    for (let x = 0; x < segs; x++) ring.push([x, 0]);
    for (let z = 0; z < segs; z++) ring.push([segs, z]);
    for (let x = segs; x > 0; x--) ring.push([x, segs]);
    for (let z = segs; z > 0; z--) ring.push([0, z]);
    const skirtDepth = 1.5 + step * cell * 1.5;
    ring.forEach(([x, z], i) => copyVertex(verts * verts + i, x, z, skirtDepth));
    for (let i = 0; i < ringCount; i++) {
      const j = (i + 1) % ringCount;
      const top0 = ring[i][1] * verts + ring[i][0];
      const top1 = ring[j][1] * verts + ring[j][0];
      const bot0 = verts * verts + i;
      const bot1 = verts * verts + j;
      // Vorderseite zeigt nach außen: Sie verdeckt den Spalt, wenn der Nachbar tiefer liegt.
      indices.push(top0, top1, bot0, top1, bot1, bot0);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }

  /** Bestimmt die Bodenfarbe aus Höhe, Steilheit und etwas Rauschen. */
  private groundColor(x: number, z: number, h: number, slope: number, out: THREE.Color): void {
    const water = this.heightMap.waterLevel;
    const n1 = this.colorNoise(x * 0.02, z * 0.02) * 0.5 + 0.5;
    const n2 = this.patchNoise(x * 0.045, z * 0.045);
    const fine = this.colorNoise(x * 0.35, z * 0.35) * 0.05;

    if (h < water - 0.4) {
      // Unter Wasser: Sand wird mit zunehmender Tiefe dunkel und grünlich.
      out.copy(PALETTE.seabed).lerp(PALETTE.seabedDeep, smoothstep(0, 14, water - h));
    } else {
      out.copy(PALETTE.grassDark).lerp(PALETTE.grassLight, n1);
      if (n2 > 0.45) out.lerp(PALETTE.dirt, smoothstep(0.45, 0.8, n2) * 0.8);
      // Strand: knapp über dem Wasserspiegel sandig, direkt am Wasser feucht/dunkel.
      const beach = 1 - smoothstep(water + 0.9, water + 2.4, h + n2 * 0.6);
      out.lerp(PALETTE.sand, beach);
      out.lerp(PALETTE.wetSand, 1 - smoothstep(water - 0.4, water + 0.5, h));
    }

    // Steile Hänge und Gipfel werden felsig.
    const rockT = Math.max(smoothstep(0.28, 0.45, slope + n2 * 0.05), smoothstep(42, 55, h + n2 * 4));
    if (rockT > 0) {
      out.lerp(tmpColor.copy(PALETTE.rock).lerp(PALETTE.rockDark, n1), rockT);
    }

    out.multiplyScalar(1 + fine);
  }

  dispose(): void {
    for (const c of this.chunks) for (const m of c.levels) m.geometry.dispose();
    this.material.dispose();
  }
}
