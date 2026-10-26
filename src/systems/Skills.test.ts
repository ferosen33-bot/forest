import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/EventBus';
import { MAX_SKILL_LEVEL, Skills, wireSkillEvents, xpForNext, xpToReach } from './Skills';

describe('Skills', () => {
  it('steigt mit Erfahrung bis zur Meisterstufe und meldet jeden Aufstieg', () => {
    const events = new EventBus();
    const ups: number[] = [];
    events.on('skill:levelUp', ({ id, level }) => id === 'woodcutting' && ups.push(level));
    const s = new Skills(events);
    expect(s.level('woodcutting')).toBe(0);
    s.gain('woodcutting', xpForNext(0) - 0.1);
    expect(s.level('woodcutting')).toBe(0);
    expect(s.progress('woodcutting')).toBeGreaterThan(0.99);
    s.gain('woodcutting', 0.2);
    expect(s.level('woodcutting')).toBe(1);
    s.gain('woodcutting', 1e6);
    expect(s.level('woodcutting')).toBe(MAX_SKILL_LEVEL);
    expect(s.progress('woodcutting')).toBe(1);
    // Ein großer Sprung meldet nur die erreichte Stufe.
    expect(ups).toEqual([1, 10]);
    expect(s.treeDamage).toBeCloseTo(1.6, 5);
  });

  it('Wirkungen ändern sich nur mit der passenden Fertigkeit', () => {
    const s = new Skills();
    s.gain('stealth', xpToReach(4));
    expect(s.level('stealth')).toBe(4);
    expect(s.noise).toBeCloseTo(0.8, 5);
    expect(s.meleeDamage).toBe(1);
    expect(s.needs).toBe(1);
  });

  it('Spielereignisse bringen Erfahrung, Spielstand bleibt erhalten', () => {
    const events = new EventBus();
    const s = new Skills(events);
    wireSkillEvents(s, events);
    events.emit('tool:hit', { target: 'tree' });
    events.emit('tree:felled', { kind: 'pine', position: { x: 0, y: 0, z: 0 } as never });
    events.emit('food:cooked', { count: 2 });
    events.emit('item:crafted', { item: 'spear', count: 1 });
    expect(s.experience('woodcutting')).toBe(7);
    expect(s.experience('survival')).toBe(4);
    expect(s.experience('crafting')).toBe(4);
    const t = new Skills();
    t.load(s.serialize());
    expect(t.experience('woodcutting')).toBe(7);
  });
});

describe('Talente', () => {
  it('je Fertigkeit und Stufe genau ein Talent, erst ab Stufe 3 bzw. 7', async () => {
    const { PERKS, xpToReach } = await import('./Skills');
    const s = new Skills();
    expect(PERKS.length).toBe(32);
    expect(s.canChoose('heavySwing')).toBe(false);
    s.gain('woodcutting', xpToReach(3));
    expect(s.openChoices).toBe(1);
    expect(s.choose('lumberjack')).toBe(false); // erst ab Stufe 7
    expect(s.choose('heavySwing')).toBe(true);
    expect(s.choose('tireless')).toBe(false); // die andere Wahl derselben Stufe ist vergeben
    expect(s.openChoices).toBe(0);
    expect(s.treeDamage).toBeCloseTo((1 + 0.06 * 3) * 1.2);
    s.gain('woodcutting', xpToReach(7));
    expect(s.choose('quietAxe')).toBe(true);
    const copy = new Skills();
    copy.load(s.serialize());
    copy.loadPerks(JSON.parse(JSON.stringify(s.serializePerks())));
    expect(copy.has('heavySwing') && copy.has('quietAxe')).toBe(true);
    // Unsinn im Spielstand und doppelte Wahl derselben Stufe werden verworfen.
    copy.loadPerks(['heavySwing', 'tireless', 'gibtsnicht']);
    expect(copy.serializePerks()).toEqual(['heavySwing']);
  });
});
