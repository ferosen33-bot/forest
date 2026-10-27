import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { EventBus } from '../core/EventBus';
import type { Player } from '../entities/Player';
import type { ViewModel } from '../entities/ViewModel';
import type { Enemy } from '../entities/enemies/Enemy';
import type { EnemyDirector } from './ai/EnemyDirector';
import type { Audio } from './Audio';
import type { Blood } from './Blood';
import type { Skills } from './Skills';
import type { Gore } from './Gore';

export interface CombatDeps {
  input: Input;
  player: Player;
  viewModel: ViewModel;
  enemies: EnemyDirector;
  audio: Audio;
  events: EventBus;
  skills: Skills;
  blood?: Pick<Blood, 'spray' | 'pool'>;
  gore?: Gore;
}

/** Tritt am Boden: Reichweite, Schaden, Rückstoß, Ausdauer. */
const KICK = { range: 2.1, damage: 7, force: 7, stagger: 0.8, stamina: 10, time: 0.42, impactAt: 0.13 };
/** Sprungtritt (aus dem Sprint gesprungen): weiter, härter, wirft um. */
const DROPKICK = { range: 2.9, damage: 26, force: 9, down: 2.6, stamina: 20, time: 0.5, impactAt: 0.15, lunge: 4.5, minSpeed: 4.2 };
/** Bodenstampfer auf einen umgeworfenen Gegner. */
const STOMP = { range: 2.4, damage: 70, stamina: 12, time: 0.45, impactAt: 0.17 };
/** Konterfenster nach perfekter Parade bzw. perfektem Ausweichen (s Spielzeit). */
export const COUNTER_WINDOW = 1.6;
/** Schaden eines Konters (zusätzlich zum kritischen Treffer). */
export const COUNTER_MULTIPLIER = 1.5;

type Move = 'kick' | 'dropkick' | 'stomp';

/**
 * Kampfmanöver neben dem Waffenschlag:
 *
 * - **Treten** (F): stößt Gegner zurück und bringt leichte aus dem Tritt – Luft verschaffen.
 * - **Sprungtritt:** aus dem Sprint springen und in der Luft treten – wirft Gegner um.
 * - **Bodenstampfer:** auf einen umgeworfenen Gegner treten – verheerend.
 * - **Ausweichen** (Q): kurzer Schritt in Laufrichtung (ohne Richtung nach hinten). Wer einem Schlag im
 *   letzten Moment ausweicht, bekommt eine kurze Zeitlupe und ein Konterfenster.
 * - **Perfekte Parade:** Deckung (Rechtsklick) im letzten Moment heben – kein Schaden, der Angreifer taumelt,
 *   der nächste Schlag ist ein Konter (kritisch, +50 %).
 * - **Trefferstopp:** Bei wuchtigen Treffern steht die Welt für Sekundenbruchteile still.
 */
export class CombatMoves {
  private counter = 0;
  private hitstop = 0;
  private slowmo = 0;
  private slowmoScale = 1;
  private cooldown = 0;
  private pending: { move: Move; time: number; at: number; target: Enemy | null } | null = null;
  private readonly fwd = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly d: CombatDeps) {
    d.events.on('player:parried', () => {
      this.counter = COUNTER_WINDOW;
      this.slow(0.25, 0.35);
      this.impact(0.6);
      d.audio.play('parry');
      d.events.emit('combat:tag', { text: 'PARIERT!', color: '#ffe08a', big: true });
      d.skills.gain('melee', 3);
    });
    d.events.on('player:dodged', ({ perfect }) => {
      if (!perfect) return;
      this.counter = COUNTER_WINDOW;
      this.slow(0.5, 0.3);
      d.events.emit('combat:tag', { text: 'AUSGEWICHEN!', color: '#bfe8ff', big: true });
      d.skills.gain('melee', 2);
    });
  }

  /** Konterfenster offen? */
  get countering(): boolean {
    return this.counter > 0;
  }

  /** Verbraucht das Konterfenster (der nächste Treffer ist ein Konter). */
  consumeCounter(): boolean {
    if (this.counter <= 0) return false;
    this.counter = 0;
    return true;
  }

  /** Trefferstopp: 0..1 → bis gut eine Zehntelsekunde Stillstand. */
  impact(strength: number): void {
    this.hitstop = Math.max(this.hitstop, 0.03 + 0.09 * Math.min(1, strength));
  }

  /** Zeitlupe für `seconds` (echte Zeit) mit Tempo `scale`. */
  slow(seconds: number, scale: number): void {
    this.slowmo = Math.max(this.slowmo, seconds);
    this.slowmoScale = Math.min(this.slowmoScale, scale);
  }

  /** Tempo der Spielwelt in diesem Bild (Trefferstopp, Zeitlupe). Läuft in echter Zeit ab. */
  timeScale(realDt: number): number {
    let scale = 1;
    if (this.hitstop > 0) {
      this.hitstop -= realDt;
      scale = 0.04;
    } else if (this.slowmo > 0) {
      this.slowmo -= realDt;
      // Gegen Ende wieder auf volle Geschwindigkeit kommen.
      scale = THREE.MathUtils.lerp(1, this.slowmoScale, Math.min(1, this.slowmo / 0.15));
      if (this.slowmo <= 0) this.slowmoScale = 1;
    }
    return scale;
  }

  /** @param active false bei offenen Menüs; `busy`: Schlag oder Essen läuft. */
  update(dt: number, active: boolean, busy: boolean): void {
    this.cooldown -= dt;
    this.counter = Math.max(0, this.counter - dt);
    if (this.pending) this.updatePending(dt);
    const p = this.d.player;
    if (!active || p.stats.isDead) return;
    const input = this.d.input;
    if (input.wasPressed('dodge') && p.dodge()) {
      this.d.audio.play('dodge');
      this.d.viewModel.playDodge();
    }
    if (input.wasPressed('kick') && !busy && !this.pending && this.cooldown <= 0) this.startKick();
  }

  private startKick(): void {
    const p = this.d.player;
    if (p.swimming) return;
    this.fwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const downed = this.findTarget(STOMP.range, 0.5, (e) => e.downed);
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    const move: Move = downed ? 'stomp' : !p.grounded && !p.swimming && speed > DROPKICK.minSpeed ? 'dropkick' : 'kick';
    const cfg = move === 'stomp' ? STOMP : move === 'dropkick' ? DROPKICK : KICK;
    if (!p.stats.useStamina(cfg.stamina)) {
      this.d.events.emit('hud:message', { text: 'Zu erschöpft zum Treten.' });
      return;
    }
    if (move === 'dropkick') {
      // Mit dem ganzen Körper hinein: Schwung nach vorne.
      p.velocity.addScaledVector(this.fwd, DROPKICK.lunge);
      p.velocity.y = Math.max(p.velocity.y, 1.5);
    }
    this.d.viewModel.playKick(cfg.time, move);
    this.d.audio.play('swing', 0.7);
    this.pending = { move, time: 0, at: cfg.impactAt, target: downed };
    this.cooldown = cfg.time + 0.1;
  }

  private updatePending(dt: number): void {
    const k = this.pending!;
    k.time += dt;
    if (k.time < k.at) return;
    this.pending = null;
    if (k.move === 'stomp' && k.target && !k.target.isDead) this.stomp(k.target);
    else this.resolveKick(k.move === 'dropkick');
  }

  private resolveKick(air: boolean): void {
    const p = this.d.player;
    const cfg = air ? DROPKICK : KICK;
    this.fwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const hit: Enemy[] = [];
    // Der Sprungtritt erwischt bis zu zwei, der einfache Tritt den nächsten.
    for (let i = 0; i < (air ? 2 : 1); i++) {
      const e = this.findTarget(cfg.range, 0.55, (x) => !hit.includes(x) && !x.downed);
      if (e) hit.push(e);
    }
    if (hit.length === 0) return;
    const sk = this.d.skills;
    for (const e of hit) {
      const point = this.tmp.copy(e.feet).setY(e.feet.y + (air ? 1.2 : 0.95) * e.rig.scale).clone();
      this.d.enemies.damage(e, cfg.damage * sk.meleeDamage, 'body', p.position.clone(), point, this.fwd.clone().negate(), air ? 'heavy' : 'normal');
      if (e.isDead) continue;
      if (air) e.knockdown(DROPKICK.down, p.position, DROPKICK.force);
      else e.shove(p.position, KICK.force, KICK.stagger);
    }
    this.d.audio.play('kick');
    p.addShake(air ? 0.5 : 0.25);
    this.impact(air ? 0.8 : 0.35);
    sk.gain('melee', air ? 3 : 1);
    if (air) {
      // Nach dem Treffer prallt man zurück.
      p.velocity.addScaledVector(this.fwd, -3);
      this.d.events.emit('combat:tag', { text: 'SPRUNGTRITT!', color: '#ffd27a', big: true });
    }
  }

  private stomp(e: Enemy): void {
    const p = this.d.player;
    const head = this.tmp.copy(e.feet).setY(e.feet.y + 0.25).clone();
    const counter = this.consumeCounter();
    const damage = STOMP.damage * this.d.skills.meleeDamage * (counter ? COUNTER_MULTIPLIER : 1);
    this.d.enemies.damage(e, damage, 'body', p.position.clone(), head, new THREE.Vector3(0, 1, 0), 'heavy');
    this.d.blood?.spray(head, new THREE.Vector3(0, 0.3, 0), 1);
    if (e.isDead) {
      this.d.blood?.pool(e.feet, 1.4);
      this.d.gore?.crushHead(e);
    }
    this.d.audio.play('stomp');
    p.addShake(0.7);
    this.impact(1);
    this.d.skills.gain('melee', 4);
    this.d.events.emit('combat:tag', { text: 'BODENSTAMPFER!', color: '#ff7a5a', big: true });
  }

  /** Nächster lebender Gegner vor dem Spieler (Kegel mit `minDot`), der `accept` erfüllt. */
  private findTarget(range: number, minDot: number, accept: (e: Enemy) => boolean): Enemy | null {
    const p = this.d.player.position;
    let best: Enemy | null = null;
    let bestD = range;
    const consider = (e: Enemy) => {
      if (e.isDead || !e.active || !accept(e)) return;
      const dx = e.feet.x - p.x;
      const dz = e.feet.z - p.z;
      const dist = Math.hypot(dx, dz) - 0.3 * e.rig.scale;
      if (dist > bestD || Math.abs(e.feet.y - p.y) > 1.6) return;
      const dot = dist > 0.3 ? (dx * this.fwd.x + dz * this.fwd.z) / Math.hypot(dx, dz) : 1;
      if (dot < minDot) return;
      best = e;
      bestD = dist;
    };
    for (const e of this.d.enemies.enemies) consider(e);
    for (const e of this.d.enemies.caveDwellers) consider(e);
    return best;
  }
}
