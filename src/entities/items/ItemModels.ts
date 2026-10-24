import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ItemId } from './ItemDefs';

/**
 * Fotogescannte Gegenstände von Poly Haven (CC0), aufbereitet mit `scripts/prepare-items.mjs`.
 * Jedes Modell wird auf die Konvention der Item-Modelle gebracht: Ursprung in der Mitte,
 * Längsachse +Y, Größe wie das bisherige Modell (passend zu Kollider und Halte-Pose).
 * Fehlt eine Datei, bleibt das selbstgebaute Modell.
 */

interface ModelDef {
  file: string;
  /** Drehung vom Modell- ins Item-System. */
  rotation: THREE.Euler;
  /** Zielgröße entlang der Item-Längsachse (Y) bzw. – mit `fit: 'max'` – der größten Ausdehnung. */
  size: number;
  fit?: 'y' | 'max';
  /** Spiegeln entlang X (z. B. Schneide auf die richtige Seite). */
  mirror?: boolean;
}

const DEFS: Partial<Record<ItemId, ModelDef>> = {
  // Beil: Stiel entlang Y, Schneide zeigt nach +X (Modell: Schneide entlang Z).
  axe: { file: 'hatchet', rotation: new THREE.Euler(0, -Math.PI / 2, 0), size: 0.52 },
  machete: { file: 'machete', rotation: new THREE.Euler(0, Math.PI / 2, 0), size: 0.6 },
  // Taschenlampe: Linse zeigt nach +Y (Modell: +Z).
  flashlight: { file: 'vintage_flashlight', rotation: new THREE.Euler(-Math.PI / 2, 0, 0), size: 0.24 },
  medkit: { file: 'medical_box', rotation: new THREE.Euler(0, 0, 0), size: 0.2, fit: 'max' },
  cannedFood: { file: 'can_rusted', rotation: new THREE.Euler(0, 0, 0), size: 0.11 },
  bowl: { file: 'wooden_bowl_02', rotation: new THREE.Euler(0, 0, 0), size: 0.16, fit: 'max' },
  bowlWater: { file: 'wooden_bowl_02', rotation: new THREE.Euler(0, 0, 0), size: 0.16, fit: 'max' },
};

const loaded = new Map<ItemId, THREE.Object3D>();

/** Geladenes, normiertes Modell eines Gegenstands (oder undefined → selbstgebautes Modell). */
export function getItemModel(id: ItemId): THREE.Object3D | undefined {
  return loaded.get(id);
}

const WATER = new THREE.MeshStandardMaterial({ color: 0x3d6f86, roughness: 0.1, metalness: 0.1 });

export async function loadItemModels(base = `${import.meta.env.BASE_URL}models/items/`): Promise<void> {
  const loader = new GLTFLoader();
  const files = [...new Set(Object.values(DEFS).map((d) => d!.file))];
  const scenes = new Map<string, THREE.Group>();
  await Promise.all(
    files.map(async (f) => {
      const gltf = await loader.loadAsync(`${base}${f}.glb`);
      scenes.set(f, gltf.scene);
    }),
  );
  for (const [id, def] of Object.entries(DEFS) as [ItemId, ModelDef][]) {
    const src = scenes.get(def.file);
    if (!src) continue;
    const inner = src.clone(true);
    inner.rotation.copy(def.rotation);
    if (def.mirror) inner.scale.x = -1;
    const holder = new THREE.Group();
    holder.add(inner);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const s = def.size / (def.fit === 'max' ? Math.max(size.x, size.y, size.z) : size.y);
    const center = box.getCenter(new THREE.Vector3());
    inner.position.copy(center).multiplyScalar(-s);
    inner.scale.multiplyScalar(s);
    holder.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    if (id === 'flashlight') {
      // Lichtquelle knapp vor der Linse (für die Hand-Lampe).
      const lamp = new THREE.Object3D();
      lamp.name = 'lamp';
      lamp.position.y = (size.y * s) / 2 + 0.015;
      holder.add(lamp);
    }
    if (id === 'bowlWater') {
      const r = (Math.min(size.x, size.z) * s) / 2;
      const water = new THREE.Mesh(new THREE.CircleGeometry(r * 0.82, 16), WATER);
      water.rotation.x = -Math.PI / 2;
      water.position.y = (size.y * s) * 0.18;
      holder.add(water);
    }
    loaded.set(id, holder);
  }
}
