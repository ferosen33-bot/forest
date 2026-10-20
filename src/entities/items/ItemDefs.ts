/**
 * Item-Registry: alle Gegenstände des Spiels mit ihren Eigenschaften.
 * Neue Items (Seil, Fleisch, Speer …) werden ausschließlich hier eingetragen.
 */

export type ItemId = 'log' | 'stick' | 'stone' | 'berries' | 'axe';

export type ItemCategory = 'resource' | 'tool' | 'food';

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
}

export interface FoodStats {
  hunger: number;
  thirst: number;
  health: number;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  description: string;
  category: ItemCategory;
  maxStack: number;
  tool?: ToolStats;
  food?: FoodStats;
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
    tool: {
      treeDamage: 20,
      rockYield: 1,
      damage: 25,
      swingTime: 0.62,
      impactAt: 0.42,
      staminaCost: 6,
      reach: 2.7,
    },
  },
};

export const getItem = (id: ItemId): ItemDef => ITEMS[id];
