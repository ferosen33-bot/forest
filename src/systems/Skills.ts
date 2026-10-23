import type { EventBus } from '../core/EventBus';

/**
 * Fertigkeiten, die durch Tun wachsen (wie in Skyrim): Wer viele Bäume fällt, fällt sie schneller;
 * wer viel schleicht, schleicht leiser. Jede Fertigkeit hat Stufen 0–10. Erfahrung bringt jede
 * passende Handlung; die Wirkung je Stufe liefern die Multiplikatoren unten.
 */

export type SkillId = 'woodcutting' | 'mining' | 'melee' | 'archery' | 'stealth' | 'survival' | 'crafting' | 'athletics';

export interface SkillDef {
  id: SkillId;
  name: string;
  /** Wie man sie verbessert. */
  how: string;
  /** Wirkung in Worten (für Stufe `level`). */
  effect: (level: number) => string;
}

export const MAX_SKILL_LEVEL = 10;

const pct = (x: number) => `${Math.round(x * 100)} %`;

export const SKILLS: SkillDef[] = [
  { id: 'woodcutting', name: 'Holzfällen', how: 'Bäume fällen', effect: (l) => `+${pct(0.06 * l)} Schaden an Bäumen` },
  { id: 'mining', name: 'Steinmetz', how: 'Steine und Feuerstein abschlagen', effect: (l) => `+${pct(0.06 * l)} Ausbeute an Felsen` },
  { id: 'melee', name: 'Nahkampf', how: 'Gegner und Tiere mit Waffen treffen', effect: (l) => `+${pct(0.05 * l)} Schaden, −${pct(0.03 * l)} Ausdauer je Schlag` },
  { id: 'archery', name: 'Bogenschießen', how: 'mit Pfeilen und Speeren treffen', effect: (l) => `+${pct(0.05 * l)} Schaden, −${pct(0.035 * l)} Spannzeit` },
  { id: 'stealth', name: 'Schleichen', how: 'geduckt nahe an Gegnern bleiben, Schleichangriffe', effect: (l) => `−${pct(0.05 * l)} Geräusche, −${pct(0.035 * l)} Sichtbarkeit` },
  { id: 'survival', name: 'Überleben', how: 'kochen, angeln, ausnehmen, plündern, schlafen', effect: (l) => `−${pct(0.035 * l)} Hunger und Durst` },
  { id: 'crafting', name: 'Handwerk', how: 'Werkzeuge herstellen und bauen', effect: (l) => `+${pct(0.06 * l)} Haltbarkeit hergestellter Werkzeuge` },
  { id: 'athletics', name: 'Ausdauer', how: 'rennen, springen, schwimmen', effect: (l) => `−${pct(0.04 * l)} Ausdauerverbrauch, +${pct(0.03 * l)} Erholung` },
];

const BY_ID = new Map(SKILLS.map((s) => [s.id, s]));
export const getSkill = (id: SkillId): SkillDef => BY_ID.get(id)!;
export const isSkillId = (id: string): id is SkillId => BY_ID.has(id as SkillId);

/** Erfahrung für den Schritt von `level` auf `level + 1`. */
export const xpForNext = (level: number): number => 20 + 15 * level;

/** Gesamterfahrung bis zum Erreichen von `level`. */
export function xpToReach(level: number): number {
  let sum = 0;
  for (let l = 0; l < level; l++) sum += xpForNext(l);
  return sum;
}

export type SkillsSave = Partial<Record<SkillId, number>>;

export class Skills {
  private readonly xp = new Map<SkillId, number>();

  constructor(private readonly events?: EventBus) {}

  experience(id: SkillId): number {
    return this.xp.get(id) ?? 0;
  }

  level(id: SkillId): number {
    const xp = this.experience(id);
    let l = 0;
    while (l < MAX_SKILL_LEVEL && xp >= xpToReach(l + 1)) l++;
    return l;
  }

  /** Fortschritt zur nächsten Stufe in [0, 1] (1 auf der Höchststufe). */
  progress(id: SkillId): number {
    const l = this.level(id);
    if (l >= MAX_SKILL_LEVEL) return 1;
    return (this.experience(id) - xpToReach(l)) / xpForNext(l);
  }

  /** Erfahrung sammeln; meldet Stufenaufstiege. */
  gain(id: SkillId, amount: number): void {
    if (amount <= 0) return;
    const before = this.level(id);
    this.xp.set(id, Math.min(xpToReach(MAX_SKILL_LEVEL), this.experience(id) + amount));
    const after = this.level(id);
    if (after > before) this.events?.emit('skill:levelUp', { id, level: after });
  }

  // --- Wirkungen -----------------------------------------------------------------

  /** Schaden an Bäumen. */
  get treeDamage(): number {
    return 1 + 0.06 * this.level('woodcutting');
  }
  /** Ausbeute an Felsen. */
  get rockYield(): number {
    return 1 + 0.06 * this.level('mining');
  }
  get meleeDamage(): number {
    return 1 + 0.05 * this.level('melee');
  }
  get meleeStamina(): number {
    return 1 - 0.03 * this.level('melee');
  }
  get rangedDamage(): number {
    return 1 + 0.05 * this.level('archery');
  }
  get drawTime(): number {
    return 1 - 0.035 * this.level('archery');
  }
  get noise(): number {
    return 1 - 0.05 * this.level('stealth');
  }
  get visibility(): number {
    return 1 - 0.035 * this.level('stealth');
  }
  get needs(): number {
    return 1 - 0.035 * this.level('survival');
  }
  get craftedDurability(): number {
    return 1 + 0.06 * this.level('crafting');
  }
  get staminaUse(): number {
    return 1 - 0.04 * this.level('athletics');
  }
  get staminaRegen(): number {
    return 1 + 0.03 * this.level('athletics');
  }

  serialize(): SkillsSave {
    return Object.fromEntries(this.xp) as SkillsSave;
  }

  load(data: SkillsSave): void {
    this.xp.clear();
    for (const [id, xp] of Object.entries(data ?? {})) {
      if (isSkillId(id) && Number.isFinite(xp)) this.xp.set(id, Math.max(0, Math.min(xpToReach(MAX_SKILL_LEVEL), xp as number)));
    }
  }
}

/**
 * Welche Handlung wie viel Erfahrung bringt – an Spielereignisse gekoppelt.
 * (Treffer mit Waffen, Bewegung und Schleichen meldet das Spiel direkt über `gain`.)
 */
export function wireSkillEvents(skills: Skills, events: EventBus): void {
  events.on('tool:hit', ({ target }) => {
    if (target === 'tree') skills.gain('woodcutting', 1);
    else if (target === 'rock') skills.gain('mining', 1.2);
  });
  events.on('tree:felled', () => skills.gain('woodcutting', 6));
  events.on('enemy:hit', ({ sneak, killed }) => {
    if (sneak) skills.gain('stealth', killed ? 14 : 8);
  });
  events.on('food:cooked', ({ count }) => skills.gain('survival', 2 * count));
  events.on('fish:caught', ({ count }) => skills.gain('survival', 4 * count));
  events.on('player:slept', () => skills.gain('survival', 5));
  events.on('loot:searched', () => skills.gain('survival', 0.8));
  events.on('world:event', ({ phase }) => phase === 'looted' && skills.gain('survival', 3));
  events.on('item:collected', ({ item, count }) => {
    if (item === 'rawMeat' || item === 'hide') skills.gain('survival', count);
  });
  events.on('item:crafted', () => skills.gain('crafting', 4));
  events.on('structure:placed', () => skills.gain('crafting', 5));
}
