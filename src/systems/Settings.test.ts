import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, SettingsStore } from './Settings';

class Mem {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('Einstellungen', () => {
  it('liefert Standardwerte ohne gespeicherte Daten', () => {
    expect(new SettingsStore(new Mem()).load()).toEqual(DEFAULT_SETTINGS);
    expect(new SettingsStore(null).load()).toEqual(DEFAULT_SETTINGS);
  });

  it('speichert und lädt', () => {
    const store = new SettingsStore(new Mem());
    const s = { ...DEFAULT_SETTINGS, masterVolume: 0.3, invertY: true, quality: 'low' as const, fov: 90 };
    store.save(s);
    expect(store.load()).toEqual(s);
  });

  it('begrenzt und repariert ungültige Werte', () => {
    const s = sanitizeSettings({ masterVolume: 5, fov: 10, quality: 'ultra', mouseSensitivity: 'x', invertY: 1 });
    expect(s.masterVolume).toBe(1);
    expect(s.fov).toBe(60);
    expect(s.quality).toBe('high');
    expect(s.mouseSensitivity).toBe(1);
    expect(s.invertY).toBe(false);
    const broken = new Mem();
    broken.setItem('wildwood.settings', '{kaputt');
    expect(new SettingsStore(broken).load()).toEqual(DEFAULT_SETTINGS);
  });
});
