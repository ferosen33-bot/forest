import * as THREE from 'three';
import { smoothstep } from '../utils/math';
import type { RockModel } from './RockModels';
import { HeightMap } from './HeightMap';
import { Terrain } from './Terrain';
import { Water } from './Water';
import { Vegetation } from './Vegetation';
import { Grass } from './Grass';
import { BiomeDecor } from './BiomeDecor';
import { placeGround, type PlaceSite } from './Places';
import type { Physics } from '../core/Physics';
import type { GameConfig } from '../config';
import { urbanAt, type TownLayout } from './Town';
import type { RoadNetwork } from './Roads';
import { planIsland } from './IslandPlan';
import type { Landmark } from './Landmarks';
import { buildRoadMeshes } from './RoadMeshes';
import { harborGrass, type HarborLayout } from './Harbor';

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
  /** Kleine Orte: Gehöfte, Moorwinkel, Campingplatz, Sägewerk (seit Meilenstein 52). */
  readonly hamlets: TownLayout[];
  /** Landstraßen und Schotterwege. */
  readonly roads: RoadNetwork;
  /** Masten, Pfosten, Autos, Wegweiser und Ortsschilder an den Wegen. */
  readonly roadside: TownLayout;
  /** Fundorte im Wald (Hochsitze, Zeltlager, Wegkreuze …) und ihre Requisiten. */
  readonly landmarks: Landmark[];
  readonly wild: TownLayout;
  /** Fahrbahnen (Bänder über dem Gelände). */
  readonly roadGroup: THREE.Group;

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
    const plan = planIsland(this.heightMap, seed);
    ({ town: this.town, harbor: this.harbor, places: this.places, hamlets: this.hamlets, roads: this.roads, roadside: this.roadside, landmarks: this.landmarks, wild: this.wild } =
      plan);
    const landmarks = this.landmarks;
    const { town, harbor, places, hamlets, roads, spawn } = plan;
    /** Fahrbahn plus Bankett (für Bodenfarbe und freie Flächen). */
    const roadEdge = (x: number, z: number, extra: number) => roads.distance(x, z, 8) < 3.2 + extra;
    const urban = (x: number, z: number) => {
      let u = Math.max(town ? urbanAt(town, x, z) : 0, placeGround(places, x, z));
      for (const h of hamlets) if (u < 1) u = Math.max(u, urbanAt(h, x, z));
      if (u < 0.85) {
        const d = roads.distance(x, z, 8);
        if (d < 6) u = Math.max(u, 0.85 * (1 - smoothstep(2, 6, d)));
      }
      return u;
    };
    physics.addTerrain(this.heightMap);
    const tHeight = performance.now() - t;

    t = performance.now();
    this.terrain = new Terrain(this.heightMap, world.chunkSize, seed, urban);
    scene.add(this.terrain.group);
    this.roadGroup = buildRoadMeshes(roads, this.heightMap, seed);
    scene.add(this.roadGroup);
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
        ...hamlets.map((h) => ({ x: h.center.x, z: h.center.z, radius: h.radius + 4 })),
        ...landmarks.map((l) => ({ x: l.x, z: l.z, radius: l.radius })),
        ...places.map((p) => ({
          x: p.position.x,
          z: p.position.z,
          // Hain: keine gesunden Bäume darin; Wasserfall: der Wald reicht bis ans Becken.
          radius: p.kind === 'mine' ? 10 : p.kind === 'grove' ? 24 : p.kind === 'falls' ? 9 : p.radius * 0.6,
        })),
        // Zechenhof vor dem Mundloch
        ...places
          .filter((p) => p.kind === 'mine')
          .map((p) => ({ x: p.position.x - Math.sin(p.yaw) * 13, z: p.position.z - Math.cos(p.yaw) * 13, radius: 15 })),
      ],
      exclude: (x, z) => roadEdge(x, z, 1.8),
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
              (1 - Math.min(1, urban(x, z) * 1.1)) * (harbor ? harborGrass(harbor, x, z) : 1) * (1 - smoothstep(70, 88, this.heightMap.heightAt(x, z))),
          })
        : null;
    if (this.grass) scene.add(this.grass.mesh);

    t = performance.now();
    this.decor = new BiomeDecor(this.heightMap, physics, seed, [
      { x: spawn.x, z: spawn.z, radius: 9 },
      ...(town ? [{ x: town.center.x, z: town.center.z, radius: town.radius + 6 }] : []),
      ...(harbor ? [{ x: harbor.center.x, z: harbor.center.z, radius: 30 }] : []),
      ...hamlets.map((h) => ({ x: h.center.x, z: h.center.z, radius: h.radius + 8 })),
      ...landmarks.map((l) => ({ x: l.x, z: l.z, radius: l.radius + 1 })),
      ...places.map((p) => ({ x: p.position.x, z: p.position.z, radius: p.radius })),
    ], (x, z) => roadEdge(x, z, 2.5));
    scene.add(this.decor.group);
    const tDecor = performance.now() - t;

    console.info(
      `[World] Höhenkarte ${tHeight.toFixed(0)} ms · Terrain ${tTerrain.toFixed(0)} ms · ` +
        `Vegetation ${tVeg.toFixed(0)} ms · Gebiete ${tDecor.toFixed(0)} ms`,
      this.vegetation.counts,
      this.decor.counts,
    );
  }

  /** In Höhlen wird die Oberwelt nicht gezeichnet (sie wäre ohnehin von Fels verdeckt). */
  setSurfaceVisible(visible: boolean): void {
    this.terrain.group.visible = visible;
    this.roadGroup.visible = visible;
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
