import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import type { HeightMap } from './HeightMap';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import { deriveSeed, mulberry32, randRange, type RandomFn } from '../utils/random';
import { smoothstep } from '../utils/math';
import {
  createBroadleafGeometry,
  createBushGeometry,
  createPineGeometry,
  createRockGeometry,
} from './VegetationGeometry';

export type VegetationKind = 'pine' | 'broadleaf' | 'bush' | 'rock';

/** Ein einzelnes platziertes Objekt. Wird später für Fällen/Abbauen/Ernten referenziert. */
export interface VegetationInstance {
  readonly id: number;
  readonly kind: VegetationKind;
  readonly position: THREE.Vector3;
  readonly scale: THREE.Vector3;
  readonly rotationY: number;
  /** Instanced-Mesh-Slot, in dem dieses Objekt gerendert wird. */
  readonly mesh: THREE.InstancedMesh;
  readonly slot: number;
  collider: RAPIER.Collider | null;
  alive: boolean;
}

export interface VegetationOptions {
  seed: number;
  /** Kantenlänge einer Render-Zelle in Metern. */
  cellSize: number;
  /** Zellen, deren Mittelpunkt weiter entfernt ist, werden ausgeblendet. */
  cullDistance: number;
  /** Bereiche, die frei bleiben sollen (z. B. Spawnpunkt). */
  clearings: { x: number; z: number; radius: number }[];
}

interface Placement {
  kind: VegetationKind;
  position: THREE.Vector3;
  scale: THREE.Vector3;
  rotationY: number;
  tilt: THREE.Euler;
}

const KINDS: VegetationKind[] = ['pine', 'broadleaf', 'bush', 'rock'];

/** Eine Render-Zelle: alle Instanced Meshes eines Quadrats der Welt. */
interface VegetationCell {
  group: THREE.Group;
  centerX: number;
  centerZ: number;
}

/**
 * Prozedurale Vegetation: Bäume, Büsche und Felsen.
 *
 * - Platzierung per Jittered-Grid + Dichte-Rauschen (Waldgebiete, Lichtungen).
 * - Rendering per InstancedMesh, gruppiert nach Zellen, damit Frustum-Culling für
 *   Kamera und Schattenkamera greift; zusätzlich Distanz-Culling (Zellen im Nebel).
 * - Bäume und Felsen erhalten statische Rapier-Collider.
 */
export class Vegetation {
  readonly group = new THREE.Group();
  readonly instances: VegetationInstance[] = [];
  readonly counts: Record<VegetationKind, number> = { pine: 0, broadleaf: 0, bush: 0, rock: 0 };

  private readonly byCollider = new Map<number, VegetationInstance>();
  private readonly cells: VegetationCell[] = [];
  private readonly windUniforms = { uTime: { value: 0 }, uWind: { value: 0.018 } };
  private readonly geometries: Record<VegetationKind, THREE.BufferGeometry>;
  private readonly materials: { foliage: THREE.MeshStandardMaterial; rock: THREE.MeshStandardMaterial };
  private readonly rockHull: Float32Array;
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();

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
    };
    this.rockHull = this.geometries.rock.getAttribute('position').array as Float32Array;

    const foliage = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    this.injectWind(foliage);
    const rock = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
    this.materials = { foliage, rock };

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
    const grid = (spacing: number, accept: (x: number, z: number, h: number, slope: number) => Placement | null) => {
      for (let gz = -hm.half; gz < hm.half; gz += spacing) {
        for (let gx = -hm.half; gx < hm.half; gx += spacing) {
          const x = gx + rng() * spacing;
          const z = gz + rng() * spacing;
          const h = hm.heightAt(x, z);
          if (h < water - 2 || inClearing(x, z)) continue;
          hm.normalAt(x, z, normal);
          const p = accept(x, z, h, 1 - normal[1]);
          if (p) perCell[cellIndex(x, z)].push(p);
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

    // Büsche (bevorzugt am Waldrand)
    grid(5, (x, z, h, slope) => {
      if (h < water + 1.0 || slope > 0.3) return null;
      const d = forestDensity(x, z);
      const edge = 1 - Math.abs(d - 0.45) * 2;
      if (rng() > 0.12 + edge * 0.35) return null;
      const s = randRange(rng, 0.6, 1.35);
      return this.placement('bush', x, h - 0.1, z, s, s * randRange(rng, 0.8, 1.1), s, rng, 0.1);
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
    const euler = new THREE.Euler();
    const cellsPerSide = this.cellsPerSide;
    const size = this.opts.cellSize;

    perCell.forEach((placements, index) => {
      if (placements.length === 0) return;
      const cell: VegetationCell = {
        group: new THREE.Group(),
        centerX: ((index % cellsPerSide) + 0.5) * size - this.heightMap.half,
        centerZ: (Math.floor(index / cellsPerSide) + 0.5) * size - this.heightMap.half,
      };
      cell.group.name = `VegetationCell_${index}`;
      this.cells.push(cell);
      this.group.add(cell.group);

      for (const kind of KINDS) {
        const list = placements.filter((p) => p.kind === kind);
        if (list.length === 0) continue;

        const mesh = new THREE.InstancedMesh(
          this.geometries[kind],
          kind === 'rock' ? this.materials.rock : this.materials.foliage,
          list.length,
        );
        mesh.name = `Vegetation_${kind}_${index}`;
        mesh.castShadow = kind !== 'bush';
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;

        list.forEach((p, slot) => {
          euler.set(p.tilt.x, p.rotationY, p.tilt.z, 'YXZ');
          this.tmpQuat.setFromEuler(euler);
          this.tmpMatrix.compose(p.position, this.tmpQuat, p.scale);
          mesh.setMatrixAt(slot, this.tmpMatrix);

          // Leichte Farbvariation pro Instanz (multipliziert mit den Vertex-Farben).
          const v = 0.82 + colorRng() * 0.3;
          tint.setRGB(v * (0.95 + colorRng() * 0.1), v, v * (0.9 + colorRng() * 0.1));
          mesh.setColorAt(slot, tint);

          const instance: VegetationInstance = {
            id: this.instances.length,
            kind,
            position: p.position,
            scale: p.scale,
            rotationY: p.rotationY,
            mesh,
            slot,
            collider: this.createCollider(p),
            alive: true,
          };
          if (instance.collider) this.byCollider.set(instance.collider.handle, instance);
          this.instances.push(instance);
          this.counts[kind]++;
        });

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        cell.group.add(mesh);
      }
    });
  }

  private createCollider(p: Placement): RAPIER.Collider | null {
    const groups = interactionGroups(CollisionGroup.STATIC);
    let desc: RAPIER.ColliderDesc | null = null;

    if (p.kind === 'pine' || p.kind === 'broadleaf') {
      // Stamm als Zylinder; die Krone ist (wie im Genre üblich) nicht kollidierend.
      const radius = (p.kind === 'pine' ? 0.28 : 0.34) * p.scale.x;
      const halfHeight = 2.4 * p.scale.y;
      desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(
        p.position.x,
        p.position.y + halfHeight,
        p.position.z,
      );
    } else if (p.kind === 'rock') {
      // Konvexe Hülle der tatsächlich gerenderten (skalierten, rotierten) Form.
      const pts = new Float32Array(this.rockHull.length);
      const v = new THREE.Vector3();
      const q = this.tmpQuat.setFromEuler(new THREE.Euler(p.tilt.x, p.rotationY, p.tilt.z, 'YXZ'));
      for (let i = 0; i < pts.length; i += 3) {
        v.set(this.rockHull[i], this.rockHull[i + 1], this.rockHull[i + 2]).multiply(p.scale).applyQuaternion(q);
        pts[i] = v.x;
        pts[i + 1] = v.y;
        pts[i + 2] = v.z;
      }
      desc = RAPIER.ColliderDesc.convexHull(pts);
      desc?.setTranslation(p.position.x, p.position.y, p.position.z);
    }

    if (!desc) return null;
    desc.setCollisionGroups(groups).setFriction(0.7);
    return this.physics.world.createCollider(desc);
  }

  /** Wind: Kronen schwanken abhängig von Höhe über dem Boden und Instanzposition. */
  private injectWind(material: THREE.MeshStandardMaterial): void {
    material.onBeforeCompile = (shader) => {
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
   * Entfernt ein Objekt aus Welt und Physik (Basis für Bäume fällen / Steine abbauen).
   * Die Instanz wird auf Skalierung 0 gesetzt, statt das InstancedMesh neu aufzubauen.
   */
  remove(instance: VegetationInstance): void {
    if (!instance.alive) return;
    instance.alive = false;
    instance.mesh.setMatrixAt(instance.slot, this.tmpMatrix.makeScale(0, 0, 0));
    instance.mesh.instanceMatrix.needsUpdate = true;
    if (instance.collider) {
      this.byCollider.delete(instance.collider.handle);
      this.physics.world.removeCollider(instance.collider, false);
      instance.collider = null;
    }
  }

  update(elapsed: number, focus: THREE.Vector3): void {
    this.windUniforms.uTime.value = elapsed;

    // Distanz-Culling: Zellmittelpunkt + halbe Zelldiagonale gegen die Sichtweite.
    const maxDist = this.opts.cullDistance + this.opts.cellSize * 0.71;
    const maxDistSq = maxDist * maxDist;
    for (const cell of this.cells) {
      const dx = cell.centerX - focus.x;
      const dz = cell.centerZ - focus.z;
      cell.group.visible = dx * dx + dz * dz < maxDistSq;
    }
  }

  dispose(): void {
    Object.values(this.geometries).forEach((g) => g.dispose());
    this.materials.foliage.dispose();
    this.materials.rock.dispose();
  }
}
