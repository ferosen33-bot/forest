import type { InventoryData } from './Inventory';
import type { VegetationSave } from '../world/Vegetation';
import type { HarvestSave } from './HarvestSystem';
import type { StructureSave } from './building/BuildingSystem';
import type { WorldItemSave } from '../entities/items/WorldItems';
import type { EnemySave } from './ai/EnemyDirector';
import type { AnimalSave } from './AnimalDirector';
import type { CookingSave } from './Cooking';
import type { WeatherSave } from './Weather';

/** Erhöhen, wenn sich das Format inkompatibel ändert (ältere Stände werden dann verworfen). */
export const SAVE_VERSION = 1;
const STORAGE_KEY = 'wildwood.save';

export interface SaveData {
  version: number;
  /** Seed + Weltgröße: Ein Spielstand passt nur zu genau der Welt, in der er entstand. */
  world: string;
  savedAt: string;
  player: {
    p: [number, number, number];
    yaw: number;
    pitch: number;
    health: number;
    stamina: number;
    hunger: number;
    thirst: number;
    respawn: [number, number, number];
    selected: number;
    /** Seit Meilenstein 9 (fehlt in älteren Ständen). */
    wetness?: number;
  };
  time: { day: number; hour: number };
  inventory: InventoryData;
  vegetation: VegetationSave;
  harvest: HarvestSave;
  structures: StructureSave[];
  cooking: CookingSave;
  items: WorldItemSave[];
  enemies: EnemySave[];
  animals: AnimalSave[];
  /** Seit Meilenstein 9 (fehlt in älteren Ständen). */
  weather?: WeatherSave;
}

/** Kurzinfo für das Startmenü. */
export interface SaveSummary {
  day: number;
  hour: number;
  savedAt: Date;
}

/** Minimale Speicher-Schnittstelle (localStorage oder Test-Attrappe). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function worldKey(seed: number, size: number, cellSize: number): string {
  return `${seed}:${size}:${cellSize}`;
}

/**
 * Prüft, ob ein geparster Wert ein verwendbarer Spielstand für diese Welt ist.
 * Bewusst defensiv: Spielstände können von Hand bearbeitet oder von älteren Versionen sein.
 */
export function isValidSave(data: unknown, world: string): data is SaveData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<SaveData>;
  const vec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n));
  return (
    d.version === SAVE_VERSION &&
    d.world === world &&
    !!d.player &&
    vec(d.player.p) &&
    vec(d.player.respawn) &&
    Number.isFinite(d.player.health) &&
    !!d.time &&
    Number.isFinite(d.time.hour) &&
    Array.isArray(d.inventory) &&
    !!d.vegetation &&
    Array.isArray(d.vegetation.removed) &&
    !!d.harvest &&
    Array.isArray(d.structures) &&
    Array.isArray(d.cooking) &&
    Array.isArray(d.items) &&
    Array.isArray(d.enemies) &&
    Array.isArray(d.animals)
  );
}

/**
 * Spielstand im Browser-Speicher (localStorage). Ein Slot; Fehler beim Schreiben
 * (voll, privater Modus) werden gemeldet statt das Spiel abstürzen zu lassen.
 */
export class SaveStore {
  constructor(
    private readonly world: string,
    private readonly storage: KeyValueStorage | null = SaveStore.defaultStorage(),
  ) {}

  private static defaultStorage(): KeyValueStorage | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  }

  get available(): boolean {
    return this.storage !== null;
  }

  /** @returns true bei Erfolg. */
  save(data: SaveData): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('[Save] Speichern fehlgeschlagen', e);
      return false;
    }
  }

  load(): SaveData | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data: unknown = JSON.parse(raw);
      return isValidSave(data, this.world) ? data : null;
    } catch {
      return null;
    }
  }

  summary(): SaveSummary | null {
    const d = this.load();
    return d ? { day: d.time.day, hour: d.time.hour, savedAt: new Date(d.savedAt) } : null;
  }

  clear(): void {
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      /* egal */
    }
  }
}
