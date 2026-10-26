import * as THREE from 'three';
import { TERRAIN_GLSL, WAVE_GLSL } from '../world/Water';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { N8AOPass } from 'n8ao';

/** Farbstimmung wie im Horrorfilm (wird nach dem Tone Mapping im Anzeige-Farbraum angewandt). */
export interface Grade {
  /** 1 = unverändert, 0 = schwarz-weiß. */
  saturation: number;
  /** Kontrast um Mittelgrau (1 = unverändert). */
  contrast: number;
  /** Farbstich in den Schatten (wird aufaddiert, klein halten). */
  shadows: THREE.Color;
  /** Farbfilter in den Lichtern (Multiplikator). */
  highlights: THREE.Color;
  /** Filmkorn 0..~0.12. */
  grain: number;
  /** Abdunkeln der Bildränder. */
  vignette: number;
  /** Lichtquellen (sehr helle HDR-Stellen) behalten ihre Farbe trotz Entsättigung (0..1, v. a. nachts). */
  glow?: number;
  /** Farbsäume zum Rand hin (Linsenfehler). */
  aberration: number;
}

/** Bodennebel: Dichte nimmt mit der Höhe exponentiell ab (sammelt sich in Senken). */
export interface Mist {
  color: THREE.Color;
  /** Dichte auf Höhe `base` (pro Meter). */
  density: number;
  /** Höhe, über die die Dichte auf 1/e fällt (m). */
  height: number;
  /** Bezugshöhe (Welt-Y). */
  base: number;
}

export interface PostFXParams {
  /** Richtung zur Lichtquelle (Sonne bzw. Mond), Weltkoordinaten. */
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  /** Stärke der Lichtstrahlen (0 = aus). */
  rays: number;
  /** Stärke des Bloom-Glühens. */
  bloom: number;
  underwater: boolean;
  grade: Grade;
  mist: Mist;
  time: number;
  /** Wird nach Umgebungsverdeckung und Nebel über das Bild gezeichnet (Gegenstand in der Hand). */
  overlay?: { scene: THREE.Scene; camera: THREE.Camera } | null;
  /** Licht im Nebel: Lichtkegel der Taschenlampe und Leuchthöfe um Feuer und Fackeln. */
  volumetric?: VolumetricLights | null;
  /** Feuer mit Hitzeflimmern (die nächsten zählen). */
  heat?: readonly HeatSource[];
  /** Wasserspiegel und Geländehöhen für die Spiegelungen (null = keine). */
  water?: WaterReflections | null;
}

export interface WaterReflections {
  level: number;
  heightTexture: THREE.Texture;
  /** (halbe Weltgröße, Zellgröße, Stützstellen je Kante) */
  heightMapping: THREE.Vector3;
}

/** Lichtquellen, deren Licht im Dunst sichtbar wird. */
export interface VolumetricLights {
  /** Taschenlampe (Lichtkegel mit Schatten) oder null. */
  spot: THREE.SpotLight | null;
  /** Punktlichter (Feuer, Fackeln): weicher Leuchthof im Nebel. */
  points: readonly THREE.PointLight[];
  /** Grunddichte der Luft (Staub, Feuchte), auch ohne Bodennebel. */
  air: number;
  /** Gesamtstärke für Lampe und Feuer (am hellen Tag fast aus). */
  strength: number;
  /** Sonne bzw. Mond: Lichtbahnen durchs Blätterdach (Stärke 0 = aus). */
  sun?: { light: THREE.DirectionalLight; strength: number } | null;
  /** Bodennebel: Dichte (0 = keiner), Umgebungslicht darin, Geländehöhen und Spuren. */
  ground?: {
    density: number;
    ambient: THREE.Color;
    heightTexture: THREE.Texture;
    heightMapping: THREE.Vector3;
    /** x, y, z = Fußpunkt, w = Stärke (1 = gerade hindurchgegangen … 0 = verheilt). */
    wakes: readonly THREE.Vector4[];
  } | null;
}

/** Höchstzahl der Punktlichter im Nebel (passt zum LightPool plus Fackel). */
const VOL_POINTS = 6;
/** Höchstzahl der Spuren im Bodennebel. */
const WAKES = 8;
/** Höchstzahl der Feuer mit Hitzeflimmern. */
const HEAT_SOURCES = 4;

/** Ein Feuer, über dem die Luft flimmert: Fuß der Flammen und Größe (m). */
export interface HeatSource {
  position: THREE.Vector3;
  size: number;
}

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Maske: nur unverdeckter Himmel nahe der Sonne leuchtet (Bäume/Gelände davor sind schwarz). */
const occlusionFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uSun;
uniform float uAspect;
varying vec2 vUv;
void main() {
  float depth = texture2D(tDepth, vUv).r;
  float sky = step(0.99999, depth);
  vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
  float glow = pow(max(0.0, 1.0 - length(d) * 1.4), 3.0);
  vec3 c = texture2D(tColor, vUv).rgb;
  gl_FragColor = vec4(min(c, vec3(4.0)) * sky * glow, 1.0);
}`;

/** Radiale Unschärfe in Richtung Lichtquelle ("God Rays", GPU Gems 3, Kap. 13). */
const raysFragment = /* glsl */ `
uniform sampler2D tMask;
uniform vec2 uSun;
varying vec2 vUv;
const int SAMPLES = 56;
void main() {
  vec2 delta = (vUv - uSun) * (0.92 / float(SAMPLES));
  vec2 uv = vUv;
  float decay = 1.0;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    uv -= delta;
    sum += texture2D(tMask, uv).rgb * decay;
    decay *= 0.965;
  }
  gl_FragColor = vec4(sum / float(SAMPLES) * 2.2, 1.0);
}`;

/**
 * Bodennebel aus der Tiefe: Weltposition rekonstruieren und die Nebeldichte entlang des Sehstrahls
 * analytisch integrieren (exponentieller Höhennebel nach Iñigo Quilez). Der Himmel bekommt den
 * Nebel einer festen Entfernung, damit der Horizont im Dunst verschwimmt.
 */
const mistFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCamPos;
uniform vec3 uMistColor;
uniform float uDensity;
uniform float uFalloff;
uniform float uBase;
uniform sampler2D tVol;
uniform vec2 uVolTexel;
uniform float uVolOn;
uniform vec4 uHeat[${HEAT_SOURCES}];
uniform float uHeatDist[${HEAT_SOURCES}];
uniform int uHeatCount;
uniform float uTime;
uniform float uWaterOn;
uniform float uWaterLevel;
uniform sampler2D tHeight;
uniform vec3 uHeightMap;
uniform mat4 uViewProj;
varying vec2 vUv;
${WAVE_GLSL}
${TERRAIN_GLSL}
float viewDepth(float d) {
  vec4 v = uProjInv * vec4(0.0, 0.0, d * 2.0 - 1.0, 1.0);
  return -v.z / v.w;
}
/**
 * Spiegelung auf dem Wasser (Screen Space): Der an der Welle gespiegelte Sehstrahl wird durch das Bild
 * verfolgt, bis er hinter einer Oberfläche verschwindet – deren Farbe ist das Spiegelbild. Was nicht
 * im Bild ist (Himmel, Dinge hinter der Kamera), liefert weiter die Umgebungskarte des Wassermaterials.
 * @returns rgb = Spiegelbild, a = Deckung (0 = nichts getroffen)
 */
vec4 waterReflection(vec3 world, vec3 rd) {
  vec2 g = waveGradient(world.xz, uTime) * 0.1;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 r = reflect(rd, n);
  r.y = abs(r.y);
  float stepLen = 0.35;
  vec3 p = world + n * 0.05;
  vec3 prev = p;
  for (int i = 0; i < 36; i++) {
    prev = p;
    p += r * stepLen;
    stepLen *= 1.13;
    vec4 clip = uViewProj * vec4(p, 1.0);
    if (clip.w <= 0.0) break;
    vec3 ndc = clip.xyz / clip.w;
    vec2 suv = ndc.xy * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
    float sd = texture2D(tDepth, suv).r;
    if (sd >= 0.99999) continue;
    float rayZ = viewDepth(ndc.z * 0.5 + 0.5);
    float sceneZ = viewDepth(sd);
    if (rayZ > sceneZ && rayZ - sceneZ < stepLen * 1.5 + 0.3) {
      // Treffer verfeinern (Halbierung zwischen letztem und aktuellem Punkt).
      vec3 a = prev;
      vec3 b = p;
      for (int k = 0; k < 5; k++) {
        vec3 m = (a + b) * 0.5;
        vec4 mc = uViewProj * vec4(m, 1.0);
        vec3 mn = mc.xyz / mc.w;
        float mz = viewDepth(mn.z * 0.5 + 0.5);
        float ms = viewDepth(texture2D(tDepth, mn.xy * 0.5 + 0.5).r);
        if (mz > ms) b = m; else a = m;
      }
      vec4 bc = uViewProj * vec4(b, 1.0);
      vec2 huv = bc.xy / bc.w * 0.5 + 0.5;
      // Am Bildrand und bei langen Strahlen weich auslaufen lassen.
      vec2 edge = smoothstep(0.0, 0.08, huv) * smoothstep(0.0, 0.08, 1.0 - huv);
      float fade = edge.x * edge.y * (1.0 - float(i) / 36.0);
      return vec4(texture2D(tColor, huv).rgb, fade);
    }
    if (rayZ > sceneZ) break;
  }
  return vec4(0.0);
}
void main() {
  float depth = texture2D(tDepth, vUv).r;
  vec4 view = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  view /= view.w;
  vec3 world = (uViewInv * vec4(view.xyz, 1.0)).xyz;
  vec3 ray = world - uCamPos;
  float dist = length(ray);
  vec3 rd = ray / max(dist, 1e-4);
  if (depth >= 0.99999) dist = 380.0;
  // Hitzeflimmern: Über jedem Feuer wird das Bild dahinter in feinen Wellen verschoben.
  vec2 uv = vUv;
  for (int i = 0; i < ${HEAT_SOURCES}; i++) {
    if (i >= uHeatCount) break;
    vec4 h = uHeat[i];
    vec2 d = vec2((vUv.x - h.x) / h.z, (vUv.y - h.y) / h.w);
    if (abs(d.x) < 1.0 && d.y > -0.15 && d.y < 1.0 && dist > uHeatDist[i] - 0.6) {
      float m = (1.0 - d.x * d.x) * smoothstep(-0.15, 0.2, d.y) * (1.0 - smoothstep(0.45, 1.0, d.y));
      vec2 wave = vec2(sin(vUv.y / h.w * 22.0 - uTime * 9.0 + vUv.x / h.z * 3.0), cos(vUv.x / h.z * 17.0 + uTime * 7.0 - vUv.y / h.w * 9.0));
      uv += wave * m * h.z * 0.022;
    }
  }
  vec3 c = texture2D(tColor, uv).rgb;
  // Wasser: Spiegelbild über die Fresnel-Reflexion legen.
  if (uWaterOn > 0.5 && depth < 0.99999 && abs(world.y - uWaterLevel) < 0.3 && uCamPos.y > uWaterLevel
      && terrainHeight(tHeight, uHeightMap, world.xz) < uWaterLevel - 0.05) {
    vec4 refl = waterReflection(world, rd);
    float fres = 0.04 + 0.96 * pow(1.0 - max(-rd.y, 0.0), 5.0);
    c = mix(c, refl.rgb * vec3(0.78, 0.86, 0.88), refl.a * clamp(fres * 1.4 + 0.38, 0.0, 0.92));
  }
  float b = uFalloff;
  float a = uDensity * exp(-b * (uCamPos.y - uBase));
  float k = b * rd.y;
  float f = abs(k) > 1e-4 ? a * (1.0 - exp(-k * dist)) / k : a * dist;
  float fog = 1.0 - exp(-max(f, 0.0));
  // Lichtquellen (Flammen, Glühwürmchen, Augen) leuchten durch den Dunst – sie schreiben keine Tiefe,
  // sonst würden sie mit der Entfernung des Hintergrunds vernebelt.
  fog *= 1.0 - smoothstep(0.25, 1.2, dot(c, vec3(0.2126, 0.7152, 0.0722)));
  vec3 outc = mix(c, uMistColor, clamp(fog, 0.0, 0.92));
  // Licht im Nebel (halbe Auflösung, leicht weichgezeichnet gegen das Abtastrauschen)
  if (uVolOn > 0.5) {
    vec4 v = texture2D(tVol, vUv) * 0.36;
    v += texture2D(tVol, vUv + vec2(uVolTexel.x, 0.0)) * 0.16;
    v += texture2D(tVol, vUv - vec2(uVolTexel.x, 0.0)) * 0.16;
    v += texture2D(tVol, vUv + vec2(0.0, uVolTexel.y)) * 0.16;
    v += texture2D(tVol, vUv - vec2(0.0, uVolTexel.y)) * 0.16;
    // Bodennebel verschluckt, was hinter ihm liegt (a = Durchlässigkeit), und leuchtet selbst.
    outc = outc * v.a + v.rgb;
  }
  gl_FragColor = vec4(outc, 1.0);
}`;

/**
 * Licht im Nebel. Pro Bildpunkt (halbe Auflösung) wird der Sehstrahl bis zur Oberfläche abgetastet:
 * - **Lichtkegel der Taschenlampe:** Streulicht in jedem Schritt, abgeschattet über die Schattenkarte der
 *   Lampe – Stämme werfen dunkle Schneisen in den Strahl. Die Dichte schwankt mit treibendem Rauschen
 *   (Dunstschwaden, Staub). Henyey-Greenstein-Phase: Blickt man ins Licht, leuchtet der Dunst stärker.
 * - **Sonnenstrahlen:** dasselbe mit der Schattenkarte der Sonne – durch Lücken im Blätterdach fallen
 *   Lichtbahnen schräg in den Wald, aus jedem Blickwinkel sichtbar (nicht nur gegen die Sonne).
 * - **Bodennebel:** eine dichte, wabernde Schicht knapp über dem Gelände (Höhe aus der Höhenkarte), die
 *   das Bild dahinter verschluckt. Wo jemand hindurchgeht, reißt sie auf und verwirbelt.
 * - **Leuchthöfe** um Punktlichter: Das Streulicht einer Punktquelle entlang des Strahls lässt sich
 *   geschlossen integrieren (∫ 1/(h² + t²) dt = atan(t/h)/h) – ohne Abtasten.
 * Ergebnis: rgb = Streulicht, a = Durchlässigkeit des Bodennebels. Der Startpunkt jedes Strahls wird
 * zufällig versetzt; das Rauschen glättet der Nebel-Schritt.
 */
const volumetricFragment = /* glsl */ `
precision highp sampler2DShadow;
uniform sampler2D tDepth;
uniform sampler2DShadow tShadow;
uniform mat4 uShadowMatrix;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uAir;
uniform float uMistDensity;
uniform float uMistFalloff;
uniform float uMistBase;
uniform float uSpotOn;
uniform vec3 uSpotPos;
uniform vec3 uSpotDir;
uniform vec3 uSpotColor;
uniform float uSpotCosOuter;
uniform float uSpotCosInner;
uniform float uSpotRange;
uniform float uShadowOn;
uniform vec4 uPointPos[${VOL_POINTS}];
uniform vec3 uPointColor[${VOL_POINTS}];
uniform int uPointCount;
uniform float uSunOn;
uniform sampler2DShadow tSunShadow;
uniform mat4 uSunMatrix;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uGroundFog;
uniform vec3 uAmbient;
uniform sampler2D tHeight;
uniform vec3 uHeightMap;
uniform vec4 uWake[${WAKES}];
uniform int uWakeCount;
uniform float uMarch;
varying vec2 vUv;

const int STEPS = 32;

${TERRAIN_GLSL}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0 + i.z * 113.0;
  vec4 a = fract(sin(vec4(n, n + 1.0, n + 57.0, n + 58.0)) * 43758.5453);
  vec4 b = fract(sin(vec4(n + 113.0, n + 114.0, n + 170.0, n + 171.0)) * 43758.5453);
  vec4 m = mix(a, b, f.z);
  vec2 q = mix(m.xy, m.zw, f.y);
  return mix(q.x, q.y, f.x);
}
/** Dichte des Mediums: Grundstaub + Höhennebel, durchzogen von treibenden Schwaden. */
float density(vec3 p) {
  float mist = uMistDensity * exp(-uMistFalloff * (p.y - uMistBase));
  vec3 q = p * 0.35 + vec3(uTime * 0.12, uTime * 0.03, uTime * 0.07);
  float swirl = noise3(q) * 0.65 + noise3(q * 2.7) * 0.35;
  // Deutliche Schwaden: dünne Luft dazwischen, dichte Fahnen darin.
  return (uAir + mist) * (0.15 + 2.6 * swirl * swirl);
}
/**
 * Bodennebel: liegt in einer flachen Schicht über dem Gelände und zerfasert nach oben. Durchquert ihn
 * jemand, wird er dort verdrängt (die Spur schließt sich langsam) und um die Spur herum verwirbelt.
 */
float groundFog(vec3 p) {
  float h = p.y - terrainHeight(tHeight, uHeightMap, p.xz);
  if (h > 3.5) return 0.0;
  vec2 swirl = vec2(0.0);
  float clear = 1.0;
  for (int i = 0; i < ${WAKES}; i++) {
    if (i >= uWakeCount) break;
    vec4 w = uWake[i];
    vec2 d = p.xz - w.xz;
    float k = w.w * exp(-dot(d, d) * 0.45) * (1.0 - smoothstep(1.2, 2.8, p.y - w.y));
    swirl += vec2(-d.y, d.x) * k * (2.2 - w.w) * 0.6;
    clear *= 1.0 - 0.92 * k;
  }
  vec3 q = vec3(p.x * 0.22 + swirl.x, p.y * 0.55 - uTime * 0.02, p.z * 0.22 + swirl.y) + vec3(uTime * 0.04, 0.0, uTime * 0.025);
  float n = noise3(q) * 0.6 + noise3(q * 2.4 + 7.3) * 0.4;
  float layer = exp(-max(h, 0.0) / 0.7);
  return uGroundFog * layer * smoothstep(0.3, 0.75, n + 0.15 * (1.0 - h)) * clear;
}
float phaseHG(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

void main() {
  float depth = texture2D(tDepth, vUv).r;
  vec4 view = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  view /= view.w;
  vec3 world = (uViewInv * vec4(view.xyz, 1.0)).xyz;
  vec3 ray = world - uCamPos;
  float dist = length(ray);
  vec3 rd = ray / max(dist, 1e-4);
  vec3 sum = vec3(0.0);
  float T = 1.0;

  bool fog = uGroundFog > 0.0;
  if (uSpotOn > 0.5 || uSunOn > 0.5 || fog) {
    float maxD = min(dist, uMarch);
    float stepLen = maxD / float(STEPS);
    float t = stepLen * hash12(gl_FragCoord.xy + fract(uTime * 13.7) * 91.0);
    float sunPhase = phaseHG(dot(uSunDir, rd), 0.45);
    for (int i = 0; i < STEPS; i++) {
      vec3 p = uCamPos + rd * t;
      float air = density(p);
      float g = fog ? groundFog(p) : 0.0;
      vec3 light = vec3(0.0);
      vec3 sunLight = vec3(0.0);
      // Lichtkegel der Taschenlampe
      if (uSpotOn > 0.5) {
        vec3 toP = p - uSpotPos;
        float d = length(toP);
        vec3 l = toP / max(d, 1e-3);
        float cone = smoothstep(uSpotCosOuter, uSpotCosInner, dot(l, uSpotDir));
        if (cone > 0.0 && d < uSpotRange) {
          float vis = 1.0;
          if (uShadowOn > 0.5) {
            vec4 sc = uShadowMatrix * vec4(p, 1.0);
            sc.xyz /= sc.w;
            if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) vis = texture(tShadow, vec3(sc.xy, sc.z - 0.002));
          }
          // Direkt vor der Linse kaum Streulicht – sonst stünde eine leuchtende Kugel im Bild statt eines Kegels.
          float atten = smoothstep(0.6, 5.0, d) / (1.0 + d * d * 0.12) * (1.0 - smoothstep(uSpotRange * 0.6, uSpotRange, d));
          light += uSpotColor * cone * atten * vis * phaseHG(dot(l, -rd), 0.25) * 0.45;
        }
      }
      // Sonne (bzw. Mond) durch das Blätterdach
      if (uSunOn > 0.5) {
        vec4 sc = uSunMatrix * vec4(p, 1.0);
        sc.xyz /= sc.w;
        float vis = 1.0;
        if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) vis = texture(tSunShadow, vec3(sc.xy, sc.z - 0.001));
        // Leicht vorwärts streuend: gegen die Sonne gleißen die Bahnen, seitlich bleiben sie sichtbar.
        sunLight = uSunColor * vis * (0.15 + 2.5 * sunPhase);
      }
      // Streulicht von Dunst und Bodennebel, dazu das Umgebungslicht im Bodennebel.
      // Waldluft ist feucht und staubig: Für die Sonnenbahnen zählt der Dunst dreifach.
      sum += T * ((air + g) * light + (air * 3.0 + g) * sunLight + g * uAmbient) * stepLen;
      T *= exp(-g * stepLen);
      t += stepLen;
    }
  }

  // Leuchthöfe um Punktlichter (geschlossen integriert)
  for (int i = 0; i < ${VOL_POINTS}; i++) {
    if (i >= uPointCount) break;
    vec3 lp = uPointPos[i].xyz;
    float range = uPointPos[i].w;
    vec3 oc = lp - uCamPos;
    float t0 = dot(oc, rd);
    vec3 closest = uCamPos + rd * t0;
    float h = max(length(lp - closest), 0.15);
    float tEnd = dist;
    float a = (atan((tEnd - t0) / h) - atan(-t0 / h)) / h;
    float fade = 1.0 - smoothstep(range * 0.25, range * 0.9, h);
    float dens = uAir + uMistDensity * exp(-uMistFalloff * (lp.y - uMistBase));
    // Die Fackel direkt vor dem Gesicht soll nicht das ganze Bild überstrahlen.
    float near = mix(0.2, 1.0, smoothstep(0.6, 3.0, length(oc)));
    sum += uPointColor[i] * a * fade * near * dens * 0.14;
  }

  gl_FragColor = vec4(sum, T);
}`;

/** Helle Bereiche für Bloom (weiches Knie über der Schwelle). */
const brightFragment = /* glsl */ `
uniform sampler2D tColor;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThreshold, uThreshold * 1.8, l);
  gl_FragColor = vec4(min(c * k, vec3(8.0)), 1.0);
}`;

/** Separierbarer 9-Tap-Gauß. */
const blurFragment = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb * 0.227027;
  c += texture2D(tInput, vUv + uDir * 1.384615).rgb * 0.316216;
  c += texture2D(tInput, vUv - uDir * 1.384615).rgb * 0.316216;
  c += texture2D(tInput, vUv + uDir * 3.230769).rgb * 0.070270;
  c += texture2D(tInput, vUv - uDir * 3.230769).rgb * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}`;

/**
 * Zusammenführen: Farbsäume, Lichtstrahlen, Bloom → Tone Mapping → Filmlook
 * (Sättigung, Kontrast, getönte Schatten und Lichter, Vignette, Filmkorn).
 */
const compositeFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tRays;
uniform sampler2D tBloom;
uniform vec3 uRayColor;
uniform float uRays;
uniform float uBloom;
uniform float uSaturation;
uniform float uGlowKeep;
uniform float uContrast;
uniform vec3 uShadows;
uniform vec3 uHighlights;
uniform float uGrain;
uniform float uVignette;
uniform float uAberration;
uniform float uTime;
uniform vec2 uRes;
varying vec2 vUv;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 dir = vUv - 0.5;
  float r2 = dot(dir, dir);
  vec2 off = dir * uAberration * r2;
  vec3 c;
  c.r = texture2D(tColor, vUv - off).r;
  c.g = texture2D(tColor, vUv).g;
  c.b = texture2D(tColor, vUv + off).b;
  c += texture2D(tRays, vUv).rgb * uRayColor * uRays;
  c += texture2D(tBloom, vUv).rgb * uBloom;
  // Feuer und Lampen sind nachts die einzigen Farben im Bild – sie werden nicht mit entsättigt.
  float hdrLum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float glow = uGlowKeep * smoothstep(0.06, 0.5, hdrLum);
  float sat = mix(uSaturation, 1.15, glow);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  vec3 g = gl_FragColor.rgb;
  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g = mix(vec3(l), g, sat);
  g = (g - 0.5) * uContrast + 0.5;
  g += uShadows * (1.0 - smoothstep(0.0, 0.55, l));
  // Farbfilter in den Lichtern – die hellsten Stellen (Flammen, Lampen) behalten ihre eigene Farbe.
  g *= mix(vec3(1.0), uHighlights, smoothstep(0.25, 0.7, l) * (1.0 - smoothstep(0.75, 0.95, l)) * (1.0 - glow));
  g *= 1.0 - r2 * uVignette;
  // Filmkorn: pro Pixel und Bild neu, in mittleren und dunklen Tönen am stärksten.
  float n = hash(floor(vUv * uRes) + fract(uTime * 7.31) * 517.0) - 0.5;
  g += n * uGrain * (0.55 + 0.45 * (1.0 - l));
  gl_FragColor = vec4(clamp(g, 0.0, 1.0), 1.0);
}`;

/**
 * Nachbearbeitung im Stil eines Horrorfilms:
 * - Umgebungsverdeckung (n8ao): Ecken, Spalten und Bodenkontakt werden dunkel,
 * - Bodennebel, der in Senken hängt,
 * - Lichtstrahlen (Sonne/Mond durch Bäume) und Bloom (Feuer, Lampen, Augen der Schrate),
 * - Filmlook: entsättigte, getönte Farben, Kontrast, Vignette, Filmkorn und Farbsäume.
 *
 * Die Szene wird in ein HDR-Render-Target (MSAA, mit Tiefentextur) gezeichnet; Tone Mapping
 * und sRGB-Umrechnung passieren erst im letzten Schritt.
 */
export class PostFX {
  enabled = true;
  /** Umgebungsverdeckung (kostet auf schwachen Geräten spürbar Leistung). */
  ao = true;

  private readonly scene: THREE.WebGLRenderTarget;
  /** Ergebnis der Umgebungsverdeckung (ohne Tiefe). */
  private readonly aoOut: THREE.WebGLRenderTarget;
  /** Fertig beleuchtetes Bild mit Nebel; mit eigenem Tiefenpuffer für den Gegenstand in der Hand. */
  private readonly lit: THREE.WebGLRenderTarget;
  private readonly tmpCam = new THREE.Vector3();
  /** Platzhalter-Schattenkarte, solange keine Taschenlampe brennt (der Shadow-Sampler braucht eine Tiefentextur). */
  private dummyShadow: THREE.WebGLRenderTarget | null = null;
  /** Leere Textur für ungenutzte Sampler. */
  private readonly blank = Object.assign(new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1), { needsUpdate: true });
  private readonly tmpHeat = new THREE.Vector3();
  private readonly mask: THREE.WebGLRenderTarget;
  /** Licht im Nebel (halbe Auflösung). */
  private readonly vol: THREE.WebGLRenderTarget;
  private readonly rays: THREE.WebGLRenderTarget;
  private readonly bloomA: THREE.WebGLRenderTarget;
  private readonly bloomB: THREE.WebGLRenderTarget;
  private readonly quad = new FullScreenQuad();
  private readonly mats;
  private aoPass: N8AOPass | null = null;
  private readonly sunUv = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private readonly black = new THREE.Color(0, 0, 0);

  constructor(renderer: THREE.WebGLRenderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const hdr = { type: THREE.HalfFloatType, depthBuffer: false };
    this.scene = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(size.x, size.y),
    });
    this.aoOut = new THREE.WebGLRenderTarget(size.x, size.y, hdr);
    this.lit = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: true });
    this.mask = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.vol = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.rays = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.bloomA = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.bloomB = new THREE.WebGLRenderTarget(1, 1, hdr);

    const mat = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, toneMapped = false) =>
      new THREE.ShaderMaterial({ vertexShader: quadVertex, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped });
    this.mats = {
      occlusion: mat(occlusionFragment, {
        tColor: { value: this.scene.texture },
        tDepth: { value: this.scene.depthTexture },
        uSun: { value: this.sunUv },
        uAspect: { value: 1 },
      }),
      rays: mat(raysFragment, { tMask: { value: this.mask.texture }, uSun: { value: this.sunUv } }),
      mist: mat(mistFragment, {
        tColor: { value: this.scene.texture },
        tDepth: { value: this.scene.depthTexture },
        uProjInv: { value: new THREE.Matrix4() },
        uViewInv: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uMistColor: { value: new THREE.Color() },
        uDensity: { value: 0 },
        uFalloff: { value: 0.1 },
        uBase: { value: 0 },
        tVol: { value: this.vol.texture },
        uVolTexel: { value: new THREE.Vector2() },
        uVolOn: { value: 0 },
        uHeat: { value: Array.from({ length: HEAT_SOURCES }, () => new THREE.Vector4()) },
        uHeatDist: { value: new Array<number>(HEAT_SOURCES).fill(0) },
        uHeatCount: { value: 0 },
        uTime: { value: 0 },
        uWaterOn: { value: 0 },
        uWaterLevel: { value: 0 },
        tHeight: { value: null },
        uHeightMap: { value: new THREE.Vector3(1, 1, 1) },
        uViewProj: { value: new THREE.Matrix4() },
      }),
      volumetric: new THREE.ShaderMaterial({
        vertexShader: quadVertex,
        fragmentShader: volumetricFragment,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tDepth: { value: this.scene.depthTexture },
          tShadow: { value: null },
          uShadowMatrix: { value: new THREE.Matrix4() },
          uProjInv: { value: new THREE.Matrix4() },
          uViewInv: { value: new THREE.Matrix4() },
          uCamPos: { value: new THREE.Vector3() },
          uTime: { value: 0 },
          uAir: { value: 0 },
          uMistDensity: { value: 0 },
          uMistFalloff: { value: 0.1 },
          uMistBase: { value: 0 },
          uSpotOn: { value: 0 },
          uSpotPos: { value: new THREE.Vector3() },
          uSpotDir: { value: new THREE.Vector3() },
          uSpotColor: { value: new THREE.Color() },
          uSpotCosOuter: { value: 0.9 },
          uSpotCosInner: { value: 0.95 },
          uSpotRange: { value: 30 },
          uShadowOn: { value: 0 },
          uPointPos: { value: Array.from({ length: VOL_POINTS }, () => new THREE.Vector4()) },
          uPointColor: { value: Array.from({ length: VOL_POINTS }, () => new THREE.Color()) },
          uPointCount: { value: 0 },
          uSunOn: { value: 0 },
          tSunShadow: { value: null },
          uSunMatrix: { value: new THREE.Matrix4() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color() },
          uGroundFog: { value: 0 },
          uAmbient: { value: new THREE.Color() },
          tHeight: { value: null },
          uHeightMap: { value: new THREE.Vector3(1, 1, 1) },
          uWake: { value: Array.from({ length: WAKES }, () => new THREE.Vector4()) },
          uWakeCount: { value: 0 },
          uMarch: { value: 30 },
        },
      }),
      bright: mat(brightFragment, { tColor: { value: this.lit.texture }, uThreshold: { value: 1.1 } }),
      blur: mat(blurFragment, { tInput: { value: null }, uDir: { value: new THREE.Vector2() } }),
      composite: mat(
        compositeFragment,
        {
          tColor: { value: this.lit.texture },
          tRays: { value: this.rays.texture },
          tBloom: { value: this.bloomA.texture },
          uRayColor: { value: new THREE.Color() },
          uRays: { value: 0 },
          uBloom: { value: 0 },
          uSaturation: { value: 1 },
          uGlowKeep: { value: 0 },
          uContrast: { value: 1 },
          uShadows: { value: new THREE.Color(0, 0, 0) },
          uHighlights: { value: new THREE.Color(1, 1, 1) },
          uGrain: { value: 0 },
          uVignette: { value: 0.55 },
          uAberration: { value: 0 },
          uTime: { value: 0 },
          uRes: { value: new THREE.Vector2(size.x, size.y) },
        },
        true,
      ),
    };
    this.setSize(size.x, size.y);
  }

  setSize(width: number, height: number): void {
    this.scene.setSize(width, height);
    this.aoOut.setSize(width, height);
    this.lit.setSize(width, height);
    this.aoPass?.setSize(width, height);
    const hw = Math.max(1, Math.floor(width / 2));
    const hh = Math.max(1, Math.floor(height / 2));
    this.mask.setSize(hw, hh);
    this.vol.setSize(hw, hh);
    this.mats.mist.uniforms.uVolTexel.value.set(1 / hw, 1 / hh);
    this.rays.setSize(hw, hh);
    const qw = Math.max(1, Math.floor(width / 4));
    const qh = Math.max(1, Math.floor(height / 4));
    this.bloomA.setSize(qw, qh);
    this.bloomB.setSize(qw, qh);
    this.mats.occlusion.uniforms.uAspect.value = width / height;
    this.mats.composite.uniforms.uRes.value.set(width, height);
  }

  /** Umgebungsverdeckung, die das bereits gezeichnete Szenenbild (samt Tiefe) weiterverwendet. */
  private ensureAO(scene: THREE.Scene, camera: THREE.Camera): N8AOPass {
    if (this.aoPass) return this.aoPass;
    const pass = new N8AOPass(scene, camera, this.scene.width, this.scene.height);
    pass.beautyRenderTarget.dispose();
    pass.beautyRenderTarget = this.scene;
    pass.autoDetectTransparency = false;
    pass.setQualityMode('Medium');
    const c = pass.configuration;
    c.autoRenderBeauty = false;
    c.gammaCorrection = false; // wir bleiben bis zum Schluss im linearen HDR-Raum
    c.halfRes = true;
    c.aoRadius = 2.2;
    c.distanceFalloff = 1.2;
    c.intensity = 3.2;
    this.aoPass = pass;
    return pass;
  }

  /** Zeichnet die Szene mit allen Effekten auf den Bildschirm. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, p: PostFXParams): void {
    renderer.setRenderTarget(this.scene);
    renderer.clear();
    renderer.render(scene, camera);

    // Lichtquelle in Bildschirmkoordinaten; hinter der Kamera → keine Strahlen.
    this.tmp.copy(camera.position).addScaledVector(p.lightDir, 400).project(camera);
    const inFront = this.tmp.z < 1;
    this.sunUv.set(this.tmp.x * 0.5 + 0.5, this.tmp.y * 0.5 + 0.5);
    // Auch knapp außerhalb des Bildes noch Strahlen zeigen, dann weich ausblenden.
    const edge = Math.max(Math.abs(this.tmp.x), Math.abs(this.tmp.y));
    const rays = inFront && !p.underwater ? p.rays * (1 - THREE.MathUtils.smoothstep(edge, 1.0, 1.6)) : 0;

    if (rays > 0.001) {
      this.pass(renderer, this.mats.occlusion, this.mask);
      this.pass(renderer, this.mats.rays, this.rays);
    } else {
      renderer.setRenderTarget(this.rays);
      renderer.setClearColor(this.black, 1);
      renderer.clear();
    }

    // Umgebungsverdeckung → Bodennebel → `lit`
    let color = this.scene.texture;
    if (this.ao) {
      this.ensureAO(scene, camera).render(renderer, this.aoOut);
      color = this.aoOut.texture;
    }
    const m = this.mats.mist.uniforms;
    m.tColor.value = color;
    m.uProjInv.value.copy(camera.projectionMatrixInverse);
    m.uViewInv.value.copy(camera.matrixWorld);
    m.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    m.uMistColor.value.copy(p.mist.color);
    m.uDensity.value = p.underwater ? 0 : p.mist.density;
    m.uFalloff.value = 1 / Math.max(0.5, p.mist.height);
    m.uBase.value = p.mist.base;
    m.uVolOn.value = this.renderVolumetric(renderer, camera, p) ? 1 : 0;
    m.uTime.value = p.time;
    const w = p.water;
    m.uWaterOn.value = w && !p.underwater ? 1 : 0;
    if (w) {
      m.uWaterLevel.value = w.level;
      m.tHeight.value = w.heightTexture;
      m.uHeightMap.value.copy(w.heightMapping);
      m.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    }
    m.uHeatCount.value = p.underwater ? 0 : this.projectHeat(camera, p.heat ?? []);
    this.pass(renderer, this.mats.mist, this.lit);

    // Gegenstand in der Hand darüber (eigener Tiefenpuffer, nicht vernebelt, ohne Umgebungsverdeckung).
    if (p.overlay) {
      renderer.setRenderTarget(this.lit);
      renderer.clearDepth();
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(p.overlay.scene, p.overlay.camera);
      renderer.autoClear = auto;
    }

    // Bloom: Schwelle → 2 × (horizontal + vertikal) weichzeichnen
    this.pass(renderer, this.mats.bright, this.bloomA);
    const blur = this.mats.blur.uniforms;
    for (let i = 0; i < 2; i++) {
      blur.tInput.value = this.bloomA.texture;
      blur.uDir.value.set((1 + i) / this.bloomA.width, 0);
      this.pass(renderer, this.mats.blur, this.bloomB);
      blur.tInput.value = this.bloomB.texture;
      blur.uDir.value.set(0, (1 + i) / this.bloomA.height);
      this.pass(renderer, this.mats.blur, this.bloomA);
    }

    const c = this.mats.composite.uniforms;
    const g = p.grade;
    c.uRays.value = rays;
    c.uRayColor.value.copy(p.lightColor);
    c.uBloom.value = p.bloom;
    c.uSaturation.value = g.saturation;
    c.uGlowKeep.value = g.glow ?? 0;
    c.uContrast.value = g.contrast;
    c.uShadows.value.copy(g.shadows);
    c.uHighlights.value.copy(g.highlights);
    c.uGrain.value = g.grain;
    c.uVignette.value = g.vignette;
    c.uAberration.value = g.aberration;
    c.uTime.value = p.time;
    renderer.setRenderTarget(null);
    this.quad.material = this.mats.composite;
    this.quad.render(renderer);
  }

  private placeholderShadow(renderer: THREE.WebGLRenderer): THREE.DepthTexture {
    if (!this.dummyShadow) {
      const depth = new THREE.DepthTexture(1, 1);
      depth.compareFunction = THREE.LessEqualCompare;
      this.dummyShadow = new THREE.WebGLRenderTarget(1, 1, { depthTexture: depth });
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(this.dummyShadow);
      renderer.clear();
      renderer.setRenderTarget(prev);
    }
    return this.dummyShadow.depthTexture!;
  }

  /** Feuer für das Hitzeflimmern auf den Bildschirm projizieren. @returns Anzahl sichtbarer Quellen. */
  private projectHeat(camera: THREE.PerspectiveCamera, sources: readonly HeatSource[]): number {
    const u = this.mats.mist.uniforms;
    const cam = this.tmpCam.setFromMatrixPosition(camera.matrixWorld);
    const sorted = sources.slice().sort((a, b) => a.position.distanceToSquared(cam) - b.position.distanceToSquared(cam));
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    let n = 0;
    for (const s of sorted) {
      if (n >= HEAT_SOURCES) break;
      const dist = s.position.distanceTo(cam);
      if (dist > 40 || dist < 0.3) continue;
      const v = this.tmpHeat.copy(s.position).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.6 || v.y > 1.2 || v.y < -2.5) continue;
      // Breite und Höhe des Flimmerbereichs in Bildkoordinaten (0..1).
      const h = (s.size * 3.2) / (dist * halfH * 2);
      const w = h * 0.38 / camera.aspect;
      u.uHeat.value[n].set((v.x + 1) / 2, (v.y + 1) / 2, w, h);
      u.uHeatDist.value[n] = dist;
      n++;
    }
    return n;
  }

  /** Licht im Nebel in `vol` zeichnen. @returns false, wenn es nichts zu zeigen gibt. */
  private renderVolumetric(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, p: PostFXParams): boolean {
    const v = p.volumetric;
    if (!v || p.underwater) return false;
    const u = this.mats.volumetric.uniforms;
    const lamps = v.strength >= 0.01;
    const spot = lamps && v.spot && v.spot.visible && v.spot.intensity > 0 ? v.spot : null;
    let points = 0;
    if (lamps) {
      for (const l of v.points) {
        // Nur nahe Lichtquellen (Feuer, Fackeln) – nicht das weitreichende Blitzlicht.
        if (points >= VOL_POINTS || l.intensity <= 0 || l.distance > 120) continue;
        u.uPointPos.value[points].set(l.position.x, l.position.y, l.position.z, l.distance || 20);
        u.uPointColor.value[points].copy(l.color).multiplyScalar(l.intensity * v.strength);
        points++;
      }
    }
    const sunMap = v.sun && v.sun.strength > 0.01 && v.sun.light.castShadow ? v.sun.light.shadow.map?.depthTexture : null;
    const ground = v.ground && v.ground.density > 0.005 ? v.ground : null;
    if (!spot && points === 0 && !sunMap && !ground) return false;
    u.uPointCount.value = points;
    u.uSpotOn.value = spot ? 1 : 0;
    if (spot) {
      spot.updateMatrixWorld();
      spot.getWorldPosition(u.uSpotPos.value);
      u.uSpotDir.value.copy(spot.target.position).sub(u.uSpotPos.value).normalize();
      u.uSpotColor.value.copy(spot.color).multiplyScalar(spot.intensity * v.strength);
      u.uSpotCosOuter.value = Math.cos(spot.angle);
      u.uSpotCosInner.value = Math.cos(spot.angle * (1 - spot.penumbra));
      u.uSpotRange.value = spot.distance || 30;
      const map = spot.castShadow ? spot.shadow.map?.depthTexture : null;
      u.uShadowOn.value = map ? 1 : 0;
      u.tShadow.value = map ?? this.placeholderShadow(renderer);
      if (map) u.uShadowMatrix.value.copy(spot.shadow.matrix);
    } else {
      u.uShadowOn.value = 0;
      u.tShadow.value = this.placeholderShadow(renderer);
    }
    u.uSunOn.value = sunMap ? 1 : 0;
    u.tSunShadow.value = sunMap ?? this.placeholderShadow(renderer);
    if (sunMap && v.sun) {
      const sun = v.sun.light;
      u.uSunMatrix.value.copy(sun.shadow.matrix);
      u.uSunDir.value.subVectors(sun.position, sun.target.position).normalize();
      u.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity * v.sun.strength);
    }
    u.uGroundFog.value = ground ? ground.density : 0;
    if (ground) {
      u.uAmbient.value.copy(ground.ambient);
      u.tHeight.value = ground.heightTexture;
      u.uHeightMap.value.copy(ground.heightMapping);
      const n = Math.min(WAKES, ground.wakes.length);
      for (let i = 0; i < n; i++) u.uWake.value[i].copy(ground.wakes[i]);
      u.uWakeCount.value = n;
    } else {
      // Der Sampler braucht trotzdem eine Textur.
      u.tHeight.value = u.tHeight.value ?? this.blank;
      u.uWakeCount.value = 0;
    }
    // Bodennebel und Sonnenstrahlen in der Nähe; die Lampe so weit sie reicht.
    u.uMarch.value = Math.max(spot ? spot.distance || 30 : 0, sunMap || ground ? 45 : 0);
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uViewInv.value.copy(camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uTime.value = p.time;
    u.uAir.value = v.air;
    u.uMistDensity.value = p.mist.density;
    u.uMistFalloff.value = 1 / Math.max(0.5, p.mist.height);
    u.uMistBase.value = p.mist.base;
    this.pass(renderer, this.mats.volumetric, this.vol);
    return true;
  }

  private pass(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(target);
    this.quad.material = material;
    this.quad.render(renderer);
  }

  dispose(): void {
    for (const rt of [this.scene, this.aoOut, this.lit, this.mask, this.vol, this.rays, this.bloomA, this.bloomB]) rt.dispose();
    this.dummyShadow?.dispose();
    Object.values(this.mats).forEach((m) => m.dispose());
    this.quad.dispose();
  }
}
