import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import { createItemMesh } from '../entities/items/ItemMeshes';
import { isItemId, type ItemId } from '../entities/items/ItemDefs';
import type { BuildingSystem, Structure } from './building/BuildingSystem';
import type { ItemService } from './ItemService';
import type { Audio } from './Audio';

/** Plätze am Bratspieß. */
export const SPIT_SLOTS = 3;
/** Garzeit eines Stücks über offenem Feuer (s). */
export const COOK_TIME = 12;

/** Was sich braten lässt: Ergebnis und Farbverlauf von roh nach gar. */
const COOKABLE: Partial<Record<ItemId, { result: ItemId; raw: THREE.Color; done: THREE.Color; name: string }>> = {
  rawMeat: { result: 'cookedMeat', raw: new THREE.Color(0xa8343a), done: new THREE.Color(0x6b3a1e), name: 'Das Fleisch' },
  rawFish: { result: 'cookedFish', raw: new THREE.Color(0x7f9298), done: new THREE.Color(0x9b6a3c), name: 'Der Fisch' },
};

/** Lässt sich `id` am Spieß braten? */
export const isCookable = (id: ItemId | null): id is ItemId => id !== null && COOKABLE[id] !== undefined;

/** `items` fehlt in alten Spielständen (dort lag nur Fleisch am Spieß). */
export type CookingSave = { structure: number; pieces: number[]; items?: string[] }[];

interface Piece {
  item: ItemId;
  progress: number;
  mesh: THREE.Object3D;
  material: THREE.MeshStandardMaterial;
}

interface Spit {
  structure: Structure;
  object: THREE.Group;
  pieces: (Piece | null)[];
  sizzle: number;
}

const wood = new THREE.MeshStandardMaterial({ color: 0x5a4430, roughness: 0.95, flatShading: true });

/** Bratspieß: zwei Astgabeln und eine Querstange über der Glut. */
function createSpitModel(): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.CylinderGeometry(0.02, 0.025, 0.8, 5);
  const fork = new THREE.CylinderGeometry(0.014, 0.018, 0.16, 4);
  for (const x of [-0.58, 0.58]) {
    const p = new THREE.Mesh(post, wood);
    p.position.set(x, 0.4, 0);
    g.add(p);
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(fork, wood);
      f.position.set(x + s * 0.04, 0.82, 0);
      f.rotation.z = -s * 0.5;
      g.add(f);
    }
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.35, 5), wood);
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 0.78;
  g.add(bar);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/**
 * Kochen am Lagerfeuer: Mit rohem Fleisch oder Fisch in der Hand legt `E` ein Stück auf den
 * Spieß (bis zu drei). Solange das Feuer brennt, gart es; fertige Stücke nimmt man mit `E` ab.
 * Das Essen verfärbt sich dabei sichtbar von roh zu gebraten.
 */
export class Cooking {
  readonly group = new THREE.Group();
  private readonly spits = new Map<Structure, Spit>();
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly building: BuildingSystem,
    private readonly items: ItemService,
    private readonly audio: Audio,
    private readonly events: EventBus,
  ) {
    this.group.name = 'Cooking';
  }

  /** Freier Platz am Spieß eines brennenden Feuers? */
  canAdd(s: Structure): boolean {
    if (!s.lit) return false;
    const spit = this.spits.get(s);
    return !spit || spit.pieces.some((p) => p === null);
  }

  readyCount(s: Structure): number {
    return this.spits.get(s)?.pieces.filter((p) => p && p.progress >= 1).length ?? 0;
  }

  cookingCount(s: Structure): number {
    return this.spits.get(s)?.pieces.filter((p) => p && p.progress < 1).length ?? 0;
  }

  /** Fortschritt des am weitesten garen, noch rohen Stücks in [0, 1) (für den Hinweis). */
  progress(s: Structure): number {
    let best = 0;
    for (const p of this.spits.get(s)?.pieces ?? []) if (p && p.progress < 1) best = Math.max(best, p.progress);
    return best;
  }

  /** Legt ein rohes Stück (Fleisch, Fisch) auf. */
  add(s: Structure, item: ItemId = 'rawMeat', progress = 0, quiet = false): boolean {
    const cook = COOKABLE[item];
    if (!cook) return false;
    let spit = this.spits.get(s);
    if (!spit) {
      const object = createSpitModel();
      object.position.copy(s.position);
      object.rotation.y = s.rotation;
      this.group.add(object);
      spit = { structure: s, object, pieces: new Array(SPIT_SLOTS).fill(null), sizzle: 0 };
      this.spits.set(s, spit);
    }
    const slot = spit.pieces.indexOf(null);
    if (slot < 0) return false;
    const mesh = createItemMesh(item);
    const material = new THREE.MeshStandardMaterial({ color: cook.raw.clone(), roughness: 0.6, flatShading: true });
    // Nur den Hauptkörper umfärben (Knochen, Flossen bleiben).
    (mesh.children[0] as THREE.Mesh).material = material;
    mesh.position.set((slot - 1) * 0.36, 0.7, 0);
    mesh.rotation.set(0, 0, Math.PI / 2);
    spit.object.add(mesh);
    material.color.copy(cook.raw).lerp(cook.done, progress);
    spit.pieces[slot] = { item, progress, mesh, material };
    if (!quiet) this.audio.play('sizzle', { volume: 0.8, position: this.tmp.copy(s.position).setY(s.position.y + 0.7) });
    return true;
  }

  /** Name des ersten fertigen Stücks ("Gebratener Fisch") für den Hinweis. */
  readyItem(s: Structure): ItemId | null {
    const p = this.spits.get(s)?.pieces.find((x) => x && x.progress >= 1);
    return p ? COOKABLE[p.item]!.result : null;
  }

  /** Nimmt alle fertigen Stücke ab. @returns Anzahl. */
  take(s: Structure): number {
    const spit = this.spits.get(s);
    if (!spit) return 0;
    const done = new Map<ItemId, number>();
    spit.pieces.forEach((p, i) => {
      if (!p || p.progress < 1) return;
      spit.object.remove(p.mesh);
      p.material.dispose();
      spit.pieces[i] = null;
      const result = COOKABLE[p.item]!.result;
      done.set(result, (done.get(result) ?? 0) + 1);
    });
    let n = 0;
    for (const [item, count] of done) {
      this.items.give(item, count, this.tmp.copy(s.position).setY(s.position.y + 0.7));
      n += count;
    }
    if (n > 0) this.events.emit('food:cooked', { count: n });
    if (spit.pieces.every((p) => p === null)) this.removeSpit(spit);
    return n;
  }

  update(dt: number): void {
    for (const spit of this.spits.values()) {
      const s = spit.structure;
      // Feuer abgerissen/zerstört: Fleisch fällt zu Boden.
      if (!this.building.structures.includes(s)) {
        const at = this.tmp.copy(s.position).setY(s.position.y + 0.6);
        for (const p of spit.pieces) if (p) this.items.drop(p.progress >= 1 ? COOKABLE[p.item]!.result : p.item, 1, at);
        this.removeSpit(spit);
        continue;
      }
      if (!s.lit) continue;
      let cooking = false;
      for (const p of spit.pieces) {
        if (!p || p.progress >= 1) continue;
        cooking = true;
        const cook = COOKABLE[p.item]!;
        p.progress = Math.min(1, p.progress + dt / COOK_TIME);
        p.material.color.copy(cook.raw).lerp(cook.done, p.progress);
        // Langsam drehen, damit es rundum gart.
        p.mesh.rotation.x += dt * 0.8;
        if (p.progress >= 1) this.events.emit('hud:message', { text: `${cook.name} ist gar.` });
      }
      spit.sizzle -= dt;
      if (cooking && spit.sizzle <= 0) {
        spit.sizzle = 0.7 + Math.random() * 0.8;
        this.audio.play('sizzle', { volume: 0.5, position: this.tmp.copy(s.position).setY(s.position.y + 0.7) });
      }
    }
  }

  private removeSpit(spit: Spit): void {
    for (const p of spit.pieces) p?.material.dispose();
    this.group.remove(spit.object);
    this.spits.delete(spit.structure);
  }

  /** Spielstand: Garfortschritt je Stück, Feuer über ihren Index in `building.structures`. */
  serialize(): CookingSave {
    return [...this.spits.values()].map((s) => {
      const pieces = s.pieces.filter((p): p is Piece => p !== null);
      return {
        structure: this.building.structures.indexOf(s.structure),
        pieces: pieces.map((p) => p.progress),
        items: pieces.map((p) => p.item),
      };
    });
  }

  load(data: CookingSave, structures: readonly Structure[]): void {
    for (const spit of data) {
      const s = structures[spit.structure];
      if (!s || s.def.interaction !== 'fire') continue;
      spit.pieces.slice(0, SPIT_SLOTS).forEach((progress, i) => {
        const raw = spit.items?.[i];
        const item = raw && isItemId(raw) && COOKABLE[raw] ? raw : 'rawMeat';
        this.add(s, item, Math.max(0, Math.min(1, progress)), true);
      });
    }
  }
}
