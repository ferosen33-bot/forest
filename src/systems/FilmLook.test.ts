import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { filmLook, morningMist, type LookContext } from './FilmLook';

const base: LookContext = {
  daylight: 1,
  hour: 12,
  fever: 0,
  cave: false,
  underwater: false,
  fear: 0,
  rain: 0,
  cameraY: 10,
  fogColor: new THREE.Color(0.5, 0.5, 0.5),
};

describe('FilmLook', () => {
  it('nachts entsättigter, körniger und nebliger als am Tag', () => {
    const day = filmLook(base);
    const night = filmLook({ ...base, daylight: 0, hour: 1 });
    expect(night.grade.saturation).toBeLessThan(day.grade.saturation);
    expect(night.grade.grain).toBeGreaterThan(day.grade.grain);
    expect(night.mist.density).toBeGreaterThan(day.mist.density);
  });

  it('Morgennebel am dichtesten in der Dämmerung', () => {
    expect(morningMist(6)).toBeCloseTo(1);
    expect(morningMist(12)).toBe(0);
    expect(morningMist(1)).toBe(0);
    expect(filmLook({ ...base, hour: 6, daylight: 0.4 }).mist.density).toBeGreaterThan(filmLook(base).mist.density * 4);
  });

  it('Fiebernacht färbt die Lichter rot', () => {
    const g = filmLook({ ...base, daylight: 0, fever: 1 }).grade;
    expect(g.highlights.r).toBeGreaterThan(g.highlights.g);
    expect(g.shadows.r).toBeGreaterThan(0);
  });

  it('Angst verstärkt Vignette, Korn und Farbsäume', () => {
    const calm = filmLook(base).grade;
    const scared = filmLook({ ...base, fear: 1 }).grade;
    expect(scared.vignette).toBeGreaterThan(calm.vignette);
    expect(scared.grain).toBeGreaterThan(calm.grain);
    expect(scared.aberration).toBeGreaterThan(calm.aberration);
    expect(scared.saturation).toBeLessThan(calm.saturation);
  });

  it('Nebel folgt der Kamerahöhe', () => {
    expect(filmLook({ ...base, cameraY: 40 }).mist.base).toBeCloseTo(40 - 2.2);
  });

  it('verwendet das übergebene Ergebnisobjekt wieder', () => {
    const out = filmLook(base);
    const again = filmLook({ ...base, daylight: 0 }, out);
    expect(again).toBe(out);
  });

  it('Schneesturm: dichter, hoher, heller Schleier', () => {
    const calm = filmLook(base).mist;
    const storm = filmLook({ ...base, blizzard: 1 }).mist;
    expect(storm.density).toBeGreaterThan(calm.density + 0.04);
    expect(storm.height).toBeGreaterThan(calm.height + 10);
    // In der Höhle zählt der Sturm nicht.
    expect(filmLook({ ...base, blizzard: 1, cave: true }).mist.density).toBe(filmLook({ ...base, cave: true }).mist.density);
  });
});
