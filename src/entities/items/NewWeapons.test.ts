import { describe, expect, it } from 'vitest';
import { cutsLimbs, getItem } from './ItemDefs';
import { isWeapon } from './Weapons';
import { RECIPES, needsWorkbench, recipeGroup } from '../../systems/Crafting';

describe('Neue Waffen', () => {
  it('Nahkampfwaffen haben Seltenheit; Klingen im Hieb trennen ab, Stöße nicht', () => {
    for (const id of ['katana', 'cleaver', 'golfClub', 'baton', 'pitchfork', 'nailBat', 'shockBar'] as const) expect(isWeapon(id)).toBe(true);
    expect(cutsLimbs(getItem('katana').tool!)).toBe(true);
    expect(cutsLimbs(getItem('cleaver').tool!)).toBe(true);
    expect(cutsLimbs(getItem('pitchfork').tool!)).toBe(false);
    expect(cutsLimbs(getItem('golfClub').tool!)).toBe(false);
    expect(cutsLimbs(getItem('fireAxe').tool!)).toBe(true);
  });

  it('Eigenbauten tragen ihr Element eingebaut und entstehen an der Werkbank', () => {
    expect(getItem('nailBat').builtIn).toBe('bleed');
    expect(getItem('shockBar').builtIn).toBe('shock');
    for (const id of ['nailBat', 'shockBar', 'pipeBomb']) {
      const r = RECIPES.find((x) => x.id === id)!;
      expect(needsWorkbench(r)).toBe(true);
      expect(recipeGroup(r)).toBe('Waffenbau');
    }
    expect(getItem('pipeBomb').throwable).toBeDefined();
  });
});
