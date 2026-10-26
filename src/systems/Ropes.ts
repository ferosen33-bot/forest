import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { Player, PlayerCarrier } from '../entities/Player';
import type { HeightMap } from '../world/HeightMap';
import type { BuildingSystem, Structure } from './building/BuildingSystem';
import type { Audio } from './Audio';
import type { Prompt } from './InteractionSystem';

/** Mindesthöhe einer Steilkante für ein Kletterseil (m). */
export const ROPE_MIN_DROP = 3.5;
const ROPE_MAX_DROP = 45;
const CLIMB_DOWN_SPEED = 2.4;
const CLIMB_UP_SPEED = 1.5;
/** Ausdauer pro Sekunde beim Hochklettern. */
const CLIMB_STAMINA = 5;

export interface RopePath {
  /** Seilverlauf von der Verankerung über die Kante bis zum Grund (Welt). */
  points: THREE.Vector3[];
  /** Fußpunkt oben (hinter der Verankerung) und unten (vor der Wand). */
  top: THREE.Vector3;
  bottom: THREE.Vector3;
  drop: number;
}

/**
 * Seilverlauf für eine Verankerung an `position`, Blick (lokal +Z) über die Kante. `null`, wenn dort keine
 * Steilkante ist, der Grund im Wasser liegt oder die Wand zu hoch ist.
 */
export function ropePath(hm: HeightMap, position: THREE.Vector3, rotation: number): RopePath | null {
  const fx = Math.sin(rotation);
  const fz = Math.cos(rotation);
  const at = (d: number) => hm.heightAt(position.x + fx * d, position.z + fz * d);
  const top = position.y;
  let lip = -1;
  for (let d = 0.5; d <= 3; d += 0.25) {
    if (at(d) < top - 1) {
      lip = d;
      break;
    }
  }
  if (lip < 0) return null;
  let foot = -1;
  for (let d = lip; d <= lip + 14; d += 0.5) {
    const h = at(d);
    if (h < top - ROPE_MIN_DROP && h - at(d + 0.5) < 0.25) {
      foot = d + 0.6;
      break;
    }
  }
  if (foot < 0) return null;
  const bottomY = at(foot);
  const drop = top - bottomY;
  if (bottomY < hm.waterLevel + 0.1 || drop > ROPE_MAX_DROP) return null;
  const p = (d: number, y: number) => new THREE.Vector3(position.x + fx * d, y, position.z + fz * d);
  const points = [p(0.1, top + 0.45), p(lip - 0.2, top + 0.12)];
  const steps = Math.max(4, Math.ceil(drop / 1.5));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const d = lip + (foot - 0.4 - lip) * t;
    // Das Seil liegt an der Wand an, schneidet sie aber nie.
    points.push(p(d, Math.max(top + (bottomY + 0.05 - top) * t, at(d) + 0.12)));
  }
  return { points, top: p(-0.7, hm.heightAt(position.x - fx * 0.7, position.z - fz * 0.7)), bottom: p(foot, bottomY), drop };
}

interface Rope {
  structure: Structure;
  path: RopePath;
  mesh: THREE.Mesh;
}

export interface RopeDeps {
  building: BuildingSystem;
  player: Player;
  heightMap: HeightMap;
  audio: Audio;
  events: EventBus;
}

const ropeMaterial = new THREE.MeshStandardMaterial({ color: 0x7b6646, roughness: 0.95 });

/**
 * Kletterseile an Steilkanten: oben `E` = abseilen, unten (am Seilende) `E` = hochklettern.
 * Das Klettern selbst führt den Spieler den Seilverlauf entlang (als `PlayerCarrier`).
 */
export class Ropes implements PlayerCarrier {
  readonly group = new THREE.Group();
  private readonly ropes = new Map<Structure, Rope>();
  private climb: { path: THREE.Vector3[]; distance: number; length: number; up: boolean } | null = null;
  private readonly feet = new THREE.Vector3();

  constructor(private readonly d: RopeDeps) {
    this.group.name = 'Ropes';
    d.events.on('player:respawned', () => this.stop());
  }

  get climbing(): boolean {
    return this.climb !== null;
  }

  prompt(s: Structure): Prompt {
    const rope = this.rope(s);
    return rope ? { key: 'E', action: `Abseilen (${Math.round(rope.path.drop)} m)`, label: s.def.name } : { key: null, action: 'Hängt ins Leere', label: s.def.name };
  }

  /** Am Seilende unten oder beim Klettern: ersetzt den Hinweis des anvisierten Ziels. */
  override(): { prompt: Prompt; run: () => void } | null {
    if (this.climb) return { prompt: { key: null, action: this.climb.up ? 'Klettert hinauf …' : 'Seilt sich ab …', label: 'Kletterseil' }, run: () => {} };
    const p = this.d.player.position;
    for (const rope of this.ropes.values()) {
      const b = rope.path.bottom;
      if (Math.hypot(p.x - b.x, p.z - b.z) < 1.6 && Math.abs(p.y - b.y) < 1.5) {
        return { prompt: { key: 'E', action: 'Am Seil hochklettern', label: 'Kletterseil' }, run: () => this.start(rope, true) };
      }
    }
    return null;
  }

  interact(s: Structure): void {
    const rope = this.rope(s);
    if (rope) this.start(rope, false);
  }

  private rope(s: Structure): Rope | null {
    let rope = this.ropes.get(s);
    if (rope) return rope;
    const path = ropePath(this.d.heightMap, s.position, s.rotation);
    if (!path) return null;
    const curve = new THREE.CatmullRomCurve3(path.points, false, 'catmullrom', 0.2);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, path.points.length * 6, 0.022, 5), ropeMaterial);
    mesh.castShadow = true;
    this.group.add(mesh);
    rope = { structure: s, path, mesh };
    this.ropes.set(s, rope);
    return rope;
  }

  private start(rope: Rope, up: boolean): void {
    if (this.climb || this.d.player.carrier) return;
    const out = rope.path.points.slice(1).map((pt) => {
      // Füße hängen gut einen Meter unter den Händen, etwas vor der Wand.
      const dx = Math.sin(rope.structure.rotation) * 0.35;
      const dz = Math.cos(rope.structure.rotation) * 0.35;
      return new THREE.Vector3(pt.x + dx, Math.max(pt.y - 1.1, this.d.heightMap.heightAt(pt.x + dx, pt.z + dz)), pt.z + dz);
    });
    const path = [rope.path.top.clone(), ...out, rope.path.bottom.clone()];
    if (up) path.reverse();
    let length = 0;
    for (let i = 1; i < path.length; i++) length += path[i].distanceTo(path[i - 1]);
    this.climb = { path, distance: 0, length, up };
    const player = this.d.player;
    player.carrier = this;
    // Gesicht zur Wand.
    player.yaw = rope.structure.rotation + (up ? 0 : 0);
    this.d.audio.play('rattle', { volume: 0.4, position: rope.path.points[1] });
  }

  private stop(): void {
    this.climb = null;
    if (this.d.player.carrier === this) this.d.player.carrier = null;
  }

  carry(dt: number): THREE.Vector3 {
    const c = this.climb!;
    const player = this.d.player;
    let speed = c.up ? CLIMB_UP_SPEED : CLIMB_DOWN_SPEED;
    if (c.up && !player.stats.useStamina(CLIMB_STAMINA * dt)) speed *= 0.4;
    c.distance = Math.min(c.length, c.distance + speed * dt);
    let rest = c.distance;
    for (let i = 1; i < c.path.length; i++) {
      const seg = c.path[i].distanceTo(c.path[i - 1]);
      if (rest <= seg || i === c.path.length - 1) {
        this.feet.lerpVectors(c.path[i - 1], c.path[i], seg > 0 ? Math.min(1, rest / seg) : 1);
        break;
      }
      rest -= seg;
    }
    if (c.distance >= c.length) {
      const end = this.feet.clone();
      this.stop();
      player.spawn(end, player.yaw);
    }
    return this.feet;
  }

  update(): void {
    for (const s of this.d.building.structures) if (s.def.interaction === 'rope') this.rope(s);
    for (const [s, rope] of this.ropes) {
      if (this.d.building.structures.includes(s)) continue;
      this.group.remove(rope.mesh);
      rope.mesh.geometry.dispose();
      this.ropes.delete(s);
    }
  }
}
