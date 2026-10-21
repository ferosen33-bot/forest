import * as THREE from 'three';
import { PART_GEOMETRY, type EnemyRig, type PartType } from './EnemyRig';
import { RigRenderer } from '../RigRenderer';
import { ENEMY_KINDS, type EnemyKind } from './EnemyKinds';

const skin = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
const MATERIALS: Record<PartType, THREE.Material> = {
  torso: skin,
  head: skin,
  upperArm: skin,
  forearm: skin,
  thigh: skin,
  shin: skin,
  // Leuchtende Augen – nachts das Erste, was man von ihnen sieht.
  eyes: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb070).multiplyScalar(2.5) }),
  hips: new THREE.MeshStandardMaterial({ color: 0x3e3226, roughness: 1, flatShading: true }),
  club: new THREE.MeshStandardMaterial({ color: 0x4f3a26, roughness: 0.95, flatShading: true }),
};

/** Hautfarben je Gegnertyp – pro Gegner leicht variiert. */
const SKIN_TONES = Object.fromEntries(
  Object.values(ENEMY_KINDS).map((k) => [k.kind, k.tones.map((c) => new THREE.Color(c))]),
) as Record<EnemyKind, THREE.Color[]>;

/** Alle Schrate: ≈ 9 Draw Calls, egal wie viele unterwegs sind. */
export class EnemyRenderer {
  private readonly rigs: RigRenderer<PartType>;

  constructor(maxEnemies: number) {
    this.rigs = new RigRenderer<PartType>(
      {
        name: 'Enemies',
        geometry: PART_GEOMETRY,
        materials: MATERIALS,
        perEntity: { torso: 1, head: 1, eyes: 1, hips: 1, upperArm: 2, forearm: 2, thigh: 2, shin: 2, club: 1 },
        tinted: new Set<PartType>(['torso', 'head', 'upperArm', 'forearm', 'thigh', 'shin']),
        noShadow: new Set<PartType>(['eyes']),
      },
      maxEnemies,
    );
  }

  get group(): THREE.Group {
    return this.rigs.group;
  }

  render(enemies: { rig: EnemyRig; tone: number; kind: EnemyKind }[]): void {
    this.rigs.render(
      enemies.map(({ rig, tone, kind }) => {
        const tones = SKIN_TONES[kind];
        return { parts: rig.parts, tint: tones[tone % tones.length] };
      }),
    );
  }
}
