/**
 * Zerstückelung: welche Gliedmaße ein Treffer abtrennt und wie sich der Gegner danach bewegt.
 * Reine Logik – die Darstellung steckt in `EnemyAvatars` (Knochen), das Fliegen der Teile in `systems/Gore.ts`.
 */

export type Limb = 'head' | 'armL' | 'armR' | 'legL' | 'legR';

export const LIMBS: Limb[] = ['head', 'armL', 'armR', 'legL', 'legR'];

/** Knochen der Figuren: wo geschnitten wird (`low` am Ellbogen/Knie, `high` an Schulter/Hüfte) und das Ende. */
export const LIMB_BONES: Record<Limb, { high: string; low: string; end: string }> = {
  head: { high: 'head', low: 'head', end: 'head_leaf' },
  armL: { high: 'upperarm_l', low: 'lowerarm_l', end: 'hand_l' },
  armR: { high: 'upperarm_r', low: 'lowerarm_r', end: 'hand_r' },
  legL: { high: 'thigh_l', low: 'calf_l', end: 'foot_l' },
  legR: { high: 'thigh_r', low: 'calf_r', end: 'foot_r' },
};

export const isLeg = (l: Limb): boolean => l === 'legL' || l === 'legR';
export const isArm = (l: Limb): boolean => l === 'armL' || l === 'armR';

/** Wie die Waffe trifft: schneidend (Klingen, Äxte) oder zermalmend (Schläger, Hämmer, Tritte). */
export interface GoreHit {
  cut: boolean;
  /** Schwerer Schlag (0 = normal, 0,5 … 1). */
  heavy: number;
  /** Tatsächlicher Schaden relativ zu den vollen Lebenspunkten. */
  fraction: number;
  killed: boolean;
  headshot: boolean;
}

/**
 * Chance, dass der Treffer etwas abtrennt (Klingen) bzw. den Schädel zertrümmert (Wuchtwaffen, nur beim
 * tödlichen Kopftreffer). Lebende verlieren nur bei wuchtigen Hieben Gliedmaßen.
 */
export function severChance(hit: GoreHit, limb: Limb): number {
  if (limb === 'head') {
    if (!hit.killed) return 0;
    if (hit.cut) return hit.headshot ? 0.85 : 0.55 + 0.35 * hit.heavy;
    return hit.headshot ? 0.45 + 0.55 * hit.heavy : 0;
  }
  if (!hit.cut) return 0;
  if (hit.killed) return 0.65 + 0.3 * hit.heavy;
  // Am Leben: nur, wenn der Hieb ein gutes Stück der Lebenspunkte kostet.
  return hit.fraction >= 0.3 ? 0.3 + 0.4 * hit.heavy : hit.heavy >= 1 ? 0.25 : 0;
}

/** Schaden des Gegners, wenn ihm Arme fehlen (einarmig schlägt er schwächer, armlos beißt er nur). */
export function armFactor(severed: ReadonlySet<Limb>): number {
  const missing = (severed.has('armL') ? 1 : 0) + (severed.has('armR') ? 1 : 0);
  return missing === 0 ? 1 : missing === 1 ? 0.6 : 0.3;
}

/** Ohne Bein kriecht er: so viel langsamer. */
export const CRAWL_SPEED = 0.38;
