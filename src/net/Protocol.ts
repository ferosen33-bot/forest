import type { ItemId } from '../entities/items/ItemDefs';
import type { WeatherSave } from '../systems/Weather';
import type { EnemyKind } from '../entities/enemies/EnemyKinds';
import type { EnemyState } from '../entities/enemies/Enemy';
import type { Limb } from '../entities/enemies/Gore';

/**
 * Koop (Meilenstein 61): Nachrichten zwischen Gastgeber und Mitspielern. Alles läuft über den
 * Gastgeber (Stern): Er rechnet Gegner, Tageszeit und Wetter und verteilt den Zustand; jeder Spieler
 * steuert nur seine eigene Figur und meldet Treffer an den Gastgeber.
 */

/** Wird erhöht, wenn sich das Format ändert (ältere Spielstände der anderen Seite werden abgewiesen). */
export const PROTOCOL = 1;
export const MAX_PLAYERS = 4;

/** Ein Spieler, wie die anderen ihn sehen. */
export interface PlayerState {
  id: string;
  name: string;
  /** Fußposition. */
  p: [number, number, number];
  yaw: number;
  pitch: number;
  /** Waagerechte Geschwindigkeit (m/s) – fürs Gehen/Rennen der Figur. */
  speed: number;
  crouch: boolean;
  /** Gegenstand in der Hand. */
  item: ItemId | null;
  /** Zählt Schläge/Schüsse hoch – die anderen spielen bei jeder Änderung einen Hieb ab. */
  swings: number;
  /** Lebenspunkte 0..1. */
  hp: number;
  dead: boolean;
  /** In einer Höhle (für die anderen verschwunden). */
  hidden: boolean;
}

/** Gegner, wie der Gastgeber ihn meldet. */
export interface EnemyNet {
  id: number;
  kind: EnemyKind;
  p: [number, number, number];
  yaw: number;
  state: EnemyState;
  speed: number;
  attack: number;
  alert: number;
  down: number;
  rise: number;
  /** Treffer bisher (bei jeder Änderung zuckt das Abbild). */
  hits: number;
  health: number;
  maxHealth: number;
  tone: number;
  scale: number;
  frozen: boolean;
  severed: Limb[];
}

/** Treffer eines Mitspielers auf einen Gegner. */
export type RemoteHit =
  | { op: 'damage'; amount: number; from: [number, number, number]; flinch: boolean }
  | { op: 'knockdown'; seconds: number; from: [number, number, number]; force: number }
  | { op: 'shove'; force: number; seconds: number; from: [number, number, number] }
  | { op: 'stun'; seconds: number }
  | { op: 'sever'; limb: Limb };

export type NetMessage =
  /** Mitspieler → Gastgeber: Anmeldung. */
  | { t: 'hello'; v: number; name: string }
  /** Gastgeber → Mitspieler: angenommen; Insel (Seed) und eigene Kennung. */
  | { t: 'welcome'; v: number; id: string; seed: number; host: string }
  /** Gastgeber → Mitspieler: abgewiesen (voll, andere Version). */
  | { t: 'reject'; reason: string }
  /** Mitspieler → Gastgeber: eigene Figur. */
  | { t: 'state'; s: PlayerState }
  /** Gastgeber → Mitspieler: alle Figuren (auch die des Gastgebers). */
  | { t: 'players'; list: PlayerState[] }
  /** Gastgeber → Mitspieler: Tageszeit und Wetter. */
  | { t: 'world'; day: number; hour: number; weather: WeatherSave }
  /** Gastgeber → Mitspieler: Gegner in der Nähe des Empfängers. */
  | { t: 'enemies'; list: EnemyNet[] }
  /** Mitspieler → Gastgeber: Treffer auf einen Gegner. */
  | { t: 'hit'; enemy: number; hit: RemoteHit }
  /** Gastgeber → Mitspieler: Ein Gegner hat dich getroffen. */
  | { t: 'hurt'; amount: number; from: [number, number, number] }
  /** Gastgeber → Mitspieler: Dein Treffer hat diesen Gegner erledigt. */
  | { t: 'kill'; enemy: number; name: string; boss: boolean; p: [number, number, number]; headshot: boolean }
  /** Hinweis für alle (beigetreten, gegangen …). */
  | { t: 'notice'; text: string };

// ---------------------------------------------------------------------------
// Lobby-Codes
// ---------------------------------------------------------------------------

/** Ohne leicht verwechselbare Zeichen (0/O, 1/I/L). */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export function makeLobbyCode(rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
  return s;
}

/** Bereinigt eine Eingabe (Kleinbuchstaben, Leerzeichen, verwechselte Zeichen); null, wenn ungültig. */
export function normalizeLobbyCode(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    // 0 und 1 kommen in Codes nicht vor: zurück auf die gemeinten Buchstaben.
    .replace(/0/g, 'Q')
    .replace(/1/g, 'J');
  if (s.length !== CODE_LENGTH) return null;
  for (const c of s) if (!CODE_CHARS.includes(c)) return null;
  return s;
}

/** Kennung des Gastgebers beim Vermittlungsserver. */
export function hostPeerId(code: string): string {
  return `wildwood-lobby-${code.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Prüfung eingehender Nachrichten (die Gegenseite ist ein fremdes Programm)
// ---------------------------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;

export function isPlayerState(v: unknown): v is PlayerState {
  const s = v as PlayerState;
  return (
    !!s &&
    isStr(s.id, 80) &&
    isStr(s.name, 40) &&
    isVec(s.p) &&
    isNum(s.yaw) &&
    isNum(s.pitch) &&
    isNum(s.speed) &&
    typeof s.crouch === 'boolean' &&
    (s.item === null || isStr(s.item, 40)) &&
    isNum(s.swings) &&
    isNum(s.hp) &&
    typeof s.dead === 'boolean' &&
    typeof s.hidden === 'boolean'
  );
}

/** Grobe Formprüfung; Unbekanntes oder Kaputtes → null (wird verworfen). */
export function parseMessage(data: unknown): NetMessage | null {
  const m = data as NetMessage;
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'hello':
      return isNum(m.v) && isStr(m.name, 40) ? m : null;
    case 'welcome':
      return isNum(m.v) && isStr(m.id, 80) && isNum(m.seed) && isStr(m.host, 40) ? m : null;
    case 'reject':
      return isStr(m.reason) ? m : null;
    case 'state':
      return isPlayerState(m.s) ? m : null;
    case 'players':
      return Array.isArray(m.list) && m.list.length <= MAX_PLAYERS && m.list.every(isPlayerState) ? m : null;
    case 'world':
      return isNum(m.day) && isNum(m.hour) && !!m.weather && typeof m.weather === 'object' ? m : null;
    case 'enemies':
      return Array.isArray(m.list) && m.list.length <= 200 && m.list.every((e) => !!e && isNum(e.id) && isVec(e.p) && typeof e.kind === 'string') ? m : null;
    case 'hit':
      return isNum(m.enemy) && !!m.hit && typeof m.hit.op === 'string' ? m : null;
    case 'hurt':
      return isNum(m.amount) && m.amount >= 0 && m.amount < 1000 && isVec(m.from) ? m : null;
    case 'kill':
      return isNum(m.enemy) && isStr(m.name, 80) && isVec(m.p) ? m : null;
    case 'notice':
      return isStr(m.text, 300) ? m : null;
    default:
      return null;
  }
}

/** Kürzt einen Spielernamen auf etwas Anzeigbares. */
export function cleanName(name: string): string {
  const s = name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18);
  return s || 'Unbekannt';
}
