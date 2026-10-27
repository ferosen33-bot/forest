import { getItem, type GunStats, type ItemId, type ToolStats } from './ItemDefs';
import { isElementId, type ElementId } from './Elements';

/**
 * Waffen mit Seltenheit und Perks: Jede gefundene Waffe ist ein Einzelstück. Höhere Seltenheit bringt
 * mehr Schaden, mehr Haltbarkeit und Platz für Perks; ab „Ungewöhnlich“ lässt sich an der Werkbank ein
 * Mod mit einem Element anbringen (siehe `Elements.ts`). Werkzeuge ohne Kampfwert (Taschenlampe, Fackel, Angel) bleiben außen vor.
 */

export type RarityId = 'common' | 'uncommon' | 'rare' | 'superior' | 'legendary';

export interface RarityDef {
  id: RarityId;
  name: string;
  /** Farbe für Namen, Rahmen und Anzeige. */
  color: string;
  damage: number;
  durability: number;
  perkSlots: number;
  /** Wahrscheinlichkeitsgewicht beim Würfeln (Grundwert). */
  weight: number;
}

export const RARITIES: RarityDef[] = [
  { id: 'common', name: 'Gewöhnlich', color: '#cfc8b8', damage: 1, durability: 1, perkSlots: 0, weight: 52 },
  { id: 'uncommon', name: 'Ungewöhnlich', color: '#6fcf58', damage: 1.12, durability: 1.15, perkSlots: 1, weight: 28 },
  { id: 'rare', name: 'Selten', color: '#4f9ef0', damage: 1.25, durability: 1.3, perkSlots: 1, weight: 13 },
  { id: 'superior', name: 'Überragend', color: '#b46cf0', damage: 1.4, durability: 1.5, perkSlots: 2, weight: 5.5 },
  { id: 'legendary', name: 'Legendär', color: '#f2a03a', damage: 1.6, durability: 1.8, perkSlots: 3, weight: 1.5 },
];
const RARITY_BY_ID = new Map(RARITIES.map((r) => [r.id, r]));
export const getRarity = (id: RarityId): RarityDef => RARITY_BY_ID.get(id) ?? RARITIES[0];
export const isRarityId = (id: unknown): id is RarityId => typeof id === 'string' && RARITY_BY_ID.has(id as RarityId);

export type WeaponPerkId = 'brutal' | 'balanced' | 'swift' | 'sturdy' | 'precise' | 'crushing' | 'bloodthirst';

export interface WeaponPerkDef {
  id: WeaponPerkId;
  name: string;
  text: string;
}

export const WEAPON_PERKS: WeaponPerkDef[] = [
  { id: 'brutal', name: 'Wucht', text: '+15 % Schaden' },
  { id: 'balanced', name: 'Ausgewogen', text: '−25 % Ausdauer je Schlag' },
  { id: 'swift', name: 'Flink', text: '+15 % Schlagtempo' },
  { id: 'sturdy', name: 'Robust', text: '+40 % Haltbarkeit' },
  { id: 'precise', name: 'Präzise', text: '+12 % Chance auf kritische Treffer' },
  { id: 'crushing', name: 'Niederschmetternd', text: 'Getroffene taumeln länger' },
  { id: 'bloodthirst', name: 'Blutdurst', text: 'Jeder Treffer heilt 3 Gesundheit' },
];
const PERK_BY_ID = new Map(WEAPON_PERKS.map((p) => [p.id, p]));
export const getWeaponPerk = (id: WeaponPerkId): WeaponPerkDef => PERK_BY_ID.get(id)!;
const isWeaponPerkId = (id: unknown): id is WeaponPerkId => typeof id === 'string' && PERK_BY_ID.has(id as WeaponPerkId);

/** Eigenschaften einer einzelnen Waffe (liegt am Inventar-Stapel, am Item in der Welt und im Spielstand). */
export interface WeaponMeta {
  rarity: RarityId;
  perks: WeaponPerkId[];
  /** Angebrachter Mod: Treffer tragen dieses Element. */
  mod?: ElementId;
  /** Schusswaffen: Patronen im Magazin (fehlt = voll). */
  loaded?: number;
}

/** Ist das Item eine Waffe mit Seltenheit (Nahkampf oder Schusswaffe)? */
export function isWeapon(id: ItemId): boolean {
  const def = getItem(id);
  return def.tool?.weaponClass !== undefined || def.gun !== undefined;
}

/** Werte einer Schusswaffe samt Seltenheit und Perks. */
export function gunStats(id: ItemId, meta?: WeaponMeta): { gun: GunStats; crit: number; heal: number } {
  const base = getItem(id).gun!;
  const rarity = getRarity(meta?.rarity ?? 'common');
  const has = (p: WeaponPerkId) => meta?.perks.includes(p) ?? false;
  return {
    gun: {
      ...base,
      damage: base.damage * rarity.damage * (has('brutal') ? 1.15 : 1),
      fireTime: base.fireTime / (has('swift') ? 1.15 : 1),
      // Ausgewogen: weniger Rückstoß; Niederschmetternd: wirft stärker zurück.
      recoil: base.recoil * (has('balanced') ? 0.7 : 1),
      knockback: base.knockback * (has('crushing') ? 1.5 : 1),
    },
    crit: BASE_CRIT + (has('precise') ? 0.12 : 0) + (rarity.id === 'legendary' ? 0.05 : 0),
    heal: has('bloodthirst') ? 3 : 0,
  };
}

/** Patronen im Magazin. */
export const loadedRounds = (id: ItemId, meta?: WeaponMeta): number => meta?.loaded ?? getItem(id).gun?.magazine ?? 0;

/** Grundchance auf einen kritischen Treffer. */
export const BASE_CRIT = 0.08;
/** Schadensfaktor eines kritischen Treffers. */
export const CRIT_MULTIPLIER = 1.8;

export interface WeaponStats {
  tool: ToolStats;
  maxDurability: number | undefined;
  crit: number;
  /** Zusätzliche Betäubung je Treffer (s). */
  stagger: number;
  /** Heilung je Treffer. */
  heal: number;
}

/** Werte einer Waffe samt Seltenheit und Perks (ohne Fertigkeiten des Spielers). */
export function weaponStats(id: ItemId, meta?: WeaponMeta): WeaponStats {
  const def = getItem(id);
  const base = def.tool!;
  const rarity = getRarity(meta?.rarity ?? 'common');
  const has = (p: WeaponPerkId) => meta?.perks.includes(p) ?? false;
  const tool: ToolStats = {
    ...base,
    damage: base.damage * rarity.damage * (has('brutal') ? 1.15 : 1),
    treeDamage: base.treeDamage * (1 + (rarity.damage - 1) * 0.5),
    staminaCost: base.staminaCost * (has('balanced') ? 0.75 : 1),
    swingTime: base.swingTime / (has('swift') ? 1.15 : 1),
  };
  return {
    tool,
    maxDurability: maxDurability(id, meta),
    crit: BASE_CRIT + (has('precise') ? 0.12 : 0) + (rarity.id === 'legendary' ? 0.05 : 0),
    stagger: has('crushing') ? 0.5 : 0,
    heal: has('bloodthirst') ? 3 : 0,
  };
}

/** Volle Haltbarkeit eines Items (Seltenheit und „Robust“ eingerechnet). */
export function maxDurability(id: ItemId, meta?: WeaponMeta): number | undefined {
  const base = getItem(id).durability;
  if (base === undefined) return undefined;
  if (!meta) return base;
  return Math.round(base * getRarity(meta.rarity).durability * (meta.perks.includes('sturdy') ? 1.4 : 1));
}

/** Würfelt Seltenheit und Perks. `luck` > 0 verschiebt die Gewichte zu seltenen Stufen. */
export function rollWeapon(rng: () => number = Math.random, luck = 0): WeaponMeta {
  const weights = RARITIES.map((r, i) => r.weight * Math.pow(1 + luck, i));
  let t = rng() * weights.reduce((a, b) => a + b, 0);
  let rarity = RARITIES[0];
  for (let i = 0; i < RARITIES.length; i++) {
    t -= weights[i];
    if (t <= 0) {
      rarity = RARITIES[i];
      break;
    }
  }
  return { rarity: rarity.id, perks: rollPerks(rarity, rng) };
}

/** Eine Waffe bestimmter Seltenheit (z. B. Belohnungen). */
export function weaponOf(rarity: RarityId, rng: () => number = Math.random): WeaponMeta {
  return { rarity, perks: rollPerks(getRarity(rarity), rng) };
}

function rollPerks(rarity: RarityDef, rng: () => number): WeaponPerkId[] {
  const pool = WEAPON_PERKS.map((p) => p.id);
  const perks: WeaponPerkId[] = [];
  for (let i = 0; i < rarity.perkSlots && pool.length; i++) perks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return perks;
}

/** Anzeigename: legendäre Waffen tragen einen Beinamen. */
export function weaponName(id: ItemId, meta?: WeaponMeta): string {
  const name = getItem(id).name;
  if (meta?.rarity !== 'legendary') return name;
  return `${name} „${LEGENDARY_EPITHETS[hash(id) % LEGENDARY_EPITHETS.length]}“`;
}

const LEGENDARY_EPITHETS = ['Witwenmacher', 'Totenglocke', 'Inselfluch', 'Letzte Ruhe', 'Knochenbrecher', 'Schratenschreck'];
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Bereinigt Daten aus Spielständen. */
export function sanitizeWeapon(data: unknown): WeaponMeta | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Partial<WeaponMeta>;
  if (!isRarityId(d.rarity)) return undefined;
  const perks = Array.isArray(d.perks) ? d.perks.filter(isWeaponPerkId).slice(0, 3) : [];
  const loaded = typeof d.loaded === 'number' && Number.isFinite(d.loaded) ? Math.max(0, Math.floor(d.loaded)) : undefined;
  return { rarity: d.rarity, perks, ...(isElementId(d.mod) ? { mod: d.mod } : {}), ...(loaded !== undefined ? { loaded } : {}) };
}

/** Mods passen erst ab „Ungewöhnlich“. */
export const canMod = (w: WeaponMeta | undefined): boolean => !!w && w.rarity !== 'common';

export const cloneWeapon = (w: WeaponMeta | undefined): WeaponMeta | undefined => (w ? { ...w, perks: [...w.perks] } : undefined);
