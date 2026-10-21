import { describe, expect, it } from 'vitest';
import { PlayerStats } from './PlayerStats';
import { EventBus } from '../core/EventBus';
import { CONFIG } from '../config';

const idle = { sprinting: false, swimming: false };

describe('PlayerStats – Nässe und Kälte', () => {
  it('nass in der Nacht ohne Feuer: Unterkühlung', () => {
    const s = new PlayerStats(CONFIG, new EventBus());
    s.wetness = 1;
    s.night = true;
    expect(s.freezing).toBe(true);
    const h = s.health;
    for (let i = 0; i < 600; i++) s.update(0.1, idle);
    expect(s.health).toBeLessThan(h - 5);
  });

  it('am Feuer friert man nicht, tagsüber nur leicht', () => {
    const s = new PlayerStats(CONFIG, new EventBus());
    s.wetness = 1;
    s.night = true;
    s.warm = true;
    expect(s.cold).toBe(0);
    expect(s.freezing).toBe(false);
    s.warm = false;
    s.night = false;
    expect(s.freezing).toBe(false);
    expect(s.cold).toBeCloseTo(0.6);
  });

  it('nass regeneriert Ausdauer langsamer', () => {
    const dry = new PlayerStats(CONFIG, new EventBus());
    const wet = new PlayerStats(CONFIG, new EventBus());
    wet.wetness = 1;
    wet.night = true;
    dry.stamina = wet.stamina = 0;
    for (let i = 0; i < 20; i++) {
      dry.update(0.1, idle);
      wet.update(0.1, idle);
    }
    expect(wet.stamina).toBeLessThan(dry.stamina * 0.7);
  });
});
