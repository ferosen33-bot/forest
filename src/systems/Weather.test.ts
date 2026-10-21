import { describe, expect, it } from 'vitest';
import { Weather, type Lightning } from './Weather';
import { mulberry32 } from '../utils/random';

const run = (w: Weather, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds * 10; i++) {
    w.update(0.1);
    each?.();
  }
};

describe('Wetter', () => {
  it('beginnt ruhig und durchläuft dann alle Wetterlagen', () => {
    const w = new Weather(mulberry32(5));
    run(w, 300);
    expect(w.rain).toBe(0);
    const seen = new Set<string>();
    run(w, 3 * 3600, () => seen.add(w.phase));
    expect([...seen].sort()).toEqual(['clear', 'clearing', 'cloudy', 'rain', 'storm']);
  });

  it('Regen gleitet weich ein und setzt erst bei dichter Bewölkung ein', () => {
    const w = new Weather(mulberry32(1));
    w.setPhase('rain');
    w.update(0.1);
    expect(w.rain).toBe(0); // Wolken müssen erst aufziehen
    let maxStep = 0;
    let last = w.rain;
    run(w, 60, () => {
      maxStep = Math.max(maxStep, Math.abs(w.rain - last));
      last = w.rain;
    });
    expect(w.clouds).toBeGreaterThan(0.75);
    expect(w.rain).toBeGreaterThan(0.3);
    expect(maxStep).toBeLessThan(0.01);
  });

  it('Donner folgt dem Blitz mit Schallgeschwindigkeit', () => {
    const w = new Weather(mulberry32(3));
    w.setPhase('storm');
    w.clouds = 1;
    w.rain = 1;
    const flashes: { l: Lightning; t: number }[] = [];
    const thunders: { l: Lightning; t: number }[] = [];
    let t = 0;
    w.onLightning = (l) => flashes.push({ l, t });
    w.onThunder = (l) => thunders.push({ l, t });
    for (let i = 0; i < 600; i++) {
      t += 0.1;
      w.update(0.1);
    }
    expect(flashes.length).toBeGreaterThan(2);
    const first = flashes[0];
    const thunder = thunders.find((x) => x.l === first.l)!;
    expect(thunder.t - first.t).toBeCloseTo(first.l.distance / 343, 0);
  });

  it('speichert und lädt den Zustand', () => {
    const a = new Weather(mulberry32(9));
    a.setPhase('rain');
    run(a, 50);
    const b = new Weather(mulberry32(9));
    b.load(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.serialize()).toEqual(a.serialize());
  });
});
