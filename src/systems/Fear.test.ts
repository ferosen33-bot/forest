import { describe, expect, it } from 'vitest';
import { Fear, type FearInput } from './Fear';

const run = (fear: Fear, input: Omit<FearInput, 'dt'>, seconds: number) => {
  for (let i = 0; i < seconds * 10; i++) fear.update({ ...input, dt: 0.1 });
  return fear.value;
};

describe('Fear', () => {
  it('steigt in der Dunkelheit, steigt mit Gegnern stärker und legt sich am Feuer', () => {
    const f = new Fear();
    const dark = run(f, { darkness: 1, threat: 0, nearFire: false, resting: false }, 30);
    expect(dark).toBeGreaterThan(0.4);
    expect(dark).toBeLessThan(0.55);
    const hunted = run(f, { darkness: 1, threat: 1, nearFire: false, resting: false }, 20);
    expect(hunted).toBeGreaterThan(0.95);
    const calm = run(f, { darkness: 1, threat: 0, nearFire: true, resting: false }, 20);
    expect(calm).toBeLessThan(0.2);
  });

  it('Schreckmomente wirken sofort und klingen ab', () => {
    const f = new Fear();
    f.scare(0.5);
    expect(f.value).toBeCloseTo(0.3, 5);
    const later = run(f, { darkness: 0, threat: 0, nearFire: false, resting: false }, 30);
    expect(later).toBeLessThan(0.05);
    expect(f.hallucinating).toBe(false);
  });
});
