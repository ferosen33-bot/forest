import * as THREE from 'three';

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  gravity: number;
}

export interface BurstOptions {
  count: number;
  color: THREE.ColorRepresentation;
  /** Hauptrichtung (z. B. Oberflächennormale am Trefferpunkt). */
  direction?: THREE.Vector3;
  speed?: number;
  spread?: number;
  size?: number;
  life?: number;
  gravity?: number;
}

/**
 * Einfaches, gepooltes Partikelsystem (Holzspäne, Steinsplitter, Blätter).
 * Alle Partikel teilen sich EIN InstancedMesh → ein Draw Call, keine Allokationen pro Frame.
 */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly pool: Particle[] = [];
  private readonly active: Particle[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly tmpDir = new THREE.Vector3();
  private readonly slotColors: THREE.Color[] = [];

  /** @param glow Unbeleuchtet & additiv (Glut, Funken) statt beleuchteter Späne. */
  constructor(
    private readonly capacity = 400,
    glow = false,
  ) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = glow
      ? new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      : new THREE.MeshStandardMaterial({ roughness: 0.9 });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'Particles';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setColorAt(i, this.color.set(0xffffff));
      this.slotColors.push(new THREE.Color());
      this.pool.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        rotation: new THREE.Euler(),
        spin: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 0.05,
        gravity: 9.81,
      });
    }
  }

  burst(origin: THREE.Vector3, opts: BurstOptions): void {
    const dir = opts.direction ?? this.tmpDir.set(0, 1, 0);
    const speed = opts.speed ?? 3;
    const spread = opts.spread ?? 0.8;
    const color = new THREE.Color(opts.color);

    for (let i = 0; i < opts.count; i++) {
      const p = this.pool.pop();
      if (!p) break;
      p.position.copy(origin);
      p.velocity
        .set(dir.x + (Math.random() - 0.5) * 2 * spread, dir.y + Math.random() * spread, dir.z + (Math.random() - 0.5) * 2 * spread)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      p.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(20);
      p.maxLife = p.life = (opts.life ?? 0.9) * (0.7 + Math.random() * 0.6);
      p.size = (opts.size ?? 0.05) * (0.6 + Math.random() * 0.8);
      p.gravity = opts.gravity ?? 9.81;
      // Farbe leicht variieren, damit Späne nicht wie Klone aussehen.
      this.slotColors[this.active.length].copy(color).multiplyScalar(0.8 + Math.random() * 0.4);
      this.active.push(p);
    }
  }

  update(dt: number): void {
    let n = 0;
    for (let i = 0; i < this.active.length; i++) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.pool.push(p);
        // Letztes aktives Partikel (inkl. Farbe) in diese Lücke ziehen.
        const last = this.active.pop()!;
        const lastColor = this.slotColors[this.active.length];
        if (last !== p) {
          this.active[i] = last;
          this.slotColors[i].copy(lastColor);
        }
        i--;
        continue;
      }
      p.velocity.y -= p.gravity * dt;
      p.velocity.multiplyScalar(Math.exp(-1.5 * dt)); // Luftwiderstand
      p.position.addScaledVector(p.velocity, dt);
      p.rotation.x += p.spin.x * dt;
      p.rotation.y += p.spin.y * dt;
      p.rotation.z += p.spin.z * dt;

      const fade = Math.min(1, p.life / (p.maxLife * 0.3)); // am Ende schrumpfen
      this.quat.setFromEuler(p.rotation);
      this.scale.set(p.size, p.size * 0.5, p.size * 1.6).multiplyScalar(fade);
      this.matrix.compose(p.position, this.quat, this.scale);
      this.mesh.setMatrixAt(n, this.matrix);
      this.mesh.setColorAt(n, this.slotColors[i]);
      n++;
    }
    this.mesh.count = n;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  get activeCount(): number {
    return this.active.length;
  }

  get maxCount(): number {
    return this.capacity;
  }
}
