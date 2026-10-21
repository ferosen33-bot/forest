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
  ANIMAL: 1 << 5,
} as const;

export const interactionGroups = (membership: number, filter = 0xffff): number =>
  ((membership & 0xffff) << 16) | (filter & 0xffff);

export interface RaycastHit {
  collider: RAPIER.Collider;
  distance: number;
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

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

  /**
   * Strahl von `origin` in Richtung `dir` (normalisiert). Trifft auch Sensoren
   * (z. B. Beerenbüsche, aufsammelbare Stöcke).
   */
  raycast(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist: number,
    exclude?: RAPIER.Collider,
    excludeSensors = false,
  ): RaycastHit | null {
    const ray = new RAPIER.Ray(origin, dir);
    const flags = excludeSensors ? RAPIER.QueryFilterFlags.EXCLUDE_SENSORS : undefined;
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, flags, undefined, exclude);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      collider: hit.collider,
      distance: t,
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
    };
  }

  /** Senkrechter Strahl nach unten – praktisch zum Platzieren von Objekten. */
  raycastDown(x: number, z: number, fromY = 500, maxDist = 1000): number | null {
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDist, true);
    return hit ? fromY - hit.timeOfImpact : null;
  }
}
