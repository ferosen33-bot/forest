import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/EventBus';
import { BOAT_QUEST, QUESTS, Quests } from './Quests';

const stock = (items: Record<string, number>) => ({ count: (id: string) => items[id] ?? 0 });

describe('Quests', () => {
  it('Abgabe-Auftrag: annehmen, sammeln, abgeben – Folgeaufträge werden frei', () => {
    const q = new Quests(new EventBus());
    expect(q.state('supplies')).toBe('available');
    expect(q.state('plaza')).toBe('locked');
    expect(q.accept('supplies')).toBe(true);
    expect(q.state('supplies', stock({ cannedFood: 2 }))).toBe('active');
    expect(q.progress('supplies', stock({ cannedFood: 9, waterBottle: 1 }))).toEqual({ have: 5, need: 6 });
    const full = stock({ cannedFood: 4, waterBottle: 2 });
    expect(q.state('supplies', full)).toBe('ready');
    expect(q.complete('supplies', full)?.items).toEqual([['arrow', 15], ['battery', 2]]);
    expect(q.state('supplies')).toBe('completed');
    expect(q.state('plaza')).toBe('available');
  });

  it('Ereignis-Aufträge zählen erst ab Annahme und bleiben im Spielstand', () => {
    const events = new EventBus();
    const q = new Quests(events);
    q.load({ active: [], completed: ['watch'] });
    const kill = (name: string) => events.emit('enemy:hit', { health: 0, maxHealth: 100, killed: true, headshot: false, sneak: false, name });
    kill('Koloss');
    q.accept('papa');
    kill('Schrat');
    expect(q.state('papa')).toBe('active');
    kill('Koloss');
    expect(q.state('papa')).toBe('ready');
    const copy = new Quests(new EventBus());
    copy.load(q.serialize());
    expect(copy.state('papa')).toBe('ready');
  });

  it('jeder Folgeauftrag verweist auf existierende Aufträge desselben Auftraggebers (außer dem Finale)', () => {
    for (const quest of QUESTS) {
      for (const r of quest.requires ?? []) {
        const req = QUESTS.find((x) => x.id === r);
        expect(req).toBeDefined();
        if (quest !== BOAT_QUEST) expect(req!.giver).toBe(quest.giver);
      }
    }
  });

  it('Notiz-Auftrag ist erfüllt, auch wenn die Notiz vor der Annahme gelesen wurde', () => {
    const events = new EventBus();
    const q = new Quests(events);
    events.emit('note:read', { id: 'schichtbuch', first: true });
    for (const id of ['samples', 'shiftbook']) {
      q.accept(id);
      q.complete(id, { count: () => 99 });
    }
    events.emit('note:read', { id: 'labor1', first: true });
    expect(q.accept('lab')).toBe(true);
    expect(q.state('lab')).toBe('ready');
  });
});
