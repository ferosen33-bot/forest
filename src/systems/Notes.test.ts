import { describe, expect, it } from 'vitest';
import { CAVE_NOTES, NOTES, TOWN_NOTES, getNote } from './Notes';
import { CHAPTERS, Journal } from './Journal';
import { EventBus } from '../core/EventBus';

describe('Notes', () => {
  it('jede Notiz hat einen Fundort und jeder Fundort eine Notiz', () => {
    const placed = [...TOWN_NOTES.hall, ...TOWN_NOTES.gas, ...TOWN_NOTES.shop, ...TOWN_NOTES.houses, ...CAVE_NOTES];
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.sort()).toEqual(NOTES.map((n) => n.id).sort());
    for (const id of placed) expect(getNote(id)?.text.length).toBeGreaterThan(80);
  });

  it('Tagebuch sammelt gelesene Notizen (nur beim ersten Lesen) und speichert sie', () => {
    const events = new EventBus();
    const j = new Journal(events);
    events.emit('note:read', { id: 'funk1', first: true });
    events.emit('note:read', { id: 'funk1', first: false });
    events.emit('note:read', { id: 'arzt', first: true });
    const all = CHAPTERS.flatMap((c) => c.objectives).find((o) => o.id === 'allNotes')!;
    const radio = CHAPTERS.flatMap((c) => c.objectives).find((o) => o.id === 'radio1')!;
    expect(j.count(all)).toBe(2);
    expect(j.isDone(radio)).toBe(true);
    const j2 = new Journal(new EventBus());
    j2.load(j.serialize());
    expect([...j2.notes]).toEqual(['funk1', 'arzt']);
  });
});
