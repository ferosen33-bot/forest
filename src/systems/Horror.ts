import * as THREE from 'three';
import type { Audio, SoundId } from './Audio';
import type { HeightMap } from '../world/HeightMap';
import type { Fear } from './Fear';

export interface HorrorFrame {
  dt: number;
  /** Dunkelheit draußen bzw. in der Höhle (0..1). */
  darkness: number;
  inCave: boolean;
  /** Fußposition des Spielers und Blick der Kamera. */
  player: THREE.Vector3;
  eye: THREE.Vector3;
  look: THREE.Vector3;
  moving: boolean;
  /** Schlaf, Tod, Menüs: keine Schrecken. */
  paused: boolean;
}

type HorrorEvent = 'watcher' | 'knock' | 'twig' | 'scream' | 'follow' | 'whisper';

/** Eine Gestalt, die am Rand des Blickfelds steht und verschwindet, wenn man hinsieht. */
interface Watcher {
  mesh: THREE.Group;
  life: number;
  fading: number;
}

const BODY = new THREE.MeshStandardMaterial({ color: 0x0b0a09, roughness: 1, flatShading: true });
// Ohne Nebel: die Augen glimmen auch auf Distanz durch die Dunkelheit.
const EYES = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa060).multiplyScalar(3), fog: false });

/** Hagere, zu große Silhouette mit glühenden Augen (bewusst unnatürlich proportioniert). */
function createWatcher(): THREE.Group {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.11, 1.1, 6), BODY);
  torso.position.y = 1.55;
  torso.rotation.x = 0.12;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 7, 5), BODY);
  head.scale.set(0.85, 1.2, 0.95);
  head.position.set(0, 2.25, 0.08);
  g.add(head);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 1.05, 5), BODY);
    leg.position.set(s * 0.09, 0.52, 0);
    g.add(leg);
    // Überlange Arme hängen fast bis zum Boden.
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.025, 1.45, 5), BODY);
    arm.position.set(s * 0.24, 1.3, 0.05);
    arm.rotation.z = s * 0.08;
    g.add(arm);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), EYES);
    eye.position.set(s * 0.05, 2.28, 0.2);
    g.add(eye);
  }
  g.traverse((o) => (o.castShadow = false));
  return g;
}

/**
 * Nächtlicher Horror: In der Dunkelheit spielt die Insel dem Spieler Streiche – Gestalten am
 * Waldrand, dreimaliges Klopfen, knackende Äste im Rücken, Schreie in der Ferne, Schritte, die
 * folgen, Flüstern in Höhlen. Je größer die Furcht, desto häufiger (und desto mehr Einbildung).
 */
export class Horror {
  readonly group = new THREE.Group();
  private timer = 30;
  private readonly watchers: Watcher[] = [];
  private follow = 0;
  private followStep = 0;
  private knocks: number[] = [];
  private knockAt = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(
    private readonly audio: Audio,
    private readonly heightMap: HeightMap,
    private readonly fear: Fear,
    private readonly rng: () => number = Math.random,
  ) {
    this.group.name = 'Horror';
  }

  /** Erzwingt sofort ein bestimmtes Ereignis (Debug/Tests). */
  trigger(event: HorrorEvent, f: HorrorFrame): void {
    this.start(event, f);
  }

  get activeWatchers(): number {
    return this.watchers.length;
  }

  update(f: HorrorFrame): void {
    this.updateWatchers(f);
    this.updateFollow(f);
    this.updateKnocks(f);
    if (f.paused || f.darkness < 0.5) {
      this.timer = Math.max(this.timer, 20);
      return;
    }
    // Je größer die Furcht, desto öfter – und ab der Halluzinationsschwelle noch einmal doppelt so oft.
    this.timer -= f.dt * (1 + this.fear.value * 1.5) * (this.fear.hallucinating ? 2 : 1);
    if (this.timer > 0) return;
    this.timer = 40 + this.rng() * 50;
    this.start(this.pick(f), f);
  }

  private pick(f: HorrorFrame): HorrorEvent {
    const table: [HorrorEvent, number][] = f.inCave
      ? [['whisper', 3], ['follow', 2], ['twig', 1]]
      : [['watcher', 3], ['knock', 2], ['twig', 2], ['scream', 1], ['follow', 1.5]];
    const total = table.reduce((s, e) => s + e[1], 0);
    let r = this.rng() * total;
    for (const [e, w] of table) if ((r -= w) < 0) return e;
    return table[0][0];
  }

  private start(event: HorrorEvent, f: HorrorFrame): void {
    switch (event) {
      case 'watcher':
        if (!f.inCave) this.spawnWatcher(f);
        break;
      case 'knock':
        // Dreimal Holz auf Holz, irgendwo hinter dem Spieler im Wald.
        this.knockAt.copy(this.behind(f, 30 + this.rng() * 20)).setY(f.player.y + 2);
        this.knocks = [0, 0.45, 0.9];
        this.fear.scare(0.08);
        break;
      case 'twig':
        this.sound('twig', this.behind(f, 5 + this.rng() * 4), 0.9);
        this.fear.scare(0.1);
        break;
      case 'scream':
        this.sound('scream', this.around(f, 70 + this.rng() * 60), 0.7);
        this.fear.scare(0.06);
        break;
      case 'follow':
        this.follow = 7;
        this.followStep = 0;
        break;
      case 'whisper':
        this.sound('whisper', this.behind(f, 2.5 + this.rng() * 2), 0.8);
        this.fear.scare(0.12);
        break;
    }
  }

  /** Punkt hinter dem Spieler (aus dem Blickfeld) in `dist` m, mit etwas Streuung. */
  private behind(f: HorrorFrame, dist: number): THREE.Vector3 {
    const back = Math.atan2(-f.look.x, -f.look.z) + (this.rng() - 0.5) * 1.6;
    return this.tmp.set(f.player.x + Math.sin(back) * dist, f.player.y + 1, f.player.z + Math.cos(back) * dist);
  }

  private around(f: HorrorFrame, dist: number): THREE.Vector3 {
    const a = this.rng() * Math.PI * 2;
    return this.tmp.set(f.player.x + Math.sin(a) * dist, f.player.y + 3, f.player.z + Math.cos(a) * dist);
  }

  private sound(id: SoundId, at: THREE.Vector3, volume: number): void {
    this.audio.play(id, { volume, position: at });
  }

  // ---------------------------------------------------------------------------
  // Gestalten
  // ---------------------------------------------------------------------------

  private spawnWatcher(f: HorrorFrame): void {
    if (this.watchers.length >= 2) return;
    // Am Rand des Blickfelds (20–42° neben der Blickrichtung), 22–36 m entfernt.
    const view = Math.atan2(f.look.x, f.look.z);
    const side = (this.rng() < 0.5 ? -1 : 1) * (0.35 + this.rng() * 0.38);
    const a = view + side;
    const d = 22 + this.rng() * 14;
    const x = f.player.x + Math.sin(a) * d;
    const z = f.player.z + Math.cos(a) * d;
    const y = this.heightMap.heightAt(x, z);
    if (y < this.heightMap.waterLevel + 0.3) return;
    const mesh = createWatcher();
    mesh.position.set(x, y, z);
    // Schaut den Spieler an.
    mesh.rotation.y = Math.atan2(f.player.x - x, f.player.z - z);
    this.group.add(mesh);
    this.watchers.push({ mesh, life: 25, fading: 0 });
  }

  private updateWatchers(f: HorrorFrame): void {
    for (let i = this.watchers.length - 1; i >= 0; i--) {
      const w = this.watchers[i];
      if (w.fading > 0) {
        w.fading -= f.dt;
        w.mesh.scale.y = Math.max(0.01, w.fading / 0.25);
        if (w.fading <= 0) {
          this.group.remove(w.mesh);
          this.watchers.splice(i, 1);
        }
        continue;
      }
      w.life -= f.dt;
      const to = this.tmp2.copy(w.mesh.position).setY(w.mesh.position.y + 2).sub(f.eye);
      const dist = to.length();
      const angle = f.look.angleTo(to.divideScalar(dist));
      // Hingesehen oder zu nah gekommen → weg (mit Flüstern), sonst irgendwann still verschwunden.
      if (angle < 0.14 || dist < 13) {
        w.fading = 0.25;
        this.sound('whisper', w.mesh.position.clone().setY(w.mesh.position.y + 2), 0.9);
        this.fear.scare(0.15);
      } else if (w.life <= 0 || f.darkness < 0.35) {
        w.fading = 0.25;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Schritte, die folgen / Klopfen
  // ---------------------------------------------------------------------------

  private updateFollow(f: HorrorFrame): void {
    if (this.follow <= 0) return;
    this.follow -= f.dt;
    // Nur wenn der Spieler geht – bleibt er stehen, verstummen auch die Schritte hinter ihm.
    if (!f.moving) return;
    this.followStep -= f.dt;
    if (this.followStep > 0) return;
    this.followStep = 0.55;
    const at = this.tmp.copy(f.look).setY(0).normalize().multiplyScalar(-3.5).add(f.player);
    this.sound(f.inCave ? 'stepRock' : 'stepGrass', at, 0.45);
    if (this.follow < 0.6) this.fear.scare(0.12);
  }

  private updateKnocks(f: HorrorFrame): void {
    if (!this.knocks.length) return;
    for (let i = 0; i < this.knocks.length; i++) this.knocks[i] -= f.dt;
    while (this.knocks.length && this.knocks[0] <= 0) {
      this.knocks.shift();
      this.sound('knock', this.knockAt, 1);
    }
  }
}
