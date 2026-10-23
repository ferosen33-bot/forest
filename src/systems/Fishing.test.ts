import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { getStructure } from './building/StructureDefs';
import type { BuildingSystem, Structure } from './building/BuildingSystem';
import { biteDelay, castTarget, CAST_MAX, CAST_MIN, FishTraps, TRAP_INTERVAL, TRAP_MAX } from './Fishing';
import { mulberry32 } from '../utils/random';

/** See: Wasser bei 0, Grund fällt von x = 0 (Ufer) nach x = 20 auf −4 m ab. */
const ground = (x: number) => THREE.MathUtils.clamp(-x * 0.2, -4, 2);

describe('castTarget', () => {
  const eye = new THREE.Vector3(-1, 1.7, 0);

  it('wirft dorthin, wo der Blick das Wasser trifft', () => {
    const look = new THREE.Vector3(1, -0.2, 0).normalize();
    const r = castTarget(eye, look, 0, ground);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.point.x - eye.x).toBeCloseTo(1.7 / 0.2, 1);
    expect(r.point.y).toBe(0);
    expect(r.depth).toBeGreaterThan(1);
  });

  it('begrenzt die Wurfweite nach unten und oben', () => {
    const steep = castTarget(eye, new THREE.Vector3(0.3, -1, 0).normalize(), 0, () => -2);
    expect(steep.ok && steep.point.x - eye.x).toBeCloseTo(CAST_MIN, 3);
    const up = castTarget(eye, new THREE.Vector3(1, 0.3, 0).normalize(), 0, () => -2);
    expect(up.ok && up.point.x - eye.x).toBeCloseTo(CAST_MAX, 3);
  });

  it('lehnt Land und zu flaches Wasser ab', () => {
    const land = castTarget(eye, new THREE.Vector3(-1, -0.2, 0).normalize(), 0, ground);
    expect(land).toEqual({ ok: false, reason: 'Dort ist kein Wasser.' });
    const mud = castTarget(eye, new THREE.Vector3(1, -0.3, 0).normalize(), 0, () => -0.1);
    expect(mud.ok).toBe(false);
  });
});

describe('biteDelay', () => {
  it('ist in tiefem Wasser und bei Regen kürzer', () => {
    const fixed = () => 0.5;
    expect(biteDelay(3, 0, fixed)).toBeLessThan(biteDelay(0.4, 0, fixed));
    expect(biteDelay(1, 1, fixed)).toBeLessThan(biteDelay(1, 0, fixed));
    expect(biteDelay(0, 0, () => 0)).toBeGreaterThan(4);
  });
});

describe('FishTraps', () => {
  function setup() {
    const events = new EventBus();
    const trap = { def: getStructure('fishTrap'), object: new THREE.Group(), catch: 0 } as unknown as Structure;
    const building = { structures: [trap] } as unknown as BuildingSystem;
    return { events, trap, traps: new FishTraps(building, events, mulberry32(4)) };
  }

  it('fängt mit der Zeit Fische, höchstens bis zur Obergrenze, und zeigt sie im Korb', () => {
    const { trap, traps } = setup();
    for (let i = 0; i < 60; i++) traps.update(TRAP_INTERVAL / 2, 0);
    expect(trap.catch).toBe(TRAP_MAX);
    expect(trap.object.children.length).toBe(TRAP_MAX);
    trap.catch = 0;
    traps.update(0.1, 0);
    expect(trap.object.children.length).toBe(0);
  });

  it('füllt sich über Nacht', () => {
    const { events, trap } = setup();
    events.emit('player:slept', {});
    expect(trap.catch).toBeGreaterThan(0);
  });
});
