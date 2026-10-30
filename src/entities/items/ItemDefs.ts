/**
 * Item-Registry: alle Gegenstände des Spiels mit ihren Eigenschaften.
 * Neue Items (Seil, Fleisch, Speer …) werden ausschließlich hier eingetragen.
 */

import type { ElementId } from './Elements';

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
  | 'cookedFish'
  | 'flint'
  | 'flintAxe'
  | 'mushroom'
  | 'medkit'
  | 'cannedFood'
  | 'waterBottle'
  | 'bottle'
  | 'painkillers'
  | 'machete'
  | 'flashlight'
  | 'battery'
  | 'jacket'
  | 'watch'
  | 'lampOil'
  | 'molotov'
  | 'enginePart'
  | 'documents'
  | 'bone'
  | 'boneClub'
  | 'fireArrow'
  | 'boneArmor'
  | 'jerky'
  | 'stew'
  | 'baseballBat'
  | 'pipeWrench'
  | 'crowbar'
  | 'sledgehammer'
  | 'kitchenKnife'
  | 'fireAxe'
  | 'sabre'
  | 'modFire'
  | 'modShock'
  | 'modCaustic'
  | 'modBleed'
  | 'pistol'
  | 'revolver'
  | 'shotgun'
  | 'huntingRifle'
  | 'pistolAmmo'
  | 'shells'
  | 'rifleAmmo'
  | 'katana'
  | 'cleaver'
  | 'golfClub'
  | 'baton'
  | 'pitchfork'
  | 'nailBat'
  | 'shockBar'
  | 'nails'
  | 'pipeBomb'
  | 'moonflower';

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
  /** Wuchtwaffen: betäubt getroffene Gegner so viele Sekunden. */
  stun?: number;
  /** Waffenklasse (Nahkampfwaffen mit Seltenheit): Klinge schneidet, Stumpf zerschmettert, Schwer wirft um. */
  weaponClass?: 'blade' | 'blunt' | 'heavy';
  /** Schwere Waffe mit Schneide (Feuerwehraxt): trennt wie eine Klinge Gliedmaßen ab. */
  edge?: boolean;
}

/** Trennt die Waffe Gliedmaßen ab? (Klingen und Äxte im Hieb, nicht im Stoß.) */
export const cutsLimbs = (t: ToolStats): boolean => (t.weaponClass === 'blade' || t.edge === true) && t.animation === 'swing';

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
  /** Arznei statt Essen (eigener Klang und Hinweis). */
  medicine?: boolean;
  /** Beruhigt: senkt die Furcht um diesen Betrag (0..1). */
  calm?: number;
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

/** Schusswaffe: Linksklick schießt, Rechtsklick zielt über Kimme und Korn, R lädt nach. */
export interface GunStats {
  ammo: ItemId;
  magazine: number;
  /** Schaden je Kugel bzw. Schrotkorn. */
  damage: number;
  /** Schrotkörner je Schuss (1 = Kugel). */
  pellets: number;
  /** Streuung aus der Hüfte (rad); beim Zielen deutlich weniger. */
  spread: number;
  /** Zeit zwischen zwei Schüssen (s). */
  fireTime: number;
  /** Nachladen: ganzes Magazin bzw. – `perShell` – je Patrone. */
  reloadTime: number;
  perShell?: boolean;
  range: number;
  /** Rückstoß: Kamera springt so weit nach oben (rad). */
  recoil: number;
  /** So weit hört man den Schuss (m). */
  noise: number;
  /** Zielen: so stark wird herangezoomt (0..1). */
  zoom: number;
  /** Rückstoß, den Getroffene aus nächster Nähe abbekommen. */
  knockback: number;
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
  use?: 'backpack' | 'clothing' | 'battery' | 'armor';
  /** Leeres Gefäß: am Wasser mit `E` zu diesem Item füllen. */
  fillsTo?: ItemId;
  /** Fernwaffe: Linksklick gedrückt halten zum Spannen, loslassen zum Schießen. */
  ranged?: RangedStats;
  tool?: ToolStats;
  food?: FoodStats;
  light?: HeldLight;
  /** Waffenmod: lädt Treffer mit diesem Element auf (an der Werkbank anbringen). */
  mod?: ElementId;
  gun?: GunStats;
  /** Eingebautes Element (Eigenbauten): wirkt wie ein Mod, solange keiner angebracht ist. */
  builtIn?: ElementId;
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
    description: 'Ein handlicher Stein mit scharfer Kante. Im Schnellzugriff wirft ihn ein Linksklick – der Aufprall lockt Schrate an die Stelle.',
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
  flint: {
    id: 'flint',
    name: 'Feuerstein',
    description: 'Dunkler, glasharter Stein aus den Höhlen. Splittert zu messerscharfen Kanten.',
    category: 'resource',
    maxStack: 20,
  },
  flintAxe: {
    id: 'flintAxe',
    name: 'Feuersteinaxt',
    description: 'Eine Klinge aus geschlagenem Feuerstein. Fällt Bäume fast doppelt so schnell und spaltet Fels mühelos.',
    category: 'tool',
    maxStack: 1,
    durability: 220,
    tool: {
      treeDamage: 44,
      rockYield: 3,
      damage: 36,
      swingTime: 0.68,
      impactAt: 0.43,
      staminaCost: 7,
      reach: 2.8,
      animation: 'swing',
      weaponClass: 'blade',
    },
  },
  mushroom: {
    id: 'mushroom',
    name: 'Leuchtpilz',
    description: 'Wächst nur in der Dunkelheit der Höhlen und schimmert türkis. Essbar, auch roh.',
    category: 'food',
    maxStack: 20,
    food: { hunger: 6, thirst: 2, health: 2 },
  },
  moonflower: {
    id: 'moonflower',
    name: 'Mondblüte',
    description: 'Blüht nur nachts und schimmert wie Mondlicht. Duftet kühl – wer sie isst, wird ruhiger.',
    category: 'food',
    maxStack: 10,
    food: { hunger: 2, thirst: 2, health: 4, calm: 0.35 },
  },
  medkit: {
    id: 'medkit',
    name: 'Verbandszeug',
    description: 'Mullbinden und Salbe aus einer alten Vorratskiste. Linksklick in der Hand oder Rechtsklick: Wunden versorgen.',
    category: 'food',
    maxStack: 5,
    food: { hunger: 0, thirst: 0, health: 45, medicine: true },
  },
  cannedFood: {
    id: 'cannedFood',
    name: 'Konserve',
    description: 'Bohneneintopf, noch luftdicht. Macht ohne Feuer satt – Rechtsklick oder Linksklick in der Hand.',
    category: 'food',
    maxStack: 10,
    food: { hunger: 32, thirst: 4, health: 3 },
  },
  waterBottle: {
    id: 'waterBottle',
    name: 'Wasserflasche',
    description: 'Eine Plastikflasche voll Wasser. Leer lässt sie sich an jedem Gewässer mit E wieder füllen.',
    category: 'food',
    maxStack: 4,
    food: { hunger: 0, thirst: 40, health: 0, leftover: 'bottle' },
  },
  bottle: {
    id: 'bottle',
    name: 'Leere Flasche',
    description: 'In der Hand am Wasser mit E füllen.',
    category: 'tool',
    maxStack: 4,
    fillsTo: 'waterBottle',
  },
  painkillers: {
    id: 'painkillers',
    name: 'Schmerzmittel',
    description: 'Eine angebrochene Packung Tabletten aus der Hausapotheke. Lindert Schmerzen und heilt etwas.',
    category: 'food',
    maxStack: 6,
    food: { hunger: 0, thirst: -2, health: 25, medicine: true },
  },
  machete: {
    id: 'machete',
    name: 'Machete',
    description: 'Eine lange, scharfe Klinge aus einem Geräteschuppen. Schnell und tödlich – für Bäume taugt sie wenig.',
    category: 'tool',
    maxStack: 1,
    durability: 180,
    tool: {
      treeDamage: 12,
      rockYield: 0,
      damage: 48,
      swingTime: 0.48,
      impactAt: 0.4,
      staminaCost: 6,
      reach: 2.6,
      animation: 'swing',
      weaponClass: 'blade',
    },
  },
  flashlight: {
    id: 'flashlight',
    name: 'Taschenlampe',
    description:
      'Heller und weiter als jede Fackel, brennt nicht im Regen ab – aber Kriecher fürchten ihr kaltes Licht nicht. Batterie hält etwa fünf Minuten.',
    category: 'tool',
    maxStack: 1,
    durability: 300,
    light: { color: 0xf4f1e6, intensity: 26, distance: 26 },
  },
  battery: {
    id: 'battery',
    name: 'Batterie',
    description: 'Rechtsklick: lädt die Taschenlampe im Rucksack wieder voll.',
    category: 'resource',
    maxStack: 10,
    use: 'battery',
  },
  jacket: {
    id: 'jacket',
    name: 'Winterjacke',
    description: 'Gefütterte Jacke aus einem Kleiderschrank. Rechtsklick: anziehen – man friert deutlich weniger.',
    category: 'resource',
    maxStack: 1,
    use: 'clothing',
  },
  enginePart: {
    id: 'enginePart',
    name: 'Motorteile',
    description: 'Zündkerzen, eine Benzinpumpe und ein Satz Dichtungen aus dem Maschinenraum der Fähre. Damit könnte ein alter Kutter wieder laufen.',
    category: 'resource',
    maxStack: 1,
  },
  documents: {
    id: 'documents',
    name: 'Forschungsakte',
    description: 'Eine Mappe der Betriebsleitung mit dem Stempel „VERTRAULICH – Projekt Myzel“. Messreihen, Fotos, Namen. Der Beweis, dass sie es wussten.',
    category: 'resource',
    maxStack: 1,
  },
  watch: {
    id: 'watch',
    name: 'Taschenuhr',
    description: 'Eine alte Taschenuhr mit Gravur: „Für Paul, in Liebe – Anne.“ Sie tickt noch.',
    category: 'resource',
    maxStack: 1,
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
    fillsTo: 'bowlWater',
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
      weaponClass: 'blade',
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
      weaponClass: 'blunt',
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
      weaponClass: 'blade',
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
  bone: {
    id: 'bone',
    name: 'Knochen',
    description: 'Schwere Röhrenknochen von erlegtem Wild. Hart wie Stein – gut für Keulen und Rüstungen.',
    category: 'resource',
    maxStack: 20,
  },
  boneClub: {
    id: 'boneClub',
    name: 'Knochenkeule',
    description: 'Ein Hirschknochen, mit Lederriemen an einen Ast gebunden. Langsam und schwer – ein Treffer lässt Schrate taumeln.',
    category: 'tool',
    maxStack: 1,
    durability: 140,
    tool: {
      treeDamage: 5,
      rockYield: 0,
      damage: 44,
      swingTime: 0.78,
      impactAt: 0.5,
      staminaCost: 10,
      reach: 2.4,
      animation: 'swing',
      weaponClass: 'blunt',
      stun: 1.1,
    },
  },
  fireArrow: {
    id: 'fireArrow',
    name: 'Brandpfeil',
    description: 'Ein Pfeil mit ölgetränktem Lappen an der Spitze. Fängt beim Abschuss Feuer und setzt alles in Brand, was er trifft. V wechselt die Munition.',
    category: 'resource',
    maxStack: 15,
  },
  baseballBat: {
    id: 'baseballBat',
    name: 'Baseballschläger',
    description: 'Ein Holzschläger aus einem Kinderzimmer. Handlich und solide – zertrümmert, was ihm in den Weg kommt.',
    category: 'tool',
    maxStack: 1,
    durability: 160,
    tool: {
      treeDamage: 3,
      rockYield: 0,
      damage: 40,
      swingTime: 0.6,
      impactAt: 0.45,
      staminaCost: 8,
      reach: 2.6,
      animation: 'swing',
      stun: 0.45,
      weaponClass: 'blunt',
    },
  },
  pipeWrench: {
    id: 'pipeWrench',
    name: 'Rohrzange',
    description: 'Schwere Rohrzange aus dem Werkzeugkasten. Kurz, schnell und unverwüstlich.',
    category: 'tool',
    maxStack: 1,
    durability: 230,
    tool: {
      treeDamage: 2,
      rockYield: 0,
      damage: 34,
      swingTime: 0.5,
      impactAt: 0.42,
      staminaCost: 6,
      reach: 2.3,
      animation: 'swing',
      stun: 0.35,
      weaponClass: 'blunt',
    },
  },
  crowbar: {
    id: 'crowbar',
    name: 'Brechstange',
    description: 'Eine rot lackierte Brechstange. Bricht Kisten auf – und Schädel.',
    category: 'tool',
    maxStack: 1,
    durability: 260,
    tool: {
      treeDamage: 4,
      rockYield: 0.5,
      damage: 38,
      swingTime: 0.55,
      impactAt: 0.44,
      staminaCost: 7,
      reach: 2.5,
      animation: 'swing',
      stun: 0.3,
      weaponClass: 'blunt',
    },
  },
  sledgehammer: {
    id: 'sledgehammer',
    name: 'Vorschlaghammer',
    description: 'Fünf Kilo Stahl am langen Stiel. Langsam und kraftraubend, aber ein Treffer wirft fast alles um. Spaltet auch Felsen.',
    category: 'tool',
    maxStack: 1,
    durability: 200,
    tool: {
      treeDamage: 6,
      rockYield: 2,
      damage: 85,
      swingTime: 1.15,
      impactAt: 0.56,
      staminaCost: 18,
      reach: 2.7,
      animation: 'swing',
      stun: 1.4,
      weaponClass: 'heavy',
    },
  },
  kitchenKnife: {
    id: 'kitchenKnife',
    name: 'Küchenmesser',
    description: 'Ein langes Fleischmesser. Sehr schnell, aber man muss nah heran.',
    category: 'tool',
    maxStack: 1,
    durability: 110,
    tool: {
      treeDamage: 1,
      rockYield: 0,
      damage: 26,
      swingTime: 0.34,
      impactAt: 0.38,
      staminaCost: 4,
      reach: 1.9,
      animation: 'swing',
      weaponClass: 'blade',
    },
  },
  fireAxe: {
    id: 'fireAxe',
    name: 'Feuerwehraxt',
    description: 'Rote Axt mit Spitzhacke aus einem Feuerwehrkasten. Schwer, verheerend – und fällt Bäume im Handumdrehen.',
    category: 'tool',
    maxStack: 1,
    durability: 240,
    tool: {
      treeDamage: 34,
      rockYield: 0,
      damage: 62,
      swingTime: 0.85,
      impactAt: 0.5,
      staminaCost: 13,
      reach: 2.8,
      animation: 'swing',
      stun: 0.6,
      weaponClass: 'heavy',
      edge: true,
    },
  },
  sabre: {
    id: 'sabre',
    name: 'Säbel',
    description: 'Ein alter Kavalleriesäbel mit Messingkorb. Lang, schnell und rasiermesserscharf.',
    category: 'tool',
    maxStack: 1,
    durability: 200,
    tool: {
      treeDamage: 6,
      rockYield: 0,
      damage: 55,
      swingTime: 0.46,
      impactAt: 0.4,
      staminaCost: 7,
      reach: 2.9,
      animation: 'swing',
      weaponClass: 'blade',
    },
  },
  jerky: {
    id: 'jerky',
    name: 'Trockenfleisch',
    description: 'Am Trockengestell zu zähen Streifen getrocknet. Leicht, lange haltbar und ohne Feuer essbar.',
    category: 'food',
    maxStack: 20,
    food: { hunger: 26, thirst: -4, health: 4 },
  },
  stew: {
    id: 'stew',
    name: 'Eintopf',
    description: 'Fleisch, Pilze und Beeren im Kochtopf geschmort. Macht richtig satt, stillt Durst und wärmt von innen.',
    category: 'food',
    maxStack: 1,
    food: { hunger: 55, thirst: 25, health: 18, leftover: 'bowl' },
  },
  boneArmor: {
    id: 'boneArmor',
    name: 'Knochenrüstung',
    description: 'Knochenplatten auf Fell geschnürt. Rechtsklick: anlegen – fängt ein Drittel jedes Treffers ab, klappert aber und macht dich auffälliger.',
    category: 'resource',
    maxStack: 1,
    use: 'armor',
  },
  arrow: {
    id: 'arrow',
    name: 'Pfeil',
    description: 'Angespitzter Stock mit Steinspitze. Steckt nach dem Schuss oft noch im Ziel oder Boden – aufsammeln!',
    category: 'resource',
    maxStack: 30,
  },
  lampOil: {
    id: 'lampOil',
    name: 'Lampenöl',
    description: 'Ein Blechkanister Petroleum aus einem Schuppen. Brennt lange – und in einer Flasche mit Lumpen gefährlich gut.',
    category: 'resource',
    maxStack: 5,
  },
  molotov: {
    id: 'molotov',
    name: 'Brandflasche',
    description:
      'Lampenöl in einer Flasche, ein Lumpen als Docht. Rechtsklick zielen, Linksklick werfen: Sie zerschellt und setzt alles ringsum in Brand.',
    category: 'tool',
    maxStack: 5,
    throwable: { speed: 17, damageMultiplier: 1 },
    tool: {
      treeDamage: 0,
      rockYield: 0,
      damage: 8,
      swingTime: 0.5,
      impactAt: 0.4,
      staminaCost: 4,
      reach: 1.6,
      animation: 'thrust',
    },
  },
  modFire: {
    id: 'modFire',
    name: 'Mod: Brandsatz',
    description: 'Ein ölgetränkter Docht und ein Feuerstein-Zünder für die Klinge. An der Werkbank auf eine Waffe ziehen: Treffer setzen in Brand.',
    category: 'resource',
    maxStack: 3,
    mod: 'fire',
  },
  modShock: {
    id: 'modShock',
    name: 'Mod: Elektrosatz',
    description: 'Zwei Batterien, blanker Draht, ein Fellstück zur Isolierung. An der Werkbank auf eine Waffe ziehen: Treffer lähmen und springen über.',
    category: 'resource',
    maxStack: 3,
    mod: 'shock',
  },
  modCaustic: {
    id: 'modCaustic',
    name: 'Mod: Säuresatz',
    description: 'Eingekochter Pilzsud in einer Flasche – er frisst sich durch Haut und Knochen. An der Werkbank auf eine Waffe ziehen: Treffer verätzen.',
    category: 'resource',
    maxStack: 3,
    mod: 'caustic',
  },
  modBleed: {
    id: 'modBleed',
    name: 'Mod: Widerhaken',
    description: 'Knochen- und Feuersteinsplitter, mit Sehne festgebunden. An der Werkbank auf eine Waffe ziehen: Treffer reißen blutende Wunden.',
    category: 'resource',
    maxStack: 3,
    mod: 'bleed',
  },
  pistol: {
    id: 'pistol',
    name: 'Pistole',
    description: 'Eine 9-mm-Dienstpistole, zwölf Schuss im Magazin. Präzise und schnell – aber jeder Schuss hallt weit über die Insel.',
    category: 'tool',
    maxStack: 1,
    durability: 500,
    gun: { ammo: 'pistolAmmo', magazine: 12, damage: 30, pellets: 1, spread: 0.035, fireTime: 0.22, reloadTime: 1.4, range: 70, recoil: 0.035, noise: 70, zoom: 0.3, knockback: 1 },
  },
  revolver: {
    id: 'revolver',
    name: 'Revolver',
    description: 'Ein schwerer .357er mit Holzgriff. Sechs Schuss, langsam nachzuladen – aber jeder Treffer sitzt.',
    category: 'tool',
    maxStack: 1,
    durability: 450,
    gun: { ammo: 'pistolAmmo', magazine: 6, damage: 62, pellets: 1, spread: 0.03, fireTime: 0.48, reloadTime: 2.3, range: 80, recoil: 0.075, noise: 85, zoom: 0.3, knockback: 2.5 },
  },
  shotgun: {
    id: 'shotgun',
    name: 'Schrotflinte',
    description: 'Eine Vorderschaftrepetierflinte. Aus der Nähe reißt sie Gegner von den Füßen, auf Entfernung verpufft das Schrot.',
    category: 'tool',
    maxStack: 1,
    durability: 300,
    gun: { ammo: 'shells', magazine: 6, damage: 13, pellets: 9, spread: 0.085, fireTime: 0.85, reloadTime: 0.5, perShell: true, range: 30, recoil: 0.11, noise: 95, zoom: 0.2, knockback: 7 },
  },
  huntingRifle: {
    id: 'huntingRifle',
    name: 'Jagdgewehr',
    description: 'Ein Repetierer mit Zielfernrohr aus einer Jagdhütte. Fünf Schuss, wuchtig und weit – zum Zielen Rechtsklick halten.',
    category: 'tool',
    maxStack: 1,
    durability: 350,
    gun: { ammo: 'rifleAmmo', magazine: 5, damage: 115, pellets: 1, spread: 0.06, fireTime: 1.15, reloadTime: 2.6, range: 160, recoil: 0.09, noise: 120, zoom: 0.75, knockback: 4 },
  },
  pistolAmmo: {
    id: 'pistolAmmo',
    name: 'Pistolenmunition',
    description: 'Eine Schachtel 9-mm-Patronen. Passt in Pistole und Revolver.',
    category: 'resource',
    maxStack: 60,
  },
  shells: {
    id: 'shells',
    name: 'Schrotpatronen',
    description: 'Rote Schrotpatronen, Kaliber 12, für die Schrotflinte.',
    category: 'resource',
    maxStack: 30,
  },
  rifleAmmo: {
    id: 'rifleAmmo',
    name: 'Gewehrpatronen',
    description: 'Lange Jagdpatronen für das Jagdgewehr.',
    category: 'resource',
    maxStack: 30,
  },
  katana: {
    id: 'katana',
    name: 'Katana',
    description: 'Ein echtes Katana aus einer Sammlervitrine. Rasiermesserscharf und schnell – trennt mühelos Gliedmaßen ab.',
    category: 'tool',
    maxStack: 1,
    durability: 180,
    tool: {
      treeDamage: 3,
      rockYield: 0,
      damage: 60,
      swingTime: 0.46,
      impactAt: 0.45,
      staminaCost: 8,
      reach: 2.7,
      animation: 'swing',
      weaponClass: 'blade',
    },
  },
  cleaver: {
    id: 'cleaver',
    name: 'Hackbeil',
    description: 'Ein schweres Metzgerbeil. Kurz, aber es geht durch Knochen wie durch Butter.',
    category: 'tool',
    maxStack: 1,
    durability: 150,
    tool: {
      treeDamage: 3,
      rockYield: 0,
      damage: 40,
      swingTime: 0.42,
      impactAt: 0.42,
      staminaCost: 6,
      reach: 1.9,
      animation: 'swing',
      weaponClass: 'blade',
    },
  },
  golfClub: {
    id: 'golfClub',
    name: 'Golfschläger',
    description: 'Ein Eisen 7 aus einem Golfbag. Lang und federnd, der Kopf trifft hart.',
    category: 'tool',
    maxStack: 1,
    durability: 140,
    tool: {
      treeDamage: 1,
      rockYield: 0,
      damage: 34,
      swingTime: 0.5,
      impactAt: 0.45,
      staminaCost: 6,
      reach: 2.7,
      animation: 'swing',
      weaponClass: 'blunt',
    },
  },
  baton: {
    id: 'baton',
    name: 'Schlagstock',
    description: 'Ein Teleskopschlagstock der Polizei. Leicht, schnell und fast unverwüstlich.',
    category: 'tool',
    maxStack: 1,
    durability: 320,
    tool: {
      treeDamage: 1,
      rockYield: 0,
      damage: 26,
      swingTime: 0.36,
      impactAt: 0.4,
      staminaCost: 4,
      reach: 2.2,
      animation: 'swing',
      weaponClass: 'blunt',
    },
  },
  pitchfork: {
    id: 'pitchfork',
    name: 'Mistgabel',
    description: 'Eine Heugabel mit langen Zinken. Hält Gegner auf Abstand – man sticht, statt zu schlagen.',
    category: 'tool',
    maxStack: 1,
    durability: 160,
    tool: {
      treeDamage: 3,
      rockYield: 0,
      damage: 42,
      swingTime: 0.62,
      impactAt: 0.45,
      staminaCost: 7,
      reach: 3.2,
      animation: 'thrust',
      weaponClass: 'blade',
    },
  },
  nailBat: {
    id: 'nailBat',
    name: 'Nagelkeule',
    description: 'Ein Knüppel, gespickt mit krummen Nägeln. Selbst gebaut an der Werkbank – jeder Treffer reißt blutende Wunden.',
    category: 'tool',
    maxStack: 1,
    durability: 170,
    builtIn: 'bleed',
    tool: {
      treeDamage: 1,
      rockYield: 0,
      damage: 42,
      swingTime: 0.58,
      impactAt: 0.45,
      staminaCost: 7,
      reach: 2.5,
      animation: 'swing',
      weaponClass: 'blunt',
    },
  },
  shockBar: {
    id: 'shockBar',
    name: 'Elektrokeule',
    description: 'Ein Brecheisen, mit Kupferdraht an zwei Batterien gekoppelt. Funkt bei jedem Treffer – nasse Gegner zucken besonders schön.',
    category: 'tool',
    maxStack: 1,
    durability: 240,
    builtIn: 'shock',
    tool: {
      treeDamage: 1,
      rockYield: 0,
      damage: 40,
      swingTime: 0.56,
      impactAt: 0.45,
      staminaCost: 7,
      reach: 2.6,
      animation: 'swing',
      weaponClass: 'blunt',
    },
  },
  nails: {
    id: 'nails',
    name: 'Nägel',
    description: 'Eine Handvoll rostiger Nägel aus einer Werkzeugkiste. Für Nagelkeulen und Rohrbomben.',
    category: 'resource',
    maxStack: 50,
  },
  pipeBomb: {
    id: 'pipeBomb',
    name: 'Rohrbombe',
    description:
      'Ein Rohr voll Lampenöl und Nägeln, gezündet über eine Batterie. Linksklick werfen: Sie piept, lockt Schrate an – und geht nach zwei Sekunden hoch.',
    category: 'tool',
    maxStack: 5,
    throwable: { speed: 15, damageMultiplier: 1 },
    tool: {
      treeDamage: 0,
      rockYield: 0,
      damage: 8,
      swingTime: 0.5,
      impactAt: 0.4,
      staminaCost: 4,
      reach: 1.6,
      animation: 'thrust',
    },
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
