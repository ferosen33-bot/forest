import * as THREE from 'three';
import type { ItemId } from './ItemDefs';
import { RAPIER } from '../../core/Physics';
import { jitter } from '../../world/VegetationGeometry';
import { texturize } from '../../world/SurfaceTextures';
import { getItemModel } from './ItemModels';

/**
 * Prozedurale 3D-Modelle für Items. Werden für fallengelassene Items in der Welt,
 * für die Hand des Spielers (ViewModel) und für die Inventar-Icons verwendet.
 *
 * Konvention: Ursprung im Schwerpunkt, Längsachse entlang +Y.
 */

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });

const MATERIALS = {
  bark: mat(0x4d3622),
  endWood: mat(0xb08a5a),
  stick: mat(0x6e5236),
  stone: mat(0x7d7a73, { roughness: 1 }),
  berry: mat(0x7a1830, { roughness: 0.4 }),
  berryDark: mat(0x3e1240, { roughness: 0.4 }),
  leaf: mat(0x3d6a2a),
  handle: mat(0x5a3d24),
  // Ohne Environment-Map würden stark metallische Materialien schwarz wirken → moderat halten.
  steel: mat(0x8e959c, { roughness: 0.45, metalness: 0.35 }),
  steelEdge: mat(0xd2d7dc, { roughness: 0.3, metalness: 0.4 }),
  tape: mat(0x2a2a2a, { roughness: 0.9 }),
  lightWood: mat(0x8a6a45),
  binding: mat(0x6b5a3a, { roughness: 1 }),
  cloth: mat(0x3a2f26, { roughness: 1 }),
  feather: mat(0xd8d2c4, { side: THREE.DoubleSide }),
  fur: mat(0x7a5a3c, { roughness: 1 }),
  furDark: mat(0x5a412b, { roughness: 1 }),
  water: mat(0x3d6f86, { roughness: 0.1, metalness: 0.1, flatShading: false }),
  rawMeat: mat(0xa8343a, { roughness: 0.55 }),
  cookedMeat: mat(0x6b3a1e, { roughness: 0.75 }),
  bone: mat(0xe6dcc6, { roughness: 0.7 }),
  fish: mat(0x7f9298, { roughness: 0.35, metalness: 0.15 }),
  fishBack: mat(0x4a5d63, { roughness: 0.45 }),
  cookedFish: mat(0x9b6a3c, { roughness: 0.7 }),
  line: mat(0xd8d6cc, { roughness: 0.6 }),
  flint: mat(0x2a2c33, { roughness: 0.22, metalness: 0.25 }),
  flintEdge: mat(0x5a5f6b, { roughness: 0.3, metalness: 0.2 }),
  mushroomCap: mat(0x2fc8b4, { roughness: 0.5, emissive: 0x138a7c, emissiveIntensity: 1.2 }),
  mushroomStem: mat(0xd6e8e0, { roughness: 0.8, emissive: 0x2a5a52, emissiveIntensity: 0.5 }),
  linen: mat(0xe8e2d0, { roughness: 1 }),
  tin: mat(0xa9aba6, { roughness: 0.4, metalness: 0.4 }),
  label: mat(0xb8432e, { roughness: 0.8 }),
  plastic: mat(0x9fc4d4, { roughness: 0.25, transparent: true, opacity: 0.7, flatShading: false }),
  bottleWater: mat(0x4a86a8, { roughness: 0.15, transparent: true, opacity: 0.75, flatShading: false }),
  cap: mat(0x2f5f9a, { roughness: 0.6 }),
  pillbox: mat(0xe9e6de, { roughness: 0.7 }),
  blade: mat(0xa4a9ad, { roughness: 0.35, metalness: 0.45 }),
  grip: mat(0x1f1f1f, { roughness: 0.8 }),
  lampBody: mat(0x2b2e33, { roughness: 0.5, metalness: 0.3 }),
  lens: mat(0xfff6d8, { roughness: 0.2, emissive: 0xfff0c0, emissiveIntensity: 0.6 }),
  batteryBody: mat(0x2c7a3c, { roughness: 0.5 }),
  jacket: mat(0x3d5a7a, { roughness: 1 }),
  jacketDark: mat(0x2c4259, { roughness: 1 }),
  redCross: mat(0xb02a24, { roughness: 0.8 }),
  glass: mat(0x4f6a3a, { roughness: 0.12, transparent: true, opacity: 0.72, flatShading: false }),
  oil: mat(0x8a6a2a, { roughness: 0.2, transparent: true, opacity: 0.85, flatShading: false }),
  rag: mat(0xb5a68a, { roughness: 1 }),
  can: mat(0x7a2a22, { roughness: 0.55, metalness: 0.4 }),
};

// Holz, Rinde und Stein bekommen Foto-Oberflächen (dreiachsig projiziert, ohne UVs).
texturize(MATERIALS.bark, 'bark', 0.4);
texturize(MATERIALS.stick, 'bark', 0.4);
texturize(MATERIALS.handle, 'planks', 0.3, 0.6);
texturize(MATERIALS.lightWood, 'planks', 0.3, 0.6);
texturize(MATERIALS.endWood, 'planks', 0.3, 0.6);
texturize(MATERIALS.stone, 'mossyRock', 0.5);

/** Splitter aus Feuerstein (für Item, Axtklinge und Felsadern). */
export const FLINT_GEOMETRY = jitter(new THREE.OctahedronGeometry(1, 0), 0.25, 17);

/** Leuchtpilz-Bündel (auch in den Höhlen verwendet). */
export function createMushroomCluster(rng: () => number, count: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const h = 0.05 + rng() * 0.08;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, h, 5), MATERIALS.mushroomStem);
    const a = rng() * Math.PI * 2;
    const r = i === 0 ? 0 : 0.03 + rng() * 0.05;
    stem.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    g.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.03 + rng() * 0.025, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), MATERIALS.mushroomCap);
    cap.scale.y = 0.6;
    cap.position.set(stem.position.x, h, stem.position.z);
    g.add(cap);
  }
  return g;
}

/** Länge der Angelrute (m); die Spitze trägt ein Hilfsobjekt "tip" für die Schnur. */
const ROD_LENGTH = 1.4;

/** Länge eines Holzstamms (m) – wird auch beim Zerlegen gefällter Bäume genutzt. */
export const LOG_LENGTH = 2.0;
export const LOG_RADIUS = 0.21;

let cache: Partial<Record<ItemId, THREE.Object3D>> = {};

function build(id: ItemId): THREE.Object3D {
  // Fotogescannte Modelle (falls geladen) haben Vorrang.
  const scanned = getItemModel(id);
  if (scanned) return scanned.clone(true);
  const g = new THREE.Group();
  switch (id) {
    case 'log': {
      // Gruppen der CylinderGeometry: 0 = Mantel, 1 = oben, 2 = unten.
      const geo = new THREE.CylinderGeometry(LOG_RADIUS, LOG_RADIUS * 1.08, LOG_LENGTH, 9);
      g.add(new THREE.Mesh(geo, [MATERIALS.bark, MATERIALS.endWood, MATERIALS.endWood]));
      break;
    }
    case 'stick': {
      const geo = new THREE.CylinderGeometry(0.022, 0.034, 0.9, 5);
      g.add(new THREE.Mesh(geo, MATERIALS.stick));
      const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.18, 4), MATERIALS.stick);
      twig.position.set(0.04, 0.15, 0);
      twig.rotation.z = -0.7;
      g.add(twig);
      break;
    }
    case 'stone': {
      const geo = jitter(new THREE.IcosahedronGeometry(0.13, 0), 0.03, 7);
      geo.scale(1.15, 0.75, 1);
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, MATERIALS.stone));
      break;
    }
    case 'berries': {
      const berry = new THREE.IcosahedronGeometry(0.034, 1);
      const offsets = [
        [0, 0, 0],
        [0.05, 0.01, 0.02],
        [-0.04, 0.015, 0.03],
        [0.01, 0.02, -0.05],
        [-0.02, 0.05, -0.01],
        [0.03, 0.055, 0.03],
      ];
      offsets.forEach(([x, y, z], i) => {
        const m = new THREE.Mesh(berry, i % 3 === 0 ? MATERIALS.berryDark : MATERIALS.berry);
        m.position.set(x, y - 0.02, z);
        g.add(m);
      });
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 4), MATERIALS.leaf);
      leaf.position.set(0.0, 0.07, 0.0);
      leaf.rotation.z = 0.9;
      g.add(leaf);
      break;
    }
    case 'axe': {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.62, 7), MATERIALS.handle);
      g.add(handle);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.16, 7), MATERIALS.tape);
      grip.position.y = -0.22;
      g.add(grip);
      // Axtkopf: Körper + keilförmige Schneide (zeigt in +X).
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.085, 0.036), MATERIALS.steel);
      head.position.set(0.035, 0.27, 0);
      g.add(head);
      const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 3, 1, false, 0, Math.PI), MATERIALS.steelEdge);
      blade.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
      blade.scale.set(1, 1, 0.9);
      blade.position.set(0.095, 0.27, 0);
      g.add(blade);
      const poll = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.04), MATERIALS.steel);
      poll.position.set(-0.04, 0.27, 0);
      g.add(poll);
      break;
    }
    case 'rawMeat':
    case 'cookedMeat': {
      // Fleischkeule: verbeulter Brocken mit herausragendem Knochen
      const chunk = jitter(new THREE.IcosahedronGeometry(0.1, 1), 0.02, id === 'rawMeat' ? 71 : 73);
      chunk.scale(1.3, 0.75, 1);
      g.add(new THREE.Mesh(chunk, id === 'rawMeat' ? MATERIALS.rawMeat : MATERIALS.cookedMeat));
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 5), MATERIALS.bone);
      bone.rotation.z = Math.PI / 2;
      bone.position.x = 0.15;
      g.add(bone);
      const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), MATERIALS.bone);
      knob.position.x = 0.22;
      g.add(knob);
      break;
    }
    case 'stoneAxe': {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.6, 6), MATERIALS.lightWood);
      g.add(handle);
      const stone = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.07, 0), 0.015, 13), MATERIALS.stone);
      stone.scale.set(1.5, 0.8, 0.55);
      stone.position.set(0.06, 0.24, 0);
      g.add(stone);
      const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.09, 6), MATERIALS.binding);
      wrap.position.y = 0.24;
      g.add(wrap);
      break;
    }
    case 'spear': {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 1.5, 6), MATERIALS.lightWood);
      g.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.16, 6), MATERIALS.endWood);
      tip.position.y = 0.83;
      g.add(tip);
      const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6), MATERIALS.binding);
      wrap.position.y = -0.15;
      g.add(wrap);
      break;
    }
    case 'bowl':
    case 'bowlWater': {
      // Gedrechselte Schale (Lathe), innen hohl; gefüllt mit Wasserspiegel.
      const profile = [
        [0.0, -0.04], [0.07, -0.04], [0.11, -0.01], [0.13, 0.04], [0.12, 0.045], [0.1, 0.0], [0.06, -0.025], [0.0, -0.025],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      g.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 10), MATERIALS.lightWood));
      if (id === 'bowlWater') {
        const surface = new THREE.Mesh(new THREE.CircleGeometry(0.108, 12), MATERIALS.water);
        surface.rotation.x = -Math.PI / 2;
        surface.position.y = 0.025;
        g.add(surface);
      }
      break;
    }
    case 'bow': {
      // Bogenarme als Kreisbogen (wölbt sich nach +X), Sehne entlang Y bei x = 0.
      const R = 0.62;
      const arc = 1.5;
      const limbs = new THREE.TorusGeometry(R, 0.017, 5, 18, arc);
      limbs.rotateZ(-arc / 2);
      limbs.translate(-R * Math.cos(arc / 2), 0, 0);
      g.add(new THREE.Mesh(limbs, MATERIALS.lightWood));
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.13, 6), MATERIALS.binding);
      grip.position.x = R - R * Math.cos(arc / 2);
      g.add(grip);
      const half = R * Math.sin(arc / 2);
      const string = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, half * 2, 3), MATERIALS.binding);
      g.add(string);
      break;
    }
    case 'arrow': {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.68, 4), MATERIALS.lightWood);
      g.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.06, 4), MATERIALS.stone);
      tip.position.y = 0.37;
      g.add(tip);
      for (let i = 0; i < 3; i++) {
        const vane = new THREE.Mesh(new THREE.PlaneGeometry(0.025, 0.08), MATERIALS.feather);
        vane.position.y = -0.29;
        vane.rotation.y = (i / 3) * Math.PI;
        g.add(vane);
      }
      break;
    }
    case 'hide': {
      // Zusammengelegtes Fell: unregelmäßige, flache Platte (Ursprung im Schwerpunkt)
      const sheet = jitter(new THREE.BoxGeometry(0.42, 0.05, 0.3, 3, 1, 3), 0.025, 91);
      g.add(new THREE.Mesh(sheet, MATERIALS.fur));
      break;
    }
    case 'backpack': {
      const body = new THREE.Mesh(jitter(new THREE.BoxGeometry(0.32, 0.42, 0.18, 2, 2, 2), 0.015, 93), MATERIALS.fur);
      g.add(body);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.12, 0.2), MATERIALS.furDark);
      flap.position.y = 0.17;
      g.add(flap);
      for (const x of [-0.09, 0.09]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.4, 0.02), MATERIALS.binding);
        strap.position.set(x, 0, -0.1);
        g.add(strap);
      }
      break;
    }
    case 'furCoat': {
      const torso = new THREE.Mesh(jitter(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8, 2), 0.015, 95), MATERIALS.fur);
      g.add(torso);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 5, 10), MATERIALS.furDark);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.25;
      g.add(collar);
      for (const s of [-1, 1]) {
        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.36, 6), MATERIALS.fur);
        sleeve.position.set(s * 0.22, 0.05, 0);
        sleeve.rotation.z = s * 0.45;
        g.add(sleeve);
      }
      break;
    }
    case 'fishingRod': {
      const half = ROD_LENGTH / 2;
      const blank = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.012, ROD_LENGTH - 0.3, 5), MATERIALS.lightWood);
      blank.position.y = 0.15;
      g.add(blank);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.02, 0.3, 6), MATERIALS.binding);
      handle.position.y = -half + 0.15;
      g.add(handle);
      // Einfache Rolle: aufgewickelte Schnur neben dem Griff.
      const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 8), MATERIALS.line);
      reel.rotation.z = Math.PI / 2;
      reel.position.set(0.035, -half + 0.32, 0);
      g.add(reel);
      for (const y of [-0.1, 0.25, 0.55]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 3, 6), MATERIALS.line);
        ring.position.set(0.012, y, 0);
        ring.rotation.y = Math.PI / 2;
        g.add(ring);
      }
      const tip = new THREE.Object3D();
      tip.name = 'tip';
      tip.position.y = half;
      g.add(tip);
      break;
    }
    case 'rawFish':
    case 'cookedFish': {
      // Kind 0 = Körper (wird am Bratspieß umgefärbt).
      const cooked = id === 'cookedFish';
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), cooked ? MATERIALS.cookedFish : MATERIALS.fish);
      body.scale.set(0.055, 0.17, 0.032);
      g.add(body);
      const back = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 4), cooked ? MATERIALS.cookedFish : MATERIALS.fishBack);
      back.scale.set(0.012, 0.11, 0.022);
      back.position.set(0.045, 0.01, 0);
      g.add(back);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.09, 4), cooked ? MATERIALS.cookedFish : MATERIALS.fishBack);
      tail.scale.z = 0.25;
      tail.position.y = -0.19;
      g.add(tail);
      break;
    }
    case 'flint': {
      const shard = new THREE.Mesh(FLINT_GEOMETRY, MATERIALS.flint);
      shard.scale.set(0.07, 0.1, 0.05);
      g.add(shard);
      break;
    }
    case 'flintAxe': {
      // Wie die Steinaxt, aber mit langer, flacher Feuersteinklinge.
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.62, 6), MATERIALS.stick);
      g.add(handle);
      const blade = new THREE.Mesh(FLINT_GEOMETRY, MATERIALS.flint);
      blade.scale.set(0.13, 0.07, 0.025);
      blade.position.set(0.09, 0.24, 0);
      g.add(blade);
      const edge = new THREE.Mesh(FLINT_GEOMETRY, MATERIALS.flintEdge);
      edge.scale.set(0.04, 0.06, 0.02);
      edge.position.set(0.2, 0.24, 0);
      g.add(edge);
      const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.09, 6), MATERIALS.binding);
      wrap.position.y = 0.24;
      g.add(wrap);
      break;
    }
    case 'mushroom': {
      let seed = 5;
      const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const cluster = createMushroomCluster(rng, 3);
      cluster.position.y = -0.05;
      g.add(cluster);
      break;
    }
    case 'medkit': {
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 10), MATERIALS.linen);
      roll.rotation.z = Math.PI / 2;
      g.add(roll);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 10), MATERIALS.redCross);
      band.rotation.z = Math.PI / 2;
      g.add(band);
      break;
    }
    case 'cannedFood': {
      const tin = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.11, 12), MATERIALS.tin);
      g.add(tin);
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.051, 0.051, 0.07, 12), MATERIALS.label);
      g.add(label);
      break;
    }
    case 'waterBottle':
    case 'bottle': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.038, 0.2, 10), id === 'bottle' ? MATERIALS.plastic : MATERIALS.bottleWater);
      g.add(body);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.034, 0.05, 10), MATERIALS.plastic);
      neck.position.y = 0.125;
      g.add(neck);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 8), MATERIALS.cap);
      cap.position.y = 0.16;
      g.add(cap);
      break;
    }
    case 'molotov': {
      // Grünes Glas, halb voll Öl, oben ein zusammengedrehter Lumpen
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.2, 10), MATERIALS.glass);
      g.add(body);
      const oil = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.11, 10), MATERIALS.oil);
      oil.position.y = -0.04;
      g.add(oil);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.034, 0.06, 10), MATERIALS.glass);
      neck.position.y = 0.13;
      g.add(neck);
      const rag = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 6), MATERIALS.rag);
      rag.position.y = 0.2;
      rag.rotation.z = 0.25;
      g.add(rag);
      break;
    }
    case 'lampOil': {
      const tank = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.17, 0.07), MATERIALS.can);
      g.add(tank);
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.05, 8), MATERIALS.tin);
      spout.position.set(0.03, 0.1, 0);
      g.add(spout);
      const grip = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 4, 10, Math.PI), MATERIALS.tin);
      grip.position.set(-0.025, 0.085, 0);
      g.add(grip);
      break;
    }
    case 'painkillers': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.03), MATERIALS.pillbox);
      g.add(box);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.012, 0.032), MATERIALS.redCross);
      g.add(stripe);
      break;
    }
    case 'machete': {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.14, 6), MATERIALS.grip);
      handle.position.y = -0.18;
      g.add(handle);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.03), MATERIALS.grip);
      guard.position.y = -0.105;
      g.add(guard);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.006), MATERIALS.blade);
      blade.position.set(0.006, 0.11, 0);
      g.add(blade);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.006), MATERIALS.blade);
      tip.position.set(0.0, 0.34, 0);
      tip.rotation.z = 0.5;
      g.add(tip);
      break;
    }
    case 'flashlight': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), MATERIALS.lampBody);
      g.add(body);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.05, 10), MATERIALS.lampBody);
      head.position.y = 0.1;
      g.add(head);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 10), MATERIALS.lens);
      lens.rotation.x = -Math.PI / 2;
      lens.position.y = 0.126;
      g.add(lens);
      // Lichtquelle vor der Linse (für die Hand-Lampe).
      const lamp = new THREE.Object3D();
      lamp.name = 'lamp';
      lamp.position.y = 0.14;
      g.add(lamp);
      break;
    }
    case 'enginePart': {
      // Ölverschmierter Lappen mit Zündkerzen und einer Pumpe darauf.
      const rag = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.16), MATERIALS.cloth);
      g.add(rag);
      const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 10), MATERIALS.steel);
      pump.rotation.z = Math.PI / 2;
      pump.position.set(-0.03, 0.045, 0);
      g.add(pump);
      for (let i = 0; i < 3; i++) {
        const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.07, 6), i % 2 ? MATERIALS.steelEdge : MATERIALS.bone);
        plug.rotation.x = Math.PI / 2;
        plug.position.set(0.06 + i * 0.018, 0.02, 0.01);
        g.add(plug);
      }
      break;
    }
    case 'documents': {
      const folder = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 0.3), mat(0x8a6a3c, { roughness: 0.9 }));
      g.add(folder);
      const paper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.026, 0.27), mat(0xe2dccb, { roughness: 1 }));
      paper.position.set(0.01, 0.003, 0.005);
      g.add(paper);
      const stamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.027, 0.03), mat(0x9a2a24, { roughness: 0.8 }));
      stamp.position.set(0.03, 0.004, -0.08);
      g.add(stamp);
      break;
    }
    case 'watch': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 14), MATERIALS.tin);
      body.rotation.x = Math.PI / 2;
      g.add(body);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.029, 14), MATERIALS.pillbox);
      face.position.z = 0.0065;
      g.add(face);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 4, 8), MATERIALS.tin);
      ring.position.y = 0.045;
      g.add(ring);
      break;
    }
    case 'battery': {
      const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 8), MATERIALS.batteryBody);
      g.add(cell);
      const plus = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 6), MATERIALS.tin);
      plus.position.y = 0.028;
      g.add(plus);
      break;
    }
    case 'jacket': {
      const torso = new THREE.Mesh(jitter(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8, 2), 0.01, 97), MATERIALS.jacket);
      g.add(torso);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.035, 5, 10), MATERIALS.jacketDark);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.25;
      g.add(collar);
      for (const s of [-1, 1]) {
        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.36, 6), MATERIALS.jacket);
        sleeve.position.set(s * 0.22, 0.05, 0);
        sleeve.rotation.z = s * 0.45;
        g.add(sleeve);
      }
      break;
    }
    case 'torch': {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.55, 6), MATERIALS.stick);
      g.add(shaft);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.032, 0.12, 7), MATERIALS.cloth);
      head.position.y = 0.27;
      g.add(head);
      break;
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  g.name = `Item_${id}`;
  return g;
}

/** Neue Instanz des Item-Modells (Geometrie und Material werden geteilt). */
export function createItemMesh(id: ItemId): THREE.Object3D {
  let proto = cache[id];
  if (!proto) {
    proto = build(id);
    cache[id] = proto;
  }
  return proto.clone(true);
}

/** Kollisionsform für ein Item als physikalisches Objekt in der Welt. */
export function createItemCollider(id: ItemId): RAPIER.ColliderDesc {
  switch (id) {
    case 'log':
      return RAPIER.ColliderDesc.cylinder(LOG_LENGTH / 2, LOG_RADIUS).setDensity(550);
    case 'stick':
      return RAPIER.ColliderDesc.cylinder(0.45, 0.035).setDensity(500);
    case 'stone':
      return RAPIER.ColliderDesc.ball(0.11).setDensity(2500);
    case 'berries':
      return RAPIER.ColliderDesc.ball(0.07).setDensity(800);
    case 'rawMeat':
    case 'cookedMeat':
      return RAPIER.ColliderDesc.ball(0.1).setDensity(1000);
    case 'axe':
    case 'stoneAxe':
      return RAPIER.ColliderDesc.cuboid(0.08, 0.32, 0.03).setDensity(900);
    case 'spear':
      return RAPIER.ColliderDesc.cylinder(0.78, 0.03).setDensity(600);
    case 'torch':
      return RAPIER.ColliderDesc.cylinder(0.3, 0.04).setDensity(600);
    case 'bowl':
    case 'bowlWater':
      return RAPIER.ColliderDesc.cylinder(0.045, 0.12).setDensity(500);
    case 'bow':
      return RAPIER.ColliderDesc.cuboid(0.1, 0.45, 0.03).setDensity(500);
    case 'hide':
      return RAPIER.ColliderDesc.cuboid(0.21, 0.03, 0.15).setDensity(400);
    case 'backpack':
      return RAPIER.ColliderDesc.cuboid(0.16, 0.22, 0.1).setDensity(300);
    case 'furCoat':
      return RAPIER.ColliderDesc.cylinder(0.25, 0.2).setDensity(250);
    case 'arrow':
      return RAPIER.ColliderDesc.cylinder(0.35, 0.012).setDensity(600);
    case 'fishingRod':
      return RAPIER.ColliderDesc.cylinder(ROD_LENGTH / 2, 0.025).setDensity(500);
    case 'flint':
      return RAPIER.ColliderDesc.ball(0.08).setDensity(2600);
    case 'flintAxe':
      return RAPIER.ColliderDesc.cuboid(0.1, 0.32, 0.03).setDensity(900);
    case 'mushroom':
      return RAPIER.ColliderDesc.ball(0.07).setDensity(600);
    case 'medkit':
      return RAPIER.ColliderDesc.cylinder(0.05, 0.05).setDensity(400);
    case 'cannedFood':
      return RAPIER.ColliderDesc.cylinder(0.055, 0.05).setDensity(900);
    case 'waterBottle':
    case 'bottle':
      return RAPIER.ColliderDesc.cylinder(0.1, 0.037).setDensity(id === 'bottle' ? 100 : 900);
    case 'painkillers':
      return RAPIER.ColliderDesc.cuboid(0.045, 0.025, 0.015).setDensity(300);
    case 'molotov':
      return RAPIER.ColliderDesc.cylinder(0.11, 0.038).setDensity(900);
    case 'lampOil':
      return RAPIER.ColliderDesc.cuboid(0.06, 0.085, 0.035).setDensity(850);
    case 'machete':
      return RAPIER.ColliderDesc.cuboid(0.03, 0.26, 0.01).setDensity(2000);
    case 'flashlight':
      return RAPIER.ColliderDesc.cylinder(0.1, 0.025).setDensity(700);
    case 'battery':
      return RAPIER.ColliderDesc.cylinder(0.025, 0.014).setDensity(2000);
    case 'jacket':
      return RAPIER.ColliderDesc.cylinder(0.25, 0.2).setDensity(250);
    case 'watch':
      return RAPIER.ColliderDesc.cylinder(0.008, 0.036).setDensity(3000);
    case 'enginePart':
      return RAPIER.ColliderDesc.cuboid(0.11, 0.04, 0.08).setDensity(1500);
    case 'documents':
      return RAPIER.ColliderDesc.cuboid(0.11, 0.015, 0.15).setDensity(600);
    case 'rawFish':
    case 'cookedFish':
      return RAPIER.ColliderDesc.cuboid(0.05, 0.2, 0.03).setDensity(1000);
  }
}

/** Nur für Tests/Hot-Reload: zwischengespeicherte Modelle verwerfen. */
export function clearItemMeshCache(): void {
  cache = {};
}
