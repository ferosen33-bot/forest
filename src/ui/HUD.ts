import type { EventBus } from '../core/EventBus';
import type { Player } from '../entities/Player';
import type { Prompt } from '../systems/InteractionSystem';
import type { Inventory } from '../systems/Inventory';
import { getItem, type ItemId } from '../entities/items/ItemDefs';
import { collectRefs } from './dom';
import { renderSlot, type IconSet } from './slots';

const REFS = [
  'damage',
  'underwater',
  'crosshair',
  'hitmarker',
  'prompt',
  'promptKey',
  'promptAction',
  'promptLabel',
  'clock',
  'health',
  'stamina',
  'hunger',
  'thirst',
  'oxygen',
  'oxygenRow',
  'wet',
  'wetRow',
  'compass',
  'objectives',
  'toasts',
  'hotbar',
  'hotbarName',
  'build',
  'buildName',
  'buildReason',
  'buildCost',
  'fade',
  'damageDir',
  'enemyHealth',
  'enemyHealthFill',
  'enemyName',
  'debug',
] as const;

const BARS = ['health', 'stamina', 'hunger', 'thirst', 'oxygen', 'wet'] as const;
type BarName = (typeof BARS)[number];
type RefName = (typeof REFS)[number];

/** Anzeige im Baumodus. */
export interface BuildHint {
  name: string;
  valid: boolean;
  reason?: string;
  cost: { item: ItemId; have: number; need: number }[];
}

const KEY_LABEL: Record<NonNullable<Prompt['key']>, string> = { E: 'E', R: 'R', LMB: 'Linksklick' };
const TOAST_TIME = 2.8;

interface Toast {
  el: HTMLElement;
  text: HTMLElement;
  age: number;
  item?: ItemId;
  count: number;
}

/**
 * Heads-Up-Display als DOM-Overlay. Werte werden nur geschrieben, wenn sie sich
 * sichtbar geändert haben – so entstehen pro Frame kaum Style-Recalculations.
 */
export class HUD {
  private readonly el: Record<RefName, HTMLElement>;

  /** Liste der aktuellen Ziele. */
  get objectivesElement(): HTMLElement {
    return this.el.objectives;
  }

  /** Canvas des Kompassbands. */
  get compassCanvas(): HTMLCanvasElement {
    return this.el.compass as HTMLCanvasElement;
  }
  private readonly rows = new Map<BarName, HTMLElement>();
  private readonly cache = new Map<string, string | number | boolean>();
  private readonly hotbarSlots: HTMLElement[] = [];
  private readonly toasts: Toast[] = [];
  private damageFlash = 0;
  private hitTimer = 0;
  private hitKind: 'normal' | 'creature' | 'kill' = 'normal';
  private damageFrom: { x: number; z: number } | null = null;
  private damageDirTimer = 0;
  private enemyHealthTimer = 0;
  /** Lebensleiste eines Endgegners (null = keiner im Kampf). */
  private boss: { name: string; fraction: number } | null = null;
  private nameTimer = 0;
  private lastSelected = -1;
  private lastSelectedItem: ItemId | null = null;
  debugVisible = false;

  constructor(
    private readonly root: HTMLElement,
    events: EventBus,
    private readonly inventory: Inventory,
    private readonly icons: IconSet,
  ) {
    this.el = collectRefs(root, REFS);
    for (const name of BARS) this.rows.set(name, this.el[name].closest('.stat') as HTMLElement);

    for (let i = 0; i < inventory.hotbarSize; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      const num = document.createElement('span');
      num.className = 'slot__key';
      num.textContent = String(i + 1);
      slot.appendChild(num);
      this.el.hotbar.appendChild(slot);
      this.hotbarSlots.push(slot);
    }

    events.on('player:damaged', ({ amount, from }) => {
      this.damageFlash = Math.min(1, this.damageFlash + 0.25 + amount / 40);
      if (from) {
        this.damageFrom = { x: from.x, z: from.z };
        this.damageDirTimer = 1.3;
      }
    });
    events.on('enemy:hit', ({ health, maxHealth, killed, name }) => {
      if (this.boss) return;
      this.el.enemyName.textContent = name;
      this.enemyHealthTimer = killed ? 1.2 : 2.5;
      this.el.enemyHealthFill.style.transform = `scaleX(${Math.max(0, health / maxHealth)})`;
      if (killed) {
        this.hitKind = 'kill';
        this.hitTimer = 0.4;
      }
    });
    events.on('player:respawned', () => {
      this.damageFlash = 0;
    });
    events.on('tool:hit', ({ target }) => {
      if (this.hitKind === 'kill' && this.hitTimer > 0) return;
      this.hitKind = target === 'creature' ? 'creature' : 'normal';
      this.hitTimer = 0.16;
    });
    events.on('item:collected', ({ item, count }) => this.itemToast(item, count));
    events.on('item:inventoryFull', ({ item }) => this.toast(`Inventar voll – ${getItem(item).name} liegt am Boden`, item));
    events.on('player:ate', ({ item }) => {
      const food = getItem(item).food;
      const drink = !!food && food.hunger === 0 && food.thirst > 0;
      this.toast(drink ? 'Wasser getrunken' : `${getItem(item).name} gegessen`, item);
    });
    events.on('hud:message', ({ text }) => this.toast(text));
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  /** Bei offenem Inventar: Fadenkreuz, Hinweis und Schnellzugriffsleiste ausblenden. */
  set inventoryOpen(open: boolean) {
    this.root.classList.toggle('is-inventory-open', open);
  }

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.el.debug.classList.toggle('hidden', !this.debugVisible);
  }

  /** Bildschirm abdunkeln (Schlafen). Die CSS-Transition übernimmt die Überblendung. */
  set faded(on: boolean) {
    this.el.fade.classList.toggle('is-visible', on);
  }

  /** Endgegner im Kampf: breite Leiste oben (null blendet sie aus). */
  setBoss(boss: { name: string; fraction: number } | null): void {
    this.boss = boss;
  }

  update(
    dt: number,
    player: Player,
    clockText: string,
    prompt: Prompt | null,
    selected: number,
    build: BuildHint | null,
  ): void {
    const s = player.stats;
    this.bar('health', s.health / s.max, 0.25);
    this.bar('stamina', s.stamina / s.max, s.exhausted ? 1.01 : 0);
    this.bar('hunger', s.hunger / s.max, 0.2);
    this.bar('thirst', s.thirst / s.max, 0.2);
    this.bar('oxygen', player.oxygen / 100, 0.3);
    this.toggle('oxygenRow', 'hidden', player.oxygen >= 99.9);
    this.bar('wet', s.wetness, 0);
    this.toggle('wetRow', 'hidden', s.wetness < 0.03);
    this.toggle('wetRow', 'is-freezing', s.freezing);

    this.updatePrompt(prompt);
    this.text('clock', clockText);
    this.toggle('underwater', 'is-visible', player.headUnderwater);

    this.hitTimer -= dt;
    this.toggle('hitmarker', 'is-visible', this.hitTimer > 0);
    this.toggle('hitmarker', 'is-creature', this.hitKind === 'creature');
    this.toggle('hitmarker', 'is-kill', this.hitKind === 'kill');

    // Treffer-Richtung: Bogen um das Fadenkreuz, der zum Angreifer zeigt.
    this.damageDirTimer -= dt;
    this.toggle('damageDir', 'is-visible', this.damageDirTimer > 0);
    if (this.damageDirTimer > 0 && this.damageFrom) {
      const dx = this.damageFrom.x - player.position.x;
      const dz = this.damageFrom.z - player.position.z;
      const fx = -Math.sin(player.yaw);
      const fz = -Math.cos(player.yaw);
      const rel = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz); // rechts positiv
      this.el.damageDir.style.transform = `translate(-50%, -50%) rotate(${rel.toFixed(3)}rad)`;
      this.el.damageDir.style.opacity = Math.min(1, this.damageDirTimer).toFixed(2);
    }

    this.enemyHealthTimer -= dt;
    if (this.boss) {
      this.el.enemyName.textContent = this.boss.name;
      this.el.enemyHealthFill.style.transform = `scaleX(${Math.max(0, this.boss.fraction)})`;
    }
    this.toggle('enemyHealth', 'is-boss', !!this.boss);
    this.toggle('enemyHealth', 'is-visible', this.enemyHealthTimer > 0 || !!this.boss);

    // Treffer-Feedback klingt exponentiell ab; bei niedriger Gesundheit bleibt ein Rest.
    this.damageFlash *= Math.exp(-dt * 2.5);
    const lowHealth = Math.max(0, 0.35 - s.health / s.max) * 1.6;
    this.style('damage', 'opacity', Math.max(this.damageFlash, lowHealth).toFixed(2));

    this.updateHotbar(dt, selected);
    this.updateToasts(dt);
    this.updateBuild(build);
  }

  private updateBuild(build: BuildHint | null): void {
    this.toggle('build', 'hidden', build === null);
    this.toggleOn(this.root, 'root:building', 'is-building', build !== null);
    if (!build) return;
    this.text('buildName', build.name);
    this.text('buildReason', build.valid ? '' : (build.reason ?? ''));
    this.toggle('build', 'is-invalid', !build.valid);

    const key = build.cost.map((c) => `${c.item}:${c.have}/${c.need}`).join(',');
    if (this.cache.get('buildCost') === key) return;
    this.cache.set('buildCost', key);
    this.el.buildCost.replaceChildren(
      ...build.cost.map((c) => {
        const chip = document.createElement('span');
        chip.className = 'cost' + (c.have < c.need ? ' is-missing' : '');
        const img = document.createElement('img');
        img.src = this.icons[c.item];
        img.alt = '';
        chip.append(img, `${Math.min(c.have, c.need)}/${c.need} ${getItem(c.item).name}`);
        return chip;
      }),
    );
  }

  updateDebug(lines: string[]): void {
    if (this.debugVisible) this.el.debug.textContent = lines.join('\n');
  }

  // ---------------------------------------------------------------------------

  private updatePrompt(prompt: Prompt | null): void {
    this.toggle('prompt', 'is-visible', prompt !== null);
    this.toggle('crosshair', 'is-active', prompt?.key != null);
    if (!prompt) return;
    this.toggle('promptKey', 'hidden', prompt.key === null);
    this.toggle('prompt', 'is-disabled', prompt.key === null);
    if (prompt.key) this.text('promptKey', KEY_LABEL[prompt.key]);
    this.text('promptAction', prompt.action);
    this.text('promptLabel', prompt.label ?? '');
  }

  private updateHotbar(dt: number, selected: number): void {
    this.hotbarSlots.forEach((el, i) => {
      renderSlot(el, this.inventory.get(i), this.icons);
      this.toggleOn(el, `hotbar${i}:sel`, 'is-selected', i === selected);
    });

    // Beim Wechsel kurz den Namen des Items einblenden.
    const item = this.inventory.get(selected)?.id ?? null;
    if (selected !== this.lastSelected || item !== this.lastSelectedItem) {
      this.lastSelected = selected;
      this.lastSelectedItem = item;
      if (item) {
        this.text('hotbarName', getItem(item).name);
        this.nameTimer = 1.6;
      } else {
        this.nameTimer = 0;
      }
    }
    this.nameTimer -= dt;
    this.toggle('hotbarName', 'is-visible', this.nameTimer > 0);
  }

  private itemToast(item: ItemId, count: number): void {
    // Gleiche Items hintereinander zusammenfassen ("+3 Stock" statt drei Meldungen).
    const recent = this.toasts.find((t) => t.item === item && t.age < TOAST_TIME * 0.7 && t.count > 0);
    if (recent) {
      recent.count += count;
      recent.age = 0;
      recent.text.textContent = `+${recent.count} ${getItem(item).name}`;
      return;
    }
    const t = this.toast(`+${count} ${getItem(item).name}`, item);
    t.count = count;
  }

  private toast(text: string, item?: ItemId): Toast {
    const el = document.createElement('div');
    el.className = 'toast';
    if (item) {
      const img = document.createElement('img');
      img.src = this.icons[item];
      img.alt = '';
      el.appendChild(img);
    }
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    this.el.toasts.appendChild(el);

    const toast: Toast = { el, text: span, age: 0, item, count: 0 };
    this.toasts.push(toast);
    while (this.toasts.length > 5) this.toasts.shift()!.el.remove();
    return toast;
  }

  private updateToasts(dt: number): void {
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      t.age += dt;
      t.el.classList.toggle('is-leaving', t.age > TOAST_TIME - 0.4);
      if (t.age > TOAST_TIME) {
        t.el.remove();
        this.toasts.splice(i, 1);
      }
    }
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

  private text(name: RefName, value: string): void {
    if (this.cache.get(`${name}:text`) === value) return;
    this.cache.set(`${name}:text`, value);
    this.el[name].textContent = value;
  }

  private style(name: RefName, prop: 'opacity', value: string): void {
    const key = `${name}:${prop}`;
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    this.el[name].style[prop] = value;
  }

  private toggle(name: RefName, cls: string, on: boolean): void {
    this.toggleOn(this.el[name], `${name}:${cls}`, cls, on);
  }

  private toggleOn(el: HTMLElement, key: string, cls: string, on: boolean): void {
    if (this.cache.get(key) === on) return;
    this.cache.set(key, on);
    el.classList.toggle(cls, on);
  }
}
