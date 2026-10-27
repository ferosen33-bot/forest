/**
 * Elemente für Waffenmods: An der Werkbank bekommt eine Waffe (ab „Ungewöhnlich“) einen Mod, der Treffer
 * mit einem Element auflädt. Jedes Element setzt einen Zustand, und manche Zustände verstärken sich
 * gegenseitig (Wasser + Schock, Säure + Feuer, brennendes Öl).
 */

export type ElementId = 'fire' | 'shock' | 'caustic' | 'bleed';

export interface ElementDef {
  id: ElementId;
  /** Name des Elements (Anzeige im Inventar). */
  name: string;
  /** Kurzer Schriftzug am Fadenkreuz, wenn das Element greift. */
  tag: string;
  /** Farbe für Schrift und Anzeige (CSS). */
  css: string;
  /** Leuchtfarbe der Effekte (linear, darf über 1 gehen → Bloom). */
  glow: [number, number, number];
  /** Wirkung in einem Satz. */
  text: string;
}

export const ELEMENTS: Record<ElementId, ElementDef> = {
  fire: {
    id: 'fire',
    name: 'Feuer',
    tag: 'BRAND',
    css: '#ff8a3a',
    glow: [4, 1.5, 0.35],
    text: 'Setzt Getroffene in Brand. Brennende stecken Nachbarn an, Wasser löscht.',
  },
  shock: {
    id: 'shock',
    name: 'Schock',
    tag: 'SCHOCK',
    css: '#7fd4ff',
    glow: [1.2, 2.6, 5],
    text: 'Lähmt kurz und springt auf Gegner in der Nähe über. Nasse trifft es doppelt.',
  },
  caustic: {
    id: 'caustic',
    name: 'Ätzend',
    tag: 'ÄTZEND',
    css: '#9cf04a',
    glow: [1.6, 4, 0.5],
    text: 'Zersetzt: Verätzte nehmen ein Drittel mehr Schaden. Feuer lässt die Säure verpuffen.',
  },
  bleed: {
    id: 'bleed',
    name: 'Blutung',
    tag: 'BLUTUNG',
    css: '#ff4a4a',
    glow: [3, 0.25, 0.2],
    text: 'Reißt Wunden (bis zu dreifach), die bluten und den Gegner verlangsamen.',
  },
};

export const isElementId = (id: unknown): id is ElementId => typeof id === 'string' && id in ELEMENTS;

// ----------------------------------------------------------------------------- Werte

/** Brand: Dauer (s) und Schaden je Sekunde. */
export const BURN_TIME = 5;
export const BURN_DPS = 9;
/** Schock: Sofortschaden, Lähmung, Überspringen. */
export const SHOCK_DAMAGE = 14;
export const SHOCK_STUN = 1.2;
export const SHOCK_CHAIN = { count: 2, range: 4.5, factor: 0.7 };
/** Wasser + Schock: doppelter Schaden, springt weiter und auf mehr Gegner. */
export const SHOCK_WET = { damage: 2, count: 4, range: 8 };
/** Säure: Dauer, Schaden je Sekunde, Schadensaufschlag solange verätzt. */
export const ACID_TIME = 6;
export const ACID_DPS = 5;
export const ACID_VULNERABILITY = 1.33;
/** Säure + Feuer: Verpuffung. */
export const VAPOR_BLAST = { radius: 3.5, damage: 45 };
/** Blutung: je Wunde Schaden je Sekunde, Dauer, höchstens drei Wunden, Verlangsamung je Wunde. */
export const BLEED_DPS = 3.5;
export const BLEED_TIME = 6;
export const BLEED_MAX = 3;
export const BLEED_SLOW = 0.08;

/** Schwäche bzw. Widerstand eines Gegnertyps gegen ein Element. */
export const WEAK_FACTOR = 1.5;
export const RESIST_FACTOR = 0.5;

/**
 * Chance, dass ein Treffer das Element auslöst: schwere Waffen und Klingen (bei Blutung) zuverlässiger,
 * kritische Treffer immer. Wer mehrmals Pech hatte, bekommt es spätestens beim dritten Treffer.
 */
export function procChance(element: ElementId, weaponClass: 'blade' | 'blunt' | 'heavy' | undefined): number {
  if (weaponClass === 'heavy') return 0.6;
  if (element === 'bleed' && weaponClass === 'blade') return 0.55;
  return 0.38;
}

// ----------------------------------------------------------------------------- Zustand

/** Zustände eines Gegners (Sekunden Restdauer). */
export interface ElementStatus {
  burn: number;
  shock: number;
  acid: number;
  bleed: number;
  bleedStacks: number;
  /** Nass (im Wasser, im Regen). */
  wet: number;
  /** Pech beim Auslösen, wird aufaddiert (≥ 1 → greift sicher). */
  charge: number;
}

export const createStatus = (): ElementStatus => ({ burn: 0, shock: 0, acid: 0, bleed: 0, bleedStacks: 0, wet: 0, charge: 0 });

export const hasStatus = (s: ElementStatus): boolean => s.burn > 0 || s.shock > 0 || s.acid > 0 || s.bleed > 0;

/** Schadensfaktor, solange der Gegner verätzt ist. */
export const vulnerability = (s: ElementStatus): number => (s.acid > 0 ? ACID_VULNERABILITY : 1);

/** Verlangsamung durch Wunden (0..1). */
export const statusSlow = (s: ElementStatus): number => (s.bleed > 0 ? s.bleedStacks * BLEED_SLOW : 0);

/** Würfelt, ob der Treffer das Element auslöst (mit Ausgleich bei Pech). */
export function rollProc(s: ElementStatus, chance: number, crit: boolean, rng: () => number = Math.random): boolean {
  if (crit || s.charge >= 1 || rng() < chance) {
    s.charge = 0;
    return true;
  }
  s.charge += chance;
  return false;
}

/** Schaden über Zeit in diesem Takt (ohne Schwächen). */
export function dotDamage(s: ElementStatus, dt: number): Partial<Record<ElementId, number>> {
  const out: Partial<Record<ElementId, number>> = {};
  if (s.burn > 0) out.fire = BURN_DPS * Math.min(dt, s.burn);
  if (s.acid > 0) out.caustic = ACID_DPS * Math.min(dt, s.acid);
  if (s.bleed > 0) out.bleed = BLEED_DPS * s.bleedStacks * Math.min(dt, s.bleed);
  return out;
}

/** Lässt die Zustände ablaufen. Nässe löscht Feuer schneller, im Wasser sofort. */
export function decayStatus(s: ElementStatus, dt: number, submerged: boolean): void {
  if (submerged) s.burn = 0;
  s.burn = Math.max(0, s.burn - dt * (s.wet > 0 ? 2 : 1));
  s.shock = Math.max(0, s.shock - dt);
  s.acid = Math.max(0, s.acid - dt);
  s.bleed = Math.max(0, s.bleed - dt);
  if (s.bleed === 0) s.bleedStacks = 0;
  s.wet = Math.max(0, s.wet - dt);
}
