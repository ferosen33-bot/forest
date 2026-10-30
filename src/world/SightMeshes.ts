import * as THREE from 'three';
import { texturize } from './SurfaceTextures';
import { injectSeason } from './SeasonShader';
import type { PlaceKind } from './Places';
import { M, type Builder } from './PlaceMeshes';
import { Batch, boulder, glow, hullGeometry, particles, plaque, softDisc, W, waterMaterial } from './WonderMeshes';

/**
 * Noch mehr Orte zum Staunen (Meilenstein 54):
 * - **Rummelplatz Glückauf**: verlassener Jahrmarkt im Wald – Riesenrad und Karussell drehen sich
 *   noch, Buden mit Markisen, Lichterketten, der Wagen der Wahrsagerin mit leuchtender Kugel.
 * - **Sternwarte Krähenstein**: weiße Kuppel mit offenem Spalt auf einer Kuppe, drinnen rotes
 *   Nachtlicht und ein Teleskop, das nachts alle Orte der Insel auf die Karte bringt.
 * - **Irrlichtmoor**: ein Bohlenweg über schwarzes Wasser, tote Birken, Schilf, ein Bildstock mit
 *   Kerzen und Irrlichter, die vor einem zurückweichen.
 * - **Gut Rosenthal**: verwilderter Schlossgarten mit Brunnen, Statuen, Rosen, Laubengang, einem
 *   Glashaus voller Dschungel und der ausgebrannten Fassade des Herrenhauses; nachts Glühwürmchen.
 * - **Bucht der tausend Lichter**: Sandstrand mit Strandbude, Feuerstelle und Felsnadeln im Meer;
 *   nachts leuchtet die Brandung blau.
 * Lokale Koordinaten des Ortes wie in `WonderMeshes` (+Z = Blickrichtung).
 */

type V3 = [number, number, number];

export const SIGHTS = new Set<PlaceKind>(['fair', 'observatory', 'bog', 'manor', 'glowbay']);

// Eigene Materialien (WonderMeshes ist beim Laden dieser Datei womöglich noch nicht fertig).
const std = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const seasonal = (m: THREE.MeshStandardMaterial, bias = 0) => {
  m.onBeforeCompile = (shader) => injectSeason(shader, { snowBias: bias });
  return m;
};

const S = {
  paintRed: std(0x9a2e26, { roughness: 0.7 }),
  paintCream: std(0xe2d6b8, { roughness: 0.7 }),
  paintBlue: std(0x2e5578, { roughness: 0.7 }),
  paintGreen: std(0x356a4c, { roughness: 0.7 }),
  paintYellow: std(0xc89a2c, { roughness: 0.7 }),
  paintPurple: std(0x4a2a5e, { roughness: 0.7 }),
  gold: std(0xb8902e, { metalness: 0.7, roughness: 0.35 }),
  iron: std(0x2a3530, { metalness: 0.5, roughness: 0.55 }),
  ironRust: std(0x5a3a28, { metalness: 0.3, roughness: 0.8 }),
  wire: std(0x1a1a1a, { roughness: 0.9 }),
  canvasRed: std(0xa0302a, { roughness: 0.9, side: THREE.DoubleSide }),
  canvasCream: std(0xe6dcc2, { roughness: 0.9, side: THREE.DoubleSide }),
  dome: std(0xc9ccc8, { metalness: 0.35, roughness: 0.45, side: THREE.DoubleSide }),
  plaster: texturize(seasonal(std(0xd2cbbc)), 'plaster', 0.5),
  brick: texturize(std(0x8a5a44), 'plaster', 0.35),
  gravel: texturize(std(0xb7ab92, { roughness: 1 }), 'sand', 0.6),
  hedge: texturize(seasonal(std(0x34522a, { roughness: 1 }), 0.3), 'forestFloor', 0.45),
  leaf: seasonal(std(0x2c4a22, { roughness: 0.9 }), 0.3),
  palm: std(0x3e6a2a, { roughness: 0.8, side: THREE.DoubleSide }),
  roseRed: std(0x8e1222, { roughness: 0.6 }),
  roseWhite: std(0xece6dc, { roughness: 0.6 }),
  marble: texturize(seasonal(std(0xc8c4b8, { roughness: 0.7 }), 0.2), 'mossyRock', 0.35),
  pot: std(0xa0583a, { roughness: 0.9 }),
  birch: texturize(std(0xdcd8cc, { roughness: 1 }), 'bark', 0.2),
  birchMark: std(0x1e1c1a, { roughness: 1 }),
  reed: seasonal(std(0x8a8a50, { roughness: 1 }), 0.4),
  cattail: std(0x4a3420, { roughness: 1 }),
  bogWater: new THREE.MeshStandardMaterial({ color: 0x0b0f0b, roughness: 0.06, metalness: 0.35 }),
  stillWater: new THREE.MeshStandardMaterial({ color: 0x1c2c28, roughness: 0.05, metalness: 0.4 }),
  driftwood: texturize(std(0x9a948a, { roughness: 1 }), 'bark', 0.35),
  sandStone: texturize(std(0x8c8270, { roughness: 0.95 }), 'rockFace', 0.5),
  shell: std(0xe8dcd0, { roughness: 0.5 }),
  starfish: std(0xc8642a, { roughness: 0.8 }),
  board: std(0x2a8a8a, { roughness: 0.4 }),
  paper: std(0xe6dfcc, { side: THREE.DoubleSide }),
  book: [0x6a2a24, 0x2a3a5a, 0x3a4a2a, 0x5a4a2a, 0x2a2a2a].map((c) => std(c, { roughness: 0.8 })),
  teddy: [0xd89aa8, 0x8ab0d0, 0xe0c870, 0xa88a6a].map((c) => std(c, { roughness: 1 })),
  balloon: [0xb8202a, 0x2a5ab8, 0xd8b020].map((c) => std(c, { roughness: 0.35 })),
};

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

/** Drehung, die die Y-Achse auf die Richtung a → c legt (für Streben, Stangen, Seile). */
function along(a: V3, c: V3): { mid: V3; len: number; rot: V3 } {
  const d = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const len = d.length();
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  return { mid: [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2], len, rot: [e.x, e.y, e.z] };
}

/** Strebe als einzelnes Mesh (optional mit Kollision). */
function strut(b: Builder, mat: THREE.Material, a: V3, c: V3, r: number, collide = false): void {
  const s = along(a, c);
  b.cyl(mat, r, r, s.len, s.mid, s.rot, 6, collide);
}

/** Strebe in einen Batch. */
function strutInto(batch: Batch, a: V3, c: V3, r: number, segs = 5): void {
  const s = along(a, c);
  batch.add(new THREE.CylinderGeometry(r, r, s.len, segs, 1, true), s.mid, s.rot);
}

/** Drehung erst um Y (Richtung), dann um die eigene X-Achse (Neigung) – als Euler-XYZ für den Builder. */
function yawPitch(yaw: number, pitch: number, roll = 0): V3 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

/** Mesh direkt in eine Gruppe (drehende Teile), ohne Builder. */
function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3, rot: V3 = [0, 0, 0], shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Glühbirnen, die nachts leuchten (zwei Farben im Wechsel) – gemeinsam für einen Ort. */
class Bulbs {
  readonly a = new Batch();
  readonly b = new Batch();
  private n = 0;
  private readonly geo = new THREE.SphereGeometry(0.1, 6, 4);
  add(pos: V3): void {
    (this.n++ % 2 ? this.b : this.a).add(this.geo, pos);
  }
  build(b: Builder, colors: [number, number], parent?: THREE.Object3D): void {
    const ma = glow(b, colors[0], colors[0], 0.25, 6, 1.7);
    const mb = glow(b, colors[1], colors[1], 0.25, 6, 2.3);
    for (const [batch, mat] of [[this.a, ma], [this.b, mb]] as [Batch, THREE.MeshStandardMaterial][]) {
      const mesh = batch.build(b, mat);
      if (mesh && parent) parent.add(mesh);
    }
  }
}

/** Durchhängende Lichterkette von a nach c: Draht plus Birnen. */
function garland(wires: Batch, bulbs: Bulbs, a: V3, c: V3, sag: number, spacing = 0.55): void {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const n = Math.max(2, Math.round(len / spacing));
  let prev: V3 = a;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const p: V3 = [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u - Math.sin(u * Math.PI) * sag, a[2] + (c[2] - a[2]) * u];
    strutInto(wires, prev, p, 0.012, 3);
    if (i < n) bulbs.add([p[0], p[1] - 0.08, p[2]]);
    prev = p;
  }
}

/** Schild an einen Ort hängen (Plakette aus WonderMeshes), skaliert und gedreht. */
function sign(b: Builder, text: string[], bg: string, fg: string, pos: V3, yaw: number, scale = 1): void {
  const m = plaque(text, bg, fg);
  if (!m) return;
  m.position.copy(b.point(pos));
  m.rotation.set(0, yaw, 0);
  m.scale.setScalar(scale);
  b.group.add(m);
}

/** Leuchtende Kugel mit weichem Hof (Kristallkugel, Irrlicht), Hof nachts heller. */
function orb(b: Builder, color: number, radius: number, halo: number, day: number, night: number, pulse: number): THREE.Group {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), glow(b, color, color, day, night, pulse));
  g.add(core);
  const tex = softDisc();
  if (tex) {
    const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.2 });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(halo);
    g.add(sprite);
    // Deckkraft über die Tag-/Nacht-Überblendung steuern.
    b.model.fades.push({
      uniform: {
        get value() {
          return mat.opacity;
        },
        set value(v: number) {
          mat.opacity = v;
        },
      },
      day: 0.12,
      night: 0.85,
    });
  }
  return g;
}

/** Steinfigur (Gutsgarten, Brunnen): Gewand, Oberkörper, Kopf, Arme; optional Flügel, Krug, ohne Kopf. */
function statue(batch: Batch, base: THREE.Matrix4, o: { wings?: boolean; jug?: boolean; headless?: boolean } = {}): void {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const part = (geo: THREE.BufferGeometry, pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) => {
    m.compose(new THREE.Vector3(...pos), q.setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    batch.addMatrix(geo, m.premultiply(base));
  };
  part(new THREE.CylinderGeometry(0.17, 0.42, 1.5, 12), [0, 0.75, 0]);
  part(new THREE.CylinderGeometry(0.15, 0.19, 0.55, 10), [0, 1.75, 0]);
  if (!o.headless) {
    part(new THREE.SphereGeometry(0.14, 12, 10), [0, 2.16, 0.02]);
    part(new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), [0, 2.2, -0.02], [-0.3, 0, 0], [1, 1.25, 1]);
  }
  // Arme: einer hängt, einer hält (den Krug oder die Hand vor der Brust)
  part(new THREE.CylinderGeometry(0.05, 0.045, 0.62), [-0.2, 1.68, 0.04], [0, 0, -0.18]);
  part(new THREE.CylinderGeometry(0.05, 0.045, 0.55), [0.22, 1.78, 0.16], [-1.1, 0, 0.35]);
  if (o.jug) {
    part(new THREE.SphereGeometry(0.15, 10, 8), [0.3, 1.86, 0.4], [0, 0, 0], [1, 1.2, 1]);
    part(new THREE.CylinderGeometry(0.05, 0.08, 0.14, 8), [0.38, 1.98, 0.5], [0.9, 0, -0.4]);
  }
  if (o.wings) {
    for (const s of [-1, 1]) {
      part(new THREE.BoxGeometry(0.05, 0.95, 0.42), [s * 0.28, 2.05, -0.22], [0.35, s * 0.5, s * 0.25]);
      part(new THREE.BoxGeometry(0.04, 0.6, 0.3), [s * 0.42, 1.65, -0.3], [0.3, s * 0.6, s * 0.15]);
    }
  }
}

// ---------------------------------------------------------------------------
// Rummelplatz Glückauf
// ---------------------------------------------------------------------------

function buildFair(b: Builder, rng: () => number): void {
  const g = b.ground;
  const wires = new Batch();
  const bulbs = new Bulbs();
  const trimBulbs = new Bulbs();

  // --- Riesenrad: Achse längs Z (man sieht es vom Eingang aus von vorn) ---
  const wx = -8;
  const wz = -9;
  const R = 8.5;
  const H = 11.6;
  const gw = g(wx, wz);
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) strut(b, S.iron, [wx + sx * 5.2, gw, wz + sz * 2.4], [wx, gw + H, wz + sz * 1.25], 0.17, true);
    strut(b, S.iron, [wx - 3.2, gw + 4.5, wz + sz * 2], [wx + 3.2, gw + 4.5, wz + sz * 2], 0.08);
  }
  b.cyl(S.iron, 0.28, 0.28, 3, [wx, gw + H, wz], [Math.PI / 2, 0, 0], 12, false);
  // Einstiegspodest mit Stufen
  b.box(W.woodDark, [3.6, 0.5, 3.2], [wx, gw + 0.25, wz]);
  for (let i = 0; i < 2; i++) b.box(W.woodDark, [1.6, 0.17, 0.4], [wx, gw + 0.085 + i * 0.17, wz + 1.8 + (1 - i) * 0.4]);
  // Drehender Teil: Gruppe am Nabenpunkt, deren lokale Y-Achse die Achse ist.
  const axle = new THREE.Group();
  axle.position.copy(b.point([wx, gw + H, wz]));
  axle.rotation.x = Math.PI / 2;
  b.group.add(axle);
  const rotor = new THREE.Group();
  axle.add(rotor);
  b.model.spinners.push({ object: rotor, speed: 0.06 });
  const frame = new Batch();
  const rimBulbs = new Bulbs();
  const SP = 16;
  for (const side of [-0.95, 0.95]) {
    const ring = new THREE.TorusGeometry(R, 0.09, 6, 64).rotateX(Math.PI / 2);
    frame.add(ring, [0, side, 0]);
    frame.add(new THREE.TorusGeometry(R * 0.35, 0.07, 6, 32).rotateX(Math.PI / 2), [0, side, 0]);
    for (let i = 0; i < SP; i++) {
      const a = (i / SP) * Math.PI * 2;
      strutInto(frame, [0, side * 0.6, 0], [Math.cos(a) * R, side, Math.sin(a) * R], 0.05);
      // Diagonalen zwischen den Speichen
      const a2 = ((i + 1) / SP) * Math.PI * 2;
      strutInto(frame, [Math.cos(a) * R * 0.35, side, Math.sin(a) * R * 0.35], [Math.cos(a2) * R, side, Math.sin(a2) * R], 0.03);
    }
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      rimBulbs.add([Math.cos(a) * (R + 0.14), side * 1.04, Math.sin(a) * (R + 0.14)]);
    }
    for (let i = 0; i < SP; i += 2) {
      const a = (i / SP) * Math.PI * 2;
      for (let k = 1; k < 5; k++) rimBulbs.add([Math.cos(a) * R * k * 0.2, side * 1.05, Math.sin(a) * R * k * 0.2]);
    }
  }
  frame.add(new THREE.CylinderGeometry(0.55, 0.55, 2.3, 12), [0, 0, 0]);
  const frameMesh = frame.build(b, S.paintCream, true);
  if (frameMesh) rotor.add(frameMesh);
  rimBulbs.build(b, [0xfff0c0, 0xff6a5a], rotor);
  // Gondeln: hängen an Querstangen und drehen sich gegen das Rad, damit sie aufrecht bleiben.
  const gondolaMats = [S.paintRed, S.paintBlue, S.paintYellow, S.paintGreen];
  const NG = 12;
  for (let i = 0; i < NG; i++) {
    const a = (i / NG) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
    rotor.add(pivot);
    put(pivot, new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6), S.iron, [0, 0, 0], [0, 0, 0], false);
    b.model.spinners.push({ object: pivot, speed: -0.06 });
    const cab = new THREE.Group();
    cab.rotation.x = -Math.PI / 2;
    pivot.add(cab);
    const mat = gondolaMats[i % gondolaMats.length];
    put(cab, new THREE.BoxGeometry(0.08, 0.6, 0.08), S.iron, [0, -0.3, 0]);
    put(cab, new THREE.BoxGeometry(1.5, 0.75, 1.15), mat, [0, -1.75, 0]);
    put(cab, new THREE.BoxGeometry(1.56, 0.08, 1.2), S.gold, [0, -1.38, 0], [0, 0, 0], false);
    put(cab, new THREE.ConeGeometry(1.0, 0.42, 4), mat, [0, -0.6, 0], [0, Math.PI / 4, 0]);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(cab, new THREE.CylinderGeometry(0.025, 0.025, 0.65), S.iron, [sx * 0.68, -1.05, sz * 0.5], [0, 0, 0], false);
  }
  b.light([wx, gw + H, wz + 1.6], 0xffc890, 5, 18, 'lamp');
  b.model.sounds.push({ position: b.point([wx, gw + H, wz]), sound: 'creak', every: [5, 12], volume: 0.6 });
  // Kassenhäuschen am Rad
  b.box(S.paintRed, [1.4, 2.2, 1.2], [wx + 4.4, g(wx + 4.4, wz + 3) + 1.1, wz + 3]);
  b.add(new THREE.ConeGeometry(1.1, 0.7, 4), S.paintCream, [wx + 4.4, g(wx + 4.4, wz + 3) + 2.55, wz + 3], [0, Math.PI / 4, 0]);
  b.box(M.dark, [0.8, 0.5, 0.05], [wx + 4.4, g(wx + 4.4, wz + 3) + 1.4, wz + 3.61], [0, 0, 0], false);
  sign(b, ['Riesenrad', '1 Fahrt 50 Pf.'], '#e6dcc2', '#7a1e1a', [wx + 4.4, g(wx + 4.4, wz + 3) + 2.0, wz + 3.63], 0, 0.6);

  // --- Karussell ---
  const cx = 9;
  const cz = -4;
  const gc = g(cx, cz);
  b.cyl(W.woodDark, 5.3, 5.4, 0.36, [cx, gc + 0.18, cz], [0, 0, 0], 32);
  b.cyl(S.gold, 0.35, 0.35, 4.2, [cx, gc + 2.3, cz], [0, 0, 0], 12);
  const top = new THREE.Group();
  top.position.copy(b.point([cx, gc + 0.36, cz]));
  b.group.add(top);
  b.model.spinners.push({ object: top, speed: 0.17 });
  put(top, new THREE.CylinderGeometry(5.0, 5.0, 0.06, 32), W.wood, [0, 0.03, 0]);
  put(top, new THREE.CylinderGeometry(0.75, 0.75, 3.3, 16), S.paintRed, [0, 1.95, 0]);
  // Spiegel an der Mittelsäule
  const mirrors = glow(b, 0x8898a0, 0xfff0d0, 0.05, 0.9, 1.3, { metalness: 0.9, roughness: 0.1 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    put(top, new THREE.BoxGeometry(0.42, 0.9, 0.03), mirrors, [Math.sin(a) * 0.78, 2.1, Math.cos(a) * 0.78], [0, a, 0], false);
  }
  // Dach in Streifen, darunter eine gezackte Blende
  const N = 16;
  for (let i = 0; i < N; i++) {
    const mat = i % 2 ? S.canvasRed : S.canvasCream;
    put(top, new THREE.ConeGeometry(5.7, 1.9, 2, 1, true, (i / N) * Math.PI * 2, (Math.PI * 2) / N), mat, [0, 4.55, 0]);
    put(top, new THREE.CylinderGeometry(5.72, 5.72, 0.6, 2, 1, true, (i / N) * Math.PI * 2, (Math.PI * 2) / N), mat, [0, 3.35, 0], [0, 0, 0], false);
  }
  put(top, new THREE.SphereGeometry(0.22, 10, 8), S.gold, [0, 5.6, 0]);
  put(top, new THREE.ConeGeometry(0.08, 0.6, 6), S.gold, [0, 6.0, 0]);
  const carBulbs = new Bulbs();
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    carBulbs.add([Math.cos(a) * 5.78, 3.05, Math.sin(a) * 5.78]);
  }
  carBulbs.build(b, [0xfff2c8, 0xffb060], top);
  // Pferde an goldenen Stangen, im Galopp, auf verschiedenen Höhen
  const body = new Batch();
  const mane = new Batch();
  const poles = new Batch();
  const hm = new THREE.Matrix4();
  const pm = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 ? 3.9 : 3.0;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    poles.add(new THREE.CylinderGeometry(0.045, 0.045, 3.4, 6), [x, 1.7, z]);
    const y = 1.0 + (i % 3) * 0.25;
    hm.compose(new THREE.Vector3(x, y, z), q.setFromEuler(new THREE.Euler(0, -a, 0)), new THREE.Vector3(1, 1, 1));
    const part = (batch: Batch, geo: THREE.BufferGeometry, pos: V3, rot: V3 = [0, 0, 0]) => {
      pm.compose(new THREE.Vector3(...pos), q.setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1));
      batch.addMatrix(geo, pm.premultiply(hm));
    };
    part(body, new THREE.CapsuleGeometry(0.2, 0.62, 4, 10), [0, 0, 0], [Math.PI / 2, 0, 0]);
    part(body, new THREE.CylinderGeometry(0.08, 0.12, 0.55, 8), [0, 0.3, 0.38], [0.55, 0, 0]);
    part(body, new THREE.CapsuleGeometry(0.075, 0.28, 3, 8), [0, 0.54, 0.6], [1.9, 0, 0]);
    for (const s of [-1, 1]) part(body, new THREE.ConeGeometry(0.03, 0.1, 5), [s * 0.05, 0.66, 0.5], [-0.2, 0, s * 0.2]);
    for (const [lx, lz, rx] of [[-0.09, 0.3, -0.55], [0.09, 0.26, -0.3], [-0.09, -0.3, 0.3], [0.09, -0.32, 0.45]] as V3[]) part(body, new THREE.CylinderGeometry(0.035, 0.03, 0.5, 6), [lx, -0.36, lz], [rx, 0, 0]);
    part(mane, new THREE.BoxGeometry(0.05, 0.45, 0.1), [0, 0.38, 0.3], [0.55, 0, 0]);
    part(mane, new THREE.BoxGeometry(0.3, 0.06, 0.38), [0, 0.2, -0.05]);
    part(mane, new THREE.ConeGeometry(0.07, 0.5, 6), [0, 0.02, -0.55], [-2.3, 0, 0]);
  }
  for (const [batch, mat] of [[body, S.paintCream], [mane, S.paintRed], [poles, S.gold]] as [Batch, THREE.Material][]) {
    const mesh = batch.build(b, mat, true);
    if (mesh) top.add(mesh);
  }
  b.light([cx, gc + 2.8, cz], 0xffb070, 6, 13, 'flicker');
  b.model.sounds.push({ position: b.point([cx, gc + 2, cz]), sound: 'musicbox', every: [28, 55], volume: 0.75, when: 'night' });

  // --- Budengasse vom Tor zur Mitte ---
  const booths: { x: number; z: number; yaw: number; color: THREE.Material; text: string[]; kind: 'shoot' | 'lots' | 'candy' | 'ducks' }[] = [
    { x: -6.5, z: 7, yaw: Math.PI / 2, color: S.paintBlue, text: ['Schießbude', 'Jeder Schuss ein Treffer'], kind: 'shoot' },
    { x: 6.5, z: 7, yaw: -Math.PI / 2, color: S.paintGreen, text: ['Lose', 'Jedes Los gewinnt!'], kind: 'lots' },
    { x: -6.5, z: 13, yaw: Math.PI / 2, color: S.paintRed, text: ['Zuckerwatte', 'Liebesäpfel'], kind: 'candy' },
    { x: 6.5, z: 13, yaw: -Math.PI / 2, color: S.paintYellow, text: ['Entenangeln', 'Für die Kleinen'], kind: 'ducks' },
  ];
  const roofTops: V3[] = [];
  for (const bo of booths) {
    const y = g(bo.x, bo.z);
    b.setFrame([bo.x, y, bo.z], [0, bo.yaw, 0]);
    b.box(bo.color, [3.6, 2.6, 0.1], [0, 1.3, -1.2]);
    for (const s of [-1, 1]) b.box(bo.color, [0.1, 2.6, 2.4], [s * 1.8, 1.3, 0]);
    b.box(W.wood, [3.6, 1.0, 0.3], [0, 0.5, 1.05]);
    b.box(bo.color, [3.8, 0.12, 2.8], [0, 2.66, 0.1], [0, 0, 0], false);
    for (let i = 0; i < 8; i++) b.box(i % 2 ? S.canvasRed : S.canvasCream, [0.475, 0.03, 1.3], [-1.66 + i * 0.475, 2.42, 1.95], [0.38, 0, 0], false);
    if (bo.kind === 'shoot') {
      for (let i = 0; i < 6; i++) {
        b.add(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 16), S.paintCream, [-1.25 + i * 0.5, 1.7, -1.13], [Math.PI / 2, 0, 0], false);
        b.add(new THREE.CylinderGeometry(0.09, 0.09, 0.035, 12), S.paintRed, [-1.25 + i * 0.5, 1.7, -1.12], [Math.PI / 2, 0, 0], false);
      }
      for (let i = 0; i < 3; i++) b.box(M.metal, [0.06, 0.06, 0.9], [-0.8 + i * 0.6, 1.05, 0.95], [0, 0.2 - i * 0.2, 0], false);
      b.container('locker', [0, 1.15, 0.9]);
    } else if (bo.kind === 'lots') {
      const teddy = S.teddy.map(() => new Batch());
      for (let i = 0; i < 7; i++) {
        const tx = -1.4 + i * 0.47;
        const t = teddy[i % teddy.length];
        const hang = 1.9 - (i % 3) * 0.12;
        strutInto(wires, [tx, 2.6, -0.8], [tx, hang + 0.25, -0.8], 0.006, 3);
        t.add(new THREE.SphereGeometry(0.16, 8, 6), [tx, hang, -0.8], [0, 0, 0], [1, 1.15, 0.9]);
        t.add(new THREE.SphereGeometry(0.11, 8, 6), [tx, hang + 0.22, -0.78]);
        for (const s of [-1, 1]) t.add(new THREE.SphereGeometry(0.045, 6, 4), [tx + s * 0.08, hang + 0.31, -0.8]);
      }
      teddy.forEach((t, i) => t.build(b, S.teddy[i]));
      b.add(new THREE.CylinderGeometry(0.35, 0.35, 0.6, 8), S.paintCream, [0.9, 1.35, 0.9], [0, 0, Math.PI / 2]);
      // Ballons an der Bude: schaukeln im Wind
      for (let i = 0; i < 4; i++) {
        const bg = new THREE.Group();
        put(bg, new THREE.SphereGeometry(0.26, 12, 10), S.balloon[i % 3], [0, 0, 0], [0, 0, 0], false).scale.set(1, 1.2, 1);
        put(bg, new THREE.CylinderGeometry(0.005, 0.005, 1.4, 3), M.rope, [0, -0.95, 0], [0, 0, 0], false);
        const bp = b.point([1.9 + (i % 2) * 0.25, 3.5 + i * 0.22, 1.2 - i * 0.3]);
        bg.position.copy(bp);
        bg.rotation.y = bo.yaw;
        b.group.add(bg);
        b.model.bobbers.push({ object: bg, base: bp.clone(), amp: 0.08, speed: 0.7 + i * 0.13, roll: 0.12 });
      }
    } else if (bo.kind === 'candy') {
      b.cyl(M.metal, 0.4, 0.3, 0.3, [-0.6, 1.15, 0.85], [0, 0, 0], 12, false);
      for (let i = 0; i < 3; i++) b.add(new THREE.SphereGeometry(0.17, 10, 8), std(0xf0b8c8, { roughness: 1 }), [0.4 + i * 0.4, 1.32, 0.9], [0, 0, 0], false);
      b.container('crate', [0.9, 1.15, 0.6]);
    } else {
      b.cyl(S.paintBlue, 0.9, 0.9, 0.4, [0, 1.2, 0.2], [0, 0, 0], 16, false);
      b.add(new THREE.CylinderGeometry(0.85, 0.85, 0.02, 16), S.stillWater, [0, 1.38, 0.2], [0, 0, 0], false);
      const ducks = new Batch();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ducks.add(new THREE.SphereGeometry(0.09, 8, 6), [Math.cos(a) * 0.5, 1.42, 0.2 + Math.sin(a) * 0.5], [0, 0, 0], [1, 0.8, 1.3]);
        ducks.add(new THREE.SphereGeometry(0.055, 8, 6), [Math.cos(a) * 0.5, 1.53, 0.28 + Math.sin(a) * 0.5]);
      }
      ducks.build(b, S.paintYellow);
    }
    b.setFrame(null);
    // Schild über der Front (außerhalb des Rahmens gedreht)
    const c = Math.cos(bo.yaw);
    const s = Math.sin(bo.yaw);
    const fx = bo.x + s * 1.35;
    const fz = bo.z + c * 1.35;
    sign(b, bo.text, '#efe4c6', '#7a1e1a', [fx, y + 3.05, fz], bo.yaw, 1.1);
    roofTops.push([bo.x + s * 1.6, y + 2.75, bo.z + c * 1.6]);
  }
  // Eingangstor mit großem Schild und Birnen ringsum
  const gz = 20;
  const gy = g(0, gz);
  for (const s of [-1, 1]) {
    b.box(S.paintRed, [0.45, 5.4, 0.45], [s * 3.4, gy + 2.7, gz]);
    b.add(new THREE.SphereGeometry(0.3, 10, 8), S.gold, [s * 3.4, gy + 5.6, gz]);
  }
  b.box(S.paintRed, [7.2, 0.3, 0.3], [0, gy + 4.4, gz], [0, 0, 0], false);
  sign(b, ['GLÜCKAUF', 'Rummelplatz · Bergfest'], '#7a1e1a', '#f2d27a', [0, gy + 5.4, gz + 0.18], 0, 4.2);
  sign(b, ['GLÜCKAUF', 'Rummelplatz · Bergfest'], '#7a1e1a', '#f2d27a', [0, gy + 5.4, gz - 0.18], Math.PI, 4.2);
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    for (const zz of [0.24, -0.24]) {
      trimBulbs.add([-2.52 + u * 5.04, gy + 6.68, gz + zz]);
      trimBulbs.add([-2.52 + u * 5.04, gy + 4.12, gz + zz]);
    }
  }
  // Lichterketten: zickzack über die Gasse, zum Tor, zum Rad und zum Karussell
  garland(wires, bulbs, [-3.4, gy + 5.2, gz], roofTops[2], 0.5);
  garland(wires, bulbs, [3.4, gy + 5.2, gz], roofTops[3], 0.5);
  garland(wires, bulbs, roofTops[2], roofTops[3], 0.9);
  garland(wires, bulbs, roofTops[3], roofTops[0], 1.0);
  garland(wires, bulbs, roofTops[0], roofTops[1], 0.9);
  garland(wires, bulbs, roofTops[2], roofTops[0], 0.4);
  garland(wires, bulbs, roofTops[3], roofTops[1], 0.4);
  garland(wires, bulbs, roofTops[0], [wx + 4.4, g(wx + 4.4, wz + 3) + 2.9, wz + 3], 1.2);
  garland(wires, bulbs, roofTops[1], [cx, gc + 6.0, cz], 1.4);
  garland(wires, bulbs, [wx + 4.4, g(wx + 4.4, wz + 3) + 2.9, wz + 3], [cx, gc + 6.0, cz], 1.8);
  // Laternen an der Gasse
  const lampMat = glow(b, 0xfff0d0, 0xffd090, 0.1, 3, 0.4);
  for (const [x, z] of [[-3.6, 4], [3.6, 4], [-3.6, 16], [3.6, 16]]) {
    const y = g(x, z);
    b.cyl(S.iron, 0.07, 0.1, 3.4, [x, y + 1.7, z], [0, 0, 0], 8);
    b.add(new THREE.SphereGeometry(0.24, 12, 10), lampMat, [x, y + 3.55, z], [0, 0, 0], false);
  }
  b.light([-3.6, g(-3.6, 16) + 3.3, 16], 0xffcf90, 5, 14, 'lamp');
  b.light([3.6, g(3.6, 4) + 3.3, 4], 0xffcf90, 5, 14, 'lamp');
  b.light([0, gy + 4.6, gz - 1], 0xff9a50, 4, 11, 'flicker');

  // --- Wagen der Wahrsagerin ---
  b.setFrame([-14, g(-14, 7), 7], [0, 0.45, 0]);
  b.box(S.paintPurple, [2.2, 2.0, 4.6], [0, 1.65, 0]);
  b.add(new THREE.CylinderGeometry(1.15, 1.15, 4.7, 16, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), S.paintPurple, [0, 2.65, 0]);
  b.box(S.gold, [2.24, 0.1, 4.64], [0, 1.2, 0], [0, 0, 0], false);
  b.box(S.gold, [2.24, 0.1, 4.64], [0, 2.6, 0], [0, 0, 0], false);
  for (const [sx, sz] of [[-1, -1.5], [1, -1.5], [-1, 1.5], [1, 1.5]]) b.add(new THREE.CylinderGeometry(0.48, 0.48, 0.12, 14), W.woodDark, [sx * 1.15, 0.48, sz], [0, 0, Math.PI / 2]);
  b.box(W.woodDark, [0.9, 1.7, 0.06], [0, 1.6, 2.31], [0, 0, 0], false);
  for (let i = 0; i < 3; i++) b.box(W.wood, [0.9, 0.08, 0.35], [0, 0.18 + i * 0.22, 2.9 - i * 0.3]);
  const windowMat = glow(b, 0x2a1838, 0xc070ff, 0.1, 2.2, 0.9);
  b.box(windowMat, [0.05, 0.5, 0.8], [1.11, 1.9, -0.6], [0, 0, 0], false);
  sign(b, ['Madame Zora', 'sieht alles'], '#2a1838', '#e8c870', [1.14, 2.05, 1.1], 0.45 + Math.PI / 2, 0.75);
  b.setFrame(null);
  // Tisch mit Kristallkugel und Karten unter einem Sonnensegel
  const tx = -11.2;
  const tz = 9.6;
  const ty = g(tx, tz);
  b.cyl(W.woodDark, 0.5, 0.5, 0.06, [tx, ty + 0.78, tz], [0, 0, 0], 16);
  b.cyl(W.woodDark, 0.06, 0.12, 0.76, [tx, ty + 0.38, tz], [0, 0, 0], 8, false);
  b.add(new THREE.BoxGeometry(1.15, 0.02, 1.15), std(0x3a1a4a, { roughness: 1 }), [tx, ty + 0.8, tz], [0, 0.3, 0], false);
  const ball = orb(b, 0xc890ff, 0.15, 1.6, 0.6, 5, 1.2);
  ball.position.copy(b.point([tx, ty + 0.98, tz]));
  b.group.add(ball);
  b.add(new THREE.CylinderGeometry(0.1, 0.12, 0.06, 10), S.gold, [tx, ty + 0.84, tz], [0, 0, 0], false);
  for (let i = 0; i < 3; i++) b.add(new THREE.PlaneGeometry(0.09, 0.14), S.paper, [tx - 0.25 + i * 0.13, ty + 0.815, tz + 0.25], [-Math.PI / 2, 0, i * 0.2 - 0.2], false);
  b.note('rummel', [tx + 0.24, ty + 0.81, tz - 0.18], 0.4);
  b.add(new THREE.PlaneGeometry(3, 2.4), S.canvasRed, [tx - 0.3, ty + 2.35, tz + 0.4], [-Math.PI / 2 + 0.25, 0.45, 0], false);
  for (const [sx, sz] of [[0.9, 1.2], [-1.4, 1.6]]) b.cyl(W.woodDark, 0.04, 0.04, 2.3, [tx + sx, ty + 1.15, tz + sz], [0, 0, 0], 6, false);
  b.light([tx, ty + 1.3, tz], 0xb060ff, 4, 8, 'pulse');

  // Abfall: Tüten, Lose, Pappbecher auf der Gasse
  const trash = new Batch();
  const tickets = new Batch();
  for (let i = 0; i < 40; i++) {
    const x = (rng() - 0.5) * 12;
    const z = rng() * 18;
    if (rng() < 0.4) trash.add(new THREE.BoxGeometry(0.12, 0.16, 0.12), [x, g(x, z) + 0.06, z], [rng() * 1.5, rng() * 3, rng()]);
    else tickets.add(new THREE.PlaneGeometry(0.08, 0.05).rotateX(-Math.PI / 2), [x, g(x, z) + 0.02, z], [0, rng() * 3, 0]);
  }
  trash.build(b, S.paintCream);
  tickets.build(b, S.paintYellow);

  wires.build(b, S.wire);
  bulbs.build(b, [0xfff0c0, 0xff5a4a]);
  trimBulbs.build(b, [0xfff4d0, 0xffc060]);
}

// ---------------------------------------------------------------------------
// Sternwarte Krähenstein
// ---------------------------------------------------------------------------

function buildObservatory(b: Builder, rng: () => number): void {
  const g = b.ground;
  const R = 4.2;
  const WH = 4;
  // Terrasse aus Platten
  b.add(new THREE.CylinderGeometry(8, 8.2, 0.12, 40), M.concrete, [0, 0.0, 0], [0, 0, 0], false);
  // Rundmauer mit Tür nach +Z
  const segs = 20;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.2) continue;
    b.box(S.plaster, [1.38, WH, 0.35], [Math.sin(a) * R, WH / 2, Math.cos(a) * R], [0, a, 0]);
  }
  b.box(S.plaster, [1.6, 0.9, 0.38], [0, WH - 0.45, R], [0, 0, 0], false);
  b.box(W.woodDark, [0.08, 3.0, 1.0], [0.62, 1.5, R + 0.4], [0, 0.9, 0], false);
  b.cyl(W.wood, R - 0.1, R - 0.1, 0.2, [0, 0.1, 0], [0, 0, 0], 32, false);
  b.collider([3, 0.1, 3], [0, 0.1, 0]);
  b.add(new THREE.CylinderGeometry(R + 0.3, R + 0.3, 0.35, 40, 1, true), S.dome, [0, WH + 0.1, 0], [0, 0, 0], false);
  b.add(new THREE.RingGeometry(R - 0.2, R + 0.3, 40).rotateX(Math.PI / 2), S.dome, [0, WH - 0.05, 0], [0, 0, 0], false);
  // Kuppel aus zwei Hälften mit offenem Spalt (längs X)
  for (const [phi, dz] of [[0, 0.55], [Math.PI, -0.55]]) {
    b.add(new THREE.SphereGeometry(R + 0.25, 40, 14, phi, Math.PI, 0, Math.PI / 2), S.dome, [0, WH + 0.25, dz]);
    // Rippen
    for (let k = 1; k < 6; k++) {
      const p = phi + (k / 6) * Math.PI;
      b.add(new THREE.TorusGeometry(R + 0.27, 0.03, 4, 20, Math.PI / 2), S.dome, [0, WH + 0.25, dz], [0, p, Math.PI / 2], false);
    }
  }
  // Teleskop: Säule, Montierung, Tubus Richtung Spalt (Höhe 50°)
  const el = (50 * Math.PI) / 180;
  b.cyl(S.iron, 0.3, 0.38, 1.9, [-0.6, 1.15, 0], [0, 0, 0], 12);
  b.box(S.iron, [0.5, 0.4, 0.6], [-0.6, 2.2, 0], [0, 0, 0], false);
  const dir = new THREE.Vector3(Math.cos(el), Math.sin(el), 0);
  const mount = new THREE.Vector3(-0.6, 2.3, 0);
  const tubeMid = mount.clone().addScaledVector(dir, 0.8);
  b.add(new THREE.CylinderGeometry(0.3, 0.3, 3.6, 20), S.paintCream, tubeMid.toArray() as V3, [0, 0, el - Math.PI / 2]);
  for (const t of [-0.9, 0.6, 2.4]) b.add(new THREE.CylinderGeometry(0.33, 0.33, 0.12, 20), S.iron, mount.clone().addScaledVector(dir, t).toArray() as V3, [0, 0, el - Math.PI / 2], false);
  b.add(new THREE.CylinderGeometry(0.34, 0.33, 0.6, 20, 1, true), M.dark, mount.clone().addScaledVector(dir, 2.75).toArray() as V3, [0, 0, el - Math.PI / 2], false);
  const eye = mount.clone().addScaledVector(dir, -1.05);
  b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 8), S.iron, [eye.x - 0.1, eye.y - 0.05, 0], [0, 0, 0.6], false);
  b.add(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 6), S.iron, [-0.6, 1.9, 0.5], [0.5, 0, 0], false);
  b.add(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 12), S.iron, [-0.6, 1.4, 1.05], [0.5, 0, 0], false);
  b.use('telescope', [eye.x - 0.15, eye.y - 0.1, 0]);
  // Schreibtisch mit Sternkarten, rotes Nachtlicht, Bücherregal
  b.setFrame([2.0, 0.2, -2.3], [0, -0.72, 0]);
  b.box(W.woodDark, [1.6, 0.06, 0.8], [0, 0.78, 0]);
  for (const [sx, sz] of [[-0.72, -0.34], [0.72, -0.34], [-0.72, 0.34], [0.72, 0.34]]) b.box(W.woodDark, [0.06, 0.76, 0.06], [sx, 0.38, sz], [0, 0, 0], false);
  b.container('desk', [0, 0.95, 0]);
  b.add(new THREE.PlaneGeometry(0.7, 0.5), std(0x1c2840, { side: THREE.DoubleSide }), [-0.35, 0.815, 0.05], [-Math.PI / 2, 0, 0.1], false);
  b.add(new THREE.PlaneGeometry(0.5, 0.4), S.paper, [0.25, 0.814, -0.1], [-Math.PI / 2, 0, -0.2], false);
  b.note('sternwarte', [0.45, 0.82, 0.18], 0.3);
  b.add(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 10), glow(b, 0x400808, 0xff2010, 0.3, 4, 0.6), [-0.6, 0.92, -0.25], [0, 0, 0], false);
  b.box(W.wood, [0.45, 0.04, 0.45], [0, 0.46, 0.8]);
  b.box(W.wood, [0.45, 0.5, 0.04], [0, 0.72, 1.02], [0, 0, 0], false);
  b.setFrame(null);
  b.light([1.8, 1.5, -2.2], 0xff2a18, 8, 10, 'lamp');
  b.setFrame([-2.6, 0.2, -2.6], [0, Math.PI / 4, 0]);
  b.box(W.woodDark, [1.4, 2.2, 0.4], [0, 1.1, 0]);
  const books = S.book.map(() => new Batch());
  for (let row = 0; row < 4; row++) {
    let x = -0.6;
    while (x < 0.6) {
      const w = 0.05 + rng() * 0.05;
      const h = 0.28 + rng() * 0.1;
      books[Math.floor(rng() * books.length)].add(new THREE.BoxGeometry(w, h, 0.25), [x + w / 2, 0.3 + row * 0.5 + h / 2, 0.22]);
      x += w + 0.008;
    }
  }
  books.forEach((bk, i) => bk.build(b, S.book[i]));
  b.setFrame(null);
  // Draußen: Windmesser (dreht sich), Sonnenuhr, Bank, kleines Fernrohr, Schild
  b.cyl(S.iron, 0.04, 0.05, 4.4, [-5.6, g(-5.6, 3) + 2.2, 3], [0, 0, 0], 6);
  const cups = new THREE.Group();
  cups.position.copy(b.point([-5.6, g(-5.6, 3) + 4.45, 3]));
  b.group.add(cups);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    put(cups, new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4), S.iron, [Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25], [0, -a, Math.PI / 2], false);
    put(cups, new THREE.SphereGeometry(0.08, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), S.paintCream, [Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5], [0, -a, Math.PI / 2], false);
  }
  b.model.spinners.push({ object: cups, speed: 3.2 });
  b.cyl(W.stone, 0.3, 0.35, 1.0, [4.4, g(4.4, -4.6) + 0.5, -4.6], [0, 0, 0], 10);
  b.add(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 20), S.gold, [4.4, g(4.4, -4.6) + 1.03, -4.6], [0, 0, 0], false);
  b.add(new THREE.BoxGeometry(0.02, 0.22, 0.32), S.gold, [4.4, g(4.4, -4.6) + 1.15, -4.6], [0, 0, 0.3], false);
  b.setFrame([5.4, g(5.4, 3.6), 3.6], [0, -2.2, 0]);
  b.box(W.wood, [1.6, 0.06, 0.45], [0, 0.45, 0]);
  b.box(W.wood, [1.6, 0.45, 0.05], [0, 0.72, -0.22], [0, 0, 0], false);
  for (const s of [-0.7, 0.7]) b.box(S.iron, [0.06, 0.45, 0.4], [s, 0.22, 0], [0, 0, 0], false);
  b.setFrame(null);
  const ty = g(-3, 6.5);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    strut(b, W.woodDark, [-3 + Math.cos(a) * 0.4, ty, 6.5 + Math.sin(a) * 0.4], [-3, ty + 1.2, 6.5], 0.03);
  }
  b.add(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 12), S.gold, [-3, ty + 1.35, 6.5], [0.9, 0.6, 0], false);
  const sy = g(2.2, 7.8);
  for (const s of [-0.5, 0.5]) b.box(W.woodDark, [0.08, 1.6, 0.08], [2.2 + s, sy + 0.8, 7.8]);
  sign(b, ['Sternwarte Krähenstein', 'Volkssternwarte · Eintritt frei'], '#1c2840', '#e6dcbc', [2.2, sy + 1.5, 7.85], 0, 0.95);
  b.model.sounds.push({ position: new THREE.Vector3(0, WH + 2, 0), sound: 'creak', every: [10, 22], volume: 0.4 });
}

// ---------------------------------------------------------------------------
// Irrlichtmoor
// ---------------------------------------------------------------------------

function buildBog(b: Builder, rng: () => number): void {
  const g = b.ground;
  // Schwarzes Wasser über dem abgesenkten Gelände (wo das Gelände höher ist, verdeckt es die Fläche).
  b.add(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), S.bogWater, [0, -0.14, 0], [0, 0, 0], false);
  // Bohlenweg in Schlangenlinie, über breite Stellen am Bildstock
  const path: [number, number][] = [
    [-2, -29],
    [-1, -20],
    [3, -13],
    [1, -5],
    [-4, 1],
    [-2, 8],
    [3, 13],
    [4, 16],
  ];
  const deck = (x: number, z: number) => Math.max(0.32, g(x, z) + 0.18);
  const planks = new Batch();
  const beams = new Batch();
  const posts = new Batch();
  const rope = new Batch();
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, z0] = path[i];
    const [x1, z1] = path[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const y0 = deck(x0, z0);
    const y1 = deck(x1, z1);
    const pitch = -Math.atan2(y1 - y0, len);
    const nx = Math.cos(yaw);
    const nz = -Math.sin(yaw);
    b.collider([0.68, 0.06, len / 2 + 0.3], [(x0 + x1) / 2, (y0 + y1) / 2 - 0.06, (z0 + z1) / 2], yawPitch(yaw, pitch));
    for (let d = 0; d < len; d += 0.3) {
      if (rng() < 0.03) continue;
      const u = d / len;
      const x = x0 + (x1 - x0) * u;
      const z = z0 + (z1 - z0) * u;
      planks.add(new THREE.BoxGeometry(1.4, 0.06, 0.25), [x, y0 + (y1 - y0) * u - 0.03 + (rng() - 0.5) * 0.02, z], yawPitch(yaw + (rng() - 0.5) * 0.06, pitch, (rng() - 0.5) * 0.04));
    }
    for (const s of [-0.5, 0.5]) beams.add(new THREE.BoxGeometry(0.12, 0.14, len + 0.4), [(x0 + x1) / 2 + nx * s, (y0 + y1) / 2 - 0.13, (z0 + z1) / 2 + nz * s], yawPitch(yaw, pitch));
    for (let d = 0; d < len; d += 2.4) {
      const u = d / len;
      const x = x0 + (x1 - x0) * u;
      const z = z0 + (z1 - z0) * u;
      const y = y0 + (y1 - y0) * u;
      const rail = i % 3 !== 1;
      for (const s of [-0.72, 0.72]) {
        const high = rail && s < 0;
        const ht = high ? y + 1.0 : y - 0.05;
        posts.add(new THREE.CylinderGeometry(0.07, 0.08, ht + 1.2, 6), [x + nx * s, (ht - 1.2) / 2, z + nz * s], [(rng() - 0.5) * 0.1, 0, (rng() - 0.5) * 0.1]);
      }
      if (rail && d + 2.4 < len) {
        const u2 = (d + 2.4) / len;
        const a: V3 = [x - nx * 0.72, y + 0.9, z - nz * 0.72];
        const c: V3 = [x0 + (x1 - x0) * u2 - nx * 0.72, y0 + (y1 - y0) * u2 + 0.9, z0 + (z1 - z0) * u2 - nz * 0.72];
        const m: V3 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - 0.15, (a[2] + c[2]) / 2];
        strutInto(rope, a, m, 0.02, 4);
        strutInto(rope, m, c, 0.02, 4);
      }
    }
  }
  // Plattform mit Bildstock auf halbem Weg
  const [px, pz] = path[3];
  const py = deck(px, pz);
  b.box(W.wood, [3, 0.08, 3], [px, py - 0.04, pz], [0, 0.3, 0]);
  b.setFrame([px + 0.9, py, pz - 0.9], [0, 0.3 + Math.PI * 0.75, 0]);
  b.box(W.woodDark, [0.16, 1.5, 0.16], [0, 0.75, 0]);
  b.box(W.woodDark, [0.55, 0.6, 0.35], [0, 1.75, 0]);
  b.box(M.dark, [0.45, 0.48, 0.05], [0, 1.75, 0.16], [0, 0, 0], false);
  for (const s of [-1, 1]) b.box(W.roof, [0.42, 0.04, 0.5], [s * 0.17, 2.15, 0], [0, 0, s * -0.6], false);
  b.box(W.bronze, [0.03, 0.3, 0.03], [0, 1.78, 0.12], [0, 0, 0], false);
  b.box(W.bronze, [0.16, 0.03, 0.03], [0, 1.84, 0.12], [0, 0, 0], false);
  const flame = glow(b, 0xffe0a0, 0xffa040, 0.6, 4, 7);
  for (let i = 0; i < 3; i++) {
    const cx = -0.18 + i * 0.18;
    b.add(new THREE.CylinderGeometry(0.025, 0.025, 0.12 + i * 0.03, 8), S.paintCream, [cx, 1.52, 0.3], [0, 0, 0], false);
    b.add(new THREE.SphereGeometry(0.018, 6, 4), flame, [cx, 1.6 + i * 0.015, 0.3], [0, 0, 0], false).scale.set(1, 1.8, 1);
  }
  b.box(W.wood, [0.6, 0.04, 0.2], [0, 1.45, 0.3], [0, 0, 0], false);
  b.setFrame(null);
  b.light(b.point([px + 0.9, py + 1.6, pz - 0.6]).toArray() as V3, 0xffa040, 3, 7, 'lamp');
  b.note('irrlicht', [px - 0.6, py + 0.01, pz + 0.4], 0.8);
  // Verwelkter Strauß zu Füßen des Bildstocks
  for (let i = 0; i < 6; i++) b.add(new THREE.CylinderGeometry(0.008, 0.008, 0.4), M.rope, [px + 0.75 + (rng() - 0.5) * 0.15, py + 0.15, pz - 0.55 + (rng() - 0.5) * 0.15], [(rng() - 0.5) * 0.6, 0, (rng() - 0.5) * 0.6], false);

  // Beobachtungshütte am Ende des Weges
  const [hx, hz] = path[path.length - 1];
  const hy = deck(hx, hz);
  // Vorn (lokal −Z, zum Weg und zum Moor) Sehschlitz und Tür, hinten volle Wand.
  b.setFrame([hx - 0.6, hy, hz + 2.1], [0, 0.25, 0]);
  for (const [sx, sz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) b.cyl(W.woodDark, 0.1, 0.12, 2.6, [sx, -0.9, sz], [0, 0, 0], 6, false);
  b.box(W.wood, [3.2, 0.12, 3.2], [0, 0.0, 0]);
  b.box(M.oldPlanks, [2.0, 0.9, 0.1], [-0.6, 0.5, -1.55]);
  b.box(W.wood, [2.0, 0.5, 0.1], [-0.6, 1.95, -1.55]);
  b.box(W.wood, [0.4, 2.2, 0.1], [1.4, 1.1, -1.55]);
  b.box(W.wood, [0.8, 0.45, 0.1], [0.8, 1.98, -1.55], [0, 0, 0], false);
  b.box(W.wood, [3.2, 2.2, 0.1], [0, 1.1, 1.55]);
  for (const sx of [-1, 1]) b.box(W.wood, [0.1, 2.2, 3.2], [sx * 1.55, 1.1, 0]);
  b.box(W.roof, [3.6, 0.1, 3.8], [0, 2.35, 0], [0.12, 0, 0], false);
  b.box(W.wood, [1.8, 0.05, 0.35], [-0.6, 0.5, -1.15]);
  b.box(M.oldPlanks, [0.6, 1.0, 0.35], [-1.1, 0.5, 1.25]);
  b.container('shelf', [-1.1, 1.1, 1.15]);
  b.lantern([0.8, 1.95, 0.9]);
  b.setFrame(null);
  planks.build(b, W.wood, true);
  beams.build(b, W.woodDark);
  posts.build(b, W.woodDark, true);
  rope.build(b, M.rope);

  // Tote Birken, Schilf, Entengrütze – Abstand zum Weg halten
  const nearPath = (x: number, z: number, r: number) => {
    for (let i = 0; i < path.length - 1; i++) {
      const [x0, z0] = path[i];
      const [x1, z1] = path[i + 1];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(x - x0 - dx * t, z - z0 - dz * t) < r) return true;
    }
    return false;
  };
  const marks = new Batch();
  for (let i = 0, n = 0; i < 80 && n < 22; i++) {
    const a = rng() * Math.PI * 2;
    const r = 3 + rng() * 22;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (nearPath(x, z, 2.2) || Math.hypot(x - hx, z - hz - 2) < 3) continue;
    n++;
    const y = g(x, z) - 0.2;
    const broken = rng() < 0.3;
    const h = broken ? 1.5 + rng() * 2.5 : 5 + rng() * 5;
    const lean: V3 = [(rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3];
    const thick = 0.1 + rng() * 0.08;
    b.cyl(S.birch, thick * 0.6, thick, h, [x, y + h / 2, z], lean, 8, false);
    b.collider([thick, h / 2, thick], [x, y + h / 2, z], lean, false);
    if (broken) b.add(new THREE.ConeGeometry(thick * 0.7, 0.5, 5), S.birch, [x + lean[2] * -h * 0.5, y + h + 0.2, z + lean[0] * h * 0.5], [rng() * 0.6, 0, rng() * 0.6], false);
    for (let k = 0; k < 6; k++) {
      const my = y + 0.5 + rng() * (h - 0.8);
      const ma = rng() * Math.PI * 2;
      marks.add(new THREE.BoxGeometry(thick * 0.9, 0.04 + rng() * 0.05, 0.02), [x + Math.cos(ma) * thick * 0.85 - lean[2] * (my - y), my, z + Math.sin(ma) * thick * 0.85 + lean[0] * (my - y)], [0, -ma + Math.PI / 2, 0]);
    }
    if (!broken) {
      for (let k = 0; k < 3; k++) {
        const by = y + h * (0.55 + rng() * 0.35);
        const ba = rng() * Math.PI * 2;
        b.add(new THREE.CylinderGeometry(0.015, 0.04, 1.4 + rng()), S.birch, [x + Math.cos(ba) * 0.5 - lean[2] * (by - y), by + 0.3, z + Math.sin(ba) * 0.5 + lean[0] * (by - y)], [Math.sin(ba) * 0.8, 0, -Math.cos(ba) * 0.8], false);
      }
    }
  }
  marks.build(b, S.birchMark);
  const reeds = new Batch();
  const heads = new Batch();
  const weed = new Batch();
  for (let c = 0; c < 26; c++) {
    const a = rng() * Math.PI * 2;
    const r = 5 + rng() * 21;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    if (nearPath(cx, cz, 1.6)) continue;
    for (let k = 0; k < 16; k++) {
      const x = cx + (rng() - 0.5) * 2.4;
      const z = cz + (rng() - 0.5) * 2.4;
      if (nearPath(x, z, 1.0)) continue;
      const h = 1.0 + rng() * 1.0;
      const y = Math.max(g(x, z), -0.15);
      const lean: V3 = [(rng() - 0.5) * 0.25, 0, (rng() - 0.5) * 0.25];
      reeds.add(new THREE.CylinderGeometry(0.008, 0.014, h, 3), [x, y + h / 2, z], lean);
      if (rng() < 0.25) heads.add(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6), [x - lean[2] * h * 0.5, y + h - 0.05, z + lean[0] * h * 0.5], lean);
    }
  }
  const pad = new THREE.CircleGeometry(0.5, 7).rotateX(-Math.PI / 2);
  for (let i = 0; i < 70; i++) {
    const a = rng() * Math.PI * 2;
    const r = 3 + rng() * 22;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (g(x, z) > -0.2 || nearPath(x, z, 1)) continue;
    const s = 0.6 + rng() * 2;
    weed.add(pad, [x, -0.125, z], [0, rng() * 6, 0], [s, 1, s * (0.5 + rng() * 0.5)]);
  }
  reeds.build(b, S.reed);
  heads.build(b, S.cattail);
  weed.build(b, std(0x3a4a1e, { roughness: 0.9 }));
  // Versunkener Handkarren
  b.setFrame([7, -0.35, -9], [0.25, 0.8, -0.35]);
  b.box(W.woodDark, [1.1, 0.35, 1.7], [0, 0.2, 0], [0, 0, 0], false);
  b.add(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 12), W.woodDark, [0.6, 0.1, 0.2], [0, 0, Math.PI / 2], false);
  b.box(W.woodDark, [0.08, 0.08, 1.6], [-0.3, 0.3, 1.4], [0, 0, 0], false);
  b.box(W.woodDark, [0.08, 0.08, 1.6], [0.3, 0.3, 1.4], [0, 0, 0], false);
  b.setFrame(null);

  // Irrlichter: schweben über dem Wasser und weichen zurück
  const homes: V3[] = [
    [8, 1.1, -14],
    [-8, 1.3, -8],
    [10, 1.0, 2],
    [-10, 1.4, 6],
    [6, 1.2, 9],
    [-6, 1.0, -18],
    [12, 1.5, -4],
    [-13, 1.2, -2],
  ];
  homes.forEach((h, i) => {
    const w = orb(b, i % 3 ? 0x9affd8 : 0xc8ffb0, 0.08, 2.2, 0.3, 7, 2 + i * 0.3);
    const home = new THREE.Vector3(...h);
    w.position.copy(home);
    b.group.add(w);
    b.model.wisps.push({ object: w, home, range: 2.5 + (i % 3), phase: i * 2.3 });
  });
  b.light([8, 1.2, -8], 0x8affc0, 4, 12, 'pulse');
  b.light([-8, 1.2, 4], 0x8affc0, 4, 12, 'pulse');
  particles(b, { count: 160, center: [0, -0.1, -2], radius: 26, height: 1.8, color: 0xc8d8c8, size: 7, rise: 0.02, sway: 2.5, day: 0.15, night: 0.35 });
  particles(b, { count: 120, center: [0, -0.05, -2], radius: 22, height: 1.4, color: 0xa8ffc8, size: 0.14, rise: 0.05, sway: 1.2, day: 0, night: 0.9, additive: true });
  for (const [x, z] of [[9, -16], [-11, 0], [7, 10]]) b.model.sounds.push({ position: new THREE.Vector3(x, 0, z), sound: 'frog', every: [3, 9], volume: 0.5 });
  b.model.sounds.push({ position: new THREE.Vector3(0, 1, -6), sound: 'whisper', every: [14, 30], volume: 0.45, when: 'night' });
}

// ---------------------------------------------------------------------------
// Gut Rosenthal
// ---------------------------------------------------------------------------

function buildManor(b: Builder, rng: () => number): void {
  const g = b.ground;
  const stoneBatch = new Batch();
  // Kieswege: Hauptachse vom Tor zum Haus, Querweg zum Glashaus, runder Platz am Brunnen
  b.add(new THREE.BoxGeometry(2.4, 0.06, 32), S.gravel, [0, 0.02, 2.5], [0, 0, 0], false);
  b.add(new THREE.BoxGeometry(17, 0.06, 2.4), S.gravel, [-0.5, 0.02, 0], [0, 0, 0], false);
  b.add(new THREE.CylinderGeometry(5.6, 5.6, 0.06, 40), S.gravel, [0, 0.025, 0], [0, 0, 0], false);

  // Brunnen: achteckiges Becken, Schale, Engel mit Krug, aus dem Wasser rinnt
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    b.box(S.marble, [2.55, 0.65, 0.35], [Math.sin(a) * 3.05, 0.33, Math.cos(a) * 3.05], [0, a, 0]);
  }
  b.add(new THREE.CircleGeometry(3, 8).rotateX(-Math.PI / 2), S.stillWater, [0, 0.48, 0], [0, Math.PI / 8, 0], false);
  b.cyl(S.marble, 0.5, 0.65, 1.5, [0, 0.75, 0], [0, 0, 0], 12);
  b.add(new THREE.CylinderGeometry(1.25, 0.35, 0.35, 20), S.marble, [0, 1.65, 0], [0, 0, 0], false);
  b.add(new THREE.CircleGeometry(1.15, 20).rotateX(-Math.PI / 2), S.stillWater, [0, 1.8, 0], [0, 0, 0], false);
  const angel = new THREE.Matrix4().compose(b.point([0, 1.82, 0]).sub(new THREE.Vector3()), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
  statue(stoneBatch, angel, { wings: true, jug: true });
  const stream = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 1.0), waterMaterial(b, 2.2, 0.75));
  stream.scale.y = 1.8;
  stream.position.copy(b.point([0.42, 2.75, 0.5]));
  stream.rotation.set(0, 0.6, 0.06);
  b.group.add(stream);
  b.model.sounds.push({ position: b.point([0, 1.2, 0]), loop: { freq: 2400, q: 0.8, gain: 0.22, range: 16 } });

  // Statuen an den Ecken des Platzes: eine kopflos, eine umgestürzt
  const corners: [number, number, number][] = [
    [4.7, 4.7, 0],
    [-4.7, 4.7, 1],
    [4.7, -4.7, 2],
    [-4.7, -4.7, 3],
  ];
  for (const [x, z, v] of corners) {
    const yaw = Math.atan2(-x, -z);
    b.box(S.marble, [0.9, 1.0, 0.9], [x, 0.5, z], [0, yaw, 0]);
    b.box(S.marble, [1.05, 0.12, 1.05], [x, 1.05, z], [0, yaw, 0], false);
    const m = new THREE.Matrix4();
    if (v === 3) {
      // umgestürzt neben dem Sockel
      m.compose(b.point([x + 1.2, 0.35, z + 0.4]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + 0.8, Math.PI / 2 - 0.08)), new THREE.Vector3(1, 1, 1));
    } else m.compose(b.point([x, 1.1, z]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(0.95, 0.95, 0.95));
    statue(stoneBatch, m, { headless: v === 1 });
  }

  // Beete mit Buchsbaum-Einfassung und Rosen
  const leaves = new Batch();
  const red = new Batch();
  const white = new Batch();
  const rose = (x: number, z: number, s: number, white_: boolean) => {
    const y = g(x, z);
    for (let k = 0; k < 7; k++) leaves.add(new THREE.IcosahedronGeometry(0.24 * s, 1), [x + (rng() - 0.5) * 0.6 * s, y + 0.25 * s + rng() * 0.45 * s, z + (rng() - 0.5) * 0.6 * s], [rng(), rng(), rng()]);
    for (let k = 0; k < 9; k++) (white_ && rng() < 0.7 ? white : red).add(new THREE.IcosahedronGeometry(0.065, 1), [x + (rng() - 0.5) * 0.7 * s, y + 0.35 * s + rng() * 0.5 * s, z + (rng() - 0.5) * 0.7 * s]);
  };
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x0 = sx * 1.6;
      const x1 = sx * 8;
      const z0 = sz * 6.2;
      const z1 = sz * 12.5;
      const cxm = (x0 + x1) / 2;
      const czm = (z0 + z1) / 2;
      const wX = Math.abs(x1 - x0);
      const wZ = Math.abs(z1 - z0);
      // Einfassung mit Lücke in der Mitte der Wegseite
      b.box(S.hedge, [0.45, 0.6, wZ], [x1, 0.3, czm]);
      b.box(S.hedge, [wX, 0.6, 0.45], [cxm, 0.3, z1]);
      b.box(S.hedge, [wX, 0.6, 0.45], [cxm, 0.3, z0]);
      b.box(S.hedge, [0.45, 0.6, wZ / 2 - 0.6], [x0, 0.3, z0 + (sz * (wZ / 2 - 0.6)) / 2]);
      b.box(S.hedge, [0.45, 0.6, wZ / 2 - 0.6], [x0, 0.3, z1 - (sz * (wZ / 2 - 0.6)) / 2]);
      for (let i = 0; i < 9; i++) rose(cxm + (rng() - 0.5) * (wX - 1.2), czm + (rng() - 0.5) * (wZ - 1.2), 0.9 + rng() * 0.6, sz < 0);
    }
  }
  // Rosen auch am Brunnen und am Haus, wild wuchernd
  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2;
    rose(Math.cos(a) * 3.9, Math.sin(a) * 3.9, 0.7 + rng() * 0.4, true);
  }
  // Hohe, verwilderte Hecken am Rand
  const bumps = new Batch();
  const hedgeWall = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    b.box(S.hedge, [1.4, 2.4, len], [(x0 + x1) / 2, 1.2, (z0 + z1) / 2], [0, yaw, 0]);
    for (let d = 0.5; d < len; d += 0.9 + rng() * 0.6) {
      const u = d / len;
      bumps.add(new THREE.IcosahedronGeometry(0.6 + rng() * 0.5, 1), [x0 + (x1 - x0) * u + (rng() - 0.5) * 0.6, 2.3 + rng() * 0.4, z0 + (z1 - z0) * u + (rng() - 0.5) * 0.6], [rng(), rng(), rng()]);
    }
  };
  hedgeWall(-15, -14, -15, 17);
  hedgeWall(-15, 17, -2.8, 17);
  hedgeWall(2.8, 17, 16, 17);
  hedgeWall(16, 17, 16, 6);
  hedgeWall(16, -9, 16, -14);
  // Tor: Steinpfeiler mit Urnen, ein Flügel offen, einer umgefallen, Bogen mit Schild
  for (const s of [-1, 1]) {
    b.box(S.marble, [0.8, 2.9, 0.8], [s * 2.2, 1.45, 17.3]);
    b.box(S.marble, [0.95, 0.15, 0.95], [s * 2.2, 2.97, 17.3], [0, 0, 0], false);
    b.add(new THREE.CylinderGeometry(0.28, 0.16, 0.4, 12), S.marble, [s * 2.2, 3.25, 17.3], [0, 0, 0], false);
    leaves.add(new THREE.IcosahedronGeometry(0.3, 0), [s * 2.2, 3.5, 17.3]);
  }
  const bars = new Batch();
  const leaf = (ox: number, oz: number, yaw: number, roll: number) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(ox, 0, oz), new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, yaw, 0)), new THREE.Vector3(1, 1, 1));
    const pm = new THREE.Matrix4();
    for (let i = 0; i <= 11; i++) {
      pm.makeTranslation(i * 0.16, 1.15, 0);
      bars.addMatrix(new THREE.CylinderGeometry(0.018, 0.018, 2.2, 4), pm.clone().premultiply(m));
    }
    for (const y of [0.25, 1.9]) {
      pm.compose(new THREE.Vector3(0.88, y, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new THREE.Vector3(1, 1, 1));
      bars.addMatrix(new THREE.CylinderGeometry(0.025, 0.025, 1.8, 4), pm.clone().premultiply(m));
    }
  };
  leaf(-1.75, 17.3, -1.2, 0);
  leaf(0.3, 19.2, 0.4, -Math.PI / 2 + 0.03);
  bars.add(new THREE.TorusGeometry(2.2, 0.035, 5, 24, Math.PI), [0, 2.95, 17.3]);
  bars.build(b, S.iron);
  sign(b, ['Gut Rosenthal', 'Anno 1887'], '#2a3530', '#d8c890', [0, 3.6, 17.3], 0, 0.9);

  // Laubengang aus Eisenbögen über dem Hauptweg, überwuchert von Rosen
  const arches = new Batch();
  for (let i = 0; i < 5; i++) {
    const z = 8.5 + i * 1.6;
    for (const s of [-1, 1]) arches.add(new THREE.CylinderGeometry(0.035, 0.035, 1.7, 5), [s * 1.5, 0.85, z]);
    arches.add(new THREE.TorusGeometry(1.5, 0.035, 5, 18, Math.PI), [0, 1.7, z]);
    for (let k = 0; k < 9; k++) {
      const a = rng() * Math.PI;
      const px = Math.cos(a) * 1.5;
      const py = 1.7 + Math.sin(a) * 1.5;
      for (let l = 0; l < 3; l++) leaves.add(new THREE.IcosahedronGeometry(0.09 + rng() * 0.08, 1), [px + (rng() - 0.5) * 0.3, py + (rng() - 0.5) * 0.25, z + (rng() - 0.5) * 0.5], [rng(), rng(), rng()]);
      if (rng() < 0.7) red.add(new THREE.IcosahedronGeometry(0.06, 1), [px + (rng() - 0.5) * 0.3, py - 0.1, z + (rng() - 0.5) * 0.5]);
    }
  }
  for (const s of [-1, 0, 1]) arches.add(new THREE.CylinderGeometry(0.03, 0.03, 6.4, 4), [s * 1.06, 2.75 + (s ? 0 : 0.45), 11.7], [Math.PI / 2, 0, 0]);
  arches.build(b, S.iron);

  // Bänke und Laternen am Platz
  for (const [x, z, yaw] of [[-4, 2.4, -2.1], [4, -2.4, 1.05]] as V3[]) {
    b.setFrame([x, g(x, z), z], [0, yaw, 0]);
    for (let i = 0; i < 4; i++) b.box(W.wood, [1.6, 0.04, 0.1], [0, 0.45, -0.18 + i * 0.12], [0, 0, 0], i === 0);
    for (let i = 0; i < 3; i++) b.box(W.wood, [1.6, 0.1, 0.03], [0, 0.6 + i * 0.13, -0.27], [-0.12, 0, 0], false);
    for (const s of [-0.75, 0.75]) b.box(S.iron, [0.05, 0.85, 0.5], [s, 0.42, -0.08], [0, 0, 0], false);
    b.setFrame(null);
  }
  const lamp = glow(b, 0xfff0d0, 0xffcf80, 0.05, 3, 0.5);
  for (const [x, z] of [[1.8, 5], [-1.8, 5], [1.8, -5], [-1.8, -5]]) {
    b.cyl(S.iron, 0.06, 0.09, 3, [x, 1.5, z], [0, 0, 0], 8);
    b.box(S.iron, [0.3, 0.05, 0.3], [x, 3.0, z], [0, 0, 0], false);
    b.add(new THREE.CylinderGeometry(0.11, 0.08, 0.3, 6), lamp, [x, 3.2, z], [0, 0, 0], false);
    b.add(new THREE.ConeGeometry(0.2, 0.18, 6), S.iron, [x, 3.42, z], [0, 0, 0], false);
  }
  b.light([1.8, 3.1, 5], 0xffcf80, 5, 13, 'lamp');
  b.light([-1.8, 3.1, -5], 0xffcf80, 5, 13, 'lamp');

  // Glashaus (Orangerie) östlich des Brunnens, Tür nach Westen
  const GX = 11;
  const GZ = -1;
  const GW = 6;
  const GL = 11;
  const frame = new Batch();
  const panes = new Batch();
  b.box(S.brick, [GW, 0.55, 0.3], [GX, 0.27, GZ + GL / 2]);
  b.box(S.brick, [GW, 0.55, 0.3], [GX, 0.27, GZ - GL / 2]);
  b.box(S.brick, [0.3, 0.55, GL], [GX + GW / 2, 0.27, GZ]);
  // Westwand mit Tür zwischen z = GZ − 0.5 und GZ + 1.5
  const d0 = GZ - 0.5;
  const d1 = GZ + 1.5;
  const wallA: [number, number] = [GZ - GL / 2, d0];
  const wallB: [number, number] = [d1, GZ + GL / 2];
  for (const [a, c] of [wallA, wallB]) b.box(S.brick, [0.3, 0.55, c - a], [GX - GW / 2, 0.27, (a + c) / 2]);
  const wallH = 3.2;
  const ridge = 5.2;
  // Längswände (Ost/West) mit Pfosten je 1 m, Scheiben dazwischen (einige fehlen)
  for (const sx of [-1, 1]) {
    const x = GX + sx * (GW / 2);
    for (let i = 0; i <= GL; i++) {
      const z = GZ - GL / 2 + i;
      frame.add(new THREE.BoxGeometry(0.07, wallH, 0.07), [x, wallH / 2, z]);
      // Dachsparren
      strutInto(frame, [x, wallH, z], [GX, ridge, z], 0.035, 4);
      if (i === GL) continue;
      const door = sx < 0 && z >= d0 - 0.01 && z < d1 - 0.01;
      if (!door && rng() > 0.15) panes.add(new THREE.BoxGeometry(0.02, wallH - 0.65 - (rng() < 0.1 ? 1 : 0), 0.92), [x, 0.55 + (wallH - 0.55) / 2, z + 0.5]);
      for (const half of [-1, 1]) {
        if (rng() < 0.12) continue;
        const rx = GX + sx * (GW / 4);
        const ry = (wallH + ridge) / 2;
        panes.add(new THREE.BoxGeometry(Math.hypot(GW / 2, ridge - wallH), 0.02, 0.46), [rx, ry, z + 0.25 + (half + 1) * 0.25], [0, 0, sx * -Math.atan2(ridge - wallH, GW / 2)]);
      }
    }
    if (sx > 0) b.collider([0.15, wallH / 2, GL / 2], [x, wallH / 2, GZ]);
    else for (const [a, c] of [wallA, wallB]) b.collider([0.15, wallH / 2, (c - a) / 2], [x, wallH / 2, (a + c) / 2]);
  }
  for (const sz of [-1, 1]) {
    const z = GZ + sz * (GL / 2);
    b.collider([GW / 2, wallH / 2, 0.15], [GX, wallH / 2, z]);
    for (let i = 0; i <= 6; i++) {
      const x = GX - GW / 2 + i;
      const gable = (gx: number) => wallH + (ridge - wallH) * (1 - Math.abs(gx - GX) / (GW / 2));
      const h = gable(x);
      frame.add(new THREE.BoxGeometry(0.07, h, 0.07), [x, h / 2, z]);
      const ph = Math.min(h, gable(x + 1)) - 0.7;
      if (i < 6) panes.add(new THREE.BoxGeometry(0.92, ph, 0.02), [x + 0.5, 0.55 + ph / 2, z]);
    }
  }
  frame.add(new THREE.BoxGeometry(0.1, 0.1, GL + 0.2), [GX, ridge, GZ]);
  for (const sx of [-1, 1]) frame.add(new THREE.BoxGeometry(0.08, 0.08, GL + 0.1), [GX + sx * (GW / 2), wallH, GZ]);
  frame.build(b, S.iron, true);
  panes.build(b, W.glass);
  // Drinnen: Pflanztische, Töpfe, zwei Palmen, Hängepflanzen und etwas Seltsames, das leuchtet
  const pots = new Batch();
  const greens = new Batch();
  for (const sz of [-1, 1]) {
    const tz = GZ + sz * 2.6;
    b.box(W.woodDark, [1.0, 0.08, 3.6], [GX + 2.1, 0.85, tz]);
    for (const dz of [-1.6, 1.6]) for (const dx of [-0.4, 0.4]) b.box(W.woodDark, [0.06, 0.85, 0.06], [GX + 2.1 + dx, 0.42, tz + dz], [0, 0, 0], false);
    for (let k = 0; k < 6; k++) {
      const pz = tz - 1.5 + k * 0.6;
      pots.add(new THREE.CylinderGeometry(0.15, 0.1, 0.22, 8), [GX + 2.1 + (rng() - 0.5) * 0.4, 1.0, pz]);
      for (let l = 0; l < 3; l++) greens.add(new THREE.IcosahedronGeometry(0.12 + rng() * 0.1, 0), [GX + 2.1 + (rng() - 0.5) * 0.5, 1.2 + rng() * 0.25, pz + (rng() - 0.5) * 0.3]);
    }
  }
  b.container('shelf', [GX + 2.1, 1.1, GZ + 2.6]);
  b.note('rosenthal', [GX + 2.1, 0.9, GZ - 1.2], 1.4);
  for (const [px, pz, h] of [[GX - 0.6, GZ - 3, 3.6], [GX + 0.2, GZ + 3.4, 3.1]]) {
    pots.add(new THREE.CylinderGeometry(0.45, 0.32, 0.6, 10), [px, 0.3, pz]);
    for (let k = 0; k < 6; k++) b.add(new THREE.CylinderGeometry(0.12 - k * 0.01, 0.14 - k * 0.01, h / 6), W.bark, [px + k * 0.02, 0.6 + (k + 0.5) * (h / 6), pz], [0, 0, 0.04], false);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const len = 1.4 + rng() * 0.6;
      b.add(new THREE.PlaneGeometry(0.4, len).translate(0, len / 2, 0), S.palm, [px + 0.12, 0.6 + h, pz], yawPitch(a, 1.1 + rng() * 0.4), false);
    }
  }
  for (let k = 0; k < 14; k++) {
    const vx = GX + (rng() - 0.5) * (GW - 1);
    const vz = GZ + (rng() - 0.5) * (GL - 1);
    const len = 0.8 + rng() * 2;
    greens.add(new THREE.CylinderGeometry(0.02, 0.02, len, 3), [vx, ridge - 0.4 - (Math.abs(vx - GX) / (GW / 2)) * (ridge - wallH) - len / 2, vz]);
    greens.add(new THREE.IcosahedronGeometry(0.1, 0), [vx, ridge - 0.4 - (Math.abs(vx - GX) / (GW / 2)) * (ridge - wallH) - len, vz]);
  }
  for (let k = 0; k < 22; k++) {
    const vx = GX - 1.5 + (rng() - 0.5) * 2;
    const vz = GZ + (rng() - 0.5) * (GL - 1.5);
    greens.add(new THREE.IcosahedronGeometry(0.25 + rng() * 0.3, 0), [vx, 0.25, vz], [rng(), rng(), rng()]);
  }
  pots.build(b, S.pot);
  greens.build(b, S.leaf);
  const podMat = glow(b, 0xe8c8d8, 0xff70b0, 0.25, 3.5, 1.1);
  const sx0 = GX - 1.2;
  const sz0 = GZ + 0.4;
  b.add(new THREE.CylinderGeometry(0.06, 0.1, 1.6, 6), S.leaf, [sx0, 0.8, sz0], [0.15, 0, 0.1], false);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    b.add(new THREE.SphereGeometry(0.16, 10, 8), podMat, [sx0 + Math.cos(a) * 0.3, 1.5 + Math.sin(k * 1.7) * 0.15, sz0 + Math.sin(a) * 0.3], [0, 0, 0], false).scale.set(1, 1.4, 1);
  }
  b.light([sx0, 1.6, sz0], 0xff80c0, 4, 8, 'pulse');
  b.model.sounds.push({ position: b.point([GX, 2, GZ]), sound: 'chime', every: [12, 26], volume: 0.4, when: 'night' });

  // Ausgebrannte Fassade des Herrenhauses mit Fensterhöhlen, Freitreppe und Efeu
  const FZ = -15;
  const FW = 18;
  const FH = 8.5;
  const winX = [-6, -3, 3, 6];
  // Volle Pfeiler zwischen den Öffnungen (Fenster 1,4 m, Tür 2,2 m), oben ausgefranst
  const piers: [number, number][] = [[-9, -6.7], [-5.3, -3.7], [-2.3, -1.1], [1.1, 2.3], [3.7, 5.3], [6.7, 9]];
  for (const [x0, x1] of piers) {
    const top = FH - rng() * 2.2;
    b.box(S.plaster, [x1 - x0, top, 0.6], [(x0 + x1) / 2, top / 2, FZ]);
  }
  for (const wx of winX) {
    b.box(S.plaster, [1.4, 1.2, 0.6], [wx, 0.6, FZ]);
    b.box(S.plaster, [1.4, 1.4, 0.6], [wx, 3.9, FZ]);
    const top = 6.9 + rng() * 1.2;
    b.box(S.plaster, [1.4, top - 6.4, 0.6], [wx, (6.4 + top) / 2, FZ], [0, 0, 0], false);
    for (const wy of [2.2, 5.5]) b.box(M.dark, [1.3, 1.9, 0.1], [wx, wy, FZ - 0.4], [0, 0, 0], false);
  }
  b.box(S.plaster, [2.2, FH - 1.8 - 3.2, 0.6], [0, (3.2 + FH - 1.8) / 2, FZ]);
  b.box(M.dark, [2.1, 3.1, 0.1], [0, 1.55, FZ - 0.4], [0, 0, 0], false);
  for (let i = 0; i < 3; i++) b.box(S.marble, [5 - i * 0.6, 0.2, 0.6], [0, 0.1 + i * 0.2, FZ + 2.2 - i * 0.5]);
  for (const s of [-1, 1]) b.cyl(S.marble, 0.28, 0.3, 4.2, [s * 2.0, 2.1, FZ + 1.9], [0, 0, 0], 12);
  b.box(S.marble, [5.2, 0.35, 2.4], [0, 4.35, FZ + 1.0]);
  // Schwarze Rußspuren über den Fenstern, Efeu auf der Wand
  const soot = new Batch();
  for (const wx of winX) soot.add(new THREE.BoxGeometry(1.4, 1.5, 0.02), [wx, 6.6, FZ + 0.31]);
  soot.build(b, std(0x1a1816, { roughness: 1, transparent: true, opacity: 0.6 }));
  const ivy = new Batch();
  for (let i = 0; i < 70; i++) {
    const x = (rng() - 0.5) * FW;
    const y = rng() < 0.6 ? rng() * 3 : rng() * 7;
    ivy.add(new THREE.IcosahedronGeometry(0.25 + rng() * 0.25, 0), [x, y, FZ + 0.32], [rng(), rng(), rng()], [1, 1, 0.35]);
  }
  ivy.build(b, S.hedge);
  // Schutt hinter und vor der Fassade, verkohlte Balken
  for (let i = 0; i < 26; i++) {
    const x = (rng() - 0.5) * 18;
    const z = FZ - 1 - rng() * 5;
    stoneBatch.add(boulder(0.4 + rng() * 0.7, rng), [x, g(x, z) + 0.2, z], [rng(), rng(), rng()]);
  }
  for (let i = 0; i < 6; i++) {
    const x = (rng() - 0.5) * 14;
    const z = FZ - 1.5 - rng() * 4;
    b.add(new THREE.BoxGeometry(0.25, 0.25, 3 + rng() * 2), std(0x1a1512, { roughness: 1 }), [x, g(x, z) + 0.6, z], [0.5 + rng() * 0.4, rng() * 3, 0], false);
  }
  b.collider([9, 2, 2.5], [0, 2, FZ - 3.5]);
  stoneBatch.build(b, S.marble, true);
  leaves.build(b, S.leaf);
  red.build(b, S.roseRed);
  white.build(b, S.roseWhite);
  bumps.build(b, S.hedge);

  // Glühwürmchen in der Dämmerung
  particles(b, { count: 240, center: [0, 0.3, 2], radius: 17, height: 2.6, color: 0xd8ff70, size: 0.16, rise: 0.05, sway: 1.6, day: 0, night: 1, additive: true });
}

// ---------------------------------------------------------------------------
// Bucht der tausend Lichter
// ---------------------------------------------------------------------------

/** Meeresleuchten: blau glühende Brandung, die in Wellen aufs Ufer zuläuft (nur nachts). */
function glowSurf(b: Builder, water: number): void {
  const g = b.ground;
  const geo = new THREE.PlaneGeometry(64, 46, 128, 92).rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = water - g(pos.getX(i), pos.getZ(i) + 17);
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  const uTime = { value: 0 };
  const uOpacity = { value: 0 };
  b.model.clocks.push(uTime);
  b.model.fades.push({ uniform: uOpacity, day: 0, night: 1 });
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    uniforms: { uTime, uOpacity },
    vertexShader: /* glsl */ `
      attribute float aDepth;
      varying float vDepth;
      varying vec2 vXZ;
      varying vec2 vUv;
      void main() {
        vDepth = aDepth;
        vXZ = position.xz;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uOpacity;
      varying float vDepth;
      varying vec2 vXZ;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        if (vDepth < -0.03 || uOpacity < 0.01) discard;
        float n = noise(vXZ * 0.15);
        // Wellenkämme laufen von der Tiefe aufs Ufer zu (eng gestaffelt, vom Rauschen gebrochen).
        float wave = sin(vDepth * 13.0 - uTime * 1.8 + n * 7.0 + vXZ.x * 0.05);
        float crest = smoothstep(0.55, 1.0, wave) * (1.0 - smoothstep(0.0, 1.8, vDepth)) * (0.6 + 0.4 * noise(vXZ * 0.6 + uTime * 0.2));
        // Saum an der Wasserkante, atmend
        float edge = smoothstep(0.25, 0.0, abs(vDepth - 0.04)) * (0.55 + 0.45 * sin(uTime * 0.7 + vXZ.x * 0.25 + n * 3.0));
        // Runde Funken im flachen Wasser
        vec2 cell = floor(vXZ * 3.0);
        vec2 f = fract(vXZ * 3.0) - 0.5;
        float spark = step(0.975, hash(cell + floor(uTime * 2.0 + hash(cell) * 4.0))) * smoothstep(0.3, 0.0, length(f)) * (1.0 - smoothstep(0.0, 3.0, vDepth));
        // weit draußen ein schwacher Schimmer
        float deep = (1.0 - smoothstep(1.0, 10.0, vDepth)) * 0.16 * noise(vXZ * 0.25 + uTime * 0.08);
        float border = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x) * smoothstep(0.0, 0.12, vUv.y);
        vec3 blue = vec3(0.0, 0.45, 1.0);
        vec3 cyan = vec3(0.2, 0.9, 1.0);
        vec3 col = blue * (deep + edge * 0.5) + cyan * (crest * 0.9 + spark * 0.8);
        gl_FragColor = vec4(col * border * uOpacity, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(b.point([0, water + 0.06, 17]));
  mesh.frustumCulled = false;
  // Nach der (durchsichtigen) Meeresfläche zeichnen, sonst dämpft das Wasser das Leuchten.
  mesh.renderOrder = 2;
  b.group.add(mesh);
}

/** Seestern: flacher Fünfzack. */
function starGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 ? 0.05 : 0.13;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false }).rotateX(-Math.PI / 2);
}

function buildGlowbay(b: Builder, rng: () => number, water: number): void {
  const g = b.ground;
  glowSurf(b, water);
  particles(b, { count: 420, center: [0, water + 0.02, 18], radius: 14, height: 0.12, color: 0x6fe8ff, size: 0.16, rise: 0.02, sway: 0.6, day: 0, night: 1, additive: true, order: 2 });
  // Felsnadeln und ein Felsentor im Meer
  const rocks = new Batch();
  const moss = new Batch();
  const stack = (x: number, z: number, h: number, size: number) => {
    const y0 = Math.min(g(x, z), water - 1.5) - 0.5;
    let y = y0;
    while (y < water + h) {
      const s = size * (0.85 + rng() * 0.3) * (1 - ((y - y0) / (h + 6)) * 0.3);
      rocks.add(boulder(s, rng), [x + (rng() - 0.5) * 0.3, y + s * 1.5, z + (rng() - 0.5) * 0.3], [rng() * 0.2, rng() * 6, rng() * 0.2], [1, 2.4, 1]);
      y += s * 1.35;
    }
    moss.add(boulder(size * 0.75, rng), [x, y + size * 0.15, z], [rng(), rng() * 6, rng()], [1, 0.35, 1]);
    b.collider([size * 0.8, (y - y0) / 2, size * 0.8], [x, (y + y0) / 2, z], [0, 0, 0], false);
  };
  stack(-13, 24, 9, 1.9);
  stack(10, 28, 11, 2.1);
  stack(18, 15, 6, 1.6);
  stack(-4.5, 33, 7.5, 2.0);
  stack(4.5, 33, 7.0, 2.0);
  for (let i = 0; i < 4; i++) rocks.add(boulder(1.7 + rng() * 0.3, rng), [-3.3 + i * 2.2, water + 8.6 + Math.sin((i / 3) * Math.PI) * 0.7, 33], [rng() * 0.2, rng() * 6, rng() * 0.2], [1.5, 0.8, 1.1]);
  for (let i = 0; i < 12; i++) {
    const x = (rng() - 0.5) * 40;
    const z = 6 + rng() * 26;
    rocks.add(boulder(0.5 + rng() * 0.9, rng), [x, Math.min(g(x, z), water) + 0.1, z], [rng(), rng() * 6, rng()]);
  }
  rocks.build(b, S.sandStone, true);
  moss.build(b, W.moss);

  // Strandbude auf kurzen Stelzen, Veranda zum Meer
  const hx = -7;
  const hz = -9;
  const hy = Math.max(g(hx, hz), water + 0.4) + 0.5;
  b.setFrame([hx, hy, hz], [0, 0.2, 0]);
  for (const [sx, sz] of [[-1.6, -1.4], [1.6, -1.4], [-1.6, 1.4], [1.6, 1.4], [-1.6, 2.9], [1.6, 2.9]]) b.cyl(W.woodDark, 0.09, 0.1, 1.4, [sx, -0.6, sz], [0, 0, 0], 6, false);
  b.box(W.wood, [3.4, 0.12, 4.6], [0, 0, 0.7]);
  const stripe = [S.paintBlue, S.paintCream];
  for (let i = 0; i < 7; i++) b.box(stripe[i % 2], [0.49, 2.4, 0.08], [-1.47 + i * 0.49, 1.25, -1.5], [0, 0, 0], i === 3);
  b.collider([1.7, 1.2, 0.05], [0, 1.25, -1.5]);
  for (const s of [-1, 1]) b.box(S.paintCream, [0.08, 2.4, 3.0], [s * 1.66, 1.25, 0]);
  b.box(S.paintBlue, [1.0, 2.4, 0.08], [-1.2, 1.25, 1.5]);
  b.box(S.paintBlue, [1.0, 2.4, 0.08], [1.2, 1.25, 1.5]);
  b.box(S.paintBlue, [1.4, 0.5, 0.08], [0, 2.2, 1.5], [0, 0, 0], false);
  b.box(W.roof, [3.9, 0.1, 5.0], [0, 2.6, 0.6], [0.1, 0, 0], false);
  for (const s of [-1.5, 1.5]) b.cyl(W.woodDark, 0.05, 0.05, 2.3, [s, 1.2, 2.85], [0, 0, 0], 6, false);
  b.box(W.wood, [3.2, 0.06, 0.06], [0, 0.95, 2.95], [0, 0, 0], false);
  b.box(W.wood, [1.0, 0.06, 0.6], [0.8, 0.8, -0.9]);
  b.box(W.wood, [0.06, 0.8, 0.5], [0.8, 0.4, -0.9], [0, 0, 0], false);
  b.note('leuchtbucht', [0.7, 0.84, -0.85], 0.3);
  b.box(M.oldPlanks, [0.8, 0.5, 0.5], [-1.0, 0.31, -0.9]);
  b.container('crate', [-1.0, 0.6, -0.9]);
  b.lantern([0, 2.3, 0]);
  // Surfbrett an der Wand, Windspiel an der Veranda
  b.add(new THREE.CapsuleGeometry(0.28, 1.5, 4, 10), S.board, [1.9, 1.15, 1.1], [0.15, 0, -0.18], false).scale.set(1, 1, 0.14);
  b.add(new THREE.BoxGeometry(0.06, 1.9, 0.05), S.paintCream, [1.92, 1.15, 1.06], [0.15, 0, -0.18], false);
  for (let i = 0; i < 5; i++) b.add(new THREE.CylinderGeometry(0.015, 0.015, 0.3 + i * 0.05, 5), W.bronze, [0.6 + i * 0.07, 2.2 - i * 0.025, 2.8], [0, 0, 0], false);
  b.setFrame(null);
  const porch = new Batch();
  const porchBulbs = new Bulbs();
  const c = Math.cos(0.2);
  const s = Math.sin(0.2);
  const P = (x: number, y: number, z: number): V3 => [hx + x * c + z * s, hy + y, hz - x * s + z * c];
  garland(porch, porchBulbs, P(-1.7, 2.45, 2.95), P(1.7, 2.45, 2.95), 0.25, 0.4);
  porch.build(b, S.wire);
  porchBulbs.build(b, [0xfff0c0, 0x8ad8ff]);
  b.model.sounds.push({ position: b.point(P(0.7, 2.1, 2.8)), sound: 'chime', every: [6, 14], volume: 0.5 });

  // Feuerstelle mit Treibholzbänken, glimmende Glut
  const fx = 2;
  const fz = -5;
  const fy = g(fx, fz);
  const ring = new Batch();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    ring.add(boulder(0.2, rng), [fx + Math.cos(a) * 0.72, fy + 0.08, fz + Math.sin(a) * 0.72], [rng(), rng(), rng()]);
  }
  ring.build(b, W.rockGrey);
  const ember = glow(b, 0x1a1410, 0xff5a1a, 0.02, 2.6, 2.6);
  for (let i = 0; i < 4; i++) b.add(new THREE.CylinderGeometry(0.06, 0.08, 0.9), ember, [fx + (rng() - 0.5) * 0.2, fy + 0.12, fz + (rng() - 0.5) * 0.2], [Math.PI / 2, (i / 4) * Math.PI, 0.2], false);
  b.light([fx, fy + 0.4, fz], 0xff6a20, 3, 6, 'pulse');
  for (const [lx, lz, yaw] of [[fx - 1.8, fz + 0.3, 0.3], [fx + 1.6, fz - 0.9, 1.3]]) {
    b.cyl(S.driftwood, 0.2, 0.24, 2.2, [lx, g(lx, lz) + 0.22, lz], yawPitch(yaw, Math.PI / 2), 8);
  }
  // Umgedrehtes Kanu, Treibholz, Muscheln und Seesterne
  const canoe = new THREE.Mesh(hullGeometry(4.2, 0.9, 0.45), S.paintRed);
  canoe.position.copy(b.point([6.5, g(6.5, -3) + 0.45, -3]));
  canoe.rotation.set(Math.PI, 0.9, 0.08);
  canoe.castShadow = true;
  b.group.add(canoe);
  b.collider([0.45, 0.25, 2.1], [6.5, g(6.5, -3) + 0.25, -3], [0, 0.9, 0]);
  for (let i = 0; i < 7; i++) {
    const x = (rng() - 0.5) * 30;
    const z = -6 + rng() * 6;
    if (g(x, z) < water + 0.1) continue;
    b.cyl(S.driftwood, 0.08 + rng() * 0.08, 0.12 + rng() * 0.08, 1.5 + rng() * 2.5, [x, g(x, z) + 0.1, z], yawPitch(rng() * 3, Math.PI / 2), 7, false);
  }
  const shells = new Batch();
  const stars = new Batch();
  const sgeo = starGeometry();
  for (let i = 0; i < 90; i++) {
    const x = (rng() - 0.5) * 34;
    const z = -6 + rng() * 9;
    const y = g(x, z);
    if (y < water + 0.02) continue;
    if (i % 10 === 0) stars.add(sgeo, [x, y + 0.02, z], [0, rng() * 6, 0]);
    else shells.add(new THREE.SphereGeometry(0.05, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), [x, y, z], [0, rng() * 6, 0], [1, 0.5, 1.3]);
  }
  shells.build(b, S.shell);
  stars.build(b, S.starfish);
  // Schild am Strandaufgang
  const sy = g(-1, -12);
  b.box(W.woodDark, [0.1, 1.7, 0.1], [-1, sy + 0.85, -12]);
  sign(b, ['Leuchtbucht', 'Baden auf eigene Gefahr'], '#e8e0c8', '#1a3a5a', [-1, sy + 1.6, -11.94], 0, 0.9);
  // Nachts zwei kalte Lichtquellen über der Brandung, dazu das Rauschen
  b.light([-6, water + 0.6, 7], 0x40c8ff, 6, 15, 'pulse');
  b.light([6, water + 0.6, 9], 0x40c8ff, 6, 15, 'pulse');
  b.model.sounds.push({ position: new THREE.Vector3(0, water, 6), loop: { freq: 420, q: 0.5, gain: 0.45, range: 50 } });
}

/** Einstieg aus `buildPlace`. `water`: Meereshöhe relativ zum Ursprung des Ortes. */
export function buildSight(kind: PlaceKind, b: Builder, rng: () => number, water: number): void {
  if (kind === 'fair') buildFair(b, rng);
  else if (kind === 'observatory') buildObservatory(b, rng);
  else if (kind === 'bog') buildBog(b, rng);
  else if (kind === 'manor') buildManor(b, rng);
  else if (kind === 'glowbay') buildGlowbay(b, rng, water);
}
