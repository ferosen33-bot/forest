import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Horror, type HorrorFrame } from './Horror';
import { Fear } from './Fear';
import { HeightMap } from '../world/HeightMap';
import type { Audio } from './Audio';
import { mulberry32 } from '../utils/random';

function setup() {
  const played: string[] = [];
  let ducked = 0;
  const audio = {
    play: (id: string) => void played.push(id),
    duckAmbience: () => void ducked++,
  } as unknown as Audio;
  const hm = new HeightMap({ size: 256, cellSize: 2, seed: 3, waterLevel: -1000 });
  const fear = new Fear();
  const horror = new Horror(audio, hm, fear, mulberry32(7));
  const frame = (over: Partial<HorrorFrame> = {}): HorrorFrame => ({
    dt: 0.1,
    darkness: 1,
    inCave: false,
    player: new THREE.Vector3(0, 0, 0),
    eye: new THREE.Vector3(0, 1.6, 0),
    look: new THREE.Vector3(0, 0, 1),
    moving: false,
    paused: false,
    lit: false,
    ...over,
  });
  return { horror, fear, played, frame, ducked: () => ducked };
}

describe('Horror (Meilenstein 57)', () => {
  it('Augen glimmen im Dunkel und erlöschen, wenn man näher kommt', () => {
    const { horror, frame } = setup();
    horror.trigger('eyes', frame());
    const start = horror.activeEyes;
    expect(start).toBeGreaterThan(2);
    // Auf ein Augenpaar zugehen: es erlischt.
    const target = horror.eyePositions[0];
    for (let i = 0; i < 10; i++) horror.update(frame({ player: target, eye: target.clone().setY(target.y + 1.6), paused: true }));
    expect(horror.activeEyes).toBeLessThan(start);
    // Spätestens nach ihrer Zeit sind alle fort.
    for (let i = 0; i < 450; i++) horror.update(frame({ paused: true }));
    expect(horror.activeEyes).toBe(0);
  });

  it('Gaben bleiben liegen und verschwinden erst, wenn der Spieler weit weg ist', () => {
    const { horror, frame } = setup();
    horror.trigger('offering', frame());
    expect(horror.offeringCount).toBe(1);
    for (let i = 0; i < 50; i++) horror.update(frame({ paused: true }));
    expect(horror.offeringCount).toBe(1);
    horror.update(frame({ player: new THREE.Vector3(400, 0, 0), paused: true }));
    expect(horror.offeringCount).toBe(0);
  });

  it('Ansturm: stürzt heran, verschwindet kurz vor dem Gesicht und erschreckt', () => {
    const { horror, fear, frame, played } = setup();
    let shake = 0;
    horror.onShake = (a) => (shake += a);
    horror.trigger('lunge', frame());
    expect(horror.activeWatchers).toBe(1);
    for (let i = 0; i < 20; i++) horror.update(frame({ paused: true }));
    expect(horror.activeWatchers).toBe(0);
    expect(shake).toBeGreaterThan(0);
    expect(fear.value).toBeGreaterThan(0.25);
    expect(played).toContain('scream');
  });

  it('Stille: der Wald verstummt, dann atmet etwas im Nacken', () => {
    const { horror, frame, played, ducked } = setup();
    const lines: string[] = [];
    horror.onMessage = (t) => lines.push(t);
    horror.trigger('silence', frame());
    expect(ducked()).toBe(1);
    expect(lines.length).toBe(1);
    for (let i = 0; i < 130; i++) horror.update(frame({ paused: true }));
    expect(played).toContain('breath');
    // Die Zeile kommt nur beim ersten Mal.
    horror.trigger('silence', frame());
    expect(lines.length).toBe(1);
  });

  it('Flackern nur mit Licht in der Hand', () => {
    const { horror, frame } = setup();
    let failed = 0;
    horror.onFlicker = (s) => (failed += s);
    horror.trigger('flicker', frame({ lit: false }));
    expect(failed).toBe(0);
    horror.trigger('flicker', frame({ lit: true }));
    expect(failed).toBeGreaterThan(1);
  });

  it('nachts passiert regelmäßig etwas, bei Tag nichts', () => {
    const day = setup();
    for (let i = 0; i < 3000; i++) day.horror.update(day.frame({ darkness: 0 }));
    expect(day.played.length).toBe(0);
    const night = setup();
    for (let i = 0; i < 3000; i++) night.horror.update(night.frame());
    expect(night.played.length + night.horror.activeEyes + night.horror.offeringCount + night.horror.activeWatchers).toBeGreaterThan(0);
  });
});
