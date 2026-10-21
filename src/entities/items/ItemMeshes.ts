import * as THREE from 'three';
import type { ItemId } from './ItemDefs';
import { RAPIER } from '../../core/Physics';
import { jitter } from '../../world/VegetationGeometry';

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
  water: mat(0x3d6f86, { roughness: 0.1, metalness: 0.1, flatShading: false }),
  rawMeat: mat(0xa8343a, { roughness: 0.55 }),
  cookedMeat: mat(0x6b3a1e, { roughness: 0.75 }),
  bone: mat(0xe6dcc6, { roughness: 0.7 }),
};

/** Länge eines Holzstamms (m) – wird auch beim Zerlegen gefällter Bäume genutzt. */
export const LOG_LENGTH = 2.0;
export const LOG_RADIUS = 0.21;

let cache: Partial<Record<ItemId, THREE.Object3D>> = {};

function build(id: ItemId): THREE.Object3D {
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
    case 'arrow':
      return RAPIER.ColliderDesc.cylinder(0.35, 0.012).setDensity(600);
  }
}

/** Nur für Tests/Hot-Reload: zwischengespeicherte Modelle verwerfen. */
export function clearItemMeshCache(): void {
  cache = {};
}
