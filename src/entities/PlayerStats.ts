import type { Vector3 } from 'three';
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
  /** Durchnässt (0 = trocken, 1 = klatschnass). Nass und ohne Feuer kühlt man aus. */
  wetness = 0;
  /** Nacht (kälter) – vom Spiel gesetzt. */
  night = false;
  /** Fellmantel angezogen: Nässe kühlt deutlich weniger aus. */
  clothing = false;
  /** Knochenrüstung angelegt: fängt einen Teil des Schadens durch Gegner ab. */
  armor = false;
  /** Grundkälte der Jahreszeit (0..1, nachts voll, tagsüber ein Drittel) – vom Klima gesetzt. */
  chill = 0;
  /** Fertigkeiten: Faktor auf Hunger/Durst (Überleben) und Ausdauer-Verbrauch/-Erholung (Ausdauer). */
  needsFactor = 1;
  staminaFactor = 1;
  regenFactor = 1;

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
      this.stamina -= staminaDrain * this.staminaFactor * dt;
      this.regenDelay = c.staminaRegenDelay;
    } else if (this.regenDelay > 0) {
      this.regenDelay -= dt;
    } else {
      // Wer hungrig oder durstig ist, regeneriert langsamer.
      const needs = Math.min(this.hunger, this.thirst) / c.max;
      this.stamina += c.staminaRegen * this.regenFactor * (0.4 + 0.6 * needs) * (this.warm ? 1.6 : 1) * (1 - 0.45 * this.cold) * dt;
    }
    this.stamina = clamp(this.stamina, 0, c.max);
    if (this.stamina <= 0) this.exhausted = true;
    else if (this.exhausted && this.stamina >= c.exhaustedThreshold) this.exhausted = false;

    // Hunger & Durst
    const needsMul = (activity.sprinting ? c.sprintNeedsMultiplier : 1) * this.needsFactor;
    this.hunger = clamp(this.hunger - c.hungerRate * needsMul * dt, 0, c.max);
    this.thirst = clamp(this.thirst - c.thirstRate * needsMul * dt, 0, c.max);

    // Verhungern / Verdursten
    if (this.hunger <= 0) this.damage(c.starveDamage * dt, 'starvation', false);
    if (this.thirst <= 0) this.damage(c.starveDamage * 1.5 * dt, 'dehydration', false);

    // Unterkühlung: nachts nass und fern vom Feuer verliert man langsam Gesundheit.
    if (this.freezing) this.damage(c.coldDamage * dt, 'cold', false);

    // Natürliche Heilung, wenn gut versorgt (nicht, solange man friert).
    if (this.cold < 0.5 && this.hunger > c.regenNeedsThreshold && this.thirst > c.regenNeedsThreshold) {
      this.health = Math.min(c.max, this.health + c.healthRegen * (this.warm ? 4 : 1) * dt);
    }
  }

  /** Wie sehr man friert (0..1): Nässe zählt nur fern vom Feuer, nachts doppelt. */
  get cold(): number {
    if (this.warm) return 0;
    const wet = this.wetness * (this.night ? 1 : 0.6) * (this.clothing ? 0.4 : 1);
    const chill = this.chill * (this.night ? 1 : 0.35) * (this.clothing ? 0.25 : 1);
    return clamp(Math.max(wet, chill), 0, 1);
  }

  /** Unterkühlung: nachts klatschnass ohne Wärmequelle (im Fellmantel nicht). */
  get freezing(): boolean {
    return this.night && this.cold > 0.7;
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
  damage(amount: number, source: DamageSource, notify = true, from?: Vector3): void {
    if (this.isDead || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    if (notify) this.events.emit('player:damaged', { amount, source, from });
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
    this.wetness = 0;
  }
}
