import * as THREE from 'three';

/**
 * Wasserfläche für Meer und Binnenseen (ein globaler Wasserspiegel).
 * Ein Standard-PBR-Material wird per `onBeforeCompile` um animierte Wellen-Normalen
 * erweitert – so bleiben Nebel, Licht und Schatten von Three.js voll erhalten.
 */
export class Water {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = { uTime: { value: 0 } };

  constructor(readonly level: number, size = 6000) {
    const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshStandardMaterial({
      color: 0x1b4250,
      roughness: 0.12,
      metalness: 0.05,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide, // auch von unten (beim Tauchen) sichtbar
    });

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime;
varying vec3 vWaterWorld;
// Summe mehrerer gerichteter Sinuswellen -> Gradient für die Normalenstörung.
vec2 waveGradient(vec2 p, float t) {
  vec2 g = vec2(0.0);
  g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.9 + t * 1.3) * 0.9;
  g += vec2(-0.5, 0.86) * cos(dot(p, vec2(-0.5, 0.86)) * 1.7 + t * 1.9) * 0.5;
  g += vec2(0.2, -0.98) * cos(dot(p, vec2(0.2, -0.98)) * 3.1 + t * 2.6) * 0.25;
  g += vec2(-0.9, -0.4) * cos(dot(p, vec2(-0.9, -0.4)) * 6.3 + t * 3.4) * 0.12;
  return g;
}`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
{
  vec2 g = waveGradient(vWaterWorld.xz, uTime) * 0.09;
  vec3 worldN = normalize(vec3(-g.x, 1.0, -g.y));
  normal = normalize((viewMatrix * vec4(worldN, 0.0)).xyz);
}`,
        );
    };

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Water';
    this.mesh.position.y = level;
    this.mesh.receiveShadow = true;
    // Transparente Fläche nach dem Terrain zeichnen.
    this.mesh.renderOrder = 1;
  }

  update(elapsed: number): void {
    this.uniforms.uTime.value = elapsed;
  }

  /** Wasser soll mit dem Spieler mitwandern, damit der Horizont nie endet. */
  follow(x: number, z: number): void {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
  }
}
