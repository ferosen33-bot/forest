/**
 * Die Fiebernacht (wie die Blutmond-Nächte in 7 Days to Die): Jeden siebten Tag färbt sich der
 * Himmel rot, und von 21 bis 5 Uhr ziehen Horden von Schraten in Wellen auf den Spieler zu.
 * Reine Zeitplan-Logik (getestet) – Horden und Himmel setzt das Spiel um.
 */

export const FEVER_INTERVAL = 7;
export const FEVER_START = 21;
export const FEVER_END = 5;
/** Ab dieser Uhrzeit wird am Fiebertag gewarnt. */
export const FEVER_WARNING = 17;

export type FeverPhase = 'none' | 'warning' | 'night';

export const isFeverDay = (day: number): boolean => day > 0 && day % FEVER_INTERVAL === 0;

export function feverPhase(day: number, hour: number): FeverPhase {
  if (isFeverDay(day) && hour >= FEVER_START) return 'night';
  // Nach Mitternacht gehört die Nacht noch zum Fiebertag davor.
  if (isFeverDay(day - 1) && hour < FEVER_END) return 'night';
  if (isFeverDay(day) && hour >= FEVER_WARNING) return 'warning';
  return 'none';
}

/** Tage bis zum nächsten Fiebertag (0 = heute). */
export function daysUntilFever(day: number): number {
  const r = day % FEVER_INTERVAL;
  return r === 0 ? 0 : FEVER_INTERVAL - r;
}

/** Die wievielte Fiebernacht (1 = Tag 7) – bestimmt die Stärke. */
export function feverNumber(day: number, hour: number): number {
  const d = isFeverDay(day) && hour >= FEVER_END ? day : isFeverDay(day - 1) ? day - 1 : day;
  return Math.max(1, Math.floor(d / FEVER_INTERVAL));
}

/** Gegner je Welle und Wellenabstand: jede Woche härter (begrenzt). */
export function waveSize(n: number): number {
  return Math.min(9, 3 + 2 * (n - 1));
}

export function waveInterval(n: number): number {
  return Math.max(45, 90 - 10 * (n - 1));
}

/** Kurztext für die Uhrzeile ("Fiebernacht morgen" …) oder leer. */
export function feverLabel(day: number, hour: number): string {
  const phase = feverPhase(day, hour);
  if (phase === 'night') return 'FIEBERNACHT';
  if (isFeverDay(day)) return 'Fiebernacht heute';
  if (daysUntilFever(day) === 1) return 'Fiebernacht morgen';
  return '';
}
