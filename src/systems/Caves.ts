import * as THREE from 'three';
import { texturize } from '../world/SurfaceTextures';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import type { EventBus } from '../core/EventBus';
import type { HeightMap } from '../world/HeightMap';
import type { Vegetation } from '../world/Vegetation';
import { jitter } from '../world/VegetationGeometry';
import { injectSeason } from '../world/SeasonShader';
import {
  buildCaveMesh,
  caveBounds,
  caveFloor,
  createCaveSdf,
  findCaveSites,
  generateLayout,
  probe,
  type CaveFeature,
  type CaveLayout,
  type CaveSite,
} from '../world/CaveGenerator';
import { createMushroomCluster, FLINT_GEOMETRY } from '../entities/items/ItemMeshes';
import type { ItemId, ToolStats } from '../entities/items/ItemDefs';
import { deriveSeed, mulberry32 } from '../utils/random';
import type { ItemService } from './ItemService';
import type { Particles } from './Particles';
import type { LightPool, LightRequest } from './LightPool';
import type { Audio } from './Audio';
import { CaveNav } from './ai/CaveNav';
import { CAVE_NOTES } from './Notes';
import type { CaveSpawn } from './ai/EnemyDirector';

export const CAVE_COUNT = 3;
export const CAVE_NAMES = ['Tropfsteinhöhle', 'Pilzgrotte', 'Feuersteinstollen'];
/**
 * Die Innenräume liegen hoch über der Insel (je Höhle eine eigene Etage): weit über dem
 * Höhenfeld der Physik, nie im Wasser – und von außen unsichtbar, denn die Felshülle ist geschlossen.
 */
const CAVE_ALTITUDE = 520;
const CAVE_SPACING = 80;
/** Feuerstein je Ader. */
const FLINT_PER_NODE = 3;
/** Ab dieser Nähe gilt ein Eingang als entdeckt (Karte). */
const DISCOVER_RANGE = 28;
/** Nach so vielen Tagen ist ein getöteter Höhlenbewohner ersetzt. */
const DWELLER_RESPAWN_DAYS = 2;

/** Fester Platz eines Höhlenbewohners. */
interface DwellerSlot {
  chamber: number;
  /** Ab diesem Tag lebt er wieder (0 = lebt). */
  respawnDay: number;
  /** Hansen, der Erste – kehrt nie zurück. */
  boss?: boolean;
}

/** In dieser Höhle (Feuersteinstollen) haust Hansen, in der hintersten Kammer. */
export const BOSS_CAVE = 2;
/** „Tag der Wiederkehr“ eines besiegten Endgegners: nie. */
const NEVER = 1e9;

/** Zustand einer Ausstattung (Kiste geöffnet, Pilze gepflückt, Feuerstein übrig). */
interface Feature {
  index: number;
  def: CaveFeature;
  /** Weltposition des Bodenpunkts. */
  position: THREE.Vector3;
  done: boolean;
  flintLeft: number;
  /** Abbau-Fortschritt bis zum nächsten Stück Feuerstein. */
  progress: number;
  object?: THREE.Object3D;
  shards?: THREE.Object3D;
  lid?: THREE.Object3D;
}

export interface Cave {
  index: number;
  name: string;
  site: CaveSite;
  layout: CaveLayout;
  /** Weltposition des lokalen Ursprungs (Eingangspunkt innen). */
  origin: THREE.Vector3;
  /** Lokal → Welt (Drehung um `site.into`, dann Verschiebung). */
  toWorld: THREE.Matrix4;
  discovered: boolean;
  /** Schon einmal betreten (für das Tagebuch). */
  visited: boolean;
  features: Feature[];
  interior: THREE.Group | null;
  body: RAPIER.RigidBody | null;
  /** Wegfindung der Höhlenbewohner (mit dem Innenraum gebaut). */
  nav: CaveNav | null;
  dwellers: DwellerSlot[];
  exitLight: LightRequest;
  exitMaterial: THREE.MeshBasicMaterial;
}

export type CaveTarget =
  | { type: 'entrance'; cave: Cave }
  | { type: 'exit'; cave: Cave }
  | { type: 'note'; cave: Cave; id: string }
  | { type: 'crate' | 'mushroom' | 'flint'; cave: Cave; feature: Feature };

export interface CaveSave {
  discovered: number[];
  visited: number[];
  /** [Höhle, Ausstattung, Wert]: Kisten/Pilze 0 = erledigt, Feuerstein = Reststücke. */
  features: [number, number, number][];
  /** [Höhle, Platz, Tag der Wiederkehr] getöteter Bewohner. */
  dwellers?: [number, number, number][];
}

export interface CavesDeps {
  physics: Physics;
  heightMap: HeightMap;
  vegetation: Vegetation;
  items: ItemService;
  particles: Particles;
  lights: LightPool;
  audio: Audio;
  events: EventBus;
  seed: number;
  spawnPoint: THREE.Vector3;
  /** Hier keine Eingänge (Lager). */
  avoid: THREE.Vector3[];
  /** Weitere Sperrflächen (Stadt). */
  avoidAreas?: { x: number; z: number; radius: number }[];
  /** Felsen am Eingang als Hindernis für die Wegfindung melden. */
  markObstacle: (x: number, z: number, radius: number) => void;
  /** Vorgegebene Eingänge nach Höhlen-Index (der Feuersteinstollen beginnt im Mundloch der Zeche). */
  fixedSites?: Partial<Record<number, CaveSite>>;
}

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra });

const ROCK = mat(0x6d6962);
ROCK.onBeforeCompile = (shader) => injectSeason(shader, { snowBias: 0.1 });
texturize(ROCK, 'mossyRock', 0.5);
const M = {
  rock: ROCK,
  caveRock: texturize(mat(0x6a655e), 'rockFace', 0.4),
  wood: texturize(mat(0x5b4430), 'planks', 0.35),
  woodDark: texturize(mat(0x3f2f21), 'planks', 0.35),
  iron: mat(0x4b4a48, { roughness: 0.6, metalness: 0.3 }),
  bone: mat(0xd9cfb8, { roughness: 0.8 }),
  dripstone: mat(0x8a8278, { roughness: 0.6 }),
  flint: mat(0x25272e, { roughness: 0.2, metalness: 0.25 }),
  dark: new THREE.MeshBasicMaterial({ color: 0x030303 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xd9d1bc, roughness: 1 }),
  interior: texturize(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true }), 'rockFace', 0.4, 1.3),
};
const BOULDER = jitter(new THREE.IcosahedronGeometry(1, 1), 0.18, 41);
const NUGGET = jitter(new THREE.IcosahedronGeometry(1, 0), 0.25, 43);
const CONE = new THREE.ConeGeometry(0.22, 1.3, 6).translate(0, 0.65, 0);

/** Weicher, radialer Lichtfleck (Mitte hell, Rand transparent) für die Öffnung zum Tageslicht. */
function glowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let sharedGlow: THREE.Texture | null = null;

/** Öffnung mit rundem Bogen (Breite w, Höhe h, Ursprung unten Mitte). */
function archShape(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  const r = w / 2;
  s.moveTo(-r, 0);
  s.lineTo(-r, h - r);
  s.absarc(0, h - r, r, Math.PI, 0, true);
  s.lineTo(r, 0);
  s.lineTo(-r, 0);
  return s;
}

/**
 * Höhlen: drei Eingänge an Berghängen, Innenräume aus dem Höhlengenerator (erst beim ersten
 * Betreten gebaut), Ausstattung mit Feuersteinadern, Leuchtpilzen, alten Vorratskisten und
 * Tropfsteinen. Das Betreten selbst (Abblenden, Teleport, Dunkelheit) steuert das Spiel.
 */
export class Caves {
  readonly group = new THREE.Group();
  readonly caves: Cave[] = [];
  /** Höhle, in der sich der Spieler gerade befindet. */
  current: Cave | null = null;

  private readonly targets = new Map<number, CaveTarget>();
  private readonly tmp = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly d: CavesDeps) {
    this.group.name = 'Caves';
    const avoid = [
      { x: d.spawnPoint.x, z: d.spawnPoint.z, radius: 130 },
      ...d.avoid.map((p) => ({ x: p.x, z: p.z, radius: 55 })),
      ...(d.avoidAreas ?? []),
    ];
    const fixed = d.fixedSites ?? {};
    for (const f of Object.values(fixed)) if (f) avoid.push({ x: f.position.x, z: f.position.z, radius: 160 });
    const found = findCaveSites(d.heightMap, d.seed, CAVE_COUNT, avoid);
    const sites: CaveSite[] = [];
    for (let i = 0; i < CAVE_COUNT; i++) {
      const site = fixed[i] ?? found.shift();
      if (site) sites.push(site);
    }
    sites.forEach((site, index) => {
      const layout = generateLayout(d.seed, index);
      const origin = new THREE.Vector3(site.position.x, CAVE_ALTITUDE + index * CAVE_SPACING, site.position.z);
      const toWorld = new THREE.Matrix4().makeRotationY(site.into).setPosition(origin);
      const cave: Cave = {
        index,
        name: CAVE_NAMES[index] ?? `Höhle ${index + 1}`,
        site,
        layout,
        origin,
        toWorld,
        discovered: false,
        visited: false,
        features: [],
        interior: null,
        body: null,
        nav: null,
        // Der erste Raum hinter dem Eingang bleibt ruhig; jeder weitere hat einen Bewohner, der hinterste zwei.
        dwellers: layout.chambers.flatMap((_, i): DwellerSlot[] => {
          if (i === 0) return [];
          if (i < layout.chambers.length - 1) return [{ chamber: i, respawnDay: 0 }];
          // Im Stollen wartet in der Pilzkammer am Ende statt zweier Kriecher Hansen.
          return index === BOSS_CAVE ? [{ chamber: i, respawnDay: 0, boss: true }] : [{ chamber: i, respawnDay: 0 }, { chamber: i, respawnDay: 0 }];
        }),
        exitLight: { position: new THREE.Vector3(), color: new THREE.Color(0xbcd2e6), intensity: 0, distance: 16 },
        exitMaterial: new THREE.MeshBasicMaterial({
          color: 0xffffff,
          fog: false,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      };
      cave.features = layout.features.map((def, i) => ({
        index: i,
        def,
        position: def.position.clone().applyMatrix4(toWorld),
        done: false,
        flintLeft: def.kind === 'flint' ? FLINT_PER_NODE : 0,
        progress: 0,
      }));
      cave.exitLight.position.copy(layout.exit).add(new THREE.Vector3(0, 0.4, 1.6)).applyMatrix4(toWorld);
      this.caves.push(cave);
      this.buildEntrance(cave);
    });
  }

  getTarget(collider: RAPIER.Collider): CaveTarget | undefined {
    return this.targets.get(collider.handle);
  }

  /** Lokaler Punkt → Welt. */
  private world(cave: Cave, local: THREE.Vector3): THREE.Vector3 {
    return local.clone().applyMatrix4(cave.toWorld);
  }

  // ---------------------------------------------------------------------------
  // Eingang an der Oberfläche
  // ---------------------------------------------------------------------------

  private buildEntrance(cave: Cave): void {
    const { site } = cave;
    const g = new THREE.Group();
    g.name = `CaveEntrance_${cave.index}`;
    g.position.copy(site.position);
    g.rotation.y = site.into;
    const rng = mulberry32(deriveSeed(this.d.seed, `cave-entrance-${cave.index}`));
    // Felsen im Hufeisen um die Öffnung (lokal: +Z in den Hang).
    const boulders: [number, number, number, number, number, number][] = [
      [0, 3.4, 2.6, 3.2, 1.6, 2.4], // Kuppe
      [-2.3, 1.2, 1.2, 1.5, 1.9, 1.8], // links
      [2.4, 1.0, 1.4, 1.6, 1.7, 1.9],
      [0, 3.0, 0.9, 2.3, 0.85, 1.1], // Sturz über der Öffnung
      [-3.6, 0.4, 2.4, 1.4, 1.2, 1.6],
      [3.7, 0.5, 2.6, 1.5, 1.1, 1.5],
      [-1.4, 4.1, 2.9, 1.6, 1.1, 1.5],
      [1.7, 4.0, 3.2, 1.7, 1.2, 1.4],
    ];
    const body = this.d.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const [x, y, z, sx, sy, sz] of boulders) {
      const rock = new THREE.Mesh(BOULDER, M.rock);
      rock.position.set(x, y, z);
      rock.scale.set(sx, sy, sz);
      rock.rotation.set(rng() * 0.5, rng() * 6, rng() * 0.5);
      rock.castShadow = true;
      rock.receiveShadow = true;
      g.add(rock);
    }
    // Dunkle Öffnung mit etwas Tiefe (schwarze Röhre hinter dem Bogen).
    const arch = new THREE.Mesh(new THREE.ShapeGeometry(archShape(2.4, 2.6)), M.dark);
    arch.position.set(0, -0.4, 1.25);
    arch.rotation.y = Math.PI;
    g.add(arch);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 2.2), M.dark);
    tube.position.set(0, 1, 2.4);
    g.add(tube);
    this.group.add(g);
    g.updateMatrixWorld(true);

    // Kollision: Felsen als Kugeln, eine Wand hinter dem Bogen, davor ein Sensor zum Anvisieren.
    const add = (desc: RAPIER.ColliderDesc, local: THREE.Vector3, target?: CaveTarget) => {
      const p = local.applyMatrix4(g.matrixWorld);
      const q = new THREE.Quaternion().setFromAxisAngle(this.up, site.into);
      const c = this.d.physics.world.createCollider(
        desc.setTranslation(p.x, p.y, p.z).setRotation(q).setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
        body,
      );
      if (target) this.targets.set(c.handle, target);
    };
    for (const [x, y, z, sx, sy, sz] of boulders) add(RAPIER.ColliderDesc.ball(Math.min(sx, sy, sz) * 0.95), new THREE.Vector3(x, y, z));
    add(RAPIER.ColliderDesc.cuboid(1.4, 1.8, 0.35), new THREE.Vector3(0, 1.2, 1.7));
    add(RAPIER.ColliderDesc.cuboid(1.1, 1.3, 0.3).setSensor(true), new THREE.Vector3(0, 1.1, 0.5), { type: 'entrance', cave });

    // Lichtung: Bäume und Büsche am Eingang entfernen, Felsen sperren die Wegfindung.
    for (const v of this.d.vegetation.instances) {
      if (v.alive && v.position.distanceTo(site.position) < 8 && v.kind !== 'berries') this.d.vegetation.remove(v);
    }
    for (const [x, , z, sx, , sz] of boulders) {
      const p = new THREE.Vector3(x, 0, z).applyMatrix4(g.matrixWorld);
      this.d.markObstacle(p.x, p.z, Math.max(sx, sz) * 0.9);
    }
  }

  /** Standpunkt vor dem Eingang (zum Verlassen der Höhle) mit Blick talwärts. */
  surfaceExit(cave: Cave): { position: THREE.Vector3; yaw: number } {
    const s = cave.site;
    const p = s.position.clone().add(new THREE.Vector3(-Math.sin(s.into) * 2.2, 0, -Math.cos(s.into) * 2.2));
    p.y = this.d.heightMap.heightAt(p.x, p.z) + 0.1;
    return { position: p, yaw: s.into };
  }

  /** Standpunkt innen am Eingang, Blick in die Höhle (+Z lokal). */
  interiorEntry(cave: Cave): { position: THREE.Vector3; yaw: number } {
    const sdf = createCaveSdf(this.d.seed, cave.index, cave.layout);
    const floor = probe(sdf, 0, 1, 0.6, -1) ?? 0;
    return { position: this.world(cave, new THREE.Vector3(0, floor + 0.1, 0.6)), yaw: cave.site.into + Math.PI };
  }

  // ---------------------------------------------------------------------------
  // Innenraum
  // ---------------------------------------------------------------------------

  /** Baut Felshülle, Kollision und Ausstattung (einmalig, beim ersten Betreten bzw. Laden). */
  build(cave: Cave): void {
    if (cave.interior) return;
    const t0 = performance.now();
    const sdf = createCaveSdf(this.d.seed, cave.index, cave.layout);
    const mesh = buildCaveMesh(sdf, caveBounds(cave.layout));
    const positions = mesh.positions;
    const world = new Float32Array(positions.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < positions.length; i += 3) {
      v.fromArray(positions, i).applyMatrix4(cave.toWorld);
      world[i] = v.x;
      world[i + 1] = v.y;
      world[i + 2] = v.z;
    }

    const g = new THREE.Group();
    g.name = `Cave_${cave.index}`;
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.BufferAttribute(world, 3));
    indexed.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const geometry = indexed.toNonIndexed();
    geometry.computeVertexNormals();
    this.paint(geometry, cave);
    const shell = new THREE.Mesh(geometry, M.interior);
    shell.name = 'CaveShell';
    g.add(shell);

    const body = this.d.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.d.physics.world.createCollider(
      RAPIER.ColliderDesc.trimesh(world, mesh.indices).setCollisionGroups(interactionGroups(CollisionGroup.STATIC)).setFriction(0.9),
      body,
    );
    cave.body = body;

    cave.nav = new CaveNav(caveFloor(mesh), cave.origin, cave.site.into);

    this.buildExit(cave, g, body);
    this.buildFeatures(cave, g, body);
    this.group.add(g);
    cave.interior = g;
    console.info(`[Caves] ${cave.name}: ${mesh.triangles} Dreiecke in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  /** Vertexfarben: Boden erdig, Wände grau mit Schlieren, Decke dunkel. */
  private paint(geometry: THREE.BufferGeometry, cave: Cave): void {
    const n = geometry.getAttribute('normal');
    const p = geometry.getAttribute('position');
    const colors = new Float32Array(n.count * 3);
    const floor = new THREE.Color(0x5a4c3e);
    const wall = new THREE.Color(0x66625b);
    const ceiling = new THREE.Color(0x46433f);
    const c = new THREE.Color();
    const rng = mulberry32(deriveSeed(this.d.seed, `cave-paint-${cave.index}`));
    for (let i = 0; i < n.count; i += 3) {
      // Flächenweise (flat shading): eine Farbe je Dreieck.
      const ny = n.getY(i);
      c.copy(wall);
      if (ny > 0.55) c.lerp(floor, THREE.MathUtils.smoothstep(ny, 0.55, 0.85));
      else if (ny < -0.3) c.lerp(ceiling, THREE.MathUtils.smoothstep(-ny, 0.3, 0.7));
      // Gesteinsbänder (nach Höhe) und etwas Zufall
      const band = Math.sin(p.getY(i) * 2.1 + p.getX(i) * 0.15) * 0.05;
      const k = 0.88 + rng() * 0.18 + band;
      c.multiplyScalar(k);
      for (let j = 0; j < 3; j++) colors.set([c.r, c.g, c.b], (i + j) * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  /** Helle Öffnung zum Ausgang an der Rückwand der Eingangsnische. */
  private buildExit(cave: Cave, g: THREE.Group, body: RAPIER.RigidBody): void {
    const exit = cave.layout.exit;
    // Zwei Lichtflecken: ein großer, schwacher Schein und ein heller Kern – der Fels davor
    // verdeckt die Ränder, so wirkt es wie Tageslicht, das durch einen Spalt fällt.
    sharedGlow ??= glowTexture();
    cave.exitMaterial.map = sharedGlow;
    for (const [size, z] of [
      [4.2, -0.25],
      [2.4, 0.05],
    ] as const) {
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 1.2), cave.exitMaterial);
      glow.position.copy(this.world(cave, new THREE.Vector3(exit.x, exit.y, exit.z + z)));
      glow.rotation.y = cave.site.into;
      glow.renderOrder = 2;
      g.add(glow);
    }
    const p = this.world(cave, exit.clone().add(new THREE.Vector3(0, 0, 0.7)));
    const c = this.d.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(1.0, 1.2, 0.35)
        .setTranslation(p.x, p.y, p.z)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(this.up, cave.site.into))
        .setSensor(true)
        .setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
      body,
    );
    this.targets.set(c.handle, { type: 'exit', cave });
  }

  private buildFeatures(cave: Cave, g: THREE.Group, body: RAPIER.RigidBody): void {
    const rng = mulberry32(deriveSeed(this.d.seed, `cave-props-${cave.index}`));
    const drips = cave.features.filter((f) => f.def.kind === 'stalactite' || f.def.kind === 'stalagmite');
    const dripMesh = new THREE.InstancedMesh(CONE, M.dripstone, drips.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    drips.forEach((f, i) => {
      const down = f.def.kind === 'stalactite';
      q.setFromEuler(new THREE.Euler(down ? Math.PI : 0, f.def.rotation, 0));
      s.set(f.def.scale * (down ? 0.8 : 1.1), f.def.scale, f.def.scale * (down ? 0.8 : 1.1));
      // Etwas in den Fels versenkt, damit kein Spalt bleibt.
      const p = f.position.clone().addScaledVector(this.up, down ? 0.15 : -0.15);
      dripMesh.setMatrixAt(i, m.compose(p, q, s));
      if (!down) {
        const h = 1.3 * f.def.scale;
        this.d.physics.world.createCollider(
          RAPIER.ColliderDesc.cylinder(h * 0.35, 0.22 * f.def.scale)
            .setTranslation(f.position.x, f.position.y + h * 0.35, f.position.z)
            .setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
          body,
        );
      }
    });
    dripMesh.name = 'Dripstones';
    g.add(dripMesh);

    // Eine Notiz liegt neben der ersten Vorratskiste der Höhle.
    const noteId = CAVE_NOTES[cave.index];
    const noteCrate = cave.features.find((f) => f.def.kind === 'crate');
    if (noteId && noteCrate) {
      // Neben der Kiste auf dem dortigen Boden (der Höhlenboden ist uneben).
      const local = noteCrate.def.position.clone().add(new THREE.Vector3(0.85, 0, 0.2).applyAxisAngle(this.up, noteCrate.def.rotation));
      const sdf = createCaveSdf(this.d.seed, cave.index, cave.layout);
      local.y = probe(sdf, local.x, local.y + 1, local.z, -1) ?? local.y;
      const p = this.world(cave, local);
      const paper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.006, 0.3), M.paper);
      paper.position.copy(p).setY(p.y + 0.02);
      paper.rotation.y = noteCrate.def.rotation + 0.4;
      g.add(paper);
      const c = this.d.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.18, 0.05, 0.22)
          .setTranslation(p.x, p.y + 0.06, p.z)
          .setSensor(true)
          .setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
        body,
      );
      this.targets.set(c.handle, { type: 'note', cave, id: noteId });
    }

    for (const f of cave.features) {
      const kind = f.def.kind;
      if (kind === 'stalactite' || kind === 'stalagmite') continue;
      const o = new THREE.Group();
      o.position.copy(f.position);
      o.rotation.y = f.def.rotation;
      o.scale.setScalar(f.def.scale);
      let target: CaveTarget | null = null;
      let collider: RAPIER.ColliderDesc | null = null;
      switch (kind) {
        case 'flint': {
          const base = new THREE.Mesh(NUGGET, M.caveRock);
          base.scale.set(0.6, 0.38, 0.5);
          base.position.y = 0.12;
          o.add(base);
          const shards = new THREE.Group();
          for (let i = 0; i < 6; i++) {
            const shard = new THREE.Mesh(FLINT_GEOMETRY, M.flint);
            const a = (i / 6) * Math.PI * 2 + rng();
            shard.position.set(Math.cos(a) * 0.3, 0.3 + rng() * 0.15, Math.sin(a) * 0.25);
            shard.scale.set(0.07 + rng() * 0.05, 0.16 + rng() * 0.12, 0.06);
            shard.rotation.set(Math.cos(a) * 0.7, rng() * 3, Math.sin(a) * 0.7);
            shards.add(shard);
          }
          o.add(shards);
          f.shards = shards;
          shards.visible = f.flintLeft > 0;
          target = { type: 'flint', cave, feature: f };
          collider = RAPIER.ColliderDesc.ball(0.5 * f.def.scale).setTranslation(0, 0.25, 0);
          break;
        }
        case 'mushroom': {
          const cluster = createMushroomCluster(rng, 5 + Math.floor(rng() * 4));
          cluster.scale.setScalar(1.6);
          o.add(cluster);
          cluster.visible = !f.done;
          target = { type: 'mushroom', cave, feature: f };
          collider = RAPIER.ColliderDesc.ball(0.3).setTranslation(0, 0.12, 0).setSensor(true);
          break;
        }
        case 'crate': {
          const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), M.wood);
          box.position.y = 0.25;
          o.add(box);
          for (const x of [-0.46, 0.46]) {
            const band = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.52, 0.62), M.iron);
            band.position.set(x * 0.8, 0.25, 0);
            o.add(band);
          }
          // Deckel dreht um die hintere Kante (lokal −Z).
          const hinge = new THREE.Group();
          hinge.position.set(0, 0.5, -0.3);
          const lid = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.08, 0.62), M.woodDark);
          lid.position.set(0, 0.04, 0.3);
          hinge.add(lid);
          o.add(hinge);
          f.lid = hinge;
          if (f.done) hinge.rotation.x = -1.9;
          target = { type: 'crate', cave, feature: f };
          collider = RAPIER.ColliderDesc.cuboid(0.45, 0.3, 0.3).setTranslation(0, 0.3, 0);
          break;
        }
        case 'bones': {
          for (let i = 0; i < 4; i++) {
            const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.4 + rng() * 0.2, 5), M.bone);
            bone.position.set((rng() - 0.5) * 0.6, 0.03, (rng() - 0.5) * 0.6);
            bone.rotation.set(Math.PI / 2, 0, rng() * 3);
            o.add(bone);
          }
          const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 7, 5), M.bone);
          skull.scale.set(1, 0.85, 1.2);
          skull.position.set(0.25, 0.08, 0.1);
          o.add(skull);
          break;
        }
      }
      o.traverse((x) => (x.castShadow = false));
      g.add(o);
      f.object = o;
      if (target && collider) {
        const desc = collider;
        const local = desc.translation;
        const p = this.tmp.set(local.x, local.y, local.z).multiplyScalar(f.def.scale).applyAxisAngle(this.up, f.def.rotation).add(f.position);
        const c = this.d.physics.world.createCollider(
          desc
            .setTranslation(p.x, p.y, p.z)
            .setRotation(new THREE.Quaternion().setFromAxisAngle(this.up, f.def.rotation))
            .setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
          body,
        );
        this.targets.set(c.handle, target);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Interaktion
  // ---------------------------------------------------------------------------

  /** Betreten: baut den Innenraum bei Bedarf und liefert den Standpunkt innen. */
  enter(cave: Cave): { position: THREE.Vector3; yaw: number } {
    this.build(cave);
    this.current = cave;
    const first = !cave.visited;
    cave.visited = true;
    this.discover(cave);
    this.d.events.emit('cave:entered', { index: cave.index, first });
    return this.interiorEntry(cave);
  }

  leave(): { position: THREE.Vector3; yaw: number } | null {
    const cave = this.current;
    this.current = null;
    return cave ? this.surfaceExit(cave) : null;
  }

  private discover(cave: Cave): void {
    if (cave.discovered) return;
    cave.discovered = true;
    this.d.events.emit('hud:message', { text: `${cave.name} entdeckt – auf der Karte (M) markiert.` });
  }

  /** Eingänge in der Nähe des Spielers gelten als entdeckt. */
  updateDiscovery(player: THREE.Vector3): void {
    for (const cave of this.caves) {
      if (!cave.discovered && cave.site.position.distanceTo(player) < DISCOVER_RANGE) this.discover(cave);
    }
  }

  /** Feuerstein abschlagen: jeder Treffer bringt Fortschritt, je volle Einheit ein Stück. */
  hitFlint(f: Feature, tool: ToolStats, point: THREE.Vector3, normal: THREE.Vector3): void {
    this.d.particles.burst(point, { count: 10, color: 0x30323a, direction: normal, speed: 3.2, size: 0.03 });
    this.d.audio.play('stoneHit');
    this.d.events.emit('tool:hit', { target: 'rock' });
    if (f.flintLeft <= 0) {
      this.d.events.emit('hud:message', { text: 'Die Ader ist erschöpft.' });
      return;
    }
    if (tool.rockYield <= 0) {
      this.d.events.emit('hud:message', { text: 'Damit lässt sich kein Feuerstein lösen.' });
      return;
    }
    f.progress += tool.rockYield * 0.5;
    while (f.progress >= 1 && f.flintLeft > 0) {
      f.progress -= 1;
      f.flintLeft--;
      this.d.items.give('flint', 1, point);
    }
    if (f.flintLeft <= 0 && f.shards) {
      f.shards.visible = false;
      this.d.particles.burst(point, { count: 18, color: 0x30323a, speed: 4, size: 0.04 });
    }
  }

  pickMushrooms(f: Feature): void {
    if (f.done) return;
    f.done = true;
    if (f.object) f.object.visible = false;
    this.d.items.give('mushroom', 2 + (f.index % 2), f.position);
  }

  /** Öffnet eine Vorratskiste: Verbandszeug und zwei weitere, je Kiste feste Fundstücke. */
  openCrate(cave: Cave, f: Feature): void {
    if (f.done) return;
    f.done = true;
    if (f.lid) f.lid.rotation.x = -1.9;
    this.d.audio.play('door', { position: f.position });
    const rng = mulberry32(deriveSeed(this.d.seed, `cave-crate-${cave.index}-${f.index}`));
    const pool: [ItemId, number][] = [
      ['arrow', 6],
      ['torch', 1],
      ['hide', 2],
      ['flint', 2],
      ['cookedFish', 2],
      ['rawMeat', 2],
    ];
    const loot: [ItemId, number][] = [['medkit', 1]];
    for (let i = 0; i < 2; i++) loot.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    const at = this.tmp.copy(f.position).setY(f.position.y + 0.6);
    for (const [item, count] of loot) this.d.items.give(item, count, at);
    this.d.events.emit('cave:crate', { index: cave.index });
  }

  /** Bewohner, die heute (wieder) in der Höhle leben – auf dem Boden ihrer Kammer. */
  dwellerSpawns(cave: Cave, day: number): CaveSpawn[] {
    const sdf = createCaveSdf(this.d.seed, cave.index, cave.layout);
    const out: CaveSpawn[] = [];
    cave.dwellers.forEach((d, slot) => {
      if (d.respawnDay > day) return;
      d.respawnDay = 0;
      const c = cave.layout.chambers[d.chamber];
      // Zwei Bewohner einer Kammer stehen nicht aufeinander (Hansen steht in der Mitte).
      const side = d.boss ? 0 : slot % 2 === 0 ? 1.2 : -1.2;
      const x = c.center.x + side;
      const z = c.center.z;
      const floor = probe(sdf, x, c.floor + 1.2, z, -1);
      if (floor === null) return;
      out.push({
        slot,
        position: this.world(cave, new THREE.Vector3(x, floor + 0.05, z)),
        home: this.world(cave, new THREE.Vector3(c.center.x, floor, c.center.z)),
        ...(d.boss ? { kind: 'hansen' as const } : {}),
      });
    });
    return out;
  }

  dwellerKilled(caveIndex: number, slot: number, day: number): void {
    const cave = this.caves[caveIndex];
    const d = cave?.dwellers[slot];
    if (!d) return;
    if (!d.boss) {
      d.respawnDay = day + DWELLER_RESPAWN_DAYS;
      return;
    }
    d.respawnDay = NEVER;
    // Was Hansen bei sich trug: die Vorräte der letzten Schicht.
    const c = cave.layout.chambers[d.chamber];
    const at = this.world(cave, new THREE.Vector3(c.center.x, c.floor + 0.8, c.center.z));
    for (const [item, count] of [['medkit', 2], ['lampOil', 2], ['battery', 2], ['cannedFood', 2]] as [ItemId, number][]) {
      this.d.items.give(item, count, at);
    }
    this.d.events.emit('boss:killed', { name: 'Hansen, der Erste' });
    this.d.events.emit('hud:message', { text: 'Hansen, der Erste, ist tot. Im Stollen wird es still.' });
  }

  /** Lebt Hansen noch? */
  get bossAlive(): boolean {
    return this.caves[BOSS_CAVE]?.dwellers.some((d) => d.boss && d.respawnDay < NEVER) ?? false;
  }

  isDepleted(f: Feature): boolean {
    return f.def.kind === 'flint' ? f.flintLeft <= 0 : f.done;
  }

  // ---------------------------------------------------------------------------
  // Laufzeit & Spielstand
  // ---------------------------------------------------------------------------

  /** Licht der Öffnung folgt dem Tageslicht draußen. */
  update(daylight: number): void {
    const cave = this.current;
    if (!cave) return;
    const day = THREE.MathUtils.smoothstep(daylight, 0, 1);
    cave.exitMaterial.color.setRGB(0.12 + 0.75 * day, 0.15 + 0.78 * day, 0.22 + 0.76 * day);
    cave.exitLight.intensity = 2 + 18 * day;
    this.d.lights.request(cave.exitLight);
  }

  /** Höhle, in deren Innenraum `p` liegt (für alte Spielstände ohne Höhlen-Index). */
  caveAt(p: THREE.Vector3): Cave | null {
    for (const cave of this.caves) {
      if (Math.abs(p.y - cave.origin.y) < CAVE_SPACING / 2 && Math.hypot(p.x - cave.origin.x, p.z - cave.origin.z) < 200) return cave;
    }
    return null;
  }

  serialize(): CaveSave {
    const features: [number, number, number][] = [];
    for (const cave of this.caves) {
      for (const f of cave.features) {
        if (f.def.kind === 'flint' && f.flintLeft < FLINT_PER_NODE) features.push([cave.index, f.index, f.flintLeft]);
        else if ((f.def.kind === 'crate' || f.def.kind === 'mushroom') && f.done) features.push([cave.index, f.index, 0]);
      }
    }
    const dwellers: [number, number, number][] = [];
    for (const cave of this.caves) cave.dwellers.forEach((d, slot) => d.respawnDay > 0 && dwellers.push([cave.index, slot, d.respawnDay]));
    return {
      discovered: this.caves.filter((c) => c.discovered).map((c) => c.index),
      visited: this.caves.filter((c) => c.visited).map((c) => c.index),
      features,
      dwellers,
    };
  }

  load(data: CaveSave): void {
    for (const i of data.discovered ?? []) if (this.caves[i]) this.caves[i].discovered = true;
    for (const i of data.visited ?? []) if (this.caves[i]) this.caves[i].visited = true;
    for (const [c, i, value] of data.features ?? []) {
      const f = this.caves[c]?.features[i];
      if (!f) continue;
      if (f.def.kind === 'flint') f.flintLeft = Math.max(0, Math.min(FLINT_PER_NODE, value | 0));
      else f.done = true;
    }
    for (const [c, slot, day] of data.dwellers ?? []) {
      const d = this.caves[c]?.dwellers[slot];
      if (d && Number.isFinite(day)) d.respawnDay = Math.max(0, day | 0);
    }
  }
}
