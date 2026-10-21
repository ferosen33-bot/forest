import { describe, expect, it } from 'vitest';
import { SaveStore, SAVE_VERSION, isValidSave, worldKey, type KeyValueStorage, type SaveData } from './SaveGame';

class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const WORLD = worldKey(1337, 1536, 2);

function sample(): SaveData {
  return {
    version: SAVE_VERSION,
    world: WORLD,
    savedAt: '2026-10-21T12:00:00.000Z',
    player: { p: [1, 2, 3], yaw: 0.5, pitch: -0.1, health: 80, stamina: 50, hunger: 60, thirst: 70, respawn: [0, 5, 0], selected: 2 },
    time: { day: 3, hour: 14.5 },
    inventory: [{ id: 'axe', count: 1, durability: 100 }, null],
    vegetation: { removed: [4, 8], regrow: [[12, 30]] },
    harvest: { felled: [4], treeHealth: [[9, 20]], rockStones: [[15, 2]] },
    structures: [{ id: 'campfire', p: [5, 1, 5], rotation: 0, health: 60, lit: true }],
    cooking: [{ structure: 0, pieces: [0.5, 1] }],
    items: [{ id: 'log', count: 1, p: [3, 2, 1], q: [0, 0, 0, 1] }],
    enemies: [{ camp: 0, p: [100, 10, 100], health: 50, tone: 1, scale: 1 }],
    animals: [{ species: 'deer', p: [50, 8, 50], home: [50, 8, 50], health: 0, scale: 1, tint: 2, deadFor: 12 }],
  };
}

describe('Spielstände', () => {
  it('speichert und lädt verlustfrei', () => {
    const store = new SaveStore(WORLD, new MemoryStorage());
    expect(store.load()).toBeNull();
    expect(store.save(sample())).toBe(true);
    expect(store.load()).toEqual(sample());
    expect(store.summary()).toEqual({ day: 3, hour: 14.5, savedAt: new Date('2026-10-21T12:00:00.000Z') });
    store.clear();
    expect(store.load()).toBeNull();
  });

  it('verwirft Stände einer anderen Welt oder Version', () => {
    expect(isValidSave(sample(), WORLD)).toBe(true);
    expect(isValidSave(sample(), worldKey(42, 1536, 2))).toBe(false);
    expect(isValidSave({ ...sample(), version: SAVE_VERSION + 1 }, WORLD)).toBe(false);
  });

  it('übersteht kaputte Daten und volle Speicher', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(WORLD, storage);
    storage.setItem('wildwood.save', '{kaputt');
    expect(store.load()).toBeNull();
    storage.setItem('wildwood.save', JSON.stringify({ ...sample(), player: { ...sample().player, p: [1, 'x', 3] } }));
    expect(store.load()).toBeNull();
    storage.failWrites = true;
    expect(store.save(sample())).toBe(false);
    expect(new SaveStore(WORLD, null).save(sample())).toBe(false);
  });
});
