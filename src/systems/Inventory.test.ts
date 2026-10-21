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

describe('Inventory – Haltbarkeit', () => {
  it('stapelt Werkzeuge nie und gibt jedem Exemplar volle Haltbarkeit', () => {
    const inv = new Inventory(6, 3);
    inv.add('torch', 2);
    expect(inv.get(0)).toEqual({ id: 'torch', count: 1, durability: 360 });
    expect(inv.get(1)).toEqual({ id: 'torch', count: 1, durability: 360 });
    inv.move(0, 1); // gleiche Items mit Haltbarkeit werden getauscht, nicht zusammengelegt
    expect(inv.get(0)?.count).toBe(1);
    expect(inv.get(1)?.count).toBe(1);
  });

  it('verschleißt und zerbricht', () => {
    const inv = new Inventory(3, 1);
    inv.add('spear', 1, 3);
    expect(inv.condition(0)).toBeCloseTo(3 / 60);
    expect(inv.wear(0, 2)).toBe(false);
    expect(inv.wear(0, 2)).toBe(true);
    expect(inv.get(0)).toBeNull();
  });

  it('serialisiert und lädt verlustfrei', () => {
    const inv = new Inventory(4, 2);
    inv.add('axe', 1, 100);
    inv.add('stone', 5);
    const copy = new Inventory(4, 2);
    copy.load(JSON.parse(JSON.stringify(inv.serialize())), () => true);
    expect(copy.slots).toEqual(inv.slots);
  });

  it('wandelt Behälter an Ort und Stelle um (Schale füllen/leeren)', () => {
    const inv = new Inventory(4, 2);
    inv.add('bowl', 2);
    const slot = inv.slots.findIndex((s) => s?.id === 'bowl');
    // Stapel aus zwei Schalen: eine wird gefüllt und landet woanders.
    expect(inv.transform(slot, 'bowlWater')).toBe(0);
    expect(inv.get(slot)).toEqual({ id: 'bowl', count: 1 });
    expect(inv.count('bowlWater')).toBe(1);
    // Einzelne Schale: Slot wird direkt ersetzt.
    expect(inv.transform(slot, 'bowlWater')).toBe(0);
    expect(inv.get(slot)).toEqual({ id: 'bowlWater', count: 1 });
  });

  it('verschiebt zwischen zwei Inventaren (Lagerkiste)', () => {
    const player = new Inventory(6, 2);
    const chest = new Inventory(4, 0);
    player.add('stick', 15);
    const from = player.slots.findIndex((s) => s?.id === 'stick');
    // Auf einen leeren Kistenplatz
    player.transferTo(from, chest, 2);
    expect(chest.get(2)).toEqual({ id: 'stick', count: 15 });
    expect(player.get(from)).toBeNull();
    // Automatisch: erst auffüllen, Rest bleibt
    player.add('stick', 20);
    const again = player.slots.findIndex((s) => s?.id === 'stick');
    const moved = player.get(again)!.count;
    player.transferTo(again, chest);
    expect(chest.count('stick')).toBe(15 + moved);
    expect(player.count('stick')).toBe(20 - moved);
    // Tausch bei verschiedenen Items
    player.add('axe', 1);
    const axe = player.slots.findIndex((s) => s?.id === 'axe');
    chest.transferTo(2, player, axe);
    expect(player.get(axe)?.id).toBe('stick');
    expect(chest.get(2)?.id).toBe('axe');
    expect(chest.takeAll().map((s) => s.id).sort()).toEqual(['axe', 'stick']);
    expect(chest.slots.every((s) => s === null)).toBe(true);
  });

  it('wächst mit dem großen Rucksack (neue Plätze im Rucksackbereich)', () => {
    const inv = new Inventory(8, 2);
    inv.add('stone', 12 * 8);
    expect(inv.add('stick', 5)).toBe(5); // voll
    inv.grow(4);
    expect(inv.size).toBe(12);
    expect(inv.add('stick', 5)).toBe(0);
    const copy = new Inventory(12, 2);
    copy.load(inv.serialize(), () => true);
    expect(copy.count('stick')).toBe(5);
  });
});
