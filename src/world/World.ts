import * as THREE from 'three';
import { smoothstep } from '../utils/math';
import type { RockModel } from './RockModels';
import { HeightMap } from './HeightMap';
import { Terrain } from './Terrain';
import { Water } from './Water';
import { Vegetation } from './Vegetation';
import { Grass } from './Grass';
import { BiomeDecor } from './BiomeDecor';
import { placeGround, placeSites, type PlaceSite } from './Places';
import type { Physics } from '../core/Physics';
import type { GameConfig } from '../config';
import { findTownSite, generateTown, TOWN_FLAT_BLEND, TOWN_FLAT_RADIUS, urbanAt, type TownLayout } from './Town';
import { findHarborSite, generateHarbor, HARBOR_FLAT_BLEND, HARBOR_FLAT_RADIUS, harborGrass, type HarborLayout } from './Harbor';

/**
 * Bündelt alle statischen Welt-Bestandteile: Höhenkarte, Terrain, Wasser, Vegetation.
 * Die Erzeugung ist vollständig deterministisch aus `config.seed`.
 */
export class World {
  readonly heightMap: HeightMap;
  readonly terrain: Terrain;
  readonly water: Water;
  readonly vegetation: Vegetation;
  readonly grass: Grass | null;
  /** Tote Bäume, Stämme und Schilf (Sumpf, Ufer). */
  readonly decor: BiomeDecor;
  /** Besondere Orte: Absturzstelle, Zeche, Hütte im Moor, Funkstation. */
  readonly places: PlaceSite[];
  readonly spawnPoint: THREE.Vector3;
  /** Die verlassene Kleinstadt (null, falls die Insel keinen Platz bietet). */
  readonly town: TownLayout | null;
  /** Die Nordbucht mit Leuchtturm und dem Lager der Überlebenden. */
  readonly harbor: HarborLayout | null;

  /** @param rocks fotogescannte Felsen (vorab geladen, da ihre Form die Kollision bestimmt). */
  constructor(scene: THREE.Scene, physics: Physics, config: GameConfig, rocks: RockModel[] = []) {
    const { world, seed } = config;

    let t = performance.now();
    this.heightMap = new HeightMap({
      size: world.size,
      cellSize: world.cellSize,
      seed,
      waterLevel: world.waterLevel,
    });
    // Bauplatz der Stadt einebnen – vor Physik und Gelände-Mesh, damit beide dieselben Höhen sehen.
    const site = findTownSite(this.heightMap, seed);
    this.town = site ? generateTown(seed, site) : null;
    if (site) this.heightMap.flatten(site.x, site.z, TOWN_FLAT_RADIUS, TOWN_FLAT_BLEND, site.y);
    const town = this.town;
    const harborSite = findHarborSite(this.heightMap, seed, town ? [{ x: town.center.x, z: town.center.z, radius: town.radius + 150 }] : []);
    if (harborSite) this.heightMap.flatten(harborSite.x, harborSite.z, HARBOR_FLAT_RADIUS, HARBOR_FLAT_BLEND, harborSite.y);
    this.harbor = harborSite ? generateHarbor(this.heightMap, harborSite) : null;
    const harbor = this.harbor;
    // Bauplätze der besonderen Orte (eingeebnet, bevor Gelände und Physik entstehen).
    const spawn = this.findSpawn();
    this.places = placeSites(this.heightMap, seed, [
      { x: spawn.x, z: spawn.z, radius: 200 },
      ...(town ? [{ x: town.center.x, z: town.center.z, radius: town.radius + 60 }] : []),
      ...(harbor ? [{ x: harbor.center.x, z: harbor.center.z, radius: 90 }] : []),
    ], town ? { x: town.center.x, z: town.center.z } : null);
    const places = this.places;
    const urban = (x: number, z: number) => Math.max(town ? urbanAt(town, x, z) : 0, placeGround(places, x, z));
    physics.addTerrain(this.heightMap);
    const tHeight = performance.now() - t;

    t = performance.now();
    this.terrain = new Terrain(this.heightMap, world.chunkSize, seed, urban);
    scene.add(this.terrain.group);
    const tTerrain = performance.now() - t;

    this.water = new Water(world.waterLevel, this.heightMap);
    scene.add(this.water.mesh);

    this.spawnPoint = new THREE.Vector3(spawn.x, this.heightMap.heightAt(spawn.x, spawn.z), spawn.z);

    t = performance.now();
    this.vegetation = new Vegetation(this.heightMap, physics, {
      seed,
      cellSize: world.vegetationCellSize,
      cullDistance: config.graphics.vegetationDistance,
      rocks,
      clearings: [
        { x: spawn.x, z: spawn.z, radius: 7 },
        ...(town ? [{ x: town.center.x, z: town.center.z, radius: town.radius + 4 }] : []),
        ...(harbor ? [{ x: harbor.center.x, z: harbor.center.z, radius: 24 }] : []),
        ...places.map((p) => ({ x: p.position.x, z: p.position.z, radius: p.kind === 'mine' ? 10 : p.radius * 0.6 })),
        // Zechenhof vor dem Mundloch
        ...places
          .filter((p) => p.kind === 'mine')
          .map((p) => ({ x: p.position.x - Math.sin(p.yaw) * 13, z: p.position.z - Math.cos(p.yaw) * 13, radius: 15 })),
      ],
    });
    scene.add(this.vegetation.group);
    const tVeg = performance.now() - t;

    const g = config.graphics;
    this.grass =
      g.grassRadius > 0
        ? new Grass(this.heightMap, {
            seed,
            radius: g.grassRadius,
            spacing: g.grassSpacing,
            // Kein Gras auf Schnee und kahlem Fels der Gipfel.
            density: (x, z) =>
              (urban ? 1 - urban(x, z) : 1) * (harbor ? harborGrass(harbor, x, z) : 1) * (1 - smoothstep(70, 88, this.heightMap.heightAt(x, z))),
          })
        : null;
    if (this.grass) scene.add(this.grass.mesh);

    t = performance.now();
    this.decor = new BiomeDecor(this.heightMap, physics, seed, [
      { x: spawn.x, z: spawn.z, radius: 9 },
      ...(town ? [{ x: town.center.x, z: town.center.z, radius: town.radius + 6 }] : []),
      ...(harbor ? [{ x: harbor.center.x, z: harbor.center.z, radius: 30 }] : []),
      ...places.map((p) => ({ x: p.position.x, z: p.position.z, radius: p.radius })),
    ]);
    scene.add(this.decor.group);
    const tDecor = performance.now() - t;

    console.info(
      `[World] Höhenkarte ${tHeight.toFixed(0)} ms · Terrain ${tTerrain.toFixed(0)} ms · ` +
        `Vegetation ${tVeg.toFixed(0)} ms · Gebiete ${tDecor.toFixed(0)} ms`,
      this.vegetation.counts,
      this.decor.counts,
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

  /** In Höhlen wird die Oberwelt nicht gezeichnet (sie wäre ohnehin von Fels verdeckt). */
  setSurfaceVisible(visible: boolean): void {
    this.terrain.group.visible = visible;
    this.water.mesh.visible = visible;
    this.vegetation.group.visible = visible;
    if (this.grass) this.grass.mesh.visible = visible;
    this.decor.group.visible = visible;
  }

  update(dt: number, elapsed: number, focus: THREE.Vector3): void {
    this.water.update(elapsed);
    this.water.follow(focus.x, focus.z);
    this.terrain.update(focus);
    this.vegetation.update(dt, elapsed, focus);
    this.grass?.update(elapsed, focus);
    this.decor.update(elapsed, focus);
  }
}
