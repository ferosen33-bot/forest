import { QUALITY, type Quality, type Settings } from '../systems/Settings';

type Field =
  | { kind: 'section'; label: string }
  | { kind: 'range'; key: 'masterVolume' | 'sfxVolume' | 'ambienceVolume' | 'mouseSensitivity' | 'fov'; label: string; min: number; max: number; step: number; format: (v: number) => string }
  | { kind: 'check'; key: 'invertY' | 'postProcessing'; label: string }
  | { kind: 'quality'; label: string };

const percent = (v: number) => `${Math.round(v * 100)} %`;

const FIELDS: Field[] = [
  { kind: 'section', label: 'Ton' },
  { kind: 'range', key: 'masterVolume', label: 'Gesamt', min: 0, max: 1, step: 0.05, format: percent },
  { kind: 'range', key: 'sfxVolume', label: 'Effekte', min: 0, max: 1, step: 0.05, format: percent },
  { kind: 'range', key: 'ambienceVolume', label: 'Umgebung', min: 0, max: 1, step: 0.05, format: percent },
  { kind: 'section', label: 'Steuerung' },
  { kind: 'range', key: 'mouseSensitivity', label: 'Mausempfindlichkeit', min: 0.2, max: 3, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
  { kind: 'check', key: 'invertY', label: 'Maus invertieren' },
  { kind: 'range', key: 'fov', label: 'Sichtfeld', min: 60, max: 100, step: 1, format: (v) => `${v}°` },
  { kind: 'section', label: 'Grafik' },
  { kind: 'quality', label: 'Qualität' },
  { kind: 'check', key: 'postProcessing', label: 'Lichtstrahlen & Bloom' },
];

/**
 * Einstellungsformular (Ton, Steuerung, Grafik). Jede Änderung wird sofort gemeldet,
 * damit man sie live hört bzw. sieht.
 */
export class SettingsUI {
  onChange: ((s: Settings) => void) | null = null;
  private settings: Settings;
  private readonly inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private readonly values = new Map<string, HTMLElement>();

  constructor(container: HTMLElement, initial: Settings) {
    this.settings = { ...initial };
    for (const f of FIELDS) {
      if (f.kind === 'section') {
        const h = document.createElement('div');
        h.className = 'settings__section';
        h.textContent = f.label;
        container.append(h);
        continue;
      }
      const label = document.createElement('label');
      label.textContent = f.label;
      const value = document.createElement('span');
      value.className = 'settings__value';
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.kind === 'range') {
        const r = document.createElement('input');
        r.type = 'range';
        r.min = String(f.min);
        r.max = String(f.max);
        r.step = String(f.step);
        r.addEventListener('input', () => {
          this.settings[f.key] = Number(r.value);
          value.textContent = f.format(Number(r.value));
          this.emit();
        });
        input = r;
        this.values.set(f.key, value);
      } else if (f.kind === 'check') {
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.addEventListener('change', () => {
          this.settings[f.key] = c.checked;
          this.emit();
        });
        input = c;
      } else {
        const sel = document.createElement('select');
        for (const [q, preset] of Object.entries(QUALITY)) sel.add(new Option(preset.label, q));
        sel.addEventListener('change', () => {
          this.settings.quality = sel.value as Quality;
          this.emit();
        });
        input = sel;
      }
      const id = `setting-${f.kind === 'quality' ? 'quality' : f.key}`;
      input.id = id;
      label.htmlFor = id;
      this.inputs.set(f.kind === 'quality' ? 'quality' : f.key, input);
      container.append(label, input, value);
    }
    this.set(initial);
  }

  /** Formular auf Werte setzen (ohne `onChange`). */
  set(s: Settings): void {
    this.settings = { ...s };
    for (const f of FIELDS) {
      if (f.kind === 'section') continue;
      const key = f.kind === 'quality' ? 'quality' : f.key;
      const input = this.inputs.get(key)!;
      if (f.kind === 'check') (input as HTMLInputElement).checked = s[f.key];
      else input.value = String(s[key as keyof Settings]);
      if (f.kind === 'range') this.values.get(f.key)!.textContent = f.format(s[f.key]);
    }
  }

  private emit(): void {
    this.onChange?.({ ...this.settings });
  }
}
