import * as THREE from 'three';
import type { Physics, RaycastHit } from '../core/Physics';
import type { EventBus } from '../core/EventBus';
import type { Player } from '../entities/Player';
import type { Vegetation, VegetationInstance } from '../world/Vegetation';
import type { HeightMap } from '../world/HeightMap';
import type { WorldItem, WorldItems } from '../entities/items/WorldItems';
import { getItem, type ToolStats } from '../entities/items/ItemDefs';
import type { HarvestSystem } from './HarvestSystem';
import type { ItemService } from './ItemService';
import type { Audio } from './Audio';
import type { GameConfig } from '../config';
import type { BuildingSystem, Structure } from './building/BuildingSystem';
import type { EnemyDirector, HitZone } from './ai/EnemyDirector';
import type { Enemy } from '../entities/enemies/Enemy';
import type { Animal } from '../entities/animals/Animal';
import type { AnimalDirector } from './AnimalDirector';
import { isCookable, type Cooking } from './Cooking';
import type { ItemId } from '../entities/items/ItemDefs';

/** Was der Spieler gerade anvisiert. */
export type InteractionTarget =
  | { type: 'tree' | 'rock' | 'bush' | 'ground'; instance: VegetationInstance; hit: RaycastHit }
  | { type: 'item'; item: WorldItem; hit: RaycastHit }
  | { type: 'structure'; structure: Structure; hit: RaycastHit }
  | { type: 'enemy'; enemy: Enemy; zone: HitZone; hit: RaycastHit }
  | { type: 'animal'; animal: Animal; hit: RaycastHit }
  | { type: 'water' };

export interface InteractionDeps {
  physics: Physics;
  camera: THREE.Camera;
  player: Player;
  heightMap: HeightMap;
  vegetation: Vegetation;
  worldItems: WorldItems;
  harvest: HarvestSystem;
  building: BuildingSystem;
  enemies: EnemyDirector;
  animals: AnimalDirector;
  cooking: Cooking;
  items: ItemService;
  audio: Audio;
  events: EventBus;
  config: GameConfig;
  /** Darf gerade geschlafen werden (abends/nachts)? */
  canSleep: () => boolean;
  /** Wird beim Schlafen im Unterstand aufgerufen. */
  onSleep: (shelter: Structure) => void;
  /** Item in der Hand (Schnellzugriff). */
  heldItem: () => ItemId | null;
  /** Nimmt ein Stück des gehaltenen Items aus dem Inventar. */
  takeHeld: () => void;
  /** Öffnet eine Lagerkiste. */
  openStorage: (s: Structure) => void;
  /** Wandelt das gehaltene Item um (leere Schale → gefüllte). */
  transformHeld: (to: ItemId) => void;
}

/** Was `E` an einem Lagerfeuer gerade bewirkt. */
type FireAction = 'take' | 'cook' | 'toggle';

/** Inhalt des Interaktions-Hinweises im HUD. */
export interface Prompt {
  /** Taste, z. B. "E" oder "LMB"; null = nur Info (Aktion nicht möglich). */
  key: 'E' | 'LMB' | null;
  action: string;
  label?: string;
}

const NAMES: Record<string, string> = {
  pine: 'Kiefer',
  broadleaf: 'Laubbaum',
  rock: 'Felsen',
  bush: 'Beerenstrauch',
  stick: 'Stock',
  pebble: 'Stein',
};

/** Reichweite für "E"-Interaktionen in Metern. */
const INTERACT_REACH = 3.0;

/**
 * Interaktionssystem: ein Raycast pro Frame aus der Kamera bestimmt das anvisierte
 * Objekt und den passenden Hinweis. `E` führt die Aktion aus (Aufheben, Pflücken, Trinken);
 * Werkzeugschläge (`LMB`) übernimmt der ToolController, der dieselben Ziele nutzt.
 */
export class InteractionSystem {
  target: InteractionTarget | null = null;
  prompt: Prompt | null = null;

  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  private readonly physics: Physics;
  private readonly camera: THREE.Camera;
  private readonly player: Player;
  private readonly heightMap: HeightMap;
  private readonly vegetation: Vegetation;
  private readonly worldItems: WorldItems;
  private readonly harvest: HarvestSystem;
  private readonly building: BuildingSystem;
  private readonly items: ItemService;
  private readonly audio: Audio;
  private readonly events: EventBus;
  private readonly config: GameConfig;

  constructor(private readonly deps: InteractionDeps) {
    ({
      physics: this.physics,
      camera: this.camera,
      player: this.player,
      heightMap: this.heightMap,
      vegetation: this.vegetation,
      worldItems: this.worldItems,
      harvest: this.harvest,
      building: this.building,
      items: this.items,
      audio: this.audio,
      events: this.events,
      config: this.config,
    } = deps);
  }

  /** Strahl aus der Kameramitte; liefert das erste getroffene, zuordenbare Ziel. */
  raycast(maxDist: number): InteractionTarget | null {
    this.camera.getWorldPosition(this.origin);
    this.camera.getWorldDirection(this.dir);
    const hit = this.physics.raycast(this.origin, this.dir, maxDist, this.player.collisionShape);

    if (hit) {
      const item = this.worldItems.getByCollider(hit.collider);
      if (item) return { type: 'item', item, hit };
      const enemyHit = this.deps.enemies.getHitTarget(hit.collider);
      if (enemyHit) return { type: 'enemy', enemy: enemyHit.enemy, zone: enemyHit.zone, hit };
      const animal = this.deps.animals.getByCollider(hit.collider);
      if (animal) return { type: 'animal', animal, hit };
      const structure = this.building.getByCollider(hit.collider);
      if (structure) return { type: 'structure', structure, hit };
      const inst = this.vegetation.getByCollider(hit.collider);
      if (inst) {
        switch (inst.kind) {
          case 'pine':
          case 'broadleaf':
            return { type: 'tree', instance: inst, hit };
          case 'rock':
            return { type: 'rock', instance: inst, hit };
          case 'bush':
            return { type: 'bush', instance: inst, hit };
          case 'stick':
          case 'pebble':
            return { type: 'ground', instance: inst, hit };
        }
      }
    }

    // Wasser hat keinen Collider: Schnitt mit der Wasserebene prüfen (nur wenn davor nichts liegt).
    if (this.player.isInWater) return { type: 'water' };
    const water = this.heightMap.waterLevel;
    if (this.dir.y < -0.2) {
      const t = (water - this.origin.y) / this.dir.y;
      if (t > 0 && t < Math.min(INTERACT_REACH, hit?.distance ?? Infinity)) {
        const x = this.origin.x + this.dir.x * t;
        const z = this.origin.z + this.dir.z * t;
        if (this.heightMap.heightAt(x, z) < water - 0.05) return { type: 'water' };
      }
    }
    return null;
  }

  /**
   * Pro Frame aufrufen.
   * @param tool Werkzeug in der Hand (oder undefined) – bestimmt, welche Aktion angeboten wird.
   */
  update(tool: ToolStats | undefined): void {
    const reach = Math.max(INTERACT_REACH, tool?.reach ?? 0);
    this.target = this.player.stats.isDead ? null : this.raycast(reach);
    this.prompt = this.target ? this.promptFor(this.target, tool) : null;
  }

  private promptFor(target: InteractionTarget, tool: ToolStats | undefined): Prompt | null {
    switch (target.type) {
      case 'tree': {
        if (target.hit.distance > (tool?.reach ?? INTERACT_REACH)) return null;
        const label = NAMES[target.instance.kind];
        return tool ? { key: 'LMB', action: 'Fällen', label } : { key: null, action: 'Axt benötigt', label };
      }
      case 'rock': {
        if (target.hit.distance > (tool?.reach ?? INTERACT_REACH)) return null;
        if (this.harvest.isRockDepleted(target.instance)) return { key: null, action: 'Erschöpft', label: 'Felsen' };
        if (tool && tool.rockYield === 0) return { key: null, action: 'Ungeeignetes Werkzeug', label: 'Felsen' };
        return tool
          ? { key: 'LMB', action: 'Steine abschlagen', label: 'Felsen' }
          : { key: null, action: 'Axt benötigt', label: 'Felsen' };
      }
      case 'bush':
        if (target.hit.distance > INTERACT_REACH) return null;
        if (this.vegetation.hasFrozenBerries(target.instance)) return { key: null, action: 'Beeren erfroren', label: NAMES.bush };
        if (!this.vegetation.hasRipeBerries(target.instance)) return null;
        return { key: 'E', action: 'Beeren pflücken', label: NAMES.bush };
      case 'ground':
        if (target.hit.distance > INTERACT_REACH) return null;
        return { key: 'E', action: 'Aufheben', label: NAMES[target.instance.kind] };
      case 'item': {
        if (target.hit.distance > INTERACT_REACH) return null;
        const name = getItem(target.item.itemId).name;
        return { key: 'E', action: 'Aufheben', label: target.item.count > 1 ? `${name} ×${target.item.count}` : name };
      }
      case 'structure': {
        if (target.hit.distance > Math.max(INTERACT_REACH, tool?.reach ?? 0)) return null;
        const s = target.structure;
        const label = s.def.name;
        if (s.def.interaction === 'fire') {
          const cooking = this.deps.cooking;
          const n = cooking.cookingCount(s);
          const status = n > 0 ? `${label} · ${n}× brät (${Math.round(cooking.progress(s) * 100)} %)` : label;
          switch (this.fireAction(s)) {
            case 'take': {
              const n = cooking.readyCount(s);
              const what = n > 1 ? 'Gebratenes nehmen' : `${getItem(cooking.readyItem(s) ?? 'cookedMeat').name} nehmen`;
              return { key: 'E', action: `${what} (${n})`, label: status };
            }
            case 'cook':
              return { key: 'E', action: this.deps.heldItem() === 'rawFish' ? 'Fisch braten' : 'Fleisch braten', label: status };
            case 'toggle':
              return { key: 'E', action: s.lit ? 'Löschen' : 'Anzünden', label: status };
          }
        }
        if (s.def.interaction === 'light') return { key: 'E', action: s.lit ? 'Löschen' : 'Anzünden', label };
        if (s.def.interaction === 'trap') {
          return s.catch
            ? { key: 'E', action: `Fische herausnehmen (${s.catch})`, label }
            : { key: null, action: 'Noch leer – fängt mit der Zeit', label };
        }
        if (s.def.interaction === 'door') return { key: 'E', action: s.open ? 'Schließen' : 'Öffnen', label };
        if (s.def.interaction === 'storage') return { key: 'E', action: 'Öffnen', label };
        if (s.def.interaction === 'snare') return s.armed ? { key: null, action: 'Gespannt', label } : { key: 'E', action: 'Neu spannen', label };
        if (s.def.interaction === 'sleep') {
          return this.deps.canSleep()
            ? { key: 'E', action: 'Schlafen', label }
            : { key: null, action: 'Schlafen erst ab dem Abend', label };
        }
        return tool ? { key: 'LMB', action: 'Abreißen', label } : null;
      }
      case 'enemy':
        return null;
      case 'animal':
        if (!target.animal.isDead || target.hit.distance > INTERACT_REACH) return null;
        return { key: 'E', action: 'Ausnehmen', label: target.animal.name };
      case 'water':
        if (this.deps.heldItem() === 'bowl') return { key: 'E', action: 'Schale füllen', label: 'Wasser' };
        return { key: 'E', action: 'Trinken', label: 'Wasser' };
    }
  }

  /** Fertiges abnehmen hat Vorrang, dann auflegen (rohes Fleisch in der Hand), sonst an/aus. */
  private fireAction(s: Structure): FireAction {
    const cooking = this.deps.cooking;
    if (cooking.readyCount(s) > 0) return 'take';
    if (isCookable(this.deps.heldItem()) && cooking.canAdd(s)) return 'cook';
    return 'toggle';
  }

  /** Führt die `E`-Aktion für das aktuelle Ziel aus. */
  interact(): void {
    const target = this.target;
    if (!target || this.prompt?.key !== 'E') return;

    switch (target.type) {
      case 'bush':
        if (this.vegetation.harvestBerries(target.instance)) {
          this.vegetation.shake(target.instance, this.dir, 0.6);
          this.items.give('berries', 2 + Math.round(Math.random() * 2), this.player.position);
        }
        break;
      case 'ground': {
        const item = target.instance.kind === 'stick' ? 'stick' : 'stone';
        this.vegetation.remove(target.instance);
        this.items.give(item, 1, this.player.position);
        break;
      }
      case 'item': {
        const { item } = target;
        const point = new THREE.Vector3(item.mesh.position.x, item.mesh.position.y, item.mesh.position.z);
        // Erst entfernen, dann geben: ein voller Rucksack lässt den Rest wieder an derselben Stelle fallen.
        this.worldItems.remove(item);
        this.items.give(item.itemId, item.count, point, item.durability);
        break;
      }
      case 'structure': {
        const s = target.structure;
        if (s.def.interaction === 'fire') {
          const action = this.fireAction(s);
          if (action === 'take') this.deps.cooking.take(s);
          else if (action === 'cook') {
            if (this.deps.cooking.add(s, this.deps.heldItem()!)) this.deps.takeHeld();
          } else this.building.toggleFire(s);
        }
        else if (s.def.interaction === 'light') this.building.toggleFire(s);
        else if (s.def.interaction === 'trap' && s.catch) {
          const n = s.catch;
          s.catch = 0;
          this.items.give('rawFish', n, s.position.clone().setY(this.heightMap.waterLevel + 0.3));
          this.audio.play('stepWater', 0.8);
          this.events.emit('fish:caught', { count: n, trap: true });
        }
        else if (s.def.interaction === 'sleep') this.deps.onSleep(s);
        else if (s.def.interaction === 'door') this.building.toggleDoor(s);
        else if (s.def.interaction === 'storage') this.deps.openStorage(s);
        else if (s.def.interaction === 'snare') {
          this.building.setArmed(s, true);
          this.audio.play('place', 0.6);
        }
        break;
      }
      case 'animal':
        this.deps.animals.butcher(target.animal);
        break;
      case 'water':
        if (this.deps.heldItem() === 'bowl') {
          this.deps.transformHeld('bowlWater');
          this.audio.play('drink', 0.6);
          break;
        }
        this.player.stats.drink(this.config.stats.drinkAmount);
        this.audio.play('drink');
        this.events.emit('hud:message', { text: 'Erfrischend.' });
        break;
    }
  }
}
