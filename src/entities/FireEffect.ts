import * as THREE from 'three';

const flameGeometry = new THREE.ConeGeometry(1, 1, 7, 1, true);
flameGeometry.translate(0, 0.5, 0);

/** Additiv geblendete, unbeleuchtete Flammen (leuchten auch nachts). */
const FLAME_MATERIALS = [0xff5a14, 0xff9a2e, 0xffe08a].map(
  (color) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
);

/**
 * Prozedurale Flamme aus drei ineinander liegenden Kegeln, die unabhängig flackern.
 * Wird von Lagerfeuer und Fackel verwendet; Licht kommt separat aus dem LightPool.
 */
export class FireEffect {
  readonly object = new THREE.Group();
  /** Aktuelle Flacker-Intensität in ~[0.75, 1.15] – für das zugehörige Licht. */
  flicker = 1;
  private readonly flames: THREE.Mesh[] = [];
  private time = Math.random() * 100;

  constructor(private readonly size = 1) {
    FLAME_MATERIALS.forEach((material, i) => {
      const m = new THREE.Mesh(flameGeometry, material);
      const s = size * (1 - i * 0.28);
      m.scale.set(s * 0.32, s, s * 0.32);
      m.renderOrder = 2 + i;
      this.flames.push(m);
      this.object.add(m);
    });
    this.object.name = 'Fire';
  }

  set visible(v: boolean) {
    this.object.visible = v;
  }

  get visible(): boolean {
    return this.object.visible;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.flicker = 0.95 + Math.sin(t * 9.1) * 0.08 + Math.sin(t * 23.7) * 0.05 + Math.sin(t * 4.3) * 0.07;
    this.flames.forEach((m, i) => {
      const k = 1 - i * 0.28;
      const wobble = Math.sin(t * (11 + i * 5) + i) * 0.12 + Math.sin(t * (27 + i * 3)) * 0.06;
      m.scale.y = this.size * k * (1 + wobble);
      m.rotation.y = t * (1.5 + i);
      m.rotation.z = Math.sin(t * (7 + i * 2)) * 0.12;
    });
  }
}
