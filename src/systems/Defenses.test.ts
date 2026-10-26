import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { Defenses, FIRE_TIME, PIT_DAMAGE, type Intruder } from './Defenses';
import { getStructure } from './building/StructureDefs';
import type { BuildingSystem, Structure } from './building/BuildingSystem';
import type { HeightMap } from '../world/HeightMap';

function setup(structures: Partial<Structure>[] = []) {
  const events = new EventBus();
  const messages: string[] = [];
  events.on('hud:message', ({ text }) => messages.push(text));
  const intruders: Intruder[] = [];
  const player = { position: new THREE.Vector3(50, 0, 50), damage: 0, hurt: (a: number) => void (player.damage += a) };
  const building = {
    structures,
    setArmed: (s: Structure, armed: boolean) => {
      s.armed = armed;
    },
  } as unknown as BuildingSystem;
  const defenses = new Defenses({
    building,
    heightMap: { heightAt: () => 0, waterLevel: -5 } as unknown as HeightMap,
    lights: { request: () => {} } as never,
    audio: { play: () => {} } as never,
    particles: { burst: () => {} } as never,
    events,
    intruders: () => intruders,
    player,
  });
  return { defenses, intruders, player, messages };
}

function intruder(x: number, z: number, kind: 'schrat' | 'wolf' = 'schrat') {
  const w = {
    kind,
    feet: new THREE.Vector3(x, 0, z),
    damage: 0,
    stunned: 0,
    get isDead() {
      return w.damage >= 100;
    },
    hurt: (a: number) => void (w.damage += a),
    stun: (s: number) => void (w.stunned = s),
  };
  return w;
}

const place = (id: 'pitTrap' | 'rattleLine', x: number, z: number, rotation = 0): Partial<Structure> => ({
  def: getStructure(id),
  position: new THREE.Vector3(x, 0, z),
  rotation,
  armed: id === 'pitTrap' ? true : undefined,
});

describe('Defenses', () => {
  it('Fallgrube: wer drauftritt, stürzt, nimmt Schaden und steckt fest – danach liegt sie offen', () => {
    const pit = place('pitTrap', 0, 0);
    const { defenses, intruders, messages } = setup([pit]);
    const s = intruder(3, 0);
    intruders.push(s);
    defenses.update(0.016);
    expect(s.damage).toBe(0);
    s.feet.set(0.3, 0, -0.2);
    defenses.update(0.016);
    expect(s.damage).toBe(PIT_DAMAGE);
    expect(s.stunned).toBeGreaterThan(0);
    expect(pit.armed).toBe(false);
    // Offen: kein zweiter Sturz.
    const t = intruder(0, 0);
    intruders.push(t);
    defenses.update(0.016);
    expect(t.damage).toBe(0);
    expect(messages.some((m) => m.includes('Fallgrube'))).toBe(true);
  });

  it('Klapperleine warnt, wenn ein Wolf die Schnur quert – auch quer gedreht', () => {
    const line = place('rattleLine', 10, 10, Math.PI / 2);
    const { defenses, intruders, messages } = setup([line]);
    // Gedreht um 90°: die Schnur verläuft entlang Z.
    const wolf = intruder(10, 11, 'wolf');
    intruders.push(wolf);
    defenses.update(0.016);
    expect(messages.some((m) => m.includes('Klapperleine') && m.includes('Wölfe'))).toBe(true);
    // Abseits der Schnur rasselt nichts.
    const quiet = setup([place('rattleLine', 10, 10, Math.PI / 2)]);
    quiet.intruders.push(intruder(11.5, 10));
    quiet.defenses.update(0.016);
    expect(quiet.messages.length).toBe(0);
  });

  it('Brandflasche: Feuer brennt eine Weile, verletzt alle darin und erlischt', () => {
    const { defenses, intruders, player } = setup();
    const inside = intruder(1, 0);
    const outside = intruder(6, 0);
    intruders.push(inside, outside);
    player.position.set(0.5, 0, 0.5);
    defenses.ignite(new THREE.Vector3(0, 0.3, 0));
    expect(defenses.fireNear(new THREE.Vector3(4, 0, 0), 2)).not.toBeNull();
    for (let t = 0; t < 4; t += 0.1) defenses.update(0.1);
    expect(inside.damage).toBeGreaterThan(30);
    expect(outside.damage).toBe(0);
    expect(player.damage).toBeGreaterThan(10);
    for (let t = 0; t < FIRE_TIME; t += 0.1) defenses.update(0.1);
    expect(defenses.zones.length).toBe(0);
    expect(defenses.fireNear(new THREE.Vector3(0, 0, 0), 5)).toBeNull();
  });

  it('Regen löscht Brände schneller', () => {
    const dry = setup().defenses;
    const wet = setup().defenses;
    wet.rain = 1;
    for (const d of [dry, wet]) d.ignite(new THREE.Vector3(0, 0, 0));
    for (let t = 0; t < FIRE_TIME / 2; t += 0.1) {
      dry.update(0.1);
      wet.update(0.1);
    }
    expect(dry.zones.length).toBe(1);
    expect(wet.zones.length).toBe(0);
  });
});
