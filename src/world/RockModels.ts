import * as THREE from 'three';
import { injectSeason } from './SeasonShader';

/**
 * Fotogescannte Felsen (Poly Haven, CC0), mit `scripts/prepare-rocks.mjs` auf ~1.400–4.800 Dreiecke
 * vereinfacht und auf Radius 1 normiert – also gleich groß wie die bisherigen Felsen. Jede Datei
 * bringt neben dem Mesh eine grobe Punktwolke für die konvexe Kollisionshülle mit.
 */

export interface RockModel {
  id: string;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Punkte der Kollisionshülle (Ortssystem, Radius ≈ 1). */
  hull: Float32Array;
  /** Große Findlinge (für die seltenen, sehr großen Felsen). */
  boulder: boolean;
}

const ROCKS: { id: string; boulder: boolean }[] = [
  { id: 'rock_07', boulder: false },
  { id: 'rock_09', boulder: false },
  { id: 'boulder_01', boulder: true },
];

/** Liest das Binärformat von `prepare-rocks.mjs`. */
export function parseRock(buffer: ArrayBuffer): { geometry: THREE.BufferGeometry; hull: Float32Array } {
  const head = new Uint32Array(buffer, 0, 4);
  if (head[0] !== 0x4b434f52) throw new Error('Keine Felsdatei');
  const [, nv, ni, nh] = head;
  let o = 16;
  const pos = new Float32Array(buffer, o, nv * 3);
  o += nv * 12;
  const nor = new Float32Array(buffer, o, nv * 3);
  o += nv * 12;
  const uv = new Float32Array(buffer, o, nv * 2);
  o += nv * 8;
  const idx = new Uint16Array(buffer, o, ni);
  o += ni * 2;
  if (o % 4) o += 2;
  const hull = new Float32Array(buffer, o, nh * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return { geometry: g, hull };
}

const loader = new THREE.TextureLoader();

export async function loadRockModels(base = `${import.meta.env.BASE_URL}models/rocks/`): Promise<RockModel[]> {
  return Promise.all(
    ROCKS.map(async ({ id, boulder }) => {
      const res = await fetch(`${base}${id}.rock`);
      if (!res.ok) throw new Error(`${id}: ${res.status}`);
      const { geometry, hull } = parseRock(await res.arrayBuffer());
      const map = await loader.loadAsync(`${base}${id}_d.jpg`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      const normalMap = await loader.loadAsync(`${base}${id}_n.jpg`);
      const material = new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.92 });
      // Schnee auf der Oberseite im Winter
      material.onBeforeCompile = (shader) => injectSeason(shader, { snowBias: 0.1 });
      return { id, geometry, material, hull, boulder };
    }),
  );
}
