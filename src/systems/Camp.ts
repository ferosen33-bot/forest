import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import { getItem, isItemId, type ItemId } from '../entities/items/ItemDefs';
import type { BuildingSystem, Structure } from './building/BuildingSystem';
import type { ItemService } from './ItemService';
import type { Inventory } from './Inventory';
import type { Audio } from './Audio';
import type { Particles } from './Particles';
import type { Prompt } from './InteractionSystem';

/** Plätze am Trockengestell. */
export const RACK_SLOTS = 4;
/** Sekunden, bis ein Stück trocken ist. */
export const DRY_TIME = 180;
/** Portionen Wasser in einer vollen Regentonne. */
export const BARREL_MAX = 6;
/** Sekunden Starkregen, bis die Tonne voll ist. */
const BARREL_FILL_TIME = 120;
/** Sekunden, bis ein Beet reif ist (Regen beschleunigt). */
export const GROW_TIME = 360;
/** Garzeit des Eintopfs (s). */
export const STEW_TIME = 30;
/** Höchstens so viele Zutaten passen in den Topf. */
const POT_MAX = 3;

const DRYABLE: Partial<Record<ItemId, { raw: THREE.Color; done: THREE.Color }>> = {
  rawMeat: { raw: new THREE.Color(0xa8343a), done: new THREE.Color(0x4a2216) },
  rawFish: { raw: new THREE.Color(0x8a9ca2), done: new THREE.Color(0x6a4a2a) },
};
const PLANTABLE: Partial<Record<ItemId, { yield: number; name: string }>> = {
  berries: { yield: 5, name: 'Beeren' },
  mushroom: { yield: 3, name: 'Leuchtpilze' },
};
const INGREDIENTS = new Set<ItemId>(['rawMeat', 'cookedMeat', 'rawFish', 'cookedFish', 'mushroom', 'berries']);
const WATER_SOURCES: Partial<Record<ItemId, ItemId>> = { bowlWater: 'bowl', waterBottle: 'bottle' };

interface Strip {
  item: ItemId;
  progress: number;
  mesh: THREE.Mesh;
}
interface RackState {
  kind: 'rack';
  slots: (Strip | null)[];
}
interface BarrelState {
  kind: 'barrel';
  water: number;
  surface: THREE.Mesh;
}
interface GardenState {
  kind: 'garden';
  crop: ItemId | null;
  growth: number;
  plants: THREE.Group;
}
interface PotState {
  kind: 'pot';
  water: boolean;
  ingredients: number;
  progress: number;
  ready: number;
  surface: THREE.Mesh;
  steam: number;
}
type CampState = RackState | BarrelState | GardenState | PotState;

export type CampSave = {
  structure: number;
  rack?: [string, number][];
  water?: number;
  crop?: string | null;
  growth?: number;
  pot?: { water: boolean; ingredients: number; progress: number; ready: number };
}[];

export interface CampDeps {
  building: BuildingSystem;
  items: ItemService;
  inventory: Inventory;
  audio: Audio;
  events: EventBus;
  particles: Particles;
  heldItem: () => ItemId | null;
  takeHeld: () => void;
  transformHeld: (to: ItemId) => void;
  drink: (amount: number) => void;
  drinkAmount: number;
  /** Werkzeug in der Hand ausbessern: `null` = geht nicht (Grund steht in `repairPrompt`). */
  repairHeld: () => boolean;
  /** Hinweis an der Werkbank für das gehaltene Werkzeug (oder null, wenn nichts auszubessern ist). */
  repairPrompt: () => string | null;
  /** Steht über `pos` ein Dach? */
  roofAbove: (pos: THREE.Vector3) => boolean;
}

export interface CampEnv {
  rain: number;
  /** Winter: im Beet wächst nichts. */
  winter: boolean;
}

const stripGeometry = new THREE.BoxGeometry(0.07, 0.3, 0.015, 1, 3, 1);
const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x2f5a6a, roughness: 0.08, metalness: 0.1 });
const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x3f6a2c, roughness: 0.8, flatShading: true });
const berryMaterial = new THREE.MeshStandardMaterial({ color: 0x8a1f3a, roughness: 0.4 });
const capMaterial = new THREE.MeshStandardMaterial({ color: 0x2fc8b4, roughness: 0.5, emissive: 0x138a7c, emissiveIntensity: 1.2 });
const stemMaterial = new THREE.MeshStandardMaterial({ color: 0xd6e8e0, roughness: 0.8 });
const WATER = new THREE.Color(0x2f5a6a);
const STEW = new THREE.Color(0x6a4426);

/**
 * Lager-Bauwerke mit eigenem Zustand: Trockengestell (Fleisch → Trockenfleisch), Regentonne
 * (sammelt Regenwasser), Gartenbeet (Beeren und Pilze wachsen nach), Kochtopf (Eintopf) und
 * die Werkbank (bessert Werkzeuge aus). Der Zustand hängt am Bauwerk und wird mitgespeichert.
 */
export class Camp {
  private readonly states = new Map<Structure, CampState>();
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly d: CampDeps) {}

  /** Zustand eines Lager-Bauwerks (wird beim ersten Zugriff angelegt). */
  private state(s: Structure): CampState | null {
    const existing = this.states.get(s);
    if (existing) return existing;
    let state: CampState;
    switch (s.def.camp) {
      case 'rack':
        state = { kind: 'rack', slots: new Array(RACK_SLOTS).fill(null) };
        break;
      case 'barrel': {
        const surface = new THREE.Mesh(new THREE.CircleGeometry(0.37, 14), waterMaterial);
        surface.rotation.x = -Math.PI / 2;
        surface.visible = false;
        s.object.add(surface);
        state = { kind: 'barrel', water: 0, surface };
        break;
      }
      case 'garden': {
        const plants = new THREE.Group();
        s.object.add(plants);
        state = { kind: 'garden', crop: null, growth: 0, plants };
        break;
      }
      case 'pot': {
        const surface = new THREE.Mesh(new THREE.CircleGeometry(0.19, 12), new THREE.MeshStandardMaterial({ color: WATER.clone(), roughness: 0.2 }));
        surface.rotation.x = -Math.PI / 2;
        surface.position.y = 0.48 + 0.2;
        surface.visible = false;
        s.object.add(surface);
        state = { kind: 'pot', water: false, ingredients: 0, progress: 0, ready: 0, surface, steam: 0 };
        break;
      }
      default:
        return null;
    }
    this.states.set(s, state);
    return state;
  }

  // ---------------------------------------------------------------------------
  // Hinweise und `E`
  // ---------------------------------------------------------------------------

  prompt(s: Structure): Prompt | null {
    const label = s.def.name;
    const held = this.d.heldItem();
    if (s.def.camp === 'workbench') {
      const repair = this.d.repairPrompt();
      return repair ? { key: 'E', action: repair, label } : { key: null, action: 'Lager-Baupläne freigeschaltet', label };
    }
    const st = this.state(s);
    if (!st) return null;
    switch (st.kind) {
      case 'rack': {
        const ready = st.slots.filter((x) => x && x.progress >= 1).length;
        const drying = st.slots.filter((x) => x && x.progress < 1);
        const best = Math.max(0, ...drying.map((x) => x!.progress));
        const status = drying.length ? `${label} · ${drying.length}× trocknet (${Math.round(best * 100)} %)` : label;
        if (ready) return { key: 'E', action: `Trockenfleisch abnehmen (${ready})`, label: status };
        if (held && DRYABLE[held] && st.slots.includes(null)) return { key: 'E', action: held === 'rawFish' ? 'Fisch aufhängen' : 'Fleisch aufhängen', label: status };
        return { key: null, action: drying.length ? 'Trocknet' : 'Rohes Fleisch oder Fisch zum Aufhängen', label: status };
      }
      case 'barrel': {
        const n = Math.floor(st.water);
        const status = `${label} · ${n}/${BARREL_MAX}`;
        if (n < 1) return { key: null, action: 'Leer – sammelt Regenwasser', label: status };
        const fills = held ? getItem(held).fillsTo : undefined;
        if (fills) return { key: 'E', action: held === 'bowl' ? 'Schale füllen' : 'Flasche füllen', label: status };
        return { key: 'E', action: 'Trinken', label: status };
      }
      case 'garden': {
        if (!st.crop) {
          if (held && PLANTABLE[held]) return { key: 'E', action: `${PLANTABLE[held]!.name} pflanzen`, label };
          return { key: null, action: 'Beeren oder Pilze in der Hand zum Pflanzen', label };
        }
        const name = PLANTABLE[st.crop]!.name;
        if (st.growth >= 1) return { key: 'E', action: `${name} ernten`, label };
        return { key: null, action: `${name} wachsen (${Math.round(st.growth * 100)} %)`, label };
      }
      case 'pot': {
        const status = st.ready
          ? `${label} · Eintopf fertig (${st.ready})`
          : st.water && st.ingredients >= 2 && s.lit
            ? `${label} · köchelt (${Math.round(st.progress * 100)} %)`
            : `${label} · ${st.water ? 'Wasser' : 'kein Wasser'} · ${st.ingredients}/${POT_MAX} Zutaten`;
        if (st.ready) {
          return this.d.inventory.has('bowl') ? { key: 'E', action: 'Eintopf schöpfen', label: status } : { key: null, action: 'Leere Schale zum Schöpfen nötig', label: status };
        }
        if (!st.water && held && WATER_SOURCES[held]) return { key: 'E', action: 'Wasser eingießen', label: status };
        if (st.water && st.ingredients < POT_MAX && held && INGREDIENTS.has(held)) return { key: 'E', action: `${getItem(held).name} hineingeben`, label: status };
        return { key: 'E', action: s.lit ? 'Feuer löschen' : 'Feuer anzünden', label: status };
      }
    }
  }

  interact(s: Structure): void {
    const held = this.d.heldItem();
    const at = this.tmp.copy(s.position).setY(s.position.y + 0.9);
    if (s.def.camp === 'workbench') {
      if (this.d.repairHeld()) this.d.audio.play('craft', { position: at });
      return;
    }
    const st = this.state(s);
    if (!st) return;
    switch (st.kind) {
      case 'rack': {
        const ready = st.slots.filter((x) => x && x.progress >= 1).length;
        if (ready) {
          st.slots.forEach((x, i) => {
            if (x && x.progress >= 1) this.removeStrip(s, st, i);
          });
          this.d.items.give('jerky', ready, at);
          this.d.audio.play('pickup', { position: at });
          return;
        }
        if (held && DRYABLE[held] && this.hang(s, st, held, 0)) {
          this.d.takeHeld();
          this.d.audio.play('place', { volume: 0.6, position: at });
        }
        return;
      }
      case 'barrel': {
        if (st.water < 1) return;
        st.water -= 1;
        const fills = held ? getItem(held).fillsTo : undefined;
        if (fills) this.d.transformHeld(fills);
        else {
          this.d.drink(this.d.drinkAmount);
          this.d.events.emit('hud:message', { text: 'Kühles Regenwasser.' });
        }
        this.d.audio.play('drink', { volume: 0.7, position: at });
        return;
      }
      case 'garden': {
        if (!st.crop && held && PLANTABLE[held]) {
          this.d.takeHeld();
          st.crop = held;
          st.growth = 0;
          this.d.audio.play('place', { volume: 0.5, position: at });
          this.d.particles.burst(at.setY(s.position.y + 0.25), { count: 8, color: 0x4a3a2a, speed: 1.2, size: 0.025 });
          this.d.events.emit('hud:message', { text: `${PLANTABLE[held]!.name} gepflanzt. Regen lässt sie schneller wachsen.` });
        } else if (st.crop && st.growth >= 1) {
          this.d.items.give(st.crop, PLANTABLE[st.crop]!.yield, at);
          // Die Pflanzen bleiben stehen und tragen nach einer Weile wieder.
          st.growth = 0.35;
          this.d.audio.play('pickup', { position: at });
          this.d.events.emit('crop:harvested', { item: st.crop });
        }
        this.updatePlants(st);
        return;
      }
      case 'pot': {
        if (st.ready) {
          let n = 0;
          while (st.ready > 0 && this.d.inventory.remove('bowl', 1)) {
            st.ready--;
            n++;
          }
          if (n) this.d.items.give('stew', n, at);
          if (n) this.d.events.emit('food:cooked', { count: n });
          this.d.audio.play('drink', { volume: 0.5, position: at });
        } else if (!st.water && held && WATER_SOURCES[held]) {
          st.water = true;
          this.d.transformHeld(WATER_SOURCES[held]!);
          this.d.audio.play('stepWater', { volume: 0.6, position: at });
        } else if (st.water && st.ingredients < POT_MAX && held && INGREDIENTS.has(held)) {
          this.d.takeHeld();
          st.ingredients++;
          this.d.audio.play('stepWater', { volume: 0.35, position: at });
        } else {
          this.d.building.toggleFire(s);
        }
        this.updatePot(s, st);
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Zeit
  // ---------------------------------------------------------------------------

  update(dt: number, env: CampEnv): void {
    // Neue Bauwerke sammeln sofort Regen, auch wenn noch niemand hingesehen hat.
    for (const s of this.d.building.structures) if (s.def.camp && !this.states.has(s)) this.state(s);
    for (const [s, st] of this.states) {
      if (!this.d.building.structures.includes(s)) {
        this.removed(s, st);
        continue;
      }
      switch (st.kind) {
        case 'rack': {
          // Im Regen trocknet nichts – außer unter einem Dach.
          if (env.rain > 0.3 && !this.d.roofAbove(this.tmp.copy(s.position).setY(s.position.y + 1.7))) break;
          for (const x of st.slots) {
            if (!x || x.progress >= 1) continue;
            x.progress = Math.min(1, x.progress + dt / DRY_TIME);
            this.tintStrip(x);
            if (x.progress >= 1) this.d.events.emit('hud:message', { text: 'Am Trockengestell ist Trockenfleisch fertig.' });
          }
          break;
        }
        case 'barrel': {
          if (env.rain > 0.05 && !this.d.roofAbove(this.tmp.copy(s.position).setY(s.position.y + 1.1))) {
            st.water = Math.min(BARREL_MAX, st.water + (dt * env.rain * BARREL_MAX) / BARREL_FILL_TIME);
          }
          this.updateBarrel(st);
          break;
        }
        case 'garden': {
          if (!st.crop || st.growth >= 1 || env.winter) break;
          const before = st.growth;
          st.growth = Math.min(1, st.growth + (dt * (1 + 0.6 * env.rain)) / GROW_TIME);
          if (st.growth >= 1 && before < 1) this.d.events.emit('hud:message', { text: `Im Gartenbeet sind ${PLANTABLE[st.crop]!.name} reif.` });
          this.updatePlants(st);
          break;
        }
        case 'pot': {
          const cooking = s.lit && st.water && st.ingredients >= 2 && st.ready === 0;
          if (cooking) {
            st.progress = Math.min(1, st.progress + dt / STEW_TIME);
            st.steam -= dt;
            if (st.steam <= 0) {
              st.steam = 0.35;
              this.d.particles.burst(this.tmp.copy(s.position).setY(s.position.y + 0.75), {
                count: 2,
                color: 0xd8d8d0,
                speed: 0.6,
                spread: 0.3,
                size: 0.05,
                gravity: -0.6,
                life: 1.6,
              });
            }
            if (st.progress >= 1) {
              st.ready = st.ingredients;
              st.ingredients = 0;
              st.water = false;
              st.progress = 0;
              this.d.events.emit('hud:message', { text: 'Der Eintopf ist fertig – mit einer leeren Schale schöpfen.' });
            }
          }
          this.updatePot(s, st);
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Darstellung
  // ---------------------------------------------------------------------------

  private hang(s: Structure, st: RackState, item: ItemId, progress: number): boolean {
    const slot = st.slots.indexOf(null);
    if (slot < 0 || !DRYABLE[item]) return false;
    const mesh = new THREE.Mesh(stripGeometry, new THREE.MeshStandardMaterial({ roughness: 0.6, flatShading: true }));
    mesh.position.set(-0.6 + slot * 0.4, 1.32, 0);
    mesh.rotation.set(0.05 * (slot % 2 ? 1 : -1), slot * 0.4, 0);
    mesh.castShadow = true;
    s.object.add(mesh);
    const strip = { item, progress, mesh };
    st.slots[slot] = strip;
    this.tintStrip(strip);
    return true;
  }

  private tintStrip(x: Strip): void {
    const c = DRYABLE[x.item]!;
    const m = x.mesh.material as THREE.MeshStandardMaterial;
    m.color.copy(c.raw).lerp(c.done, x.progress);
    // Trocknendes Fleisch schrumpft und wellt sich.
    x.mesh.scale.set(1 - 0.25 * x.progress, 1 - 0.15 * x.progress, 1);
  }

  private removeStrip(s: Structure, st: RackState, i: number): void {
    const x = st.slots[i];
    if (!x) return;
    s.object.remove(x.mesh);
    (x.mesh.material as THREE.Material).dispose();
    st.slots[i] = null;
  }

  private updateBarrel(st: BarrelState): void {
    st.surface.visible = st.water > 0.05;
    st.surface.position.y = 0.1 + 0.8 * (st.water / BARREL_MAX);
  }

  private updatePlants(st: GardenState): void {
    st.plants.clear();
    if (!st.crop) return;
    const g = Math.max(0.15, st.growth);
    for (let i = 0; i < 3; i++) {
      const plant = new THREE.Group();
      plant.position.set(-0.55 + i * 0.55, 0.18, (i % 2 ? 0.12 : -0.12));
      if (st.crop === 'berries') {
        for (let k = 0; k < 3; k++) {
          const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), leafMaterial);
          leaf.position.set((k - 1) * 0.08, 0.12, (k % 2) * 0.06);
          leaf.scale.set(1, 0.8, 1);
          plant.add(leaf);
        }
        if (st.growth >= 1) {
          for (let k = 0; k < 6; k++) {
            const berry = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), berryMaterial);
            berry.position.set(Math.cos(k * 2.1) * 0.15, 0.1 + (k % 3) * 0.05, Math.sin(k * 2.1) * 0.12);
            plant.add(berry);
          }
        }
      } else {
        for (let k = 0; k < 4; k++) {
          const h = 0.06 + (k % 2) * 0.04;
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, h, 5), stemMaterial);
          stem.position.set(Math.cos(k * 1.6) * 0.07, h / 2, Math.sin(k * 1.6) * 0.07);
          plant.add(stem);
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), capMaterial);
          cap.position.set(stem.position.x, h, stem.position.z);
          plant.add(cap);
        }
      }
      plant.scale.setScalar(g);
      st.plants.add(plant);
    }
  }

  private updatePot(s: Structure, st: PotState): void {
    const filled = st.water || st.ready > 0;
    st.surface.visible = filled;
    if (!filled) return;
    const m = st.surface.material as THREE.MeshStandardMaterial;
    const k = st.ready ? 1 : Math.min(1, st.ingredients / POT_MAX * 0.6 + st.progress * 0.4);
    m.color.copy(WATER).lerp(STEW, k);
    // Köchelnd: der Spiegel zittert leicht.
    st.surface.position.y = 0.68 + (s.lit && st.ingredients >= 2 ? Math.sin(performance.now() * 0.02) * 0.004 : 0);
  }

  /** Bauwerk abgerissen: Hängendes Fleisch fällt herunter. */
  private removed(s: Structure, st: CampState): void {
    if (st.kind === 'rack') {
      const at = this.tmp.copy(s.position).setY(s.position.y + 1);
      for (const x of st.slots) if (x) this.d.items.drop(x.progress >= 1 ? 'jerky' : x.item, 1, at);
    }
    this.states.delete(s);
  }

  // ---------------------------------------------------------------------------
  // Spielstand
  // ---------------------------------------------------------------------------

  serialize(): CampSave {
    const out: CampSave = [];
    for (const [s, st] of this.states) {
      const structure = this.d.building.structures.indexOf(s);
      if (structure < 0) continue;
      if (st.kind === 'rack') out.push({ structure, rack: st.slots.filter((x): x is Strip => !!x).map((x) => [x.item, x.progress]) });
      else if (st.kind === 'barrel') out.push({ structure, water: st.water });
      else if (st.kind === 'garden') out.push({ structure, crop: st.crop, growth: st.growth });
      else out.push({ structure, pot: { water: st.water, ingredients: st.ingredients, progress: st.progress, ready: st.ready } });
    }
    return out;
  }

  load(data: CampSave | undefined, structures: readonly Structure[]): void {
    for (const d of data ?? []) {
      const s = structures[d.structure];
      if (!s?.def.camp) continue;
      const st = this.state(s);
      if (!st) continue;
      const clamp01 = (x: unknown) => (typeof x === 'number' ? Math.max(0, Math.min(1, x)) : 0);
      if (st.kind === 'rack') {
        for (const [item, progress] of d.rack ?? []) if (isItemId(item)) this.hang(s, st, item, clamp01(progress));
      } else if (st.kind === 'barrel') {
        st.water = Math.max(0, Math.min(BARREL_MAX, Number(d.water) || 0));
        this.updateBarrel(st);
      } else if (st.kind === 'garden') {
        st.crop = d.crop && isItemId(d.crop) && PLANTABLE[d.crop] ? d.crop : null;
        st.growth = clamp01(d.growth);
        this.updatePlants(st);
      } else if (d.pot) {
        st.water = !!d.pot.water;
        st.ingredients = Math.max(0, Math.min(POT_MAX, Math.round(d.pot.ingredients) || 0));
        st.progress = clamp01(d.pot.progress);
        st.ready = Math.max(0, Math.min(POT_MAX, Math.round(d.pot.ready) || 0));
        this.updatePot(s, st);
      }
    }
  }
}
