import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BARREL_MAX, Camp, DRY_TIME, GROW_TIME, STEW_TIME } from './Camp';
import { Inventory } from './Inventory';
import { Crafting, RECIPES } from './Crafting';
import { getStructure, type StructureId } from './building/StructureDefs';
import type { Structure } from './building/BuildingSystem';
import type { ItemId } from '../entities/items/ItemDefs';

function setup(ids: StructureId[]) {
  const inventory = new Inventory(20, 0);
  const structures = ids.map(
    (id, i) => ({ id: i, def: getStructure(id), object: new THREE.Group(), position: new THREE.Vector3(i * 5, 0, 0), rotation: 0, lit: !!getStructure(id).flame }) as unknown as Structure,
  );
  const state = { held: null as ItemId | null, drunk: 0, covered: false, messages: [] as string[] };
  const camp = new Camp({
    building: { structures, toggleFire: (s: Structure) => (s.lit = !s.lit) } as never,
    items: { give: (id: ItemId, n: number) => inventory.add(id, n), drop: () => {} } as never,
    inventory,
    audio: { play: () => {} } as never,
    events: { emit: (_: string, e: { text?: string }) => e.text && state.messages.push(e.text) } as never,
    particles: { burst: () => {} } as never,
    heldItem: () => state.held,
    takeHeld: () => void (state.held = null),
    transformHeld: (to) => void (state.held = to),
    drink: (n) => void (state.drunk += n),
    drinkAmount: 25,
    repairHeld: () => false,
    repairPrompt: () => null,
    roofAbove: () => state.covered,
  });
  const run = (seconds: number, rain = 0, winter = false) => {
    for (let t = 0; t < seconds; t += 0.5) camp.update(0.5, { rain, winter });
  };
  return { camp, structures, inventory, state, run };
}

describe('Lager ausbauen', () => {
  it('Trockengestell: Fleisch wird zu Trockenfleisch, im Regen nur unter Dach', () => {
    const { camp, structures, inventory, state, run } = setup(['dryingRack']);
    const rack = structures[0];
    state.held = 'rawMeat';
    expect(camp.prompt(rack)?.action).toBe('Fleisch aufhängen');
    camp.interact(rack);
    expect(state.held).toBeNull();
    run(DRY_TIME, 1);
    expect(camp.prompt(rack)?.key).toBeNull(); // Regen ohne Dach: nichts getrocknet
    run(DRY_TIME + 1);
    camp.interact(rack);
    expect(inventory.count('jerky')).toBe(1);
  });

  it('Regentonne füllt sich bei Regen; Trinken und Schale füllen', () => {
    const { camp, structures, state, run } = setup(['rainBarrel']);
    const barrel = structures[0];
    expect(camp.prompt(barrel)?.key).toBeNull();
    run(200, 1);
    expect(camp.prompt(barrel)?.label).toContain(`${BARREL_MAX}/${BARREL_MAX}`);
    camp.interact(barrel);
    expect(state.drunk).toBe(25);
    state.held = 'bowl';
    camp.interact(barrel);
    expect(state.held).toBe('bowlWater');
  });

  it('Gartenbeet: wächst, ruht im Winter und trägt immer wieder', () => {
    const { camp, structures, inventory, state, run } = setup(['gardenBed']);
    const bed = structures[0];
    state.held = 'berries';
    camp.interact(bed);
    run(GROW_TIME, 0, true);
    expect(camp.prompt(bed)?.action).toContain('(0 %)');
    run(GROW_TIME + 1);
    camp.interact(bed);
    expect(inventory.count('berries')).toBe(5);
    expect(camp.prompt(bed)?.key).toBeNull(); // wächst nach, ohne neu zu pflanzen
    run(GROW_TIME);
    expect(camp.prompt(bed)?.action).toBe('Beeren ernten');
  });

  it('Kochtopf: Wasser und Zutaten ergeben Eintopf, geschöpft mit Schalen', () => {
    const { camp, structures, inventory, state, run } = setup(['cookingPot']);
    const pot = structures[0];
    state.held = 'bowlWater';
    camp.interact(pot);
    expect(state.held).toBe('bowl');
    for (const food of ['rawMeat', 'mushroom'] as ItemId[]) {
      state.held = food;
      camp.interact(pot);
    }
    run(STEW_TIME + 1);
    expect(camp.prompt(pot)?.key).toBeNull(); // fertig, aber keine Schale im Rucksack
    inventory.add('bowl', 3);
    camp.interact(pot);
    expect(inventory.count('stew')).toBe(2);
    expect(inventory.count('bowl')).toBe(1);
  });

  it('Lager-Baupläne brauchen eine Werkbank in der Nähe', () => {
    const inv = new Inventory();
    inv.add('log', 4);
    inv.add('stick', 4);
    const crafting = new Crafting(inv);
    const garden = RECIPES.find((r) => r.id === 'gardenBed')!;
    const bench = RECIPES.find((r) => r.id === 'workbench')!;
    inv.add('stone', 2);
    expect(crafting.canMake(bench)).toBe(true);
    expect(crafting.canMake(garden)).toBe(false);
    crafting.nearWorkbench = () => true;
    expect(crafting.canMake(garden)).toBe(true);
  });

  it('Zustand übersteht Speichern und Laden', () => {
    const a = setup(['rainBarrel', 'gardenBed']);
    a.run(60, 1);
    a.state.held = 'mushroom';
    a.camp.interact(a.structures[1]);
    a.run(30);
    const save = JSON.parse(JSON.stringify(a.camp.serialize()));
    const b = setup(['rainBarrel', 'gardenBed']);
    b.camp.load(save, b.structures);
    expect(b.camp.prompt(b.structures[0])?.label).toBe(a.camp.prompt(a.structures[0])?.label);
    expect(b.camp.prompt(b.structures[1])?.action).toBe(a.camp.prompt(a.structures[1])?.action);
  });
});
