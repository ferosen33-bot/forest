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
  /** Trägt der Spieler ein Licht (Fackel, Lampe)? */
  lit?: boolean;
}

export type HorrorEvent =
  | 'watcher'
  | 'knock'
  | 'twig'
  | 'scream'
  | 'follow'
  | 'whisper'
  // Meilenstein 57
  | 'eyes'
  | 'runner'
  | 'silence'
  | 'breath'
  | 'flicker'
  | 'hum'
  | 'bell'
  | 'offering';

/** Eine Gestalt, die am Rand des Blickfelds steht und verschwindet, wenn man hinsieht. */
interface Watcher {
  mesh: THREE.Group;
  life: number;
  fading: number;
}

/** Augenpaar im Dunkel zwischen den Bäumen. */
interface Eyes {
  mesh: THREE.Group;
  life: number;
  blink: number;
  out: number;
}

/** Gestalt in Bewegung: huscht in der Ferne quer durchs Bild. */
interface Mover {
  mesh: THREE.Group;
  velocity: THREE.Vector3;
  life: number;
}

/** Hinterlassenschaft im Wald, die liegen bleibt, bis der Spieler weit weg ist. */
interface Offering {
  mesh: THREE.Group;
}

const BODY = new THREE.MeshStandardMaterial({ color: 0x0b0a09, roughness: 1, flatShading: true });
// Ohne Nebel: die Augen glimmen auch auf Distanz durch die Dunkelheit.
const EYES = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa060).multiplyScalar(3), fog: false });
const EYES_PALE = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8f0ff).multiplyScalar(2.2), fog: false });
const EYE_GEO = new THREE.SphereGeometry(0.035, 6, 4);

/** Hagere, zu große Silhouette mit glühenden Augen (bewusst unnatürlich proportioniert). */
export function createWatcher(): THREE.Group {
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
    const eye = new THREE.Mesh(EYE_GEO, EYES);
    eye.position.set(s * 0.05, 2.28, 0.2);
    g.add(eye);
  }
  g.traverse((o) => (o.castShadow = false));
  return g;
}

// ---------------------------------------------------------------------------
// Gaben: was die Insel dem Spieler in den Weg legt
// ---------------------------------------------------------------------------

const STICK = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
const TWINE = new THREE.MeshStandardMaterial({ color: 0x8a7a58, roughness: 1 });
const STONE = new THREE.MeshStandardMaterial({ color: 0x6a6860, roughness: 1, flatShading: true });
const FEATHER = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8 });
const PORCELAIN = new THREE.MeshStandardMaterial({ color: 0xe8ddd0, roughness: 0.35 });
const DRESS = new THREE.MeshStandardMaterial({ color: 0x6a2a34, roughness: 0.9 });
const WAX = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.6 });
const FLAME = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb050).multiplyScalar(2.5), fog: false });
const BLOOD = new THREE.MeshStandardMaterial({ color: 0x3a0606, roughness: 0.2 });

const part = (g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  g.add(m);
  return m;
};

/** Strichmännchen aus Zweigen, mit Schnur gebunden, an einem Dreibein aufgehängt. */
function stickFigure(g: THREE.Group, x: number, y: number, z: number, s = 1): void {
  const stick = (len: number, px: number, py: number, rz: number) => part(g, new THREE.CylinderGeometry(0.012 * s, 0.015 * s, len * s, 4), STICK, x + px * s, y + py * s, z, 0, 0, rz);
  stick(0.7, 0, 0, 0);
  stick(0.55, 0, 0.18, Math.PI / 2);
  stick(0.45, -0.1, -0.5, 0.35);
  stick(0.45, 0.1, -0.5, -0.35);
  stick(0.3, -0.25, 0.05, 0.6);
  stick(0.3, 0.25, 0.05, -0.6);
  part(g, new THREE.TorusGeometry(0.035 * s, 0.01 * s, 4, 8), TWINE, x, y + 0.18 * s, z, Math.PI / 2);
  part(g, new THREE.TorusGeometry(0.03 * s, 0.01 * s, 4, 8), TWINE, x, y - 0.25 * s, z, Math.PI / 2);
}

function createOffering(kind: number, rng: () => number): THREE.Group {
  const g = new THREE.Group();
  if (kind === 0) {
    // Dreibein aus Ästen, daran hängen drei Strichmännchen.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      part(g, new THREE.CylinderGeometry(0.03, 0.04, 2.6, 5), STICK, Math.cos(a) * 0.45, 1.2, Math.sin(a) * 0.45, Math.sin(a) * 0.32, 0, -Math.cos(a) * 0.32);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const x = Math.cos(a) * 0.22;
      const z = Math.sin(a) * 0.22;
      part(g, new THREE.CylinderGeometry(0.004, 0.004, 0.5, 3), TWINE, x, 2.0, z);
      stickFigure(g, x, 1.4, z, 0.9);
    }
  } else if (kind === 1) {
    // Steinhaufen, obenauf ein toter Vogel mit ausgebreiteten Flügeln, ein Blutfleck
    let y = 0;
    for (let i = 0; i < 6; i++) {
      const r = 0.32 - i * 0.04;
      part(g, new THREE.DodecahedronGeometry(r, 0), STONE, (rng() - 0.5) * 0.08, y + r * 0.7, (rng() - 0.5) * 0.08, rng(), rng() * 6, rng()).scale.set(1, 0.6, 1);
      y += r * 1.1;
    }
    part(g, new THREE.SphereGeometry(0.08, 8, 6), FEATHER, 0, y + 0.05, 0).scale.set(0.8, 0.7, 1.3);
    for (const s of [-1, 1]) part(g, new THREE.BoxGeometry(0.28, 0.01, 0.12), FEATHER, s * 0.16, y + 0.05, 0, 0, 0, s * 0.15);
    part(g, new THREE.ConeGeometry(0.02, 0.06, 4), STONE, 0, y + 0.06, 0.12, Math.PI / 2);
    part(g, new THREE.CircleGeometry(0.35, 10).rotateX(-Math.PI / 2), BLOOD, 0.3, 0.02, 0.2);
  } else if (kind === 2) {
    // Baumstumpf, darauf eine Puppe, die zum Spieler schaut
    part(g, new THREE.CylinderGeometry(0.35, 0.42, 0.55, 9), STICK, 0, 0.27, 0);
    part(g, new THREE.CylinderGeometry(0.08, 0.18, 0.3, 8), DRESS, 0, 0.7, 0);
    part(g, new THREE.SphereGeometry(0.1, 12, 10), PORCELAIN, 0, 0.94, 0.01);
    for (const s of [-1, 1]) {
      part(g, new THREE.SphereGeometry(0.016, 6, 4), FEATHER, s * 0.035, 0.96, 0.095);
      part(g, new THREE.CylinderGeometry(0.025, 0.022, 0.22, 6), PORCELAIN, s * 0.1, 0.68, 0.02, 0, 0, s * 0.2);
      part(g, new THREE.CylinderGeometry(0.028, 0.025, 0.22, 6), PORCELAIN, s * 0.05, 0.56, 0.12, Math.PI / 2);
    }
  } else {
    // Kreis aus brennenden Kerzen um einen Fleck Asche
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const h = 0.1 + rng() * 0.12;
      part(g, new THREE.CylinderGeometry(0.025, 0.025, h, 6), WAX, Math.cos(a) * 0.9, h / 2, Math.sin(a) * 0.9);
      part(g, new THREE.SphereGeometry(0.018, 5, 4), FLAME, Math.cos(a) * 0.9, h + 0.025, Math.sin(a) * 0.9).scale.set(1, 1.8, 1);
    }
    part(g, new THREE.CircleGeometry(0.5, 12).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 1 }), 0, 0.015, 0);
    // In der Mitte liegt ein Strichmännchen aus Zweigen.
    const lying = new THREE.Group();
    stickFigure(lying, 0, 0, 0, 0.6);
    lying.rotation.x = -Math.PI / 2;
    lying.position.y = 0.05;
    g.add(lying);
  }
  return g;
}

/**
 * Nächtlicher Horror: In der Dunkelheit spielt die Insel dem Spieler Streiche – Gestalten am
 * Waldrand, dreimaliges Klopfen, knackende Äste im Rücken, Schreie in der Ferne, Schritte, die
 * folgen, Flüstern in Höhlen. Seit Meilenstein 57 außerdem: Augen zwischen den Bäumen, etwas, das
 * vorbeihuscht, plötzliche Stille und Atem im Nacken, flackerndes Licht, Summen in der Ferne, eine
 * Glocke in der Dämmerung und Gaben auf dem Weg. Bewusst ohne Schreckmomente, die einen anspringen.
 * Je größer die Furcht, desto häufiger (und desto mehr Einbildung).
 */
export class Horror {
  readonly group = new THREE.Group();
  /** Lampe des Spielers setzt aus (Sekunden). */
  onFlicker: ((seconds: number) => void) | null = null;
  /** Erzählende Zeile (beim ersten Mal je Ereignis). */
  onMessage: ((text: string) => void) | null = null;
  private timer = 30;
  private duskTimer = 120;
  private readonly watchers: Watcher[] = [];
  private readonly eyes: Eyes[] = [];
  private readonly movers: Mover[] = [];
  private readonly offerings: Offering[] = [];
  private follow = 0;
  private followStep = 0;
  private knocks: number[] = [];
  private knockAt = new THREE.Vector3();
  /** Atem im Nacken nach der Stille (s bis dahin, < 0 = nichts geplant). */
  private breathIn = -1;
  private readonly told = new Set<HorrorEvent>();
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
    return this.watchers.length + this.movers.length;
  }

  get activeEyes(): number {
    return this.eyes.length;
  }

  /** Wo gerade Augen glimmen (Tests, Debug). */
  get eyePositions(): THREE.Vector3[] {
    return this.eyes.filter((e) => e.out < 0).map((e) => e.mesh.position.clone());
  }

  get offeringCount(): number {
    return this.offerings.length;
  }

  update(f: HorrorFrame): void {
    this.updateWatchers(f);
    this.updateEyes(f);
    this.updateMovers(f);
    this.updateOfferings(f);
    this.updateFollow(f);
    this.updateKnocks(f);
    if (this.breathIn >= 0) {
      this.breathIn -= f.dt;
      if (this.breathIn < 0) {
        this.sound('breath', this.behind(f, 1.4), 1);
        this.fear.scare(0.22);
      }
    }
    if (f.paused) {
      this.timer = Math.max(this.timer, 20);
      return;
    }
    // Dämmerung: selten etwas in der Ferne – eine Glocke, Summen, ein Schrei.
    if (f.darkness >= 0.3 && f.darkness < 0.5 && !f.inCave) {
      this.duskTimer -= f.dt;
      if (this.duskTimer <= 0) {
        this.duskTimer = 90 + this.rng() * 120;
        const r = this.rng();
        this.start(r < 0.45 ? 'bell' : r < 0.8 ? 'hum' : 'scream', f);
      }
    }
    if (f.darkness < 0.5) {
      this.timer = Math.max(this.timer, 20);
      return;
    }
    // Je größer die Furcht, desto öfter – und ab der Halluzinationsschwelle noch einmal doppelt so oft.
    this.timer -= f.dt * (1 + this.fear.value * 1.5) * (this.fear.hallucinating ? 2 : 1);
    if (this.timer > 0) return;
    this.timer = 32 + this.rng() * 40;
    this.start(this.pick(f), f);
  }

  private pick(f: HorrorFrame): HorrorEvent {
    const table: [HorrorEvent, number][] = f.inCave
      ? [['whisper', 3], ['follow', 2], ['twig', 1], ['breath', 1.5], ['flicker', f.lit ? 1.2 : 0]]
      : [
          ['watcher', 3],
          ['knock', 2],
          ['twig', 2],
          ['scream', 1],
          ['follow', 1.5],
          ['eyes', 2.5],
          ['runner', 1.5],
          ['silence', 1],
          ['breath', 0.8],
          ['flicker', f.lit ? 1 : 0],
          ['hum', 1],
          ['offering', 1.3],
        ];
    const total = table.reduce((s, e) => s + e[1], 0);
    let r = this.rng() * total;
    for (const [e, w] of table) if ((r -= w) < 0) return e;
    return table[0][0];
  }

  private tell(event: HorrorEvent, text: string): void {
    if (this.told.has(event)) return;
    this.told.add(event);
    this.onMessage?.(text);
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
      case 'eyes':
        if (!f.inCave) this.spawnEyes(f);
        break;
      case 'runner':
        if (!f.inCave) this.spawnRunner(f);
        break;
      case 'silence':
        // Alles verstummt – und nach ein paar Sekunden atmet etwas direkt hinter dem Spieler.
        this.audio.duckAmbience(16);
        this.breathIn = 8 + this.rng() * 4;
        this.tell('silence', 'Kein Vogel, kein Wind. Der Wald hält den Atem an.');
        break;
      case 'breath':
        this.sound('breath', this.behind(f, 1.8), 0.9);
        this.fear.scare(0.15);
        break;
      case 'flicker':
        if (!f.lit) break;
        this.onFlicker?.(1.6 + this.rng() * 1.6);
        this.sound('whisper', this.behind(f, 2), 0.6);
        this.fear.scare(0.14);
        break;
      case 'hum':
        this.sound('hum', this.around(f, 45 + this.rng() * 40), 0.55);
        this.fear.scare(0.05);
        this.tell('hum', 'Irgendwo im Wald summt jemand ein Kinderlied.');
        break;
      case 'bell':
        this.sound('bell', this.around(f, 120 + this.rng() * 80), 0.35);
        break;
      case 'offering':
        if (!f.inCave) this.placeOffering(f);
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

  /** Bodenpunkt in Blickrichtung (Winkel relativ zum Blick, Entfernung) – null über Wasser. */
  private ahead(f: HorrorFrame, angle: number, dist: number): THREE.Vector3 | null {
    const a = Math.atan2(f.look.x, f.look.z) + angle;
    const x = f.player.x + Math.sin(a) * dist;
    const z = f.player.z + Math.cos(a) * dist;
    const y = this.heightMap.heightAt(x, z);
    if (y < this.heightMap.waterLevel + 0.3) return null;
    return new THREE.Vector3(x, y, z);
  }

  private sound(id: SoundId, at: THREE.Vector3, volume: number): void {
    this.audio.play(id, { volume, position: at });
  }

  /** Sieht der Spieler gerade (ungefähr) dorthin? */
  private looksAt(f: HorrorFrame, at: THREE.Vector3, cone: number): boolean {
    const to = this.tmp2.copy(at).sub(f.eye);
    const dist = to.length();
    return dist > 0.01 && f.look.angleTo(to.divideScalar(dist)) < cone;
  }

  // ---------------------------------------------------------------------------
  // Gestalten
  // ---------------------------------------------------------------------------

  private spawnWatcher(f: HorrorFrame): void {
    if (this.watchers.length >= 2) return;
    // Am Rand des Blickfelds (20–42° neben der Blickrichtung), 22–36 m entfernt.
    const side = (this.rng() < 0.5 ? -1 : 1) * (0.35 + this.rng() * 0.38);
    const at = this.ahead(f, side, 22 + this.rng() * 14);
    if (!at) return;
    const mesh = createWatcher();
    mesh.position.copy(at);
    // Schaut den Spieler an.
    mesh.rotation.y = Math.atan2(f.player.x - at.x, f.player.z - at.z);
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
      const head = this.tmp.copy(w.mesh.position).setY(w.mesh.position.y + 2);
      const dist = head.distanceTo(f.eye);
      // Hingesehen oder zu nah gekommen → weg (mit Flüstern), sonst irgendwann still verschwunden.
      if (this.looksAt(f, head, 0.14) || dist < 13) {
        w.fading = 0.25;
        this.sound('whisper', w.mesh.position.clone().setY(w.mesh.position.y + 2), 0.9);
        this.fear.scare(0.15);
      } else if (w.life <= 0 || f.darkness < 0.35) {
        w.fading = 0.25;
      }
    }
  }

  /** Augenpaare im Dunkel vor dem Spieler (zwischen den Bäumen), die nach und nach erlöschen. */
  private spawnEyes(f: HorrorFrame): void {
    if (this.eyes.length) return;
    const n = 4 + Math.floor(this.rng() * 6);
    for (let i = 0; i < n; i++) {
      const at = this.ahead(f, (this.rng() - 0.5) * 2.2, 15 + this.rng() * 22);
      if (!at) continue;
      const g = new THREE.Group();
      const mat = this.rng() < 0.25 ? EYES_PALE : EYES;
      const h = 0.4 + this.rng() * 1.6;
      const gap = 0.06 + this.rng() * 0.05;
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(EYE_GEO, mat);
        e.position.set(s * gap * 1.4, h, 0);
        e.scale.setScalar(1.9);
        g.add(e);
      }
      g.position.copy(at);
      g.rotation.y = Math.atan2(f.player.x - at.x, f.player.z - at.z);
      this.group.add(g);
      this.eyes.push({ mesh: g, life: 20 + this.rng() * 20, blink: 1 + this.rng() * 4, out: -1 });
    }
    this.fear.scare(0.12);
    this.tell('eyes', 'Zwischen den Bäumen glimmen Augen. Viele.');
  }

  private updateEyes(f: HorrorFrame): void {
    for (let i = this.eyes.length - 1; i >= 0; i--) {
      const e = this.eyes[i];
      if (e.out >= 0) {
        e.out -= f.dt;
        if (e.out < 0) {
          this.group.remove(e.mesh);
          this.eyes.splice(i, 1);
        }
        continue;
      }
      e.life -= f.dt;
      // Blinzeln
      e.blink -= f.dt;
      const closed = e.blink < 0.12;
      if (e.blink < 0) e.blink = 1.5 + this.rng() * 5;
      for (const c of e.mesh.children) c.scale.y = closed ? 0.15 : 1.9;
      // Wer näher kommt, mit Licht hinleuchtet oder lange genug wartet, lässt sie verlöschen – nicht alle zugleich.
      const dist = e.mesh.position.distanceTo(f.player);
      const lit = f.lit && this.looksAt(f, this.tmp.copy(e.mesh.position).setY(e.mesh.position.y + 1), 0.12);
      if (dist < 11 || lit || e.life <= 0 || f.darkness < 0.35) {
        e.mesh.visible = false;
        e.out = 0.05 + this.rng() * 0.4;
        if (dist < 11 && this.rng() < 0.4) this.sound('rustle', e.mesh.position, 0.6);
      }
    }
  }

  /** Läufer: huscht 30–40 m entfernt quer durchs Bild. */
  private spawnRunner(f: HorrorFrame): void {
    if (this.movers.length) return;
    const look = Math.atan2(f.look.x, f.look.z);
    const at = this.ahead(f, (this.rng() - 0.5) * 0.5, 30 + this.rng() * 10);
    if (!at) return;
    const mesh = createWatcher();
    mesh.position.copy(at);
    const dir = this.rng() < 0.5 ? 1 : -1;
    const velocity = new THREE.Vector3(Math.cos(look) * dir, 0, -Math.sin(look) * dir).multiplyScalar(9);
    // Er beginnt seitlich und läuft durch die Mitte des Bilds.
    mesh.position.addScaledVector(velocity, -0.9);
    mesh.position.y = this.heightMap.heightAt(mesh.position.x, mesh.position.z);
    this.sound('rustle', mesh.position, 0.8);
    this.fear.scare(0.12);
    mesh.rotation.y = Math.atan2(velocity.x, velocity.z);
    mesh.rotation.x = 0.25;
    this.group.add(mesh);
    this.movers.push({ mesh, velocity, life: 2.2 });
  }

  private updateMovers(f: HorrorFrame): void {
    for (let i = this.movers.length - 1; i >= 0; i--) {
      const m = this.movers[i];
      m.life -= f.dt;
      const p = m.mesh.position;
      p.addScaledVector(m.velocity, f.dt);
      p.y = this.heightMap.heightAt(p.x, p.z) + Math.abs(Math.sin(m.life * 18)) * 0.12;
      if (m.life <= 0) {
        this.group.remove(m.mesh);
        this.movers.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Gaben
  // ---------------------------------------------------------------------------

  /** Legt etwas vor den Spieler in den Wald – es bleibt dort, bis er weit genug weg ist. */
  private placeOffering(f: HorrorFrame): void {
    if (this.offerings.length >= 6) return;
    const at = this.ahead(f, (this.rng() < 0.5 ? -1 : 1) * (0.25 + this.rng() * 0.3), 24 + this.rng() * 10);
    if (!at) return;
    const mesh = createOffering(Math.floor(this.rng() * 4), this.rng);
    mesh.position.copy(at);
    mesh.rotation.y = Math.atan2(f.player.x - at.x, f.player.z - at.z);
    this.group.add(mesh);
    this.offerings.push({ mesh });
  }

  private updateOfferings(f: HorrorFrame): void {
    for (let i = this.offerings.length - 1; i >= 0; i--) {
      const o = this.offerings[i];
      if (o.mesh.position.distanceTo(f.player) < 250) continue;
      this.group.remove(o.mesh);
      o.mesh.traverse((c) => (c as THREE.Mesh).geometry?.dispose());
      this.offerings.splice(i, 1);
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
