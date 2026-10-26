// Bereitet die Figuren aus Mesh2Motion (https://github.com/mesh2motion/mesh2motion-app, Modelle und
// Animationen CC0) für das Spiel auf:
// - aus den beiden Animationsbibliotheken nur die benötigten Bewegungen behalten (Meshes, Texturen raus),
// - die ausgewählten Figuren unverändert kopieren.
//
// Aufruf: node scripts/prepare-characters.mjs <mesh2motion-app/static> <Ausgabeordner>
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { prune, resample, dedup } from '@gltf-transform/functions';

const [, , src, out] = process.argv;
mkdirSync(out, { recursive: true });

/** Figuren: Schrate und Monster, Überlebende. */
const MODELS = [
  'monster', 'monster_3', 'monster_4', 'monster_5', 'killer_4', 'killer_5', 'killer_6', 'killer_7',
  'male_10', 'hazmat_female', 'female_9',
  // Hetzer (verwandelte Dorfbewohner), Schreierin, Hansen (Endgegner im Stollen)
  'male_15', 'police_male', 'female_8', 'hazmat_suit_male',
];

const CLIPS = {
  'human-base-animations.glb': [
    'Idle_A', 'Idle_Talking', 'Idle_Torch', 'Sitting_Idle', 'Jog', 'Sprint', 'Punch_Cross', 'Punch_Jab',
    'Melee_Hook', 'OverhandThrow', 'Hit_Chest', 'Hit_Head', 'Death_D', 'Crouch_Idle', 'Crouch_Walk', 'Interact',
    'Idle_Sword', 'Zombie_Scratch', 'Zombie_Idle', 'Zombie_Walk',
  ],
  'human-addon-animations.glb': [
    'Zombie_Walk_2', 'Zombie Yell', 'Zombie_Idle_Crouch', 'Zombie_Rise', 'Crawl', 'Death_A', 'Death_B', 'Death_C',
    'Idle Hurt', 'Shivering', 'Kneeling Tired', 'Walk_Stealth', 'Walk_Large', 'Idle_Subtle', 'Head Nod', 'Tired Hunched',
    'Run_Female', 'Walk_Female', 'Attack_Ground_Pound', 'Angry',
  ],
};

const io = new NodeIO();
for (const [file, keep] of Object.entries(CLIPS)) {
  const doc = await io.read(join(src, 'animations', file));
  const root = doc.getRoot();
  for (const a of root.listAnimations()) if (!keep.includes(a.getName())) a.dispose();
  // Finger- und Endknochen bewegen sich kaum sichtbar – deren Spuren kosten nur Speicher.
  const minor = /(thumb|index|middle|ring|pinky)_\d|_leaf$/;
  for (const a of root.listAnimations()) {
    for (const c of a.listChannels()) {
      const node = c.getTargetNode();
      // Die Schwerthaltung behält ihre Finger: daraus entsteht die greifende Hand in der Ich-Ansicht.
      const fingers = a.getName() === 'Idle_Sword' && !node?.getName().endsWith('_leaf');
      if (node && !fingers && (minor.test(node.getName()) || c.getTargetPath() === 'scale')) {
        c.getSampler()?.dispose();
        c.dispose();
      }
    }
  }
  // Nur das Skelett bleibt: Meshes, Hautbindung, Materialien und Texturen entfernen.
  for (const n of root.listNodes()) {
    n.setMesh(null);
    n.setSkin(null);
  }
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const t of root.listTextures()) t.dispose();
  for (const m of root.listMaterials()) m.dispose();
  await doc.transform(resample({ tolerance: 0.002 }), dedup(), prune({ keepLeaves: true }));
  const name = file.replace('human-', '').replace('-animations', '-anims');
  await io.write(join(out, name), doc);
  const found = root.listAnimations().map((a) => a.getName());
  const missing = keep.filter((k) => !found.includes(k));
  console.log(`${name}: ${found.length} Bewegungen, ${(statSync(join(out, name)).size / 1024).toFixed(0)} KB${missing.length ? ` – fehlt: ${missing}` : ''}`);
}

for (const m of MODELS) copyFileSync(join(src, 'models-variation', 'human', `${m}.glb`), join(out, `${m}.glb`));
console.log(`${MODELS.length} Figuren kopiert`);
