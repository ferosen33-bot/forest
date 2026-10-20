import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import type { HeightMap } from './HeightMap';
import { deriveSeed, mulberry32 } from '../utils/random';
import { smoothstep } from '../utils/math';

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

/**
 * Render-Repräsentation des Terrains: die Höhenkarte wird in quadratische Chunks
 * zerlegt, damit Three.js (Kamera- und Schatten-Frustum) unsichtbare Teile verwirft.
 * Normalen kommen direkt aus der Höhenkarte → keine sichtbaren Nähte an Chunk-Grenzen.
 */
export class Terrain {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  readonly chunksPerSide: number;

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

    this.chunksPerSide = Math.round(heightMap.size / chunkSize);
    for (let cz = 0; cz < this.chunksPerSide; cz++) {
      for (let cx = 0; cx < this.chunksPerSide; cx++) {
        this.group.add(this.buildChunk(cx, cz));
      }
    }
  }

  private buildChunk(cx: number, cz: number): THREE.Mesh {
    const hm = this.heightMap;
    const segs = Math.round(this.chunkSize / hm.cellSize);
    const verts = segs + 1;
    const ix0 = cx * segs;
    const iz0 = cz * segs;
    const originX = ix0 * hm.cellSize - hm.half;
    const originZ = iz0 * hm.cellSize - hm.half;

    const positions = new Float32Array(verts * verts * 3);
    const normals = new Float32Array(verts * verts * 3);
    const colors = new Float32Array(verts * verts * 3);
    const n: [number, number, number] = [0, 1, 0];
    const color = new THREE.Color();

    let p = 0;
    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        const ix = ix0 + x;
        const iz = iz0 + z;
        const h = hm.getSample(ix, iz);
        hm.normalAtSample(ix, iz, n);

        positions[p] = x * hm.cellSize;
        positions[p + 1] = h;
        positions[p + 2] = z * hm.cellSize;
        normals[p] = n[0];
        normals[p + 1] = n[1];
        normals[p + 2] = n[2];

        this.groundColor(originX + x * hm.cellSize, originZ + z * hm.cellSize, h, 1 - n[1], color);
        colors[p] = color.r;
        colors[p + 1] = color.g;
        colors[p + 2] = color.b;
        p += 3;
      }
    }

    // Dreiecke mit derselben Diagonale wie Rapiers Heightfield: (x0,z1)–(x1,z0).
    const indices = new Uint32Array(segs * segs * 6);
    let k = 0;
    for (let z = 0; z < segs; z++) {
      for (let x = 0; x < segs; x++) {
        const a = z * verts + x; // (x0, z0)
        const b = a + 1; // (x1, z0)
        const c = a + verts; // (x0, z1)
        const d = c + 1; // (x1, z1)
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = `TerrainChunk_${cx}_${cz}`;
    mesh.position.set(originX, 0, originZ);
    mesh.receiveShadow = true;
    // Terrain wirft Schatten auf sich selbst (Berge/Hänge); Kosten sind dank Chunking gering.
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
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
    for (const child of this.group.children) (child as THREE.Mesh).geometry.dispose();
    this.material.dispose();
  }
}
