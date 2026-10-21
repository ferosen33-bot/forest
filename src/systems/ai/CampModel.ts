import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { jitter } from '../../world/VegetationGeometry';

const WOOD = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.95, flatShading: true });
const BONE = new THREE.MeshStandardMaterial({ color: 0xd8cfbb, roughness: 0.8, flatShading: true });
const STONE = new THREE.MeshStandardMaterial({ color: 0x6f6b64, roughness: 1, flatShading: true });

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) => {
  // Ikosaeder sind bereits nicht-indiziert; nur indizierte Geometrien umwandeln.
  const out = g.index ? g.toNonIndexed() : g.clone();
  out.rotateX(rx);
  out.rotateZ(rz);
  out.translate(x, y, z);
  return out;
};

/**
 * Lager der Schrate: Totempfahl mit Schädel, Feuerstelle und ein Ring aus Pfählen.
 * Je Material ein verschmolzenes Mesh (3 Draw Calls pro Lager).
 */
export function createCampModel(): THREE.Group {
  const wood: THREE.BufferGeometry[] = [];
  const bone: THREE.BufferGeometry[] = [];
  const stone: THREE.BufferGeometry[] = [];

  // Totem mit Querstangen, versetzt neben der Feuerstelle
  const pole = new THREE.CylinderGeometry(0.16, 0.22, 3.2, 7);
  wood.push(at(pole, 1.8, 1.5, -1.2));
  const bar = new THREE.CylinderGeometry(0.06, 0.06, 1.4, 5);
  wood.push(at(bar, 1.8, 2.4, -1.2, 0, Math.PI / 2), at(bar, 1.8, 1.9, -1.2, 0, Math.PI / 2 + 0.2));
  const skull = jitter(new THREE.IcosahedronGeometry(0.22, 1), 0.03, 17);
  skull.scale(1, 1.15, 1.1);
  bone.push(at(skull, 1.8, 3.25, -1.2));
  const horn = new THREE.ConeGeometry(0.05, 0.35, 5);
  bone.push(at(horn, 1.62, 3.42, -1.2, 0, 0.8), at(horn, 1.98, 3.42, -1.2, 0, -0.8));

  // Feuerstelle
  const rock = jitter(new THREE.IcosahedronGeometry(0.16, 0), 0.04, 23);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    stone.push(at(rock, Math.cos(a) * 0.65, 0.06, Math.sin(a) * 0.65));
  }

  // Pfahlring
  const stake = new THREE.CylinderGeometry(0.03, 0.09, 1.6, 5);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const r = 6.5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const g = stake.clone().toNonIndexed();
    g.translate(0, 0.7, 0);
    // nach außen geneigt
    g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), -0.35));
    g.translate(x, 0, z);
    wood.push(g);
    if (i % 3 === 0) bone.push(at(skull, x * 1.06, 1.55, z * 1.06));
  }

  const group = new THREE.Group();
  group.name = 'Camp';
  for (const [parts, material] of [
    [wood, WOOD],
    [bone, BONE],
    [stone, STONE],
  ] as const) {
    const merged = mergeGeometries(parts, false)!;
    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Hindernisse des Lagers für das Navigationsraster (lokale Koordinaten, Radius). */
export const CAMP_OBSTACLES: { x: number; z: number; r: number }[] = [
  { x: 1.8, z: -1.2, r: 0.4 },
  { x: 0, z: 0, r: 0.8 },
];
