import { describe, expect, it } from 'vitest';
import { Exploration } from './Exploration';

describe('Erkundung', () => {
  it('deckt Zellen im Umkreis auf, weiter entfernte bleiben verborgen', () => {
    const e = new Exploration(1536, 128);
    expect(e.isRevealed(0, 0)).toBe(false);
    e.reveal(0, 0, 60);
    expect(e.isRevealed(0, 0)).toBe(true);
    expect(e.isRevealed(40, 30)).toBe(true);
    expect(e.isRevealed(100, 0)).toBe(false);
    expect(e.fraction).toBeGreaterThan(0);
    expect(e.fraction).toBeLessThan(0.01);
  });

  it('zählt nur neue Zellen (Karte zeichnet nur bei Änderungen neu)', () => {
    const e = new Exploration(1536, 128);
    e.reveal(100, 100, 30);
    const v = e.version;
    e.reveal(100, 100, 30);
    expect(e.version).toBe(v);
  });

  it('speichert und lädt verlustfrei, kaputte Daten werden ignoriert', () => {
    const a = new Exploration(1536, 128);
    a.reveal(-300, 200, 80);
    a.reveal(500, -500, 40);
    const b = new Exploration(1536, 128);
    b.load(a.serialize());
    expect(b.serialize()).toBe(a.serialize());
    expect(b.isRevealed(-300, 200)).toBe(true);
    b.load('!!kein base64!!');
    expect(b.isRevealed(-300, 200)).toBe(true);
  });
});
