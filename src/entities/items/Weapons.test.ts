import { describe, expect, it } from 'vitest';
import { Inventory } from '../../systems/Inventory';
import { getItem, isItemId } from './ItemDefs';
import { gunStats, isWeapon, loadedRounds, maxDurability, rollWeapon, sanitizeWeapon, weaponOf, weaponStats, RARITIES, type WeaponMeta } from './Weapons';
import { mulberry32 } from '../../utils/random';

describe('Waffen mit Seltenheit', () => {
  it('Nahkampfwaffen haben Seltenheit, Werkzeuge ohne Kampfwert nicht', () => {
    for (const id of ['machete', 'baseballBat', 'sledgehammer', 'sabre', 'fireAxe', 'axe'] as const) expect(isWeapon(id)).toBe(true);
    for (const id of ['torch', 'flashlight', 'fishingRod', 'bow', 'stone'] as const) expect(isWeapon(id)).toBe(false);
  });

  it('seltenere Stufen sind stärker, haltbarer und haben mehr Perks', () => {
    const common = weaponStats('sabre', weaponOf('common'));
    const legendary = weaponStats('sabre', { rarity: 'legendary', perks: [] });
    expect(legendary.tool.damage).toBeGreaterThan(common.tool.damage * 1.5);
    expect(legendary.maxDurability!).toBeGreaterThan(common.maxDurability!);
    expect(weaponOf('superior').perks.length).toBe(2);
    expect(new Set(weaponOf('legendary').perks).size).toBe(3);
    // Perks wirken
    const brutal = weaponStats('sabre', { rarity: 'common', perks: ['brutal', 'sturdy', 'precise'] });
    expect(brutal.tool.damage).toBeCloseTo(common.tool.damage * 1.15);
    expect(brutal.maxDurability).toBe(Math.round(getItem('sabre').durability! * 1.4));
    expect(brutal.crit).toBeGreaterThan(common.crit);
  });

  it('gewöhnlich ist häufig, legendär selten; Glück verschiebt zu besseren Stufen', () => {
    const count = (luck: number) => {
      const rng = mulberry32(7);
      const n: Record<string, number> = {};
      for (let i = 0; i < 4000; i++) {
        const r = rollWeapon(rng, luck).rarity;
        n[r] = (n[r] ?? 0) + 1;
      }
      return n;
    };
    const normal = count(0);
    const lucky = count(1.2);
    expect(normal.common).toBeGreaterThan(normal.legendary * 10);
    expect(lucky.legendary).toBeGreaterThan(normal.legendary * 2);
    expect(Object.keys(normal).length).toBe(RARITIES.length);
  });

  it('Eigenschaften bleiben im Inventar, beim Umlagern und im Spielstand erhalten', () => {
    const inv = new Inventory(10, 3);
    const w: WeaponMeta = { rarity: 'rare', perks: ['swift'] };
    inv.add('crowbar', 1, undefined, w);
    const slot = inv.slots.findIndex((s) => s?.id === 'crowbar');
    expect(inv.get(slot)?.weapon?.rarity).toBe('rare');
    expect(inv.get(slot)?.durability).toBe(maxDurability('crowbar', w));
    // Kopie, keine geteilte Referenz
    w.perks.push('brutal');
    expect(inv.get(slot)?.weapon?.perks).toEqual(['swift']);
    const chest = new Inventory(4, 0);
    inv.transferTo(slot, chest);
    expect(chest.get(0)?.weapon?.rarity).toBe('rare');
    const save = JSON.parse(JSON.stringify(chest.serialize()));
    const loaded = new Inventory(4, 0);
    loaded.load(save, isItemId);
    expect(loaded.get(0)?.weapon).toEqual({ rarity: 'rare', perks: ['swift'] });
    // Alte Spielstände: Waffe ohne Eigenschaften bekommt eine Seltenheit; Unsinn wird verworfen.
    loaded.load([{ id: 'machete', count: 1, durability: 50 }], isItemId);
    expect(loaded.get(0)?.weapon?.rarity).toBeDefined();
    expect(sanitizeWeapon({ rarity: 'mythisch', perks: [] })).toBeUndefined();
    expect(sanitizeWeapon({ rarity: 'rare', perks: ['brutal', 'quatsch'] })).toEqual({ rarity: 'rare', perks: ['brutal'] });
  });
});

describe('Schusswaffen', () => {
  it('haben Seltenheit, ein volles Magazin und Werte nach Perks', () => {
    expect(isWeapon('pistol')).toBe(true);
    expect(isWeapon('pistolAmmo')).toBe(false);
    expect(loadedRounds('shotgun')).toBe(getItem('shotgun').gun!.magazine);
    expect(loadedRounds('shotgun', { rarity: 'common', perks: [], loaded: 2 })).toBe(2);
    const plain = gunStats('revolver', { rarity: 'common', perks: [] });
    const tuned = gunStats('revolver', { rarity: 'rare', perks: ['brutal', 'balanced', 'swift'] });
    expect(tuned.gun.damage).toBeGreaterThan(plain.gun.damage);
    expect(tuned.gun.recoil).toBeLessThan(plain.gun.recoil);
    expect(tuned.gun.fireTime).toBeLessThan(plain.gun.fireTime);
    expect(sanitizeWeapon({ rarity: 'rare', perks: [], loaded: 3 })?.loaded).toBe(3);
    expect(sanitizeWeapon({ rarity: 'rare', perks: [], loaded: 'x' })?.loaded).toBeUndefined();
  });
});
