import * as THREE from 'three';
import { HeightMap } from './HeightMap';
import { Terrain } from './Terrain';
import { Water } from './Water';
import { Vegetation } from './Vegetation';
import type { Physics } from '../core/Physics';
import type { GameConfig } from '../config';

/**
 * Bündelt alle statischen Welt-Bestandteile: Höhenkarte, Terrain, Wasser, Vegetation.
 * Die Erzeugung ist vollständig deterministisch aus `config.seed`.
 */
export class World {
  readonly heightMap: HeightMap;
  readonly terrain: Terrain;
  readonly water: Water;
  readonly vegetation: Vegetation;
  readonly spawnPoint: THREE.Vector3;

  constructor(scene: THREE.Scene, physics: Physics, config: GameConfig) {
    const { world, seed } = config;

    let t = performance.now();
    this.heightMap = new HeightMap({
      size: world.size,
      cellSize: world.cellSize,
      seed,
      waterLevel: world.waterLevel,
    });
    physics.addTerrain(this.heightMap);
    const tHeight = performance.now() - t;

    t = performance.now();
    this.terrain = new Terrain(this.heightMap, world.chunkSize, seed);
    scene.add(this.terrain.group);
    const tTerrain = performance.now() - t;

    this.water = new Water(world.waterLevel);
    scene.add(this.water.mesh);

    const spawn = this.findSpawn();
    this.spawnPoint = new THREE.Vector3(spawn.x, this.heightMap.heightAt(spawn.x, spawn.z), spawn.z);

    t = performance.now();
    this.vegetation = new Vegetation(this.heightMap, physics, {
      seed,
      cellSize: world.vegetationCellSize,
      cullDistance: config.graphics.vegetationDistance,
      clearings: [{ x: spawn.x, z: spawn.z, radius: 7 }],
    });
    scene.add(this.vegetation.group);
    const tVeg = performance.now() - t;

    console.info(
      `[World] Höhenkarte ${tHeight.toFixed(0)} ms · Terrain ${tTerrain.toFixed(0)} ms · ` +
        `Vegetation ${tVeg.toFixed(0)} ms`,
      this.vegetation.counts,
    );
  }

  /**
   * Sucht einen flachen Spawnpunkt im Wald nahe der Südküste:
   * trocken, nicht zu hoch, kaum Gefälle.
   */
  private findSpawn(): { x: number; z: number } {
    const hm = this.heightMap;
    const prefX = 0;
    const prefZ = hm.half * 0.42;
    const n: [number, number, number] = [0, 1, 0];
    let best = { x: prefX, z: prefZ };
    let bestScore = Infinity;

    for (let z = -hm.half * 0.8; z <= hm.half * 0.8; z += 6) {
      for (let x = -hm.half * 0.8; x <= hm.half * 0.8; x += 6) {
        const h = hm.heightAt(x, z);
        if (h < hm.waterLevel + 4 || h > 18) continue;
        hm.normalAt(x, z, n);
        if (n[1] < 0.97) continue;
        const score = Math.hypot(x - prefX, z - prefZ) + (1 - n[1]) * 500;
        if (score < bestScore) {
          bestScore = score;
          best = { x, z };
        }
      }
    }
    return best;
  }

  update(elapsed: number, focus: THREE.Vector3): void {
    this.water.update(elapsed);
    this.water.follow(focus.x, focus.z);
    this.vegetation.update(elapsed, focus);
  }
}
