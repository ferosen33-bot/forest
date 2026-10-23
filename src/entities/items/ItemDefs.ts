/**
 * Item-Registry: alle Gegenstände des Spiels mit ihren Eigenschaften.
 * Neue Items (Seil, Fleisch, Speer …) werden ausschließlich hier eingetragen.
 */

export type ItemId =
  | 'log'
  | 'stick'
  | 'stone'
  | 'berries'
  | 'rawMeat'
  | 'cookedMeat'
  | 'axe'
  | 'stoneAxe'
  | 'spear'
  | 'torch'
  | 'bowl'
  | 'bowlWater'
  | 'bow'
  | 'arrow'
  | 'hide'
  | 'backpack'
  | 'furCoat'
  | 'fishingRod'
  | 'rawFish'
  | 'cookedFish';

export type ItemCategory = 'resource' | 'tool' | 'food';

/** Materialkosten (Rezepte, Bauwerke). */
export interface ItemCost {
  item: ItemId;
  count: number;
}

export interface ToolStats {
  /** Schaden pro Treffer an Bäumen. */
  treeDamage: number;
  /** Abbau-Fortschritt pro Treffer an Felsen (1 = ein Stein pro Treffer). */
  rockYield: number;
  /** Schaden an Kreaturen (für späteres Kampfsystem). */
  damage: number;
  /** Dauer eines kompletten Schlags in Sekunden. */
  swingTime: number;
  /** Anteil der Schlagdauer, an dem der Treffer geprüft wird. */
  impactAt: number;
  staminaCost: number;
  reach: number;
  /** Bewegungsablauf in der Hand: seitlicher Hieb oder Stoß nach vorne. */
  animation: 'swing' | 'thrust';
}

/** Lichtquelle, solange das Item in der Hand gehalten wird. */
export interface HeldLight {
  color: number;
  intensity: number;
  distance: number;
}

export interface FoodStats {
  hunger: number;
  thirst: number;
  health: number;
  /** Bleibt nach dem Verzehr übrig (z. B. leere Schale). */
  leftover?: ItemId;
}

export interface RangedStats {
  ammo: ItemId;
  /** Sekunden bis voll gespannt. */
  drawTime: number;
  minSpeed: number;
  maxSpeed: number;
  minDamage: number;
  maxDamage: number;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  description: string;
  category: ItemCategory;
  maxStack: number;
  /**
   * Haltbarkeit: Werkzeuge in Treffern, Fackeln in Brennsekunden.
   * Items mit Haltbarkeit stapeln nie – jedes Exemplar hat seinen eigenen Zustand.
   */
  durability?: number;
  /** Kann geworfen werden (rechte Maustaste zielen, linke werfen). */
  throwable?: { speed: number; damageMultiplier: number };
  /** Rechtsklick im Inventar: dauerhaft anlegen bzw. benutzen (wird dabei verbraucht). */
  use?: 'backpack' | 'clothing';
  /** Fernwaffe: Linksklick gedrückt halten zum Spannen, loslassen zum Schießen. */
  ranged?: RangedStats;
  tool?: ToolStats;
  food?: FoodStats;
  light?: HeldLight;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  log: {
    id: 'log',
    name: 'Holzstamm',
    description: 'Schwer, aber unverzichtbar für Unterstände und Lagerfeuer.',
    category: 'resource',
    maxStack: 4,
  },
  stick: {
    id: 'stick',
    name: 'Stock',
    description: 'Ein gerader Ast. Grundlage für Werkzeuge und Feuer.',
    category: 'resource',
    maxStack: 15,
  },
  stone: {
    id: 'stone',
    name: 'Stein',
    description: 'Ein handlicher Stein mit scharfer Kante.',
    category: 'resource',
    maxStack: 12,
  },
  rawMeat: {
    id: 'rawMeat',
    name: 'Rohes Fleisch',
    description: 'Roh essbar, aber es schlägt auf den Magen. Besser am Lagerfeuer braten.',
    category: 'food',
    maxStack: 10,
    food: { hunger: 6, thirst: -3, health: -6 },
  },
  cookedMeat: {
    id: 'cookedMeat',
    name: 'Gebratenes Fleisch',
    description: 'Über dem Feuer gegart. Macht satt und stärkt.',
    category: 'food',
    maxStack: 10,
    food: { hunger: 35, thirst: -2, health: 8 },
  },
  rawFish: {
    id: 'rawFish',
    name: 'Roher Fisch',
    description: 'Frisch aus dem Wasser. Roh nur im Notfall – am Lagerfeuer gebraten wird eine gute Mahlzeit daraus.',
    category: 'food',
    maxStack: 10,
    food: { hunger: 5, thirst: 1, health: -4 },
  },
  cookedFish: {
    id: 'cookedFish',
    name: 'Gebratener Fisch',
    description: 'Knusprig über dem Feuer gegart. Leichter als Fleisch, aber sättigend – auch im Winter zu haben.',
    category: 'food',
    maxStack: 10,
    food: { hunger: 24, thirst: 2, health: 5 },
  },
  fishingRod: {
    id: 'fishingRod',
    name: 'Angelrute',
    description:
      'Linksklick: Köder ins Wasser werfen. Taucht der Schwimmer unter, sofort noch einmal klicken – sonst ist der Fisch weg.',
    category: 'tool',
    maxStack: 1,
    durability: 40,
  },
  bowl: {
    id: 'bowl',
    name: 'Holzschale',
    description: 'Aus einem Stamm geschnitzt. In der Hand: am Wasser mit E füllen – im Regen läuft sie von selbst voll.',
    // Wird in der Hand benutzt → wie Werkzeuge bevorzugt in den Schnellzugriff.
    category: 'tool',
    maxStack: 3,
  },
  bowlWater: {
    id: 'bowlWater',
    name: 'Schale mit Wasser',
    description: 'Frisches Wasser für unterwegs. Linksklick in der Hand oder Rechtsklick im Inventar: trinken.',
    category: 'food',
    maxStack: 1,
    food: { hunger: 0, thirst: 45, health: 0, leftover: 'bowl' },
  },
  berries: {
    id: 'berries',
    name: 'Beeren',
    description: 'Säuerlich, aber nahrhaft. Stillen etwas Hunger und Durst.',
    category: 'food',
    maxStack: 20,
    food: { hunger: 9, thirst: 3, health: 1 },
  },
  axe: {
    id: 'axe',
    name: 'Notfallaxt',
    description: 'Aus dem Flugzeugwrack geborgen. Fällt Bäume und schlägt Steine ab.',
    category: 'tool',
    maxStack: 1,
    durability: 220,
    tool: {
      treeDamage: 20,
      rockYield: 1,
      damage: 25,
      swingTime: 0.62,
      impactAt: 0.42,
      staminaCost: 6,
      reach: 2.7,
      animation: 'swing',
    },
  },
  stoneAxe: {
    id: 'stoneAxe',
    name: 'Steinaxt',
    description: 'Ein scharfkantiger Stein an einem Stock. Schwerer als die Notfallaxt, aber deutlich wirkungsvoller.',
    category: 'tool',
    maxStack: 1,
    durability: 140,
    tool: {
      treeDamage: 32,
      rockYield: 2,
      damage: 30,
      swingTime: 0.74,
      impactAt: 0.44,
      staminaCost: 8,
      reach: 2.7,
      animation: 'swing',
    },
  },
  spear: {
    id: 'spear',
    name: 'Speer',
    description: 'Ein langer, angespitzter Stock. Hält Angreifer auf Abstand – und lässt sich werfen.',
    category: 'tool',
    maxStack: 1,
    durability: 60,
    throwable: { speed: 30, damageMultiplier: 1.6 },
    tool: {
      treeDamage: 4,
      rockYield: 0,
      damage: 40,
      swingTime: 0.55,
      impactAt: 0.4,
      staminaCost: 7,
      reach: 3.4,
      animation: 'thrust',
    },
  },
  hide: {
    id: 'hide',
    name: 'Fell',
    description: 'Beim Ausnehmen gewonnen. Daraus entstehen ein größerer Rucksack und warme Kleidung.',
    category: 'resource',
    maxStack: 10,
  },
  backpack: {
    id: 'backpack',
    name: 'Großer Rucksack',
    description: 'Aus Fellen genäht. Rechtsklick: umpacken – zwölf zusätzliche Plätze.',
    category: 'resource',
    maxStack: 1,
    use: 'backpack',
  },
  furCoat: {
    id: 'furCoat',
    name: 'Fellmantel',
    description: 'Hält auch nass noch warm. Rechtsklick: anziehen – man friert deutlich weniger.',
    category: 'resource',
    maxStack: 1,
    use: 'clothing',
  },
  bow: {
    id: 'bow',
    name: 'Bogen',
    description: 'Linksklick halten zum Spannen, loslassen zum Schießen; Rechtsklick zielt genauer. Braucht Pfeile.',
    category: 'tool',
    maxStack: 1,
    durability: 150,
    ranged: { ammo: 'arrow', drawTime: 0.9, minSpeed: 16, maxSpeed: 46, minDamage: 10, maxDamage: 42 },
  },
  arrow: {
    id: 'arrow',
    name: 'Pfeil',
    description: 'Angespitzter Stock mit Steinspitze. Steckt nach dem Schuss oft noch im Ziel oder Boden – aufsammeln!',
    category: 'resource',
    maxStack: 30,
  },
  torch: {
    id: 'torch',
    name: 'Fackel',
    description: 'Spendet in der Hand Licht. Unverzichtbar in den dunklen Nächten. Brennt etwa sechs Minuten.',
    category: 'tool',
    maxStack: 1,
    durability: 360,
    light: { color: 0xffa04a, intensity: 18, distance: 16 },
  },
};

/** Typwächter für Daten von außen (Spielstände). */
export const isItemId = (id: string): id is ItemId => Object.prototype.hasOwnProperty.call(ITEMS, id);

export const getItem = (id: ItemId): ItemDef => ITEMS[id];
