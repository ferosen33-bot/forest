import { describe, expect, it } from 'vitest';
import { SEASON_DAYS, seasonAt } from './Seasons';

describe('Jahreszeiten', () => {
  it('beginnt im Sommer und folgt Herbst → Winter → Frühling', () => {
    expect(seasonAt(1, 8).season).toBe('summer');
    expect(seasonAt(1 + SEASON_DAYS, 8).season).toBe('autumn');
    expect(seasonAt(1 + 2 * SEASON_DAYS, 8).season).toBe('winter');
    expect(seasonAt(1 + 3 * SEASON_DAYS, 8).season).toBe('spring');
    expect(seasonAt(1 + 4 * SEASON_DAYS, 8).season).toBe('summer');
  });

  it('Winter bringt Schnee, Schneefall und kalte Nächte', () => {
    const w = seasonAt(1 + 2 * SEASON_DAYS + 1, 12);
    expect(w.snow).toBeGreaterThan(0.8);
    expect(w.snowfall).toBe(1);
    expect(w.chill).toBeGreaterThan(0.7);
    expect(seasonAt(2, 12).snow).toBe(0);
  });

  it('blendet am letzten Tag weich über', () => {
    const lastAutumnDay = SEASON_DAYS * 2; // Tag 8 = letzter Herbsttag
    const morning = seasonAt(lastAutumnDay, 2);
    const evening = seasonAt(lastAutumnDay, 22);
    expect(morning.snow).toBeLessThan(evening.snow);
    expect(evening.snow).toBeGreaterThan(0.5);
    expect(evening.season).toBe('autumn');
  });
});
