// Schneidet aus dem MakeHuman-Avatar `mpfb.glb` (TalkingHead, https://github.com/met4citizen/TalkingHead,
// Avatar CC0) den rechten Arm mit Hand und Ärmel heraus – für die Hände in der Ich-Ansicht (die linke
// Hand am Bogen ist dieselbe, gespiegelt). Der Oberarm gehört dazu, damit ein ausgestreckter Arm nicht
// mitten im Bild endet.
// Alles andere (Kopf, Haare, Zähne, Gesichtsformen) fällt weg, Texturen werden verkleinert.
//
// Aufruf: node scripts/prepare-fp-arm.mjs <mpfb.glb> <Ausgabe.glb>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { compactPrimitive, prune } from '@gltf-transform/functions';

const [, , src, out] = process.argv;
const ARM = /^RightArm$|^RightForeArm$|^RightHand/;
const KEEP_MESHES = { base: 0.35, female_casualsuit01: 0.6 };

const io = new NodeIO();
const doc = await io.read(src);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const armJoints = new Set(skin.listJoints().map((j, i) => (ARM.test(j.getName()) ? i : -1)).filter((i) => i >= 0));

for (const mesh of root.listMeshes()) {
  const threshold = KEEP_MESHES[mesh.getName()];
  if (threshold === undefined) {
    mesh.dispose();
    continue;
  }
  for (const prim of mesh.listPrimitives()) {
    for (const t of prim.listTargets()) prim.removeTarget(t);
    const joints = prim.getAttribute('JOINTS_0');
    const weights = prim.getAttribute('WEIGHTS_0');
    const idx = prim.getIndices();
    const armWeight = new Float32Array(joints.getCount());
    const j = [0, 0, 0, 0];
    const w = [0, 0, 0, 0];
    for (let v = 0; v < joints.getCount(); v++) {
      joints.getElement(v, j);
      weights.getElement(v, w);
      for (let k = 0; k < 4; k++) if (armJoints.has(j[k])) armWeight[v] += w[k];
    }
    const keep = [];
    for (let t = 0; t < idx.getCount(); t += 3) {
      const a = idx.getScalar(t);
      const b = idx.getScalar(t + 1);
      const c = idx.getScalar(t + 2);
      if (armWeight[a] > threshold && armWeight[b] > threshold && armWeight[c] > threshold) keep.push(a, b, c);
    }
    idx.setArray(new Uint32Array(keep));
    compactPrimitive(prim);
    console.log(`${mesh.getName()}: ${keep.length / 3} Dreiecke behalten`);
  }
}
// Morph-Gewichte der Meshes passen nach dem Entfernen der Formen nicht mehr.
for (const mesh of root.listMeshes()) mesh.setWeights([]);
for (const node of root.listNodes()) if (node.getMesh() === null) node.setWeights([]);

// Texturen verkleinern (PIL), Normalen etwas stärker
const tmp = mkdtempSync(join(tmpdir(), 'fparm-'));
for (const tex of root.listTextures()) {
  const name = tex.getName() || tex.getURI() || 'tex';
  const inFile = join(tmp, `${name}.png`);
  const outFile = join(tmp, `${name}.jpg`);
  writeFileSync(inFile, tex.getImage());
  const size = /normal/i.test(name) ? 512 : 1024;
  execFileSync('python3', ['-I', '-c', `from PIL import Image; Image.open(r'${inFile}').convert('RGB').resize((${size}, ${size}), Image.LANCZOS).save(r'${outFile}', quality=85)`]);
  tex.setImage(new Uint8Array(readFileSync(outFile)));
  tex.setMimeType('image/jpeg');
  tex.setURI(`${name}.jpg`);
}
await doc.transform(prune());
await io.write(out, doc);
console.log(`${out}: ${(statSync(out).size / 1024).toFixed(0)} KB`);
