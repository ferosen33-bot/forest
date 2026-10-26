/**
 * Minimaler, typisierter Event-Bus zur Entkopplung von Systemen
 * (z. B. Spieler meldet Schaden -> HUD zeigt Treffer-Feedback, Audio spielt Sound).
 */
import type { Vector3 } from 'three';
import type { ItemId } from '../entities/items/ItemDefs';
import type { StructureId } from '../systems/building/StructureDefs';
import type { PerkId, SkillId } from '../systems/Skills';

export type GameEvents = {
  /** `from`: Position des Angreifers (für die Richtungsanzeige). */
  'player:damaged': { amount: number; source: DamageSource; from?: Vector3 };
  'player:blocked': { amount: number };
  /** Landung nach einem Sprung/Fall (Aufprallgeschwindigkeit in m/s). */
  'player:landed': { impact: number };
  'player:died': { cause: DamageSource };
  'player:respawned': Record<string, never>;
  'player:drank': { amount: number };
  'player:ate': { item: ItemId };
  /** Items wurden ins Inventar aufgenommen. */
  'item:collected': { item: ItemId; count: number };
  /** Inventar voll – Rest wurde in die Welt fallengelassen. */
  'item:inventoryFull': { item: ItemId; dropped: number };
  /** Ein Werkzeugschlag hat etwas getroffen (für Fadenkreuz-Feedback). */
  'tool:hit': { target: 'tree' | 'rock' | 'creature' | 'other' };
  'tree:felled': { kind: 'pine' | 'broadleaf'; position: Vector3 };
  /** Ein gefällter Baum schlägt auf dem Boden auf (für Kamerawackeln/Effekte). */
  'tree:landed': { position: Vector3 };
  'structure:placed': { id: StructureId; position: Vector3; rotation: number };
  'item:crafted': { item: ItemId; count: number };
  'structure:removed': { id: StructureId; position: Vector3; rotation: number };
  'structure:door': { id: StructureId; position: Vector3; rotation: number; open: boolean };
  /** Lautes Ereignis, das Gegner im Umkreis `radius` hören. */
  noise: { position: Vector3; radius: number };
  'enemy:hit': { health: number; maxHealth: number; killed: boolean; headshot: boolean; sneak: boolean; name: string };
  'animal:killed': { species: 'deer' | 'rabbit' | 'wolf' };
  /** Ein Endgegner ist gefallen. */
  'boss:killed': { name: string };
  'player:slept': Record<string, never>;
  'camp:discovered': { index: number };
  'food:cooked': { count: number };
  'crop:harvested': { item: ItemId };
  /** Höhle betreten (`first`: zum ersten Mal), Vorratskiste geöffnet. */
  'cave:entered': { index: number; first: boolean };
  'cave:crate': { index: number };
  /** Stadt: Behälter durchsucht, Ort entdeckt. */
  'loot:searched': { kind: string; items: ItemId[] };
  'town:discovered': { name: string };
  /** Besonderer Ort entdeckt (Absturzstelle, Zeche, Hütte, Funkstation). */
  'place:discovered': { kind: string; name: string };
  /** Erstes Betreten eines Gebiets (Gebirge, Sumpf, Klippen). */
  'biome:entered': { name: string };
  /** Abspann gesehen: Die Geschichte ist erzählt. */
  'story:ended': Record<string, never>;
  /** Zufallsereignis begonnen bzw. geplündert. */
  'world:event': { kind: string; phase: 'start' | 'looted' };
  /** Die Überlebenden in der Nordbucht wurden gefunden. */
  'harbor:found': Record<string, never>;
  'npc:met': { id: string };
  'quest:completed': { id: string };
  /** Eine Fiebernacht wurde überlebt. */
  'fever:survived': { number: number };
  /** Eine Fertigkeit ist eine Stufe aufgestiegen. */
  'skill:levelUp': { id: SkillId; level: number };
  'skill:perk': { id: PerkId };
  /** Eine Notiz wurde gelesen (`first`: zum ersten Mal). */
  'note:read': { id: string; first: boolean };
  /** Fische gefangen (Angel) bzw. aus einer Reuse genommen. */
  'fish:caught': { count: number; trap: boolean };
  /** Tagebuch: ein Ziel wurde erreicht. */
  'journal:completed': { id: string; text: string; chapterDone: boolean };
  /** Kurze Statusmeldung im HUD. */
  'hud:message': { text: string };
};

export type DamageSource = 'fall' | 'starvation' | 'dehydration' | 'drowning' | 'enemy' | 'sickness' | 'cold' | 'fire' | 'world';

type Handler<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown> = GameEvents> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  /** Registriert einen Listener und liefert eine Funktion zum Abmelden zurück. */
  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) (handler as Handler<Events[K]>)(payload);
  }
}
