import type { Inventory } from '../systems/Inventory';
import { getItem } from '../entities/items/ItemDefs';
import { RECIPES, recipeDescription, recipeName, type Crafting, type Recipe } from '../systems/Crafting';
import { collectRefs } from './dom';
import { renderSlot } from './slots';
import type { IconSets } from './ItemIcons';

interface RecipeCard {
  recipe: Recipe;
  el: HTMLButtonElement;
  cost: HTMLElement;
}

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
 * - Rechte Spalte: Rezepte (Items herstellen, Baupläne auswählen)
 */
export class InventoryUI {
  /** Wird für "Benutzen/Ausrüsten" per Rechtsklick aufgerufen. */
  onUse: ((slot: number) => void) | null = null;
  /** Wird aufgerufen, wenn ein Stapel aus dem Fenster gezogen wurde. */
  onDrop: ((slot: number) => void) | null = null;
  /** Klick auf ein Rezept. */
  onCraft: ((recipe: Recipe) => void) | null = null;

  private readonly el;
  private readonly slotEls: HTMLElement[] = [];
  private readonly cards: RecipeCard[] = [];
  private hoveredRecipe: Recipe | null = null;
  private drag: DragState | null = null;
  private hovered = -1;
  private _open = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly inventory: Inventory,
    private readonly icons: IconSets,
    private readonly getSelected: () => number,
    private readonly crafting: Crafting,
  ) {
    this.el = collectRefs(root, ['panel', 'grid', 'hotbarGrid', 'detailIcon', 'detailName', 'detailDesc', 'recipes'] as const);
    this.buildRecipeCards();

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
      renderSlot(el, this.inventory.get(i), this.icons.items);
      el.classList.toggle('is-selected', i === selected);
    });
    this.renderRecipes();
    this.renderDetails();
  }

  private buildRecipeCards(): void {
    let lastKind: Recipe['kind'] | null = null;
    for (const recipe of RECIPES) {
      if (recipe.kind !== lastKind) {
        const heading = document.createElement('h3');
        heading.className = 'inventory__subtitle';
        heading.textContent = recipe.kind === 'item' ? 'Werkzeuge' : 'Baupläne';
        this.el.recipes.appendChild(heading);
        lastKind = recipe.kind;
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
      const affordable = this.crafting.canAfford(card.recipe.cost);
      card.el.classList.toggle('is-available', affordable);
      card.cost.replaceChildren(
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
    const stack = this.hovered >= 0 ? this.inventory.get(this.hovered) : null;
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
