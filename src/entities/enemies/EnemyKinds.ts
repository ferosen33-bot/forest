import { RESIST_FACTOR, WEAK_FACTOR, type ElementId } from '../items/Elements';

/** Gegnertypen der Insel. */
export type EnemyKind =
  | 'schrat'
  | 'spaeher'
  | 'koloss'
  | 'kriecher'
  | 'hetzer'
  | 'schreier'
  | 'hansen'
  // Meilenstein 56: Bewohner der unheimlichen Orte
  | 'porzellan'
  | 'strohmann'
  | 'gehenkter'
  | 'soldat'
  | 'schatten'
  | 'schlaechter';

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
  /** Elemente, gegen die der Typ anfällig ist bzw. die ihm wenig anhaben. */
  weak?: ElementId[];
  resist?: ElementId[];
  /** Bewegt sich nur, solange der Spieler nicht hinsieht – dann aber rasend schnell (Porzellankind). */
  statue?: boolean;
  /** Springt außer Sicht näher heran, wenn er weiter als `min` m entfernt ist (Der Gehängte). */
  blink?: { min: number; cooldown: number };
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
    weak: ['bleed'],
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
    weak: ['shock'],
    resist: ['bleed'],
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
    weak: ['fire'],
    resist: ['caustic'],
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
    weak: ['bleed', 'fire'],
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
    weak: ['shock'],
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
    weak: ['fire'],
    resist: ['caustic', 'bleed'],
    tones: [0xa8b49a],
  },
  // Porzellankind: eine lebensgroße Puppe in Kindergröße. Erstarrt, sobald man sie ansieht; wer
  // wegschaut, hat sie im nächsten Augenblick neben sich. Zerbrechlich – stumpfe Schläge zerschmettern sie.
  porzellan: {
    kind: 'porzellan',
    name: 'Porzellankind',
    scale: 0.6,
    health: 0.45,
    speed: 2.1,
    damage: 0.7,
    attackRange: 0.8,
    attackTime: 0.6,
    sight: 1.4,
    hearing: 1.4,
    alertRadius: 30,
    structureDamage: 6,
    staggerThreshold: 0,
    fearsFire: false,
    hitAndRun: false,
    club: false,
    statue: true,
    weak: ['shock'],
    resist: ['bleed', 'caustic'],
    tones: [0xe8ddd0, 0xefe6da],
  },
  // Strohmann: eine Vogelscheuche, die nachts vom Pfahl steigt. Zäh und langsam, Klingen schneiden nur
  // Stroh – aber Feuer frisst ihn.
  strohmann: {
    kind: 'strohmann',
    name: 'Strohmann',
    scale: 1.08,
    health: 1.7,
    speed: 0.85,
    damage: 1.3,
    attackRange: 1.15,
    attackTime: 1.25,
    sight: 1.1,
    hearing: 0.9,
    alertRadius: 40,
    structureDamage: 25,
    staggerThreshold: 20,
    fearsFire: false,
    hitAndRun: false,
    club: true,
    weak: ['fire'],
    resist: ['bleed', 'caustic'],
    tones: [0xb89a6a, 0xa88c60],
  },
  // Der Gehängte: hager, blau angelaufen, mit dem Strick um den Hals. Geht langsam – doch wer ihn aus
  // den Augen lässt, findet ihn plötzlich viel näher.
  gehenkter: {
    kind: 'gehenkter',
    name: 'Der Gehängte',
    scale: 1.18,
    health: 1.3,
    speed: 0.7,
    damage: 1.6,
    attackRange: 1.2,
    attackTime: 1.1,
    sight: 1.3,
    hearing: 1.1,
    alertRadius: 30,
    structureDamage: 20,
    staggerThreshold: 15,
    fearsFire: false,
    hitAndRun: false,
    club: false,
    hunch: 0.2,
    blink: { min: 7, cooldown: 5 },
    weak: ['fire'],
    resist: ['bleed'],
    tones: [0x8a98a8, 0x7e8c9a],
  },
  // Soldat aus dem Bunker: Gasmaske, Uniform in Fetzen. Hält Abstand und wirft mit Schrott und Steinen.
  soldat: {
    kind: 'soldat',
    name: 'Bunkersoldat',
    scale: 1.02,
    health: 1.2,
    speed: 1.05,
    damage: 1.0,
    attackRange: 1,
    attackTime: 0.95,
    sight: 1.2,
    hearing: 1.2,
    alertRadius: 45,
    structureDamage: 30,
    staggerThreshold: 10,
    fearsFire: false,
    hitAndRun: true,
    club: false,
    ranged: { minRange: 6, maxRange: 24, cooldown: 4, speed: 18, damage: 13 },
    weak: ['shock'],
    resist: ['caustic'],
    tones: [0x6a7058, 0x5e6450],
  },
  // Schatten: Fahrgäste des Geisterzugs. Schwarz wie Ruß, lautlos und schnell, zerfallen bei Tag.
  schatten: {
    kind: 'schatten',
    name: 'Schatten',
    scale: 1,
    health: 0.6,
    speed: 1.45,
    damage: 0.85,
    attackRange: 1,
    attackTime: 0.75,
    sight: 1.5,
    hearing: 1.3,
    alertRadius: 40,
    structureDamage: 10,
    staggerThreshold: 0,
    fearsFire: true,
    hitAndRun: true,
    club: false,
    weak: ['fire', 'shock'],
    resist: ['bleed', 'caustic'],
    tones: [0x141418],
  },
  // Der Schlächter: hinter der Schweinsmaske steckt der Metzger von Gut Wendt. Riesig, mit Hackbeil,
  // schlägt rundum – und lässt sich von nichts aufhalten.
  schlaechter: {
    kind: 'schlaechter',
    name: 'Der Schlächter',
    scale: 1.45,
    health: 9,
    speed: 0.95,
    damage: 2.2,
    attackRange: 1.4,
    attackTime: 1.4,
    sight: 1.1,
    hearing: 1.5,
    alertRadius: 60,
    structureDamage: 80,
    staggerThreshold: 60,
    fearsFire: false,
    hitAndRun: false,
    club: false,
    boss: { slamRadius: 2.6, summonAt: [] },
    weak: ['shock'],
    resist: ['bleed'],
    tones: [0xc8a898],
  },
};

/** Schadensfaktor eines Elements gegen den Gegnertyp. */
export function elementFactor(kind: EnemyKindDef, element: ElementId): number {
  if (kind.weak?.includes(element)) return WEAK_FACTOR;
  if (kind.resist?.includes(element)) return RESIST_FACTOR;
  return 1;
}

export const isEnemyKind = (k: unknown): k is EnemyKind => typeof k === 'string' && k in ENEMY_KINDS;

/** Multiplikator für Treffer gegen Gegner, die den Spieler (noch) nicht bemerkt haben. */
export const SNEAK_MULTIPLIER = 3;
