import * as THREE from 'three';
import type { Input, Action } from '../core/Input';
import type { EventBus } from '../core/EventBus';
import type { Player } from '../entities/Player';
import type { ViewModel } from '../entities/ViewModel';
import { getItem, type ItemDef, type ToolStats } from '../entities/items/ItemDefs';
import type { Inventory, ItemStack } from './Inventory';
import type { InteractionSystem } from './InteractionSystem';
import type { HarvestSystem } from './HarvestSystem';
import type { Audio } from './Audio';

const HOTBAR_KEYS: Action[] = ['hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6'];
const EAT_DURATION = 0.9;
const EAT_AT = 0.55;

/**
 * Ausrüstung & Werkzeuge: Schnellzugriffs-Auswahl (1–6, Mausrad), Schläge mit dem
 * gehaltenen Werkzeug (Treffer wird im Moment des Aufpralls per Raycast geprüft) und
 * Essen von Nahrung aus der Hand.
 */
export class ToolController {
  /** Ausgewählter Slot der Schnellzugriffsleiste. */
  selected = 0;

  private swing: { tool: ToolStats; time: number; impactDone: boolean } | null = null;
  private eating: { def: ItemDef; time: number; done: boolean } | null = null;
  private exhaustedHintCooldown = 0;
  private readonly fromDir = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();

  constructor(
    private readonly inventory: Inventory,
    private readonly input: Input,
    private readonly viewModel: ViewModel,
    private readonly interaction: InteractionSystem,
    private readonly harvest: HarvestSystem,
    private readonly player: Player,
    private readonly audio: Audio,
    private readonly events: EventBus,
  ) {}

  get equipped(): ItemStack | null {
    return this.inventory.get(this.selected);
  }

  get equippedTool(): ToolStats | undefined {
    const stack = this.equipped;
    return stack ? getItem(stack.id).tool : undefined;
  }

  select(index: number): void {
    if (index === this.selected) return;
    this.selected = index;
    this.swing = null;
    this.eating = null;
  }

  /** @param active false, solange Menüs/Inventar offen sind (nur Animationen laufen weiter). */
  update(dt: number, active: boolean): void {
    this.exhaustedHintCooldown -= dt;

    if (active) {
      HOTBAR_KEYS.forEach((key, i) => {
        if (this.input.wasPressed(key)) this.select(i);
      });
      const wheel = this.input.consumeWheel();
      if (wheel !== 0) {
        const n = this.inventory.hotbarSize;
        this.select((this.selected + wheel + n) % n);
      }
    }

    // Das ViewModel zeigt immer, was im gewählten Slot liegt (auch nach Inventar-Änderungen).
    const stack = this.equipped;
    this.viewModel.equip(stack?.id ?? null);

    if (this.swing) this.updateSwing(dt);
    if (this.eating) this.updateEating(dt);
    if (!active || this.player.stats.isDead || !stack || this.swing || this.eating || this.viewModel.busy) return;

    const def = getItem(stack.id);
    if (def.tool && this.input.isMouseDown(0)) this.startSwing(def.tool);
    else if (def.food && this.input.wasMousePressed(0)) this.startEating(def);
  }

  private startSwing(tool: ToolStats): void {
    if (!this.player.stats.useStamina(tool.staminaCost)) {
      if (this.exhaustedHintCooldown <= 0) {
        this.events.emit('hud:message', { text: 'Zu erschöpft zum Zuschlagen.' });
        this.exhaustedHintCooldown = 2;
      }
      return;
    }
    this.swing = { tool, time: 0, impactDone: false };
    this.viewModel.playSwing(tool.swingTime);
  }

  private updateSwing(dt: number): void {
    const swing = this.swing!;
    swing.time += dt;
    if (!swing.impactDone && swing.time >= swing.tool.swingTime * swing.tool.impactAt) {
      swing.impactDone = true;
      this.resolveImpact(swing.tool);
    }
    if (swing.time >= swing.tool.swingTime) this.swing = null;
  }

  /** Trefferprüfung im Moment des Aufpralls. */
  private resolveImpact(tool: ToolStats): void {
    const target = this.interaction.raycast(tool.reach);
    // Horizontale Schlagrichtung aus der Blickrichtung des Spielers.
    this.fromDir.set(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));

    if (target && (target.type === 'tree' || target.type === 'rock')) {
      const h = target.hit;
      this.point.set(h.point.x, h.point.y, h.point.z);
      this.normal.set(h.normal.x, h.normal.y, h.normal.z);
      if (target.type === 'tree') this.harvest.hitTree(target.instance, tool, this.point, this.normal, this.fromDir);
      else this.harvest.hitRock(target.instance, tool, this.point, this.normal);
      this.viewModel.playHit();
    } else {
      this.audio.play('swing');
    }
  }

  /** Sofort essen (Rechtsklick im Inventar, ohne Animation). */
  consumeFromSlot(slot: number): boolean {
    const stack = this.inventory.get(slot);
    const def = stack ? getItem(stack.id) : undefined;
    if (!def?.food) return false;
    this.inventory.takeFromSlot(slot, 1);
    this.applyFood(def);
    return true;
  }

  private applyFood(def: ItemDef): void {
    const food = def.food!;
    const stats = this.player.stats;
    stats.eat(food.hunger);
    stats.thirst = Math.min(stats.max, stats.thirst + food.thirst);
    stats.health = Math.min(stats.max, stats.health + food.health);
    this.audio.play('eat');
    this.events.emit('player:ate', { item: def.id });
  }

  private startEating(def: ItemDef): void {
    this.eating = { def, time: 0, done: false };
    this.viewModel.playEat(EAT_DURATION);
  }

  private updateEating(dt: number): void {
    const eating = this.eating!;
    eating.time += dt;
    if (!eating.done && eating.time >= EAT_DURATION * EAT_AT) {
      eating.done = true;
      const food = eating.def.food;
      // Nur essen, wenn das Item noch im Slot liegt (könnte inzwischen verschoben worden sein).
      if (food && this.equipped?.id === eating.def.id) {
        this.inventory.takeFromSlot(this.selected, 1);
        this.applyFood(eating.def);
      }
    }
    if (eating.time >= EAT_DURATION) this.eating = null;
  }
}
