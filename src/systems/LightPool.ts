import * as THREE from 'three';

export interface LightRequest {
  position: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  distance: number;
}

/**
 * Feste Anzahl Punktlichter für dynamische Lichtquellen (Lagerfeuer, Fackel).
 *
 * Three.js kompiliert alle Shader neu, sobald sich die Zahl der Lichter in der Szene
 * ändert – ein neues Lagerfeuer würde also kurz ruckeln. Stattdessen existieren immer
 * `size` Lichter, die jedes Frame den nächstgelegenen Quellen zugewiesen werden.
 */
export class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private requests: LightRequest[] = [];

  constructor(scene: THREE.Scene, size = 4) {
    for (let i = 0; i < size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2);
      light.castShadow = false;
      light.name = `PoolLight_${i}`;
      this.lights.push(light);
      scene.add(light);
    }
  }

  /** Lichtwunsch für dieses Frame anmelden. */
  request(r: LightRequest): void {
    this.requests.push(r);
  }

  /** Verteilt die Lichter auf die dem Betrachter nächsten Quellen. */
  update(viewer: THREE.Vector3): void {
    const sorted = this.requests.sort(
      (a, b) => a.position.distanceToSquared(viewer) - b.position.distanceToSquared(viewer),
    );
    this.lights.forEach((light, i) => {
      const r = sorted[i];
      if (r) {
        light.position.copy(r.position);
        light.color.copy(r.color);
        light.intensity = r.intensity;
        light.distance = r.distance;
      } else {
        light.intensity = 0;
      }
    });
    this.requests = [];
  }
}
