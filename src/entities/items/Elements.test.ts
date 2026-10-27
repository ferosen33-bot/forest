import { describe, expect, it } from 'vitest';
import {
  ACID_VULNERABILITY,
  BLEED_DPS,
  BURN_DPS,
  createStatus,
  decayStatus,
  dotDamage,
  hasStatus,
  procChance,
  rollProc,
  statusSlow,
  vulnerability,
} from './Elements';
import { ENEMY_KINDS, elementFactor } from '../enemies/EnemyKinds';
import { canMod, sanitizeWeapon } from './Weapons';
import { getItem, isItemId } from './ItemDefs';
import { Inventory } from '../../systems/Inventory';
import { RECIPES, needsWorkbench, recipeGroup } from '../../systems/Crafting';

describe('Elemente der Waffenmods', () => {
  it('greifen spätestens nach etwas Pech, kritische Treffer immer', () => {
    const s = createStatus();
    const never = () => 0.99;
    const chance = procChance('fire', 'blunt');
    let hits = 0;
    for (let i = 0; i < 4; i++) if (rollProc(s, chance, false, never)) hits++;
    // 0,38 + 0,38 + 0,38 ≥ 1 → beim vierten Versuch sicher.
    expect(hits).toBe(1);
    expect(rollProc(createStatus(), chance, true, never)).toBe(true);
    expect(procChance('fire', 'heavy')).toBeGreaterThan(chance);
    expect(procChance('bleed', 'blade')).toBeGreaterThan(procChance('bleed', 'blunt'));
  });

  it('Brand, Säure und Blutung verletzen über Zeit und laufen ab', () => {
    const s = createStatus();
    expect(hasStatus(s)).toBe(false);
    s.burn = 1;
    s.acid = 2;
    s.bleed = 2;
    s.bleedStacks = 3;
    const dot = dotDamage(s, 0.5);
    expect(dot.fire).toBeCloseTo(BURN_DPS * 0.5);
    expect(dot.bleed).toBeCloseTo(BLEED_DPS * 3 * 0.5);
    expect(vulnerability(s)).toBe(ACID_VULNERABILITY);
    expect(statusSlow(s)).toBeGreaterThan(0.2);
    decayStatus(s, 2.5, false);
    expect(hasStatus(s)).toBe(false);
    expect(s.bleedStacks).toBe(0);
    expect(vulnerability(s)).toBe(1);
  });

  it('Wasser löscht sofort, Nässe schneller', () => {
    const wet = createStatus();
    wet.burn = 4;
    wet.wet = 10;
    decayStatus(wet, 1, false);
    expect(wet.burn).toBeCloseTo(2);
    const drowned = createStatus();
    drowned.burn = 4;
    decayStatus(drowned, 0.01, true);
    expect(drowned.burn).toBe(0);
  });

  it('Gegnertypen sind anfällig oder widerstehen', () => {
    expect(elementFactor(ENEMY_KINDS.hansen, 'fire')).toBeGreaterThan(1);
    expect(elementFactor(ENEMY_KINDS.hansen, 'caustic')).toBeLessThan(1);
    expect(elementFactor(ENEMY_KINDS.koloss, 'shock')).toBeGreaterThan(1);
    expect(elementFactor(ENEMY_KINDS.schrat, 'bleed')).toBe(1);
  });

  it('Mods passen erst ab „Ungewöhnlich“ und bleiben im Spielstand', () => {
    expect(canMod({ rarity: 'common', perks: [] })).toBe(false);
    expect(canMod({ rarity: 'uncommon', perks: [] })).toBe(true);
    expect(sanitizeWeapon({ rarity: 'rare', perks: [], mod: 'shock' })?.mod).toBe('shock');
    expect(sanitizeWeapon({ rarity: 'rare', perks: [], mod: 'laser' })?.mod).toBeUndefined();

    const inv = new Inventory(6, 2);
    inv.add('crowbar', 1, undefined, { rarity: 'rare', perks: [] });
    const slot = inv.slots.findIndex((s) => s?.id === 'crowbar');
    expect(inv.setMod(slot, 'fire')).toBe(true);
    const loaded = new Inventory(6, 2);
    loaded.load(JSON.parse(JSON.stringify(inv.serialize())), isItemId);
    expect(loaded.get(slot)?.weapon?.mod).toBe('fire');
  });

  it('Mods entstehen nur an der Werkbank und haben einen eigenen Abschnitt', () => {
    const mods = RECIPES.filter((r) => r.kind === 'item' && getItem(r.result).mod);
    expect(mods.map((r) => r.id).sort()).toEqual(['modBleed', 'modCaustic', 'modFire', 'modShock']);
    for (const r of mods) {
      expect(needsWorkbench(r)).toBe(true);
      expect(recipeGroup(r)).toBe('Waffenmods');
    }
    expect(needsWorkbench(RECIPES.find((r) => r.id === 'torch')!)).toBe(false);
  });
});
