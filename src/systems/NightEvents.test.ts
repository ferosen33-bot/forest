import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NightEvents, NIGHT_EVENTS } from './NightEvents';
import { Fear } from './Fear';
import { HeightMap } from '../world/HeightMap';
import type { Audio } from './Audio';
import type { HorrorFrame } from './Horror';
import { mulberry32 } from '../utils/random';

function setup() {
  const played: { id: string; at: THREE.Vector3 }[] = [];
  const audio = {
    play: (id: string, o?: { position?: THREE.Vector3 }) => void played.push({ id, at: o?.position?.clone() ?? new THREE.Vector3() }),
  } as unknown as Audio;
  const hm = new HeightMap({ size: 512, cellSize: 2, seed: 3, waterLevel: -1000 });
  const fear = new Fear();
  const events = new NightEvents(audio, hm, fear, mulberry32(11));
  const lines: string[] = [];
  events.onMessage = (t) => lines.push(t);
  const items: { id: string; at: THREE.Vector3 }[] = [];
  events.onItem = (id, at) => void items.push({ id, at: at.clone() });
  const kinds: string[] = [];
  events.onEvent = (k) => void kinds.push(k);
  const player = new THREE.Vector3(0, hm.heightAt(0, 0), 0);
  const frame = (over: Partial<HorrorFrame> = {}): HorrorFrame => ({
    dt: 0.1,
    darkness: 1,
    inCave: false,
    player,
    eye: player.clone().setY(player.y + 1.6),
    look: new THREE.Vector3(0, 0, 1),
    moving: false,
    paused: false,
    lit: false,
    ...over,
  });
  const run = (seconds: number, over: Partial<HorrorFrame> = {}) => {
    for (let i = 0; i < seconds * 10; i++) events.update(frame(over));
  };
  return { events, fear, played, lines, frame, run, hm, player, items, kinds };
}

describe('Nachtereignisse', () => {
  it('jedes Ereignis startet, erzählt beim ersten Mal und endet von selbst', () => {
    for (const kind of NIGHT_EVENTS) {
      const { events, lines, frame, run } = setup();
      // Motten kommen nur zu dem, der Licht trägt.
      events.start(kind, frame({ lit: kind === 'moths' }));
      expect(events.current).toBe(kind);
      expect(lines.length).toBe(1);
      // Der Spieler wartet an Ort und Stelle (Ereignisse mit Annäherung laufen höchstens ihre Zeit ab);
      // pausiert, damit danach kein neues beginnt.
      run(160, { paused: true });
      expect(events.current).toBeNull();
    }
  });

  it('Pfeifer: fünf Pfiffe, jeder näher als der vorige', () => {
    const { events, frame, run, played, player } = setup();
    events.start('whistler', frame());
    run(90);
    const whistles = played.filter((p) => p.id === 'pfiff').map((p) => Math.hypot(p.at.x - player.x, p.at.z - player.z));
    expect(whistles.length).toBe(5);
    for (let i = 1; i < whistles.length; i++) expect(whistles[i]).toBeLessThan(whistles[i - 1]);
  });

  it('Spieluhr: kommt näher und liegt danach am Boden', () => {
    const { events, frame, run, played } = setup();
    events.start('musicbox', frame());
    run(80);
    expect(played.filter((p) => p.id === 'musicbox').length).toBe(4);
    expect(events.leftoverCount).toBe(1);
  });

  it('Feuer: aus der Nähe nur noch kalte, rauchende Asche', () => {
    const { events, frame, run, played } = setup();
    events.start('fire', frame());
    run(3);
    expect(played.some((p) => p.id === 'crackle')).toBe(true);
    // Hingehen: dorthin, wo es knistert
    const at = played.find((p) => p.id === 'crackle')!.at;
    run(0.2, { player: at.clone(), eye: at.clone().setY(at.y + 1.6) });
    expect(events.current).toBeNull();
    expect(events.leftoverCount).toBe(1);
  });

  it('Nebelwand: der Nebel zieht auf und hebt sich wieder', () => {
    const { events, frame, run } = setup();
    events.start('fogwall', frame());
    run(40);
    expect(events.fog).toBeGreaterThan(0.6);
    run(120);
    expect(events.fog).toBeLessThan(0.2);
  });

  it('Hirsch: verschwindet, wenn man eine Weile wegsieht', () => {
    const { events, frame, run } = setup();
    events.start('deer', frame());
    run(5);
    expect(events.current).toBe('deer');
    run(4, { look: new THREE.Vector3(0, 0, -1), paused: true });
    expect(events.current).toBeNull();
  });

  it('Fußspuren führen vom Spieler weg und bleiben eine Weile', () => {
    const { events, frame, run } = setup();
    events.start('footprints', frame());
    run(20);
    expect(events.leftoverCount).toBe(26);
    run(200, { paused: true });
    expect(events.leftoverCount).toBe(0);
  });

  it('bei Tag und in Höhlen geschieht nichts', () => {
    const { events, run, frame } = setup();
    run(1200, { darkness: 0.2 });
    expect(events.current).toBeNull();
    run(1200, { inCave: true });
    expect(events.current).toBeNull();
    // Nachts dagegen schon.
    let seen = false;
    const night = frame();
    for (let i = 0; i < 6000 && !seen; i++) {
      events.update(night);
      seen = events.current !== null;
    }
    expect(seen).toBe(true);
  });

  it('Nordlicht: wogt eine Weile über dem Himmel und beruhigt', () => {
    const { events, frame, run, fear } = setup();
    fear.value = 0.8;
    events.start('aurora', frame());
    run(60, { paused: true });
    expect(events.current).toBe('aurora');
    expect(fear.value).toBeLessThan(0.8);
    run(60, { paused: true });
    expect(events.current).toBeNull();
  });

  it('Lichterpfad: wer ihm folgt, findet an seinem Ende eine Gabe', () => {
    const { events, frame, run, items, kinds, player } = setup();
    events.start('lightpath', frame());
    // Erst alle Kerzen aufleuchten lassen, dann die Kerzenreihe entlang bis ans Ende gehen.
    run(20);
    const candles = events.group.children.filter((c) => c.getObjectByName('flame'));
    expect(candles.length).toBeGreaterThanOrEqual(5);
    const ends = candles.slice(-2).map((c) => c.position);
    const end = ends[0].clone().add(ends[1]).multiplyScalar(0.5);
    for (const c of candles.slice(0, -2)) run(0.2, { player: c.position.clone(), eye: c.position.clone().setY(c.position.y + 1.6) });
    // Hinter dem Spieler sind die Kerzen aus.
    expect(candles[0].getObjectByName('flame')!.visible).toBe(false);
    run(0.2, { player: end, eye: end.clone().setY(end.y + 1.6) });
    expect(kinds).toContain('lightpath-end');
    expect(items.length).toBeGreaterThanOrEqual(2);
    run(10, { player: end, paused: true });
    expect(events.current).toBeNull();
    // Der Stein mit dem Bündel bleibt.
    expect(events.leftoverCount).toBe(1);
    expect(player).toBeDefined();
  });

  it('Reigen: hält inne, wenn man kommt – dann wachsen Leuchtpilze', () => {
    const { events, frame, run, items, fear } = setup();
    events.start('reigen', frame());
    run(5);
    const ring = events.group.children[events.group.children.length - 1];
    const near = ring.position.clone().add(new THREE.Vector3(10, 0, 0));
    run(5, { player: near, eye: near.clone().setY(near.y + 1.6), paused: true });
    expect(events.current).toBeNull();
    expect(items.filter((i) => i.id === 'mushroom').length).toBe(3);
    expect(fear.value).toBeGreaterThan(0);
  });

  it('Schaukelstuhl: kommt zur Ruhe, wenn man herantritt, und bleibt stehen', () => {
    const { events, frame, run, played } = setup();
    events.start('rocking', frame());
    run(10);
    expect(played.some((p) => p.id === 'creak')).toBe(true);
    const chair = events.group.children[events.group.children.length - 1];
    const near = chair.position.clone().add(new THREE.Vector3(3, 0, 0));
    run(5, { player: near, eye: near.clone().setY(near.y + 1.6), paused: true });
    expect(events.current).toBeNull();
    expect(events.leftoverCount).toBe(1);
  });

  it('Motten: nur mit Licht – und fort, wenn es ausgeht', () => {
    const { events, frame, run } = setup();
    events.start('moths', frame({ lit: false }));
    expect(events.current).toBeNull();
    events.start('moths', frame({ lit: true }));
    expect(events.current).toBe('moths');
    run(10, { lit: true, paused: true });
    expect(events.current).toBe('moths');
    run(1, { lit: false, paused: true });
    expect(events.current).toBeNull();
  });

  it('Sternschnuppen: eine Minute lang, dann ist der Himmel wieder still', () => {
    const { events, frame, run } = setup();
    events.start('meteors', frame());
    run(30, { paused: true });
    expect(events.current).toBe('meteors');
    run(40, { paused: true });
    expect(events.current).toBeNull();
    expect(events.group.children.length).toBe(0);
  });
});
