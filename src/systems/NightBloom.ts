import * as THREE from "three";
import type { HeightMap } from "../world/HeightMap";
import type { WorldItem, WorldItems } from "../entities/items/WorldItems";
import { createMoonflower } from "../entities/items/ItemMeshes";
import { pool } from "./NightEvents";

/**
 * Mondblüten: Nachts öffnen sich auf Lichtungen kleine Felder bleich schimmernder Blumen – von weitem
 * als kühler Schein zwischen den Bäumen zu sehen. Ein paar lassen sich pflücken (Item `moonflower`,
 * beruhigt beim Essen). Bei Tagesanbruch schließen sie sich und vergehen.
 */

export interface NightBloomFrame {
  dt: number;
  night: boolean;
  player: THREE.Vector3;
}

interface Patch {
  center: THREE.Vector3;
  decor: THREE.Group;
  items: WorldItem[];
  /** 0 = geschlossen, 1 = offen. */
  open: number;
  closing: boolean;
}

/** So viele Felder gibt es höchstens gleichzeitig um den Spieler. */
const MAX_PATCHES = 5;
const NEAR = 55;
const FAR = 150;
const FORGET = 230;

type Items = Pick<WorldItems, "spawn" | "remove">;

export class NightBloom {
  readonly group = new THREE.Group();
  private readonly patches: Patch[] = [];
  private timer = 0;

  constructor(
    private readonly items: Items,
    private readonly heightMap: HeightMap,
    private readonly rng: () => number = Math.random,
  ) {
    this.group.name = "NightBloom";
  }

  get count(): number {
    return this.patches.length;
  }

  /** Noch nicht gepflückte Blüten (über alle Felder). */
  get flowers(): number {
    return this.patches.reduce(
      (n, p) => n + p.items.filter((i) => i.mesh.parent).length,
      0,
    );
  }

  update(f: NightBloomFrame): void {
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i];
      const far = p.center.distanceTo(f.player) > FORGET;
      if (!f.night) p.closing = true;
      p.open = THREE.MathUtils.clamp(
        p.open + (p.closing ? -f.dt / 8 : f.dt / 6),
        0,
        1,
      );
      const s = THREE.MathUtils.smoothstep(p.open, 0, 1);
      for (const c of p.decor.children) c.scale.setScalar(Math.max(0.001, s));
      // Gepflückt: sobald keine Blüte mehr da ist, verblasst auch der Schein.
      if (p.items.every((it) => !it.mesh.parent)) p.closing = true;
      if (far || (p.closing && p.open <= 0)) this.remove(i);
    }
    if (!f.night) return;
    this.timer -= f.dt;
    if (this.timer > 0 || this.patches.length >= MAX_PATCHES) return;
    this.timer = 4;
    this.spawn(f.player);
  }

  /** Legt nahe dem Spieler (aber außer Sicht- und Greifweite) ein Feld an; liefert false, wenn kein Platz war. */
  spawn(player: THREE.Vector3, at?: THREE.Vector3): boolean {
    const center = at ?? this.findSpot(player);
    if (!center) return false;
    const decor = new THREE.Group();
    decor.position.copy(center);
    const glow = pool(0x6a88c8, 10);
    decor.add(glow);
    const n = 9 + Math.floor(this.rng() * 8);
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = Math.sqrt(this.rng()) * 2.6;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const fl = createMoonflower(0.3 + this.rng() * 0.3, 1, 1.8 + this.rng() * 0.8);
      fl.position.set(
        x,
        this.heightMap.heightAt(center.x + x, center.z + z) - center.y,
        z,
      );
      fl.rotation.y = this.rng() * Math.PI * 2;
      decor.add(fl);
    }
    this.group.add(decor);
    const items: WorldItem[] = [];
    const picks = 2 + Math.floor(this.rng() * 2);
    for (let i = 0; i < picks; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = 0.6 + this.rng() * 1.6;
      const pos = new THREE.Vector3(
        center.x + Math.sin(a) * r,
        0,
        center.z + Math.cos(a) * r,
      );
      pos.y = this.heightMap.heightAt(pos.x, pos.z);
      items.push(
        this.items.spawn("moonflower", 1, pos, {
          fixed: true,
          rotation: new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            this.rng() * 6.28,
          ),
        }),
      );
    }
    this.patches.push({ center, decor, items, open: 0, closing: false });
    return true;
  }

  private findSpot(player: THREE.Vector3): THREE.Vector3 | null {
    const hm = this.heightMap;
    const normal: [number, number, number] = [0, 1, 0];
    for (let tries = 0; tries < 12; tries++) {
      const a = this.rng() * Math.PI * 2;
      const d = NEAR + this.rng() * (FAR - NEAR);
      const x = player.x + Math.sin(a) * d;
      const z = player.z + Math.cos(a) * d;
      const y = hm.heightAt(x, z);
      if (y < hm.waterLevel + 0.8) continue;
      if (hm.normalAt(x, z, normal)[1] < 0.92) continue;
      const c = new THREE.Vector3(x, y, z);
      if (this.patches.some((p) => p.center.distanceTo(c) < 40)) continue;
      return c;
    }
    return null;
  }

  private remove(i: number): void {
    const p = this.patches[i];
    this.group.remove(p.decor);
    for (const it of p.items) if (it.mesh.parent) this.items.remove(it);
    this.patches.splice(i, 1);
  }
}
