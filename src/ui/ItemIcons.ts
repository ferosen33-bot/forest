import * as THREE from 'three';
import { ITEMS, type ItemId } from '../entities/items/ItemDefs';
import { createItemMesh } from '../entities/items/ItemMeshes';
import { STRUCTURES, type StructureId } from '../systems/building/StructureDefs';

/** Darstellungs-Ausrichtung je Item, damit die Silhouette im Icon gut lesbar ist. */
const ICON_ROTATION: Record<ItemId, THREE.Euler> = {
  log: new THREE.Euler(0.3, 0.4, 0.95),
  stick: new THREE.Euler(0.2, 0.3, 0.85),
  stone: new THREE.Euler(0.4, 0.6, 0),
  berries: new THREE.Euler(0.5, 0.3, 0),
  axe: new THREE.Euler(0, 0.35, -0.65),
  stoneAxe: new THREE.Euler(0, 0.35, -0.65),
  spear: new THREE.Euler(0, 0.2, -0.8),
  torch: new THREE.Euler(0.1, 0.3, -0.5),
  rawMeat: new THREE.Euler(0.4, 0.5, 0.2),
  cookedMeat: new THREE.Euler(0.4, 0.5, 0.2),
  bowl: new THREE.Euler(0.65, 0, 0),
  bowlWater: new THREE.Euler(0.65, 0, 0),
  bow: new THREE.Euler(0, 0.5, -0.6),
  arrow: new THREE.Euler(0, 0.2, -0.8),
  hide: new THREE.Euler(0.9, 0.3, 0),
  backpack: new THREE.Euler(0.2, 0.6, 0),
  furCoat: new THREE.Euler(0.2, 0.5, 0),
  fishingRod: new THREE.Euler(0, 0.3, -0.75),
  rawFish: new THREE.Euler(0.3, 0.2, 1.1),
  cookedFish: new THREE.Euler(0.3, 0.2, 1.1),
  flint: new THREE.Euler(0.4, 0.6, 0.2),
  flintAxe: new THREE.Euler(0, 0.35, -0.65),
  mushroom: new THREE.Euler(0.35, 0.3, 0),
  moonflower: new THREE.Euler(0.3, 0.3, 0.5),
  medkit: new THREE.Euler(0.5, 0.6, 0),
  cannedFood: new THREE.Euler(0.35, 0.4, 0),
  waterBottle: new THREE.Euler(0.2, 0.3, -0.4),
  bottle: new THREE.Euler(0.2, 0.3, -0.4),
  painkillers: new THREE.Euler(0.5, 0.6, 0.1),
  machete: new THREE.Euler(0, 0.3, -0.75),
  flashlight: new THREE.Euler(0.2, 0.3, -0.7),
  battery: new THREE.Euler(0.3, 0.3, -0.5),
  jacket: new THREE.Euler(0.2, 0.5, 0),
  watch: new THREE.Euler(1.2, 0, 0.2),
  lampOil: new THREE.Euler(0.25, 0.6, 0),
  molotov: new THREE.Euler(0.2, 0.3, -0.4),
  enginePart: new THREE.Euler(0.7, 0.5, 0),
  documents: new THREE.Euler(0.9, 0.3, 0),
  bone: new THREE.Euler(0.5, 0.3, 0.3),
  boneClub: new THREE.Euler(0, 0.3, -0.75),
  fireArrow: new THREE.Euler(0, 0.2, -0.8),
  boneArmor: new THREE.Euler(0.9, 0.3, 0),
  jerky: new THREE.Euler(0.9, 0.3, 0),
  stew: new THREE.Euler(0.7, 0, 0),
  baseballBat: new THREE.Euler(0, 0.3, -0.75),
  pipeWrench: new THREE.Euler(0, 0.3, -0.75),
  crowbar: new THREE.Euler(0, 0.3, -0.75),
  sledgehammer: new THREE.Euler(0, 0.3, -0.75),
  kitchenKnife: new THREE.Euler(0, 0.3, -0.75),
  fireAxe: new THREE.Euler(0, 0.3, -0.75),
  sabre: new THREE.Euler(0, 0.3, -0.75),
  modFire: new THREE.Euler(0.35, 0.5, 0),
  modShock: new THREE.Euler(0.3, 0.4, 0),
  modCaustic: new THREE.Euler(0.2, 0.3, 0.15),
  modBleed: new THREE.Euler(0.3, 0.3, -0.5),
  // Schusswaffen von der Seite, Mündung nach rechts oben.
  pistol: new THREE.Euler(0, Math.PI / 2, -1.2),
  revolver: new THREE.Euler(0, Math.PI / 2, -1.2),
  shotgun: new THREE.Euler(0, Math.PI / 2, -1.0),
  huntingRifle: new THREE.Euler(0, Math.PI / 2, -1.0),
  pistolAmmo: new THREE.Euler(0.4, 0.5, 0),
  shells: new THREE.Euler(0.4, 0.3, 0),
  rifleAmmo: new THREE.Euler(0.4, 0.5, 0),
  katana: new THREE.Euler(0, 0.3, -0.78),
  cleaver: new THREE.Euler(0, 0.2, -0.6),
  golfClub: new THREE.Euler(0, 0.3, -0.75),
  baton: new THREE.Euler(0, 0.3, -0.75),
  pitchfork: new THREE.Euler(0, 0.3, -0.75),
  nailBat: new THREE.Euler(0, 0.3, -0.7),
  shockBar: new THREE.Euler(0, 0.3, -0.7),
  nails: new THREE.Euler(0.5, 0.4, 0.3),
  pipeBomb: new THREE.Euler(0.3, 0.4, -0.6),
};

export interface IconSets {
  items: Record<ItemId, string>;
  structures: Record<StructureId, string>;
}

/**
 * Rendert Icons für alle Items und Bauwerke aus ihren 3D-Modellen (einmalig beim Start).
 * Ein kurzlebiger Offscreen-Renderer liefert korrekt getonemappte sRGB-PNGs als Data-URLs.
 */
export function renderIcons(size = 96): IconSets {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a3326, 1.6));
  const key = new THREE.DirectionalLight(0xfff2dd, 2.6);
  key.position.set(2, 3, 4);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  const sphere = new THREE.Sphere();

  /** Objekt einpassen, aus `viewDir` rendern, als PNG zurückgeben. */
  const shoot = (obj: THREE.Object3D, viewDir: THREE.Vector3): string => {
    obj.updateMatrixWorld(true);
    new THREE.Box3().setFromObject(obj).getBoundingSphere(sphere);
    obj.position.sub(sphere.center);
    scene.add(obj);
    const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.02;
    camera.position.copy(viewDir).normalize().multiplyScalar(dist);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    scene.remove(obj);
    return canvas.toDataURL('image/png');
  };

  const items = {} as Record<ItemId, string>;
  for (const id of Object.keys(ITEMS) as ItemId[]) {
    const obj = createItemMesh(id);
    obj.rotation.copy(ICON_ROTATION[id]);
    items[id] = shoot(obj, new THREE.Vector3(0, 0, 1));
  }

  const structures = {} as Record<StructureId, string>;
  for (const id of Object.keys(STRUCTURES) as StructureId[]) {
    const obj = STRUCTURES[id].build();
    obj.rotation.y = -0.6;
    structures[id] = shoot(obj, new THREE.Vector3(0.2, 0.55, 1));
  }

  renderer.dispose();
  renderer.forceContextLoss();
  return { items, structures };
}
