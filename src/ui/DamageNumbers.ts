import * as THREE from 'three';
import type { DamageKind, EventBus } from '../core/EventBus';
import { ELEMENTS, isElementId } from '../entities/items/Elements';

interface Style {
  color: string;
  size: number;
  suffix?: string;
}

const STYLES: Record<Exclude<DamageKind, keyof typeof ELEMENTS>, Style> = {
  normal: { color: '#f2ece0', size: 15 },
  heavy: { color: '#ffb35a', size: 20 },
  crit: { color: '#ffd84a', size: 22, suffix: '!' },
  counter: { color: '#fff0a8', size: 26, suffix: '!' },
  sneak: { color: '#d2adff', size: 24, suffix: '!' },
};

interface Floater {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  life: number;
  drift: number;
}

const MAX = 32;

/**
 * Schadenszahlen: steigen über dem Getroffenen auf und verblassen. Kritische Treffer, Konter und
 * Schleichangriffe sind größer und farbig, Schaden durch Elemente klein in deren Farbe.
 */
export class DamageNumbers {
  enabled = true;
  private readonly root: HTMLElement;
  private readonly live: Floater[] = [];
  private readonly free: HTMLElement[] = [];
  private readonly v = new THREE.Vector3();

  constructor(parent: HTMLElement, events: EventBus) {
    this.root = document.createElement('div');
    this.root.className = 'damage-numbers';
    parent.appendChild(this.root);
    events.on('damage:number', ({ position, amount, kind }) => this.add(position, amount, kind));
  }

  private add(position: THREE.Vector3, amount: number, kind: DamageKind): void {
    if (!this.enabled || amount < 0.5) return;
    if (this.live.length >= MAX) this.remove(0);
    const element = isElementId(kind);
    const style: Style = element ? { color: ELEMENTS[kind].css, size: 13 } : STYLES[kind];
    const el = this.free.pop() ?? document.createElement('div');
    el.className = 'damage-number';
    el.textContent = `${Math.round(amount)}${style.suffix ?? ''}`;
    el.style.color = style.color;
    el.style.fontSize = `${style.size}px`;
    this.root.appendChild(el);
    this.live.push({ el, pos: position.clone(), age: 0, life: element ? 0.7 : 0.95, drift: (Math.random() - 0.5) * 0.5 });
  }

  private remove(i: number): void {
    const f = this.live[i];
    f.el.remove();
    this.free.push(f.el);
    this.live.splice(i, 1);
  }

  update(dt: number, camera: THREE.Camera, width: number, height: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.age += dt;
      if (f.age >= f.life) {
        this.remove(i);
        continue;
      }
      // Aufsteigen, leicht zur Seite treiben (langsamer werdend).
      const rise = 1 - f.age / f.life;
      f.pos.y += dt * 0.9 * rise;
      f.pos.x += dt * f.drift * rise;
      this.v.copy(f.pos).project(camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.2 || Math.abs(this.v.y) > 1.2) {
        f.el.style.opacity = '0';
        continue;
      }
      const x = ((this.v.x + 1) / 2) * width;
      const y = ((1 - this.v.y) / 2) * height;
      // Kurz aufploppen, am Ende ausblenden.
      const pop = 1 + 0.5 * Math.max(0, 1 - f.age / 0.12);
      f.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
      f.el.style.opacity = Math.min(1, (f.life - f.age) / 0.3).toFixed(2);
    }
  }

  clear(): void {
    while (this.live.length) this.remove(0);
  }
}
