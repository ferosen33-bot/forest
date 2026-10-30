import * as THREE from 'three';
import { texturize } from './SurfaceTextures';
import { injectSeason } from './SeasonShader';
import type { PlaceKind } from './Places';
import { M, type Builder } from './PlaceMeshes';
import { Batch, boulder, glow, particles, W } from './WonderMeshes';
import { along, put, sign, strut, strutInto, yawPitch } from './SightMeshes';

/**
 * Mysteriöse und unheimliche Orte (Meilenstein 55):
 * - **Haus der Puppen**: Werkstatt einer Puppenmacherin; Puppen sitzen im Hof, hängen in den Bäumen,
 *   schaukeln allein – und ihre Köpfe wenden sich einem zu, sobald man wegschaut.
 * - **Der Galgenbaum**: eine riesige tote Eiche mit Schlingen und Strohpuppen, ein Kreis aus Steinen,
 *   Geweih-Totems und Kerzen, ein Altar; nachts glimmen Zeichen im Boden.
 * - **Bunker Elster**: Betonklotz hinter Stacheldraht, Panzertür einen Spalt offen, drinnen Pritschen,
 *   Funkgerät und eine versiegelte Luke im Boden, aus der es nachts klopft.
 * - **Acker der Stummen**: verdorrtes Maisfeld voller Vogelscheuchen, die sich drehen, wenn man nicht
 *   hinsieht; in der Mitte ein Brunnen.
 * - **Der Geisterzug**: entgleister Dampfzug im Wald ohne Strecke; nachts brennt Licht in den Abteilen,
 *   dunkle Fahrgäste wenden die Köpfe, die Lok pfeift.
 * Lokale Koordinaten wie in den anderen Orten (+Z = Blickrichtung).
 */

type V3 = [number, number, number];

export const HORRORS = new Set<PlaceKind>(['dolls', 'gallows', 'bunker', 'scarecrows', 'train']);

const std = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const seasonal = (m: THREE.MeshStandardMaterial, bias = 0) => {
  m.onBeforeCompile = (shader) => injectSeason(shader, { snowBias: bias });
  return m;
};

const H = {
  porcelain: std(0xe8ddd0, { roughness: 0.35 }),
  hair: [0x3a2618, 0xc8a050, 0x1a1412, 0x8a4a22].map((c) => std(c, { roughness: 0.9 })),
  dress: [0x6a8ab8, 0xb85a6a, 0xd8d0b8, 0x4a6a4a].map((c) => std(c, { roughness: 0.9 })),
  shoe: std(0x141414, { roughness: 0.5 }),
  lips: std(0x8a1a1a, { roughness: 0.5 }),
  crack: std(0x1a1210, { roughness: 1 }),
  deadBark: texturize(std(0x3a342e, { roughness: 1 }), 'bark', 0.45),
  burlap: texturize(std(0xa08a62, { roughness: 1 }), 'planks', 0.15),
  straw: seasonal(std(0xc8a858, { roughness: 1 }), 0.3),
  bone: std(0xd6cbb2, { roughness: 0.8 }),
  blood: std(0x3a0606, { roughness: 0.15, metalness: 0.2 }),
  concrete: texturize(seasonal(std(0x8a8880)), 'plaster', 0.55),
  earth: texturize(seasonal(std(0x4a5232, { roughness: 1 }), 0.4), 'forestFloor', 0.6),
  army: std(0x3e4a34, { roughness: 0.8 }),
  armyDark: std(0x2a3226, { roughness: 0.8 }),
  steel: std(0x4a4e50, { metalness: 0.6, roughness: 0.5 }),
  rust: std(0x5a3424, { metalness: 0.3, roughness: 0.85 }),
  hazard: std(0xc8a020, { roughness: 0.6 }),
  mattress: std(0x5a5e4a, { roughness: 1 }),
  stalk: seasonal(std(0x86744e, { roughness: 1 }), 0.4),
  husk: seasonal(std(0x8a7448, { roughness: 1, side: THREE.DoubleSide }), 0.4),
  coat: [0x4a3a2a, 0x2a3446, 0x6a2a24, 0x4a4a44, 0x3a4a2a].map((c) => std(c, { roughness: 1, side: THREE.DoubleSide })),
  black: std(0x050505, { roughness: 1 }),
  loco: std(0x1a1918, { metalness: 0.3, roughness: 0.8 }),
  locoRed: std(0x3e1610, { metalness: 0.2, roughness: 0.85 }),
  brass: std(0x8a6a2a, { metalness: 0.7, roughness: 0.4 }),
  carriage: std(0x2c3a30, { roughness: 0.7 }),
  carriageTrim: std(0x8a7a4a, { metalness: 0.4, roughness: 0.5 }),
  ballast: texturize(std(0x6a665e, { roughness: 1 }), 'sand', 0.5),
  seat: std(0x5a2a24, { roughness: 0.9 }),
};

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

/** Ast mit Verjüngung von a (dick) nach c (dünn). */
function limb(b: Builder, mat: THREE.Material, a: V3, c: V3, r0: number, r1: number, collide = false): void {
  const s = along(a, c);
  b.cyl(mat, r1, r0, s.len, s.mid, s.rot, 7, collide);
}

/** Dreieckiger Giebel (in der XY-Ebene, Spitze oben). */
function gable(width: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false }).translate(0, 0, -0.09);
}

/**
 * Porzellanpuppe. Körper als Gruppe (Ursprung an der Hüfte), Kopf als eigene Gruppe (Ursprung am Hals),
 * damit er als Beobachter direkt unter der Ortsgruppe hängen kann.
 */
function makeDoll(rng: () => number, scale: number, pose: 'sit' | 'hang', eyes: THREE.Material, cracked = false): { body: THREE.Group; head: THREE.Group; neck: number } {
  const body = new THREE.Group();
  const dress = H.dress[Math.floor(rng() * H.dress.length)];
  put(body, new THREE.CylinderGeometry(0.08, 0.2, 0.34, 10), dress, [0, 0.17, 0]);
  put(body, new THREE.SphereGeometry(0.06, 8, 6), H.porcelain, [0, 0.36, 0], [0, 0, 0], false);
  for (const s of [-1, 1]) {
    put(body, new THREE.CylinderGeometry(0.028, 0.025, 0.26, 6), H.porcelain, [s * 0.12, 0.18, 0.02], [0.1, 0, s * 0.18], false);
    if (pose === 'sit') {
      put(body, new THREE.CylinderGeometry(0.033, 0.03, 0.26, 6), H.porcelain, [s * 0.06, 0.02, 0.14], [Math.PI / 2, 0, 0], false);
      put(body, new THREE.CylinderGeometry(0.03, 0.028, 0.24, 6), H.porcelain, [s * 0.06, -0.1, 0.27], [0, 0, 0], false);
      put(body, new THREE.BoxGeometry(0.06, 0.04, 0.1), H.shoe, [s * 0.06, -0.22, 0.29], [0, 0, 0], false);
    } else {
      put(body, new THREE.CylinderGeometry(0.033, 0.028, 0.32, 6), H.porcelain, [s * 0.06, -0.14, 0], [0, 0, s * 0.05], false);
      put(body, new THREE.BoxGeometry(0.06, 0.04, 0.1), H.shoe, [s * 0.06, -0.31, 0.02], [0, 0, 0], false);
    }
  }
  body.scale.setScalar(scale);
  const head = new THREE.Group();
  put(head, new THREE.SphereGeometry(0.11, 14, 10), H.porcelain, [0, 0.1, 0]);
  put(head, new THREE.SphereGeometry(0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), H.hair[Math.floor(rng() * H.hair.length)], [0, 0.11, -0.012], [-0.35, 0, 0], false);
  for (const s of [-1, 1]) {
    // Manchmal fehlt ein Auge.
    if (!(cracked && s > 0)) put(head, new THREE.SphereGeometry(0.019, 8, 6), eyes, [s * 0.04, 0.115, 0.096], [0, 0, 0], false);
  }
  put(head, new THREE.SphereGeometry(0.013, 6, 4), H.lips, [0, 0.058, 0.103], [0, 0, 0], false).scale.set(1.5, 0.7, 0.6);
  if (cracked) {
    put(head, new THREE.BoxGeometry(0.006, 0.12, 0.01), H.crack, [0.035, 0.12, 0.105], [0.2, 0, 0.5], false);
    put(head, new THREE.BoxGeometry(0.005, 0.06, 0.01), H.crack, [0.06, 0.07, 0.098], [0.2, 0, -0.4], false);
    put(head, new THREE.SphereGeometry(0.02, 6, 4), H.black, [0.04, 0.115, 0.093], [0, 0, 0], false);
  }
  head.scale.setScalar(scale);
  return { body, head, neck: 0.38 * scale };
}

/** Puppe sitzend an einer Stelle im Ortsraum: Körper ins Gelände, Kopf als Beobachter. */
function sitDoll(b: Builder, rng: () => number, pos: V3, yaw: number, scale: number, eyes: THREE.Material, cracked = false): void {
  const d = makeDoll(rng, scale, 'sit', eyes, cracked);
  d.body.position.copy(b.point(pos));
  d.body.rotation.y = yaw;
  b.group.add(d.body);
  d.head.position.copy(b.point([pos[0], pos[1] + d.neck, pos[2]]));
  d.head.rotation.y = yaw;
  b.group.add(d.head);
  b.model.watchers.push(d.head);
}

// ---------------------------------------------------------------------------
// Haus der Puppen
// ---------------------------------------------------------------------------

function buildDolls(b: Builder, rng: () => number): void {
  const g = b.ground;
  // Augen: Glas, nachts ein roter Schimmer.
  const eyes = glow(b, 0x0a0a0a, 0xff2010, 0, 1.6, 0.5, { roughness: 0.1, metalness: 0.3 });
  // Häuschen: Wände, Tür nach +Z, Satteldach mit Giebeln
  const HZ = -5;
  b.box(M.oldPlanks, [7, 0.12, 6], [0, 0.06, HZ]);
  b.box(W.wood, [7, 2.8, 0.2], [0, 1.4, HZ - 3]);
  for (const s of [-1, 1]) {
    b.box(W.wood, [0.2, 2.8, 6], [s * 3.5, 1.4, HZ]);
    b.box(W.wood, [2.8, 2.8, 0.2], [s * 2.1, 1.4, HZ + 3]);
    b.add(gable(6.2, 1.8).rotateY(Math.PI / 2), W.wood, [s * 3.5, 2.8, HZ], [0, 0, 0]);
    b.box(W.roof, [7.8, 0.12, 3.8], [0, 3.72, HZ + s * 1.55], [s * 0.54, 0, 0], false);
    // Fenster mit Kreuz, nachts trübes Licht
    b.box(glow(b, 0x2a2418, 0xffb060, 0.02, 0.9, 0.7), [0.9, 0.8, 0.05], [s * 2.1, 1.6, HZ + 3.12], [0, 0, 0], false);
    b.box(W.woodDark, [0.06, 0.85, 0.08], [s * 2.1, 1.6, HZ + 3.14], [0, 0, 0], false);
    b.box(W.woodDark, [0.95, 0.06, 0.08], [s * 2.1, 1.6, HZ + 3.14], [0, 0, 0], false);
  }
  b.box(W.wood, [1.4, 0.7, 0.2], [0, 2.45, HZ + 3], [0, 0, 0], false);
  b.box(W.woodDark, [0.08, 2.1, 1.3], [-0.68, 1.05, HZ + 3.6], [0, 0.6, 0], false);
  b.cyl(W.stone, 0.35, 0.35, 1.6, [2.2, 4.2, HZ - 1.2], [0, 0, 0], 8, false);
  // Werkstatt: Werkbank mit Puppenteilen, Regal voller Köpfe, Schaukelstuhl
  b.box(W.woodDark, [3.2, 0.08, 0.8], [-1.2, 0.92, HZ - 2.4]);
  for (const [x, z] of [[-2.7, -2.7], [0.3, -2.7], [-2.7, -2.1], [0.3, -2.1]]) b.box(W.woodDark, [0.07, 0.9, 0.07], [x, 0.45, HZ + z], [0, 0, 0], false);
  const parts = new Batch();
  for (let i = 0; i < 6; i++) {
    parts.add(new THREE.SphereGeometry(0.1, 10, 8), [-2.4 + i * 0.4, 1.06, HZ - 2.35 + (rng() - 0.5) * 0.2]);
    parts.add(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 6), [-2.2 + i * 0.4, 0.98, HZ - 2.15], [Math.PI / 2, rng() * 3, 0]);
  }
  parts.build(b, H.porcelain);
  b.lantern([-0.4, 2.3, HZ - 2.4]);
  b.note('puppen', [-0.1, 0.97, HZ - 2.25], 0.3);
  const heads = new Batch();
  const shelfEyes = new Batch();
  for (let row = 0; row < 3; row++) {
    const y = 1.0 + row * 0.55;
    b.box(W.woodDark, [0.4, 0.04, 4.2], [3.18, y, HZ], [0, 0, 0], false);
    for (let k = 0; k < 9; k++) {
      const z = HZ - 1.9 + k * 0.47;
      heads.add(new THREE.SphereGeometry(0.1, 10, 8), [3.15, y + 0.12, z]);
      for (const s of [-1, 1]) shelfEyes.add(new THREE.SphereGeometry(0.017, 6, 4), [3.06, y + 0.135, z + s * 0.036]);
    }
  }
  heads.build(b, H.porcelain);
  shelfEyes.build(b, eyes);
  b.box(W.woodDark, [0.4, 1.9, 0.08], [3.18, 0.95, HZ - 2.15], [0, 0, 0], false);
  b.container('shelf', [2.9, 1.1, HZ + 1.6]);
  // Schaukelstuhl mit großer Puppe
  b.setFrame([-2.3, 0.12, HZ + 1.6], [0, 0.5, 0]);
  b.box(W.woodDark, [0.6, 0.05, 0.55], [0, 0.45, 0]);
  b.box(W.woodDark, [0.6, 0.75, 0.05], [0, 0.85, -0.3], [-0.15, 0, 0], false);
  for (const s of [-1, 1]) b.add(new THREE.TorusGeometry(0.6, 0.025, 4, 12, 1.2), W.woodDark, [s * 0.28, 0.62, 0.05], [0, Math.PI / 2, Math.PI + 0.95], false);
  b.setFrame(null);
  sitDoll(b, rng, b.point([-2.3, 0.6, HZ + 1.6]).toArray() as V3, 0.5, 1.4, eyes);

  // Im Hof: Stühle in einer Reihe, auf jedem eine Puppe, alle zur Tür gewandt
  for (let i = 0; i < 6; i++) {
    const x = -4 + i * 1.6;
    const z = 3 + Math.sin(i * 1.3) * 0.5;
    const y = g(x, z);
    b.setFrame([x, y, z], [0, Math.PI + (rng() - 0.5) * 0.2, 0]);
    b.box(W.wood, [0.45, 0.04, 0.42], [0, 0.45, 0], [0, 0, 0], false);
    b.box(W.wood, [0.45, 0.5, 0.04], [0, 0.72, -0.2], [0, 0, 0], false);
    for (const [sx, sz] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]]) b.box(W.wood, [0.04, 0.45, 0.04], [sx, 0.22, sz], [0, 0, 0], false);
    b.collider([0.25, 0.4, 0.25], [0, 0.4, 0]);
    const seat = b.point([0, 0.47, 0.02]).toArray() as V3;
    b.setFrame(null);
    sitDoll(b, rng, seat, Math.PI, 1, eyes, i === 3);
  }
  // Die große Puppe an der Hauswand, mit gesprungenem Gesicht
  sitDoll(b, rng, [-2.6, 0.62, HZ + 3.7], 0.15, 2.6, eyes, true);
  b.collider([0.5, 0.7, 0.5], [-2.6, 0.7, HZ + 3.9]);

  // Tote Bäume mit hängenden Puppen
  for (const [tx, tz, ty] of [[-6.5, 6.5, 0.4], [6.8, 5.5, 2.1]] as V3[]) {
    const y = g(tx, tz);
    limb(b, H.deadBark, [tx, y - 0.2, tz], [tx + 0.3, y + 5.5, tz - 0.2], 0.35, 0.12, true);
    for (let k = 0; k < 4; k++) {
      const a = ty + (k / 4) * Math.PI * 2;
      const by = y + 2.6 + k * 0.6;
      const end: V3 = [tx + Math.cos(a) * 2.4, by + 0.8, tz + Math.sin(a) * 2.4];
      limb(b, H.deadBark, [tx + 0.1, by, tz], end, 0.12, 0.04);
      if (k === 3) continue;
      const hx = tx + Math.cos(a) * 1.6;
      const hz = tz + Math.sin(a) * 1.6;
      const hy = by + 0.55;
      const hang = new THREE.Group();
      const len = 0.8 + rng() * 0.8;
      put(hang, new THREE.CylinderGeometry(0.005, 0.005, len, 3), M.rope, [0, -len / 2, 0], [0, 0, 0], false);
      const d = makeDoll(rng, 0.9, 'hang', eyes);
      d.head.position.set(0, -len - 0.24 * 0.9, 0);
      d.head.rotation.x = 0.5;
      d.body.position.set(0, -len - 0.24 * 0.9 - 0.36 * 0.9, 0);
      hang.add(d.body, d.head);
      const hp = b.point([hx, hy, hz]);
      hang.position.copy(hp);
      hang.rotation.y = rng() * 6;
      b.group.add(hang);
      b.model.bobbers.push({ object: hang, base: hp.clone(), amp: 0, speed: 0.5 + rng() * 0.4, roll: 0.08 });
    }
  }
  // Schaukel, auf der eine Puppe allein schaukelt
  const sx = 5.5;
  const sz = -0.5;
  const sy = g(sx, sz);
  for (const s of [-1, 1]) {
    strut(b, W.woodDark, [sx - 0.9, sy, sz + s * 1.2], [sx, sy + 2.5, sz + s * 1.1], 0.06, true);
    strut(b, W.woodDark, [sx + 0.9, sy, sz + s * 1.2], [sx, sy + 2.5, sz + s * 1.1], 0.06);
  }
  b.cyl(W.woodDark, 0.06, 0.06, 2.4, [sx, sy + 2.5, sz], [Math.PI / 2, 0, 0], 6, false);
  const swing = new THREE.Group();
  for (const s of [-0.28, 0.28]) put(swing, new THREE.CylinderGeometry(0.01, 0.01, 1.9, 3), M.rope, [0, -0.95, s], [0, 0, 0], false);
  put(swing, new THREE.BoxGeometry(0.35, 0.04, 0.7), W.wood, [0, -1.9, 0]);
  const sd = makeDoll(rng, 1, 'sit', eyes);
  sd.body.position.set(0, -1.86, 0);
  sd.body.rotation.y = Math.PI / 2;
  sd.head.position.set(0, -1.86 + sd.neck, 0);
  sd.head.rotation.set(0.25, Math.PI / 2, 0);
  swing.add(sd.body, sd.head);
  swing.rotation.y = Math.PI / 2;
  const swp = b.point([sx, sy + 2.5, sz]);
  swing.position.copy(swp);
  b.group.add(swing);
  b.model.bobbers.push({ object: swing, base: swp.clone(), amp: 0, speed: 1.6, roll: 0.32 });
  b.model.sounds.push({ position: swp.clone(), sound: 'creak', every: [3, 6], volume: 0.3 });

  // Lattenzaun ringsum mit Tor nach +Z
  const pickets = new Batch();
  const rails = new Batch();
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    for (let d = 0; d < len; d += 0.22) {
      if (rng() < 0.06) continue;
      const u = d / len;
      const x = x0 + (x1 - x0) * u;
      const z = z0 + (z1 - z0) * u;
      const h = 1.0 + (rng() - 0.5) * 0.15;
      pickets.add(new THREE.BoxGeometry(0.09, h, 0.025), [x, g(x, z) + h / 2, z], [rng() * 0.08 - 0.04, yaw + Math.PI / 2, rng() * 0.1 - 0.05]);
    }
    for (const y of [0.3, 0.8]) rails.add(new THREE.BoxGeometry(0.05, 0.07, len), [(x0 + x1) / 2, g((x0 + x1) / 2, (z0 + z1) / 2) + y, (z0 + z1) / 2], [0, yaw, 0]);
    b.collider([0.05, 0.5, len / 2], [(x0 + x1) / 2, g((x0 + x1) / 2, (z0 + z1) / 2) + 0.5, (z0 + z1) / 2], [0, yaw, 0]);
  };
  fence(-9, -10, 9, -10);
  fence(-9, -10, -9, 11);
  fence(9, -10, 9, 11);
  fence(-9, 11, -1.2, 11);
  fence(1.2, 11, 9, 11);
  pickets.build(b, H.dress[2]);
  rails.build(b, W.woodDark);
  sign(b, ['Puppenklinik', 'Reparaturen aller Art'], '#e8dcd0', '#5a1a2a', [0, 2.0, 11.05], 0, 0.9);
  for (const s of [-1, 1]) b.box(W.woodDark, [0.12, 2.3, 0.12], [s * 1.3, g(s * 1.3, 11) + 1.15, 11]);

  b.light([0, 1.8, HZ + 1], 0xffa050, 3, 8, 'flicker');
  b.model.sounds.push({ position: new THREE.Vector3(0, 1.5, HZ), sound: 'musicbox', every: [40, 80], volume: 0.5, when: 'night' });
  b.model.sounds.push({ position: new THREE.Vector3(0, 1, 3), sound: 'whisper', every: [12, 26], volume: 0.5, when: 'night' });
  particles(b, { count: 70, center: [0, 0.1, 0], radius: 14, height: 1.6, color: 0xc8c8c0, size: 6, rise: 0.02, sway: 2, day: 0.08, night: 0.25 });
}

// ---------------------------------------------------------------------------
// Der Galgenbaum
// ---------------------------------------------------------------------------

/** Strohpuppe am Strick: Sackkopf, Körper aus Sackleinen, Stroh an Armen und Beinen. */
function effigy(group: THREE.Object3D, y: number): void {
  put(group, new THREE.SphereGeometry(0.17, 10, 8), H.burlap, [0, y, 0]).scale.set(1, 1.15, 0.95);
  put(group, new THREE.TorusGeometry(0.08, 0.025, 4, 10), M.rope, [0, y - 0.17, 0], [Math.PI / 2, 0, 0], false);
  put(group, new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8), H.burlap, [0, y - 0.6, 0]);
  for (const s of [-1, 1]) {
    put(group, new THREE.ConeGeometry(0.06, 0.55, 5), H.straw, [s * 0.22, y - 0.55, 0], [0, 0, s * 0.25 + Math.PI], false);
    put(group, new THREE.ConeGeometry(0.07, 0.6, 5), H.straw, [s * 0.08, y - 1.18, 0], [0, 0, Math.PI + s * 0.08], false);
  }
  for (const s of [-1, 1]) put(group, new THREE.BoxGeometry(0.035, 0.035, 0.02), H.black, [s * 0.06, y + 0.03, 0.155], [0, 0, 0.785], false);
}

function buildGallows(b: Builder, rng: () => number): void {
  const g = b.ground;
  // Stamm aus verdrehten Abschnitten, Wurzeln, Hauptäste
  let prev: V3 = [0, -0.3, 0];
  const radii = [1.25, 1.0, 0.8, 0.62, 0.48];
  for (let i = 1; i < radii.length; i++) {
    const next: V3 = [Math.sin(i * 1.7) * 0.35, i * 2.0, Math.cos(i * 1.3) * 0.3];
    limb(b, H.deadBark, prev, next, radii[i - 1], radii[i], i === 1);
    prev = next;
  }
  b.collider([0.9, 4, 0.9], [0, 4, 0], [0, 0, 0], true);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng() * 0.3;
    const len = 2.6 + rng() * 1.6;
    limb(b, H.deadBark, [Math.cos(a) * 0.6, 0.5, Math.sin(a) * 0.6], [Math.cos(a) * len, -0.35, Math.sin(a) * len], 0.42, 0.08);
  }
  const hangs: V3[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    const by = 4.2 + (i % 3) * 1.1;
    const len = 4.2 + rng() * 2;
    const base: V3 = [Math.sin(by * 0.85) * 0.3, by, Math.cos(by * 0.65) * 0.25];
    const end: V3 = [Math.cos(a) * len, by + 1.6 + rng() * 1.2, Math.sin(a) * len];
    limb(b, H.deadBark, base, end, 0.36, 0.08);
    // Zweige
    for (let k = 0; k < 2; k++) {
      const u = 0.45 + k * 0.3;
      const p: V3 = [base[0] + (end[0] - base[0]) * u, base[1] + (end[1] - base[1]) * u, base[2] + (end[2] - base[2]) * u];
      const ta = a + (k ? 0.7 : -0.7);
      limb(b, H.deadBark, p, [p[0] + Math.cos(ta) * 1.6, p[1] + 1.1, p[2] + Math.sin(ta) * 1.6], 0.12, 0.03);
    }
    const u = 0.68;
    hangs.push([base[0] + (end[0] - base[0]) * u, base[1] + (end[1] - base[1]) * u - 0.15, base[2] + (end[2] - base[2]) * u]);
  }
  // Schlingen (zwei mit Strohpuppen), schwingen leicht im Wind
  hangs.forEach((h, i) => {
    const grp = new THREE.Group();
    const len = 2.2 + rng() * 1.2;
    put(grp, new THREE.CylinderGeometry(0.018, 0.018, len, 4), M.rope, [0, -len / 2, 0], [0, 0, 0], false);
    if (i === 1 || i === 4) effigy(grp, -len - 0.1);
    else put(grp, new THREE.TorusGeometry(0.16, 0.022, 4, 12), M.rope, [0, -len - 0.14, 0], [0, 0, 0], false);
    const p = b.point(h);
    grp.position.copy(p);
    grp.rotation.y = rng() * 6;
    b.group.add(grp);
    b.model.bobbers.push({ object: grp, base: p.clone(), amp: 0, speed: 0.4 + rng() * 0.5, roll: 0.05 + rng() * 0.05 });
  });
  // Steinkreis mit Kerzen
  const stones = new Batch();
  const flame = glow(b, 0xffe0a0, 0xffa040, 0.5, 4, 6.5);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const x = Math.cos(a) * 7.6;
    const z = Math.sin(a) * 7.6;
    const h = 0.7 + rng() * 0.6;
    stones.add(boulder(0.5, rng), [x, g(x, z) + h * 0.45, z], [rng() * 0.2, rng() * 6, rng() * 0.2], [0.8, h * 1.6, 0.6]);
    b.collider([0.35, h / 2, 0.35], [x, g(x, z) + h / 2, z]);
    if (i % 2 === 0) {
      b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), H.bone, [x, g(x, z) + h * 0.95 + 0.08, z], [0, 0, 0], false);
      b.add(new THREE.SphereGeometry(0.02, 6, 4), flame, [x, g(x, z) + h * 0.95 + 0.19, z], [0, 0, 0], false).scale.set(1, 1.8, 1);
    }
  }
  stones.build(b, W.rockGrey, true);
  // Geweih-Totems
  const antlers = new Batch();
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const x = Math.cos(a) * 9.5;
    const z = Math.sin(a) * 9.5;
    const y = g(x, z);
    b.cyl(W.woodDark, 0.06, 0.08, 2.7, [x, y + 1.35, z], [0, 0, 0], 6);
    b.box(W.woodDark, [1.1, 0.06, 0.06], [x, y + 2.1, z], [0, -a + Math.PI / 2, 0], false);
    b.add(new THREE.SphereGeometry(0.15, 10, 8), H.bone, [x, y + 2.75, z], [0, 0, 0], false).scale.set(0.9, 1, 1.2);
    for (const s of [-1, 1]) {
      const root: V3 = [x + Math.cos(a + Math.PI / 2) * s * 0.08, y + 2.85, z + Math.sin(a + Math.PI / 2) * s * 0.08];
      const tip: V3 = [root[0] + Math.cos(a + Math.PI / 2) * s * 0.6, root[1] + 0.7, root[2] + Math.sin(a + Math.PI / 2) * s * 0.6];
      strutInto(antlers, root, tip, 0.025);
      for (let k = 1; k <= 2; k++) {
        const p: V3 = [root[0] + (tip[0] - root[0]) * k * 0.35, root[1] + (tip[1] - root[1]) * k * 0.35, root[2] + (tip[2] - root[2]) * k * 0.35];
        strutInto(antlers, p, [p[0] - Math.cos(a) * 0.1, p[1] + 0.35, p[2] - Math.sin(a) * 0.1], 0.018);
      }
    }
    for (let k = 0; k < 3; k++) antlers.add(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 4), [x + (k - 1) * 0.3, y + 1.85, z], [0, 0, 0]);
  }
  antlers.build(b, H.bone);
  // Altar: Steinplatte auf zwei Blöcken, Schale mit dunkler Flüssigkeit, Knochen, Kerzen
  const az = 4.4;
  for (const s of [-1, 1]) b.box(W.stone, [0.4, 0.7, 0.6], [s * 0.6, 0.35, az]);
  b.box(W.stone, [1.8, 0.18, 0.85], [0, 0.79, az]);
  b.add(new THREE.CylinderGeometry(0.2, 0.14, 0.12, 14), W.bronze, [0, 0.94, az], [0, 0, 0], false);
  b.add(new THREE.CircleGeometry(0.18, 14).rotateX(-Math.PI / 2), H.blood, [0, 0.99, az], [0, 0, 0], false);
  for (let i = 0; i < 4; i++) b.add(new THREE.CylinderGeometry(0.018, 0.022, 0.3, 5), H.bone, [-0.5 + i * 0.12, 0.9, az + 0.2], [Math.PI / 2, rng() * 2, 0], false);
  b.add(new THREE.SphereGeometry(0.11, 10, 8), H.bone, [0.6, 0.98, az - 0.1], [0, 0, 0], false).scale.set(1, 0.9, 1.25);
  for (const [cx, h] of [[-0.75, 0.22], [0.75, 0.3], [0.35, 0.15]]) {
    b.add(new THREE.CylinderGeometry(0.035, 0.035, h, 8), H.bone, [cx, 0.88 + h / 2, az - 0.25], [0, 0, 0], false);
    b.add(new THREE.SphereGeometry(0.025, 6, 4), flame, [cx, 0.88 + h + 0.04, az - 0.25], [0, 0, 0], false).scale.set(1, 1.8, 1);
  }
  b.note('galgen', [-0.3, 0.885, az + 0.15], 0.2);
  b.box(W.woodDark, [0.8, 0.5, 0.5], [1.7, 0.25, az + 0.6], [0, 0.3, 0]);
  b.container('sacristy', [1.7, 0.6, az + 0.6]);
  // Zeichen im Boden: zwei Ringe und Runenstriche, nachts rot glimmend
  const runeMat = glow(b, 0x1a0806, 0xff2010, 0, 2.4, 0.9);
  const runes = new Batch();
  runes.add(new THREE.RingGeometry(5.7, 5.85, 64).rotateX(-Math.PI / 2), [0, 0.04, 0]);
  runes.add(new THREE.RingGeometry(3.4, 3.52, 48).rotateX(-Math.PI / 2), [0, 0.04, 0]);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 4.6;
    runes.add(new THREE.PlaneGeometry(0.08, 0.7).rotateX(-Math.PI / 2), [Math.cos(a) * r, 0.045, Math.sin(a) * r], [0, -a + (i % 2 ? 0.5 : -0.3), 0]);
    if (i % 3 === 0) runes.add(new THREE.PlaneGeometry(0.06, 0.4).rotateX(-Math.PI / 2), [Math.cos(a + 0.08) * r, 0.045, Math.sin(a + 0.08) * r], [0, -a + 1.4, 0]);
  }
  runes.build(b, runeMat);
  b.light([0, 1.6, az], 0xff2a10, 5, 12, 'flicker');
  b.light([0, 2.0, -4], 0xffa040, 3, 8, 'lamp');
  particles(b, { count: 90, center: [0, 0.1, 0], radius: 14, height: 2, color: 0x8a7070, size: 6, rise: 0.02, sway: 2, day: 0.1, night: 0.3 });
  b.model.sounds.push({ position: new THREE.Vector3(0, 5, 0), sound: 'creak', every: [4, 9], volume: 0.5 });
  b.model.sounds.push({ position: new THREE.Vector3(0, 6, 0), sound: 'crow', every: [8, 18], volume: 0.7, when: 'day' });
  b.model.sounds.push({ position: new THREE.Vector3(0, 1, 0), sound: 'whisper', every: [10, 24], volume: 0.55, when: 'night' });
  b.model.sounds.push({ position: new THREE.Vector3(0, 1, -12), sound: 'drum', every: [30, 60], volume: 0.5, when: 'night' });
}

// ---------------------------------------------------------------------------
// Bunker Elster
// ---------------------------------------------------------------------------

function buildBunker(b: Builder, rng: () => number): void {
  const g = b.ground;
  // Betonklotz (außen 9 × 11 m), Eingang nach +Z
  b.box(H.concrete, [9, 3.6, 0.5], [0, 1.8, -5.75]);
  for (const s of [-1, 1]) {
    b.box(H.concrete, [0.5, 3.6, 11], [s * 4.25, 1.8, -0.5]);
    b.box(H.concrete, [3.75, 3.6, 0.5], [s * 2.625, 1.8, 4.75]);
  }
  b.box(H.concrete, [1.5, 1.0, 0.5], [0, 3.1, 4.75], [0, 0, 0], false);
  b.box(H.concrete, [9.8, 0.6, 11.8], [0, 3.9, -0.5]);
  b.box(H.concrete, [8, 0.1, 10.5], [0, 0.05, -0.5]);
  // Erdwälle an den Seiten und hinten, Moos auf dem Dach
  const mound = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const [x, z, sx, sy, sz] of [[-6.5, -1, 2.4, 3.2, 6.5], [6.5, -1, 2.4, 3.2, 6.5], [0, -8.1, 6, 3.0, 2.4]]) b.add(mound, H.earth, [x, -0.1, z], [0, 0, 0], false).scale.set(sx, sy, sz);
  for (let i = 0; i < 10; i++) b.add(mound, W.moss, [(rng() - 0.5) * 8, 4.15, -0.5 + (rng() - 0.5) * 10], [0, rng() * 6, 0], false).scale.set(0.8 + rng(), 0.25, 0.8 + rng());
  // Panzertür, weit genug offen, um durchzuschlüpfen
  const doorYaw = 1.25;
  const hinge = new THREE.Vector3(0.75, 1.3, 5.05);
  const dc = hinge.clone().add(new THREE.Vector3(-0.75, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), doorYaw));
  b.box(H.steel, [1.5, 2.6, 0.22], dc.toArray() as V3, [0, doorYaw, 0]);
  b.add(new THREE.TorusGeometry(0.28, 0.035, 6, 16), H.steel, dc.clone().add(new THREE.Vector3(0, 0, 0.14).applyAxisAngle(new THREE.Vector3(0, 1, 0), doorYaw)).toArray() as V3, [0, doorYaw, 0], false);
  // Lampe über dem Eingang, flackert und brummt
  b.box(H.steel, [0.35, 0.2, 0.25], [0, 3.05, 5.15], [0, 0, 0], false);
  b.add(new THREE.SphereGeometry(0.1, 10, 8), glow(b, 0xfff0d0, 0xfff0d0, 0.3, 3.5, 4), [0, 2.92, 5.2], [0, 0, 0], false);
  b.light([0, 2.8, 5.6], 0xfff0d0, 6, 12, 'flicker');
  b.model.sounds.push({ position: b.point([0, 3, 5.2]), sound: 'buzz', every: [2.5, 5], volume: 0.35 });
  // Schild über der Tür
  sign(b, ['OBJEKT ELSTER', 'Zutritt nur mit Befehl'], '#c8b030', '#141414', [0, 3.55, 5.02], 0, 1.0);

  // Drinnen: Pritschen, Tisch mit Funkgerät, Spinde, Gasmasken, versiegelte Luke
  for (const z of [-4, -1.4]) {
    for (const [sx, sz] of [[-3.75, -1], [-2.85, -1], [-3.75, 1], [-2.85, 1]]) b.box(H.steel, [0.06, 2.1, 0.06], [sx, 1.05, z + sz], [0, 0, 0], false);
    for (const y of [0.5, 1.6]) {
      b.box(H.steel, [0.95, 0.06, 2.05], [-3.3, y, z]);
      b.box(H.mattress, [0.85, 0.12, 1.9], [-3.3, y + 0.09, z], [0, 0, 0], false);
    }
  }
  b.setFrame([1.4, 0.1, -1.4], [0, 0.1, 0]);
  b.box(H.army, [1.8, 0.06, 1.0], [0, 0.8, 0]);
  for (const [sx, sz] of [[-0.8, -0.42], [0.8, -0.42], [-0.8, 0.42], [0.8, 0.42]]) b.box(H.steel, [0.05, 0.8, 0.05], [sx, 0.4, sz], [0, 0, 0], false);
  b.box(H.armyDark, [0.6, 0.35, 0.35], [-0.45, 1.0, -0.2], [0, 0, 0], false);
  b.add(new THREE.PlaneGeometry(0.4, 0.2), glow(b, 0x0a1a0a, 0x40ff60, 0.6, 1.4, 2.2), [-0.45, 1.02, -0.02], [0, 0, 0], false);
  b.add(new THREE.PlaneGeometry(0.8, 0.6), std(0xc8c0a0, { side: THREE.DoubleSide }), [0.35, 0.835, 0.05], [-Math.PI / 2, 0, 0.15], false);
  b.note('bunker', [0.55, 0.84, 0.25], 0.2);
  b.setFrame(null);
  for (const z of [1.6, 2.2, 2.8]) b.box(H.army, [0.5, 1.9, 0.55], [3.65, 0.95, z]);
  b.container('locker', [3.3, 1.1, 2.2]);
  b.box(H.armyDark, [0.9, 0.45, 0.5], [2.8, 0.32, -4.9]);
  b.container('crate', [2.8, 0.7, -4.9]);
  for (let i = 0; i < 4; i++) {
    const z = 3.6 - i * 0.45;
    b.add(new THREE.SphereGeometry(0.11, 10, 8), H.black, [-3.88, 1.75, z], [0, 0, 0], false).scale.set(0.6, 1.1, 1);
    b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), H.armyDark, [-3.78, 1.65, z], [0, 0, Math.PI / 2 - 0.4], false);
  }
  // Luke im Boden, mit Klebeband versiegelt
  const hz = -4.3;
  b.add(new THREE.CylinderGeometry(0.7, 0.7, 0.08, 24), H.steel, [0, 0.14, hz], [0, 0, 0], false);
  b.add(new THREE.TorusGeometry(0.28, 0.035, 6, 16), H.steel, [0, 0.22, hz], [Math.PI / 2, 0, 0], false);
  for (const a of [0.6, -0.6]) b.box(H.hazard, [1.5, 0.01, 0.12], [0, 0.19, hz], [0, a, 0], false);
  sign(b, ['NICHT ÖFFNEN', 'Befehl 7/3'], '#c8b030', '#141414', [0, 2.0, -5.48], 0, 0.9);
  b.add(new THREE.SphereGeometry(0.09, 10, 8), glow(b, 0x300000, 0xff1810, 1.0, 3, 5), [0, 3.2, -5.4], [0, 0, 0], false);
  b.light([0, 2.9, -4.6], 0xff1810, 6, 10, 'flicker');
  b.add(new THREE.SphereGeometry(0.12, 10, 8), glow(b, 0xe0e8ff, 0xd8e0ff, 0.4, 2.5, 6), [0, 3.4, 0.5], [0, 0, 0], false);
  b.light([0, 3.2, 0.5], 0xd8e0ff, 4, 10, 'flicker');
  b.model.sounds.push({ position: new THREE.Vector3(0, 0.3, hz), sound: 'pound', every: [14, 30], volume: 0.85, when: 'night' });
  b.model.sounds.push({ position: new THREE.Vector3(0, 1.5, -2), loop: { freq: 55, q: 4, gain: 0.35, range: 14 } });
  // Lüftungsrohre, Antenne auf dem Dach
  for (const [x, z] of [[-2.5, -3], [2.6, 1.5]]) {
    b.cyl(H.rust, 0.18, 0.18, 1.3, [x, 4.85, z], [0, 0, 0], 10, false);
    b.add(new THREE.ConeGeometry(0.32, 0.25, 10), H.rust, [x, 5.6, z], [0, 0, 0], false);
  }
  b.cyl(H.steel, 0.03, 0.05, 5, [3.6, 6.7, -4.8], [0, 0, 0], 6, false);
  // Sandsäcke, Fässer
  const bags = new Batch();
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 6 - row; k++) bags.add(new THREE.CapsuleGeometry(0.2, 0.45, 3, 8), [2.2 + k * 0.62 + row * 0.31, g(2.2, 7.5) + 0.18 + row * 0.33, 7.5], [0, 0, Math.PI / 2], [1, 1, 0.75]);
  }
  bags.build(b, H.burlap, true);
  b.collider([1.9, 0.5, 0.3], [3.75, g(3.75, 7.5) + 0.5, 7.5]);
  for (const [x, z, tip] of [[-3, 7.2, 0], [-3.7, 6.6, 0], [-5.5, 8.5, 1]]) {
    if (tip) b.cyl(H.rust, 0.3, 0.3, 0.9, [x, g(x, z) + 0.3, z], [Math.PI / 2, 0.6, 0], 12);
    else b.cyl(H.rust, 0.3, 0.3, 0.9, [x, g(x, z) + 0.45, z], [0, 0, 0], 12);
  }
  // Zaun mit Stacheldraht und Natodraht, Tor offen
  const posts = new Batch();
  const wires = new Batch();
  const coils = new Batch();
  const fenceLine = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 2.5));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const z = z0 + ((z1 - z0) * i) / n;
      posts.add(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 6), [x, g(x, z) + 1.15, z], [(rng() - 0.5) * 0.06, 0, (rng() - 0.5) * 0.06]);
    }
    for (const y of [0.5, 1.1, 1.7, 2.2]) strutInto(wires, [x0, g(x0, z0) + y, z0], [x1, g(x1, z1) + y, z1], 0.008, 3);
    for (let d = 0; d < len; d += 0.3) {
      const u = d / len;
      const x = x0 + (x1 - x0) * u;
      const z = z0 + (z1 - z0) * u;
      coils.add(new THREE.TorusGeometry(0.22, 0.008, 3, 10), [x, g(x, z) + 2.45, z], [0, yaw + 0.25, 0]);
    }
    b.collider([0.05, 1.2, len / 2], [(x0 + x1) / 2, g((x0 + x1) / 2, (z0 + z1) / 2) + 1.2, (z0 + z1) / 2], [0, yaw, 0]);
  };
  fenceLine(-11, -11, 11, -11);
  fenceLine(-11, -11, -11, 12);
  fenceLine(11, -11, 11, 12);
  fenceLine(-11, 12, -2, 12);
  fenceLine(2, 12, 11, 12);
  posts.build(b, H.steel, true);
  wires.build(b, H.steel);
  coils.build(b, H.steel);
  b.box(H.steel, [2.2, 0.06, 0.06], [-1, g(-1, 13.8) + 0.05, 13.8], [0, 0.4, 0], false);
  for (const y of [0.5, 1.2, 1.9]) b.box(H.steel, [2.2, 0.04, 0.04], [-1 + y * 0.02, g(-1, 13.8) + 0.06, 13.8 - 0.7 + y * 0.6], [0, 0.4, 0], false);
  sign(b, ['SPERRGEBIET', 'Betreten verboten · Schusswaffengebrauch'], '#c8b030', '#141414', [-2.6, g(-2.6, 12.05) + 1.5, 12.05], 0, 1.0);
  sign(b, ['SPERRGEBIET', 'Betreten verboten · Schusswaffengebrauch'], '#c8b030', '#141414', [2.6, g(2.6, 12.05) + 1.5, 12.05], 0, 1.0);
}

// ---------------------------------------------------------------------------
// Acker der Stummen
// ---------------------------------------------------------------------------

function scarecrow(b: Builder, rng: () => number, x: number, z: number): void {
  const g = b.ground;
  const grp = new THREE.Group();
  const wood = new Batch();
  const coat = new Batch();
  const head = new Batch();
  const straw = new Batch();
  const dark = new Batch();
  wood.add(new THREE.CylinderGeometry(0.05, 0.06, 2.8, 6), [0, 1.1, 0]);
  wood.add(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6), [0, 1.85, 0], [0, 0, Math.PI / 2 + (rng() - 0.5) * 0.15]);
  coat.add(new THREE.BoxGeometry(0.55, 0.7, 0.28), [0, 1.55, 0]);
  coat.add(new THREE.CylinderGeometry(0.26, 0.4, 0.65, 7, 1, true), [0, 0.95, 0], [0, rng(), 0]);
  for (const s of [-1, 1]) {
    coat.add(new THREE.CylinderGeometry(0.09, 0.11, 0.55, 6, 1, true), [s * 0.5, 1.84, 0], [0, 0, Math.PI / 2]);
    straw.add(new THREE.ConeGeometry(0.08, 0.3, 5), [s * 0.88, 1.84, 0], [0, 0, -s * Math.PI / 2]);
    straw.add(new THREE.ConeGeometry(0.05, 0.25, 5), [s * 0.1, 0.55, 0], [Math.PI, 0, s * 0.2]);
  }
  head.add(new THREE.SphereGeometry(0.21, 12, 10), [0, 2.22, 0], [0, 0, 0], [1, 1.15, 0.95]);
  straw.add(new THREE.ConeGeometry(0.12, 0.18, 6), [0, 2.0, 0], [Math.PI, 0, 0]);
  for (const s of [-1, 1]) dark.add(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10), [s * 0.075, 2.27, 0.19], [Math.PI / 2, 0, 0]);
  dark.add(new THREE.BoxGeometry(0.2, 0.012, 0.01), [0, 2.12, 0.2], [0, 0, 0.05]);
  for (let k = 0; k < 5; k++) dark.add(new THREE.BoxGeometry(0.008, 0.05, 0.01), [-0.08 + k * 0.04, 2.12, 0.201]);
  if (rng() < 0.6) {
    dark.add(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 14), [0, 2.42, 0], [(rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3]);
    dark.add(new THREE.CylinderGeometry(0.16, 0.2, 0.26, 12), [0, 2.55, 0]);
  }
  const cm = H.coat[Math.floor(rng() * H.coat.length)];
  for (const [batch, mat] of [[wood, W.woodDark], [coat, cm], [head, H.burlap], [straw, H.straw], [dark, H.black]] as [Batch, THREE.Material][]) {
    const mesh = batch.build(b, mat, batch === coat || batch === head);
    if (mesh) grp.add(mesh);
  }
  grp.position.copy(b.point([x, g(x, z), z]));
  grp.rotation.y = rng() * Math.PI * 2;
  b.group.add(grp);
  b.collider([0.12, 1.2, 0.12], [x, g(x, z) + 1.2, z]);
  b.model.watchers.push(grp);
}

function buildScarecrows(b: Builder, rng: () => number): void {
  const g = b.ground;
  const R = 20;
  // Verdorrter Mais in Reihen; ein Pfad von +Z zum Brunnen in der Mitte
  const stalks = new Batch();
  const husks = new Batch();
  const stalkGeo = new THREE.CylinderGeometry(0.012, 0.022, 1, 3);
  const huskGeo = new THREE.PlaneGeometry(0.07, 0.6).translate(0, 0.3, 0);
  for (let x = -R; x <= R; x += 1.05) {
    for (let z = -R; z <= R; z += 0.55) {
      const px = x + (rng() - 0.5) * 0.3;
      const pz = z + (rng() - 0.5) * 0.3;
      const r = Math.hypot(px, pz);
      if (r > R || r < 4.8 || (Math.abs(px) < 1.3 && pz > 0) || rng() < 0.12) continue;
      const broken = rng() < 0.15;
      const h = broken ? 0.5 + rng() * 0.5 : 1.4 + rng() * 0.8;
      const lean: V3 = [(rng() - 0.5) * (broken ? 0.8 : 0.25), 0, (rng() - 0.5) * (broken ? 0.8 : 0.25)];
      const y = g(px, pz);
      stalks.add(stalkGeo, [px, y + h / 2, pz], lean, [1, h, 1]);
      if (!broken) for (let k = 0; k < 2; k++) husks.add(huskGeo, [px, y + h * (0.35 + k * 0.3), pz], yawPitch(rng() * 6, 1.1 + rng() * 0.5));
    }
  }
  stalks.build(b, H.stalk);
  husks.build(b, H.husk);
  // Vogelscheuchen über den Acker verteilt (mit Abstand zueinander und zum Pfad)
  const placed: [number, number][] = [];
  for (let i = 0; i < 200 && placed.length < 22; i++) {
    const a = rng() * Math.PI * 2;
    const r = 5.5 + rng() * 13.5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(x) < 1.8 && z > 0) continue;
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 3.6)) continue;
    placed.push([x, z]);
    scarecrow(b, rng, x, z);
  }
  // Zwei stehen am Pfad, wie ein Spalier
  scarecrow(b, rng, -2.2, 14);
  scarecrow(b, rng, 2.3, 9);
  // Brunnen in der Mitte mit Dach, Kurbel und Eimer
  b.cyl(W.stone, 1.0, 1.05, 0.85, [0, 0.42, 0], [0, 0, 0], 16, true, true);
  b.add(new THREE.CylinderGeometry(0.82, 0.82, 0.86, 16, 1, true), std(0x2a2a26, { side: THREE.BackSide }), [0, 0.42, 0], [0, 0, 0], false);
  b.add(new THREE.TorusGeometry(0.92, 0.1, 6, 20), W.stone, [0, 0.86, 0], [Math.PI / 2, 0, 0], false);
  b.add(new THREE.CircleGeometry(0.82, 16).rotateX(-Math.PI / 2), H.black, [0, 0.2, 0], [0, 0, 0], false);
  for (const s of [-1, 1]) b.box(W.woodDark, [0.12, 2.2, 0.12], [s * 0.95, 1.1, 0]);
  b.cyl(W.woodDark, 0.07, 0.07, 2.1, [0, 1.75, 0], [0, 0, Math.PI / 2], 8, false);
  for (const s of [-1, 1]) b.box(W.roof, [2.4, 0.06, 1.0], [0, 2.4, s * 0.38], [s * -0.65, 0, 0], false);
  b.add(new THREE.CylinderGeometry(0.008, 0.008, 1.0, 3), M.rope, [0.3, 1.25, 0], [0, 0, 0], false);
  b.add(new THREE.CylinderGeometry(0.13, 0.1, 0.22, 10), H.rust, [0.3, 0.68, 0], [0, 0, 0], false);
  b.box(W.woodDark, [0.04, 0.3, 0.04], [1.08, 1.75, 0.12], [0, 0, 0], false);
  b.note('acker', [-0.7, 0.92, 0.55], 0.6);
  b.box(M.oldPlanks, [0.7, 0.45, 0.45], [1.8, 0.23, -1.2], [0, 0.4, 0]);
  b.container('crate', [1.8, 0.6, -1.2]);
  b.lantern([-0.95, 2.0, 0.15]);
  // Umgestürzter Leiterwagen
  b.setFrame([7, g(7, -9) + 0.4, -9], [0.2, 0.8, 1.2]);
  b.box(W.woodDark, [1.4, 0.08, 3], [0, 0, 0], [0, 0, 0], false);
  for (const s of [-1, 1]) b.box(W.woodDark, [0.06, 0.5, 3], [s * 0.7, 0.25, 0], [0, 0, 0], false);
  b.add(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 12), W.woodDark, [0.8, -0.2, 0.9], [0, 0, Math.PI / 2], false);
  b.setFrame(null);
  particles(b, { count: 110, center: [0, 0.1, 0], radius: R, height: 1.8, color: 0xc8c4b0, size: 7, rise: 0.02, sway: 2.5, day: 0.06, night: 0.28 });
  b.model.sounds.push({ position: new THREE.Vector3(-8, 2.5, -6), sound: 'crow', every: [5, 12], volume: 0.8, when: 'day' });
  b.model.sounds.push({ position: new THREE.Vector3(9, 2.5, 5), sound: 'crow', every: [6, 14], volume: 0.7, when: 'day' });
  b.model.sounds.push({ position: new THREE.Vector3(0, 1, 0), sound: 'whisper', every: [8, 18], volume: 0.55, when: 'night' });
  b.model.sounds.push({ position: new THREE.Vector3(5, 1.5, -10), sound: 'creak', every: [6, 14], volume: 0.4 });
}

// ---------------------------------------------------------------------------
// Der Geisterzug
// ---------------------------------------------------------------------------

/** Schwarze Silhouette (Kopf und Schultern) hinter einem Abteilfenster. */
function silhouette(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.32, 0);
  s.quadraticCurveTo(-0.3, 0.32, -0.1, 0.38);
  s.lineTo(-0.07, 0.45);
  s.absarc(0, 0.6, 0.13, -1.0, Math.PI + 1.0, false);
  s.lineTo(0.1, 0.38);
  s.quadraticCurveTo(0.3, 0.32, 0.32, 0);
  s.closePath();
  return new THREE.ShapeGeometry(s, 8);
}

interface CarriageOptions {
  /** begehbar mit Bänken, Fahrgästen und Fundstücken */
  interior?: boolean;
  /** Fenster leuchten nachts */
  lit?: boolean;
  /** Anteil der Fenster mit Silhouette */
  ghosts?: number;
}

function carriage(b: Builder, rng: () => number, pos: V3, rot: V3, o: CarriageOptions, windowMat: THREE.Material): void {
  const L = 13;
  const half = L / 2;
  const F = 1.0;
  const WH = 2.4;
  b.setFrame(pos, rot);
  // Drehgestelle
  for (const z of [-4.3, 4.3]) {
    b.box(H.loco, [2.0, 0.35, 2.2], [0, 0.55, z], [0, 0, 0], false);
    for (const dz of [-0.7, 0.7]) for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 14), H.loco, [s * 0.75, 0.42, z + dz], [0, 0, Math.PI / 2], false);
  }
  b.box(H.carriage, [2.8, 0.12, L], [0, F, 0]);
  // Seitenwände: Brüstung, Fensterpfosten, Oberlicht; Fenster als leuchtende Scheiben
  const ghost = silhouette();
  const curtain = H.seat;
  for (const s of [-1, 1]) {
    const x = s * 1.4;
    b.box(H.carriage, [0.1, 0.95, L], [x, F + 0.48, 0], [0, 0, 0], false);
    b.box(H.carriage, [0.1, 0.55, L], [x, F + WH - 0.27, 0], [0, 0, 0], false);
    b.box(H.carriageTrim, [0.12, 0.06, L], [x, F + 0.95, 0], [0, 0, 0], false);
    b.collider([0.06, WH / 2, half], [x, F + WH / 2, 0]);
    // 8 Fenster à 1 m, 9 Pfosten dazwischen
    const post = (L - 8) / 9;
    for (let i = 0; i <= 8; i++) b.box(H.carriage, [0.1, 0.95, post], [x, F + 1.43, -half + post / 2 + i * (1 + post)], [0, 0, 0], false);
    for (let i = 0; i < 8; i++) {
      const z = -half + post + 0.5 + i * (1 + post);
      if (o.lit) {
        b.add(new THREE.PlaneGeometry(1.0, 0.95), windowMat, [x + s * 0.01, F + 1.43, z], [0, (s * Math.PI) / 2, 0], false);
        b.box(H.carriageTrim, [0.13, 0.04, 1.0], [x, F + 1.68, z], [0, 0, 0], false);
        // halb zugezogene Vorhänge
        for (const side of [-1, 1]) if (rng() < 0.7) b.box(curtain, [0.03, 0.9, 0.22 + rng() * 0.15], [x - s * 0.1, F + 1.45, z + side * 0.38], [0, 0, 0], false);
      }
      else if (rng() < 0.5) b.add(new THREE.PlaneGeometry(1.0, 0.95), M.glass, [x + s * 0.01, F + 1.43, z], [0, (s * Math.PI) / 2, 0], false);
      if (o.ghosts && !o.interior && rng() < o.ghosts) b.add(ghost, H.black, [x - s * 0.12, F + 1.0, z + (rng() - 0.5) * 0.2], [0, (s * Math.PI) / 2, 0], false);
    }
  }
  // Stirnwände mit Tür, Plattformen mit Geländer und Stufen
  for (const s of [-1, 1]) {
    const z = s * half;
    for (const side of [-1, 1]) b.box(H.carriage, [0.95, WH, 0.1], [side * 0.93, F + WH / 2, z]);
    b.box(H.carriage, [0.9, 0.35, 0.1], [0, F + WH - 0.17, z], [0, 0, 0], false);
    if (!o.interior) b.box(W.woodDark, [0.9, WH - 0.35, 0.06], [0, F + (WH - 0.35) / 2, z], [0, 0, 0], true);
    b.box(H.loco, [2.6, 0.1, 0.9], [0, F, z + s * 0.5]);
    for (const side of [-1, 1]) b.box(H.carriageTrim, [0.04, 0.9, 0.9], [side * 1.25, F + 0.5, z + s * 0.5], [0, 0, 0], false);
    for (let k = 0; k < 3; k++) b.box(W.woodDark, [0.9, 0.08, 0.32], [0, -0.06 + k * 0.36, z + s * (1.85 - k * 0.32)], [0, 0, 0], false);
    // Unsichtbare Rampe vom Boden auf die Plattform (Stufen allein wären zu hoch)
    const run = 2.4;
    const rise = F + 0.43;
    b.collider([0.45, 0.04, Math.hypot(run, rise) / 2], [0, F - rise / 2, z + s * (0.95 + run / 2)], yawPitch(s > 0 ? 0 : Math.PI, Math.atan2(rise, run)));
  }
  // Gewölbtes Dach
  b.add(new THREE.CylinderGeometry(1.6, 1.6, L + 0.4, 20, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).scale(1, 0.32, 1), H.loco, [0, F + WH, 0], [0, 0, 0]);
  b.collider([1.45, 0.2, half], [0, F + WH + 0.2, 0]);
  if (o.interior) {
    // Bänke paarweise, Gepäckablagen, Fahrgäste
    const seats = new Batch();
    const racks = new Batch();
    const spots: V3[] = [];
    for (let i = 0; i < 7; i++) {
      const z = -half + 1.3 + i * 1.7;
      for (const s of [-1, 1]) {
        for (const dz of [-0.45, 0.45]) {
          seats.add(new THREE.BoxGeometry(0.95, 0.1, 0.45), [s * 0.85, F + 0.5, z + dz]);
          seats.add(new THREE.BoxGeometry(0.95, 0.6, 0.08), [s * 0.85, F + 0.85, z + dz + Math.sign(dz) * 0.22]);
          spots.push([s * 0.85, F + 0.55, z + dz]);
        }
        racks.add(new THREE.BoxGeometry(0.5, 0.03, 1.5), [s * 1.1, F + 2.0, z]);
      }
    }
    b.adopt(seats.build(b, H.seat, true));
    b.adopt(racks.build(b, H.brass));
    b.container('suitcase', [1.1, F + 2.15, 1.0]);
    b.box(H.dress[0], [0.6, 0.35, 0.25], [1.1, F + 2.2, 1.0], [0, 0.1, 0], false);
    b.note('zug', spots[9].map((v, k) => (k === 1 ? v + 0.01 : v)) as V3, 0.5);
    // Dunkle Fahrgäste: Körper fest, Köpfe als Beobachter
    for (const k of [2, 6, 13, 17, 22]) {
      const [sx, sy, sz] = spots[k];
      b.add(new THREE.CapsuleGeometry(0.2, 0.45, 4, 10), H.black, [sx, sy + 0.42, sz], [0, 0, 0], false);
      const head = new THREE.Group();
      put(head, new THREE.SphereGeometry(0.12, 12, 10), H.black, [0, 0.12, 0]);
      put(head, new THREE.CylinderGeometry(0.15, 0.15, 0.02, 12), H.black, [0, 0.25, 0], [0, 0, 0], false);
      head.position.copy(b.point([sx, sy + 0.82, sz]));
      head.rotation.y = rot[1] + (sx > 0 ? -Math.PI / 2 : Math.PI / 2);
      b.group.add(head);
      b.model.watchers.push(head);
    }
    for (const z of [-3, 3]) b.add(new THREE.SphereGeometry(0.12, 10, 8), windowMat, [0, F + WH + 0.1, z], [0, 0, 0], false);
  }
  b.setFrame(null);
}

function buildTrain(b: Builder, rng: () => number): void {
  const g = b.ground;
  const rail = (z: number) => g(0, z) + 0.38;
  // Schotterbett, Schwellen, Schienen (vorn verbogen und gerissen)
  const ballast = new Batch();
  const sleepers = new Batch();
  const rails = new Batch();
  for (let z = -36; z < 36; z += 4) ballast.add(new THREE.BoxGeometry(3.2, 0.4, 4.05), [0, g(0, z + 2) + 0.05, z + 2], [-Math.atan2(g(0, z + 4) - g(0, z), 4), 0, 0]);
  for (let z = -36; z < 36; z += 0.7) {
    if (rng() < 0.05) continue;
    const off = z > 14 ? (rng() - 0.5) * 0.6 : 0;
    sleepers.add(new THREE.BoxGeometry(2.4, 0.12, 0.22), [off * 0.5, g(0, z) + 0.28, z], [0, off, 0]);
  }
  for (const s of [-1, 1]) {
    for (let z = -36; z < 14; z += 4) rails.add(new THREE.BoxGeometry(0.07, 0.12, 4.02), [s * 0.72, (rail(z) + rail(z + 4)) / 2, z + 2], [-Math.atan2(rail(z + 4) - rail(z), 4), 0, 0]);
    rails.add(new THREE.BoxGeometry(0.07, 0.12, 4), [s * 0.72 + s * 0.6, rail(16) + 0.3, 16], [0.15, s * 0.4, s * 0.3]);
  }
  ballast.build(b, H.ballast);
  sleepers.build(b, W.woodDark);
  rails.build(b, H.rust);

  const windowMat = glow(b, 0x2a2416, 0xffc870, 0.0, 2.4, 0.8, { side: THREE.DoubleSide });
  const pitchAt = (z: number) => -Math.atan2(rail(z + 5) - rail(z - 5), 10);

  // Lok: entgleist, nach rechts gekippt, die Nase in der Erde
  const lz = 22;
  b.setFrame([1.4, rail(lz) - 0.25, lz], [pitchAt(lz) + 0.05, 0.18, -0.22]);
  b.box(H.loco, [2.2, 0.55, 8.6], [0, 1.0, 0]);
  b.box(H.locoRed, [2.24, 0.12, 8.64], [0, 1.2, 0], [0, 0, 0], false);
  b.add(new THREE.CylinderGeometry(1.0, 1.0, 5.6, 20), H.loco, [0, 2.3, 1.1], [Math.PI / 2, 0, 0]);
  for (const z of [-0.6, 1.0, 2.6]) b.add(new THREE.CylinderGeometry(1.03, 1.03, 0.08, 20), H.brass, [0, 2.3, z], [Math.PI / 2, 0, 0], false);
  b.add(new THREE.CylinderGeometry(1.08, 1.08, 0.9, 20), H.loco, [0, 2.3, 4.3], [Math.PI / 2, 0, 0], false);
  b.add(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 20), H.loco, [0, 2.3, 4.78], [Math.PI / 2, 0, 0], false);
  b.add(new THREE.CylinderGeometry(0.42, 0.28, 1.3, 14), H.loco, [0, 3.85, 3.7], [0, 0, 0], false);
  b.add(new THREE.CylinderGeometry(0.5, 0.42, 0.3, 14), H.loco, [0, 4.6, 3.7], [0, 0, 0], false);
  b.add(new THREE.SphereGeometry(0.45, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), H.brass, [0, 3.25, 1.4], [0, 0, 0], false);
  b.add(new THREE.SphereGeometry(0.38, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), H.loco, [0, 3.25, -0.2], [0, 0, 0], false);
  b.box(H.loco, [2.7, 2.5, 2.3], [0, 2.55, -2.6]);
  b.box(H.loco, [3.0, 0.12, 2.8], [0, 3.86, -2.6], [0, 0, 0], false);
  for (const s of [-1, 1]) b.box(windowMat, [0.04, 0.7, 0.8], [s * 1.36, 3.0, -2.3], [0, 0, 0], false);
  b.box(H.locoRed, [2.0, 0.08, 1.2], [0, 0.55, 4.9], [-0.7, 0, 0], false);
  b.add(new THREE.CylinderGeometry(0.22, 0.25, 0.4, 14), H.loco, [0, 3.0, 4.75], [Math.PI / 2, 0, 0], false);
  b.add(new THREE.CircleGeometry(0.2, 14), glow(b, 0x302010, 0xfff0c0, 0.05, 6, 0.6), [0, 3.0, 4.96], [0, 0, 0], false);
  for (const s of [-1, 1]) {
    for (const z of [-0.8, 0.9, 2.6]) b.add(new THREE.CylinderGeometry(0.85, 0.85, 0.14, 20), H.locoRed, [s * 1.05, 0.85, z], [0, 0, Math.PI / 2], false);
    b.add(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 14), H.locoRed, [s * 1.0, 0.45, 4.0], [0, 0, Math.PI / 2], false);
    b.box(H.steel, [0.06, 0.12, 3.6], [s * 1.16, 0.85, 0.9], [0, 0, 0], false);
  }
  b.collider([1.3, 1.6, 4.4], [0, 2.0, 0.4]);
  const lampAt = b.point([0, 3.0, 5.4]);
  const stack = b.point([0, 4.8, 3.7]);
  b.setFrame(null);
  b.light(lampAt.toArray() as V3, 0xfff0c8, 8, 24, 'lamp');
  particles(b, { count: 70, center: stack.toArray() as V3, radius: 0.6, height: 7, color: 0xb8b8b0, size: 3.5, rise: 0.5, sway: 0.8, day: 0.12, night: 0.25 });
  b.model.sounds.push({ position: stack.clone(), sound: 'whistle', every: [50, 110], volume: 0.8, when: 'night' });
  b.model.sounds.push({ position: stack.clone(), loop: { freq: 3400, q: 0.6, gain: 0.12, range: 14 } });

  // Tender
  const tz = 13.4;
  b.setFrame([0.5, rail(tz) - 0.05, tz], [pitchAt(tz), 0.08, -0.08]);
  b.box(H.loco, [2.5, 1.9, 4.2], [0, 1.55, 0]);
  const coal = new Batch();
  for (let i = 0; i < 14; i++) coal.add(boulder(0.25 + rng() * 0.2, rng), [(rng() - 0.5) * 1.8, 2.55 + rng() * 0.2, (rng() - 0.5) * 3.4], [rng(), rng(), rng()]);
  b.adopt(coal.build(b, M.coal));
  for (const z of [-1.3, 1.3]) for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 14), H.loco, [s * 1.0, 0.45, z], [0, 0, Math.PI / 2], false);
  b.setFrame(null);

  // Wagen: der erste begehbar und erleuchtet, der zweite schief mit Gestalten, der dritte umgekippt
  carriage(b, rng, [0, rail(1.5), 1.5], [pitchAt(1.5), 0, 0], { interior: true, lit: true }, windowMat);
  b.light([0, rail(1.5) + 3.1, -1.5], 0xffc870, 7, 10, 'flicker');
  b.light([0, rail(1.5) + 3.1, 4.5], 0xffc870, 7, 10, 'flicker');
  b.model.sounds.push({ position: new THREE.Vector3(0, rail(1.5) + 1.5, 1.5), sound: 'whisper', every: [10, 22], volume: 0.5, when: 'night' });
  carriage(b, rng, [0.35, rail(-13) + 0.05, -13], [pitchAt(-13), 0.05, 0.06], { lit: true, ghosts: 0.45 }, windowMat);
  b.light([0.3, rail(-13) + 2.8, -13], 0xffc870, 3, 9, 'flicker');
  carriage(b, rng, [3.4, g(3.4, -27.5) + 1.4, -27.5], [0, -0.12, Math.PI / 2 - 0.08], {}, windowMat);

  // Der Schaffner wartet neben dem ersten Wagen
  const cz = 9.2;
  const cx = -2.2;
  const cy = g(cx, cz);
  const conductor = new THREE.Group();
  put(conductor, new THREE.CylinderGeometry(0.2, 0.32, 1.5, 10), H.black, [0, 0.75, 0]);
  put(conductor, new THREE.CylinderGeometry(0.16, 0.2, 0.5, 10), H.black, [0, 1.7, 0]);
  put(conductor, new THREE.SphereGeometry(0.13, 12, 10), H.black, [0, 2.07, 0]);
  put(conductor, new THREE.CylinderGeometry(0.15, 0.15, 0.14, 12), H.carriage, [0, 2.2, 0], [0, 0, 0], false);
  put(conductor, new THREE.BoxGeometry(0.22, 0.03, 0.12), H.black, [0, 2.14, 0.13], [0, 0, 0], false);
  put(conductor, new THREE.SphereGeometry(0.035, 8, 6), glow(b, 0x302010, 0xffd080, 0.3, 3, 1.5), [0.24, 1.15, 0.12], [0, 0, 0], false);
  conductor.position.copy(b.point([cx, cy, cz]));
  conductor.rotation.y = Math.PI / 2;
  b.group.add(conductor);
  b.collider([0.25, 1.1, 0.25], [cx, cy + 1.1, cz]);
  b.model.watchers.push(conductor);

  // Signal am Ende der Strecke: rotes Licht
  const sz = -35;
  const sy = g(-2.2, sz);
  b.cyl(H.steel, 0.07, 0.09, 4.2, [-2.2, sy + 2.1, sz], [0, 0, 0], 8);
  b.box(H.loco, [0.5, 0.9, 0.25], [-2.2, sy + 4.0, sz]);
  b.add(new THREE.CircleGeometry(0.13, 14), glow(b, 0x300000, 0xff1810, 0.4, 4, 0.5), [-2.2, sy + 4.2, sz + 0.13], [0, 0, 0], false);
  b.light([-2.2, sy + 4.2, sz + 0.5], 0xff1810, 4, 12, 'lamp');
  particles(b, { count: 140, center: [0, g(0, 0) + 0.1, 0], radius: 32, height: 1.8, color: 0xc8ccc8, size: 7, rise: 0.02, sway: 2.5, day: 0.08, night: 0.28 });
  b.model.sounds.push({ position: new THREE.Vector3(0, 2, -13), sound: 'creak', every: [8, 16], volume: 0.4 });
}

/** Einstieg aus `buildPlace`. */
export function buildHorror(kind: PlaceKind, b: Builder, rng: () => number): void {
  if (kind === 'dolls') buildDolls(b, rng);
  else if (kind === 'gallows') buildGallows(b, rng);
  else if (kind === 'bunker') buildBunker(b, rng);
  else if (kind === 'scarecrows') buildScarecrows(b, rng);
  else if (kind === 'train') buildTrain(b, rng);
}
