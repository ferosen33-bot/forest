/**
 * Furcht (0 = ruhig, 1 = Panik): steigt in Dunkelheit ohne Licht, bei nahen oder jagenden Gegnern
 * und durch Schreckmomente; am Feuer, im Licht und bei Tag legt sie sich wieder.
 * Reine Logik – die Folgen (Bild, Herzschlag, Halluzinationen) setzt das Spiel um.
 */

export interface FearInput {
  dt: number;
  /** Wie dunkel es um den Spieler ist (0 = Tag/Licht, 1 = völlige Finsternis). */
  darkness: number;
  /** Bedrohung durch Gegner in der Nähe (0..1). */
  threat: number;
  /** Am wärmenden Feuer (beruhigt deutlich). */
  nearFire: boolean;
  /** Spieler ist tot oder schläft (Furcht verfliegt). */
  resting: boolean;
}

/** Anstieg und Abklingen je Sekunde. */
const RISE = 0.07;
const FALL = 0.045;
const FALL_FIRE = 0.16;

export class Fear {
  value = 0;
  /** Kurzfristiger Schreck, der sich über einige Sekunden abbaut. */
  private shock = 0;

  /** Schreckmoment (Geräusch, Gestalt, Treffer). */
  scare(amount: number): void {
    this.shock = Math.min(1, this.shock + amount);
    this.value = Math.min(1, this.value + amount * 0.6);
  }

  /** Beruhigung (Mondblüte, Nordlicht): senkt Furcht und Schreck. */
  calm(amount: number): void {
    this.value = Math.max(0, this.value - amount);
    this.shock = Math.max(0, this.shock - amount);
  }

  /** Worauf die Furcht gerade zustrebt. */
  target(f: FearInput): number {
    if (f.resting) return 0;
    const calm = f.nearFire ? 0.35 : 1;
    return Math.min(1, (0.5 * f.darkness + 0.65 * f.threat) * calm + this.shock * 0.5);
  }

  update(f: FearInput): number {
    const t = this.target(f);
    const rate = t > this.value ? RISE * (0.5 + f.threat) : f.nearFire || f.resting ? FALL_FIRE : FALL;
    const step = rate * f.dt;
    this.value += Math.max(-step, Math.min(step, t - this.value));
    this.shock = Math.max(0, this.shock - f.dt * 0.08);
    return this.value;
  }

  /** Ab dieser Furcht beginnt die Insel, Streiche zu spielen. */
  get hallucinating(): boolean {
    return this.value > 0.6;
  }
}
