import * as THREE from 'three';
import type { HeightMap } from './HeightMap';

/**
 * Wasserfläche für Meer und Binnenseen (ein globaler Wasserspiegel).
 * Ein Standard-PBR-Material wird per `onBeforeCompile` erweitert – Nebel, Licht, Schatten und die
 * Himmelsspiegelung (Umgebungskarte) von Three.js bleiben voll erhalten. Dazu kommen:
 * - **Wassertiefe** aus der Höhenkarte (als Textur): flaches Wasser ist türkis und klar, tiefes dunkel.
 * - **Uferschaum:** Wellenkämme laufen aufs Ufer zu und brechen dort weiß.
 * - **Sonnenglitzern:** winzige, gleißende Lichtpunkte auf den Wellen, im Gegenlicht ein ganzer Teppich
 *   (nachts entsprechend schwächer im Mondlicht).
 * - **Regenringe:** Bei Regen breiten sich überall kleine Kreise auf der Oberfläche aus.
 *
 * Spiegelungen von Ufer, Bäumen und Feuer kommen aus der Nachbearbeitung (Screen-Space-Reflexionen);
 * das Wasser schreibt dafür Tiefe.
 */

/** Gemeinsame Wellenfunktion für Material und Spiegelung (Gradient der Wellenhöhe). */
export const WAVE_GLSL = /* glsl */ `
vec2 waveGradient(vec2 p, float t) {
  vec2 g = vec2(0.0);
  g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.9 + t * 1.3) * 0.9;
  g += vec2(-0.5, 0.86) * cos(dot(p, vec2(-0.5, 0.86)) * 1.7 + t * 1.9) * 0.5;
  g += vec2(0.2, -0.98) * cos(dot(p, vec2(0.2, -0.98)) * 3.1 + t * 2.6) * 0.25;
  g += vec2(-0.9, -0.4) * cos(dot(p, vec2(-0.9, -0.4)) * 6.3 + t * 3.4) * 0.12;
  g += vec2(0.6, -0.8) * cos(dot(p, vec2(0.6, -0.8)) * 11.0 + t * 4.6) * 0.06;
  return g;
}
`;

/** Geländehöhe aus der Höhenkarten-Textur (Weltkoordinaten x/z). */
export const TERRAIN_GLSL = /* glsl */ `
float terrainHeight(sampler2D tex, vec3 map, vec2 xz) {
  vec2 uv = ((xz + map.x) / map.y + 0.5) / map.z;
  return texture2D(tex, uv).r;
}
`;

export class Water {
  readonly mesh: THREE.Mesh;
  /** Geländehöhen als Textur – auch für die Spiegelung in der Nachbearbeitung. */
  readonly heightTexture: THREE.DataTexture;
  /** Abbildung Welt → Textur: (halbe Weltgröße, Zellgröße, Stützstellen je Kante). */
  readonly heightMapping: THREE.Vector3;
  private readonly uniforms: {
    uTime: { value: number };
    uLevel: { value: number };
    uHeightTex: { value: THREE.DataTexture };
    uHeightMap: { value: THREE.Vector3 };
    uSunDir: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uRain: { value: number };
  };

  constructor(
    readonly level: number,
    heightMap: HeightMap,
    size = 6000,
  ) {
    const n = heightMap.samples;
    const half = new Uint16Array(n * n);
    for (let i = 0; i < n * n; i++) half[i] = THREE.DataUtils.toHalfFloat(heightMap.heights[i]);
    this.heightTexture = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTexture.magFilter = THREE.LinearFilter;
    this.heightTexture.minFilter = THREE.LinearFilter;
    this.heightTexture.needsUpdate = true;
    this.heightMapping = new THREE.Vector3(heightMap.half, heightMap.cellSize, n);
    this.uniforms = {
      uTime: { value: 0 },
      uLevel: { value: level },
      uHeightTex: { value: this.heightTexture },
      uHeightMap: { value: this.heightMapping },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0, 0, 0) },
      uRain: { value: 0 },
    };

    const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshStandardMaterial({
      color: 0x1b4250,
      roughness: 0.08,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85,
      // Tiefe schreiben: Die Spiegelung in der Nachbearbeitung braucht die Wasseroberfläche.
      depthWrite: true,
      side: THREE.DoubleSide, // auch von unten (beim Tauchen) sichtbar
    });

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime;
uniform float uLevel;
uniform sampler2D uHeightTex;
uniform vec3 uHeightMap;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uRain;
varying vec3 vWaterWorld;
float wDepth;
float wFoam;
vec3 wN = vec3(0.0, 1.0, 0.0);
${WAVE_GLSL}
${TERRAIN_GLSL}
float wHash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + 1.0), f.x), f.y);
}
/** Regentropfen: in jeder Zelle wächst ein Ring und verebbt (Gradient für die Normale). */
vec2 rainRipples(vec2 p, float t) {
  vec2 g = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p * 1.6 + float(k) * 3.7;
    vec2 cell = floor(q);
    float h = wHash(cell + float(k) * 11.0);
    vec2 center = cell + 0.25 + 0.5 * vec2(h, fract(h * 13.7));
    float life = fract(t * 0.85 + h * 7.0);
    vec2 d = q - center;
    float r = length(d);
    float ring = r - life * 0.45;
    float wave = sin(ring * 48.0) * exp(-ring * ring * 160.0) * (1.0 - life);
    g += d / max(r, 1e-3) * wave;
  }
  return g;
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  // Tiefe unter der Oberfläche: flach türkis und klar, tief dunkelblau-grün.
  wDepth = uLevel - terrainHeight(uHeightTex, uHeightMap, vWaterWorld.xz);
  float shallow = 1.0 - smoothstep(0.0, 3.5, wDepth);
  diffuseColor.rgb = mix(vec3(0.015, 0.06, 0.07), vec3(0.07, 0.19, 0.16), shallow);
  diffuseColor.a = mix(0.9, 0.35, shallow * shallow) * smoothstep(0.0, 0.12, wDepth);
  // Uferschaum: Wellenkämme laufen aufs Land zu und brechen an der Wasserlinie.
  float nz = wNoise(vWaterWorld.xz * 0.8 + uTime * 0.1) + 0.5 * wNoise(vWaterWorld.xz * 2.7 - uTime * 0.2);
  float band = 1.0 - smoothstep(0.0, 1.2, wDepth);
  float crest = smoothstep(0.62, 0.92, sin(wDepth * 7.0 - uTime * 1.4 + nz * 2.5) * 0.5 + 0.5);
  // Schmaler, ausgefranster Saum an der Wasserlinie.
  float edge = (1.0 - smoothstep(0.0, 0.07, wDepth + (nz - 0.75) * 0.05)) * smoothstep(0.45, 0.85, nz) * 0.8;
  wFoam = clamp(max(band * crest * smoothstep(0.55, 1.0, nz) * 0.85, edge), 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.88, 0.86), wFoam);
  diffuseColor.a = mix(diffuseColor.a, 0.95, wFoam * smoothstep(0.0, 0.06, wDepth));
}`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.85, wFoam);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
{
  vec2 g = waveGradient(vWaterWorld.xz, uTime) * 0.09;
  g += rainRipples(vWaterWorld.xz, uTime) * 0.35 * uRain;
  // Am Ufer glätten sich die Wellen.
  g *= mix(0.4, 1.0, smoothstep(0.0, 1.5, wDepth));
  wN = normalize(vec3(-g.x, 1.0, -g.y));
  normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
}`,
        )
        .replace(
          '#include <opaque_fragment>',
          `{
  // Sonnenglitzern: feine, rasch wechselnde Facetten spiegeln die Sonne einzeln.
  vec2 sp = vWaterWorld.xz * 6.0;
  vec2 sg = vec2(wNoise(sp + uTime * 1.7), wNoise(sp * 1.3 - uTime * 2.1)) - 0.5;
  vec3 sn = normalize((viewMatrix * vec4(normalize(wN + vec3(-sg.x, 0.0, -sg.y) * 0.5), 0.0)).xyz);
  vec3 l = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  vec3 v = -normalize(vViewPosition);
  float spec = pow(max(dot(reflect(v, sn), l), 0.0), 900.0);
  float sparkle = step(0.72, wNoise(sp * 2.3 + uTime * 3.0));
  outgoingLight += uSunColor * spec * sparkle * 70.0 * (1.0 - wFoam) * step(0.0, uSunDir.y);
}
#include <opaque_fragment>`,
        );
    };
    material.customProgramCacheKey = () => 'water-v2';

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

  /** Licht für das Glitzern (Richtung zur Sonne bzw. zum Mond) und Regenstärke (0..1). */
  setEnvironment(lightDir: THREE.Vector3, lightColor: THREE.Color, intensity: number, rain: number): void {
    this.uniforms.uSunDir.value.copy(lightDir);
    this.uniforms.uSunColor.value.copy(lightColor).multiplyScalar(intensity);
    this.uniforms.uRain.value = rain;
  }

  /** Wasser soll mit dem Spieler mitwandern, damit der Horizont nie endet. */
  follow(x: number, z: number): void {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
  }
}
