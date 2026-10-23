import { getItem, type ItemCost, type ItemId } from '../entities/items/ItemDefs';
import { getStructure, type StructureId } from './building/StructureDefs';
import type { Inventory } from './Inventory';

/**
 * Rezept: entweder ein Item (wird sofort hergestellt) oder ein Bauplan
 * (Material wird erst beim Platzieren verbraucht).
 */
export type Recipe =
  | { id: string; kind: 'item'; result: ItemId; count: number; cost: ItemCost[] }
  | { id: string; kind: 'structure'; result: StructureId; cost: ItemCost[] };

const item = (result: ItemId, cost: ItemCost[], count = 1): Recipe => ({ id: result, kind: 'item', result, count, cost });
const structure = (result: StructureId): Recipe => ({
  id: result,
  kind: 'structure',
  result,
  cost: getStructure(result).cost,
});

export const RECIPES: Recipe[] = [
  item('stoneAxe', [
    { item: 'stick', count: 1 },
    { item: 'stone', count: 2 },
  ]),
  item('spear', [
    { item: 'stick', count: 2 },
    { item: 'stone', count: 1 },
  ]),
  item('torch', [{ item: 'stick', count: 2 }]),
  item('bowl', [{ item: 'log', count: 1 }]),
  item('backpack', [
    { item: 'hide', count: 4 },
    { item: 'stick', count: 2 },
  ]),
  item('furCoat', [{ item: 'hide', count: 5 }]),
  item('fishingRod', [
    { item: 'stick', count: 2 },
    { item: 'hide', count: 1 },
  ]),
  item('bow', [
    { item: 'log', count: 1 },
    { item: 'stick', count: 2 },
  ]),
  item(
    'arrow',
    [
      { item: 'stick', count: 2 },
      { item: 'stone', count: 1 },
    ],
    4,
  ),
  structure('campfire'),
  structure('floor'),
  structure('wall'),
  structure('gate'),
  structure('stairs'),
  structure('shelter'),
  structure('chest'),
  structure('spikeTrap'),
  structure('snare'),
  structure('fishTrap'),
  structure('torchPost'),
];

export const recipeName = (r: Recipe): string =>
  r.kind === 'item' ? getItem(r.result).name : getStructure(r.result).name;

export const recipeDescription = (r: Recipe): string =>
  r.kind === 'item' ? getItem(r.result).description : getStructure(r.result).description;

/** Prüft und verbraucht Materialien. Reine Logik → unabhängig von UI und Bausystem testbar. */
export class Crafting {
  constructor(private readonly inventory: Inventory) {}

  canAfford(cost: ItemCost[]): boolean {
    return cost.every((c) => this.inventory.has(c.item, c.count));
  }

  /** Entfernt alle Kosten – nur wenn alles vorhanden ist (sonst bleibt das Inventar unverändert). */
  consume(cost: ItemCost[]): boolean {
    if (!this.canAfford(cost)) return false;
    for (const c of cost) this.inventory.remove(c.item, c.count);
    return true;
  }

  /**
   * Stellt ein Item-Rezept her. Das Ergebnis wird erst nach dem Verbrauch hinzugefügt,
   * damit freigewordene Slots genutzt werden können.
   * @returns Anzahl, die nicht mehr ins Inventar passte (fällt dann in die Welt), oder null bei Fehlschlag.
   */
  craftItem(recipe: Extract<Recipe, { kind: 'item' }>): number | null {
    if (!this.consume(recipe.cost)) return null;
    return this.inventory.add(recipe.result, recipe.count);
  }
}
