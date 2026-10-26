import * as THREE from 'three';

/**
 * Atemwolken bei Kälte: alle paar Sekunden ein weicher Hauch vor dem Gesicht, beim Rennen schneller
 * und kräftiger. Wenige weiche Sprites, die wachsen, aufsteigen und verblassen.
 */

const POOL = 6;
/** Lebensdauer eines Hauchs (s). */
const LIFE = 1.7;

function puffTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Puff {
  sprite: THREE.Sprite;
  age: number;
  velocity: THREE.Vector3;
}

export class Breath {
  readonly group = new THREE.Group();
  private readonly puffs: Puff[] = [];
  private timer = 1;
  private readonly forward = new THREE.Vector3();

  constructor() {
    this.group.name = 'Breath';
    const map = puffTexture();
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, opacity: 0, color: 0xdde4ec });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.group.add(sprite);
      this.puffs.push({ sprite, age: LIFE, velocity: new THREE.Vector3() });
    }
  }

  /**
   * @param cold wie sichtbar der Atem ist (0 = warm, 1 = eisig)
   * @param exertion 0 = ruhig … 1 = Sprint (schnelleres, kräftigeres Atmen)
   * @param light Helligkeit der Umgebung (nachts nur ein Hauch im Lampenschein)
   */
  update(dt: number, camera: THREE.Camera, cold: number, exertion: number, light: number): void {
    this.timer -= dt;
    if (cold > 0.05 && this.timer <= 0) {
      this.timer = THREE.MathUtils.lerp(3.6, 1.1, exertion) * (0.85 + Math.random() * 0.3);
      const puff = this.puffs.find((p) => p.age >= LIFE);
      if (puff) {
        camera.getWorldDirection(this.forward);
        puff.age = 0;
        puff.sprite.visible = true;
        puff.sprite.position.copy(camera.position).addScaledVector(this.forward, 0.32);
        puff.sprite.position.y -= 0.1;
        puff.velocity.copy(this.forward).multiplyScalar(0.35 + 0.3 * exertion);
        puff.velocity.y += 0.12;
        (puff.sprite.material as THREE.SpriteMaterial).userData.strength = cold * (0.5 + 0.5 * exertion);
      }
    }
    for (const p of this.puffs) {
      if (p.age >= LIFE) continue;
      p.age += dt;
      const t = Math.min(1, p.age / LIFE);
      p.sprite.position.addScaledVector(p.velocity, dt);
      p.velocity.multiplyScalar(Math.exp(-dt * 1.5));
      p.sprite.scale.setScalar(0.12 + 0.45 * t);
      const mat = p.sprite.material as THREE.SpriteMaterial;
      mat.opacity = (mat.userData.strength ?? 0) * Math.sin(Math.PI * Math.min(1, t * 1.4)) * 0.5 * (1 - t) * (0.25 + 0.75 * light);
      if (p.age >= LIFE) p.sprite.visible = false;
    }
  }
}
