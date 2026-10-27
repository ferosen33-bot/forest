import * as THREE from 'three';
import { isWeapon, rollWeapon, type WeaponMeta } from '../entities/items/Weapons';
import type { EventBus } from '../core/EventBus';
import type { Inventory } from './Inventory';
import type { WorldItems } from '../entities/items/WorldItems';
import type { ItemId } from '../entities/items/ItemDefs';
import type { Audio } from './Audio';

/**
 * Zentrale Stelle für "Spieler bekommt / verliert Items".
 * Passt nicht alles ins Inventar, fällt der Rest als physisches Item in die Welt.
 */
export class ItemService {
  /** Glück beim Würfeln gefundener Waffen (0 = normal; > 0 seltener zu besseren Stufen). */
  luck = 0;
  constructor(
    private readonly inventory: Inventory,
    private readonly worldItems: WorldItems,
    private readonly events: EventBus,
    private readonly audio: Audio,
  ) {}

  /**
   * @param overflowAt Hier landet, was nicht mehr ins Inventar passt.
   * @returns Anzahl, die tatsächlich ins Inventar ging.
   */
  give(item: ItemId, count: number, overflowAt: THREE.Vector3, durability?: number, weapon?: WeaponMeta): number {
    // Gefundene Waffen ohne Eigenschaften (Beute, Belohnungen) bekommen hier ihre Seltenheit.
    if (!weapon && isWeapon(item)) weapon = rollWeapon(Math.random, this.luck);
    const rest = this.inventory.add(item, count, durability, weapon);
    const taken = count - rest;
    if (taken > 0) {
      this.events.emit('item:collected', { item, count: taken });
      this.audio.play('pickup');
    }
    if (rest > 0) {
      this.worldItems.spawn(item, rest, overflowAt.clone().add(new THREE.Vector3(0, 0.3, 0)), { durability, weapon });
      this.events.emit('item:inventoryFull', { item, dropped: rest });
    }
    return taken;
  }

  /** Legt Items direkt in die Welt (nicht ins Inventar). */
  drop(item: ItemId, count: number, at: THREE.Vector3, weapon?: WeaponMeta): void {
    if (!weapon && isWeapon(item)) weapon = rollWeapon(Math.random, this.luck);
    this.worldItems.spawn(item, count, at.clone(), {
      weapon,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 1.5, 2, (Math.random() - 0.5) * 1.5),
    });
  }

  /** Wirft einen Stapel aus dem Inventar vor den Spieler. */
  throwFromSlot(slot: number, from: THREE.Vector3, direction: THREE.Vector3): void {
    const stack = this.inventory.takeFromSlot(slot);
    if (!stack) return;
    const pos = from.clone().addScaledVector(direction, 0.8);
    const velocity = direction.clone().multiplyScalar(3.5).add(new THREE.Vector3(0, 1.5, 0));
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, Math.PI / 2));
    this.worldItems.spawn(stack.id, stack.count, pos, {
      durability: stack.durability,
      weapon: stack.weapon,
      velocity,
      rotation,
      angularVelocity: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4),
    });
  }
}
