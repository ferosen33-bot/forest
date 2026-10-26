/** Gegnertypen der Insel. */
export type EnemyKind = 'schrat' | 'spaeher' | 'koloss' | 'kriecher' | 'hetzer' | 'schreier' | 'hansen';

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
  /** Gebückte Haltung (0 = aufrecht, 1 = kriechend). */
  hunch?: number;
  /**
   * Fernangriff, wenn der Spieler in diesem Abstand sichtbar ist: Steine werfen oder – `scream` –
   * ein Schrei, der lähmt und alle Schrate im Umkreis `alertRadius` herbeiruft.
   */
  ranged?: { minRange: number; maxRange: number; cooldown: number; speed: number; damage: number; scream?: boolean };
  /** Endgegner: Bodenstampfer trifft rundum, ruft bei diesen Lebensanteilen Kriecher herbei, wird unter der Hälfte rasend. */
  boss?: { slamRadius: number; summonAt: number[] };
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
  // Höhlenbewohner: bleich und fast blind, aber mit feinem Gehör. Scheut den Fackelschein,
  // schlägt zu und zieht sich gleich wieder ins Dunkel zurück.
  kriecher: {
    kind: 'kriecher',
    name: 'Kriecher',
    scale: 0.86,
    health: 0.7,
    speed: 1.12,
    damage: 0.8,
    attackRange: 0.95,
    attackTime: 0.85,
    sight: 0.5,
    hearing: 1.9,
    alertRadius: 30,
    structureDamage: 10,
    staggerThreshold: 0,
    fearsFire: true,
    hitAndRun: true,
    club: false,
    hunch: 1,
    tones: [0xcfc6b8, 0xc2baad, 0xd8cfc0],
  },
  // Verwandelte aus dem Ort: hager, barfuß und schneller als jeder Mensch. Jagen nachts zu zweit,
  // schlagen zu und verschwinden wieder im Dunkel.
  hetzer: {
    kind: 'hetzer',
    name: 'Hetzer',
    scale: 0.96,
    health: 0.55,
    speed: 1.55,
    damage: 0.65,
    attackRange: 0.95,
    attackTime: 0.7,
    sight: 1.15,
    hearing: 1.3,
    alertRadius: 30,
    structureDamage: 12,
    staggerThreshold: 0,
    fearsFire: true,
    hitAndRun: true,
    club: false,
    hunch: 0.35,
    tones: [0xb8b0a2, 0xa9a194, 0xc2b9aa],
  },
  // Die Schreiende: bleich, langes schwarzes Haar. Hält Abstand, und wenn sie dich sieht, schreit sie –
  // der Schrei lähmt und ruft alles im weiten Umkreis herbei.
  schreier: {
    kind: 'schreier',
    name: 'Schreierin',
    scale: 0.95,
    health: 0.5,
    speed: 1.05,
    damage: 0.5,
    attackRange: 0.9,
    attackTime: 0.8,
    sight: 1.35,
    hearing: 1.2,
    alertRadius: 90,
    structureDamage: 5,
    staggerThreshold: 0,
    fearsFire: true,
    hitAndRun: true,
    club: false,
    ranged: { minRange: 5, maxRange: 28, cooldown: 11, speed: 0, damage: 0, scream: true },
    tones: [0xd8d2ca, 0xcfc8be],
  },
  // Hansen, der Erste: der Bergmann, mit dem es im neuen Stollen begann. Riesig, von Pilzen durchwachsen,
  // haust in der hintersten Kammer des Feuersteinstollens.
  hansen: {
    kind: 'hansen',
    name: 'Hansen, der Erste',
    scale: 1.75,
    health: 14,
    speed: 0.82,
    damage: 2.6,
    attackRange: 1.6,
    attackTime: 1.8,
    sight: 0.9,
    hearing: 2,
    alertRadius: 60,
    structureDamage: 100,
    staggerThreshold: 70,
    fearsFire: false,
    hitAndRun: false,
    club: false,
    boss: { slamRadius: 3.4, summonAt: [0.66, 0.33] },
    tones: [0xa8b49a],
  },
};

export const isEnemyKind = (k: unknown): k is EnemyKind => typeof k === 'string' && k in ENEMY_KINDS;

/** Multiplikator für Treffer gegen Gegner, die den Spieler (noch) nicht bemerkt haben. */
export const SNEAK_MULTIPLIER = 3;
