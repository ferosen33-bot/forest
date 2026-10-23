import { getItem, type ItemId } from '../entities/items/ItemDefs';

export interface ItemStack {
  id: ItemId;
  count: number;
  /** Verbleibende Haltbarkeit (nur Items mit `durability`; solche Stapel haben immer count = 1). */
  durability?: number;
}

export type Slot = ItemStack | null;

/** Serialisierte Form für Spielstände. */
export type InventoryData = (ItemStack | null)[];

/** Items mit Haltbarkeit stapeln nie. */
const stackable = (id: ItemId) => getItem(id).durability === undefined;

/**
 * Slot-basiertes Inventar. Die ersten `hotbarSize` Slots bilden die Schnellzugriffsleiste.
 *
 * Reine Spiellogik ohne DOM/Three.js – dadurch einfach testbar und direkt serialisierbar.
 */
export class Inventory {
  readonly slots: Slot[];
  private listeners = new Set<() => void>();

  constructor(
    size = 30,
    readonly hotbarSize = 6,
  ) {
    this.slots = Array.from({ length: size }, () => null);
  }

  get size(): number {
    return this.slots.length;
  }

  /** Mehr Rucksackplätze (großer Rucksack). */
  grow(extra: number): void {
    for (let i = 0; i < extra; i++) this.slots.push(null);
    this.changed();
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
      else if (s.id === id && stackable(id)) free += max - s.count;
    }
    return free;
  }

  /**
   * Fügt Items hinzu: zuerst auf bestehende Stapel, dann in freie Slots
   * (Werkzeuge bevorzugt in die Schnellzugriffsleiste, Rohstoffe in den Rucksack).
   * @param durability Zustand für Items mit Haltbarkeit (Standard: neu).
   * @returns Anzahl, die nicht mehr hineinpasste.
   */
  add(id: ItemId, amount: number, durability?: number): number {
    const def = getItem(id);
    let rest = amount;

    if (stackable(id)) {
      for (const s of this.slots) {
        if (rest <= 0) break;
        if (s?.id === id && s.count < def.maxStack) {
          const n = Math.min(def.maxStack - s.count, rest);
          s.count += n;
          rest -= n;
        }
      }
    }

    for (const index of this.freeSlotOrder(def.category === 'tool' ? 'hotbar' : def.category === 'food' ? 'hotbar' : 'backpack')) {
      if (rest <= 0) break;
      if (def.durability !== undefined) {
        this.slots[index] = { id, count: 1, durability: durability ?? def.durability };
        rest -= 1;
      } else {
        const n = Math.min(def.maxStack, rest);
        this.slots[index] = { id, count: n };
        rest -= n;
      }
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
    return s.durability !== undefined ? { id: s.id, count: n, durability: s.durability } : { id: s.id, count: n };
  }

  /**
   * Verschleißt das Item in einem Slot.
   * @returns true, wenn es dabei zerbrochen bzw. abgebrannt ist (Slot ist danach leer).
   */
  /**
   * Wandelt ein Stück im Slot in ein anderes Item um (Schale füllen/austrinken). Liegt nur eins im Slot,
   * wird es an Ort und Stelle ersetzt; sonst landet das neue Item im nächsten freien Platz.
   * @returns Anzahl, die nicht mehr ins Inventar passte (0 oder 1).
   */
  transform(index: number, to: ItemId): number {
    const s = this.slots[index];
    if (!s) return 0;
    if (s.count === 1) {
      this.slots[index] = { id: to, count: 1 };
      this.changed();
      return 0;
    }
    s.count--;
    this.changed();
    return this.add(to, 1);
  }

  /** Setzt die Haltbarkeit eines Exemplars wieder auf den Neuwert (z. B. neue Batterie). */
  restore(index: number): boolean {
    const s = this.slots[index];
    const max = s ? getItem(s.id).durability : undefined;
    if (!s || max === undefined) return false;
    s.durability = max;
    this.changed();
    return true;
  }

  wear(index: number, amount: number): boolean {
    const s = this.slots[index];
    if (!s || s.durability === undefined) return false;
    s.durability = Math.max(0, s.durability - amount);
    if (s.durability > 0) {
      // Kein `changed()` für jede Zehntelsekunde Fackel – die Anzeige liest den Wert direkt.
      return false;
    }
    this.slots[index] = null;
    this.changed();
    return true;
  }

  /** Haltbarkeit in [0, 1] (1 = neu), oder null, wenn das Item keine hat. */
  condition(index: number): number | null {
    const s = this.slots[index];
    const max = s ? getItem(s.id).durability : undefined;
    // Handwerklich gute Werkzeuge können über dem Neuwert liegen – die Anzeige endet bei 100 %.
    return s && max !== undefined && s.durability !== undefined ? Math.min(1, s.durability / max) : null;
  }

  /**
   * Verschiebt den Inhalt von `from` nach `to`: gleiche, stapelbare Items werden
   * zusammengelegt (Rest bleibt im Ursprung), alles andere getauscht.
   */
  move(from: number, to: number): void {
    if (from === to) return;
    const a = this.slots[from];
    const b = this.slots[to];
    if (!a) return;

    if (b && b.id === a.id && stackable(a.id)) {
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

  /**
   * Verschieben in ein anderes Inventar (Lagerkiste): auf einen leeren Slot oder gleichen Stapel
   * (Rest bleibt), sonst Tausch. Mit `to = -1` wird der erste passende Platz gesucht.
   */
  transferTo(from: number, other: Inventory, to = -1): void {
    const a = this.slots[from];
    if (!a) return;
    if (to < 0) {
      // Erst auffüllen, dann der Rest in freie Plätze – so wie beim Aufheben.
      const rest = other.add(a.id, a.count, a.durability);
      if (rest === a.count) return;
      if (rest === 0) this.slots[from] = null;
      else a.count = rest;
      this.changed();
      return;
    }
    const b = other.slots[to];
    if (b && b.id === a.id && stackable(a.id)) {
      const n = Math.min(getItem(a.id).maxStack - b.count, a.count);
      b.count += n;
      a.count -= n;
      if (a.count === 0) this.slots[from] = null;
    } else {
      other.slots[to] = a;
      this.slots[from] = b;
    }
    this.changed();
    other.changed();
  }

  /** Alle Stapel entnehmen (z. B. wenn eine Kiste zerstört wird). */
  takeAll(): ItemStack[] {
    const out = this.slots.filter((s): s is ItemStack => s !== null).map((s) => ({ ...s }));
    this.slots.fill(null);
    this.changed();
    return out;
  }

  /** Schnelles Umlagern: Schnellzugriffsleiste ↔ Rucksack. */
  quickMove(index: number): void {
    const s = this.slots[index];
    if (!s) return;
    const target = index < this.hotbarSize ? 'backpack' : 'hotbar';
    const max = getItem(s.id).maxStack;

    // Erst auf passende Stapel im Zielbereich verteilen …
    if (stackable(s.id)) {
      for (const i of this.range(target)) {
        const t = this.slots[i];
        if (t?.id === s.id && t.count < max) {
          const n = Math.min(max - t.count, s.count);
          t.count += n;
          s.count -= n;
          if (s.count === 0) break;
        }
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

  /** Für Spielstände: tiefe Kopie aller Slots. */
  serialize(): InventoryData {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  /** Lädt einen Spielstand; unbekannte Items werden verworfen. */
  load(data: InventoryData, isKnown: (id: string) => boolean): void {
    for (let i = 0; i < this.size; i++) {
      const s = data[i];
      this.slots[i] = s && isKnown(s.id) && s.count > 0 ? { ...s } : null;
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
