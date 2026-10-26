import * as THREE from 'three';

/**
 * Spuren im Bodennebel: Wer sich bewegt (Spieler, Schrate, Tiere), hinterlässt alle halbe Meter einen
 * Punkt, an dem der Nebel verdrängt ist. Die Lücke schließt sich in einigen Sekunden wieder, während
 * der Nebel darum herum verwirbelt (siehe Bodennebel im Lichtkegel-Pass).
 */

/** Spurpunkte (plus einer für den Spieler selbst – zusammen höchstens 8 für den Shader). */
const MAX = 7;
/** So lange bleibt eine Spur sichtbar (s). */
const HEAL = 6;
/** Abstand zwischen zwei Spurpunkten (m). */
const SPACING = 0.5;

export class FogWake {
  private readonly trail: THREE.Vector4[] = [];
  /** Wo der Spieler gerade steht, ist der Nebel immer etwas verdrängt. */
  private readonly here = new THREE.Vector4();
  private readonly all: THREE.Vector4[] = [];
  private readonly last = new WeakMap<object, THREE.Vector3>();

  /** Spuren für den Shader: der Spieler selbst und die jüngsten Spurpunkte. */
  get wakes(): readonly THREE.Vector4[] {
    return this.all;
  }

  /**
   * @param player Fußpunkt des Spielers
   * @param movers Fußpunkte der Schrate und Tiere in der Nähe
   */
  update(dt: number, player: THREE.Vector3, movers: Iterable<THREE.Vector3>): void {
    const trail = this.trail;
    for (const w of trail) w.w -= dt / HEAL;
    for (let i = trail.length - 1; i >= 0; i--) if (trail[i].w <= 0) trail.splice(i, 1);
    this.record(player);
    for (const p of movers) this.record(p);
    this.here.set(player.x, player.y, player.z, 0.75);
    this.all.length = 0;
    this.all.push(this.here, ...trail);
  }

  private record(p: THREE.Vector3): void {
    const trail = this.trail;
    const prev = this.last.get(p);
    if (prev && prev.distanceToSquared(p) < SPACING * SPACING) return;
    if (prev) prev.copy(p);
    else this.last.set(p, p.clone());
    // Volle Liste: die schwächste Spur ersetzen.
    if (trail.length >= MAX) {
      let weakest = 0;
      for (let i = 1; i < trail.length; i++) if (trail[i].w < trail[weakest].w) weakest = i;
      trail.splice(weakest, 1);
    }
    trail.push(new THREE.Vector4(p.x, p.y, p.z, 1));
  }
}
