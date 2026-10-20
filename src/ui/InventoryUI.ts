import type { Inventory } from '../systems/Inventory';
import { getItem } from '../entities/items/ItemDefs';
import { collectRefs } from './dom';
import { renderSlot, type IconSet } from './slots';

interface DragState {
  from: number;
  startX: number;
  startY: number;
  ghost: HTMLElement | null;
}

/**
 * Inventar-Fenster: Rucksack-Raster und Schnellzugriffsleiste.
 *
 * - Ziehen: verschieben, gleiche Items stapeln, verschiedene tauschen
 * - Shift + Klick: zwischen Schnellzugriff und Rucksack umlagern
 * - Rechtsklick: benutzen (essen) bzw. ausrüsten
 * - Aus dem Fenster ziehen: fallenlassen
 */
export class InventoryUI {
  /** Wird für "Benutzen/Ausrüsten" per Rechtsklick aufgerufen. */
  onUse: ((slot: number) => void) | null = null;
  /** Wird aufgerufen, wenn ein Stapel aus dem Fenster gezogen wurde. */
  onDrop: ((slot: number) => void) | null = null;

  private readonly el;
  private readonly slotEls: HTMLElement[] = [];
  private drag: DragState | null = null;
  private hovered = -1;
  private _open = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly inventory: Inventory,
    private readonly icons: IconSet,
    private readonly getSelected: () => number,
  ) {
    this.el = collectRefs(root, ['panel', 'grid', 'hotbarGrid', 'detailIcon', 'detailName', 'detailDesc'] as const);

    for (let i = 0; i < inventory.size; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.index = String(i);
      if (i < inventory.hotbarSize) {
        const num = document.createElement('span');
        num.className = 'slot__key';
        num.textContent = String(i + 1);
        slot.appendChild(num);
        this.el.hotbarGrid.appendChild(slot);
      } else {
        this.el.grid.appendChild(slot);
      }
      this.slotEls.push(slot);
    }

    inventory.onChange(() => {
      if (this._open) this.render();
    });

    root.addEventListener('pointerdown', this.handlePointerDown);
    root.addEventListener('pointerover', this.handlePointerOver);
    root.addEventListener('contextmenu', this.handleContextMenu);
  }

  get open(): boolean {
    return this._open;
  }

  show(): void {
    this._open = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this._open = false;
    this.cancelDrag();
    this.root.classList.add('hidden');
  }

  private render(): void {
    const selected = this.getSelected();
    this.slotEls.forEach((el, i) => {
      renderSlot(el, this.inventory.get(i), this.icons);
      el.classList.toggle('is-selected', i === selected);
    });
    this.renderDetails();
  }

  private renderDetails(): void {
    const stack = this.hovered >= 0 ? this.inventory.get(this.hovered) : null;
    const icon = this.el.detailIcon as HTMLImageElement;
    if (!stack) {
      icon.hidden = true;
      this.el.detailName.textContent = '–';
      this.el.detailDesc.textContent = 'Fahre über einen Gegenstand.';
      return;
    }
    const def = getItem(stack.id);
    icon.hidden = false;
    icon.src = this.icons[stack.id];
    this.el.detailName.textContent = stack.count > 1 ? `${def.name} ×${stack.count}` : def.name;
    let desc = def.description;
    if (def.food) desc += ` (+${def.food.hunger} Sättigung)`;
    this.el.detailDesc.textContent = desc;
  }

  private slotIndexAt(target: EventTarget | null): number {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('.slot');
    return el?.dataset.index !== undefined ? Number(el.dataset.index) : -1;
  }

  // --- Maus/Pointer ---

  private handlePointerOver = (e: PointerEvent): void => {
    const index = this.slotIndexAt(e.target);
    if (index !== this.hovered) {
      this.hovered = index;
      this.renderDetails();
    }
  };

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const index = this.slotIndexAt(e.target);
    if (index >= 0 && this.inventory.get(index)) this.onUse?.(index);
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const index = this.slotIndexAt(e.target);
    if (index < 0 || !this.inventory.get(index)) return;
    e.preventDefault();

    if (e.shiftKey) {
      this.inventory.quickMove(index);
      return;
    }
    this.drag = { from: index, startX: e.clientX, startY: e.clientY, ghost: null };
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.ghost && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) {
      drag.ghost = this.slotEls[drag.from].cloneNode(true) as HTMLElement;
      drag.ghost.classList.add('slot--ghost');
      drag.ghost.classList.remove('is-selected');
      document.body.appendChild(drag.ghost);
      this.slotEls[drag.from].classList.add('is-dragging');
    }
    if (drag.ghost) drag.ghost.style.transform = `translate(${e.clientX - 28}px, ${e.clientY - 28}px)`;
  };

  private handlePointerUp = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    if (drag.ghost) {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const to = this.slotIndexAt(under);
      if (to >= 0) this.inventory.move(drag.from, to);
      else if (!this.el.panel.contains(under)) this.onDrop?.(drag.from);
    }
    this.cancelDrag();
  };

  private cancelDrag(): void {
    if (this.drag) {
      this.drag.ghost?.remove();
      this.slotEls[this.drag.from].classList.remove('is-dragging');
    }
    this.drag = null;
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
  }
}
