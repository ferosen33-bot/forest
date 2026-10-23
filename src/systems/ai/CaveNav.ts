import * as THREE from 'three';
import { NavGrid, type NavPoint, type NavQuery } from './NavGrid';
import type { CaveFloor } from '../../world/CaveGenerator';

/** Rastergröße der Höhlen-Wegfindung (m) – fein genug für 4 m breite Gänge. */
const CELL = 1;

/**
 * Wegfindung in einer Höhle: ein NavGrid über der Bodenkarte der Höhle (lokale Koordinaten),
 * nach außen in Weltkoordinaten übersetzt (Drehung um Y + Verschiebung zum Höhlenursprung).
 * So nutzen Höhlenbewohner dieselbe Gegner-KI wie die Schrate an der Oberfläche.
 */
export class CaveNav implements NavQuery {
  readonly grid: NavGrid;
  private readonly cos: number;
  private readonly sin: number;

  constructor(
    floor: CaveFloor,
    private readonly origin: THREE.Vector3,
    rotation: number,
  ) {
    this.cos = Math.cos(rotation);
    this.sin = Math.sin(rotation);
    const ext = Math.max(
      Math.abs(floor.min.x),
      Math.abs(floor.min.z),
      Math.abs(floor.min.x + floor.nx * floor.h),
      Math.abs(floor.min.z + floor.nz * floor.h),
    );
    const half = Math.ceil(ext / CELL + 1) * CELL;
    // Ohne Boden: weit unter der Mindesthöhe → unbegehbar (auch für die Steilheitsprüfung der Nachbarn).
    const heightAt = (x: number, z: number) => {
      const y = floor.heightAt(x, z);
      return Number.isNaN(y) ? -1e4 : y;
    };
    this.grid = new NavGrid({ size: half * 2, half, waterLevel: -1e3, heightAt }, { cellSize: CELL, maxStep: 0.9, minHeight: -1e3 });
  }

  /** Welt → lokal (Umkehrung von makeRotationY(rotation) + origin). */
  toLocal(x: number, z: number): NavPoint {
    const dx = x - this.origin.x;
    const dz = z - this.origin.z;
    return { x: this.cos * dx - this.sin * dz, z: this.sin * dx + this.cos * dz };
  }

  toWorld(p: NavPoint): NavPoint {
    return { x: this.cos * p.x + this.sin * p.z + this.origin.x, z: -this.sin * p.x + this.cos * p.z + this.origin.z };
  }

  isWalkable(x: number, z: number): boolean {
    const p = this.toLocal(x, z);
    return this.grid.isWalkable(p.x, p.z);
  }

  lineWalkable(a: NavPoint, b: NavPoint): boolean {
    return this.grid.lineWalkable(this.toLocal(a.x, a.z), this.toLocal(b.x, b.z));
  }

  nearestWalkable(x: number, z: number, maxRadius?: number): NavPoint | null {
    const p = this.toLocal(x, z);
    const n = this.grid.nearestWalkable(p.x, p.z, maxRadius);
    return n ? this.toWorld(n) : null;
  }

  findPath(from: NavPoint, to: NavPoint, maxExpansions?: number): NavPoint[] | null {
    const path = this.grid.findPath(this.toLocal(from.x, from.z), this.toLocal(to.x, to.z), maxExpansions);
    return path ? path.map((p) => this.toWorld(p)) : null;
  }
}
