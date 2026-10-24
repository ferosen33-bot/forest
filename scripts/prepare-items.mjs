// Bereitet Werkzeug- und Gegenstandsmodelle von Poly Haven (CC0) für das Spiel auf:
// glTF (1k, Texturen vorher auf 512 px verkleinert) → bei Bedarf mit meshoptimizer vereinfachen → GLB.
// Ausrichtung und Maßstab je Gegenstand legt `src/entities/items/ItemModels.ts` fest.
//
// Aufruf: node scripts/prepare-items.mjs <Ordner mit *_1k.gltf> <Ausgabeordner>
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , src, out] = process.argv;
mkdirSync(out, { recursive: true });

/** Poly-Haven-Modell → höchstens so viele Dreiecke. */
const MODELS = { hatchet: 5300, machete: 3100, vintage_flashlight: 3500, medical_box: 3800, can_rusted: 2000, wooden_bowl_02: 2500 };

await MeshoptSimplifier.ready;
const io = new NodeIO();
for (const [id, maxTris] of Object.entries(MODELS)) {
  const doc = await io.read(join(src, `${id}_1k.gltf`));
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  if (tris > maxTris) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: maxTris / tris, error: 0.01 }));
  await doc.transform(dedup(), prune());
  let after = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) after += (p.getIndices()?.getCount() ?? 0) / 3;
  await io.write(join(out, `${id}.glb`), doc);
  console.log(`${id}: ${tris} → ${after} Dreiecke, ${(statSync(join(out, `${id}.glb`)).size / 1024).toFixed(0)} KB`);
}
