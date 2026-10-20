import { describe, expect, it } from 'vitest';
import { Crafting, RECIPES, type Recipe } from './Crafting';
import { Inventory } from './Inventory';

const recipe = (id: string) => RECIPES.find((r) => r.id === id) as Extract<Recipe, { kind: 'item' }>;

describe('Crafting', () => {
  it('stellt ein Item her und verbraucht genau die Kosten', () => {
    const inv = new Inventory();
    inv.add('stick', 3);
    inv.add('stone', 3);
    const crafting = new Crafting(inv);
    expect(crafting.craftItem(recipe('stoneAxe'))).toBe(0);
    expect(inv.count('stoneAxe')).toBe(1);
    expect(inv.count('stick')).toBe(2);
    expect(inv.count('stone')).toBe(1);
  });

  it('verändert nichts, wenn Material fehlt', () => {
    const inv = new Inventory();
    inv.add('stick', 1);
    const crafting = new Crafting(inv);
    expect(crafting.craftItem(recipe('spear'))).toBeNull();
    expect(inv.count('stick')).toBe(1);
    expect(inv.count('spear')).toBe(0);
  });

  it('nutzt Slots, die durch den Verbrauch frei werden', () => {
    const inv = new Inventory(1, 0); // genau ein Slot
    inv.add('stick', 2);
    expect(new Crafting(inv).craftItem(recipe('torch'))).toBe(0);
    expect(inv.get(0)).toEqual({ id: 'torch', count: 1 });
  });

  it('jedes Rezept hat Kosten', () => {
    for (const r of RECIPES) expect(r.cost.length).toBeGreaterThan(0);
  });
});
