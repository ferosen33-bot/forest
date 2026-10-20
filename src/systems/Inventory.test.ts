import { describe, expect, it } from 'vitest';
import { Inventory } from './Inventory';

describe('Inventory', () => {
  it('stapelt bis maxStack und meldet den Rest', () => {
    const inv = new Inventory(3, 1);
    expect(inv.add('log', 5)).toBe(0); // 4 + 1
    expect(inv.add('log', 10)).toBe(3); // Kapazität 3 × 4 = 12, davon 5 belegt
    expect(inv.count('log')).toBe(12);
  });

  it('legt Rohstoffe in den Rucksack und Werkzeuge in die Schnellzugriffsleiste', () => {
    const inv = new Inventory(10, 3);
    inv.add('stick', 1);
    inv.add('axe', 1);
    expect(inv.get(3)?.id).toBe('stick');
    expect(inv.get(0)?.id).toBe('axe');
  });

  it('entfernt nur, wenn genug vorhanden ist', () => {
    const inv = new Inventory(5, 1);
    inv.add('stone', 3);
    expect(inv.remove('stone', 4)).toBe(false);
    expect(inv.count('stone')).toBe(3);
    expect(inv.remove('stone', 3)).toBe(true);
    expect(inv.slots.every((s) => s === null)).toBe(true);
  });

  it('verschiebt: gleiche Items zusammenlegen, verschiedene tauschen', () => {
    const inv = new Inventory(4, 0);
    inv.slots[0] = { id: 'stick', count: 10 };
    inv.slots[1] = { id: 'stick', count: 10 };
    inv.slots[2] = { id: 'stone', count: 2 };
    inv.move(0, 1);
    expect(inv.get(1)).toEqual({ id: 'stick', count: 15 });
    expect(inv.get(0)).toEqual({ id: 'stick', count: 5 });
    inv.move(0, 2);
    expect(inv.get(0)?.id).toBe('stone');
    expect(inv.get(2)?.id).toBe('stick');
  });

  it('quickMove wechselt zwischen Schnellzugriff und Rucksack', () => {
    const inv = new Inventory(6, 2);
    inv.slots[0] = { id: 'berries', count: 5 };
    inv.slots[4] = { id: 'berries', count: 18 };
    inv.quickMove(0);
    expect(inv.get(4)?.count).toBe(20);
    expect(inv.get(2)?.count).toBe(3);
    expect(inv.get(0)).toBeNull();
  });

  it('benachrichtigt Listener bei Änderungen', () => {
    const inv = new Inventory(2, 1);
    let calls = 0;
    inv.onChange(() => calls++);
    inv.add('stone', 1);
    inv.add('log', 99); // passt teilweise
    inv.add('log', 99); // passt nicht mehr -> keine Änderung
    expect(calls).toBe(2);
  });
});
