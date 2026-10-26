import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Blood } from './Blood';

/** Ebener Boden bei y = `ground`; der Strahl trifft ihn, wenn er ihn innerhalb von maxDist kreuzt. */
function flatGround(ground = 0) {
  return (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => {
    if (dir.y >= 0) return null;
    const t = (origin.y - ground) / -dir.y;
    if (t < 0 || t > maxDist) return null;
    return { point: origin.clone().addScaledVector(dir, t), normal: new THREE.Vector3(0, 1, 0) };
  };
}

const decals = (b: Blood) => (b as unknown as { decalMesh: THREE.InstancedMesh }).decalMesh.count;

describe('Blood', () => {
  it('Tropfen fliegen, landen am Boden und hinterlassen Flecken', () => {
    const blood = new Blood({ raycast: flatGround(0), waterLevel: -10 });
    blood.spray(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(1, 0, 0), 1);
    const first = decals(blood);
    expect(first).toBeGreaterThan(0); // Tropfen direkt unter der Wunde
    for (let i = 0; i < 120; i++) blood.update(1 / 60);
    expect(decals(blood)).toBeGreaterThan(first + 5);
  });

  it('Lache breitet sich aus, über Wasser bleibt nichts liegen', () => {
    const blood = new Blood({ raycast: flatGround(0), waterLevel: -10 });
    blood.pool(new THREE.Vector3(3, 0, 3), 1.5);
    expect(decals(blood)).toBe(1);
    const wet = new Blood({ raycast: flatGround(0), waterLevel: 1 });
    wet.pool(new THREE.Vector3(3, 0, 3));
    wet.spray(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), 0.5);
    for (let i = 0; i < 120; i++) wet.update(1 / 60);
    expect(decals(wet)).toBe(0);
  });
});
