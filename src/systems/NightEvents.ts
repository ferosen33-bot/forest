import * as THREE from 'three';
import type { Audio, SoundId } from './Audio';
import type { HeightMap } from '../world/HeightMap';
import type { Fear } from './Fear';
import type { HorrorFrame } from './Horror';
import type { ItemId } from '../entities/items/ItemDefs';

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
 *
 * Und weil die Nacht nicht nur Angst macht, sondern auch staunen lässt (Meilenstein 59):
 * - **Nordlicht**: Grüne und violette Schleier wogen über den Himmel; die Furcht legt sich ein wenig.
 * - **Sternschnuppen**: Eine Minute lang ziehen Meteore über den Himmel.
 * - **Lichterpfad**: Kerzen entzünden sich eine nach der anderen und weisen einen Weg – an seinem Ende
 *   liegt eine Gabe. Hinter dem Spieler verlöschen sie.
 * - **Reigen**: Kleine bleiche Gestalten tanzen auf einer Lichtung im Kreis. Kommt man näher, halten
 *   sie inne und drehen sich um – dann sind sie fort, und ein Ring Leuchtpilze bleibt.
 * - **Schaukelstuhl**: Neben einer Laterne schaukelt ein leerer Stuhl. Kommt man hin, kommt er langsam
 *   zur Ruhe – als wäre gerade jemand aufgestanden.
 * - **Motten**: Nur wer Licht trägt: Ein Schwarm bleicher Motten tanzt eine Weile um die Lampe.
 */

export type NightEventKind =
  | 'procession'
  | 'fire'
  | 'whistler'
  | 'fogwall'
  | 'musicbox'
  | 'deer'
  | 'footprints'
  | 'circling'
  | 'aurora'
  | 'meteors'
  | 'lightpath'
  | 'reigen'
  | 'rocking'
  | 'moths';

export const NIGHT_EVENTS: NightEventKind[] = [
  'procession',
  'fire',
  'whistler',
  'fogwall',
  'musicbox',
  'deer',
  'footprints',
  'circling',
  'aurora',
  'meteors',
  'lightpath',
  'reigen',
  'rocking',
  'moths',
];

/** Was am Ende des Lichterpfads liegt. */
const GIFTS: ItemId[] = ['cannedFood', 'medkit', 'moonflower', 'lampOil', 'battery', 'arrow', 'painkillers', 'jerky', 'pistolAmmo'];

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
  aurora: 'Über den Wipfeln wogt grünes Licht. Für einen Moment ist der Wald ganz still – und schön.',
  meteors: 'Sternschnuppen. Eine nach der anderen ziehen sie über den Himmel.',
  lightpath: 'Vor dir entzünden sich Kerzen, eine nach der anderen. Sie zeigen dir einen Weg.',
  reigen: 'Auf einer Lichtung tanzen kleine, bleiche Gestalten im Kreis. Jemand summt.',
  rocking: 'Zwischen den Bäumen schaukelt ein Stuhl. Niemand sitzt darin.',
  moths: 'Motten. Viele. Sie kommen aus dem Dunkel und tanzen um dein Licht.',
};

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

const glowTex: Record<string, THREE.Texture> = {};
/** Weicher Lichthof (für Laternen und Feuer); `soft` fällt ohne Kern sanft ab (Schein, Lichtkreis am Boden). */
export function glowTexture(soft = false): THREE.Texture | null {
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

export function halo(color: number, size: number, opacity = 1, depthTest = true): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(!depthTest), color, opacity, depthTest, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.scale.setScalar(size);
  return s;
}

/** Lichtschein am Boden (flache, additive Scheibe) – macht Laternen und Feuer auch ohne echtes Licht glaubhaft. */
export function pool(color: number, size: number): THREE.Mesh {
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

const WAX = new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.7, emissive: 0x3a2a10, emissiveIntensity: 0.6 });
const FLAME = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc070).multiplyScalar(2.2), fog: false });
const WOOD = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 });
const CLOTH = new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 1 });
// Bleich wie Mondlicht, mit einem Hauch Eigenleuchten – im Dunkeln als helle Umrisse zu sehen.
const PALE = new THREE.MeshStandardMaterial({ color: 0xdcdcd4, roughness: 0.8, emissive: 0x7a8494, emissiveIntensity: 1 });
const MOTH = new THREE.MeshStandardMaterial({ color: 0xd8ccb4, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x4a4238 });

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

/** Kerze auf einem Pflock (über dem Gras sichtbar). */
function candle(): THREE.Group {
  const g = new THREE.Group();
  const stake = 0.55 + Math.random() * 0.25;
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.045, stake, 5), WOOD, 0, stake / 2, 0));
  const h = 0.12 + Math.random() * 0.08;
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.034, h, 7), WAX, 0, stake + h / 2, 0));
  const lit = new THREE.Group();
  lit.name = 'flame';
  lit.add(mesh(new THREE.ConeGeometry(0.014, 0.05, 5), FLAME, 0, stake + h + 0.03, 0));
  const glow = halo(0xffb060, 1.1);
  glow.position.y = stake + h + 0.03;
  lit.add(glow);
  const soft = halo(0xff9040, 3.5, 0.25, false);
  soft.position.y = stake + h;
  lit.add(soft);
  lit.add(pool(0x5a3a14, 3.2));
  g.add(lit);
  return g;
}

/** Steinplatte mit einem verschnürten Bündel – das Ende des Lichterpfads. */
function shrine(): THREE.Group {
  const g = new THREE.Group();
  const slab = mesh(new THREE.BoxGeometry(0.9, 0.18, 0.6), STONE, 0, 0.09, 0);
  slab.rotation.y = 0.2;
  g.add(slab);
  const bundle = mesh(new THREE.SphereGeometry(0.16, 8, 6), CLOTH, 0, 0.3, 0);
  bundle.scale.set(1.2, 0.8, 1);
  g.add(bundle);
  g.add(mesh(new THREE.TorusGeometry(0.15, 0.01, 4, 10), WOOD, 0, 0.3, 0).rotateX(Math.PI / 2) as THREE.Mesh);
  return g;
}

/** Kleine bleiche Gestalt für den Reigen (Kind, ohne Gesicht). */
function dancer(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.ConeGeometry(0.24, 0.85, 8, 1, true), PALE, 0, 0.42, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.22, 7), PALE, 0, 0.9, 0));
  g.add(mesh(new THREE.SphereGeometry(0.13, 8, 6), PALE, 0, 1.12, 0));
  for (const s of [-1, 1]) {
    // Arme seitlich ausgestreckt: Sie halten sich an den Händen.
    const arm = mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.55, 5), PALE, s * 0.3, 0.88, 0);
    arm.rotation.z = s * 1.25;
    g.add(arm);
  }
  return g;
}

/** Schaukelstuhl; der Drehpunkt liegt in der Mitte der Kufen am Boden. */
function rockingChair(): THREE.Group {
  const pivot = new THREE.Group();
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const rocker = mesh(new THREE.TorusGeometry(1.1, 0.025, 4, 16, 1.0), WOOD, s * 0.24, 1.12, 0);
    rocker.rotation.set(0, Math.PI / 2, Math.PI + Math.PI / 2 - 0.5);
    g.add(rocker);
    for (const z of [-0.2, 0.22]) g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 5), WOOD, s * 0.24, 0.24, z));
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 5), WOOD, s * 0.24, 0.72, -0.24).rotateX(-0.2) as THREE.Mesh);
    g.add(mesh(new THREE.BoxGeometry(0.04, 0.03, 0.42), WOOD, s * 0.24, 0.62, 0.02));
  }
  g.add(mesh(new THREE.BoxGeometry(0.52, 0.04, 0.46), WOOD, 0, 0.44, 0));
  for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(0.06, 0.55, 0.02), WOOD, -0.15 + i * 0.1, 0.75, -0.25).rotateX(-0.2) as THREE.Mesh);
  g.add(mesh(new THREE.BoxGeometry(0.52, 0.06, 0.03), WOOD, 0, 1.02, -0.31));
  // Eine Decke hängt über der Lehne.
  const blanket = mesh(new THREE.BoxGeometry(0.4, 0.4, 0.02), CLOTH, 0.04, 0.8, -0.28);
  blanket.rotation.set(-0.2, 0, 0.08);
  g.add(blanket);
  // Gedreht wird um die Mitte des Kufenbogens – so rollt der Stuhl auf den Kufen.
  pivot.position.y = 1.12;
  g.position.y = -1.12;
  pivot.add(g);
  const root = new THREE.Group();
  root.add(pivot);
  pivot.name = 'pivot';
  return root;
}

function moth(): THREE.Group {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    // Flach liegend, das Gelenk am Körper: Schlagen ist dann eine Drehung um die Längsachse.
    const wing = mesh(new THREE.CircleGeometry(0.03, 5).rotateX(-Math.PI / 2).scale(1, 1, 0.7).translate(s * 0.028, 0, 0), MOTH);
    wing.name = s < 0 ? 'l' : 'r';
    g.add(wing);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.04, 4).rotateX(Math.PI / 2), MOTH));
  return g;
}

const AURORA_VERT = /* glsl */ `
uniform float uTime;
uniform float uPhase;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float fold = sin(uv.x * 9.0 + uTime * 0.22 + uPhase) * 14.0 + sin(uv.x * 23.0 - uTime * 0.37) * 5.0;
  p.xz += normalize(p.xz) * fold;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const AURORA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPhase;
uniform float uFade;
uniform vec3 uLow;
uniform vec3 uHigh;
varying vec2 vUv;
void main() {
  // Feine, unregelmäßige Strahlen (zwei Frequenzen, verzerrt) über breiteren, wandernden Bändern.
  float r1 = sin(vUv.x * 130.0 + sin(vUv.x * 17.0 + uTime * 0.6 + uPhase) * 5.0 + uTime * 0.3);
  float r2 = sin(vUv.x * 331.0 - uTime * 0.5 + sin(vUv.x * 41.0 + uPhase) * 3.0);
  float rays = 0.7 + 0.18 * r1 + 0.12 * r2;
  float band = pow(0.5 + 0.5 * sin(vUv.x * 7.3 - uTime * 0.31 + uPhase), 1.5) * (0.6 + 0.4 * sin(vUv.x * 19.0 + uTime * 0.2));
  band = 0.25 + 0.75 * band;
  // Unten hell und scharf, nach oben in langen Strahlen ausblutend.
  float v = smoothstep(0.0, 0.07, vUv.y) * pow(1.0 - vUv.y, 2.0) * (1.0 + (1.0 - vUv.y) * 0.8);
  float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
  vec3 col = mix(uLow, uHigh, smoothstep(0.3, 0.95, vUv.y));
  gl_FragColor = vec4(col * rays * band * v * edge * uFade, 1.0);
}`;

/** Ein Schleier des Nordlichts: Bogen um den Spieler (Radius `r`, von `y0` bis `y1` m über ihm). */
function auroraVeil(look: number, r: number, y0: number, y1: number, phase: number, low: number, high: number): THREE.Mesh {
  const n = 96;
  const span = 2.2;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = look + (t - 0.5) * span;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    // Der Oberrand wellt sich etwas.
    const top = y1 + Math.sin(t * 7 + phase) * 12;
    pos.push(x, y0, z, x, top, z);
    uv.push(t, 0, t, 1);
    if (i < n) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const m = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      vertexShader: AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPhase: { value: phase },
        uFade: { value: 0 },
        uLow: { value: new THREE.Color(low) },
        uHigh: { value: new THREE.Color(high) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  m.frustumCulled = false;
  return m;
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
  /** Meldet ein begonnenes Ereignis (bzw. `lightpath-end`) – fürs Tagebuch. */
  onEvent: ((kind: string) => void) | null = null;
  /** Legt ein echtes Item in die Welt (Gabe am Lichterpfad, Pilzring nach dem Reigen). */
  onItem: ((id: ItemId, at: THREE.Vector3) => void) | null = null;
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
    if (this.active) this.onEvent?.(kind);
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
    // Manche Ereignisse brauchen Platz oder Licht – dann eben ein anderes.
    for (let i = 0; i < 4 && !this.active; i++) this.start(NIGHT_EVENTS[Math.floor(this.rng() * NIGHT_EVENTS.length)], f);
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
      case 'aurora':
        return this.aurora(f);
      case 'meteors':
        return this.meteors(f);
      case 'lightpath':
        return this.lightpath(f);
      case 'reigen':
        return this.reigen(f);
      case 'rocking':
        return this.rocking(f);
      case 'moths':
        return this.moths(f);
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

  /** Nordlicht: zwei Schleier über dem Himmel vor dem Spieler, die langsam auf- und wieder abblenden. */
  private aurora(f: HorrorFrame): Running {
    const look = Math.atan2(f.look.x, f.look.z);
    const g = new THREE.Group();
    const veils = [
      auroraVeil(look, 250, 55, 150, 0, 0x22e070, 0x8a40d0),
      auroraVeil(look + 0.3, 275, 75, 180, 2.1, 0x30c8a0, 0x5a30c0),
    ];
    for (const v of veils) g.add(v);
    g.position.copy(f.player);
    this.group.add(g);
    let time = 0;
    const length = 110;
    return {
      kind: 'aurora',
      update: (fr) => {
        time += fr.dt;
        g.position.copy(fr.player);
        const fade = THREE.MathUtils.smoothstep(time, 0, 14) * (1 - THREE.MathUtils.smoothstep(time, length - 18, length));
        for (const v of veils) {
          const u = (v.material as THREE.ShaderMaterial).uniforms;
          u.uTime.value = time;
          u.uFade.value = fade * 0.85;
        }
        // Wer hinsieht, wird ruhiger.
        this.fear.calm(fr.dt * 0.012 * fade);
        return time > length;
      },
      end: () => {
        this.group.remove(g);
        for (const v of veils) {
          v.geometry.dispose();
          (v.material as THREE.Material).dispose();
        }
      },
    };
  }

  /** Sternschnuppen: eine Minute lang immer wieder ein Meteor über dem Himmel. */
  private meteors(f: HorrorFrame): Running {
    const g = new THREE.Group();
    g.position.copy(f.player);
    this.group.add(g);
    const look = Math.atan2(f.look.x, f.look.z);
    interface Streak {
      line: THREE.Mesh;
      head: THREE.Sprite;
      from: THREE.Vector3;
      dir: THREE.Vector3;
      age: number;
      life: number;
      len: number;
    }
    const streaks: Streak[] = [];
    let wait = 1;
    let time = 0;
    const spawn = () => {
      const a = look + (this.rng() - 0.5) * 1.4;
      const elev = 0.35 + this.rng() * 0.45;
      const r = 240;
      const from = new THREE.Vector3(Math.sin(a) * Math.cos(elev) * r, Math.sin(elev) * r, Math.cos(a) * Math.cos(elev) * r);
      const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(this.rng() < 0.5 ? 1 : -1);
      const dir = side.multiplyScalar(0.8).add(new THREE.Vector3(0, -0.6, 0)).normalize();
      // Ein schmales, zur Kamera gedrehtes Band (Linien wären nur ein Pixel breit), vorn hell, hinten verglimmend.
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 0.92, 1, 1, 0.92, 0, 0, 0, 0, 0, 0], 3));
      geo.setIndex([0, 1, 2, 1, 3, 2]);
      const line = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }),
      );
      line.frustumCulled = false;
      g.add(line);
      const head = halo(0xfff4e0, 7, 1, false);
      g.add(head);
      streaks.push({ line, head, from, dir, age: 0, life: 0.5 + this.rng() * 0.6, len: 30 + this.rng() * 35 });
    };
    return {
      kind: 'meteors',
      update: (fr) => {
        time += fr.dt;
        g.position.copy(fr.player);
        wait -= fr.dt;
        if (wait <= 0 && time < 60) {
          wait = 0.5 + this.rng() * 2.2;
          spawn();
          // Ab und zu zwei auf einmal.
          if (this.rng() < 0.2) spawn();
        }
        for (let i = streaks.length - 1; i >= 0; i--) {
          const s = streaks[i];
          s.age += fr.dt;
          const t = s.age / s.life;
          const head = this.tmp.copy(s.from).addScaledVector(s.dir, s.age * 140);
          s.head.position.copy(head);
          // Breite quer zur Blickrichtung (Kamera relativ zur Gruppe).
          const toCam = new THREE.Vector3().subVectors(fr.eye, g.position).sub(head).normalize();
          const w = new THREE.Vector3().crossVectors(s.dir, toCam).normalize().multiplyScalar(1.1);
          const tail = head.clone().addScaledVector(s.dir, -s.len * Math.min(1, t * 3));
          const p = s.line.geometry.getAttribute('position') as THREE.BufferAttribute;
          p.setXYZ(0, head.x + w.x, head.y + w.y, head.z + w.z);
          p.setXYZ(1, head.x - w.x, head.y - w.y, head.z - w.z);
          p.setXYZ(2, tail.x + w.x * 0.3, tail.y + w.y * 0.3, tail.z + w.z * 0.3);
          p.setXYZ(3, tail.x - w.x * 0.3, tail.y - w.y * 0.3, tail.z - w.z * 0.3);
          p.needsUpdate = true;
          const fade = Math.sin(Math.min(1, t) * Math.PI);
          (s.line.material as THREE.MeshBasicMaterial).opacity = fade;
          s.head.material.opacity = fade * 0.8;
          if (t >= 1) {
            g.remove(s.line, s.head);
            s.head.material.dispose();
            s.line.geometry.dispose();
            (s.line.material as THREE.Material).dispose();
            streaks.splice(i, 1);
          }
        }
        this.fear.calm(fr.dt * 0.004);
        return time > 60 && streaks.length === 0;
      },
      end: () => this.group.remove(g),
    };
  }

  /** Kerzen entzünden sich und weisen einen Weg zu einer Gabe; hinter dem Spieler verlöschen sie. */
  private lightpath(f: HorrorFrame): Running | null {
    const start = this.spot(f, (this.rng() - 0.5) * 0.4, 7);
    if (!start) return null;
    const dir = new THREE.Vector3(start.x - f.player.x, 0, start.z - f.player.z).normalize();
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const points: THREE.Vector3[] = [];
    let bend = 0;
    for (let i = 0; i < 12; i++) {
      bend += (this.rng() - 0.5) * 0.35;
      const p = start.clone().addScaledVector(dir, i * 5.5).addScaledVector(side, Math.sin(bend) * 4 + (i % 2 ? 0.7 : -0.7));
      p.y = this.heightMap.heightAt(p.x, p.z);
      if (p.y < this.heightMap.waterLevel + 0.3) break;
      points.push(p);
    }
    if (points.length < 5) return null;
    const end = points[points.length - 1].clone().addScaledVector(dir, 3);
    end.y = this.heightMap.heightAt(end.x, end.z);
    const candles: THREE.Group[] = [];
    let wait = 0.5;
    let time = 0;
    let reached = false;
    let altar: THREE.Group | null = null;
    let doused = 0;
    let kept = false;
    const douse = (c: THREE.Group) => {
      const flame = c.getObjectByName('flame');
      if (flame?.visible) {
        flame.visible = false;
        this.sound('ignite', c.position, 0.08);
      }
    };
    return {
      kind: 'lightpath',
      update: (fr) => {
        time += fr.dt;
        wait -= fr.dt;
        if (wait <= 0 && candles.length < points.length) {
          wait = 1.3;
          const c = candle();
          c.position.copy(points[candles.length]);
          this.group.add(c);
          candles.push(c);
          if (candles.length === points.length) {
            altar = shrine();
            altar.position.copy(end);
            altar.rotation.y = Math.atan2(dir.x, dir.z);
            this.group.add(altar);
            for (const s of [-1, 1]) {
              const c2 = candle();
              c2.position.copy(end).addScaledVector(side, s * 0.7);
              this.ground(c2);
              this.group.add(c2);
              candles.push(c2);
            }
            this.sound('chime', end, 0.25);
          }
        }
        // Wer vorbeigeht, hinter dem verlöschen die Kerzen.
        for (const c of candles) if (c.position.distanceTo(fr.player) < 2.2) douse(c);
        if (!reached && altar && end.distanceTo(fr.player) < 2.6) {
          reached = true;
          const n = 2 + Math.floor(this.rng() * 2);
          this.onEvent?.('lightpath-end');
          for (let i = 0; i < n; i++) this.onItem?.(GIFTS[Math.floor(this.rng() * GIFTS.length)], end.clone().setY(end.y + 0.5));
          this.fear.scare(0.05);
        }
        // Am Ende (oder wenn niemand kommt) gehen alle aus – eine nach der anderen, vom Anfang her.
        if (reached || time > 150) {
          doused += fr.dt * 3;
          for (let i = 0; i < Math.min(candles.length, Math.floor(doused)); i++) douse(candles[i]);
          if (doused > candles.length + 1) {
            if (altar) this.leftovers.push({ object: altar, life: 600 });
            kept = true;
            return true;
          }
        }
        return false;
      },
      end: () => {
        for (const c of candles) this.group.remove(c);
        if (altar && !kept) this.group.remove(altar);
      },
    };
  }

  /** Reigen: bleiche Kinder tanzen im Kreis. Nähert man sich, halten sie inne, sehen her – und sind fort. */
  private reigen(f: HorrorFrame): Running | null {
    const center = this.spot(f, (this.rng() - 0.5) * 0.5, 26 + this.rng() * 6);
    if (!center) return null;
    const ring = new THREE.Group();
    ring.position.copy(center);
    // Fahler Schein auf der Lichtung, als stünde der Mond nur über ihr.
    ring.add(pool(0x5a6680, 12));
    const moon = halo(0x8a9ab8, 9, 0.22, false);
    moon.position.y = 1;
    ring.add(moon);
    const n = 7;
    const kids: THREE.Group[] = [];
    for (let i = 0; i < n; i++) {
      const k = dancer();
      ring.add(k);
      kids.push(k);
    }
    this.group.add(ring);
    let spin = 0;
    let time = 0;
    let hum = 1;
    let stopped = -1;
    const place = (fr: HorrorFrame) => {
      for (let i = 0; i < n; i++) {
        const a = spin + (i / n) * Math.PI * 2;
        const k = kids[i];
        k.position.set(Math.sin(a) * 2.4, 0, Math.cos(a) * 2.4);
        k.position.y = this.heightMap.heightAt(center.x + k.position.x, center.z + k.position.z) - center.y;
        if (stopped < 0) {
          k.position.y += Math.abs(Math.sin(time * 3.2 + i)) * 0.12;
          // Blick nach außen, im Kreis gehend.
          k.rotation.y = a + Math.PI / 2;
        } else {
          // Alle drehen sich langsam zum Spieler um.
          const want = Math.atan2(fr.player.x - center.x - k.position.x, fr.player.z - center.z - k.position.z);
          const d = Math.atan2(Math.sin(want - k.rotation.y), Math.cos(want - k.rotation.y));
          k.rotation.y += d * Math.min(1, fr.dt * 1.8);
        }
      }
    };
    return {
      kind: 'reigen',
      update: (fr) => {
        time += fr.dt;
        if (stopped < 0) {
          spin += fr.dt * 0.45;
          hum -= fr.dt;
          if (hum <= 0) {
            hum = 7.5;
            this.sound('hum', center.clone().setY(center.y + 1), 0.5);
          }
          if (center.distanceTo(fr.player) < 17 || time > 120) {
            stopped = 0;
            this.fear.scare(0.08);
          }
        } else stopped += fr.dt;
        place(fr);
        if (stopped > 3.2) {
          // Fort. Wo sie tanzten, wachsen Leuchtpilze.
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + spin;
            const at = new THREE.Vector3(center.x + Math.sin(a) * 2.4, 0, center.z + Math.cos(a) * 2.4);
            at.y = this.heightMap.heightAt(at.x, at.z) + 0.3;
            this.onItem?.('mushroom', at);
          }
          return true;
        }
        return false;
      },
      end: () => this.group.remove(ring),
    };
  }

  /** Ein leerer Schaukelstuhl neben einer Laterne schaukelt – bis man herankommt. */
  private rocking(f: HorrorFrame): Running | null {
    const at = this.spot(f, (this.rng() - 0.5) * 0.6, 16 + this.rng() * 6);
    if (!at) return null;
    const g = new THREE.Group();
    g.position.copy(at);
    g.rotation.y = Math.atan2(f.player.x - at.x, f.player.z - at.z) + (this.rng() - 0.5) * 0.8;
    const seat = rockingChair();
    g.add(seat);
    const chair = seat.getObjectByName('pivot')!;
    const lamp = new THREE.Group();
    lamp.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.2, 6), LAMP, 0, 0.1, 0));
    lamp.add(mesh(new THREE.ConeGeometry(0.09, 0.08, 6), WOOD, 0, 0.24, 0));
    const lampGlow = halo(0xffa050, 2.6);
    lampGlow.position.y = 0.12;
    lamp.add(lampGlow);
    const lampBloom = halo(0xff8030, 7, 0.3, false);
    lampBloom.position.y = 0.12;
    lamp.add(lampBloom);
    lamp.add(pool(0x8a4a18, 8));
    lamp.position.set(0.75, 0, 0.3);
    g.add(lamp);
    this.group.add(g);
    let time = 0;
    let swing = 1;
    let last = 0;
    let stilling = false;
    return {
      kind: 'rocking',
      update: (fr) => {
        time += fr.dt;
        if (!stilling && (at.distanceTo(fr.player) < 7 || time > 120)) {
          stilling = true;
          this.fear.scare(0.05);
        }
        if (stilling) swing = Math.max(0, swing - fr.dt * 0.35);
        const s = Math.sin(time * 1.7);
        chair.rotation.x = s * 0.17 * swing;
        // Knarzen an jedem Umkehrpunkt.
        if (swing > 0.15 && Math.sign(s) !== Math.sign(last) && Math.abs(s - last) < 1) this.sound('creak', at.clone().setY(at.y + 0.5), 0.3 * swing);
        last = s;
        if (stilling && swing <= 0) {
          this.leftovers.push({ object: g, life: 300 });
          return true;
        }
        return false;
      },
      end: () => {
        if (!stilling || swing > 0) this.group.remove(g);
      },
    };
  }

  /** Motten umschwärmen das Licht in der Hand (nur, wenn man eines trägt). */
  private moths(f: HorrorFrame): Running | null {
    if (!f.lit) return null;
    interface Moth {
      g: THREE.Group;
      r: number;
      phase: number;
      speed: number;
      tilt: number;
    }
    const swarm: Moth[] = [];
    const g = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const m = moth();
      g.add(m);
      swarm.push({ g: m, r: 0.3 + this.rng() * 0.9, phase: this.rng() * 6.28, speed: (1.5 + this.rng() * 2.5) * (this.rng() < 0.5 ? -1 : 1), tilt: (this.rng() - 0.5) * 1.2 });
    }
    this.group.add(g);
    const light = new THREE.Vector3();
    const right = new THREE.Vector3();
    let time = 0;
    let flutter = 0;
    const length = 35;
    return {
      kind: 'moths',
      update: (fr) => {
        time += fr.dt;
        right.set(fr.look.z, 0, -fr.look.x).normalize();
        // Die Lampe sitzt rechts vor dem Gesicht.
        light.copy(fr.eye).addScaledVector(fr.look, 0.9).addScaledVector(right, -0.3).y -= 0.15;
        const come = THREE.MathUtils.smoothstep(time, 0, 5);
        const go = THREE.MathUtils.smoothstep(time, length - 6, length);
        const spread = 1 + (1 - come) * 6 + go * 8;
        for (const m of swarm) {
          const a = m.phase + time * m.speed;
          m.g.position.set(
            light.x + Math.sin(a) * m.r * spread,
            light.y + Math.sin(a * 1.7 + m.tilt) * 0.35 * spread + m.tilt * 0.2,
            light.z + Math.cos(a) * m.r * spread,
          );
          m.g.rotation.y = a + (m.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
          const beat = Math.sin(time * 32 + m.phase);
          for (const w of m.g.children) if (w.name) w.rotation.z = (w.name === 'l' ? 1 : -1) * beat * 0.9;
        }
        flutter -= fr.dt;
        if (flutter <= 0 && !go) {
          flutter = 2 + this.rng() * 2;
          this.sound('flap', light, 0.08);
        }
        // Wer das Licht löscht, verliert sie.
        return time > length || (!fr.lit && time > 2);
      },
      end: () => this.group.remove(g),
    };
  }
}

