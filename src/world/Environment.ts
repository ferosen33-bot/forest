import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

/**
 * Bildbasierte Umgebungsbeleuchtung: ein HDR-Panorama eines Waldes (Poly Haven, CC0, über
 * `@pmndrs/assets`) liefert weiches, gerichtetes Streulicht und Reflexionen für alle
 * PBR-Materialien. Die Stärke regelt das Spiel nach Tageszeit (nachts und in Höhlen fast aus).
 *
 * Wird nachgeladen (eigenes Bundle-Stück), damit der Start nicht wartet.
 */
export async function loadForestEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Promise<void> {
  const { default: url } = await import('@pmndrs/assets/hdri/forest.exr.js');
  const hdr = await new EXRLoader().loadAsync(url);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose();
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0;
}

/** Stärke der Umgebungsbeleuchtung: am Tag dezent, in der Dämmerung schwindend, nachts kaum. */
export function environmentIntensity(daylight: number, underground: number, overcast: number): number {
  const day = THREE.MathUtils.smoothstep(daylight, 0.05, 0.8);
  return (0.015 + 0.42 * day * (1 - 0.35 * overcast)) * (1 - underground);
}
