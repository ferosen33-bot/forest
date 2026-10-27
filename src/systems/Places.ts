import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import type { EventBus } from '../core/EventBus';
import type { HeightMap } from '../world/HeightMap';
import { BIOME_LABELS, type BiomeName } from '../world/Biomes';
import type { PlaceKind, PlaceSite } from '../world/Places';
import { buildPlace, PLACE_LOOT_LABELS, type PlaceLight, type PlaceLootKind } from '../world/PlaceMeshes';
import { FireEffect } from '../entities/FireEffect';
import type { ItemId } from '../entities/items/ItemDefs';
import { deriveSeed, mulberry32 } from '../utils/random';
import type { ItemService } from './ItemService';
import type { Audio } from './Audio';
import type { LightPool, LightRequest } from './LightPool';

/**
 * Die besonderen Orte zur Laufzeit (Absturzstelle, Zeche, Hütte im Moor, Funkstation): Modelle,
 * Kollision, durchsuchbare Behälter, Notizen, Laternen und Warnlicht, Entdeckung und Spielstand.
 * Dazu die Gebiete der Insel: Wer zum ersten Mal ins Gebirge, ins Moor oder an die Klippen kommt,
 * bekommt eine Meldung.
 */

interface LootTable {
  rolls: [number, number];
  table: [ItemId | null, number, number, number][];
}

const LOOT: Record<PlaceLootKind, LootTable> = {
  suitcase: { rolls: [1, 2], table: [['jacket', 2, 1, 1], ['painkillers', 2, 1, 1], ['waterBottle', 2, 1, 1], ['watch', 1, 1, 1], ['battery', 1, 1, 1], [null, 2, 0, 0]] },
  cockpit: { rolls: [2, 2], table: [['flashlight', 3, 1, 1], ['battery', 3, 1, 2], ['waterBottle', 1, 1, 1]] },
  medbox: { rolls: [1, 2], table: [['medkit', 3, 1, 1], ['painkillers', 2, 1, 2]] },
  locker: { rolls: [1, 2], table: [['fireAxe', 1, 1, 1], ['crowbar', 1, 1, 1], ['jacket', 2, 1, 1], ['backpack', 1, 1, 1], ['battery', 2, 1, 2], ['cannedFood', 2, 1, 1], [null, 1, 0, 0]] },
  toolbox: { rolls: [1, 2], table: [['axe', 1, 1, 1], ['sledgehammer', 1, 1, 1], ['pipeWrench', 1, 1, 1], ['lampOil', 3, 1, 2], ['torch', 2, 1, 1], ['battery', 1, 1, 1], ['modFire', 1, 1, 1]] },
  crate: { rolls: [1, 2], table: [['cannedFood', 3, 1, 2], ['waterBottle', 2, 1, 2], ['lampOil', 2, 1, 1], ['arrow', 1, 4, 8], [null, 1, 0, 0]] },
  chest: { rolls: [1, 2], table: [['hide', 2, 1, 2], ['arrow', 2, 3, 6], ['berries', 2, 2, 4], ['mushroom', 1, 1, 3], ['furCoat', 1, 1, 1]] },
  shelf: { rolls: [1, 2], table: [['cannedFood', 2, 1, 1], ['bottle', 2, 1, 1], ['lampOil', 2, 1, 1], ['mushroom', 1, 1, 2], [null, 1, 0, 0]] },
  desk: { rolls: [1, 2], table: [['battery', 3, 1, 2], ['flashlight', 1, 1, 1], ['painkillers', 1, 1, 1], ['cannedFood', 1, 1, 1]] },
  spares: { rolls: [1, 1], table: [['lampOil', 3, 1, 2], ['battery', 1, 1, 1]] },
  safe: { rolls: [1, 1], table: [['battery', 2, 2, 3], ['medkit', 1, 1, 1]] },
  sacristy: { rolls: [1, 2], table: [['sabre', 1, 1, 1], ['lampOil', 2, 1, 1], ['painkillers', 1, 1, 1], ['bottle', 2, 1, 1], ['cannedFood', 1, 1, 1]] },
  stash: { rolls: [2, 3], table: [['sabre', 1, 1, 1], ['fireAxe', 1, 1, 1], ['medkit', 2, 1, 1], ['fireArrow', 2, 3, 6], ['cannedFood', 2, 2, 3], ['battery', 1, 1, 2], ['painkillers', 1, 1, 2], ['modCaustic', 1, 1, 1], ['modBleed', 1, 1, 1]] },
  oilstore: { rolls: [1, 1], table: [['lampOil', 3, 2, 3], ['bottle', 1, 1, 2]] },
};

/** Garantierte Fundstücke (damit sich der Weg lohnt). */
const GUARANTEED: Partial<Record<PlaceLootKind, [ItemId, number][]>> = {
  cockpit: [['flashlight', 1]],
  medbox: [['medkit', 1]],
  toolbox: [['axe', 1]],
  // Was die Geschichte braucht, liegt sicher dort.
  spares: [['enginePart', 1]],
  safe: [['documents', 1]],
  // Wer übers Meer kommt, wird belohnt.
  stash: [['molotov', 2]],
  oilstore: [['lampOil', 3]],
};

export interface PlaceContainer {
  id: number;
  place: PlaceKind;
  kind: PlaceLootKind;
  label: string;
  position: THREE.Vector3;
  searched: boolean;
}

interface PlaceRuntime {
  site: PlaceSite;
  group: THREE.Group;
  discovered: boolean;
  fires: FireEffect[];
  lights: (LightRequest & { base: number; mode: PlaceLight['mode']; phase: number })[];
  beacons: THREE.Mesh[];
  spinners: { object: THREE.Object3D; speed: number }[];
  beams: THREE.Mesh[];
}

export interface PlacesSave {
  discovered: PlaceKind[];
  searched: number[];
  biomes: BiomeName[];
}

export interface PlacesDeps {
  physics: Physics;
  heightMap: HeightMap;
  seed: number;
  sites: PlaceSite[];
  items: ItemService;
  audio: Audio;
  events: EventBus;
  lights: LightPool;
  /** Wände und große Teile als Hindernis für die Wegfindung. */
  markObstacle: (x: number, z: number, yaw: number, halfX: number, halfZ: number) => void;
}

export class Places {
  readonly group = new THREE.Group();
  readonly places: PlaceRuntime[] = [];
  readonly containers: PlaceContainer[] = [];
  private readonly byCollider = new Map<number, PlaceContainer>();
  private readonly notes = new Map<number, string>();
  private readonly uses = new Map<number, { id: string; place: PlaceKind }>();
  private readonly biomesSeen = new Set<BiomeName>(['forest']);
  private biomeTimer = 0;
  private time = 0;

  constructor(private readonly d: PlacesDeps) {
    this.group.name = 'Places';
    const body = d.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const up = new THREE.Vector3(0, 1, 0);
    for (const site of d.sites) {
      const model = buildPlace(site.kind, d.seed, site.position, site.yaw, d.heightMap);
      const g = model.group;
      g.position.copy(site.position);
      g.rotation.y = site.yaw;
      g.updateMatrixWorld(true);
      this.group.add(g);
      const rot = new THREE.Quaternion().setFromAxisAngle(up, site.yaw);
      const toWorld = (p: THREE.Vector3) => p.clone().applyMatrix4(g.matrixWorld);

      for (const c of model.colliders) {
        const p = toWorld(c.position);
        const q = rot.clone().multiply(c.quaternion);
        d.physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(c.half.x, c.half.y, c.half.z)
            .setTranslation(p.x, p.y, p.z)
            .setRotation(q)
            .setFriction(0.8)
            .setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
          body,
        );
        if (c.nav && c.half.y > 0.3) {
          const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
          d.markObstacle(p.x, p.z, yaw, c.half.x, c.half.z);
        }
      }
      // Behälter und Notizen: kleine Sensoren zum Anvisieren.
      for (const spec of model.containers) {
        const p = toWorld(spec.position);
        const container: PlaceContainer = {
          id: this.containers.length,
          place: site.kind,
          kind: spec.kind,
          label: PLACE_LOOT_LABELS[spec.kind],
          position: p,
          searched: false,
        };
        this.containers.push(container);
        const col = d.physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.4, 0.3, 0.4).setTranslation(p.x, p.y, p.z).setSensor(true).setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
          body,
        );
        this.byCollider.set(col.handle, container);
      }
      for (const u of model.uses) {
        const p = toWorld(u.position);
        const col = d.physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.4, 0.3, 0.35).setTranslation(p.x, p.y, p.z).setSensor(true).setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
          body,
        );
        this.uses.set(col.handle, { id: u.id, place: site.kind });
      }
      for (const n of model.notes) {
        const p = toWorld(n.position);
        const col = d.physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.2, 0.08, 0.2).setTranslation(p.x, p.y + 0.04, p.z).setSensor(true).setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
          body,
        );
        this.notes.set(col.handle, n.id);
      }
      const fires = model.fires.map((f) => {
        const fire = new FireEffect(f.size);
        fire.object.position.copy(f.position);
        g.add(fire.object);
        return fire;
      });
      const lights = model.lights.map((l, i) => ({
        position: toWorld(l.position),
        color: l.color,
        intensity: 0,
        distance: l.distance,
        base: l.intensity,
        mode: l.mode,
        phase: i * 1.7,
      }));
      this.places.push({ site, group: g, discovered: false, fires, lights, beacons: model.beacons, spinners: model.spinners, beams: model.beams });
    }
    console.info(`[Orte] ${this.places.map((p) => p.site.name).join(', ')} · ${this.containers.length} Behälter`);
  }

  getContainer(collider: RAPIER.Collider): PlaceContainer | undefined {
    return this.byCollider.get(collider.handle);
  }

  /** Benutzbares Ding unter dem Fadenkreuz (Funkgerät …). */
  getUse(collider: RAPIER.Collider): { id: string; place: PlaceKind } | undefined {
    return this.uses.get(collider.handle);
  }

  /** Lage eines Ortes (für Erzählung und Ziele). */
  site(kind: PlaceKind): PlaceSite | undefined {
    return this.places.find((p) => p.site.kind === kind)?.site;
  }

  getNote(collider: RAPIER.Collider): string | undefined {
    return this.notes.get(collider.handle);
  }

  owns(container: unknown): container is PlaceContainer {
    return this.containers.includes(container as PlaceContainer);
  }

  /** Feste Fundstücke eines Behälters (aus Seed und Behälter-Nummer). */
  lootOf(c: PlaceContainer): [ItemId, number][] {
    const rng = mulberry32(deriveSeed(this.d.seed, `place-loot-${c.id}`));
    const out: [ItemId, number][] = (GUARANTEED[c.kind] ?? []).map(([i, n]) => [i, n]);
    const { rolls, table } = LOOT[c.kind];
    const n = rolls[0] + Math.floor(rng() * (rolls[1] - rolls[0] + 1));
    const total = table.reduce((s, e) => s + e[1], 0);
    for (let i = 0; i < n; i++) {
      let r = rng() * total;
      const [item, , min, max] = table.find((e) => (r -= e[1]) < 0) ?? table[0];
      if (!item) continue;
      const count = min + Math.floor(rng() * (max - min + 1));
      const same = out.find((o) => o[0] === item);
      if (same) same[1] += count;
      else out.push([item, count]);
    }
    return out;
  }

  search(c: PlaceContainer): void {
    if (c.searched) return;
    c.searched = true;
    const loot = this.lootOf(c);
    const at = c.position.clone().setY(c.position.y + 0.3);
    this.d.audio.play(c.kind === 'locker' || c.kind === 'cockpit' ? 'door' : 'chop', { volume: 0.5, position: at });
    if (loot.length === 0) this.d.events.emit('hud:message', { text: `${c.label}: nichts Brauchbares.` });
    for (const [item, count] of loot) this.d.items.give(item, count, at);
    this.d.events.emit('loot:searched', { kind: c.kind, items: loot.map(([i]) => i) });
  }

  /** Entdeckte Orte für die Karte. */
  get markers(): { x: number; z: number; name: string; kind: PlaceKind }[] {
    return this.places.filter((p) => p.discovered).map((p) => ({ x: p.site.position.x, z: p.site.position.z, name: p.site.name, kind: p.site.kind }));
  }

  /** Bereiche, in denen keine Zufallsereignisse oder Lager entstehen sollen. */
  get areas(): { x: number; z: number; radius: number }[] {
    return this.places.map((p) => ({ x: p.site.position.x, z: p.site.position.z, radius: p.site.radius + 20 }));
  }

  update(dt: number, player: THREE.Vector3, isNight: boolean, underground: boolean): void {
    this.time += dt;
    if (!underground) {
      this.updateDiscovery(player);
      this.updateBiome(dt, player);
    }
    for (const p of this.places) {
      const near = p.site.position.distanceToSquared(player) < 200 * 200;
      for (const f of p.fires) if (near) f.update(dt);
      // Warnlicht am Mast: kurzes, kräftiges Blinken alle 1,6 s (von weit her zu sehen).
      const blink = (this.time % 1.6) < 0.18 ? 1 : 0;
      for (const b of p.beacons) (b.material as THREE.MeshStandardMaterial).emissiveIntensity = blink * (isNight ? 40 : 12);
      // Leuchtfeuer: dreht sich immer, der Strahl ist nur in der Dämmerung und nachts zu sehen – auch von drüben.
      for (const s of p.spinners) s.object.rotation.y += s.speed * dt;
      for (const beam of p.beams) {
        const u = (beam.material as THREE.ShaderMaterial).uniforms.uOpacity;
        u.value = THREE.MathUtils.damp(u.value, isNight && !underground ? 0.8 : 0, 1.5, dt);
        beam.visible = u.value > 0.005;
      }
      if (!near || underground) continue;
      for (const l of p.lights) {
        if (l.mode === 'lamp') l.intensity = isNight ? l.base * (0.9 + 0.1 * Math.sin(this.time * 7 + l.phase) * Math.sin(this.time * 3.1)) : 0;
        else if (l.mode === 'fire') l.intensity = l.base * (p.fires[0]?.flicker ?? 1);
        else if (l.mode === 'flicker') {
          // Defekte Röhre: meist an, setzt in unregelmäßigen Abständen kurz aus.
          const n = Math.sin(this.time * 13 + l.phase) * Math.sin(this.time * 4.7 + l.phase * 2);
          l.intensity = n > 0.82 ? l.base * 0.1 : l.base * (0.85 + 0.15 * Math.sin(this.time * 50));
        }
        else l.intensity = isNight ? blink * 30 : 0;
        if (l.intensity > 0) this.d.lights.request(l);
      }
    }
  }

  private updateDiscovery(player: THREE.Vector3): void {
    for (const p of this.places) {
      if (p.discovered) continue;
      if (Math.hypot(player.x - p.site.position.x, player.z - p.site.position.z) > p.site.radius + 10) continue;
      p.discovered = true;
      const text: Record<PlaceKind, string> = {
        crash: 'Ein Flugzeugwrack. Koffer liegen verstreut im Wald …',
        mine: 'Die alte Zeche. Der Stollen führt tief in den Berg.',
        hut: 'Eine Hütte auf Pfählen, mitten im Moor. Vor der Tür hängen Knochen.',
        radio: 'Eine Funkstation auf den Klippen. Das Licht am Mast blinkt noch.',
        ferry: 'Die Fähre, die nie angekommen ist. Sie liegt auf dem Riff, als wäre sie gestern aufgelaufen.',
        chapel: 'Eine Kapelle mit Friedhof. Einige Gräber sind offen – von innen.',
        lab: 'Eine Forschungsstation, hoch über der Zeche. Daneben ein leerer Landeplatz.',
        stones: 'Ein Kreis aus aufgerichteten Steinen. Auf dem Altar in der Mitte leuchtet etwas.',
        lighthouse: 'Ein Leuchtturm. Sein Feuer dreht sich noch – jemand hat es lange am Brennen gehalten.',
        smugglers: 'Kisten unter einer Plane, ein Boot kieloben. Hier hat jemand Ware versteckt.',
      };
      this.d.events.emit('hud:message', { text: `${p.site.name} – ${text[p.site.kind]}` });
      this.d.events.emit('place:discovered', { kind: p.site.kind, name: p.site.name });
    }
  }

  private updateBiome(dt: number, player: THREE.Vector3): void {
    this.biomeTimer -= dt;
    if (this.biomeTimer > 0) return;
    this.biomeTimer = 1;
    const b = this.d.heightMap.biomes.dominant(player.x, player.z);
    if (this.biomesSeen.has(b)) return;
    this.biomesSeen.add(b);
    const text: Record<BiomeName, string> = {
      forest: '',
      highland: 'Die Luft wird kalt und dünn. Über dir ragen Gipfel mit ewigem Schnee auf.',
      swamp: 'Der Boden gibt nach, schwarzes Wasser steht zwischen toten Bäumen.',
      cliffs: 'Die Küste bricht steil ins Meer ab. Wind pfeift über die Heide.',
    };
    this.d.events.emit('hud:message', { text: `${BIOME_LABELS[b]} – ${text[b]}` });
    this.d.events.emit('biome:entered', { name: b });
  }

  serialize(): PlacesSave {
    return {
      discovered: this.places.filter((p) => p.discovered).map((p) => p.site.kind),
      searched: this.containers.filter((c) => c.searched).map((c) => c.id),
      biomes: [...this.biomesSeen],
    };
  }

  load(data: PlacesSave): void {
    for (const p of this.places) p.discovered = data.discovered?.includes(p.site.kind) ?? false;
    for (const id of data.searched ?? []) if (this.containers[id]) this.containers[id].searched = true;
    for (const b of data.biomes ?? []) this.biomesSeen.add(b);
  }
}
