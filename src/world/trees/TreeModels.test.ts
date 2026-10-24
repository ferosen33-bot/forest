import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createTreeModel, triangleCount } from './TreeModels';

describe('TreeModels', () => {
  it('bush: kleines Dreiecksbudget, richtige Höhe', () => {
    const m = createTreeModel('bush', 0);
    expect(triangleCount(m)).toBeLessThan(2600);
    const box = new THREE.Box3().setFromBufferAttribute(m.leaves.getAttribute('position') as THREE.BufferAttribute);
    box.union(new THREE.Box3().setFromBufferAttribute(m.bark.getAttribute('position') as THREE.BufferAttribute));
    expect(box.max.y - box.min.y).toBeCloseTo(1.5, 1);
  });

  for (const kind of ['pine', 'broadleaf'] as const) {
    it(`${kind}: im Dreiecksbudget, richtige Höhe, Stamm am Ursprung`, () => {
      const m = createTreeModel(kind, 0);
      const tris = triangleCount(m);
      expect(tris).toBeGreaterThan(1000);
      expect(tris).toBeLessThan(6500);
      const box = new THREE.Box3().setFromBufferAttribute(m.bark.getAttribute('position') as THREE.BufferAttribute);
      box.union(new THREE.Box3().setFromBufferAttribute(m.leaves.getAttribute('position') as THREE.BufferAttribute));
      expect(box.max.y - box.min.y).toBeCloseTo(kind === 'pine' ? 10 : 8.6, 1);
      expect(Math.abs(box.min.y)).toBeLessThan(0.5);
      // Stamm steht senkrecht über dem Ursprung
      const p = m.bark.getAttribute('position');
      // Stammradius passend zum Kollider (0,28 bzw. 0,34 m)
      const r = Math.hypot(p.getX(0), p.getZ(0));
      expect(r).toBeGreaterThan(0.2);
      expect(r).toBeLessThan(0.45);
    });
  }

  it('ist deterministisch und Varianten unterscheiden sich', () => {
    const a = createTreeModel('pine', 0);
    const b = createTreeModel('pine', 0);
    const c = createTreeModel('pine', 1);
    expect(Array.from(a.leaves.getAttribute('position').array.slice(0, 30))).toEqual(Array.from(b.leaves.getAttribute('position').array.slice(0, 30)));
    expect(Array.from(c.leaves.getAttribute('position').array.slice(0, 30))).not.toEqual(Array.from(a.leaves.getAttribute('position').array.slice(0, 30)));
  });
});
