import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import type { HeightMap } from './HeightMap';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import { deriveSeed, mulberry32, randRange, type RandomFn } from '../utils/random';
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

/** Nachwachszeit für Beeren in Spielsekunden. */
const BERRY_REGROW_TIME = 360;

/** Eine Render-Zelle: alle Instanced Meshes eines Quadrats der Welt. */
interface VegetationCell {
  group: THREE.Group;
  /** Meshes kleiner Details (Beeren, Äste, Steinchen) mit kürzerer Sichtweite. */
  details: THREE.InstancedMesh[];
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
  private readonly materials: { foliage: THREE.MeshStandardMaterial; rock: THREE.MeshStandardMaterial };
  private readonly rockHull: Float32Array;
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
        centerX: ((index % cellsPerSide) + 0.5) * size - this.heightMap.half,
        centerZ: (Math.floor(index / cellsPerSide) + 0.5) * size - this.heightMap.half,
      };
      cell.group.name = `VegetationCell_${index}`;
      this.cells.push(cell);
      this.group.add(cell.group);

      const built = new Map<Placement, VegetationInstance>();

      for (const kind of KINDS) {
        const list = placements.filter((p) => p.kind === kind);
        if (list.length === 0) continue;

        const mesh = new THREE.InstancedMesh(
          this.geometries[kind],
          kind === 'rock' || kind === 'pebble' ? this.materials.rock : this.materials.foliage,
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
        const pts = new Float32Array(this.rockHull.length);
        const v = new THREE.Vector3();
        this.tmpEuler.set(inst.tilt.x, inst.rotationY, inst.tilt.z, 'YXZ');
        const q = this.tmpQuat.setFromEuler(this.tmpEuler);
        for (let i = 0; i < pts.length; i += 3) {
          v.set(this.rockHull[i], this.rockHull[i + 1], this.rockHull[i + 2]).multiply(s).applyQuaternion(q);
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

  /** Geometrie und Material einer Art – z. B. für einen fallenden Baum als Einzel-Mesh. */
  getRenderData(kind: VegetationKind): { geometry: THREE.BufferGeometry; material: THREE.Material } {
    return {
      geometry: this.geometries[kind],
      material: kind === 'rock' || kind === 'pebble' ? this.materials.rock : this.materials.foliage,
    };
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

  /** Trägt dieser Busch gerade reife Beeren? */
  hasRipeBerries(bush: VegetationInstance): boolean {
    return bush.alive && bush.berries !== null && bush.berries.alive;
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
    instance.mesh.setMatrixAt(instance.slot, this.tmpMatrix.makeScale(0, 0, 0));
    instance.mesh.instanceMatrix.needsUpdate = true;
  }

  private restore(instance: VegetationInstance, extra?: THREE.Quaternion): void {
    instance.mesh.setMatrixAt(instance.slot, this.composeMatrix(instance, this.tmpMatrix, extra));
    instance.mesh.instanceMatrix.needsUpdate = true;
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

    // Beeren wachsen nach.
    for (let i = this.regrowQueue.length - 1; i >= 0; i--) {
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

  dispose(): void {
    Object.values(this.geometries).forEach((g) => g.dispose());
    this.materials.foliage.dispose();
    this.materials.rock.dispose();
  }
}
