import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { COUNTER_WINDOW, CombatMoves, type CombatDeps } from './CombatMoves';

function make() {
  const events = new EventBus();
  const played: string[] = [];
  const deps = {
    events,
    audio: { play: (id: string) => played.push(id) },
    skills: { gain: () => {}, meleeDamage: 1 },
  } as unknown as CombatDeps;
  return { combat: new CombatMoves(deps), events, played };
}

describe('Kampfmanöver', () => {
  it('Trefferstopp hält die Welt kurz an', () => {
    const { combat } = make();
    expect(combat.timeScale(1 / 60)).toBe(1);
    combat.impact(1);
    expect(combat.timeScale(1 / 60)).toBeLessThan(0.1);
    for (let i = 0; i < 10; i++) combat.timeScale(1 / 60);
    expect(combat.timeScale(1 / 60)).toBe(1);
  });

  it('perfekte Parade: Konterfenster und Zeitlupe, das Fenster wird einmal verbraucht', () => {
    const { combat, events, played } = make();
    events.emit('player:parried', { from: new THREE.Vector3() });
    expect(played).toContain('parry');
    expect(combat.countering).toBe(true);
    // Trefferstopp, dann Zeitlupe.
    for (let i = 0; i < 8; i++) combat.timeScale(1 / 60);
    expect(combat.timeScale(1 / 60)).toBeLessThan(1);
    expect(combat.consumeCounter()).toBe(true);
    expect(combat.consumeCounter()).toBe(false);
  });

  it('das Konterfenster schließt sich nach kurzer Zeit', () => {
    const { combat, events } = make();
    events.emit('player:dodged', { perfect: true, from: new THREE.Vector3() });
    expect(combat.countering).toBe(true);
    combat.update(COUNTER_WINDOW + 0.1, false, false);
    expect(combat.countering).toBe(false);
  });
});
