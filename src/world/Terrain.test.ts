import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HeightMap } from './HeightMap';
import { Terrain, TERRAIN_LODS } from './Terrain';

const hm = new HeightMap({ size: 512, cellSize: 2, seed: 3, waterLevel: 0 });
const terrain = new Terrain(hm, 128, 3);
const meshes = terrain.group.children as THREE.Mesh[];

describe('Terrain-LOD', () => {
  it('erzeugt pro Chunk alle Stufen, anfangs nur die volle Auflösung sichtbar', () => {
    expect(meshes.length).toBe(16 * TERRAIN_LODS.length);
    expect(meshes.filter((m) => m.visible).length).toBe(16);
    expect(terrain.lodHistogram).toEqual([16, 0, 0, 0]);
  });

  it('alle Stufen liegen exakt auf den Samples der Höhenkarte', () => {
    for (const m of meshes) {
      const pos = m.geometry.getAttribute('position');
      // Nur Gitterpunkte prüfen (die Schürze hängt bewusst darunter).
      const step = TERRAIN_LODS[Number(m.name.slice(-1))].step;
      const verts = 128 / 2 / step + 1;
      for (let i = 0; i < verts * verts; i += 7) {
        const x = pos.getX(i) + m.position.x;
        const z = pos.getZ(i) + m.position.z;
        expect(pos.getY(i)).toBeCloseTo(hm.heightAt(x, z), 4);
      }
      // Schürze: unterhalb des Randes
      for (let i = verts * verts; i < pos.count; i += 5) {
        const x = pos.getX(i) + m.position.x;
        const z = pos.getZ(i) + m.position.z;
        expect(pos.getY(i)).toBeLessThan(hm.heightAt(x, z) - 1);
      }
    }
  });

  it('wählt die Stufe nach Entfernung (mit Hysterese)', () => {
    terrain.update(new THREE.Vector3(-200, 0, -200));
    const h = terrain.lodHistogram;
    expect(h[0]).toBeGreaterThan(0);
    expect(h[1] + h[2]).toBeGreaterThan(0);
    expect(meshes.filter((m) => m.visible).length).toBe(16);
    // Ein Chunk knapp hinter der Grenze bleibt fein, bis die Hysterese überschritten ist.
    terrain.update(new THREE.Vector3(10000, 0, 10000));
    expect(terrain.lodHistogram[TERRAIN_LODS.length - 1]).toBe(16);
    // Zurück in der Mitte: die vier Eck-Chunks sind ≈ 181 m entfernt → Stufe 1.
    terrain.update(new THREE.Vector3(0, 0, 0));
    expect(terrain.lodHistogram).toEqual([12, 4, 0, 0]);
  });
});
