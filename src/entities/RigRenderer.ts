import * as THREE from 'three';

/** Ein Körperteil: Typ (bestimmt Geometrie/Material) + Knochen, dessen Weltmatrix es übernimmt. */
export interface RigPart<T extends string> {
  type: T;
  bone: THREE.Object3D;
}

export interface RigRendererSpec<T extends string> {
  name: string;
  geometry: Record<T, THREE.BufferGeometry>;
  materials: Record<T, THREE.Material>;
  /** Wie oft der Teil-Typ pro Figur vorkommt (z. B. 4 Beine). */
  perEntity: Record<T, number>;
  /** Teile, deren Farbe pro Figur variiert (Haut-, Fellton). */
  tinted: ReadonlySet<T>;
  /** Teile ohne Schattenwurf (z. B. leuchtende Augen). */
  noShadow?: ReadonlySet<T>;
}

export interface RigRenderItem<T extends string> {
  parts: readonly RigPart<T>[];
  tint: THREE.Color;
}

/**
 * Zeichnet beliebig viele prozedural animierte Figuren mit EINEM InstancedMesh pro
 * Körperteil-Typ. Die Animation passiert auf normalen Object3D-Knochen (außerhalb der Szene);
 * hier werden nur deren Weltmatrizen in die Instanzen kopiert.
 */
export class RigRenderer<T extends string> {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<T, THREE.InstancedMesh>();
  private readonly counts = new Map<T, number>();
  private readonly white = new THREE.Color(0xffffff);

  constructor(spec: RigRendererSpec<T>, maxEntities: number) {
    this.group.name = spec.name;
    for (const type of Object.keys(spec.perEntity) as T[]) {
      const mesh = new THREE.InstancedMesh(spec.geometry[type], spec.materials[type], maxEntities * spec.perEntity[type]);
      mesh.name = `${spec.name}_${type}`;
      mesh.castShadow = !spec.noShadow?.has(type);
      mesh.receiveShadow = true;
      // Positionen ändern sich jedes Frame; die wenigen Draw Calls lohnen kein Culling.
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      if (spec.tinted.has(type)) mesh.setColorAt(0, this.white);
      this.meshes.set(type, mesh);
      this.group.add(mesh);
    }
  }

  render(items: readonly RigRenderItem<T>[]): void {
    for (const type of this.meshes.keys()) this.counts.set(type, 0);
    for (const item of items) {
      for (const part of item.parts) {
        const mesh = this.meshes.get(part.type)!;
        const slot = this.counts.get(part.type)!;
        if (slot >= mesh.instanceMatrix.count) continue;
        mesh.setMatrixAt(slot, part.bone.matrixWorld);
        if (mesh.instanceColor) mesh.setColorAt(slot, item.tint);
        this.counts.set(part.type, slot + 1);
      }
    }
    for (const [type, mesh] of this.meshes) {
      mesh.count = this.counts.get(type)!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
