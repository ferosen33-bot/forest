import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import type { HeightMap } from './HeightMap';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import { deriveSeed, mulberry32, randRange, type RandomFn } from '../utils/random';
import { injectSeason } from './SeasonShader';
import { injectSurface, surfaceLayer } from './SurfaceTextures';
import { smoothstep } from '../utils/math';
import {
  createBerryGeometry,
  createBroadleafGeometry,
  createBushGeometry,
  createPebbleGeometry,
  createPineGeometry,
  createRockGeometry,
  createStickGeometry,
} from './VegetationGeometry';
import type { RockModel } from './RockModels';
import { createBarkMaterial, createLeafMaterial, createTreeModel, type TreeKind, type TreeModel } from './trees/TreeModels';

/** Bäume: Rinde an Stamm und Ästen (am fehlenden Grünanteil erkannt), feine Blattstruktur in den Kronen. */
const TREE_SURFACE = /* glsl */ `
#ifdef USE_COLOR
  float treeLeaf = smoothstep(0.015, 0.08, vColor.g - vColor.r);
#else
  float treeLeaf = 1.0;
#endif
vec3 barkD = surfTriplanar(${surfaceLayer('bark')}, surfP, surfGeo, surfN, 1.0 - treeLeaf);
vec3 leafD = surfTriplanar(${surfaceLayer('forestFloor')}, surfP * 1.8, surfGeo, surfN, treeLeaf * 0.5);
diffuseColor.rgb = surfApply(surfBase, mix(barkD, leafD, treeLeaf), mix(0.45, 0.0, treeLeaf));
`;

/** Felsen: bemooster Stein, dreiachsig. */
const ROCK_SURFACE = /* glsl */ `
vec3 rockD = surfTriplanar(${surfaceLayer('mossyRock')}, surfP, surfGeo, surfN, 1.0);
diffuseColor.rgb = surfApply(surfBase, rockD, 0.55);
`;

/**
 * - `pine`, `broadleaf`: fällbare Bäume
 * - `rock`: Felsen, an denen Steine abgeschlagen werden
 * - `bush`: Büsche, manche tragen Beeren (`berries`, eigene Instanz auf dem Busch)
 * - `stick`, `pebble`: am Boden liegende, aufsammelbare Rohstoffe
 */
export type VegetationKind = 'pine' | 'broadleaf' | 'bush' | 'rock' | 'berries' | 'stick' | 'pebble';

export const isTree = (kind: VegetationKind): kind is 'pine' | 'broadleaf' => kind === 'pine' || kind === 'broadleaf';

/** Ein einzelnes platziertes Objekt; Grundlage für Fällen, Abbauen und Ernten. */
export interface VegetationInstance {
  readonly id: number;
  readonly kind: VegetationKind;
  readonly position: THREE.Vector3;
  readonly scale: THREE.Vector3;
  readonly rotationY: number;
  readonly tilt: THREE.Euler;
  /** Instanced-Mesh-Slot, in dem dieses Objekt gerendert wird. */
  readonly mesh: THREE.InstancedMesh;
  readonly slot: number;
  collider: RAPIER.Collider | null;
  alive: boolean;
  /** Nur Büsche: zugehörige Beeren-Instanz (null = Busch ohne Beeren). */
  berries: VegetationInstance | null;
  /** Bäume: dieselbe Instanz in den realistischen Nah-Meshes (Rinde, Blätter). */
  near: { mesh: THREE.InstancedMesh; slot: number }[];
  /** Felsen: Index des fotogescannten Modells. */
  readonly variant: number;
}

export interface VegetationSave {
  removed: number[];
  /** [Busch-ID, Sekunden bis die Beeren nachwachsen] */
  regrow: [number, number][];
}

export interface VegetationOptions {
  seed: number;
  /** Kantenlänge einer Render-Zelle in Metern. */
  cellSize: number;
  /** Zellen, deren Mittelpunkt weiter entfernt ist, werden ausgeblendet. */
  cullDistance: number;
  /** Bereiche, die frei bleiben sollen (z. B. Spawnpunkt). */
  clearings: { x: number; z: number; radius: number }[];
  /** Fotogescannte Felsen (fehlen sie, bleiben die einfachen Formen). */
  rocks?: RockModel[];
}

interface Placement {
  kind: VegetationKind;
  position: THREE.Vector3;
  scale: THREE.Vector3;
  rotationY: number;
  tilt: THREE.Euler;
  /** Für Beeren: der Busch, auf dem sie wachsen. */
  parent?: Placement;
}

const KINDS: VegetationKind[] = ['pine', 'broadleaf', 'bush', 'rock', 'berries', 'stick', 'pebble'];

/** Diese Arten werfen Schatten (kleine Objekte nicht – spart Shadow-Pass-Kosten). */
const CASTS_SHADOW = new Set<VegetationKind>(['pine', 'broadleaf', 'rock']);

/** Kleine Details: werden schon in geringer Entfernung ausgeblendet (wären dort nur Pixel). */
const DETAIL_KINDS = new Set<VegetationKind>(['berries', 'stick', 'pebble']);
const DETAIL_DISTANCE = 90;

/** Varianten der realistischen Nahbäume je Art. */
const TREE_VARIANTS = 2;

/** Nachwachszeit für Beeren in Spielsekunden. */
const BERRY_REGROW_TIME = 360;

/** Eine Render-Zelle: alle Instanced Meshes eines Quadrats der Welt. */
interface VegetationCell {
  group: THREE.Group;
  /** Meshes kleiner Details (Beeren, Äste, Steinchen) mit kürzerer Sichtweite. */
  details: THREE.InstancedMesh[];
  /** Bäume: einfache Fernformen bzw. realistische Nahmodelle (Rinde + Blätter). */
  farTrees: THREE.InstancedMesh[];
  nearTrees: THREE.InstancedMesh[];
  centerX: number;
  centerZ: number;
}

interface Shake {
  instance: VegetationInstance;
  time: number;
  axis: THREE.Vector3;
  strength: number;
}

/**
 * Prozedurale Vegetation: Bäume, Büsche, Felsen und Bodenfunde.
 *
 * - Platzierung per Jittered-Grid + Dichte-Rauschen (Waldgebiete, Lichtungen).
 * - Rendering per InstancedMesh, gruppiert nach Zellen, damit Frustum-Culling für
 *   Kamera und Schattenkamera greift; zusätzlich Distanz-Culling (Zellen im Nebel).
 * - Bäume und Felsen erhalten statische Collider; Beerenbüsche und Bodenfunde
 *   Sensor-Collider, damit sie per Raycast anvisiert, aber durchlaufen werden können.
 */
export class Vegetation {
  readonly group = new THREE.Group();
  readonly instances: VegetationInstance[] = [];
  readonly counts: Record<VegetationKind, number> = {
    pine: 0,
    broadleaf: 0,
    bush: 0,
    rock: 0,
    berries: 0,
    stick: 0,
    pebble: 0,
  };

  private readonly byCollider = new Map<number, VegetationInstance>();
  private readonly cells: VegetationCell[] = [];
  private readonly windUniforms = { uTime: { value: 0 }, uWind: { value: 0.018 } };
  private readonly geometries: Record<VegetationKind, THREE.BufferGeometry>;
  private readonly materials: {
    foliage: THREE.MeshStandardMaterial;
    broadleaf: THREE.MeshStandardMaterial;
    rock: THREE.MeshStandardMaterial;
  };
  /** Realistische Nahbäume: Varianten je Art und ihre Materialien. */
  private readonly treeModels: Record<TreeKind, TreeModel[]>;
  private readonly treeMaterials: Record<TreeKind, { bark: THREE.MeshStandardMaterial; leaves: THREE.MeshStandardMaterial }>;
  /** Bis zu dieser Entfernung (zum Zellrand) zeigen Zellen die realistischen Bäume; 0 = aus. */
  nearTreeDistance = 60;
  private readonly rockHull: Float32Array;
  private readonly rocks: RockModel[];
  private readonly shakes: Shake[] = [];
  private readonly regrowQueue: { bush: VegetationInstance; at: number }[] = [];
  private elapsed = 0;

  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpQuat2 = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler();

  constructor(
    private readonly heightMap: HeightMap,
    private readonly physics: Physics,
    private readonly opts: VegetationOptions,
  ) {
    this.group.name = 'Vegetation';

    this.geometries = {
      pine: createPineGeometry(),
      broadleaf: createBroadleafGeometry(),
      bush: createBushGeometry(),
      rock: createRockGeometry(),
      berries: createBerryGeometry(),
      stick: createStickGeometry(),
      pebble: createPebbleGeometry(),
    };
    this.rockHull = this.geometries.rock.getAttribute('position').array as Float32Array;
    this.rocks = opts.rocks ?? [];

    // Fernformen etwas dunkler, damit sie zu den realistischen Nahbäumen (Foto-Laub) passen.
    const foliage = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, color: 0xa8b0a0 });
    this.injectWind(foliage);
    // Laubbäume: eigenes Material, damit nur sie sich im Herbst verfärben und im Winter kahl werden.
    const broadleaf = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, color: 0xa8b0a0 });
    broadleaf.defines = { BROADLEAF: '' };
    this.injectWind(broadleaf);
    const rock = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
    rock.onBeforeCompile = (shader) => {
      injectSeason(shader, { snowBias: 0.1 });
      injectSurface(shader, ROCK_SURFACE, 1.2);
    };
    this.materials = { foliage, broadleaf, rock };

    this.treeModels = {
      pine: Array.from({ length: TREE_VARIANTS }, (_, v) => createTreeModel('pine', v)),
      broadleaf: Array.from({ length: TREE_VARIANTS }, (_, v) => createTreeModel('broadleaf', v)),
      bush: Array.from({ length: TREE_VARIANTS }, (_, v) => createTreeModel('bush', v)),
    };
    const treeMaterials = (kind: TreeKind) => {
      const bark = createBarkMaterial(kind);
      const leaves = createLeafMaterial(kind);
      if (kind !== 'pine') leaves.defines = { BROADLEAF: '' };
      this.injectWind(bark, false);
      this.injectWind(leaves, false);
      bark.customProgramCacheKey = () => `tree-bark-${kind}`;
      leaves.customProgramCacheKey = () => `tree-leaves-${kind}`;
      return { bark, leaves };
    };
    this.treeMaterials = { pine: treeMaterials('pine'), broadleaf: treeMaterials('broadleaf'), bush: treeMaterials('bush') };

    const placements = this.scatter();
    this.build(placements);
  }

  // ---------------------------------------------------------------------------
  // Platzierung
  // ---------------------------------------------------------------------------

  private scatter(): Placement[][] {
    const hm = this.heightMap;
    const seed = this.opts.seed;
    const forestNoise = createNoise2D(mulberry32(deriveSeed(seed, 'forest')));
    const typeNoise = createNoise2D(mulberry32(deriveSeed(seed, 'forest-type')));
    const rng = mulberry32(deriveSeed(seed, 'vegetation'));
    const water = hm.waterLevel;
    const normal: [number, number, number] = [0, 1, 0];

    const cellsPerSide = this.cellsPerSide;
    const perCell: Placement[][] = Array.from({ length: cellsPerSide * cellsPerSide }, () => []);
    const cellIndex = (x: number, z: number) => {
      const cx = Math.min(cellsPerSide - 1, Math.max(0, Math.floor((x + hm.half) / this.opts.cellSize)));
      const cz = Math.min(cellsPerSide - 1, Math.max(0, Math.floor((z + hm.half) / this.opts.cellSize)));
      return cz * cellsPerSide + cx;
    };
    const inClearing = (x: number, z: number) =>
      this.opts.clearings.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.radius * c.radius);

    /** Waldgebiets-Dichte in [0, 1]: große Wälder mit Lichtungen dazwischen. */
    const forestDensity = (x: number, z: number) => {
      const n = forestNoise(x * 0.006, z * 0.006) * 0.7 + forestNoise(x * 0.02, z * 0.02) * 0.3;
      return smoothstep(-0.35, 0.45, n);
    };

    /** Läuft ein Jittered-Grid über die ganze Insel und ruft `accept` für jeden Kandidaten. */
    const grid = (
      spacing: number,
      accept: (x: number, z: number, h: number, slope: number) => Placement | Placement[] | null,
      allowInClearing = false,
    ) => {
      for (let gz = -hm.half; gz < hm.half; gz += spacing) {
        for (let gx = -hm.half; gx < hm.half; gx += spacing) {
          const x = gx + rng() * spacing;
          const z = gz + rng() * spacing;
          const h = hm.heightAt(x, z);
          if (h < water - 2 || (!allowInClearing && inClearing(x, z))) continue;
          hm.normalAt(x, z, normal);
          const p = accept(x, z, h, 1 - normal[1]);
          if (!p) continue;
          for (const placement of Array.isArray(p) ? p : [p]) perCell[cellIndex(x, z)].push(placement);
        }
      }
    };

    // Bäume
    grid(4.5, (x, z, h, slope) => {
      if (h < water + 1.8 || slope > 0.22) return null;
      const density = forestDensity(x, z) * (1 - smoothstep(40, 52, h));
      if (rng() > density * 0.62) return null;
      // Höhenlagen und bestimmte Regionen werden von Nadelbäumen dominiert.
      const pineChance = smoothstep(-0.4, 0.4, typeNoise(x * 0.004, z * 0.004)) * 0.7 + smoothstep(15, 30, h) * 0.3;
      const kind: VegetationKind = rng() < pineChance ? 'pine' : 'broadleaf';
      const s = randRange(rng, 0.75, 1.45);
      return this.placement(kind, x, h - 0.25, z, s, s * randRange(rng, 0.9, 1.15), s, rng, 0.05);
    });

    // Büsche (bevorzugt am Waldrand); etwa jeder dritte trägt Beeren.
    grid(5, (x, z, h, slope) => {
      if (h < water + 1.0 || slope > 0.3) return null;
      const d = forestDensity(x, z);
      const edge = 1 - Math.abs(d - 0.45) * 2;
      if (rng() > 0.12 + edge * 0.35) return null;
      const s = randRange(rng, 0.6, 1.35);
      const bush = this.placement('bush', x, h - 0.1, z, s, s * randRange(rng, 0.8, 1.1), s, rng, 0.1);
      if (rng() > 0.33) return bush;
      const berries: Placement = { ...bush, kind: 'berries', parent: bush };
      return [bush, berries];
    });

    // Felsen (häufiger an Hängen und im Gebirge, gelegentlich am Strand)
    grid(11, (x, z, h, slope) => {
      const chance = 0.06 + smoothstep(0.1, 0.4, slope) * 0.4 + smoothstep(25, 45, h) * 0.2;
      if (rng() > chance) return null;
      const s = rng() < 0.08 ? randRange(rng, 1.8, 3.2) : randRange(rng, 0.35, 1.2);
      return this.placement(
        'rock',
        x,
        h - s * 0.3,
        z,
        s * randRange(rng, 0.8, 1.3),
        s * randRange(rng, 0.5, 0.85),
        s * randRange(rng, 0.8, 1.3),
        rng,
        0.25,
      );
    });

    // Herumliegende Äste im Wald – auch in der Spawn-Lichtung, damit man sofort etwas findet.
    grid(
      8,
      (x, z, h, slope) => {
        if (h < water + 1.2 || slope > 0.3) return null;
        if (rng() > 0.08 + forestDensity(x, z) * 0.4) return null;
        const s = randRange(rng, 0.85, 1.15);
        return this.placement('stick', x, h, z, s, s, s, rng, 0.08);
      },
      true,
    );

    // Kleine Steine: an Stränden, Hängen und im Gebirge.
    grid(
      10,
      (x, z, h, slope) => {
        if (h < water + 0.3) return null;
        const beach = 1 - smoothstep(1.5, 3.5, h);
        if (rng() > 0.05 + beach * 0.3 + smoothstep(0.15, 0.4, slope) * 0.3) return null;
        const s = randRange(rng, 0.8, 1.3);
        return this.placement('pebble', x, h - 0.02, z, s, s, s, rng, 0.3);
      },
      true,
    );

    return perCell;
  }

  private get cellsPerSide(): number {
    return Math.round(this.heightMap.size / this.opts.cellSize);
  }

  private placement(
    kind: VegetationKind,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rng: RandomFn,
    maxTilt: number,
  ): Placement {
    return {
      kind,
      position: new THREE.Vector3(x, y, z),
      scale: new THREE.Vector3(sx, sy, sz),
      rotationY: rng() * Math.PI * 2,
      tilt: new THREE.Euler((rng() - 0.5) * maxTilt, 0, (rng() - 0.5) * maxTilt),
    };
  }

  // ---------------------------------------------------------------------------
  // Aufbau von Meshes und Collidern
  // ---------------------------------------------------------------------------

  private build(perCell: Placement[][]): void {
    const colorRng = mulberry32(deriveSeed(this.opts.seed, 'vegetation-color'));
    const tint = new THREE.Color();
    const cellsPerSide = this.cellsPerSide;
    const size = this.opts.cellSize;

    perCell.forEach((placements, index) => {
      if (placements.length === 0) return;
      const cell: VegetationCell = {
        group: new THREE.Group(),
        details: [],
        farTrees: [],
        nearTrees: [],
        centerX: ((index % cellsPerSide) + 0.5) * size - this.heightMap.half,
        centerZ: (Math.floor(index / cellsPerSide) + 0.5) * size - this.heightMap.half,
      };
      cell.group.name = `VegetationCell_${index}`;
      this.cells.push(cell);
      this.group.add(cell.group);

      const built = new Map<Placement, VegetationInstance>();

      for (const kind of KINDS) {
        const all = placements.filter((p) => p.kind === kind);
        if (all.length === 0) continue;
        // Fotogescannte Felsen: ein Mesh je Modell (die seltenen, sehr großen Felsen werden Findlinge).
        const groups = kind === 'rock' && this.rocks.length > 0 ? this.rockGroups(all) : [{ list: all, variant: 0 }];
        for (const { list, variant } of groups) {
          const rockModel = kind === 'rock' ? this.rocks[variant] : undefined;
          const mesh = new THREE.InstancedMesh(
            rockModel?.geometry ?? this.geometries[kind],
            rockModel?.material ?? this.materialFor(kind),
            list.length,
          );
          mesh.name = `Vegetation_${kind}_${index}`;
          mesh.castShadow = CASTS_SHADOW.has(kind);
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;

          list.forEach((p, slot) => {
            const instance: VegetationInstance = {
              id: this.instances.length,
              kind,
              position: p.position,
              scale: p.scale,
              rotationY: p.rotationY,
              tilt: p.tilt,
              mesh,
              slot,
              collider: null,
              alive: true,
              berries: null,
              near: [],
              variant,
            };
            mesh.setMatrixAt(slot, this.composeMatrix(instance, this.tmpMatrix));

            // Leichte Farbvariation pro Instanz (multipliziert mit den Vertex-Farben).
            // Beeren behalten die Farbe ihres Busches nicht – sie sollen leuchten.
            const v = kind === 'berries' ? 1 : 0.82 + colorRng() * 0.3;
            tint.setRGB(v * (0.95 + colorRng() * 0.1), v, v * (0.9 + colorRng() * 0.1));
            mesh.setColorAt(slot, tint);

            if (p.parent) {
              const bush = built.get(p.parent);
              if (bush) bush.berries = instance;
            }
            instance.collider = this.createCollider(instance, p.kind === 'bush' && placements.some((o) => o.parent === p));
            if (instance.collider) this.byCollider.set(instance.collider.handle, instance);
            built.set(p, instance);
            this.instances.push(instance);
            this.counts[kind]++;
          });

          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.computeBoundingSphere();
          cell.group.add(mesh);
          if (DETAIL_KINDS.has(kind)) cell.details.push(mesh);
          if (isTree(kind) || kind === 'bush') {
            cell.farTrees.push(mesh);
            this.buildNearTrees(kind, cell, this.instances.slice(this.instances.length - list.length));
          }
        }
      }
    });
  }

  /** Felsen auf die Modelle verteilen: große → Findling, sonst abwechselnd die kleineren Scans. */
  private rockGroups(list: Placement[]): { list: Placement[]; variant: number }[] {
    const small = this.rocks.map((r, i) => (r.boulder ? -1 : i)).filter((i) => i >= 0);
    const boulder = this.rocks.findIndex((r) => r.boulder);
    const groups = this.rocks.map((_, variant) => ({ list: [] as Placement[], variant }));
    list.forEach((p, i) => {
      const v = p.scale.x > 1.7 && boulder >= 0 ? boulder : small[i % small.length];
      groups[v].list.push(p);
    });
    return groups.filter((g) => g.list.length > 0);
  }

  /** Realistische Nahbäume einer Zelle: je Variante ein Rinden- und ein Blatt-Mesh mit denselben Matrizen. */
  private buildNearTrees(kind: TreeKind, cell: VegetationCell, trees: VegetationInstance[]): void {
    const models = this.treeModels[kind];
    const mats = this.treeMaterials[kind];
    models.forEach((model, variant) => {
      const own = trees.filter((t) => t.id % models.length === variant);
      if (own.length === 0) return;
      for (const [geometry, material] of [
        [model.bark, mats.bark],
        [model.leaves, mats.leaves],
      ] as const) {
        const mesh = new THREE.InstancedMesh(geometry, material, own.length);
        mesh.name = `Vegetation_${kind}_near${variant}`;
        // Büsche sind klein und zahlreich – ihre Schatten kosten mehr, als sie bringen.
        mesh.castShadow = kind !== 'bush';
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        own.forEach((t, slot) => {
          mesh.setMatrixAt(slot, this.composeMatrix(t, this.tmpMatrix));
          const c = new THREE.Color();
          t.mesh.getColorAt(t.slot, c);
          mesh.setColorAt(slot, c);
          t.near.push({ mesh, slot });
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        cell.group.add(mesh);
        cell.nearTrees.push(mesh);
      }
    });
  }

  /** Transformationsmatrix einer Instanz (optional mit zusätzlicher Rotation, z. B. beim Wackeln). */
  private composeMatrix(inst: VegetationInstance, out: THREE.Matrix4, extra?: THREE.Quaternion): THREE.Matrix4 {
    this.tmpEuler.set(inst.tilt.x, inst.rotationY, inst.tilt.z, 'YXZ');
    this.tmpQuat.setFromEuler(this.tmpEuler);
    if (extra) this.tmpQuat.premultiply(extra);
    return out.compose(inst.position, this.tmpQuat, inst.scale);
  }

  private createCollider(inst: VegetationInstance, hasBerries: boolean): RAPIER.Collider | null {
    const solid = interactionGroups(CollisionGroup.STATIC);
    const p = inst.position;
    const s = inst.scale;
    let desc: RAPIER.ColliderDesc | null = null;

    switch (inst.kind) {
      case 'pine':
      case 'broadleaf': {
        // Stamm als Zylinder; die Krone ist (wie im Genre üblich) nicht kollidierend.
        const radius = (inst.kind === 'pine' ? 0.28 : 0.34) * s.x;
        const halfHeight = 2.4 * s.y;
        desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
          .setTranslation(p.x, p.y + halfHeight, p.z)
          .setCollisionGroups(solid);
        break;
      }
      case 'rock': {
        // Konvexe Hülle der tatsächlich gerenderten (skalierten, rotierten) Form.
        const hull = this.rocks[inst.variant]?.hull ?? this.rockHull;
        const pts = new Float32Array(hull.length);
        const v = new THREE.Vector3();
        this.tmpEuler.set(inst.tilt.x, inst.rotationY, inst.tilt.z, 'YXZ');
        const q = this.tmpQuat.setFromEuler(this.tmpEuler);
        for (let i = 0; i < pts.length; i += 3) {
          v.set(hull[i], hull[i + 1], hull[i + 2]).multiply(s).applyQuaternion(q);
          pts[i] = v.x;
          pts[i + 1] = v.y;
          pts[i + 2] = v.z;
        }
        desc = RAPIER.ColliderDesc.convexHull(pts);
        desc?.setTranslation(p.x, p.y, p.z).setCollisionGroups(solid);
        break;
      }
      // Sensoren: per Raycast anvisierbar, aber ohne physische Kollision.
      case 'bush':
        if (hasBerries) desc = RAPIER.ColliderDesc.ball(0.75 * s.x).setTranslation(p.x, p.y + 0.5 * s.y, p.z);
        break;
      case 'stick':
        desc = RAPIER.ColliderDesc.ball(0.35).setTranslation(p.x, p.y + 0.08, p.z);
        break;
      case 'pebble':
        desc = RAPIER.ColliderDesc.ball(0.25).setTranslation(p.x, p.y + 0.08, p.z);
        break;
      case 'berries':
        break;
    }

    if (!desc) return null;
    if (inst.kind === 'bush' || inst.kind === 'stick' || inst.kind === 'pebble') {
      desc.setSensor(true).setCollisionGroups(interactionGroups(CollisionGroup.ITEM));
    }
    desc.setFriction(0.7);
    return this.physics.world.createCollider(desc);
  }

  /** Wind: Kronen schwanken abhängig von Höhe über dem Boden und Instanzposition. */
  private injectWind(material: THREE.MeshStandardMaterial, surface = true): void {
    material.onBeforeCompile = (shader) => {
      injectSeason(shader, { foliage: true });
      if (surface) injectSurface(shader, TREE_SURFACE, 1.0);
      shader.uniforms.uTime = this.windUniforms.uTime;
      shader.uniforms.uWind = this.windUniforms.uWind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 instPos = instanceMatrix[3].xyz;
  float sway = max(position.y - 2.0, 0.0) * uWind;
  float phase = uTime * 1.3 + instPos.x * 0.13 + instPos.z * 0.17;
  transformed.x += (sin(phase) + sin(phase * 2.7) * 0.25) * sway;
  transformed.z += cos(phase * 0.8) * sway * 0.6;
#endif`,
        );
    };
  }

  // ---------------------------------------------------------------------------
  // Laufzeit-API
  // ---------------------------------------------------------------------------

  /** Findet das Objekt zu einem Collider (z. B. nach einem Raycast). */
  getByCollider(collider: RAPIER.Collider): VegetationInstance | undefined {
    return this.byCollider.get(collider.handle);
  }

  /**
   * Geometrien und Materialien eines Objekts – z. B. für einen fallenden Baum als Einzel-Mesh.
   * Bäume liefern ihr realistisches Modell (Rinde und Blätter).
   */
  getRenderData(kind: VegetationKind, instance?: VegetationInstance): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
    if (isTree(kind) && this.nearTreeDistance > 0) {
      const models = this.treeModels[kind];
      const model = models[(instance?.id ?? 0) % models.length];
      const mats = this.treeMaterials[kind];
      return [
        { geometry: model.bark, material: mats.bark },
        { geometry: model.leaves, material: mats.leaves },
      ];
    }
    return [{ geometry: this.geometries[kind], material: this.materialFor(kind) }];
  }

  private materialFor(kind: VegetationKind): THREE.MeshStandardMaterial {
    if (kind === 'rock' || kind === 'pebble') return this.materials.rock;
    return kind === 'broadleaf' ? this.materials.broadleaf : this.materials.foliage;
  }

  /** Weltmatrix einer Instanz (z. B. um einen fallenden Baum exakt an ihrer Stelle zu erzeugen). */
  getMatrix(instance: VegetationInstance, out = new THREE.Matrix4()): THREE.Matrix4 {
    return this.composeMatrix(instance, out);
  }

  /**
   * Entfernt ein Objekt aus Welt und Physik (Bäume fällen, Äste aufheben …).
   * Die Instanz wird auf Skalierung 0 gesetzt, statt das InstancedMesh neu aufzubauen.
   */
  remove(instance: VegetationInstance): void {
    if (!instance.alive) return;
    instance.alive = false;
    this.hide(instance);
    if (instance.collider) {
      this.byCollider.delete(instance.collider.handle);
      this.physics.world.removeCollider(instance.collider, false);
      instance.collider = null;
    }
    if (instance.berries) this.remove(instance.berries);
  }

  /** Im Winter sind die Beeren erfroren (nicht pflückbar, wachsen nicht nach). */
  berriesAvailable = true;

  /** Trägt dieser Busch gerade reife Beeren? */
  hasRipeBerries(bush: VegetationInstance): boolean {
    return this.berriesAvailable && bush.alive && bush.berries !== null && bush.berries.alive;
  }

  /** Hat der Busch Beeren, die gerade erfroren sind? */
  hasFrozenBerries(bush: VegetationInstance): boolean {
    return !this.berriesAvailable && bush.alive && bush.berries !== null && bush.berries.alive;
  }

  /** Pflückt die Beeren eines Busches; sie wachsen nach einiger Zeit nach. */
  harvestBerries(bush: VegetationInstance): boolean {
    if (!this.hasRipeBerries(bush) || !bush.berries) return false;
    bush.berries.alive = false;
    this.hide(bush.berries);
    this.regrowQueue.push({ bush, at: this.elapsed + BERRY_REGROW_TIME });
    return true;
  }

  /** Lässt ein Objekt kurz wackeln (Treffer-Feedback). `from` = Richtung, aus der der Schlag kam. */
  shake(instance: VegetationInstance, from: THREE.Vector3, strength = 1): void {
    // Kippachse senkrecht zur Schlagrichtung, damit der Baum vom Spieler weg nickt.
    const axis = new THREE.Vector3(from.z, 0, -from.x).normalize();
    const existing = this.shakes.find((s) => s.instance === instance);
    if (existing) {
      existing.time = 0;
      existing.axis.copy(axis);
      existing.strength = strength;
    } else {
      this.shakes.push({ instance, time: 0, axis, strength });
    }
  }

  private hide(instance: VegetationInstance): void {
    this.writeMatrix(instance, this.tmpMatrix.makeScale(0, 0, 0));
  }

  private restore(instance: VegetationInstance, extra?: THREE.Quaternion): void {
    this.writeMatrix(instance, this.composeMatrix(instance, this.tmpMatrix, extra));
  }

  /** Matrix in alle Darstellungen einer Instanz schreiben (Fernform und Nahmodelle). */
  private writeMatrix(instance: VegetationInstance, m: THREE.Matrix4): void {
    instance.mesh.setMatrixAt(instance.slot, m);
    instance.mesh.instanceMatrix.needsUpdate = true;
    for (const n of instance.near) {
      n.mesh.setMatrixAt(n.slot, m);
      n.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt: number, elapsed: number, focus: THREE.Vector3): void {
    this.elapsed = elapsed;
    this.windUniforms.uTime.value = elapsed;

    // Distanz-Culling: Zellmittelpunkt + halbe Zelldiagonale gegen die Sichtweite.
    const halfDiagonal = this.opts.cellSize * 0.71;
    const maxDistSq = (this.opts.cullDistance + halfDiagonal) ** 2;
    const detailDistSq = (DETAIL_DISTANCE + halfDiagonal) ** 2;
    for (const cell of this.cells) {
      const dx = cell.centerX - focus.x;
      const dz = cell.centerZ - focus.z;
      const distSq = dx * dx + dz * dz;
      cell.group.visible = distSq < maxDistSq;
      const details = distSq < detailDistSq;
      for (const mesh of cell.details) mesh.visible = details;
      // Nah: realistische Bäume; Abstand zum Zellrand, damit auch Bäume knapp hinter der Grenze passen.
      const edge = Math.max(0, Math.hypot(Math.max(0, Math.abs(dx) - this.opts.cellSize / 2), Math.max(0, Math.abs(dz) - this.opts.cellSize / 2)));
      const near = edge < this.nearTreeDistance;
      for (const mesh of cell.nearTrees) mesh.visible = near;
      for (const mesh of cell.farTrees) mesh.visible = !near || cell.nearTrees.length === 0;
    }

    // Treffer-Wackeln: gedämpfte Schwingung um die Kippachse.
    const SHAKE_TIME = 0.55;
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      s.time += dt;
      const done = s.time >= SHAKE_TIME || !s.instance.alive;
      if (s.instance.alive) {
        const angle = done ? 0 : Math.sin(s.time * 32) * 0.035 * s.strength * (1 - s.time / SHAKE_TIME) ** 2;
        this.restore(s.instance, this.tmpQuat2.setFromAxisAngle(s.axis, angle));
        if (s.instance.berries?.alive) this.restore(s.instance.berries, this.tmpQuat2);
      }
      if (done) this.shakes.splice(i, 1);
    }

    // Beeren wachsen nach (nicht im Winter).
    for (let i = this.regrowQueue.length - 1; i >= 0 && this.berriesAvailable; i--) {
      const r = this.regrowQueue[i];
      if (elapsed < r.at) continue;
      this.regrowQueue.splice(i, 1);
      if (r.bush.alive && r.bush.berries) {
        r.bush.berries.alive = true;
        this.restore(r.bush.berries);
      }
    }
  }

  /** Spielstand: entfernte Objekte (gefällt, aufgehoben, geräumt) und nachwachsende Beeren. */
  serialize(): VegetationSave {
    const removed: number[] = [];
    for (const v of this.instances) if (!v.alive && v.kind !== 'berries') removed.push(v.id);
    return {
      removed,
      regrow: this.regrowQueue.map((r) => [r.bush.id, Math.max(0, r.at - this.elapsed)] as [number, number]),
    };
  }

  load(data: VegetationSave): void {
    for (const id of data.removed) {
      const v = this.instances[id];
      if (v?.id === id) this.remove(v);
    }
    for (const [id, remaining] of data.regrow) {
      const bush = this.instances[id];
      if (bush?.id === id && this.hasRipeBerries(bush)) {
        this.harvestBerries(bush);
        this.regrowQueue[this.regrowQueue.length - 1].at = this.elapsed + remaining;
      }
    }
  }

  /** Sichtweite der Vegetation (Grafikstufe). */
  setCullDistance(distance: number): void {
    this.opts.cullDistance = distance;
  }

  /** Windstärke 0..1 (Sturm lässt die Kronen deutlich stärker schwanken). */
  setWind(strength: number): void {
    this.windUniforms.uWind.value = 0.018 * (0.6 + 2.2 * strength);
  }

  dispose(): void {
    Object.values(this.geometries).forEach((g) => g.dispose());
    this.materials.foliage.dispose();
    this.materials.broadleaf.dispose();
    this.materials.rock.dispose();
  }
}
