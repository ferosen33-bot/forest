import type { Slot } from '../systems/Inventory';
import type { ItemId } from '../entities/items/ItemDefs';

export type IconSet = Record<ItemId, string>;

/**
 * Füllt ein Slot-Element mit Icon und Stapelanzahl.
 * Das DOM wird nur neu aufgebaut, wenn sich Item oder Anzahl ändern.
 */
export function renderSlot(el: HTMLElement, slot: Slot, icons: IconSet): void {
  const key = slot ? `${slot.id}:${slot.count}` : '';
  if (el.dataset.content === key) return;
  el.dataset.content = key;
  el.classList.toggle('is-empty', !slot);

  let img = el.querySelector<HTMLImageElement>('.slot__icon');
  let count = el.querySelector<HTMLElement>('.slot__count');
  if (!img) {
    img = document.createElement('img');
    img.className = 'slot__icon';
    img.draggable = false;
    img.alt = '';
    el.appendChild(img);
  }
  if (!count) {
    count = document.createElement('span');
    count.className = 'slot__count';
    el.appendChild(count);
  }
  if (slot) {
    img.src = icons[slot.id];
    img.hidden = false;
    count.textContent = slot.count > 1 ? String(slot.count) : '';
  } else {
    img.hidden = true;
    count.textContent = '';
  }
}
