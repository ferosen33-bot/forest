import * as THREE from 'three';

/**
 * Foto-Texturen (Poly Haven, CC0) für Boden, Fels, Rinde, Putz, Asphalt und Holz.
 *
 * Alle Oberflächen liegen als Ebenen in zwei Textur-Arrays (Farbe und Normalen), damit jedes
 * Material jede Oberfläche mit nur zwei Samplern lesen kann. Projiziert wird über Weltkoordinaten
 * (eben von oben bzw. dreiachsig) – das Gelände und die Quader-Modelle brauchen keine UVs.
 *
 * Die Farbe wird nicht direkt übernommen, sondern als *Detail* auf die bestehende Vertexfarbe
 * gelegt (Textur ÷ ihrer Durchschnittsfarbe). So bleiben Paletten, Jahreszeiten und Flecken
 * erhalten, und es kommt die Feinstruktur echter Fotos hinzu.
 */

export interface SurfaceDef {
  id: SurfaceId;
  /** Dateiname ohne Endung in `public/textures` (`_d` Farbe, `_n` Normalen). */
  file: string;
  /** Kantenlänge einer Kachel in Metern (wie fotografiert). */
  size: number;
}

export type SurfaceId = 'forestFloor' | 'mud' | 'rockFace' | 'sand' | 'bark' | 'mossyRock' | 'plaster' | 'asphalt' | 'planks';

export const SURFACES: SurfaceDef[] = [
  { id: 'forestFloor', file: 'forest_leaves_02', size: 3.0 },
  { id: 'mud', file: 'brown_mud_02', size: 2.2 },
  { id: 'rockFace', file: 'rock_face_03', size: 4.0 },
  { id: 'sand', file: 'coast_sand_01', size: 6.0 },
  { id: 'bark', file: 'pine_bark', size: 1.4 },
  { id: 'mossyRock', file: 'mossy_rock', size: 2.5 },
  { id: 'plaster', file: 'white_rough_plaster', size: 1.6 },
  { id: 'asphalt', file: 'asphalt_02', size: 3.0 },
  { id: 'planks', file: 'wood_planks_grey', size: 1.5 },
];

/** Ebenen-Index einer Oberfläche (GLSL-Konstante). */
export const surfaceLayer = (id: SurfaceId): number => SURFACES.findIndex((s) => s.id === id);

/** Gemeinsame Uniforms aller Materialien mit Foto-Texturen. */
export const surfaceUniforms = {
  tSurfAlbedo: { value: null as THREE.DataArrayTexture | null },
  tSurfNormal: { value: null as THREE.DataArrayTexture | null },
  /** Material je Ebene: R = Rauheit, G = Umgebungsverdeckung (AO), B = Höhe. */
  tSurfMaterial: { value: null as THREE.DataArrayTexture | null },
  /** Nässe der Welt (0 = trocken, 1 = nach langem Regen): dunkler, glänzender, Pfützen in Senken. */
  uSurfWet: { value: 0 },
  /** Durchschnittsfarbe je Ebene (linear) – zum Normieren auf ein Detail um 1. */
  uSurfAvg: { value: SURFACES.map(() => new THREE.Vector3(0.5, 0.5, 0.5)) },
  /** Kachelgröße je Ebene (m). */
  uSurfSize: { value: SURFACES.map((s) => s.size) },
  /** 0 = Texturen noch nicht geladen (Detail neutral), 1 = aktiv. */
  uSurfOn: { value: 0 },
};

const ALBEDO_SIZE = 1024;
const NORMAL_SIZE = 512;
const MATERIAL_SIZE = 512;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

/** Zeichnet alle Bilder in ein Array und liefert zusätzlich die Durchschnittsfarbe (sRGB 0..1). */
async function buildArray(files: string[], size: number, srgb: boolean): Promise<{ tex: THREE.DataArrayTexture; avg: THREE.Vector3[] }> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const data = new Uint8Array(size * size * 4 * files.length);
  const avg: THREE.Vector3[] = [];
  const images = await Promise.all(files.map(loadImage));
  images.forEach((img, layer) => {
    ctx.drawImage(img, 0, 0, size, size);
    const px = ctx.getImageData(0, 0, size, size).data;
    data.set(px, layer * size * size * 4);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < px.length; i += 16) {
      r += px[i];
      g += px[i + 1];
      b += px[i + 2];
    }
    const n = px.length / 16;
    avg.push(new THREE.Vector3(r / n / 255, g / n / 255, b / n / 255));
  });
  const tex = new THREE.DataArrayTexture(data, size, size, files.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return { tex, avg };
}

/** Lädt alle Oberflächen und schaltet sie in allen Materialien ein. */
export async function loadSurfaceTextures(base = `${import.meta.env.BASE_URL}textures/`): Promise<void> {
  const [albedo, normal, material] = await Promise.all([
    buildArray(SURFACES.map((s) => `${base}${s.file}_d.jpg`), ALBEDO_SIZE, true),
    buildArray(SURFACES.map((s) => `${base}${s.file}_n.jpg`), NORMAL_SIZE, false),
    buildArray(SURFACES.map((s) => `${base}${s.file}_m.jpg`), MATERIAL_SIZE, false),
  ]);
  surfaceUniforms.tSurfAlbedo.value = albedo.tex;
  surfaceUniforms.tSurfNormal.value = normal.tex;
  surfaceUniforms.tSurfMaterial.value = material.tex;
  // Durchschnitt in linear umrechnen (die Textur wird beim Lesen ebenfalls linearisiert).
  albedo.avg.forEach((a, i) => {
    const c = new THREE.Color().setRGB(a.x, a.y, a.z, THREE.SRGBColorSpace);
    surfaceUniforms.uSurfAvg.value[i].set(Math.max(c.r, 0.02), Math.max(c.g, 0.02), Math.max(c.b, 0.02));
  });
  surfaceUniforms.uSurfOn.value = 1;
}

/** Vertex-Teil: Weltposition und -normale für die Projektion. */
const VERTEX_DECL = /* glsl */ `
varying vec3 vSurfPos;
varying vec3 vSurfNormal;`;

const VERTEX_MAIN = /* glsl */ `
{
  vec4 surfP = vec4(transformed, 1.0);
  vec3 surfN = objectNormal;
  #ifdef USE_INSTANCING
    surfP = instanceMatrix * surfP;
    surfN = mat3(instanceMatrix) * surfN;
  #endif
  vSurfPos = (modelMatrix * surfP).xyz;
  vSurfNormal = normalize(mat3(modelMatrix) * surfN);
}`;

/** Fragment-Hilfsfunktionen: ebene und dreiachsige Abtastung mit Detail-Normierung. */
const FRAGMENT_DECL = /* glsl */ `
uniform sampler2DArray tSurfAlbedo;
uniform sampler2DArray tSurfNormal;
uniform sampler2DArray tSurfMaterial;
uniform float uSurfWet;
uniform vec3 uSurfAvg[${SURFACES.length}];
uniform float uSurfSize[${SURFACES.length}];
uniform float uSurfOn;
varying vec3 vSurfPos;
varying vec3 vSurfNormal;

// Material der abgetasteten Ebenen (Rauheit, AO, Höhe), nach Gewicht aufsummiert.
vec3 surfM = vec3(0.0);
float surfMW = 0.0;

vec3 surfMaterial(int layer, vec2 uv) {
  return texture(tSurfMaterial, vec3(uv, float(layer))).rgb;
}
// Höhe einer Ebene (für das Mischen nach Höhe: Sand und Laub füllen die Fugen zwischen Steinen).
float surfHeightPlanar(int layer, vec3 p) {
  return surfMaterial(layer, p.xz / uSurfSize[layer]).b;
}
float surfHeightTriplanar(int layer, vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  float s = uSurfSize[layer];
  return surfMaterial(layer, p.zy / s).b * w.x + surfMaterial(layer, p.xz / s).b * w.y + surfMaterial(layer, p.xy / s).b * w.z;
}

// Detailfarbe (um 1) und Tangentennormale einer Ebene an uv.
vec3 surfAlbedo(int layer, vec2 uv) {
  return texture(tSurfAlbedo, vec3(uv, float(layer))).rgb / uSurfAvg[layer];
}
vec2 surfNormal(int layer, vec2 uv) {
  return texture(tSurfNormal, vec3(uv, float(layer))).xy * 2.0 - 1.0;
}

// Von oben projiziert (Boden), mit einer zweiten, gedrehten Abtastung gegen sichtbare Kachelmuster.
vec3 surfPlanar(int layer, vec3 p, inout vec3 nAcc, float weight) {
  vec2 uv = p.xz / uSurfSize[layer];
  vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.29 + 0.37;
  vec3 a = surfAlbedo(layer, uv) * mix(vec3(1.0), surfAlbedo(layer, uv2), 0.45);
  vec2 t = surfNormal(layer, uv);
  nAcc += vec3(t.x, 0.0, -t.y) * weight;
  surfM += surfMaterial(layer, uv) * weight;
  surfMW += weight;
  return a;
}

// Dreiachsig projiziert (Hänge, Felsen, Stämme, Wände), Normalen per "UDN"-Mischung.
vec3 surfTriplanar(int layer, vec3 p, vec3 n, inout vec3 nAcc, float weight) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  float s = uSurfSize[layer];
  vec3 a = surfAlbedo(layer, p.zy / s) * w.x + surfAlbedo(layer, p.xz / s) * w.y + surfAlbedo(layer, p.xy / s) * w.z;
  vec2 tx = surfNormal(layer, p.zy / s) * vec2(sign(n.x), 1.0);
  vec2 ty = surfNormal(layer, p.xz / s) * vec2(sign(n.y), 1.0);
  vec2 tz = surfNormal(layer, p.xy / s) * vec2(-sign(n.z), 1.0);
  nAcc += (vec3(0.0, tx.y, tx.x) * w.x + vec3(ty.x, 0.0, ty.y) * w.y + vec3(tz.x, tz.y, 0.0) * w.z) * weight;
  surfM += (surfMaterial(layer, p.zy / s) * w.x + surfMaterial(layer, p.xz / s) * w.y + surfMaterial(layer, p.xy / s) * w.z) * weight;
  surfMW += weight;
  return a;
}

// Gewichte nach Höhe schärfen: wo eine Oberfläche "höher" ist, liegt sie oben (statt weich zu verschwimmen).
vec4 surfHeightBlend(vec4 w, vec4 h) {
  vec4 v = w + h * 0.55;
  float top = max(max(v.x, v.y), max(v.z, v.w)) - 0.22;
  vec4 r = max(v - top, 0.0) * step(0.001, w);
  return r / max(1e-4, dot(r, vec4(1.0)));
}

// Pfützen: großflächiges Rauschen, nur in Senken der Oberfläche und auf ebenem Boden.
float surfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float surfNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(surfHash(i), surfHash(i + vec2(1.0, 0.0)), f.x), mix(surfHash(i + vec2(0.0, 1.0)), surfHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Detail auf eine Grundfarbe legen: teils nur Helligkeit, teils auch die Farbe des Fotos.
vec3 surfApply(vec3 base, vec3 detail, float colorAmount) {
  float l = dot(detail, vec3(0.2126, 0.7152, 0.0722));
  return base * mix(vec3(l), detail, colorAmount);
}`;

/**
 * Ergänzt einen Standard-Shader um Foto-Texturen.
 * @param color GLSL nach `color_fragment`: darf `diffuseColor` ändern und in `surfN` (vec3) die
 *   Normalen-Störung in Weltkoordinaten aufsummieren; `surfP`/`surfGeo` sind Position und Normale.
 * @param normalStrength Stärke der Oberflächenstruktur.
 */
export function injectSurface(
  shader: THREE.WebGLProgramParametersWithUniforms,
  color: string,
  normalStrength = 1,
): void {
  Object.assign(shader.uniforms, surfaceUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>${VERTEX_DECL}`)
    .replace('#include <project_vertex>', `${VERTEX_MAIN}\n#include <project_vertex>`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>${FRAGMENT_DECL}`)
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
vec3 surfN = vec3(0.0);
vec3 surfP = vSurfPos;
vec3 surfGeo = normalize(vSurfNormal);
#ifdef FLAT_SHADED
  // Facettierte Modelle: echte Flächennormale, damit die Kanten erhalten bleiben.
  surfGeo = normalize(cross(dFdx(vSurfPos), dFdy(vSurfPos)));
#endif
float surfRough = -1.0;
float surfAO = 1.0;
float surfWetMask = 0.0;
float surfPuddle = 0.0;
if (uSurfOn > 0.5) {
  // In der Ferne verblasst die Struktur (weniger Flimmern, keine Kachelmuster am Horizont).
  float surfFade = 1.0 - smoothstep(60.0, 160.0, length(surfP - cameraPosition));
  vec3 surfBase = diffuseColor.rgb;
  surfM = vec3(0.0);
  surfMW = 0.0;
  ${color}
  diffuseColor.rgb = mix(surfBase, diffuseColor.rgb, surfFade);
  surfN *= surfFade * ${normalStrength.toFixed(2)};
  if (surfMW > 1e-3) {
    vec3 m = surfM / surfMW;
    // Rauheit und AO der Fotos; in der Ferne neutral (mittlere Werte), damit nichts flimmert.
    surfRough = mix(0.88, m.r, surfFade);
    surfAO = mix(1.0, mix(0.35, 1.0, m.g), surfFade);
    // Feine Ritzen auch im direkten Licht etwas dunkler.
    diffuseColor.rgb *= mix(1.0, surfAO, 0.45);
    // Nässe: oben liegende Flächen werden dunkler und glänzen; in Senken stehen Pfützen.
    float up = smoothstep(0.35, 0.85, surfGeo.y);
    surfWetMask = uSurfWet * mix(0.35, 1.0, up);
    float pond = smoothstep(0.42, 0.75, surfNoise(surfP.xz * 0.08) * 0.65 + surfNoise(surfP.xz * 0.31) * 0.35);
    surfPuddle = smoothstep(0.45, 0.85, uSurfWet) * smoothstep(0.8, 0.95, surfGeo.y) * smoothstep(0.55, 0.2, m.b) * pond * surfFade;
    diffuseColor.rgb *= mix(1.0, 0.58, surfWetMask) * mix(1.0, 0.75, surfPuddle);
    surfN *= 1.0 - surfPuddle;
  }
}`,
    )
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
if (surfRough >= 0.0) {
  roughnessFactor = clamp(mix(roughnessFactor, surfRough, 0.75), 0.04, 1.0);
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.45, surfWetMask);
  roughnessFactor = mix(roughnessFactor, 0.04, surfPuddle);
}`,
    )
    .replace(
      '#include <aomap_fragment>',
      `#include <aomap_fragment>
// Umgebungsverdeckung aus dem Foto: Ritzen bekommen weniger Himmels- und Streulicht.
reflectedLight.indirectDiffuse *= surfAO;
#if defined( STANDARD )
  reflectedLight.indirectSpecular *= mix(1.0, surfAO, 0.6);
#endif`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
if (uSurfOn > 0.5) {
  vec3 surfWorld = normalize(surfGeo + surfN);
  normal = normalize(mat3(viewMatrix) * surfWorld);
}`,
    );
}

/**
 * Einfarbiges Material (oder mit Vertexfarben) mit einer Foto-Oberfläche versehen, dreiachsig
 * projiziert. Eine schon vorhandene Shader-Anpassung (z. B. Schnee) bleibt erhalten und läuft zuerst.
 */
export function texturize<M extends THREE.Material>(material: M, id: SurfaceId, colorAmount = 0.5, normalStrength = 1): M {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey();
  const code = `vec3 tD = surfTriplanar(${surfaceLayer(id)}, surfP, surfGeo, surfN, 1.0);\ndiffuseColor.rgb = surfApply(surfBase, tD, ${colorAmount.toFixed(2)});`;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    injectSurface(shader, code, normalStrength);
  };
  // Three.js unterscheidet Programme sonst nur am Quelltext der Anpassung – der ist hier für alle gleich.
  material.customProgramCacheKey = () => `${prevKey}|surf:${id}:${colorAmount}:${normalStrength}`;
  return material;
}
