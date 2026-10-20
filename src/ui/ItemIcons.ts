import * as THREE from 'three';
import { ITEMS, type ItemId } from '../entities/items/ItemDefs';
import { createItemMesh } from '../entities/items/ItemMeshes';

/** Darstellungs-Ausrichtung je Item, damit die Silhouette im Icon gut lesbar ist. */
const ICON_ROTATION: Record<ItemId, THREE.Euler> = {
  log: new THREE.Euler(0.3, 0.4, 0.95),
  stick: new THREE.Euler(0.2, 0.3, 0.85),
  stone: new THREE.Euler(0.4, 0.6, 0),
  berries: new THREE.Euler(0.5, 0.3, 0),
  axe: new THREE.Euler(0, 0.35, -0.65),
};

/**
 * Rendert für jedes Item ein Icon aus seinem 3D-Modell (einmalig beim Start).
 * Ein kurzlebiger Offscreen-Renderer liefert korrekt getonemappte sRGB-PNGs als Data-URLs.
 */
export function renderItemIcons(size = 96): Record<ItemId, string> {
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

  const icons = {} as Record<ItemId, string>;
  const sphere = new THREE.Sphere();
  for (const id of Object.keys(ITEMS) as ItemId[]) {
    const obj = createItemMesh(id);
    obj.rotation.copy(ICON_ROTATION[id]);
    obj.updateMatrixWorld(true);
    new THREE.Box3().setFromObject(obj).getBoundingSphere(sphere);
    obj.position.sub(sphere.center);
    scene.add(obj);

    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.02;
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    icons[id] = canvas.toDataURL('image/png');
    scene.remove(obj);
  }

  renderer.dispose();
  renderer.forceContextLoss();
  return icons;
}
