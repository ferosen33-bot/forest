/**
 * Minimaler, typisierter Event-Bus zur Entkopplung von Systemen
 * (z. B. Spieler meldet Schaden -> HUD zeigt Treffer-Feedback, Audio spielt Sound).
 */
import type { Vector3 } from 'three';
import type { ItemId } from '../entities/items/ItemDefs';
import type { StructureId } from '../systems/building/StructureDefs';

export type GameEvents = {
  'player:damaged': { amount: number; source: DamageSource };
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
  'tree:felled': { kind: 'pine' | 'broadleaf' };
  /** Ein gefällter Baum schlägt auf dem Boden auf (für Kamerawackeln/Effekte). */
  'tree:landed': { position: Vector3 };
  'structure:placed': { id: StructureId };
  'item:crafted': { item: ItemId; count: number };
  /** Kurze Statusmeldung im HUD. */
  'hud:message': { text: string };
};

export type DamageSource = 'fall' | 'starvation' | 'dehydration' | 'drowning' | 'enemy' | 'world';

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
