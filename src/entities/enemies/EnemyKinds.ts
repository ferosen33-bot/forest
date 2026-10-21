/** Gegnertypen der Insel. */
export type EnemyKind = 'schrat' | 'spaeher' | 'koloss';

export interface EnemyKindDef {
  kind: EnemyKind;
  name: string;
  /** Körpergröße (multipliziert mit einer kleinen Zufallsvariation). */
  scale: number;
  /** Faktoren auf die Grundwerte aus `CONFIG.ai`. */
  health: number;
  speed: number;
  damage: number;
  attackRange: number;
  /** Dauer eines Hiebs (s) – lang = gut erkennbares Ausholen. */
  attackTime: number;
  sight: number;
  hearing: number;
  /** Radius, in dem der Warnschrei Artgenossen alarmiert (m). */
  alertRadius: number;
  /** Schaden pro Schlag gegen Bauwerke. */
  structureDamage: number;
  /** Treffer unter diesem Schaden lassen ihn nicht taumeln. */
  staggerThreshold: number;
  /** Hält nachts Abstand zu Feuern. */
  fearsFire: boolean;
  /** Nach jedem Hieb kurz zurückweichen (zuschlagen und Abstand halten). */
  hitAndRun: boolean;
  /** Trägt eine Keule. */
  club: boolean;
  /** Fernangriff: Steine werfen, wenn der Spieler in diesem Abstand sichtbar ist. */
  ranged?: { minRange: number; maxRange: number; cooldown: number; speed: number; damage: number };
  /** Hauttöne (sRGB) für die Variation innerhalb des Typs. */
  tones: number[];
}

export const ENEMY_KINDS: Record<EnemyKind, EnemyKindDef> = {
  schrat: {
    kind: 'schrat',
    name: 'Schrat',
    scale: 1,
    health: 1,
    speed: 1,
    damage: 1,
    attackRange: 1,
    attackTime: 1.15,
    sight: 1,
    hearing: 1,
    alertRadius: 25,
    structureDamage: 20,
    staggerThreshold: 0,
    fearsFire: true,
    hitAndRun: false,
    club: true,
    tones: [0x8d8577, 0x7f796f, 0x958a79, 0x77746d],
  },
  // Klein, flink und schwach – sieht und hört mehr, schlägt Alarm und hält Abstand.
  spaeher: {
    kind: 'spaeher',
    name: 'Späher',
    scale: 0.82,
    health: 0.5,
    speed: 1.28,
    damage: 0.55,
    attackRange: 0.9,
    attackTime: 0.8,
    sight: 1.3,
    hearing: 1.4,
    alertRadius: 50,
    structureDamage: 8,
    staggerThreshold: 0,
    fearsFire: true,
    hitAndRun: true,
    club: false,
    ranged: { minRange: 6, maxRange: 20, cooldown: 3.5, speed: 19, damage: 8 },
    tones: [0xa08a68, 0x947f61, 0xa99372],
  },
  // Groß, langsam und zäh – schlägt hart zu, fürchtet kein Feuer und reißt Bauwerke ein.
  koloss: {
    kind: 'koloss',
    name: 'Koloss',
    scale: 1.4,
    health: 2.6,
    speed: 0.74,
    damage: 2.2,
    attackRange: 1.35,
    attackTime: 1.65,
    sight: 0.85,
    hearing: 0.8,
    alertRadius: 25,
    structureDamage: 60,
    staggerThreshold: 35,
    fearsFire: false,
    hitAndRun: false,
    club: true,
    tones: [0x5f5c58, 0x56534f, 0x67625a],
  },
};

export const isEnemyKind = (k: unknown): k is EnemyKind => typeof k === 'string' && k in ENEMY_KINDS;

/** Multiplikator für Treffer gegen Gegner, die den Spieler (noch) nicht bemerkt haben. */
export const SNEAK_MULTIPLIER = 3;
