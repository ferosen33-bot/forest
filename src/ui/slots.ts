import type { Slot } from '../systems/Inventory';
import { getItem, type ItemId } from '../entities/items/ItemDefs';

export type IconSet = Record<ItemId, string>;

/**
 * Füllt ein Slot-Element mit Icon und Stapelanzahl.
 * Das DOM wird nur neu aufgebaut, wenn sich Item oder Anzahl ändern.
 */
export function renderSlot(el: HTMLElement, slot: Slot, icons: IconSet): void {
  // Haltbarkeit in 2-%-Schritten in den Cache-Schlüssel – die Fackel brennt sichtbar herunter.
  const max = slot ? getItem(slot.id).durability : undefined;
  const condition = slot && max !== undefined && slot.durability !== undefined ? Math.round((slot.durability / max) * 50) / 50 : null;
  const key = slot ? `${slot.id}:${slot.count}:${condition ?? ''}` : '';
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
  let wear = el.querySelector<HTMLElement>('.slot__wear');
  if (!wear) {
    wear = document.createElement('span');
    wear.className = 'slot__wear';
    el.appendChild(wear);
  }
  wear.hidden = condition === null;
  if (condition !== null) {
    wear.style.setProperty('--condition', String(condition));
    wear.classList.toggle('is-low', condition < 0.25);
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
