import type { DamageSource, EventBus } from '../core/EventBus';
import type { GameConfig } from '../config';
import { clamp } from '../utils/math';

/** Was der Spieler im aktuellen Tick tut – beeinflusst Verbrauch und Regeneration. */
export interface ActivityState {
  sprinting: boolean;
  swimming: boolean;
}

/**
 * Überlebenswerte des Spielers: Gesundheit, Ausdauer, Sättigung (Hunger) und Hydration (Durst).
 * Alle Werte laufen von 0 bis `max`; Hunger/Durst = 100 bedeutet "satt"/"kein Durst".
 */
export class PlayerStats {
  health: number;
  stamina: number;
  hunger: number;
  thirst: number;
  /** Nach völliger Erschöpfung kann erst wieder gesprintet werden, wenn die Schwelle erreicht ist. */
  exhausted = false;
  /** In der Wärme eines Lagerfeuers: schnellere Regeneration (wird jedes Frame vom Spiel gesetzt). */
  warm = false;

  private regenDelay = 0;
  private readonly cfg: GameConfig['stats'];

  constructor(
    config: GameConfig,
    private readonly events: EventBus,
  ) {
    this.cfg = config.stats;
    this.health = this.stamina = this.hunger = this.thirst = this.cfg.max;
  }

  get max(): number {
    return this.cfg.max;
  }

  get isDead(): boolean {
    return this.health <= 0;
  }

  get canSprint(): boolean {
    return !this.exhausted && this.stamina > 0;
  }

  update(dt: number, activity: ActivityState): void {
    if (this.isDead) return;
    const c = this.cfg;

    // Ausdauer
    let staminaDrain = 0;
    if (activity.sprinting) staminaDrain += c.staminaSprintCost;
    if (activity.swimming) staminaDrain += c.staminaSwimCost;
    if (staminaDrain > 0) {
      this.stamina -= staminaDrain * dt;
      this.regenDelay = c.staminaRegenDelay;
    } else if (this.regenDelay > 0) {
      this.regenDelay -= dt;
    } else {
      // Wer hungrig oder durstig ist, regeneriert langsamer.
      const needs = Math.min(this.hunger, this.thirst) / c.max;
      this.stamina += c.staminaRegen * (0.4 + 0.6 * needs) * (this.warm ? 1.6 : 1) * dt;
    }
    this.stamina = clamp(this.stamina, 0, c.max);
    if (this.stamina <= 0) this.exhausted = true;
    else if (this.exhausted && this.stamina >= c.exhaustedThreshold) this.exhausted = false;

    // Hunger & Durst
    const needsMul = activity.sprinting ? c.sprintNeedsMultiplier : 1;
    this.hunger = clamp(this.hunger - c.hungerRate * needsMul * dt, 0, c.max);
    this.thirst = clamp(this.thirst - c.thirstRate * needsMul * dt, 0, c.max);

    // Verhungern / Verdursten
    if (this.hunger <= 0) this.damage(c.starveDamage * dt, 'starvation', false);
    if (this.thirst <= 0) this.damage(c.starveDamage * 1.5 * dt, 'dehydration', false);

    // Natürliche Heilung, wenn gut versorgt.
    if (this.hunger > c.regenNeedsThreshold && this.thirst > c.regenNeedsThreshold) {
      this.health = Math.min(c.max, this.health + c.healthRegen * (this.warm ? 4 : 1) * dt);
    }
  }

  /** Verbraucht Ausdauer, falls genug vorhanden ist. */
  useStamina(amount: number): boolean {
    if (this.stamina < amount) return false;
    this.stamina -= amount;
    this.regenDelay = this.cfg.staminaRegenDelay;
    return true;
  }

  /**
   * @param notify Bei kontinuierlichem Schaden (Hunger) kein Treffer-Feedback auslösen.
   */
  damage(amount: number, source: DamageSource, notify = true): void {
    if (this.isDead || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    if (notify) this.events.emit('player:damaged', { amount, source });
    if (this.health <= 0) this.events.emit('player:died', { cause: source });
  }

  drink(amount: number): void {
    this.thirst = Math.min(this.cfg.max, this.thirst + amount);
    this.events.emit('player:drank', { amount });
  }

  eat(amount: number): void {
    this.hunger = Math.min(this.cfg.max, this.hunger + amount);
  }

  reset(): void {
    this.health = this.stamina = this.hunger = this.thirst = this.cfg.max;
    this.exhausted = false;
    this.regenDelay = 0;
  }
}
