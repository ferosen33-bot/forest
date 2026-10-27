import type { Inventory } from '../systems/Inventory';
import { canMod, getRarity, getWeaponPerk, gunStats, loadedRounds, maxDurability, weaponName, weaponStats, type WeaponMeta } from '../entities/items/Weapons';
import { ELEMENTS } from '../entities/items/Elements';
import { getItem, type ItemId } from '../entities/items/ItemDefs';
import { RECIPES, needsWorkbench, recipeDescription, recipeGroup, recipeName, type Crafting, type Recipe } from '../systems/Crafting';
import { collectRefs } from './dom';
import { renderSlot } from './slots';
import type { IconSets } from './ItemIcons';

interface RecipeCard {
  recipe: Recipe;
  el: HTMLButtonElement;
  cost: HTMLElement;
}

/** Ein Slot in einem der beiden Inventare (Spieler oder geöffnete Kiste). */
interface SlotRef {
  inv: Inventory;
  index: number;
}

interface DragState {
  from: SlotRef;
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
 * - Rechte Spalte: Rezepte (Items herstellen, Baupläne auswählen)
 */
export class InventoryUI {
  /** Wird für "Benutzen/Ausrüsten" per Rechtsklick aufgerufen. */
  onUse: ((slot: number) => void) | null = null;
  /** Mod auf eine Waffe gezogen. @returns true, wenn der Versuch behandelt wurde. */
  onApplyMod: ((modSlot: number, weaponSlot: number) => boolean) | null = null;
  /** Wird aufgerufen, wenn ein Stapel aus dem Fenster gezogen wurde. */
  onDrop: ((slot: number) => void) | null = null;
  /** Klick auf ein Rezept. */
  onCraft: ((recipe: Recipe) => void) | null = null;

  private readonly el;
  private readonly slotEls: HTMLElement[] = [];
  private readonly cards: RecipeCard[] = [];
  private hoveredRecipe: Recipe | null = null;
  private drag: DragState | null = null;
  private hovered: SlotRef | null = null;
  /** Geöffnete Lagerkiste (null = Herstellen-Spalte sichtbar). */
  private chest: Inventory | null = null;
  private chestSlotEls: HTMLElement[] = [];
  private unsubscribeChest: (() => void) | null = null;
  private _open = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly inventory: Inventory,
    private readonly icons: IconSets,
    private readonly getSelected: () => number,
    private readonly crafting: Crafting,
  ) {
    this.el = collectRefs(root, [
      'panel',
      'grid',
      'hotbarGrid',
      'detailIcon',
      'detailName',
      'detailRarity',
      'detailStats',
      'detailDesc',
      'recipes',
      'chestPanel',
      'chestGrid',
      'chestTitle',
      'craftingPanel',
    ] as const);
    this.buildRecipeCards();

    this.addSlotElements();

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

  /** Legt Slot-Elemente für alle (auch neu hinzugekommene) Inventarplätze an. */
  private addSlotElements(): void {
    for (let i = this.slotEls.length; i < this.inventory.size; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.index = String(i);
      if (i < this.inventory.hotbarSize) {
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
    this.setChest(null);
  }

  /** Öffnet das Fenster mit einer Lagerkiste neben dem Rucksack (statt der Rezepte). */
  showChest(chest: Inventory, title: string): void {
    this.setChest(chest);
    this.el.chestTitle.textContent = title;
    this.show();
  }

  get chestOpen(): boolean {
    return this.chest !== null;
  }

  private setChest(chest: Inventory | null): void {
    this.unsubscribeChest?.();
    this.unsubscribeChest = null;
    this.chest = chest;
    this.el.chestGrid.replaceChildren();
    this.chestSlotEls = [];
    this.el.chestPanel.classList.toggle('hidden', !chest);
    this.el.craftingPanel.classList.toggle('hidden', !!chest);
    if (!chest) return;
    for (let i = 0; i < chest.size; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.index = String(i);
      slot.dataset.inv = 'chest';
      this.el.chestGrid.appendChild(slot);
      this.chestSlotEls.push(slot);
    }
    this.unsubscribeChest = chest.onChange(() => {
      if (this._open) this.render();
    });
  }

  private render(): void {
    if (this.slotEls.length < this.inventory.size) this.addSlotElements();
    const selected = this.getSelected();
    this.slotEls.forEach((el, i) => {
      renderSlot(el, this.inventory.get(i), this.icons.items);
      el.classList.toggle('is-selected', i === selected);
    });
    if (this.chest) this.chestSlotEls.forEach((el, i) => renderSlot(el, this.chest!.get(i), this.icons.items));
    this.renderRecipes();
    this.renderDetails();
  }

  private buildRecipeCards(): void {
    let lastGroup: string | null = null;
    for (const recipe of RECIPES) {
      const group = recipeGroup(recipe);
      if (group !== lastGroup) {
        const heading = document.createElement('h3');
        heading.className = 'inventory__subtitle';
        heading.textContent = group;
        this.el.recipes.appendChild(heading);
        lastGroup = group;
      }
      const el = document.createElement('button');
      el.className = 'recipe';
      el.type = 'button';
      const icon = document.createElement('img');
      icon.className = 'recipe__icon';
      icon.alt = '';
      icon.src = recipe.kind === 'item' ? this.icons.items[recipe.result] : this.icons.structures[recipe.result];
      const body = document.createElement('div');
      body.className = 'recipe__body';
      const name = document.createElement('div');
      name.className = 'recipe__name';
      name.textContent = recipeName(recipe);
      const cost = document.createElement('div');
      cost.className = 'recipe__cost';
      body.append(name, cost);
      el.append(icon, body);

      el.addEventListener('click', () => this.onCraft?.(recipe));
      el.addEventListener('pointerenter', () => {
        this.hoveredRecipe = recipe;
        this.renderDetails();
      });
      el.addEventListener('pointerleave', () => {
        this.hoveredRecipe = null;
        this.renderDetails();
      });
      this.el.recipes.appendChild(el);
      this.cards.push({ recipe, el, cost });
    }
  }

  /** Aktualisiert Verfügbarkeit und "vorhanden/benötigt" aller Rezepte. */
  private renderRecipes(): void {
    for (const card of this.cards) {
      const affordable = this.crafting.canMake(card.recipe);
      card.el.classList.toggle('is-available', affordable);
      const station: HTMLElement[] = [];
      if (needsWorkbench(card.recipe)) {
        const chip = document.createElement('span');
        chip.className = 'cost cost--station' + (this.crafting.nearWorkbench() ? '' : ' is-missing');
        chip.textContent = 'Werkbank';
        station.push(chip);
      }
      card.cost.replaceChildren(
        ...station,
        ...card.recipe.cost.map((c) => {
          const have = this.inventory.count(c.item);
          const chip = document.createElement('span');
          chip.className = 'cost' + (have < c.count ? ' is-missing' : '');
          const img = document.createElement('img');
          img.src = this.icons.items[c.item];
          img.alt = getItem(c.item).name;
          img.title = getItem(c.item).name;
          chip.append(img, `${Math.min(have, c.count)}/${c.count}`);
          return chip;
        }),
      );
    }
  }

  private renderDetails(): void {
    const icon = this.el.detailIcon as HTMLImageElement;
    const recipe = this.hoveredRecipe;
    if (recipe) {
      icon.hidden = false;
      icon.src = recipe.kind === 'item' ? this.icons.items[recipe.result] : this.icons.structures[recipe.result];
      this.el.detailName.textContent = recipeName(recipe);
      this.el.detailDesc.textContent =
        recipeDescription(recipe) + (recipe.kind === 'structure' ? ' Klicken, um den Bauplan zu platzieren.' : '');
      return;
    }
    const stack = this.hovered ? this.hovered.inv.get(this.hovered.index) : null;
    this.el.detailRarity.textContent = '';
    this.el.detailStats.replaceChildren();
    this.el.detailName.style.color = '';
    if (!stack) {
      icon.hidden = true;
      this.el.detailName.textContent = '–';
      this.el.detailDesc.textContent = 'Fahre über einen Gegenstand.';
      return;
    }
    const def = getItem(stack.id);
    icon.hidden = false;
    icon.src = this.icons.items[stack.id];
    this.el.detailName.textContent = stack.count > 1 ? `${def.name} ×${stack.count}` : def.name;
    let desc = def.description;
    if (def.food) desc += ` (+${def.food.hunger} Sättigung)`;
    if (def.mod) desc += ` ${ELEMENTS[def.mod].text} Rechtsklick an der Werkbank: auf die Waffe in der Hand.`;
    this.el.detailDesc.textContent = desc;
    if (stack.weapon) this.renderWeapon(stack.id, stack.weapon, stack.durability);
  }

  /** Waffen: Seltenheit, Werte und Perks. */
  private renderWeapon(id: ItemId, w: WeaponMeta, durability: number | undefined): void {
    const rarity = getRarity(w.rarity);
    this.el.detailName.textContent = weaponName(id, w);
    this.el.detailName.style.color = rarity.color;
    this.el.detailRarity.style.color = rarity.color;
    const row = (label: string, value: string, perk = false) => {
      const li = document.createElement('li');
      if (perk) {
        li.className = 'is-perk';
        li.textContent = label;
      } else {
        const a = document.createElement('span');
        a.textContent = label;
        const b = document.createElement('span');
        b.textContent = value;
        li.append(a, b);
      }
      return li;
    };
    const max = maxDurability(id, w) ?? 0;
    if (getItem(id).gun) {
      const { gun, crit } = gunStats(id, w);
      this.el.detailRarity.textContent = `${rarity.name} · Schusswaffe`;
      this.el.detailStats.append(
        row(gun.pellets > 1 ? `Schaden (${gun.pellets} Schrotkörner)` : 'Schaden', String(Math.round(gun.damage * gun.pellets))),
        row('Schuss pro Sekunde', (1 / gun.fireTime).toFixed(1)),
        row('Magazin', `${loadedRounds(id, w)} / ${gun.magazine}`),
        row('Munition', getItem(gun.ammo).name),
        row('Kritisch', `${Math.round(crit * 100)} %`),
        row('Haltbarkeit', `${Math.round(durability ?? 0)} / ${max}`),
      );
    } else {
      const stats = weaponStats(id, w);
      const t = stats.tool;
      const cls = { blade: 'Klinge', blunt: 'Stumpf', heavy: 'Schwer' }[t.weaponClass ?? 'blunt'];
      this.el.detailRarity.textContent = `${rarity.name} · ${cls}`;
      this.el.detailStats.append(
        row('Schaden', String(Math.round(t.damage))),
        row('Schläge pro Sekunde', (1 / t.swingTime).toFixed(1)),
        row('Kritisch', `${Math.round(stats.crit * 100)} %`),
        row('Ausdauer je Schlag', String(Math.round(t.staminaCost))),
        row('Haltbarkeit', `${Math.round(durability ?? 0)} / ${max}`),
      );
    }
    this.el.detailStats.append(...w.perks.map((p) => row(`◆ ${getWeaponPerk(p).name}: ${getWeaponPerk(p).text}`, '', true)));
    if (w.mod) {
      const el = ELEMENTS[w.mod];
      const li = document.createElement('li');
      li.className = 'is-mod';
      li.style.setProperty('--element', el.css);
      const text = document.createElement('small');
      text.textContent = el.text;
      li.append(`✦ Mod: ${el.name}`, text);
      this.el.detailStats.append(li);
    } else if (canMod(w)) {
      this.el.detailStats.append(row('Mod: keiner (an der Werkbank anbringen)', '', true));
    }
  }

  private slotAt(target: EventTarget | null): SlotRef | null {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('.slot');
    if (el?.dataset.index === undefined || el.classList.contains('slot--ghost')) return null;
    const inv = el.dataset.inv === 'chest' ? this.chest : this.inventory;
    return inv ? { inv, index: Number(el.dataset.index) } : null;
  }

  private slotEl(ref: SlotRef): HTMLElement {
    return ref.inv === this.inventory ? this.slotEls[ref.index] : this.chestSlotEls[ref.index];
  }

  /** Bei geöffneter Kiste: Stapel ins jeweils andere Inventar. @returns true, wenn umgelagert wurde. */
  private transferAcross(ref: SlotRef): boolean {
    if (!this.chest) return false;
    const other = ref.inv === this.chest ? this.inventory : this.chest;
    ref.inv.transferTo(ref.index, other);
    return true;
  }

  // --- Maus/Pointer ---

  private handlePointerOver = (e: PointerEvent): void => {
    const ref = this.slotAt(e.target);
    if (ref?.inv !== this.hovered?.inv || ref?.index !== this.hovered?.index) {
      this.hovered = ref;
      this.renderDetails();
    }
  };

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const ref = this.slotAt(e.target);
    if (!ref || !ref.inv.get(ref.index)) return;
    // Mit offener Kiste lagert Rechtsklick um, sonst: benutzen/ausrüsten.
    if (!this.transferAcross(ref)) this.onUse?.(ref.index);
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const ref = this.slotAt(e.target);
    if (!ref || !ref.inv.get(ref.index)) return;
    e.preventDefault();

    if (e.shiftKey) {
      if (!this.transferAcross(ref)) this.inventory.quickMove(ref.index);
      return;
    }
    this.drag = { from: ref, startX: e.clientX, startY: e.clientY, ghost: null };
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.ghost && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) {
      drag.ghost = this.slotEl(drag.from).cloneNode(true) as HTMLElement;
      drag.ghost.classList.add('slot--ghost');
      drag.ghost.classList.remove('is-selected');
      document.body.appendChild(drag.ghost);
      this.slotEl(drag.from).classList.add('is-dragging');
    }
    if (drag.ghost) drag.ghost.style.transform = `translate(${e.clientX - 28}px, ${e.clientY - 28}px)`;
  };

  private handlePointerUp = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    if (drag.ghost) {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const to = this.slotAt(under);
      const from = drag.from;
      // Mod auf eine Waffe gezogen: anbringen statt tauschen.
      const modOnWeapon =
        to && to.inv === this.inventory && from.inv === this.inventory && to.index !== from.index && !!getItem(from.inv.get(from.index)!.id).mod && !!to.inv.get(to.index)?.weapon;
      if (modOnWeapon && this.onApplyMod?.(from.index, to.index)) {
        this.cancelDrag();
        return;
      }
      if (to && to.inv === from.inv) from.inv.move(from.index, to.index);
      else if (to) from.inv.transferTo(from.index, to.inv, to.index);
      // Nur aus dem eigenen Inventar lässt sich etwas fallenlassen.
      else if (!this.el.panel.contains(under) && from.inv === this.inventory) this.onDrop?.(from.index);
    }
    this.cancelDrag();
  };

  private cancelDrag(): void {
    if (this.drag) {
      this.drag.ghost?.remove();
      this.slotEl(this.drag.from).classList.remove('is-dragging');
    }
    this.drag = null;
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
  }
}
