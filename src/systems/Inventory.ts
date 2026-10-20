import { getItem, type ItemId } from '../entities/items/ItemDefs';

export interface ItemStack {
  id: ItemId;
  count: number;
}

export type Slot = ItemStack | null;

/**
 * Slot-basiertes Inventar. Die ersten `hotbarSize` Slots bilden die Schnellzugriffsleiste.
 *
 * Reine Spiellogik ohne DOM/Three.js – dadurch einfach testbar und später
 * direkt serialisierbar (Savegames).
 */
export class Inventory {
  readonly slots: Slot[];
  private listeners = new Set<() => void>();

  constructor(
    readonly size = 30,
    readonly hotbarSize = 6,
  ) {
    this.slots = Array.from({ length: size }, () => null);
  }

  /** Benachrichtigt bei jeder Änderung (UI-Aktualisierung). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }

  get(index: number): Slot {
    return this.slots[index] ?? null;
  }

  count(id: ItemId): number {
    let n = 0;
    for (const s of this.slots) if (s?.id === id) n += s.count;
    return n;
  }

  has(id: ItemId, amount = 1): boolean {
    return this.count(id) >= amount;
  }

  /** Wie viele Exemplare passen noch hinein? */
  capacityFor(id: ItemId): number {
    const max = getItem(id).maxStack;
    let free = 0;
    for (const s of this.slots) {
      if (s === null) free += max;
      else if (s.id === id) free += max - s.count;
    }
    return free;
  }

  /**
   * Fügt Items hinzu: zuerst auf bestehende Stapel, dann in freie Slots
   * (Werkzeuge bevorzugt in die Schnellzugriffsleiste, Rohstoffe in den Rucksack).
   * @returns Anzahl, die nicht mehr hineinpasste.
   */
  add(id: ItemId, amount: number): number {
    const def = getItem(id);
    let rest = amount;

    for (const s of this.slots) {
      if (rest <= 0) break;
      if (s?.id === id && s.count < def.maxStack) {
        const n = Math.min(def.maxStack - s.count, rest);
        s.count += n;
        rest -= n;
      }
    }

    for (const index of this.freeSlotOrder(def.category === 'resource' ? 'backpack' : 'hotbar')) {
      if (rest <= 0) break;
      const n = Math.min(def.maxStack, rest);
      this.slots[index] = { id, count: n };
      rest -= n;
    }

    if (rest !== amount) this.changed();
    return rest;
  }

  /**
   * Entfernt Items (von hinten nach vorne, damit die Schnellzugriffsleiste möglichst erhalten bleibt).
   * @returns true, wenn genug vorhanden war; sonst wird nichts entfernt.
   */
  remove(id: ItemId, amount: number): boolean {
    if (!this.has(id, amount)) return false;
    let rest = amount;
    for (let i = this.slots.length - 1; i >= 0 && rest > 0; i--) {
      const s = this.slots[i];
      if (s?.id !== id) continue;
      const n = Math.min(s.count, rest);
      s.count -= n;
      rest -= n;
      if (s.count === 0) this.slots[i] = null;
    }
    this.changed();
    return true;
  }

  /** Entfernt `amount` aus einem bestimmten Slot und gibt den entnommenen Stapel zurück. */
  takeFromSlot(index: number, amount = Infinity): ItemStack | null {
    const s = this.slots[index];
    if (!s) return null;
    const n = Math.min(amount, s.count);
    s.count -= n;
    if (s.count === 0) this.slots[index] = null;
    this.changed();
    return { id: s.id, count: n };
  }

  /**
   * Verschiebt den Inhalt von `from` nach `to`: gleiche Items werden zusammengelegt
   * (Rest bleibt im Ursprung), unterschiedliche getauscht.
   */
  move(from: number, to: number): void {
    if (from === to) return;
    const a = this.slots[from];
    const b = this.slots[to];
    if (!a) return;

    if (b && b.id === a.id) {
      const max = getItem(a.id).maxStack;
      const n = Math.min(max - b.count, a.count);
      b.count += n;
      a.count -= n;
      if (a.count === 0) this.slots[from] = null;
    } else {
      this.slots[to] = a;
      this.slots[from] = b;
    }
    this.changed();
  }

  /** Schnelles Umlagern: Schnellzugriffsleiste ↔ Rucksack. */
  quickMove(index: number): void {
    const s = this.slots[index];
    if (!s) return;
    const target = index < this.hotbarSize ? 'backpack' : 'hotbar';
    const max = getItem(s.id).maxStack;

    // Erst auf passende Stapel im Zielbereich verteilen …
    for (const i of this.range(target)) {
      const t = this.slots[i];
      if (t?.id === s.id && t.count < max) {
        const n = Math.min(max - t.count, s.count);
        t.count += n;
        s.count -= n;
        if (s.count === 0) break;
      }
    }
    // … dann den Rest in einen freien Slot.
    if (s.count > 0) {
      const free = this.range(target).find((i) => this.slots[i] === null);
      if (free !== undefined) {
        this.slots[free] = s;
        this.slots[index] = null;
      }
    } else {
      this.slots[index] = null;
    }
    this.changed();
  }

  private range(area: 'hotbar' | 'backpack'): number[] {
    const out: number[] = [];
    const [start, end] = area === 'hotbar' ? [0, this.hotbarSize] : [this.hotbarSize, this.size];
    for (let i = start; i < end; i++) out.push(i);
    return out;
  }

  /** Freie Slots, bevorzugter Bereich zuerst. */
  private freeSlotOrder(preferred: 'hotbar' | 'backpack'): number[] {
    const other = preferred === 'hotbar' ? 'backpack' : 'hotbar';
    return [...this.range(preferred), ...this.range(other)].filter((i) => this.slots[i] === null);
  }
}
