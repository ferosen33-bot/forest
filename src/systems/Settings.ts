import { clamp } from '../utils/math';
import type { KeyValueStorage } from './SaveGame';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  /** Lautstärken 0..1 */
  masterVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  /** Faktor auf die Grund-Mausempfindlichkeit (0,2 … 3). */
  mouseSensitivity: number;
  invertY: boolean;
  /** Vertikales Sichtfeld in Grad. */
  fov: number;
  quality: Quality;
  /** Lichtstrahlen, Bloom, Vignette. */
  postProcessing: boolean;
}

export interface QualityPreset {
  label: string;
  shadowMapSize: number;
  grassRadius: number;
  viewDistance: number;
  vegetationDistance: number;
  /** Höchstes Pixelverhältnis (hochauflösende Displays). */
  maxPixelRatio: number;
  /** Bis zu dieser Entfernung (m) erscheinen die realistischen Bäume; 0 = nur einfache Formen. */
  nearTrees: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { label: 'Niedrig', shadowMapSize: 1024, grassRadius: 0, viewDistance: 320, vegetationDistance: 190, maxPixelRatio: 1, nearTrees: 0 },
  medium: { label: 'Mittel', shadowMapSize: 2048, grassRadius: 24, viewDistance: 400, vegetationDistance: 240, maxPixelRatio: 1.5, nearTrees: 32 },
  high: { label: 'Hoch', shadowMapSize: 2048, grassRadius: 36, viewDistance: 450, vegetationDistance: 280, maxPixelRatio: 2, nearTrees: 60 },
};

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 1,
  sfxVolume: 1,
  ambienceVolume: 1,
  mouseSensitivity: 1,
  invertY: false,
  fov: 75,
  quality: 'high',
  postProcessing: true,
};

const STORAGE_KEY = 'wildwood.settings';

/** Bringt beliebige (z. B. von Hand bearbeitete) Daten in gültige Einstellungen. */
export function sanitizeSettings(data: unknown): Settings {
  const d = (data && typeof data === 'object' ? data : {}) as Partial<Record<keyof Settings, unknown>>;
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
  const def = DEFAULT_SETTINGS;
  return {
    masterVolume: num(d.masterVolume, def.masterVolume, 0, 1),
    sfxVolume: num(d.sfxVolume, def.sfxVolume, 0, 1),
    ambienceVolume: num(d.ambienceVolume, def.ambienceVolume, 0, 1),
    mouseSensitivity: num(d.mouseSensitivity, def.mouseSensitivity, 0.2, 3),
    invertY: typeof d.invertY === 'boolean' ? d.invertY : def.invertY,
    fov: num(d.fov, def.fov, 60, 100),
    quality: d.quality === 'low' || d.quality === 'medium' || d.quality === 'high' ? d.quality : def.quality,
    postProcessing: typeof d.postProcessing === 'boolean' ? d.postProcessing : def.postProcessing,
  };
}

/** Einstellungen im Browser-Speicher (getrennt vom Spielstand – "Neues Spiel" behält sie). */
export class SettingsStore {
  constructor(private readonly storage: KeyValueStorage | null = SettingsStore.defaultStorage()) {}

  private static defaultStorage(): KeyValueStorage | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  }

  load(): Settings {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      return sanitizeSettings(raw ? JSON.parse(raw) : {});
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  save(s: Settings): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* voll oder gesperrt – Einstellungen gelten dann nur für diese Sitzung */
    }
  }
}
