import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import type { EventBus } from '../core/EventBus';
import { buildTown, LOOT_LABELS, type ContainerSpec, type DoorSpec, type LootKind } from '../world/TownMeshes';
import { pavedAt, type TownLayout } from '../world/Town';
import type { ItemId } from '../entities/items/ItemDefs';
import { deriveSeed, mulberry32 } from '../utils/random';
import type { ItemService } from './ItemService';
import type { Audio } from './Audio';

/** Beutetabelle eines Behälters: Anzahl Ziehungen und gewichtete Einträge [Item, Gewicht, min, max]. */
interface LootTable {
  rolls: [number, number];
  table: [ItemId | null, number, number, number][];
}

const LOOT: Record<LootKind, LootTable> = {
  fridge: { rolls: [1, 2], table: [['waterBottle', 4, 1, 2], ['cannedFood', 2, 1, 1], ['bottle', 2, 1, 1], [null, 2, 0, 0]] },
  cabinet: { rolls: [1, 2], table: [['cannedFood', 5, 1, 2], ['bottle', 2, 1, 1], ['painkillers', 1, 1, 1], ['battery', 1, 1, 1], [null, 2, 0, 0]] },
  wardrobe: { rolls: [1, 1], table: [['jacket', 2, 1, 1], ['backpack', 1, 1, 1], ['painkillers', 1, 1, 1], ['battery', 1, 1, 1], [null, 3, 0, 0]] },
  shelf: { rolls: [1, 3], table: [['cannedFood', 4, 1, 2], ['waterBottle', 3, 1, 1], ['battery', 2, 1, 1], ['painkillers', 1, 1, 1], ['bottle', 1, 1, 1], [null, 2, 0, 0]] },
  register: { rolls: [1, 1], table: [['battery', 3, 1, 2], ['painkillers', 1, 1, 1], ['flashlight', 1, 1, 1]] },
  toolbox: { rolls: [1, 2], table: [['machete', 1, 1, 1], ['flashlight', 2, 1, 1], ['battery', 2, 1, 2], ['torch', 1, 1, 1], ['arrow', 1, 3, 6]] },
  car: { rolls: [1, 1], table: [['waterBottle', 2, 1, 2], ['medkit', 2, 1, 1], ['flashlight', 1, 1, 1], ['cannedFood', 2, 1, 1], ['battery', 1, 1, 2], [null, 2, 0, 0]] },
  desk: { rolls: [1, 1], table: [['battery', 2, 1, 1], ['painkillers', 2, 1, 1], ['flashlight', 1, 1, 1], [null, 1, 0, 0]] },
};

/** Ab dieser Nähe zur Ortsmitte gilt die Stadt als entdeckt. */
const DISCOVER_RANGE_EXTRA = 25;

export interface LootContainer {
  spec: ContainerSpec;
  label: string;
  searched: boolean;
}

export interface SettlementSave {
  discovered: boolean;
  searched: number[];
}

export interface SettlementDeps {
  physics: Physics;
  town: TownLayout;
  seed: number;
  items: ItemService;
  audio: Audio;
  events: EventBus;
  /** Wände, große Möbel und Autos als Hindernisse für die Gegner-Wegfindung. */
  markObstacle: (x: number, z: number, yaw: number, halfX: number, halfZ: number) => void;
  /** Türöffnungen bleiben trotz angrenzender Wände passierbar. */
  markDoor: (door: DoorSpec) => void;
}

/**
 * Die verlassene Kleinstadt zur Laufzeit: Geometrie, Kollision, durchsuchbare Behälter
 * (Kühlschränke, Schränke, Regale, Kassen, Kofferräume …) mit festen, je Behälter ausgewürfelten
 * Fundstücken, Entdeckung und Spielstand. Den Plan liefert `world/Town.ts`.
 */
export class Settlement {
  readonly group: THREE.Group;
  readonly containers: LootContainer[] = [];
  discovered = false;
  private readonly byCollider = new Map<number, LootContainer>();
  private readonly notes = new Map<number, string>();
  private readonly townColliders = new Set<number>();

  constructor(private readonly d: SettlementDeps) {
    const t0 = performance.now();
    const model = buildTown(d.town, d.seed);
    this.group = model.group;
    for (const c of model.containers) this.containers.push({ spec: c, label: LOOT_LABELS[c.kind], searched: false });

    const body = d.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const s of model.colliders) {
      const collider = d.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(s.half.x, s.half.y, s.half.z)
          .setTranslation(s.position.x, s.position.y, s.position.z)
          .setRotation(s.quaternion)
          .setFriction(0.8)
          .setSensor(s.note !== undefined)
          .setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
        body,
      );
      if (s.note) {
        this.notes.set(collider.handle, s.note);
        continue;
      }
      this.townColliders.add(collider.handle);
      if (s.container !== undefined) this.byCollider.set(collider.handle, this.containers[s.container]);
      if (s.nav) d.markObstacle(s.position.x, s.position.z, s.yaw, s.half.x, s.half.z);
    }
    for (const door of model.doors) d.markDoor(door);
    console.info(
      `[Stadt] ${d.town.buildings.length} Gebäude, ${model.colliders.length} Kollider, ${this.containers.length} Behälter in ${(performance.now() - t0).toFixed(0)} ms`,
    );
  }

  get town(): TownLayout {
    return this.d.town;
  }

  /** Notiz unter dem Fadenkreuz (Id) oder undefined. */
  getNote(collider: RAPIER.Collider): string | undefined {
    return this.notes.get(collider.handle);
  }

  getContainer(collider: RAPIER.Collider): LootContainer | undefined {
    return this.byCollider.get(collider.handle);
  }

  /** Gehört der Collider zur Stadt (Böden, Wände …)? – für Schrittgeräusche. */
  isTownCollider(collider: RAPIER.Collider): boolean {
    return this.townColliders.has(collider.handle);
  }

  isPaved(x: number, z: number): boolean {
    return pavedAt(this.d.town, x, z);
  }

  /** Feste Fundstücke eines Behälters (aus Seed und Behälter-Nummer). */
  lootOf(c: LootContainer): [ItemId, number][] {
    const rng = mulberry32(deriveSeed(this.d.seed, `town-loot-${c.spec.id}`));
    const kind = c.spec.kind;
    const out: [ItemId, number][] = [];
    // Werkzeugkisten der Tankstelle und des Ladens: garantiert Machete bzw. Taschenlampe.
    const building = this.d.town.buildings[c.spec.building];
    if (kind === 'toolbox' && building?.kind === 'gas') out.push(['machete', 1]);
    if (kind === 'toolbox' && building?.kind === 'shop') out.push(['flashlight', 1], ['battery', 2]);
    const { rolls, table } = LOOT[kind];
    const n = rolls[0] + Math.floor(rng() * (rolls[1] - rolls[0] + 1));
    const total = table.reduce((s, e) => s + e[1], 0);
    for (let i = 0; i < n; i++) {
      let r = rng() * total;
      const entry = table.find((e) => (r -= e[1]) < 0) ?? table[0];
      const [item, , min, max] = entry;
      if (!item) continue;
      const count = min + Math.floor(rng() * (max - min + 1));
      const same = out.find((o) => o[0] === item);
      if (same) same[1] += count;
      else out.push([item, count]);
    }
    return out;
  }

  /** Durchsuchen: gibt die Fundstücke (oder meldet, dass nichts Brauchbares drin war). */
  search(c: LootContainer): void {
    if (c.searched) return;
    c.searched = true;
    const loot = this.lootOf(c);
    const at = c.spec.position.clone().setY(c.spec.position.y + 0.4);
    this.d.audio.play(c.spec.kind === 'car' || c.spec.kind === 'fridge' ? 'door' : 'chop', { volume: 0.5, position: at });
    if (loot.length === 0) this.d.events.emit('hud:message', { text: `${c.label}: nichts Brauchbares.` });
    for (const [item, count] of loot) this.d.items.give(item, count, at);
    this.d.events.emit('loot:searched', { kind: c.spec.kind, items: loot.map(([i]) => i) });
  }

  /** Erstes Betreten des Ortes. */
  updateDiscovery(player: THREE.Vector3): void {
    if (this.discovered) return;
    const t = this.d.town;
    if (Math.hypot(player.x - t.center.x, player.z - t.center.z) > t.radius + DISCOVER_RANGE_EXTRA) return;
    this.discovered = true;
    this.d.events.emit('hud:message', { text: `${t.name} – eine verlassene Stadt. Vielleicht gibt es hier noch Vorräte …` });
    this.d.events.emit('town:discovered', { name: t.name });
  }

  serialize(): SettlementSave {
    return { discovered: this.discovered, searched: this.containers.filter((c) => c.searched).map((c) => c.spec.id) };
  }

  load(data: SettlementSave): void {
    this.discovered = data.discovered === true;
    for (const id of data.searched ?? []) if (this.containers[id]) this.containers[id].searched = true;
  }
}
