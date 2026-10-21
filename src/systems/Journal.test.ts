import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/EventBus';
import { CHAPTERS, Journal } from './Journal';

describe('Tagebuch', () => {
  it('zählt Ereignisse und meldet erreichte Ziele', () => {
    const events = new EventBus();
    new Journal(events);
    const done: string[] = [];
    events.on('journal:completed', ({ id }) => done.push(id));
    events.emit('item:collected', { item: 'stick', count: 4 });
    expect(done).toEqual([]);
    events.emit('item:collected', { item: 'stick', count: 3 });
    expect(done).toEqual(['sticks']);
    // Weitere Stöcke zählen nicht doppelt
    events.emit('item:collected', { item: 'stick', count: 5 });
    expect(done).toEqual(['sticks']);
  });

  it('wechselt das Kapitel, wenn alle Ziele erfüllt sind', () => {
    const events = new EventBus();
    const j = new Journal(events);
    let chapterDone = false;
    events.on('journal:completed', (e) => (chapterDone ||= e.chapterDone));
    expect(j.currentChapter).toBe(0);
    events.emit('item:collected', { item: 'stick', count: 6 });
    events.emit('item:collected', { item: 'stone', count: 4 });
    events.emit('player:drank', { amount: 25 });
    events.emit('player:ate', { item: 'berries' });
    expect(chapterDone).toBe(false);
    events.emit('structure:placed', { id: 'campfire', position: null as never, rotation: 0 });
    expect(chapterDone).toBe(true);
    expect(j.currentChapter).toBe(1);
    expect(j.openObjectives(2).map((o) => o.id)).toEqual(['fell', 'stoneAxe']);
  });

  it('unterscheidet Gegnertypen, lautlose Kills und Tage', () => {
    const events = new EventBus();
    const j = new Journal(events);
    const koloss = CHAPTERS[3].objectives.find((o) => o.id === 'koloss')!;
    const sneak = CHAPTERS[3].objectives.find((o) => o.id === 'sneak')!;
    const hit = { health: 0, maxHealth: 80, killed: true, headshot: false };
    events.emit('enemy:hit', { ...hit, sneak: false, name: 'Schrat' });
    expect(j.isDone(koloss)).toBe(false);
    events.emit('enemy:hit', { ...hit, sneak: true, name: 'Koloss' });
    expect(j.isDone(koloss)).toBe(true);
    expect(j.isDone(sneak)).toBe(true);
    j.setDay(10);
    expect(j.isDone(CHAPTERS[3].objectives.find((o) => o.id === 'day10')!)).toBe(true);
  });

  it('speichert und lädt den Fortschritt', () => {
    const events = new EventBus();
    const a = new Journal(events);
    events.emit('tree:felled', { kind: 'pine', position: null as never });
    events.emit('tree:felled', { kind: 'pine', position: null as never });
    const b = new Journal(new EventBus());
    b.load(JSON.parse(JSON.stringify(a.serialize())));
    const fell = CHAPTERS[1].objectives.find((o) => o.id === 'fell')!;
    expect(b.count(fell)).toBe(2);
    b.load({ progress: [['unbekannt', 3]] });
    expect(b.count(fell)).toBe(0);
  });
});
