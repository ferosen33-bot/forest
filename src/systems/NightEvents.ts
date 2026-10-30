import * as THREE from 'three';
import type { Audio, SoundId } from './Audio';
import type { HeightMap } from '../world/HeightMap';
import type { Fear } from './Fear';
import type { HorrorFrame } from './Horror';

/**
 * Nachtereignisse: längere, langsame Begebenheiten, die sich über eine Minute oder mehr aufbauen –
 * zum Gruseln, nicht zum Erschrecken (nichts springt einen an):
 * - **Prozession**: Eine Reihe Laternenträger zieht in der Ferne durch den Wald, dazu leiser Gesang.
 *   Wer sich nähert, sieht die Lichter eins nach dem anderen verlöschen.
 * - **Feuer**: In der Ferne brennt ein Lagerfeuer, jemand sitzt daran. Kommt man hin, ist es aus –
 *   nur noch kalte Asche, aus der Rauch steigt.
 * - **Pfeifer**: Jemand pfeift, wie man einen Hund ruft – jedes Mal ein Stück näher. Dann Stille.
 * - **Nebelwand**: Dichter Nebel zieht auf; darin stehen Gestalten, reglos. Wenn er sich hebt, sind
 *   sie fort.
 * - **Spieluhr**: Eine Spieluhr spielt, jedes Mal näher. Zuletzt liegt sie offen auf dem Boden.
 * - **Hirsch**: Ein Hirsch steht reglos und sieht einen an. Er flieht nicht. Schaut man weg, ist er fort.
 * - **Fußspuren**: Vor dem Spieler erscheinen barfüßige Abdrücke, Schritt für Schritt, ins Dunkel hinein.
 * - **Umkreisen**: Etwas raschelt im Unterholz – im Kreis um den Spieler herum.
 */

export type NightEventKind = 'procession' | 'fire' | 'whistler' | 'fogwall' | 'musicbox' | 'deer' | 'footprints' | 'circling';

export const NIGHT_EVENTS: NightEventKind[] = ['procession', 'fire', 'whistler', 'fogwall', 'musicbox', 'deer', 'footprints', 'circling'];

/** Ein laufendes Ereignis: `update` liefert true, wenn es vorbei ist; `end` räumt auf. */
interface Running {
  kind: NightEventKind;
  update(f: HorrorFrame): boolean;
  end(): void;
}

/** Was liegen bleibt (Fußspuren, Spieluhr, Asche) – bis es verblasst oder der Spieler weit weg ist. */
interface Leftover {
  object: THREE.Object3D;
  life: number;
  update?(dt: number): void;
}

const MESSAGES: Record<NightEventKind, string> = {
  procession: 'In der Ferne ziehen Lichter durch den Wald. Langsam, in einer Reihe.',
  fire: 'Zwischen den Bäumen brennt ein Feuer. Jemand sitzt daran.',
  whistler: 'Irgendwo pfeift jemand. So, wie man einen Hund ruft.',
  fogwall: 'Nebel kriecht zwischen den Stämmen heran.',
  musicbox: 'Irgendwo spielt eine Spieluhr. Sie kommt näher.',
  deer: 'Ein Hirsch steht zwischen den Bäumen. Er rührt sich nicht. Er sieht dich an.',
  footprints: 'Vor dir erscheinen Abdrücke im Boden. Nackte Füße.',
  circling: 'Etwas bewegt sich im Unterholz. Im Kreis. Um dich herum.',
};

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

const glowTex: Record<string, THREE.Texture> = {};
/** Weicher Lichthof (für Laternen und Feuer); `soft` fällt ohne Kern sanft ab (Schein, Lichtkreis am Boden). */
function glowTexture(soft = false): THREE.Texture | null {
  const key = soft ? 'soft' : 'core';
  if (glowTex[key] || typeof document === 'undefined') return glowTex[key] ?? null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  const stops = soft ? [[0, 1], [0.2, 0.7], [0.45, 0.28], [0.7, 0.08], [1, 0]] : [[0, 1], [0.25, 0.45], [0.6, 0.1], [1, 0]];
  for (const [t, a] of stops) grad.addColorStop(t, `rgba(255,255,255,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex[key] = new THREE.CanvasTexture(c);
  return glowTex[key];
}

function halo(color: number, size: number, opacity = 1, depthTest = true): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(!depthTest), color, opacity, depthTest, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.scale.setScalar(size);
  return s;
}

/** Lichtschein am Boden (flache, additive Scheibe) – macht Laternen und Feuer auch ohne echtes Licht glaubhaft. */
function pool(color: number, size: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: glowTexture(true), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  m.position.y = 0.06;
  m.renderOrder = 2;
  return m;
}

const CLOAK = new THREE.MeshStandardMaterial({ color: 0x14120f, roughness: 1 });
const LAMP = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb060).multiplyScalar(2), fog: false });
const DEER = new THREE.MeshStandardMaterial({ color: 0x3a2e24, roughness: 1 });
const ANTLER = new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.9 });
const PALE_EYE = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8f0e8).multiplyScalar(1.8), fog: false });
// Fahl wie Reif, mit einem Hauch Eigenleuchten: im Lampenschein deutlich, im Dunkeln eben noch zu ahnen.
const PRINT = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, emissive: 0x2a3036, roughness: 0.9, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
const STONE = new THREE.MeshStandardMaterial({ color: 0x5a5852, roughness: 1, flatShading: true });
const CHAR = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 1 });
const SMOKE = new THREE.SpriteMaterial({ color: 0x8a8a88, transparent: true, opacity: 0.25, depthWrite: false });
const BOX = new THREE.MeshStandardMaterial({ color: 0x5a2a20, roughness: 0.6 });
const BRASS = new THREE.MeshStandardMaterial({ color: 0xb8902e, metalness: 0.7, roughness: 0.35 });
const DANCER = new THREE.MeshStandardMaterial({ color: 0xe8ddd0, roughness: 0.4 });

const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
};

/** Gestalt mit Kapuze und Kutte (ohne Gesicht). */
function hooded(withLantern: boolean): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.ConeGeometry(0.38, 1.6, 8, 1, true), CLOAK, 0, 0.8, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.5, 8), CLOAK, 0, 1.6, 0));
  const hood = mesh(new THREE.ConeGeometry(0.16, 0.45, 8), CLOAK, 0, 2.0, -0.02);
  hood.rotation.x = -0.15;
  g.add(hood);
  if (withLantern) {
    const lantern = new THREE.Group();
    lantern.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 3), CLOAK, 0, 0.15, 0));
    lantern.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.16, 6), LAMP, 0, -0.08, 0));
    const h = halo(0xffa050, 2.6);
    h.position.y = -0.08;
    lantern.add(h);
    // Der Schein dringt durchs Unterholz (ohne Tiefentest) – nur hinter Hügeln wird er ausgeblendet.
    const bloom = halo(0xff8030, 9, 0.35, false);
    bloom.position.y = -0.08;
    bloom.name = 'bloom';
    lantern.add(bloom);
    lantern.position.set(0.32, 1.25, 0.18);
    lantern.name = 'lantern';
    g.add(lantern);
    g.add(pool(0x6a3a14, 6));
  }
  return g;
}

function deer(): THREE.Group {
  const g = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.5, 10, 8), DEER, 0, 1.15, 0);
  body.scale.set(0.55, 0.65, 1.3);
  g.add(body);
  const neck = mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.7, 8), DEER, 0, 1.6, 0.55);
  neck.rotation.x = 0.5;
  g.add(neck);
  const head = mesh(new THREE.SphereGeometry(0.14, 8, 6), DEER, 0, 1.92, 0.78);
  head.scale.set(0.9, 0.9, 1.5);
  g.add(head);
  for (const s of [-1, 1]) {
    for (const z of [-0.45, 0.45]) g.add(mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.9, 6), DEER, s * 0.16, 0.45, z));
    g.add(mesh(new THREE.SphereGeometry(0.025, 6, 4), PALE_EYE, s * 0.09, 1.96, 0.9));
    // Augenschein: Wie bei echtem Wild werfen die Augen das wenige Licht zurück – zwei fahle Punkte im Dunkel.
    const shine = halo(0xc8f0e0, 0.8);
    shine.position.set(s * 0.09, 1.96, 0.94);
    g.add(shine);
    const a = mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.55, 5), ANTLER, s * 0.12, 2.25, 0.72);
    a.rotation.z = -s * 0.5;
    g.add(a);
    const b = mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.3, 5), ANTLER, s * 0.28, 2.38, 0.8);
    b.rotation.set(0.4, 0, -s * 0.2);
    g.add(b);
  }
  return g;
}

function footprint(left: boolean): THREE.Group {
  const g = new THREE.Group();
  const sole = mesh(new THREE.CircleGeometry(0.06, 10).rotateX(-Math.PI / 2), PRINT, 0, 0, 0);
  sole.scale.set(0.8, 1, 1.9);
  g.add(sole);
  for (let i = 0; i < 5; i++) g.add(mesh(new THREE.CircleGeometry(0.014, 6).rotateX(-Math.PI / 2), PRINT, (left ? -1 : 1) * (0.035 - i * 0.017), 0, 0.13 - Math.abs(i - 1) * 0.008));
  return g;
}

function musicBox(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.22, 0.1, 0.16), BOX, 0, 0.05, 0));
  const lid = mesh(new THREE.BoxGeometry(0.22, 0.015, 0.16), BOX, 0, 0.17, -0.08);
  lid.rotation.x = -1.2;
  g.add(lid);
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 10), BRASS, 0, 0.105, 0));
  g.add(mesh(new THREE.ConeGeometry(0.018, 0.06, 6), DANCER, 0, 0.14, 0));
  g.add(mesh(new THREE.SphereGeometry(0.01, 6, 4), DANCER, 0, 0.18, 0));
  return g;
}

function coldFire(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = mesh(new THREE.DodecahedronGeometry(0.13, 0), STONE, Math.cos(a) * 0.5, 0.06, Math.sin(a) * 0.5);
    s.scale.y = 0.7;
    g.add(s);
  }
  for (let i = 0; i < 3; i++) {
    const log = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 6), CHAR, 0, 0.08, 0);
    log.rotation.set(Math.PI / 2, (i / 3) * Math.PI, 0.15);
    g.add(log);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Regie
// ---------------------------------------------------------------------------

export class NightEvents {
  readonly group = new THREE.Group();
  /** Zusatznebel 0..1 für den Himmel (Nebelwand). */
  fog = 0;
  /** Erzählende Zeile (beim ersten Mal je Ereignis). */
  onMessage: ((text: string) => void) | null = null;
  private active: Running | null = null;
  private timer = 90;
  private readonly leftovers: Leftover[] = [];
  private readonly told = new Set<NightEventKind>();
  private fogTarget = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly audio: Audio,
    private readonly heightMap: HeightMap,
    private readonly fear: Fear,
    private readonly rng: () => number = Math.random,
  ) {
    this.group.name = 'NightEvents';
  }

  get current(): NightEventKind | null {
    return this.active?.kind ?? null;
  }

  get leftoverCount(): number {
    return this.leftovers.length;
  }

  /** Erzwingt ein Ereignis (Debug/Tests); ein laufendes wird beendet. */
  start(kind: NightEventKind, f: HorrorFrame): void {
    this.active?.end();
    this.active = this.create(kind, f);
    if (this.active && !this.told.has(kind)) {
      this.told.add(kind);
      this.onMessage?.(MESSAGES[kind]);
    }
  }

  update(f: HorrorFrame): void {
    this.fog += (this.fogTarget - this.fog) * Math.min(1, f.dt * 0.12);
    for (let i = this.leftovers.length - 1; i >= 0; i--) {
      const l = this.leftovers[i];
      l.life -= f.dt;
      l.update?.(f.dt);
      if (l.life > 0 && l.object.position.distanceTo(f.player) < 250) continue;
      this.group.remove(l.object);
      this.leftovers.splice(i, 1);
    }
    const night = f.darkness >= 0.55 && !f.inCave;
    if (this.active) {
      // Bei Tagesanbruch oder in der Höhle endet alles still.
      if (!night || this.active.update(f)) {
        this.active.end();
        this.active = null;
        this.fogTarget = 0;
      }
      return;
    }
    if (!night || f.paused) {
      this.timer = Math.max(this.timer, 40);
      return;
    }
    this.timer -= f.dt * (1 + this.fear.value * 0.5);
    if (this.timer > 0) return;
    this.timer = 150 + this.rng() * 130;
    this.start(NIGHT_EVENTS[Math.floor(this.rng() * NIGHT_EVENTS.length)], f);
  }

  // ---------------------------------------------------------------------------

  /** Bodenpunkt relativ zur Blickrichtung (Winkel, Entfernung) – null über Wasser. */
  private ahead(f: HorrorFrame, angle: number, dist: number): THREE.Vector3 | null {
    const a = Math.atan2(f.look.x, f.look.z) + angle;
    const x = f.player.x + Math.sin(a) * dist;
    const z = f.player.z + Math.cos(a) * dist;
    const y = this.heightMap.heightAt(x, z);
    if (y < this.heightMap.waterLevel + 0.3) return null;
    return new THREE.Vector3(x, y, z);
  }

  /** Wie `ahead`, weicht aber zur Seite aus, wenn dort Wasser ist (bis hin zum Rücken). */
  private spot(f: HorrorFrame, angle: number, dist: number): THREE.Vector3 | null {
    for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
      const at = this.ahead(f, angle + off, dist);
      if (at) return at;
    }
    return null;
  }

  private sound(id: SoundId, at: THREE.Vector3, volume: number): void {
    this.audio.play(id, { volume, position: at });
  }

  /** Liegt zwischen Auge und Punkt (in `lift` m Höhe über `at`) ein Hügel? */
  private hidden(eye: THREE.Vector3, at: THREE.Vector3, lift: number): boolean {
    const ty = at.y + lift;
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      const x = eye.x + (at.x - eye.x) * t;
      const z = eye.z + (at.z - eye.z) * t;
      if (this.heightMap.heightAt(x, z) > eye.y + (ty - eye.y) * t) return true;
    }
    return false;
  }

  private ground(o: THREE.Object3D): void {
    o.position.y = this.heightMap.heightAt(o.position.x, o.position.z);
  }

  private create(kind: NightEventKind, f: HorrorFrame): Running | null {
    switch (kind) {
      case 'procession':
        return this.procession(f);
      case 'fire':
        return this.fire(f);
      case 'whistler':
        return this.whistler(f);
      case 'fogwall':
        return this.fogwall();
      case 'musicbox':
        return this.musicbox(f);
      case 'deer':
        return this.deer(f);
      case 'footprints':
        return this.footprints(f);
      case 'circling':
        return this.circling(f);
    }
  }

  /** Laternenträger ziehen quer zur Blickrichtung durch den Wald, singen leise, verlöschen bei Annäherung. */
  private procession(f: HorrorFrame): Running | null {
    const center = this.spot(f, (this.rng() - 0.5) * 0.4, 38 + this.rng() * 10);
    if (!center) return null;
    const look = Math.atan2(center.x - f.player.x, center.z - f.player.z);
    const dir = this.rng() < 0.5 ? 1 : -1;
    const side = new THREE.Vector3(Math.cos(look) * dir, 0, -Math.sin(look) * dir);
    const n = 5 + Math.floor(this.rng() * 3);
    const walkers: { g: THREE.Group; out: boolean; phase: number }[] = [];
    for (let i = 0; i < n; i++) {
      const g = hooded(true);
      g.position.copy(center).addScaledVector(side, -40 - i * 3.2);
      this.ground(g);
      g.rotation.y = Math.atan2(side.x, side.z);
      this.group.add(g);
      walkers.push({ g, out: false, phase: this.rng() * 6 });
    }
    let chant = 2;
    let time = 0;
    return {
      kind: 'procession',
      update: (fr) => {
        time += fr.dt;
        chant -= fr.dt;
        let alive = 0;
        const mid = this.tmp.set(0, 0, 0);
        for (const w of walkers) {
          if (w.out) continue;
          w.g.position.addScaledVector(side, 1.1 * fr.dt);
          this.ground(w.g);
          w.g.position.y += Math.abs(Math.sin(time * 2.2 + w.phase)) * 0.05;
          const lantern = w.g.getObjectByName('lantern');
          if (lantern) lantern.rotation.z = Math.sin(time * 2.2 + w.phase) * 0.25;
          // Wer zu nahe kommt, sieht nur noch, wie die Laterne erlischt – und der Träger ist fort.
          const bloom = w.g.getObjectByName('bloom');
          if (bloom) bloom.visible = !this.hidden(fr.eye, w.g.position, 1.3);
          if (w.g.position.distanceTo(fr.player) < 17) {
            w.out = true;
            w.g.visible = false;
            this.fear.scare(0.06);
            continue;
          }
          alive++;
          mid.add(w.g.position);
        }
        if (alive && chant <= 0) {
          chant = 7 + this.rng() * 3;
          this.sound('hum', mid.divideScalar(alive).setY(mid.y + 1.5), 0.45);
        }
        return alive === 0 || time > 75;
      },
      end: () => {
        for (const w of walkers) this.group.remove(w.g);
      },
    };
  }

  /** Lagerfeuer in der Ferne mit einer sitzenden Gestalt; aus der Nähe nur noch kalte, rauchende Asche. */
  private fire(f: HorrorFrame): Running | null {
    const at = this.spot(f, (this.rng() - 0.5) * 0.8, 42 + this.rng() * 14);
    if (!at) return null;
    const g = new THREE.Group();
    g.position.copy(at);
    const flames = halo(0xff8a30, 4.5);
    flames.position.y = 0.6;
    g.add(flames);
    const core = halo(0xffd080, 1.6);
    core.position.y = 0.4;
    g.add(core);
    const bloom = halo(0xff6a20, 16, 0.35, false);
    g.add(bloom);
    g.add(pool(0x8a4416, 14));
    // Die Gestalt sitzt zwischen Feuer und Spieler, mit dem Rücken zu ihm – ein Umriss vor den Flammen.
    const sitter = hooded(false);
    sitter.scale.set(1, 0.7, 1);
    const toPlayer = Math.atan2(f.player.x - at.x, f.player.z - at.z) + 0.25;
    sitter.position.set(Math.sin(toPlayer) * 1.1, 0, Math.cos(toPlayer) * 1.1);
    sitter.rotation.y = toPlayer + Math.PI;
    g.add(sitter);
    this.group.add(g);
    let crackle = 0;
    let time = 0;
    return {
      kind: 'fire',
      update: (fr) => {
        time += fr.dt;
        const flick = 0.85 + 0.15 * Math.sin(time * 13) * Math.sin(time * 7.3);
        flames.scale.setScalar(3.2 * flick);
        crackle -= fr.dt;
        const dist = at.distanceTo(fr.player);
        bloom.visible = !this.hidden(fr.eye, at, 0.6);
        if (crackle <= 0 && dist < 90) {
          crackle = 1.2 + this.rng();
          this.sound('crackle', at, 0.5);
        }
        if (dist < 15) {
          // Angekommen: niemand da, das Feuer ist aus – als wäre es seit Tagen kalt. Nur Rauch steigt noch.
          const ash = coldFire();
          ash.position.copy(at);
          this.group.add(ash);
          const puffs: THREE.Sprite[] = [];
          for (let i = 0; i < 6; i++) {
            const p = new THREE.Sprite(SMOKE);
            p.position.set((this.rng() - 0.5) * 0.3, 0.3 + i * 0.4, (this.rng() - 0.5) * 0.3);
            p.scale.setScalar(0.6 + i * 0.25);
            ash.add(p);
            puffs.push(p);
          }
          this.leftovers.push({
            object: ash,
            life: 400,
            update: (dt) => {
              for (const p of puffs) {
                p.position.y += dt * 0.35;
                p.scale.multiplyScalar(1 + dt * 0.05);
                if (p.position.y > 3) {
                  p.position.y = 0.3;
                  p.scale.setScalar(0.6);
                }
              }
            },
          });
          this.fear.scare(0.08);
          return true;
        }
        return time > 150;
      },
      end: () => this.group.remove(g),
    };
  }

  /** Jemand pfeift – fünfmal, jedes Mal näher und aus etwas anderer Richtung. Gesehen wird er nie. */
  private whistler(f: HorrorFrame): Running {
    let dist = 70;
    let wait = 0;
    let count = 0;
    let angle = Math.atan2(-f.look.x, -f.look.z) + (this.rng() - 0.5) * 1.5;
    return {
      kind: 'whistler',
      update: (fr) => {
        wait -= fr.dt;
        if (wait > 0) return false;
        if (count >= 5) return true;
        const at = this.tmp.set(fr.player.x + Math.sin(angle) * dist, fr.player.y + 1.6, fr.player.z + Math.cos(angle) * dist);
        this.sound('pfiff', at, 0.75);
        this.fear.scare(0.04 + count * 0.02);
        count++;
        dist = Math.max(14, dist - 13);
        angle += (this.rng() - 0.5) * 0.8;
        wait = 10 + this.rng() * 5;
        return false;
      },
      end: () => {},
    };
  }

  /** Nebel zieht auf; darin stehen Gestalten, die beim Näherkommen und mit dem Nebel vergehen. */
  private fogwall(): Running {
    this.fogTarget = 1;
    const figures: THREE.Group[] = [];
    let time = 0;
    let spawned = false;
    return {
      kind: 'fogwall',
      update: (fr) => {
        time += fr.dt;
        if (!spawned && time > 12) {
          spawned = true;
          for (let i = 0; i < 4 + Math.floor(this.rng() * 3); i++) {
            const at = this.ahead(fr, (this.rng() - 0.5) * 4, 13 + this.rng() * 12);
            if (!at) continue;
            const g = hooded(false);
            g.position.copy(at);
            g.rotation.y = Math.atan2(fr.player.x - at.x, fr.player.z - at.z);
            this.group.add(g);
            figures.push(g);
          }
        }
        for (const g of figures) if (g.visible && g.position.distanceTo(fr.player) < 8) g.visible = false;
        if (time > 75) this.fogTarget = 0;
        if (time > 75 && this.fog < 0.25) for (const g of figures) g.visible = false;
        return time > 95;
      },
      end: () => {
        for (const g of figures) this.group.remove(g);
        this.fogTarget = 0;
      },
    };
  }

  /** Eine Spieluhr spielt, viermal, jedes Mal näher. Danach liegt sie aufgeklappt am Boden. */
  private musicbox(f: HorrorFrame): Running {
    const angle = Math.atan2(-f.look.x, -f.look.z) + (this.rng() - 0.5) * 1.2;
    const steps = [50, 34, 21, 11];
    let i = 0;
    let wait = 0;
    let last = new THREE.Vector3();
    return {
      kind: 'musicbox',
      update: (fr) => {
        wait -= fr.dt;
        if (wait > 0) return false;
        if (i >= steps.length) {
          // Wo sie zuletzt spielte, liegt sie jetzt.
          const box = musicBox();
          box.position.copy(last);
          this.ground(box);
          box.rotation.y = Math.atan2(fr.player.x - last.x, fr.player.z - last.z);
          this.group.add(box);
          this.leftovers.push({ object: box, life: 600 });
          return true;
        }
        const d = steps[i];
        last = new THREE.Vector3(fr.player.x + Math.sin(angle) * d, fr.player.y + 0.4, fr.player.z + Math.cos(angle) * d);
        this.sound('musicbox', last, 0.45 + i * 0.12);
        this.fear.scare(0.04 + i * 0.03);
        i++;
        wait = 14 + this.rng() * 4;
        return false;
      },
      end: () => {},
    };
  }

  /** Ein Hirsch steht reglos und starrt. Nähert man sich oder sieht eine Weile weg, ist er fort. */
  private deer(f: HorrorFrame): Running | null {
    const at = this.spot(f, (this.rng() - 0.5) * 0.6, 24 + this.rng() * 10);
    if (!at) return null;
    const g = deer();
    g.position.copy(at);
    g.rotation.y = Math.atan2(f.player.x - at.x, f.player.z - at.z);
    this.group.add(g);
    let away = 0;
    let time = 0;
    let seen = false;
    return {
      kind: 'deer',
      update: (fr) => {
        time += fr.dt;
        // Er dreht den Kopf mit, wenn man um ihn herumgeht.
        g.rotation.y = Math.atan2(fr.player.x - at.x, fr.player.z - at.z);
        // Waagerecht vergleichen: am Hang steht er höher oder tiefer, angesehen wird er trotzdem.
        const toDeer = Math.atan2(at.x - fr.player.x, at.z - fr.player.z);
        const view = Math.atan2(fr.look.x, fr.look.z);
        const looking = Math.abs(Math.atan2(Math.sin(toDeer - view), Math.cos(toDeer - view))) < 0.45;
        if (looking) {
          seen = true;
          away = 0;
        } else if (seen) away += fr.dt;
        return at.distanceTo(fr.player) < 14 || away > 2.5 || time > 120;
      },
      end: () => this.group.remove(g),
    };
  }

  /** Abdrücke nackter Füße erscheinen vor dem Spieler, einer nach dem anderen, und führen ins Dunkel. */
  private footprints(f: HorrorFrame): Running {
    const dir = new THREE.Vector3(f.look.x, 0, f.look.z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (this.rng() - 0.5) * 0.6);
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const start = f.player.clone().addScaledVector(dir, 3);
    let n = 0;
    let wait = 0.5;
    return {
      kind: 'footprints',
      update: (fr) => {
        wait -= fr.dt;
        if (wait > 0) return false;
        if (n >= 26) return true;
        wait = 0.62;
        const left = n % 2 === 0;
        const p = footprint(left);
        p.position.copy(start).addScaledVector(dir, n * 0.72).addScaledVector(side, left ? -0.13 : 0.13);
        if (this.heightMap.heightAt(p.position.x, p.position.z) < this.heightMap.waterLevel + 0.1) return true;
        this.ground(p);
        p.position.y += 0.02;
        p.rotation.y = Math.atan2(dir.x, dir.z);
        this.group.add(p);
        this.leftovers.push({ object: p, life: 180 });
        this.sound('stepGrass', p.position, 0.3);
        if (n % 6 === 0) this.fear.scare(0.04);
        n++;
        return false;
      },
      end: () => {},
    };
  }

  /** Etwas umkreist den Spieler im Unterholz (Rascheln wandert um ihn herum, ab und zu ein Ast). */
  private circling(f: HorrorFrame): Running {
    let angle = Math.atan2(-f.look.x, -f.look.z);
    const turn = (this.rng() < 0.5 ? -1 : 1) * 0.45;
    let time = 0;
    let wait = 0;
    return {
      kind: 'circling',
      update: (fr) => {
        time += fr.dt;
        angle += turn * fr.dt;
        wait -= fr.dt;
        if (wait <= 0) {
          wait = 1.1 + this.rng() * 0.6;
          const at = this.tmp.set(fr.player.x + Math.sin(angle) * 13, fr.player.y + 0.6, fr.player.z + Math.cos(angle) * 13);
          this.sound(this.rng() < 0.15 ? 'twig' : 'rustle', at, 0.55);
          this.fear.scare(0.015);
        }
        return time > 26;
      },
      end: () => {},
    };
  }
}
