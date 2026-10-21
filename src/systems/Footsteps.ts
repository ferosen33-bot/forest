import * as THREE from 'three';
import type { Audio, SoundId } from './Audio';
import type { HeightMap } from '../world/HeightMap';
import type { Physics } from '../core/Physics';
import type { BuildingSystem } from './building/BuildingSystem';
import type { Player } from '../entities/Player';
import type { EventBus } from '../core/EventBus';

export type Surface = 'grass' | 'sand' | 'rock' | 'wood' | 'water';

const SOUND: Record<Surface, SoundId> = {
  grass: 'stepGrass',
  sand: 'stepSand',
  rock: 'stepRock',
  wood: 'stepWood',
  water: 'stepWater',
};

/**
 * Untergrund an einer Position – nach denselben Regeln, nach denen das Terrain eingefärbt wird
 * (Strand knapp über dem Wasser, Fels an steilen Hängen und Gipfeln).
 */
export function surfaceAt(hm: HeightMap, x: number, z: number, submersion: number, onStructure: boolean): Surface {
  if (submersion > 0.05) return 'water';
  if (onStructure) return 'wood';
  const h = hm.heightAt(x, z);
  if (h < hm.waterLevel + 2.0) return 'sand';
  const n = hm.normalAt(x, z);
  if (1 - n[1] > 0.33 || h > 46) return 'rock';
  return 'grass';
}

/** Schrittgeräusche für Spieler (synchron zum Head-Bob) und Gegner (synchron zur Laufanimation). */
export class Footsteps {
  private lastStep = 0;
  private swimTimer = 0;
  private readonly down = new THREE.Vector3(0, -1, 0);
  private readonly origin = new THREE.Vector3();

  constructor(
    private readonly audio: Audio,
    private readonly heightMap: HeightMap,
    private readonly physics: Physics,
    private readonly building: BuildingSystem,
    events: EventBus,
  ) {
    events.on('player:landed', ({ impact }) => this.audio.play('land', Math.min(1, impact / 12)));
  }

  updatePlayer(dt: number, player: Player): void {
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    if (player.swimming) {
      // Schwimmzüge statt Schritte.
      this.swimTimer -= dt;
      if (speed > 0.6 && this.swimTimer <= 0) {
        this.swimTimer = 0.85;
        this.audio.play('stepWater', 0.35);
      }
      return;
    }
    // Ein Schritt pro halbem Bob-Zyklus (Phase π).
    const step = Math.floor(player.headBob.phase / Math.PI);
    if (step === this.lastStep) return;
    this.lastStep = step;
    if (!player.grounded || speed < 0.6) return;

    const p = player.position;
    const volume = player.crouching ? 0.18 : player.sprinting ? 0.75 : 0.45;
    this.audio.play(SOUND[this.surfaceUnder(p, player.isInWater ? 0.1 : 0)], volume);
  }

  /** Schritt eines Gegners an `pos` (räumlich, mit Laufgeschwindigkeit skaliert). */
  enemyStep(pos: THREE.Vector3, speed: number): void {
    const surface = surfaceAt(this.heightMap, pos.x, pos.z, this.heightMap.waterLevel - pos.y, false);
    this.audio.play(SOUND[surface], { volume: 0.35 + Math.min(speed / 6, 1) * 0.5, position: pos });
  }

  private surfaceUnder(p: THREE.Vector3, submersion: number): Surface {
    // Steht der Spieler auf einem Bauwerk? Kurzer Strahl nach unten.
    this.origin.set(p.x, p.y + 0.3, p.z);
    const hit = this.physics.raycast(this.origin, this.down, 0.6, undefined, true);
    const onStructure = !!hit && !!this.building.getByCollider(hit.collider);
    return surfaceAt(this.heightMap, p.x, p.z, submersion, onStructure);
  }
}
