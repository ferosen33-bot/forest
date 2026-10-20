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

/** Was der Spieler gerade anvisiert. */
export type InteractionTarget =
  | { type: 'tree' | 'rock' | 'bush' | 'ground'; instance: VegetationInstance; hit: RaycastHit }
  | { type: 'item'; item: WorldItem; hit: RaycastHit }
  | { type: 'water' };

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

  constructor(
    private readonly physics: Physics,
    private readonly camera: THREE.Camera,
    private readonly player: Player,
    private readonly heightMap: HeightMap,
    private readonly vegetation: Vegetation,
    private readonly worldItems: WorldItems,
    private readonly harvest: HarvestSystem,
    private readonly items: ItemService,
    private readonly audio: Audio,
    private readonly events: EventBus,
    private readonly config: GameConfig,
  ) {}

  /** Strahl aus der Kameramitte; liefert das erste getroffene, zuordenbare Ziel. */
  raycast(maxDist: number): InteractionTarget | null {
    this.camera.getWorldPosition(this.origin);
    this.camera.getWorldDirection(this.dir);
    const hit = this.physics.raycast(this.origin, this.dir, maxDist, this.player.collisionShape);

    if (hit) {
      const item = this.worldItems.getByCollider(hit.collider);
      if (item) return { type: 'item', item, hit };
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
        return tool
          ? { key: 'LMB', action: 'Steine abschlagen', label: 'Felsen' }
          : { key: null, action: 'Axt benötigt', label: 'Felsen' };
      }
      case 'bush':
        if (target.hit.distance > INTERACT_REACH || !this.vegetation.hasRipeBerries(target.instance)) return null;
        return { key: 'E', action: 'Beeren pflücken', label: NAMES.bush };
      case 'ground':
        if (target.hit.distance > INTERACT_REACH) return null;
        return { key: 'E', action: 'Aufheben', label: NAMES[target.instance.kind] };
      case 'item': {
        if (target.hit.distance > INTERACT_REACH) return null;
        const name = getItem(target.item.itemId).name;
        return { key: 'E', action: 'Aufheben', label: target.item.count > 1 ? `${name} ×${target.item.count}` : name };
      }
      case 'water':
        return { key: 'E', action: 'Trinken', label: 'Wasser' };
    }
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
        this.items.give(item.itemId, item.count, point);
        break;
      }
      case 'water':
        this.player.stats.drink(this.config.stats.drinkAmount);
        this.audio.play('drink');
        this.events.emit('hud:message', { text: 'Erfrischend.' });
        break;
    }
  }
}
