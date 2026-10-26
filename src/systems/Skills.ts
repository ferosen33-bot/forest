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

// --- Talente --------------------------------------------------------------------

/** Ab diesen Stufen darf man je Fertigkeit ein Talent wählen (eins von zwei). */
export const PERK_LEVELS = [3, 7] as const;

export type PerkId =
  | 'heavySwing' | 'tireless' | 'lumberjack' | 'quietAxe'
  | 'quarry' | 'pebbles' | 'flintEye' | 'firekeeper'
  | 'brute' | 'parry' | 'stagger' | 'bloodlust'
  | 'steadyHand' | 'recover' | 'headhunter' | 'pyro'
  | 'shadow' | 'lure' | 'assassin' | 'silent'
  | 'frugal' | 'hardy' | 'hunter' | 'cook'
  | 'careful' | 'trapper' | 'builder' | 'autoTrap'
  | 'runner' | 'swimmer' | 'tough' | 'climber';

export interface PerkDef {
  id: PerkId;
  skill: SkillId;
  /** 0 = ab Stufe 3, 1 = ab Stufe 7. */
  tier: 0 | 1;
  name: string;
  text: string;
}

const perk = (skill: SkillId, tier: 0 | 1, id: PerkId, name: string, text: string): PerkDef => ({ id, skill, tier, name, text });

export const PERKS: PerkDef[] = [
  perk('woodcutting', 0, 'heavySwing', 'Kraftschlag', '+20 % Schaden an Bäumen'),
  perk('woodcutting', 0, 'tireless', 'Unermüdlich', 'Schläge mit Werkzeug und Waffe kosten 30 % weniger Ausdauer'),
  perk('woodcutting', 1, 'lumberjack', 'Holzfäller', 'Jeder gefällte Baum gibt einen Stamm mehr'),
  perk('woodcutting', 1, 'quietAxe', 'Leise Axt', 'Hacken und Fällen sind nur halb so weit zu hören'),
  perk('mining', 0, 'quarry', 'Steinbrecher', '+25 % Ausbeute an Felsen'),
  perk('mining', 0, 'pebbles', 'Kieselsammler', 'Vom Boden aufgelesene Steine und Stöcke zählen doppelt'),
  perk('mining', 1, 'flintEye', 'Feuersteinkenner', '+50 % Ausbeute an Feuersteinadern'),
  perk('mining', 1, 'firekeeper', 'Feuerhüter', 'Lagerfeuer und Fackeln trotzen dem Regen doppelt so lange'),
  perk('melee', 0, 'brute', 'Wucht', '+15 % Nahkampfschaden'),
  perk('melee', 0, 'parry', 'Parade', 'Blocken fängt 90 % statt 80 % ab und kostet halb so viel Ausdauer'),
  perk('melee', 1, 'stagger', 'Taumelschlag', 'Jeder Nahkampftreffer lässt Gegner kurz taumeln'),
  perk('melee', 1, 'bloodlust', 'Blutrausch', 'Jeder erlegte Gegner gibt dir 12 Gesundheit zurück'),
  perk('archery', 0, 'steadyHand', 'Ruhige Hand', '−25 % Spannzeit'),
  perk('archery', 0, 'recover', 'Sorgsamer Schütze', 'Pfeile brechen nie'),
  perk('archery', 1, 'headhunter', 'Kopfjäger', 'Kopftreffer mit Pfeil und Speer richten 50 % mehr Schaden an'),
  perk('archery', 1, 'pyro', 'Zündler', 'Brandpfeile und Brandflaschen entfachen größere Feuer'),
  perk('stealth', 0, 'shadow', 'Schattengänger', '−20 % Sichtbarkeit'),
  perk('stealth', 0, 'lure', 'Lockruf', 'Geworfene Steine locken Gegner aus doppelter Entfernung an'),
  perk('stealth', 1, 'assassin', 'Meuchler', 'Schleichangriffe richten 50 % mehr Schaden an'),
  perk('stealth', 1, 'silent', 'Lautlos', '−40 % Geräusche beim Gehen und Rennen'),
  perk('survival', 0, 'frugal', 'Genügsam', '−15 % Hunger und Durst'),
  perk('survival', 0, 'hardy', 'Abgehärtet', 'Kälte und Nässe schaden nur halb so viel'),
  perk('survival', 1, 'hunter', 'Jäger', 'Ausnehmen gibt ein Stück Fleisch und ein Fell mehr'),
  perk('survival', 1, 'cook', 'Feldkoch', 'Gebratenes, Trockenfleisch und Eintopf machen 50 % satter'),
  perk('crafting', 0, 'careful', 'Sorgfalt', '+20 % Haltbarkeit hergestellter Werkzeuge'),
  perk('crafting', 0, 'trapper', 'Fallensteller', 'Fallen und Stachelwände richten 50 % mehr Schaden an'),
  perk('crafting', 1, 'builder', 'Baumeister', 'Bauwerke nehmen durch Gegner ein Drittel weniger Schaden'),
  perk('crafting', 1, 'autoTrap', 'Selbstspanner', 'Schlingfallen und Fallgruben spannen sich nach einer Minute selbst neu'),
  perk('athletics', 0, 'runner', 'Läufer', '+12 % Sprinttempo'),
  perk('athletics', 0, 'swimmer', 'Schwimmer', 'Schwimmen kostet halb so viel Ausdauer, auch im offenen Meer'),
  perk('athletics', 1, 'tough', 'Zäh', '−20 % Schaden durch Gegner'),
  perk('athletics', 1, 'climber', 'Kletterer', 'Fallschaden erst aus größerer Höhe, Seilklettern doppelt so schnell'),
];

const PERK_BY_ID = new Map(PERKS.map((p) => [p.id, p]));
export const getPerk = (id: PerkId): PerkDef => PERK_BY_ID.get(id)!;
export const isPerkId = (id: string): id is PerkId => PERK_BY_ID.has(id as PerkId);

export class Skills {
  private readonly xp = new Map<SkillId, number>();
  private readonly perks = new Set<PerkId>();

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

  // --- Talente -------------------------------------------------------------------

  has(id: PerkId): boolean {
    return this.perks.has(id);
  }

  /** Gewähltes Talent einer Stufe (oder null). */
  chosen(skill: SkillId, tier: 0 | 1): PerkId | null {
    for (const p of this.perks) {
      const def = getPerk(p);
      if (def.skill === skill && def.tier === tier) return p;
    }
    return null;
  }

  /** Darf dieses Talent jetzt gewählt werden? (Stufe erreicht, auf dieser Stufe noch keins gewählt.) */
  canChoose(id: PerkId): boolean {
    const def = getPerk(id);
    return this.level(def.skill) >= PERK_LEVELS[def.tier] && this.chosen(def.skill, def.tier) === null;
  }

  choose(id: PerkId): boolean {
    if (!this.canChoose(id)) return false;
    this.perks.add(id);
    this.events?.emit('skill:perk', { id });
    return true;
  }

  /** Wie viele Talente gerade zur Wahl stehen. */
  get openChoices(): number {
    let n = 0;
    for (const s of SKILLS) for (const tier of [0, 1] as const) if (this.level(s.id) >= PERK_LEVELS[tier] && this.chosen(s.id, tier) === null) n++;
    return n;
  }

  serializePerks(): PerkId[] {
    return [...this.perks];
  }

  loadPerks(data: unknown): void {
    this.perks.clear();
    if (!Array.isArray(data)) return;
    for (const id of data) if (typeof id === 'string' && isPerkId(id) && this.chosen(getPerk(id).skill, getPerk(id).tier) === null) this.perks.add(id);
  }

  // --- Wirkungen -----------------------------------------------------------------

  /** Schaden an Bäumen. */
  get treeDamage(): number {
    return (1 + 0.06 * this.level('woodcutting')) * (this.has('heavySwing') ? 1.2 : 1);
  }
  /** Ausbeute an Felsen. */
  get rockYield(): number {
    return (1 + 0.06 * this.level('mining')) * (this.has('quarry') ? 1.25 : 1);
  }
  /** Ausbeute an Feuersteinadern. */
  get flintYield(): number {
    return this.rockYield * (this.has('flintEye') ? 1.5 : 1);
  }
  get meleeDamage(): number {
    return (1 + 0.05 * this.level('melee')) * (this.has('brute') ? 1.15 : 1);
  }
  get meleeStamina(): number {
    return (1 - 0.03 * this.level('melee')) * (this.has('tireless') ? 0.7 : 1);
  }
  get rangedDamage(): number {
    return 1 + 0.05 * this.level('archery');
  }
  get drawTime(): number {
    return (1 - 0.035 * this.level('archery')) * (this.has('steadyHand') ? 0.75 : 1);
  }
  get noise(): number {
    return (1 - 0.05 * this.level('stealth')) * (this.has('silent') ? 0.6 : 1);
  }
  get visibility(): number {
    return (1 - 0.035 * this.level('stealth')) * (this.has('shadow') ? 0.8 : 1);
  }
  get needs(): number {
    return (1 - 0.035 * this.level('survival')) * (this.has('frugal') ? 0.85 : 1);
  }
  get craftedDurability(): number {
    return (1 + 0.06 * this.level('crafting')) * (this.has('careful') ? 1.2 : 1);
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
