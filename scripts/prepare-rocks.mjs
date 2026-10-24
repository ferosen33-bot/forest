// Bereitet fotogescannte Felsen (Poly Haven, CC0) für das Spiel auf:
// glTF lesen → mit meshoptimizer auf ein spieltaugliches Maß vereinfachen → auf Radius 1 normieren →
// kompakte Binärdatei schreiben (Mesh + konvexe Hülle für die Kollision).
//
// Aufruf: node scripts/prepare-rocks.mjs <Ordner mit *_1k.gltf + *.bin> <Ausgabeordner> rock_07 rock_09 …
//
// Format (little endian): "ROCK", u32 Vertices, u32 Indizes, u32 Hüllpunkte,
// f32 Positionen (3n), f32 Normalen (3n), f32 UVs (2n), u16 Indizes, f32 Hülle (3h).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , src, out, ...ids] = process.argv;
const TARGET_TRIANGLES = 1400;
const HULL_TRIANGLES = 60;

await MeshoptSimplifier.ready;
mkdirSync(out, { recursive: true });

function accessor(gltf, bin, index) {
  const a = gltf.accessors[index];
  const view = gltf.bufferViews[a.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const Type = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
  const stride = view.byteStride ?? comps * Type.BYTES_PER_ELEMENT;
  const outArr = new Type(a.count * comps);
  const dv = new DataView(bin.buffer, bin.byteOffset);
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < comps; c++) {
      const at = offset + i * stride + c * Type.BYTES_PER_ELEMENT;
      outArr[i * comps + c] =
        a.componentType === 5126 ? dv.getFloat32(at, true) : a.componentType === 5125 ? dv.getUint32(at, true) : dv.getUint16(at, true);
    }
  }
  return outArr;
}

for (const id of ids) {
  const gltf = JSON.parse(readFileSync(join(src, `${id}_1k.gltf`), 'utf8'));
  const bin = readFileSync(join(src, gltf.buffers[0].uri));
  const prim = gltf.meshes[0].primitives[0];
  const pos = accessor(gltf, bin, prim.attributes.POSITION);
  const nor = accessor(gltf, bin, prim.attributes.NORMAL);
  const uv = accessor(gltf, bin, prim.attributes.TEXCOORD_0);
  const idx = Uint32Array.from(accessor(gltf, bin, prim.indices));
  const n = pos.length / 3;

  // Vereinfachen (Normalen und UVs gewichtet, damit Nähte und Kanten halten)
  const attrs = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) attrs.set([nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2], uv[i * 2], uv[i * 2 + 1]], i * 5);
  const [simple] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, attrs, 5, [0.5, 0.5, 0.5, 1, 1], null, TARGET_TRIANGLES * 3, 0.02, ['Prune', 'Permissive']);
  const [remap, unique] = MeshoptSimplifier.compactMesh(simple);
  // compactMesh ordnet die Indizes in place neu und liefert die Zuordnung alt → neu.
  const P = new Float32Array(unique * 3);
  const N = new Float32Array(unique * 3);
  const U = new Float32Array(unique * 2);
  for (let i = 0; i < n; i++) {
    const j = remap[i];
    if (j === 0xffffffff) continue;
    P.set(pos.subarray(i * 3, i * 3 + 3), j * 3);
    N.set(nor.subarray(i * 3, i * 3 + 3), j * 3);
    U.set(uv.subarray(i * 2, i * 2 + 2), j * 2);
  }

  // Normieren: Mitte der Grundfläche in den Ursprung, größte Halbachse = 1 (wie die bisherigen Felsen).
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < unique; i++) for (let c = 0; c < 3; c++) {
    min[c] = Math.min(min[c], P[i * 3 + c]);
    max[c] = Math.max(max[c], P[i * 3 + c]);
  }
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const half = Math.max((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2);
  for (let i = 0; i < unique; i++) for (let c = 0; c < 3; c++) P[i * 3 + c] = (P[i * 3 + c] - center[c]) / half;

  // Hülle: grob vereinfachte Form, davon nur die Punkte
  const [hullIdx] = MeshoptSimplifier.simplifySloppy(simple, P, 3, null, HULL_TRIANGLES * 3, 0.2);
  const hullSet = [...new Set(hullIdx)];
  const H = new Float32Array(hullSet.length * 3);
  hullSet.forEach((v, k) => H.set(P.subarray(v * 3, v * 3 + 3), k * 3));

  const header = new Uint32Array([0x4b434f52, unique, simple.length, hullSet.length]);
  const parts = [header, P, N, U, Uint16Array.from(simple)];
  const pad = (simple.length * 2) % 4 ? new Uint8Array(2) : new Uint8Array(0);
  const blob = Buffer.concat([...parts.map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength)), Buffer.from(pad), Buffer.from(H.buffer)]);
  writeFileSync(join(out, `${id}.rock`), blob);
  console.log(`${id}: ${idx.length / 3} → ${simple.length / 3} Dreiecke, ${unique} Vertices, Hülle ${hullSet.length} Punkte, ${(blob.length / 1024).toFixed(0)} KB`);
}
