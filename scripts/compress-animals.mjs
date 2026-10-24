// Verkleinert die Texturen der Tier-GLBs aus `prepare-animals.py` (Blender schreibt PNG in voller Größe):
// Farbe 1024 als JPEG, Normalen 512 als JPEG, Fell-Karten mit Transparenz bleiben PNG (512).
// Außerdem werden die Bewegungsspuren ausgedünnt.
//
// Aufruf: node scripts/compress-animals.mjs <datei.glb> [...]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, resample } from '@gltf-transform/functions';

const io = new NodeIO();
const tmp = mkdtempSync(join(tmpdir(), 'animals-'));
for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const alpha = new Set();
  const normals = new Set();
  for (const m of root.listMaterials()) {
    if (m.getAlphaMode() !== 'OPAQUE') alpha.add(m.getBaseColorTexture());
    normals.add(m.getNormalTexture());
  }
  for (const [i, tex] of root.listTextures().entries()) {
    const keepAlpha = alpha.has(tex);
    const size = normals.has(tex) || keepAlpha ? 512 : 1024;
    const ext = keepAlpha ? 'png' : 'jpg';
    const inFile = join(tmp, `${i}.in`);
    const outFile = join(tmp, `${i}.${ext}`);
    writeFileSync(inFile, tex.getImage());
    const mode = keepAlpha ? 'RGBA' : 'RGB';
    const save = keepAlpha ? `optimize=True` : `quality=85`;
    execFileSync('python3', ['-I', '-c', `from PIL import Image; Image.open(r'${inFile}').convert('${mode}').resize((${size}, ${size}), Image.LANCZOS).save(r'${outFile}', ${save})`]);
    tex.setImage(new Uint8Array(readFileSync(outFile)));
    tex.setMimeType(keepAlpha ? 'image/png' : 'image/jpeg');
    tex.setURI(`${tex.getName() || i}.${ext}`);
  }
  await doc.transform(resample({ tolerance: 0.001 }), dedup(), prune({ keepLeaves: true }));
  await io.write(file, doc);
  console.log(`${file}: ${(statSync(file).size / 1024).toFixed(0)} KB`);
}
