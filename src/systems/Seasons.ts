import { clamp, smoothstep } from '../utils/math';

export type SeasonName = 'summer' | 'autumn' | 'winter' | 'spring';

/** Darstellungs- und Spielwerte einer Jahreszeit (werden zwischen Jahreszeiten überblendet). */
export interface SeasonLook {
  /** Laubbäume: Herbstfärbung, kahler Winter, frisches Frühlingsgrün (je 0..1). */
  autumn: number;
  bare: number;
  fresh: number;
  /** Schneedecke auf Gelände, Kronen und Gras. */
  snow: number;
  /** Grundkälte nachts (0..1); tagsüber ein Drittel davon. */
  chill: number;
  /** Farbfaktor für das Gras. */
  grass: [number, number, number];
}

const LOOKS: Record<SeasonName, SeasonLook> = {
  summer: { autumn: 0, bare: 0, fresh: 0, snow: 0, chill: 0, grass: [1, 1, 1] },
  autumn: { autumn: 1, bare: 0, fresh: 0, snow: 0, chill: 0.3, grass: [1.5, 1.08, 0.4] },
  winter: { autumn: 0, bare: 1, fresh: 0, snow: 0.9, chill: 0.8, grass: [1.05, 1.05, 1.05] },
  spring: { autumn: 0, bare: 0, fresh: 1, snow: 0, chill: 0.1, grass: [0.92, 1.12, 0.85] },
};

const ORDER: SeasonName[] = ['summer', 'autumn', 'winter', 'spring'];
const NAMES: Record<SeasonName, string> = { summer: 'Sommer', autumn: 'Herbst', winter: 'Winter', spring: 'Frühling' };

/** Tage pro Jahreszeit; der letzte davon blendet in die nächste über. */
export const SEASON_DAYS = 4;

export interface SeasonState extends SeasonLook {
  season: SeasonName;
  name: string;
  /** Niederschlag fällt als Schnee (0..1). */
  snowfall: number;
}

/**
 * Jahreszeit zu Tag (ab 1) und Uhrzeit: Sommer → Herbst → Winter → Frühling, je {@link SEASON_DAYS} Tage.
 * Während des letzten Tages einer Jahreszeit wird weich in die nächste übergeblendet.
 */
export function seasonAt(day: number, hour: number): SeasonState {
  const t = Math.max(0, day - 1 + hour / 24);
  const cycle = SEASON_DAYS * ORDER.length;
  const inCycle = t % cycle;
  const index = Math.floor(inCycle / SEASON_DAYS);
  const within = inCycle - index * SEASON_DAYS;
  const season = ORDER[index];
  const next = ORDER[(index + 1) % ORDER.length];
  const k = smoothstep(SEASON_DAYS - 1, SEASON_DAYS, within);
  const a = LOOKS[season];
  const b = LOOKS[next];
  const mix = (x: number, y: number) => x + (y - x) * k;
  const look: SeasonLook = {
    autumn: mix(a.autumn, b.autumn),
    bare: mix(a.bare, b.bare),
    fresh: mix(a.fresh, b.fresh),
    snow: mix(a.snow, b.snow),
    chill: mix(a.chill, b.chill),
    grass: [mix(a.grass[0], b.grass[0]), mix(a.grass[1], b.grass[1]), mix(a.grass[2], b.grass[2])],
  };
  return { ...look, season, name: NAMES[season], snowfall: clamp(look.snow / 0.6, 0, 1) };
}
