import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { Audio } from './Audio';
import { Crows } from './Crows';

function setup() {
  const events = new EventBus();
  const perch = new THREE.Vector3(50, 2, 0);
  const crows = new Crows({ perches: [perch], audio: new Audio(), events, seed: 7 });
  return { crows, events, perch };
}

const run = (c: Crows, seconds: number, listener: THREE.Vector3, daylight = 1) => {
  for (let i = 0; i < seconds * 30; i++) c.update(1 / 30, listener, daylight, false);
};

describe('Krähen', () => {
  it('lassen sich bei Tag auf Sitzplätzen in mittlerer Entfernung nieder', () => {
    const { crows } = setup();
    run(crows, 12, new THREE.Vector3(0, 0, 0));
    expect(crows.sitting).toBeGreaterThan(0);
  });

  it('fliegen auf, wenn man ihnen nahe kommt, und verschwinden dann', () => {
    const { crows, perch } = setup();
    run(crows, 12, new THREE.Vector3(0, 0, 0));
    run(crows, 0.2, perch.clone().add(new THREE.Vector3(5, 0, 0)));
    expect(crows.sitting).toBe(0);
    expect(crows.count).toBeGreaterThan(0);
    run(crows, 12, perch.clone().add(new THREE.Vector3(5, 0, 0)));
    expect(crows.count).toBe(0);
  });

  it('ein Schuss in der Nähe scheucht sie auf; nachts kommen keine', () => {
    const { crows, events, perch } = setup();
    run(crows, 12, new THREE.Vector3(0, 0, 0));
    events.emit('noise', { position: perch.clone().add(new THREE.Vector3(0, 0, 20)), radius: 40 });
    expect(crows.sitting).toBe(0);
    const night = setup();
    run(night.crows, 20, new THREE.Vector3(0, 0, 0), 0.05);
    expect(night.crows.count).toBe(0);
  });
});
