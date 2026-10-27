import * as THREE from 'three';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import type { EventBus } from '../core/EventBus';
import { buildTown, LOOT_LABELS, type ColliderSpec, type ContainerSpec, type DoorSpec, type LootKind, type OpeningSpec } from '../world/TownMeshes';
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
  fridge: { rolls: [1, 2], table: [['kitchenKnife', 1, 1, 1], ['cleaver', 1, 1, 1], ['waterBottle', 4, 1, 2], ['cannedFood', 2, 1, 1], ['bottle', 2, 1, 1], [null, 2, 0, 0]] },
  cabinet: { rolls: [1, 2], table: [['cannedFood', 5, 1, 2], ['bottle', 2, 1, 1], ['painkillers', 1, 1, 1], ['battery', 1, 1, 1], ['lampOil', 1, 1, 1], [null, 2, 0, 0]] },
  wardrobe: { rolls: [1, 1], table: [['jacket', 2, 1, 1], ['backpack', 1, 1, 1], ['painkillers', 1, 1, 1], ['battery', 1, 1, 1], ['baseballBat', 1, 1, 1], ['revolver', 0.5, 1, 1], ['shells', 1, 2, 5], ['golfClub', 1, 1, 1], ['katana', 0.3, 1, 1], [null, 3, 0, 0]] },
  shelf: { rolls: [1, 3], table: [['cannedFood', 4, 1, 2], ['nails', 1, 3, 8], ['waterBottle', 3, 1, 1], ['battery', 2, 1, 1], ['painkillers', 1, 1, 1], ['bottle', 1, 1, 1], [null, 2, 0, 0]] },
  register: { rolls: [1, 1], table: [['battery', 3, 1, 2], ['painkillers', 1, 1, 1], ['flashlight', 1, 1, 1]] },
  toolbox: { rolls: [1, 2], table: [['machete', 1, 1, 1], ['pipeWrench', 2, 1, 1], ['crowbar', 2, 1, 1], ['sledgehammer', 1, 1, 1], ['flashlight', 2, 1, 1], ['battery', 2, 1, 2], ['torch', 1, 1, 1], ['arrow', 1, 3, 6], ['lampOil', 2, 1, 1], ['modShock', 1, 1, 1], ['nails', 3, 4, 12]] },
  car: { rolls: [1, 1], table: [['crowbar', 1, 1, 1], ['baseballBat', 1, 1, 1], ['waterBottle', 2, 1, 2], ['medkit', 2, 1, 1], ['flashlight', 1, 1, 1], ['cannedFood', 2, 1, 1], ['battery', 1, 1, 2], ['lampOil', 2, 1, 1], ['pistol', 1, 1, 1], ['pistolAmmo', 2, 4, 10], ['baton', 1, 1, 1], ['golfClub', 1, 1, 1], [null, 2, 0, 0]] },
  desk: { rolls: [1, 1], table: [['battery', 2, 1, 1], ['painkillers', 2, 1, 1], ['flashlight', 1, 1, 1], ['pistolAmmo', 1, 4, 8], [null, 1, 0, 0]] },
  caravan: { rolls: [1, 2], table: [['cannedFood', 3, 1, 2], ['waterBottle', 3, 1, 2], ['flashlight', 1, 1, 1], ['battery', 2, 1, 2], ['jacket', 1, 1, 1], ['medkit', 1, 1, 1], ['lampOil', 1, 1, 1], ['kitchenKnife', 1, 1, 1], [null, 2, 0, 0]] },
  pack: { rolls: [1, 3], table: [['cannedFood', 3, 1, 2], ['waterBottle', 3, 1, 1], ['jerky', 2, 1, 2], ['painkillers', 2, 1, 1], ['battery', 2, 1, 2], ['flashlight', 1, 1, 1], ['medkit', 1, 1, 1], ['arrow', 1, 3, 6], ['torch', 1, 1, 1], [null, 2, 0, 0]] },
  ammo: { rolls: [1, 2], table: [['rifleAmmo', 4, 3, 8], ['shells', 2, 2, 5], ['jerky', 2, 1, 2], ['huntingRifle', 0.5, 1, 1], ['arrow', 2, 4, 8], ['hide', 1, 1, 1], [null, 1, 0, 0]] },
  crate: { rolls: [1, 2], table: [['nails', 3, 4, 10], ['pitchfork', 1, 1, 1], ['shells', 1, 2, 4], ['lampOil', 2, 1, 1], ['cannedFood', 1, 1, 2], ['pipeWrench', 1, 1, 1], [null, 2, 0, 0]] },
};

/** Erste Eindrücke beim Betreten der kleinen Orte. */
const HAMLET_INTROS: Partial<Record<string, string>> = {
  farm: 'ein verlassener Hof. Das Stalltor steht offen, kein Tier ist zu hören.',
  hamlet: 'ein Weiler an der Landstraße. Die Fensterläden sind zu, im Gasthof brennt kein Licht.',
  camp: 'ein Campingplatz am Wasser. Die Zelte stehen noch, als wären alle nur kurz weggegangen.',
  sawmill: 'das Sägewerk. Die Säge ist mitten im Stamm stehen geblieben.',
};

/** Ab dieser Nähe zur Ortsmitte gilt die Stadt als entdeckt. */
const DISCOVER_RANGE_EXTRA = 25;

export interface LootContainer {
  spec: ContainerSpec;
  label: string;
  searched: boolean;
  /** Ort, zu dem der Behälter gehört, und das Gebäude darin (−1 = keins). */
  town: TownLayout;
  building: number;
}

export interface SettlementSave {
  discovered: boolean;
  searched: number[];
  /** Entdeckte kleine Orte (Namen, seit Meilenstein 52). */
  found?: string[];
}

export interface SettlementDeps {
  physics: Physics;
  /** Altwasser zuerst (die Nummern seiner Behälter bleiben so mit alten Spielständen gleich), dann die kleinen Orte. */
  towns: TownLayout[];
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
 * Die Orte zur Laufzeit – Altwasser, die kleinen Orte und die Dinge an den Wegen.
 * Die verlassene Kleinstadt zur Laufzeit: Geometrie, Kollision, durchsuchbare Behälter
 * (Kühlschränke, Schränke, Regale, Kassen, Kofferräume …) mit festen, je Behälter ausgewürfelten
 * Fundstücken, Entdeckung und Spielstand. Den Plan liefert `world/Town.ts`.
 */
export class Settlement {
  readonly group: THREE.Group;
  readonly containers: LootContainer[] = [];
  /** Fenster und Türen der Wohnhäuser (zum Verbarrikadieren). */
  readonly openings: OpeningSpec[] = [];
  discovered = false;
  /** Entdeckte kleine Orte. */
  readonly found = new Set<string>();
  /** Erster Gebäude-Index je Ort (global eindeutig, für Häuser als Basis). */
  private readonly buildingBase = new Map<TownLayout, number>();
  private readonly byCollider = new Map<number, LootContainer>();
  private readonly notes = new Map<number, string>();
  private readonly townColliders = new Set<number>();
  /** Gebäude-Index → Notiz-Id der Wohnhäuser (Mias Elternhaus ist das mit dem Brief an Marta). */
  private readonly houseNotes = new Map<number, string>();

  constructor(private readonly d: SettlementDeps) {
    const t0 = performance.now();
    this.group = new THREE.Group();
    this.group.name = 'Settlements';
    const body = d.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    let buildings = 0;
    let colliders = 0;
    for (const town of d.towns) {
      const model = buildTown(town, d.seed);
      const containerBase = this.containers.length;
      const base = buildings;
      this.buildingBase.set(town, base);
      buildings += town.buildings.length;
      colliders += model.colliders.length;
      this.group.add(model.group);
      // Nur Altwasser kennt die Notiz-Zuordnung der Wohnhäuser (Pauls Uhr im Kleiderschrank).
      if (town === d.towns[0]) for (const [k, v] of model.houseNotes) this.houseNotes.set(k, v);
      for (const o of model.openings) this.openings.push({ ...o, id: this.openings.length, building: o.building + base });
      for (const c of model.containers) {
        this.containers.push({ spec: { ...c, id: c.id + containerBase }, label: LOOT_LABELS[c.kind], searched: false, town, building: c.building });
      }
      this.addColliders(body, model.colliders, containerBase);
      for (const door of model.doors) d.markDoor(door);
    }
    console.info(
      `[Orte] ${d.towns.length} Orte, ${buildings} Gebäude, ${colliders} Kollider, ${this.containers.length} Behälter in ${(performance.now() - t0).toFixed(0)} ms`,
    );
  }

  private addColliders(body: RAPIER.RigidBody, list: ColliderSpec[], containerBase: number): void {
    const d = this.d;
    for (const s of list) {
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
      if (s.container !== undefined) this.byCollider.set(collider.handle, this.containers[s.container + containerBase]);
      if (s.nav) d.markObstacle(s.position.x, s.position.z, s.yaw, s.half.x, s.half.z);
    }
  }

  /** Altwasser. */
  get town(): TownLayout {
    return this.d.towns[0];
  }

  /** Alle Orte mit Häusern (ohne die Dinge an den Wegen). */
  get towns(): TownLayout[] {
    return this.d.towns.filter((t) => t.kind !== 'road');
  }

  /** Name des Ortes, zu dem ein Gebäude (globaler Index) gehört. */
  townOf(building: number): TownLayout | undefined {
    let best: TownLayout | undefined;
    for (const [t, base] of this.buildingBase) if (building >= base && building < base + t.buildings.length) best = t;
    return best;
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
    return this.d.towns.some((t) => t.kind !== 'road' && Math.hypot(x - t.center.x, z - t.center.z) < t.radius + 6 && pavedAt(t, x, z));
  }

  /** Feste Fundstücke eines Behälters (aus Seed und Behälter-Nummer). */
  lootOf(c: LootContainer): [ItemId, number][] {
    const rng = mulberry32(deriveSeed(this.d.seed, `town-loot-${c.spec.id}`));
    const kind = c.spec.kind;
    const out: [ItemId, number][] = [];
    // Werkzeugkisten der Tankstelle und des Ladens: garantiert Machete bzw. Taschenlampe.
    const building = c.town.buildings[c.building];
    const main = c.town === this.d.towns[0];
    if (kind === 'toolbox' && building?.kind === 'gas') out.push(['machete', 1]);
    if (kind === 'toolbox' && building?.kind === 'shop') out.push(['flashlight', 1], ['battery', 2]);
    // Mias Elternhaus: Papas Taschenuhr liegt im Kleiderschrank.
    if (main && kind === 'wardrobe' && this.houseNotes.get(c.building) === 'brief') out.push(['watch', 1]);
    // Scheunen: immer etwas fürs Bauen.
    if (kind === 'toolbox' && building?.kind === 'barn') out.push(['nails', 8]);
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

  /** Erstes Betreten eines Ortes. */
  updateDiscovery(player: THREE.Vector3): void {
    const main = this.d.towns[0];
    for (const t of this.d.towns) {
      if (t.kind === 'road') continue;
      const isMain = t === main;
      if (isMain ? this.discovered : this.found.has(t.name)) continue;
      if (Math.hypot(player.x - t.center.x, player.z - t.center.z) > t.radius + (isMain ? DISCOVER_RANGE_EXTRA : 6)) continue;
      if (isMain) {
        this.discovered = true;
        this.d.events.emit('hud:message', { text: `${t.name} – eine verlassene Stadt. Vielleicht gibt es hier noch Vorräte …` });
        this.d.events.emit('town:discovered', { name: t.name });
      } else {
        this.found.add(t.name);
        this.d.events.emit('hud:message', { text: `${t.name} – ${HAMLET_INTROS[t.kind ?? 'hamlet'] ?? 'verlassen.'}` });
        this.d.events.emit('place:discovered', { kind: 'hamlet', name: t.name });
      }
    }
  }

  serialize(): SettlementSave {
    return { discovered: this.discovered, searched: this.containers.filter((c) => c.searched).map((c) => c.spec.id), found: [...this.found] };
  }

  load(data: SettlementSave): void {
    this.discovered = data.discovered === true;
    for (const id of data.searched ?? []) if (this.containers[id]) this.containers[id].searched = true;
    for (const name of data.found ?? []) if (typeof name === 'string') this.found.add(name);
  }
}
