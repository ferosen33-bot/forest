import { describe, expect, it } from 'vitest';
import { armFactor, severChance, type GoreHit } from './Gore';

const hit = (h: Partial<GoreHit>): GoreHit => ({ cut: true, heavy: 0, fraction: 0.1, killed: false, headshot: false, ...h });

describe('Zerstückelung', () => {
  it('Köpfe gehen nur beim tödlichen Treffer ab, Klingen trennen, Wucht zertrümmert', () => {
    expect(severChance(hit({ killed: false, headshot: true }), 'head')).toBe(0);
    expect(severChance(hit({ killed: true, headshot: true }), 'head')).toBeGreaterThan(0.8);
    expect(severChance(hit({ cut: false, killed: true, headshot: true, heavy: 1 }), 'head')).toBe(1);
    expect(severChance(hit({ cut: false, killed: true, headshot: false }), 'head')).toBe(0);
  });

  it('Lebende verlieren Gliedmaßen nur bei wuchtigen Klingenhieben', () => {
    expect(severChance(hit({ fraction: 0.1 }), 'armL')).toBe(0);
    expect(severChance(hit({ fraction: 0.4 }), 'armL')).toBeGreaterThan(0);
    expect(severChance(hit({ heavy: 1, fraction: 0.1 }), 'legR')).toBeGreaterThan(0);
    expect(severChance(hit({ cut: false, fraction: 0.9, heavy: 1 }), 'armR')).toBe(0);
    expect(severChance(hit({ killed: true, heavy: 1 }), 'armR')).toBeGreaterThan(0.9);
  });

  it('ohne Arme schlägt er schwächer', () => {
    expect(armFactor(new Set())).toBe(1);
    expect(armFactor(new Set(['armL']))).toBeLessThan(1);
    expect(armFactor(new Set(['armL', 'armR']))).toBeLessThan(armFactor(new Set(['armR'])));
    expect(armFactor(new Set(['legL']))).toBe(1);
  });
});
