import * as THREE from 'three';
import { getItem } from '../entities/items/ItemDefs';
import type { EventBus } from '../core/EventBus';
import type { OpeningSpec } from '../world/TownMeshes';
import type { BuildingSystem, Structure } from './building/BuildingSystem';
import { getStructure } from './building/StructureDefs';
import type { Crafting } from './Crafting';
import type { Prompt } from './InteractionSystem';
import type { Audio } from './Audio';
import type { Particles } from './Particles';

export interface HouseBaseDeps {
  openings: readonly OpeningSpec[];
  building: BuildingSystem;
  crafting: Crafting;
  audio: Audio;
  events: EventBus;
  particles: Particles;
  /** Das Haus ist ganz gesichert: Basis (Aufwachpunkt) dort. */
  onClaim?: (house: number, center: THREE.Vector3, quiet: boolean) => void;
}

/** So nah muss man an einer Öffnung stehen (m). */
const REACH = 2.8;

/**
 * Häuser als Basis: Fenster lassen sich vernageln, in den Türrahmen kommt eine schwere Tür. Ist ein
 * Wohnhaus rundum gesichert, wird es zur Basis – dort wacht man nach dem Tod auf. Schrate, die
 * hineinwollen, müssen Bretter und Tür einschlagen; beschädigtes lässt sich wie jedes Bauwerk reparieren.
 */
export class HouseBases {
  /** Gebäude-Index der Basis (null = keine). */
  base: number | null = null;
  private readonly byHouse = new Map<number, OpeningSpec[]>();
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly d: HouseBaseDeps) {
    for (const o of d.openings) {
      let list = this.byHouse.get(o.building);
      if (!list) this.byHouse.set(o.building, (list = []));
      list.push(o);
    }
  }

  /** Bauwerk, das die Öffnung verschließt (oder undefined). */
  filler(o: OpeningSpec): Structure | undefined {
    const at = this.anchor(o, this.tmp);
    return this.d.building.structures.find(
      (s) => (s.def.id === 'windowBoards' || s.def.id === 'houseDoor') && Math.hypot(s.position.x - at.x, s.position.z - at.z) < 0.35 && Math.abs(s.position.y - at.y) < 0.4,
    );
  }

  /** Wie viele Öffnungen des Hauses sind gesichert? */
  progress(house: number): { done: number; total: number } {
    const list = this.byHouse.get(house) ?? [];
    return { done: list.filter((o) => this.filler(o)).length, total: list.length };
  }

  /** Mitte des Hauses (Boden innen). */
  center(house: number): THREE.Vector3 | null {
    const list = this.byHouse.get(house);
    if (!list?.length) return null;
    const c = new THREE.Vector3();
    for (const o of list) c.add(o.position);
    c.divideScalar(list.length);
    c.y = Math.min(...list.map((o) => o.bottom));
    return c;
  }

  /**
   * Aktion für die Öffnung im Blick (Fenster vernageln, Tür einsetzen) – nur, wenn nichts anderes
   * anvisiert ist (sie haben keinen eigenen Collider).
   */
  action(origin: THREE.Vector3, dir: THREE.Vector3): { prompt: Prompt; run: () => void } | null {
    const o = this.openingInView(origin, dir);
    if (!o) return null;
    const id = o.kind === 'door' ? 'houseDoor' : 'windowBoards';
    const cost = getStructure(id).cost;
    const label = cost.map((c) => `${c.count}× ${getItem(c.item).name}`).join(', ');
    const { done, total } = this.progress(o.building);
    const action = o.kind === 'door' ? 'Tür einsetzen' : 'Fenster vernageln';
    if (!this.d.crafting.canAfford(cost)) return { prompt: { key: null, action: `${action}: ${label} fehlt`, label: `${done}/${total} gesichert` }, run: () => {} };
    return { prompt: { key: 'E', action, label: `${label} · ${done}/${total} gesichert` }, run: () => this.secure(o) };
  }

  /** Nächste offene Öffnung, durch die der Blick geht. */
  private openingInView(origin: THREE.Vector3, dir: THREE.Vector3): OpeningSpec | null {
    let best: OpeningSpec | null = null;
    let bestT = REACH;
    for (const o of this.d.openings) {
      if (Math.abs(o.position.x - origin.x) > 4 || Math.abs(o.position.z - origin.z) > 4) continue;
      // Ebene der Öffnung: Normale = nach draußen.
      const nx = Math.sin(o.yaw);
      const nz = Math.cos(o.yaw);
      const denom = dir.x * nx + dir.z * nz;
      if (Math.abs(denom) < 0.15) continue;
      const t = ((o.position.x - origin.x) * nx + (o.position.z - origin.z) * nz) / denom;
      if (t <= 0 || t >= bestT) continue;
      const hx = origin.x + dir.x * t - o.position.x;
      const hy = origin.y + dir.y * t - o.position.y;
      const hz = origin.z + dir.z * t - o.position.z;
      // Seitlich entlang der Wand (quer zur Normalen) und in der Höhe innerhalb der Öffnung?
      const side = hx * nz - hz * nx;
      if (Math.abs(side) > o.width / 2 + 0.15 || Math.abs(hy) > o.height / 2 + 0.15) continue;
      if (this.filler(o)) continue;
      best = o;
      bestT = t;
    }
    return best;
  }

  /** Wo das Bauwerk sitzt: Bretter außen vor dem Fenster, die Tür im Rahmen. */
  private anchor(o: OpeningSpec, out: THREE.Vector3): THREE.Vector3 {
    const outward = o.kind === 'window' ? o.wall / 2 + 0.03 : 0;
    return out.set(o.position.x + Math.sin(o.yaw) * outward, o.bottom, o.position.z + Math.cos(o.yaw) * outward);
  }

  /** Öffnung verschließen (Material wird verbraucht). */
  secure(o: OpeningSpec): void {
    const id = o.kind === 'door' ? 'houseDoor' : 'windowBoards';
    if (this.filler(o) || !this.d.crafting.consume(getStructure(id).cost)) return;
    const at = this.anchor(o, new THREE.Vector3());
    this.d.building.place(id, at, o.yaw);
    this.d.audio.play('chop', { position: at });
    this.d.audio.play('place', { position: at, volume: 0.7 });
    this.d.events.emit('noise', { position: at.clone(), radius: 16 });
    this.d.particles.burst(at.clone().setY(at.y + o.height / 2), { count: 10, color: 0x8a6a45, speed: 2, size: 0.03 });
    const { done, total } = this.progress(o.building);
    this.d.events.emit('hud:message', {
      text: done < total ? `${o.kind === 'door' ? 'Tür eingesetzt' : 'Fenster vernagelt'} (${done}/${total}).` : 'Haus rundum gesichert!',
    });
    if (done >= total) this.claim(o.building, false);
  }

  /** Ganz gesichertes Haus wird zur Basis. */
  private claim(house: number, quiet: boolean): void {
    if (this.base === house) return;
    this.base = house;
    const c = this.center(house);
    if (c) this.d.onClaim?.(house, c, quiet);
  }

  /** Nach dem Laden: Ein rundum gesichertes Haus ist wieder die Basis. */
  refresh(): void {
    for (const house of this.byHouse.keys()) {
      const { done, total } = this.progress(house);
      if (total > 0 && done >= total) {
        this.claim(house, true);
        return;
      }
    }
  }

  /** Steht der Punkt in der Basis (grob: nahe der Hausmitte)? */
  inBase(p: THREE.Vector3): boolean {
    if (this.base === null) return false;
    const c = this.center(this.base);
    return !!c && Math.hypot(p.x - c.x, p.z - c.z) < 5 && Math.abs(p.y - c.y) < 3;
  }
}
