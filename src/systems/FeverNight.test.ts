import { describe, expect, it } from 'vitest';
import { daysUntilFever, feverLabel, feverNumber, feverPhase, waveInterval, waveSize } from './FeverNight';

describe('FeverNight', () => {
  it('kommt jeden siebten Tag von 21 bis 5 Uhr, mit Warnung am Abend', () => {
    expect(feverPhase(7, 12)).toBe('none');
    expect(feverPhase(7, 18)).toBe('warning');
    expect(feverPhase(7, 22)).toBe('night');
    expect(feverPhase(8, 3)).toBe('night');
    expect(feverPhase(8, 6)).toBe('none');
    expect(feverPhase(6, 23)).toBe('none');
    expect(feverPhase(14, 21.5)).toBe('night');
  });

  it('zählt die Tage bis zur nächsten und die Nummer der Fiebernacht', () => {
    expect(daysUntilFever(1)).toBe(6);
    expect(daysUntilFever(6)).toBe(1);
    expect(daysUntilFever(7)).toBe(0);
    expect(feverNumber(7, 22)).toBe(1);
    expect(feverNumber(15, 2)).toBe(2);
    expect(feverLabel(6, 10)).toBe('Fiebernacht morgen');
    expect(feverLabel(7, 10)).toBe('Fiebernacht heute');
    expect(feverLabel(8, 2)).toBe('FIEBERNACHT');
  });

  it('wird von Woche zu Woche härter, aber begrenzt', () => {
    expect(waveSize(1)).toBe(3);
    expect(waveSize(3)).toBe(7);
    expect(waveSize(10)).toBe(9);
    expect(waveInterval(1)).toBe(90);
    expect(waveInterval(9)).toBe(45);
  });
});
