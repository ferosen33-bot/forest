import type { EventBus } from '../core/EventBus';
import type { Player } from '../entities/Player';
import { collectRefs } from './dom';

const REFS = [
  'damage',
  'underwater',
  'crosshair',
  'prompt',
  'clock',
  'health',
  'stamina',
  'hunger',
  'thirst',
  'oxygen',
  'oxygenRow',
  'debug',
] as const;

const BARS = ['health', 'stamina', 'hunger', 'thirst', 'oxygen'] as const;
type BarName = (typeof BARS)[number];

/**
 * Heads-Up-Display als DOM-Overlay. Werte werden nur geschrieben, wenn sie sich
 * sichtbar geändert haben – so entstehen pro Frame kaum Style-Recalculations.
 */
export class HUD {
  private readonly el: Record<(typeof REFS)[number], HTMLElement>;
  private readonly rows = new Map<BarName, HTMLElement>();
  private readonly cache = new Map<string, string | number | boolean>();
  private damageFlash = 0;
  debugVisible = false;

  constructor(
    private readonly root: HTMLElement,
    events: EventBus,
  ) {
    this.el = collectRefs(root, REFS);
    for (const name of BARS) this.rows.set(name, this.el[name].closest('.stat') as HTMLElement);
    events.on('player:damaged', ({ amount }) => {
      this.damageFlash = Math.min(1, this.damageFlash + 0.25 + amount / 40);
    });
    events.on('player:respawned', () => {
      this.damageFlash = 0;
    });
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.el.debug.classList.toggle('hidden', !this.debugVisible);
  }

  update(dt: number, player: Player, clockText: string): void {
    const s = player.stats;
    this.bar('health', s.health / s.max, 0.25);
    this.bar('stamina', s.stamina / s.max, s.exhausted ? 1.01 : 0);
    this.bar('hunger', s.hunger / s.max, 0.2);
    this.bar('thirst', s.thirst / s.max, 0.2);
    this.bar('oxygen', player.oxygen / 100, 0.3);
    this.toggle('oxygenRow', 'hidden', player.oxygen >= 99.9);

    const prompt = player.interactionPrompt;
    this.toggle('prompt', 'is-visible', prompt !== null);
    this.toggle('crosshair', 'is-active', prompt !== null);
    if (prompt !== null) this.text('prompt', prompt);
    this.text('clock', clockText);

    this.toggle('underwater', 'is-visible', player.headUnderwater);

    // Treffer-Feedback klingt exponentiell ab; bei niedriger Gesundheit bleibt ein Rest.
    this.damageFlash *= Math.exp(-dt * 2.5);
    const lowHealth = Math.max(0, 0.35 - s.health / s.max) * 1.6;
    this.style('damage', 'opacity', Math.max(this.damageFlash, lowHealth).toFixed(2));
  }

  updateDebug(lines: string[]): void {
    if (this.debugVisible) this.el.debug.textContent = lines.join('\n');
  }

  // --- Helfer mit Änderungs-Cache ---

  private bar(name: BarName, ratio: number, lowThreshold: number): void {
    const value = Math.round(Math.max(0, Math.min(1, ratio)) * 500) / 500;
    if (this.cache.get(name) !== value) {
      this.cache.set(name, value);
      this.el[name].style.transform = `scaleX(${value})`;
    }
    // `is-low` lässt das Icon pulsieren.
    this.toggleOn(this.rows.get(name)!, `${name}:low`, 'is-low', ratio < lowThreshold);
  }

  private text(name: (typeof REFS)[number], value: string): void {
    if (this.cache.get(`${name}:text`) === value) return;
    this.cache.set(`${name}:text`, value);
    this.el[name].textContent = value;
  }

  private style(name: (typeof REFS)[number], prop: 'opacity', value: string): void {
    const key = `${name}:${prop}`;
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    this.el[name].style[prop] = value;
  }

  private toggle(name: (typeof REFS)[number], cls: string, on: boolean): void {
    this.toggleOn(this.el[name], `${name}:${cls}`, cls, on);
  }

  private toggleOn(el: HTMLElement, key: string, cls: string, on: boolean): void {
    if (this.cache.get(key) === on) return;
    this.cache.set(key, on);
    el.classList.toggle(cls, on);
  }
}
