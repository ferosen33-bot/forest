import * as THREE from 'three';
import { FireEffect } from '../entities/FireEffect';
import type { Enemy } from '../entities/enemies/Enemy';
import { elementFactor } from '../entities/enemies/EnemyKinds';
import {
  ACID_TIME,
  BLEED_MAX,
  BLEED_TIME,
  BURN_TIME,
  SHOCK_CHAIN,
  SHOCK_DAMAGE,
  SHOCK_STUN,
  SHOCK_WET,
  VAPOR_BLAST,
  decayStatus,
  dotDamage,
  hasStatus,
  procChance,
  rollProc,
  type ElementId,
} from '../entities/items/Elements';
import type { EventBus } from '../core/EventBus';
import type { HeightMap } from '../world/HeightMap';
import type { Audio } from './Audio';
import type { Blood } from './Blood';
import type { LightPool, LightRequest } from './LightPool';
import type { Particles } from './Particles';

export interface ElementDeps {
  /** Alle Gegner in der Nähe (draußen und in der aktuellen Höhle, auch tote – deren Brand läuft aus). */
  enemies: () => Iterable<Enemy>;
  /** Schaden durch ein Element (Schwächen eingerechnet). @returns true, wenn der Gegner starb. */
  hurt: (enemy: Enemy, amount: number, from: THREE.Vector3, element: ElementId) => boolean;
  particles: Particles;
  /** Leuchtende Partikel (Funken, Glut). */
  embers: Particles;
  lights: LightPool;
  audio: Audio;
  events: EventBus;
  heightMap: HeightMap;
  /** Regenstärke 0..1 (macht Gegner draußen nass). */
  rain: () => number;
  blood?: Pick<Blood, 'spray'>;
  player: { readonly position: THREE.Vector3; hurt(amount: number, from: THREE.Vector3): void };
}

/** Höchstens so viele brennende Gegner bekommen eine eigene Flamme. */
const MAX_FLAMES = 6;
/** Schaden über Zeit wird in diesem Takt verrechnet (s). */
const DOT_TICK = 0.5;
const ARC_SEGMENTS = 9;
const MAX_ARC_INSTANCES = 600;

interface Arc {
  from: THREE.Vector3;
  to: THREE.Vector3;
  life: number;
  /** Zufallsknicke, regelmäßig neu gewürfelt (Flackern). */
  jitter: THREE.Vector3[];
  rejitter: number;
  /** Ausschlag der Knicke relativ zur Länge. */
  roughness: number;
}

interface Flash {
  light: LightRequest;
  time: number;
  duration: number;
  peak: number;
}

interface Track {
  /** Aufgelaufener Schaden über Zeit je Element (wird alle `DOT_TICK` s verrechnet). */
  pending: Partial<Record<ElementId, number>>;
  tick: number;
  fx: number;
  wasBurning: boolean;
}

/**
 * Elemente der Waffenmods im Spiel: löst sie bei Treffern aus, lässt Brand, Säure und Blutung wirken,
 * springt mit Schocks über und zeigt alles (Flammen am Körper, Lichtbögen, Säuredampf, Blutstropfen).
 *
 * Kombinationen:
 * - **Wasser + Schock:** Nasse Gegner (im Wasser, im Regen) nehmen doppelten Schockschaden, der Schlag
 *   springt auf mehr und weiter entfernte Gegner über („Kurzschluss“).
 * - **Säure + Feuer:** Feuer an einem verätzten Gegner lässt die Säure verpuffen – eine Stichflamme
 *   verletzt und entzündet alles ringsum.
 * - **Brennendes Öl:** Wer durch die Flammen einer Brandflasche läuft, fängt selbst Feuer und brennt weiter.
 * - Brennende stecken Nachbarn an; im Wasser erlischt das Feuer, Regen löscht es schneller.
 */
export class ElementEffects {
  readonly group = new THREE.Group();
  private readonly tracks = new WeakMap<Enemy, Track>();
  private readonly flames = new Map<Enemy, FireEffect>();
  private readonly freeFlames: FireEffect[] = [];
  private readonly flameLights = new Map<FireEffect, LightRequest>();
  private readonly arcs: Arc[] = [];
  private readonly flashes: Flash[] = [];
  /** Stichflammen der Verpuffung: wachsen auf und fallen in sich zusammen. */
  private readonly blasts: { fire: FireEffect; at: THREE.Vector3; time: number }[] = [];
  private readonly arcMesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(private readonly d: ElementDeps) {
    this.group.name = 'ElementEffects';
    // Lichtbögen: dünne, additive Zylinder mit HDR-Farbe (leuchten über das Bloom nach).
    this.arcMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 5, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      MAX_ARC_INSTANCES,
    );
    this.arcMesh.frustumCulled = false;
    this.arcMesh.count = 0;
    this.arcMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arcMesh.setColorAt(0, this.color.set(0xffffff));
    this.group.add(this.arcMesh);
  }

  // ---------------------------------------------------------------------------
  // Auslöser
  // ---------------------------------------------------------------------------

  /**
   * Nahkampftreffer mit Mod. Würfelt, ob das Element greift, und wendet es an.
   * @returns true, wenn das Element ausgelöst wurde.
   */
  strike(enemy: Enemy, element: ElementId, weaponClass: 'blade' | 'blunt' | 'heavy' | undefined, point: THREE.Vector3, crit: boolean): boolean {
    if (enemy.isDead) return false;
    const s = enemy.status;
    if (!rollProc(s, procChance(element, weaponClass), crit)) return false;
    const factor = elementFactor(enemy.kind, element);
    let combo: string | undefined;
    switch (element) {
      case 'fire':
        if (s.acid > 0) {
          this.vaporBlast(enemy);
          combo = 'VERPUFFUNG';
        } else if (this.submerged(enemy)) {
          this.d.audio.play('sizzle', { position: point });
          this.d.particles.burst(point, { count: 8, color: 0xd8dde0, speed: 1.2, gravity: -1, life: 1.2, size: 0.05 });
          return false;
        }
        // Wer Feuer fängt, schlägt kurz um sich.
        if (s.burn <= 0 && !enemy.kind.boss) enemy.stun(0.5);
        this.ignite(enemy, BURN_TIME);
        this.d.audio.play('ignite', { position: point, volume: 0.8 });
        break;
      case 'shock':
        if (this.shock(enemy, point)) combo = 'KURZSCHLUSS';
        break;
      case 'caustic':
        s.acid = ACID_TIME;
        this.d.audio.play('acidHiss', { position: point });
        this.d.embers.burst(point, { count: 10, color: 0x8cff3a, speed: 1.4, gravity: 1.5, life: 0.7, size: 0.03 });
        break;
      case 'bleed':
        s.bleedStacks = Math.min(BLEED_MAX, s.bleedStacks + 1);
        s.bleed = BLEED_TIME;
        this.d.blood?.spray(point, this.tmp.subVectors(point, this.d.player.position).setY(0).normalize(), 0.5);
        break;
    }
    this.d.events.emit('weapon:element', { element, combo, weak: factor > 1, resist: factor < 1 });
    return true;
  }

  /** Setzt den Gegner in Brand (Brandflaschen-Feuer, Waffenmod). Im Wasser zwecklos. */
  ignite(enemy: Enemy, seconds: number): void {
    if (enemy.isDead || this.submerged(enemy)) return;
    enemy.status.burn = Math.max(enemy.status.burn, seconds);
  }

  /**
   * Schock: Schaden, Lähmung und Überspringen auf Nachbarn.
   * @returns true bei einem Kurzschluss (nasses Ziel).
   */
  private shock(enemy: Enemy, point: THREE.Vector3): boolean {
    const wet = this.isWet(enemy);
    const mult = wet ? SHOCK_WET.damage : 1;
    const count = wet ? SHOCK_WET.count : SHOCK_CHAIN.count;
    const range = wet ? SHOCK_WET.range : SHOCK_CHAIN.range;
    this.electrify(enemy, SHOCK_DAMAGE * mult, SHOCK_STUN, point);
    // Überspringen: vom getroffenen Gegner zum nächsten, immer weiter (ohne Doppelte).
    const hit = new Set<Enemy>([enemy]);
    let from = enemy;
    for (let i = 0; i < count; i++) {
      let best: Enemy | null = null;
      let bestD = range;
      for (const o of this.d.enemies()) {
        if (hit.has(o) || o.isDead || !o.active) continue;
        const dist = o.feet.distanceTo(from.feet);
        // Nasse leiten besser: Sie ziehen den Schlag auch aus größerer Entfernung an.
        const reach = this.isWet(o) ? range * 1.3 : range;
        if (dist < Math.min(bestD, reach)) {
          best = o;
          bestD = dist;
        }
      }
      if (!best) break;
      hit.add(best);
      this.addArc(this.chest(from, new THREE.Vector3()), this.chest(best, new THREE.Vector3()), 0.28, 0.18);
      this.electrify(best, SHOCK_DAMAGE * mult * SHOCK_CHAIN.factor, SHOCK_STUN * 0.6, this.chest(best, new THREE.Vector3()));
      from = best;
    }
    this.d.audio.play('zap', { position: point, volume: wet ? 1 : 0.8 });
    this.flash(point, 0x8fd0ff, wet ? 40 : 24, 0.25);
    this.d.events.emit('noise', { position: point.clone(), radius: 14 });
    return wet;
  }

  private electrify(enemy: Enemy, damage: number, stun: number, at: THREE.Vector3): void {
    enemy.status.shock = Math.max(enemy.status.shock, stun + 0.3);
    this.d.embers.burst(at, { count: 12, color: 0x9fdcff, speed: 3.5, gravity: 6, life: 0.35, size: 0.02 });
    this.d.hurt(enemy, damage, at, 'shock');
    if (!enemy.isDead && !enemy.kind.boss) enemy.stun(stun);
  }

  /** Säure + Feuer: Stichflamme um den Gegner. */
  private vaporBlast(source: Enemy): void {
    const center = this.chest(source, new THREE.Vector3());
    source.status.acid = 0;
    const r = VAPOR_BLAST.radius;
    for (const o of this.d.enemies()) {
      if (o.isDead || !o.active) continue;
      const dist = o.feet.distanceTo(source.feet);
      if (dist > r) continue;
      this.d.hurt(o, VAPOR_BLAST.damage * (1 - (0.5 * dist) / r), center, 'fire');
      this.ignite(o, 3);
    }
    const toPlayer = this.d.player.position.distanceTo(source.feet);
    if (toPlayer < r * 0.75) this.d.player.hurt(12 * (1 - toPlayer / r), center);
    this.blasts.push({ fire: this.takeFlame(), at: center.clone(), time: 0 });
    this.d.embers.burst(center, { count: 26, color: 0xffa040, speed: 3.5, gravity: 3, life: 0.7, size: 0.02, spread: 1.4 });
    this.d.embers.burst(center, { count: 16, color: 0x9cff4a, speed: 2.5, gravity: 2, life: 0.8, size: 0.018, spread: 1.4 });
    this.d.audio.play('vaporBlast', { position: center });
    this.flash(center, 0xffb060, 90, 0.6);
    this.d.events.emit('noise', { position: center, radius: 30 });
  }

  // ---------------------------------------------------------------------------
  // Takt
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    const rain = this.d.rain();
    const burning: Enemy[] = [];
    for (const e of this.d.enemies()) {
      const s = e.status;
      const submerged = this.submerged(e);
      // Nässe: im Wasser durch und durch, im Regen draußen ein wenig.
      if (submerged) s.wet = 8;
      else if (rain > 0.3 && !this.underground(e)) s.wet = Math.max(s.wet, 1.5);
      if (!hasStatus(s)) {
        s.wet = Math.max(0, s.wet - dt);
        this.releaseFlame(e);
        continue;
      }
      let t = this.tracks.get(e);
      if (!t) this.tracks.set(e, (t = { pending: {}, tick: DOT_TICK, fx: 0, wasBurning: false }));

      // Schaden über Zeit sammeln und im festen Takt verrechnen (Lebende).
      if (!e.isDead) {
        const dot = dotDamage(s, dt);
        for (const k in dot) t.pending[k as ElementId] = (t.pending[k as ElementId] ?? 0) + dot[k as ElementId]!;
        t.tick -= dt;
        if (t.tick <= 0) {
          t.tick = DOT_TICK;
          for (const k in t.pending) {
            const amount = t.pending[k as ElementId]!;
            if (amount > 0 && !e.isDead) this.d.hurt(e, amount, e.feet, k as ElementId);
          }
          t.pending = {};
        }
      }
      decayStatus(s, dt, submerged);
      if (t.wasBurning && s.burn <= 0 && submerged) {
        this.d.audio.play('sizzle', { position: e.feet });
        this.d.particles.burst(this.chest(e, this.tmp), { count: 14, color: 0xd8dde0, speed: 1.5, gravity: -1.2, life: 1.4, size: 0.07 });
      }
      t.wasBurning = s.burn > 0;
      if (s.burn > 0) burning.push(e);
      else this.releaseFlame(e);
      this.statusVisuals(e, t, dt);
    }
    this.spreadFire(burning, dt);
    this.updateFlames(burning, dt);
    this.updateBlasts(dt);
    this.updateArcs(dt);
    this.updateFlashes(dt);
  }

  /** Brennende stecken Gegner an, die ihnen zu nahe kommen. */
  private spreadFire(burning: Enemy[], dt: number): void {
    if (burning.length === 0) return;
    for (const o of this.d.enemies()) {
      if (o.isDead || o.status.burn > 0 || !o.active) continue;
      for (const b of burning) {
        if (b === o || b.isDead) continue;
        if (b.feet.distanceToSquared(o.feet) < 1.4 * 1.4 && Math.random() < dt * 0.9) {
          this.ignite(o, 3);
          break;
        }
      }
    }
  }

  /** Funken, Säuredampf und Blutstropfen am Körper. */
  private statusVisuals(e: Enemy, t: Track, dt: number): void {
    const s = e.status;
    t.fx -= dt;
    if (t.fx > 0) return;
    t.fx = 0.07;
    const scale = e.rig.scale;
    const body = this.tmp2.copy(e.position);
    body.x += (Math.random() - 0.5) * 0.5 * scale;
    body.y += (0.4 + Math.random() * 1.2) * scale;
    body.z += (Math.random() - 0.5) * 0.5 * scale;
    if (s.shock > 0 && !e.isDead) {
      // Kleine Bögen kriechen über den Körper, der Körper zuckt.
      const a = this.chest(e, new THREE.Vector3()).add(this.randomOffset(0.45 * scale));
      const b = this.chest(e, new THREE.Vector3()).add(this.randomOffset(0.55 * scale));
      this.addArc(a, b, 0.09, 0.35);
      e.rig.anim.hit = Math.max(e.rig.anim.hit, 0.6);
      if (Math.random() < 0.3) this.d.embers.burst(body, { count: 2, color: 0x9fdcff, speed: 2, gravity: 6, life: 0.25, size: 0.015 });
    }
    if (s.acid > 0 && Math.random() < 0.7) {
      this.d.embers.burst(body, { count: 1, color: 0x7dff3a, speed: 0.4, gravity: -1.2, life: 0.9, size: 0.03 });
      this.d.particles.burst(body, { count: 1, color: 0x5fae22, speed: 0.3, gravity: 9.81, life: 0.6, size: 0.02 });
    }
    if (s.bleed > 0 && Math.random() < 0.25 * s.bleedStacks) {
      this.d.particles.burst(body, { count: 1, color: 0x5c0f10, speed: 0.2, gravity: 9.81, life: 0.8, size: 0.025 });
    }
  }

  // ---------------------------------------------------------------------------
  // Darstellung
  // ---------------------------------------------------------------------------

  /** Flammen am Körper der brennenden Gegner (die nächsten bekommen eine, mit Licht). */
  private updateFlames(burning: Enemy[], dt: number): void {
    const p = this.d.player.position;
    burning.sort((a, b) => a.feet.distanceToSquared(p) - b.feet.distanceToSquared(p));
    burning.slice(MAX_FLAMES).forEach((e) => this.releaseFlame(e));
    for (const e of burning.slice(0, MAX_FLAMES)) {
      let f = this.flames.get(e);
      if (!f) {
        f = this.takeFlame();
        this.flames.set(e, f);
      }
      const scale = e.rig.scale;
      // Tote liegen: Die Flamme sinkt mit dem Körper ab.
      const lift = e.isDead ? 0.2 : 0.7;
      f.object.position.copy(e.position).setY(e.position.y + lift * scale);
      f.object.scale.setScalar(1.3 * scale * Math.min(1, e.status.burn / 0.6));
      f.update(dt);
      let light = this.flameLights.get(f);
      if (!light) this.flameLights.set(f, (light = { position: new THREE.Vector3(), color: new THREE.Color(0xff7a2a), intensity: 0, distance: 12 }));
      light.position.copy(f.object.position).setY(f.object.position.y + 0.4);
      light.intensity = 14 * f.flicker * Math.min(1, e.status.burn / 0.6);
      this.d.lights.request(light);
    }
  }

  private takeFlame(): FireEffect {
    const f = this.freeFlames.pop() ?? new FireEffect(0.75, { smoke: true, sparks: true, heat: false });
    this.group.add(f.object);
    return f;
  }

  private releaseFlame(e: Enemy): void {
    const f = this.flames.get(e);
    if (!f) return;
    this.flames.delete(e);
    this.putFlame(f);
  }

  private putFlame(f: FireEffect): void {
    this.group.remove(f.object);
    this.freeFlames.push(f);
  }

  private updateBlasts(dt: number): void {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.time += dt;
      const u = b.time / 0.7;
      if (u >= 1) {
        this.putFlame(b.fire);
        this.blasts.splice(i, 1);
        continue;
      }
      // Schnell auf, langsam zusammen.
      const size = 2.6 * Math.sin(Math.min(1, u * 3) * Math.PI * 0.5) * (1 - u * u);
      b.fire.object.position.copy(b.at).setY(b.at.y - 0.9);
      b.fire.object.scale.setScalar(Math.max(0.01, size));
      b.fire.update(dt);
    }
  }

  private addArc(from: THREE.Vector3, to: THREE.Vector3, life: number, roughness: number): void {
    if (this.arcs.length > 60) this.arcs.shift();
    const jitter = Array.from({ length: ARC_SEGMENTS - 1 }, () => new THREE.Vector3());
    const arc = { from: from.clone(), to: to.clone(), life, jitter, rejitter: 0, roughness };
    this.arcs.push(arc);
  }

  private updateArcs(dt: number): void {
    let n = 0;
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.life -= dt;
      if (a.life <= 0) {
        this.arcs.splice(i, 1);
        continue;
      }
      const len = a.from.distanceTo(a.to);
      a.rejitter -= dt;
      if (a.rejitter <= 0) {
        a.rejitter = 0.035;
        for (const j of a.jitter) j.copy(this.randomOffset(len * a.roughness));
      }
      // Punkte entlang der Strecke mit Knicken (Mitte stärker als die Enden).
      let prev = a.from;
      for (let k = 1; k <= ARC_SEGMENTS && n < MAX_ARC_INSTANCES - 2; k++) {
        const u = k / ARC_SEGMENTS;
        const cur = k === ARC_SEGMENTS ? a.to : this.tmp.lerpVectors(a.from, a.to, u).addScaledVector(a.jitter[k - 1], Math.sin(u * Math.PI)).clone();
        n = this.segment(n, prev, cur, 0.008, this.color.setRGB(2.5, 4, 7));
        n = this.segment(n, prev, cur, 0.035, this.color.setRGB(0.12, 0.25, 0.6));
        prev = cur;
      }
    }
    this.arcMesh.count = n;
    if (n > 0) {
      this.arcMesh.instanceMatrix.needsUpdate = true;
      if (this.arcMesh.instanceColor) this.arcMesh.instanceColor.needsUpdate = true;
    }
  }

  private segment(n: number, a: THREE.Vector3, b: THREE.Vector3, radius: number, color: THREE.Color): number {
    const dir = this.tmp2.subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) return n;
    this.quat.setFromUnitVectors(ElementEffects.UP, dir.divideScalar(len));
    this.scale.set(radius, len, radius);
    this.matrix.compose(this.tmp2.addVectors(a, b).multiplyScalar(0.5), this.quat, this.scale);
    this.arcMesh.setMatrixAt(n, this.matrix);
    this.arcMesh.setColorAt(n, color);
    return n + 1;
  }

  private flash(at: THREE.Vector3, color: number, peak: number, duration: number): void {
    if (this.flashes.length > 4) this.flashes.shift();
    this.flashes.push({ light: { position: at.clone(), color: new THREE.Color(color), intensity: peak, distance: 18 }, time: duration, duration, peak });
  }

  private updateFlashes(dt: number): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.time -= dt;
      if (f.time <= 0) {
        this.flashes.splice(i, 1);
        continue;
      }
      f.light.intensity = f.peak * (f.time / f.duration) * (0.7 + 0.3 * Math.random());
      this.d.lights.request(f.light);
    }
  }

  // ---------------------------------------------------------------------------
  // Hilfen
  // ---------------------------------------------------------------------------

  private chest(e: Enemy, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(e.position).setY(e.position.y + (e.isDead ? 0.3 : 1.2) * e.rig.scale);
  }

  private randomOffset(r: number): THREE.Vector3 {
    return new THREE.Vector3((Math.random() - 0.5) * 2 * r, (Math.random() - 0.5) * 2 * r, (Math.random() - 0.5) * 2 * r);
  }

  /** Höhlen schweben hoch über der Insel – dort regnet es nicht, und es gibt kein Meer. */
  private underground(e: Enemy): boolean {
    return e.feet.y > this.d.heightMap.heightAt(e.feet.x, e.feet.z) + 6;
  }

  /** Steht im Wasser (bis über die Knöchel). */
  private submerged(e: Enemy): boolean {
    if (this.underground(e)) return false;
    return e.feet.y < this.d.heightMap.waterLevel - 0.15;
  }

  private isWet(e: Enemy): boolean {
    return e.status.wet > 0 || this.submerged(e);
  }
}
