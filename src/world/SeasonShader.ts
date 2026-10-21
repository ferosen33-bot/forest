import * as THREE from 'three';

/**
 * Gemeinsame Uniforms der Jahreszeiten (von der Klima-Steuerung gesetzt, von allen
 * Vegetations-, Fels- und Gelände-Shadern gelesen).
 */
export const seasonUniforms = {
  uAutumn: { value: 0 },
  uBare: { value: 0 },
  uFresh: { value: 0 },
  uSnow: { value: 0 },
  /** Unterhalb dieser Höhe (Strand, Seegrund) bleibt kein Schnee liegen. */
  uSnowLine: { value: 0.8 },
};

const SNOW_COLOR = 'vec3(0.9, 0.93, 0.97)';

/**
 * Ergänzt einen Standard-Shader um Schnee (auf nach oben zeigenden Flächen) und – mit
 * `foliage` – die Laubfärbung (nur Blattfarben, erkannt am Grünüberschuss der Vertexfarbe;
 * Rinde und Stämme bleiben unverändert).
 */
export function injectSeason(shader: THREE.WebGLProgramParametersWithUniforms, opts: { foliage?: boolean; snowBias?: number } = {}): void {
  Object.assign(shader.uniforms, seasonUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vSeasonUp;\nvarying float vSeasonY;\nvarying float vSeasonHash;')
    .replace(
      '#include <project_vertex>',
      `{
  vec4 seasonP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    seasonP = instanceMatrix * seasonP;
  #endif
  vSeasonY = (modelMatrix * seasonP).y;
  // Zufallswert je Baum (aus der Instanzposition): jeder färbt sich etwas anders.
  #ifdef USE_INSTANCING
    vSeasonHash = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  #else
    vSeasonHash = 0.5;
  #endif
}
#include <project_vertex>`,
    )
    .replace(
      '#include <defaultnormal_vertex>',
      `#include <defaultnormal_vertex>
{
  vec3 seasonN = objectNormal;
  #ifdef USE_INSTANCING
    seasonN = mat3(instanceMatrix) * seasonN;
  #endif
  vSeasonUp = normalize(mat3(modelMatrix) * seasonN).y;
}`,
    );
  const leaf = opts.foliage
    ? `
#ifdef USE_COLOR
  float seasonLeaf = smoothstep(0.015, 0.08, vColor.g - vColor.r);
  #ifdef BROADLEAF
    float seasonL = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
    // Herbst: je Baum Rot, Orange oder Gelb, hellere Blätter etwas gelblicher
    vec3 seasonRed = vec3(3.6, 0.9, 0.3);
    vec3 seasonOrange = vec3(3.8, 1.9, 0.3);
    vec3 seasonYellow = vec3(3.4, 3.0, 0.45);
    vec3 seasonTone = vSeasonHash < 0.33 ? seasonRed : vSeasonHash < 0.72 ? seasonOrange : seasonYellow;
    vec3 seasonAutumn = seasonL * mix(seasonTone, seasonYellow, smoothstep(0.1, 0.25, seasonL) * 0.4);
    diffuseColor.rgb = mix(diffuseColor.rgb, seasonAutumn, uAutumn * seasonLeaf);
    // Winter: kahles, graubraunes Geäst
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.17, 0.15) * (0.7 + seasonL * 2.0), uBare * seasonLeaf);
  #endif
  // Frühling: frisches, helleres Grün
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 1.25, 0.85), uFresh * seasonLeaf);
#endif`
    : '';
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uAutumn, uBare, uFresh, uSnow, uSnowLine;\nvarying float vSeasonUp;\nvarying float vSeasonY;\nvarying float vSeasonHash;')
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>${leaf}
diffuseColor.rgb = mix(diffuseColor.rgb, ${SNOW_COLOR}, uSnow * smoothstep(${(0.45 - (opts.snowBias ?? 0)).toFixed(2)}, 0.85, vSeasonUp) * smoothstep(uSnowLine, uSnowLine + 1.2, vSeasonY));`,
    );
}
