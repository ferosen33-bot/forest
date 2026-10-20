import RAPIER from '@dimforge/rapier3d-compat';
import type { HeightMap } from '../world/HeightMap';

export { RAPIER };

/**
 * Kollisionsgruppen (Rapier InteractionGroups: obere 16 Bit = Mitgliedschaft,
 * untere 16 Bit = Filter). Werden später für Raycasts (Interaktion, Waffen) genutzt.
 */
export const CollisionGroup = {
  TERRAIN: 1 << 0,
  STATIC: 1 << 1,
  PLAYER: 1 << 2,
  ENEMY: 1 << 3,
  ITEM: 1 << 4,
} as const;

export const interactionGroups = (membership: number, filter = 0xffff): number =>
  ((membership & 0xffff) << 16) | (filter & 0xffff);

/**
 * Dünner Wrapper um die Rapier-Welt.
 * Rapier läuft als WASM-Modul; `Physics.create()` lädt es asynchron.
 */
export class Physics {
  readonly world: RAPIER.World;

  private constructor() {
    // Die Spielfigur berechnet ihre Schwerkraft selbst (Kinematic Character Controller);
    // die Welt-Gravitation gilt für dynamische Objekte (gefällte Stämme, Items ...).
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  set timestep(dt: number) {
    this.world.timestep = dt;
  }

  step(): void {
    this.world.step();
  }

  /**
   * Erzeugt aus der Höhenkarte einen statischen Heightfield-Collider.
   * Das Raster ist identisch mit dem Render-Mesh, daher deckt sich Kollision exakt mit der Optik.
   */
  addTerrain(heightMap: HeightMap): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.heightfield(
      heightMap.cells,
      heightMap.cells,
      heightMap.toRapierHeights(),
      { x: heightMap.size, y: 1, z: heightMap.size },
    )
      .setFriction(0.8)
      .setCollisionGroups(interactionGroups(CollisionGroup.TERRAIN));
    return this.world.createCollider(desc);
  }

  /** Senkrechter Strahl nach unten – praktisch zum Platzieren von Objekten. */
  raycastDown(x: number, z: number, fromY = 500, maxDist = 1000): number | null {
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDist, true);
    return hit ? fromY - hit.timeOfImpact : null;
  }
}
