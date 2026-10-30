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
  return { events, fear, played, lines, frame, run, hm, player };
}

describe('Nachtereignisse', () => {
  it('jedes Ereignis startet, erzählt beim ersten Mal und endet von selbst', () => {
    for (const kind of NIGHT_EVENTS) {
      const { events, lines, frame, run } = setup();
      events.start(kind, frame());
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
});
