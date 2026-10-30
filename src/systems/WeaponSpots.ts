import * as THREE from 'three';
import type { Landmark } from '../world/Landmarks';
import type { HeightMap } from '../world/HeightMap';
import type { ItemId } from '../entities/items/ItemDefs';
import type { WorldItem, WorldItems } from '../entities/items/WorldItems';
import { rollWeapon } from '../entities/items/Weapons';
import { deriveSeed, mulberry32 } from '../utils/random';
import { halo } from './NightEvents';

/**
 * Waffenfundstellen (Meilenstein 60): An Hackklötzen, bei Überresten und in Jagdverstecken liegen
 * echte Waffen (und manchmal Munition), die man mit `E` aufhebt. Die Items entstehen erst, wenn der
 * Spieler in die Nähe kommt, und verschwinden wieder, wenn er weit weg ist – gespeichert wird nur, was
 * schon genommen wurde. Tagsüber blitzt die Klinge ab und zu in der Sonne auf.
 */

export interface WeaponSpotsSave {
  /** Genommene Stücke als `Fundstelle:Stück`. */
  taken: string[];
}

interface Piece {
  id: ItemId;
  count: number;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  key: string;
  taken: boolean;
  item: WorldItem | null;
  weapon: boolean;
}

interface Spot {
  landmark: Landmark;
  pieces: Piece[];
  glint: THREE.Sprite;
  phase: number;
}

/** Beile und Äxte: Schneide (lokal +X) und Kopf (lokal +Y) – wo die Schneide endet, steckt sie im Holz. */
const EDGE: Partial<Record<ItemId, [number, number]>> = { axe: [0.17, 0.27], stoneAxe: [0.17, 0.27], fireAxe: [0.15, 0.33], cleaver: [0.078, 0.05] };

const SPAWN = 130;
const DESPAWN = 190;

type Items = Pick<WorldItems, 'spawn' | 'remove'>;

export class WeaponSpots {
  readonly group = new THREE.Group();
  readonly spots: Spot[] = [];
  private time = 0;

  constructor(
    private readonly items: Items,
    landmarks: Landmark[],
    heightMap: HeightMap,
    private readonly seed: number,
  ) {
    this.group.name = 'WeaponSpots';
    landmarks.forEach((l, i) => {
      if (!l.cache) return;
      const c = Math.cos(l.yaw);
      const s = Math.sin(l.yaw);
      /** Lokal (x quer, z vorwärts) → Welt. */
      const at = (lx: number, lz: number, y?: number) => {
        const x = l.x + c * lx + s * lz;
        const z = l.z - s * lx + c * lz;
        return new THREE.Vector3(x, y ?? heightMap.heightAt(x, z), z);
      };
      const yaw = (r: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.yaw + r);
      // Klingen stecken mit der Spitze voran im Klotz, leicht schräg.
      const stuck = (r: number) => yaw(r).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI - 0.3, 0, 0)));
      // Äxte stecken mit der Schneide im Holz, der Stiel ragt schräg nach oben (34°).
      const ax = new THREE.Vector3(0.56, -0.83, 0);
      const ay = new THREE.Vector3(-0.83, -0.56, 0);
      const axeRot = (r: number) => yaw(r).multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, new THREE.Vector3(0, 0, -1))));
      // Liegt flach, die Längsachse quer bzw. entlang `r`.
      const flat = (r: number) => yaw(r).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)));
      const pieces: Piece[] = [];
      const add = (id: ItemId, count: number, position: THREE.Vector3, rotation: THREE.Quaternion, weapon: boolean) =>
        pieces.push({ id, count, position, rotation, key: `${i}:${pieces.length}`, taken: false, item: null, weapon });
      const { weapon, ammo } = l.cache;
      switch (l.kind) {
        case 'chopblock': {
          const top = l.y + 0.62;
          const edge = EDGE[weapon];
          if (edge) {
            // Ursprung so, dass die Schneide 5 cm tief in der Mitte des Klotzes sitzt.
            const o = ax.clone().multiplyScalar(edge[0]).addScaledVector(ay, edge[1]);
            const rot = 0.4;
            const lx = -o.x * Math.cos(rot);
            const lz = o.x * Math.sin(rot);
            add(weapon, 1, at(lx, lz, top - 0.05 - o.y), axeRot(rot), true);
          } else if (weapon === 'sledgehammer') {
            add(weapon, 1, at(0, 0, top + 0.44), yaw(0.4).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI - 0.12, 0, 0))), true);
          } else {
            add(weapon, 1, at(0.05, 0, top + 0.26), stuck(0.4), true);
          }
          break;
        }
        case 'remains':
          add(weapon, 1, at(0.55, 0.15).add(new THREE.Vector3(0, 0.05, 0)), flat(0.3), true);
          if (ammo) add(ammo[0], ammo[1], at(-0.45, 0.95).add(new THREE.Vector3(0, 0.06, 0)), yaw(1), false);
          break;
        default: {
          // Jagdversteck: auf der Kiste (Oberkante 0,6 m).
          const top = heightMap.heightAt(at(0, 0.2).x, at(0, 0.2).z) + 0.65;
          add(weapon, 1, at(0, 0.15, top), flat(0), true);
          if (ammo) add(ammo[0], ammo[1], at(0.3, 0.32, top + 0.02), yaw(0.6), false);
        }
      }
      const glint = halo(0xfff6e0, 0.5, 1, true);
      glint.position.copy(pieces[0].position).add(new THREE.Vector3(0, 0.1, 0));
      glint.visible = false;
      this.group.add(glint);
      this.spots.push({ landmark: l, pieces, glint, phase: (i * 1.37) % 5 });
    });
  }

  /** Waffen, die noch irgendwo liegen. */
  get remaining(): number {
    return this.spots.reduce((n, s) => n + s.pieces.filter((p) => p.weapon && !p.taken).length, 0);
  }

  /** Die nächste Fundstelle mit noch nicht genommener Waffe (für Hinweise und Tests). */
  nearest(at: THREE.Vector3): Spot | null {
    let best: Spot | null = null;
    let bd = Infinity;
    for (const s of this.spots) {
      if (s.pieces.every((p) => !p.weapon || p.taken)) continue;
      const d = Math.hypot(s.landmark.x - at.x, s.landmark.z - at.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  update(dt: number, player: THREE.Vector3, daylight: number): void {
    this.time += dt;
    for (const s of this.spots) {
      const d = Math.hypot(s.landmark.x - player.x, s.landmark.z - player.z);
      for (const p of s.pieces) {
        if (p.taken) continue;
        // Aufgehoben (das Item ist aus der Welt verschwunden, ohne dass wir es entfernt hätten).
        if (p.item && !p.item.mesh.parent) {
          p.item = null;
          p.taken = true;
          continue;
        }
        if (!p.item && d < SPAWN) {
          const weapon = p.weapon ? rollWeapon(mulberry32(deriveSeed(this.seed, `weaponspot-${p.key}`))) : undefined;
          p.item = this.items.spawn(p.id, p.count, p.position, { fixed: true, transient: true, rotation: p.rotation, weapon });
        } else if (p.item && d > DESPAWN) {
          this.items.remove(p.item);
          p.item = null;
        }
      }
      // Ein kurzes Aufblitzen in der Sonne – nur bei Tag, nur in Sichtweite, nur solange die Waffe da ist.
      const blade = s.pieces[0];
      const t = (this.time + s.phase) % 4.5;
      const flash = t < 0.35 ? Math.sin((t / 0.35) * Math.PI) : 0;
      s.glint.visible = !blade.taken && d < 90 && daylight > 0.3 && flash > 0;
      if (s.glint.visible) s.glint.scale.setScalar(0.2 + flash * 0.9);
    }
  }

  serialize(): WeaponSpotsSave {
    return { taken: this.spots.flatMap((s) => s.pieces.filter((p) => p.taken).map((p) => p.key)) };
  }

  load(d: WeaponSpotsSave | undefined): void {
    const taken = new Set(d?.taken ?? []);
    for (const s of this.spots)
      for (const p of s.pieces) {
        p.taken = taken.has(p.key);
        if (p.taken && p.item) {
          this.items.remove(p.item);
          p.item = null;
        }
      }
  }
}
