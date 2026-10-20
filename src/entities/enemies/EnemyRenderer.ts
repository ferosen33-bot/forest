import * as THREE from 'three';
import { PART_GEOMETRY, type EnemyRig, type PartType } from './EnemyRig';

const skin = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
const MATERIALS: Record<PartType, THREE.Material> = {
  torso: skin,
  head: skin,
  upperArm: skin,
  forearm: skin,
  thigh: skin,
  shin: skin,
  // Leuchtende Augen – nachts das Erste, was man von ihnen sieht.
  eyes: new THREE.MeshBasicMaterial({ color: 0xffb070 }),
  hips: new THREE.MeshStandardMaterial({ color: 0x3e3226, roughness: 1, flatShading: true }),
  club: new THREE.MeshStandardMaterial({ color: 0x4f3a26, roughness: 0.95, flatShading: true }),
};

/** Hautfarben (fahl, gräulich) – pro Gegner leicht variiert. */
const SKIN_TONES = [0x8d8577, 0x7f796f, 0x958a79, 0x77746d];

/**
 * Zeichnet alle Gegner mit EINEM InstancedMesh pro Körperteil-Typ
 * (≈ 9 Draw Calls, egal wie viele Gegner unterwegs sind).
 */
export class EnemyRenderer {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<PartType, THREE.InstancedMesh>();
  private readonly counts = new Map<PartType, number>();
  private readonly color = new THREE.Color();

  constructor(maxEnemies: number) {
    this.group.name = 'Enemies';
    const perEnemy: Record<PartType, number> = {
      torso: 1,
      head: 1,
      eyes: 1,
      hips: 1,
      upperArm: 2,
      forearm: 2,
      thigh: 2,
      shin: 2,
      club: 1,
    };
    for (const type of Object.keys(perEnemy) as PartType[]) {
      const mesh = new THREE.InstancedMesh(PART_GEOMETRY[type], MATERIALS[type], maxEnemies * perEnemy[type]);
      mesh.name = `Enemy_${type}`;
      mesh.castShadow = type !== 'eyes';
      mesh.receiveShadow = true;
      // Positionen ändern sich jedes Frame; die wenigen Draw Calls lohnen kein Culling.
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      if (MATERIALS[type] === skin) mesh.setColorAt(0, this.color.set(0xffffff));
      this.meshes.set(type, mesh);
      this.group.add(mesh);
    }
  }

  /** Schreibt die Posen aller übergebenen Rigs in die Instanced Meshes. */
  render(rigs: { rig: EnemyRig; tone: number }[]): void {
    for (const type of this.meshes.keys()) this.counts.set(type, 0);
    for (const { rig, tone } of rigs) {
      this.color.set(SKIN_TONES[tone % SKIN_TONES.length]);
      for (const part of rig.parts) {
        const mesh = this.meshes.get(part.type)!;
        const slot = this.counts.get(part.type)!;
        if (slot >= mesh.instanceMatrix.count) continue;
        mesh.setMatrixAt(slot, part.bone.matrixWorld);
        if (mesh.instanceColor) mesh.setColorAt(slot, this.color);
        this.counts.set(part.type, slot + 1);
      }
    }
    for (const [type, mesh] of this.meshes) {
      mesh.count = this.counts.get(type)!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
