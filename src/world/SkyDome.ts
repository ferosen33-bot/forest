import * as THREE from 'three';

/** Kantenlänge der 3D-Rauschtextur für die Wolken. */
const NOISE_SIZE = 64;

/**
 * Kachelbares 3D-Rauschen für die Wolken: R = Grundform (Perlin-Worley), G = feine Ausfransung.
 * Einmal beim Start berechnet (~0,1 s), danach nur noch Texturzugriffe im Shader.
 */
function createCloudNoise(): THREE.Data3DTexture {
  const N = NOISE_SIZE;
  const data = new Uint8Array(N * N * N * 4);
  const rand = (x: number, y: number, z: number, seed: number) => {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269504) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  // Wertrauschen mit Periode `period` (kachelbar).
  const value = (x: number, y: number, z: number, period: number, seed: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
    const m = (v: number) => ((v % period) + period) % period;
    const c = (dx: number, dy: number, dz: number) => rand(m(xi + dx), m(yi + dy), m(zi + dz), seed);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    return lerp(
      lerp(lerp(c(0, 0, 0), c(1, 0, 0), sx), lerp(c(0, 1, 0), c(1, 1, 0), sx), sy),
      lerp(lerp(c(0, 0, 1), c(1, 0, 1), sx), lerp(c(0, 1, 1), c(1, 1, 1), sx), sy),
      sz,
    );
  };
  // Zellrauschen (Worley), invertiert: runde "Blumenkohl"-Ballen.
  const worley = (x: number, y: number, z: number, cells: number, seed: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy, cz = zi + dz;
      const m = (v: number) => ((v % cells) + cells) % cells;
      const px = cx + rand(m(cx), m(cy), m(cz), seed);
      const py = cy + rand(m(cx), m(cy), m(cz), seed + 1);
      const pz = cz + rand(m(cx), m(cy), m(cz), seed + 2);
      const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
      if (d < best) best = d;
    }
    return 1 - Math.min(1, Math.sqrt(best));
  };
  let i = 0;
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++, i += 4) {
        const u = x / N, v = y / N, w = z / N;
        let fbm = 0;
        let amp = 0.5;
        for (let o = 0, f = 4; o < 4; o++, f *= 2, amp *= 0.5) fbm += value(u * f, v * f, w * f, f, 11 + o) * amp;
        const w1 = worley(u * 4, v * 4, w * 4, 4, 3);
        const w2 = worley(u * 8, v * 8, w * 8, 8, 5);
        const w3 = worley(u * 16, v * 16, w * 16, 16, 7);
        const cells = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
        // Perlin-Worley: weiches Rauschen, in Ballen gegliedert.
        const pw = Math.min(1, Math.max(0, fbm * 0.55 + cells * 0.75 - 0.25));
        const detail = worley(u * 12, v * 12, w * 12, 12, 9) * 0.6 + worley(u * 24, v * 24, w * 24, 24, 13) * 0.4;
        data[i] = pw * 255;
        data[i + 1] = detail * 255;
        data[i + 2] = fbm * 255;
        data[i + 3] = 255;
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 pos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Auf die Far-Plane legen, damit die Kuppel nie Geometrie verdeckt.
  gl_Position = pos.xyww;
}`;

/**
 * Wolkendichte – gemeinsam für den Himmel und die Wolkenschatten auf dem Gelände (gleiche Wolken).
 */
export const CLOUD_GLSL = /* glsl */ `
uniform sampler3D tCloudNoise;
uniform float uClouds;    // Bedeckungsgrad 0..1
uniform vec2 uCloudOffset;
// Wolkenschicht (m über dem Meeresspiegel); p in Weltkoordinaten
const float CLOUD_BOTTOM = 1500.0;
const float CLOUD_TOP = 3200.0;

float cloudDensity(vec3 p, float detail) {
  float hf = (p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM);
  // Flache, runde Unterseite, nach oben ausdünnende Türme.
  float profile = smoothstep(0.0, 0.12, hf) * smoothstep(1.0, 0.45, hf);
  vec3 wind = vec3(uCloudOffset.x, 0.0, uCloudOffset.y) * 900.0;
  vec4 n = texture(tCloudNoise, (p + wind) * 0.000075);
  // Großräumige Verteilung (welche Gegenden bewölkt sind).
  float region = texture(tCloudNoise, (p + wind) * 0.000025 + 0.37).b;
  float cover = clamp(uClouds * 1.15 + 0.08 + (region - 0.5) * 0.7, 0.0, 1.0);
  float d = clamp((n.r * profile - (1.0 - cover)) / max(0.05, cover) * 1.6, 0.0, 1.0);
  if (d <= 0.0 || detail <= 0.0) return d;
  // Ränder ausfransen
  float fray = texture(tCloudNoise, (p + wind * 1.3) * 0.0004).g;
  return clamp(d - fray * 0.42 * (1.0 - d) * detail, 0.0, 1.0);
}

`;

/** Gemeinsame Uniforms der Wolken (Himmel und Wolkenschatten). */
export const cloudUniforms = {
  tCloudNoise: { value: null as THREE.Data3DTexture | null },
  uClouds: { value: 0 },
  uCloudOffset: { value: new THREE.Vector2() },
};

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform vec3 uFogColor;   // bereits im Ausgabe-Farbraum (wie Three.js' fogColor)
uniform float uNight;     // 0 = Tag, 1 = Nacht
uniform float uSunVisible;
uniform float uHorizonFog;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uCloudLit;   // Farbe sonnenbeschienener Wolken
uniform vec3 uCloudShade; // Farbe der Wolkenunterseite
uniform float uFlash;     // Blitz
varying vec3 vDir;

${CLOUD_GLSL}
float hgPhase(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}



float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, 0.0, 1.0);

  vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));

  // Sonne: harte Scheibe + weicher Halo (Mie-ähnlich).
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (smoothstep(0.9993, 0.9997, sd) * 12.0 + pow(sd, 10.0) * 0.35 + pow(sd, 120.0) * 0.8) * uSunVisible;

  // Mond
  float md = max(dot(dir, uMoonDir), 0.0);
  col += vec3(0.75, 0.82, 1.0) * (smoothstep(0.9994, 0.9997, md) * 1.6 + pow(md, 60.0) * 0.06) * uNight;

  // Sterne: zufällige Zellen auf einer Richtungs-Kugel, mit Funkeln.
  if (uNight > 0.01) {
    vec3 p = dir * 280.0;
    vec3 cell = floor(p);
    float r = hash(cell);
    if (r > 0.9965) {
      vec3 center = cell + 0.5 + (vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1)) - 0.5) * 0.6;
      float d = length(p - center);
      float twinkle = 0.65 + 0.35 * sin(uTime * (2.0 + r * 8.0) + r * 100.0);
      col += vec3(smoothstep(0.32, 0.0, d)) * twinkle * uNight * smoothstep(0.0, 0.25, dir.y) * 1.4;
    }
  }

  // Volumetrische Wolken: Strahl durch die Wolkenschicht, Licht per Beer-Lambert und Streuphase.
  if (uClouds > 0.01 && dir.y > 0.005) {
    float t0 = (CLOUD_BOTTOM - uCamPos.y) / dir.y;
    float t1 = min((CLOUD_TOP - uCamPos.y) / dir.y, t0 + 7000.0);
    vec3 origin = uCamPos;
    if (t0 < 45000.0) {
      const int STEPS = 30;
      float stepLen = (t1 - t0) / float(STEPS);
      float jitter = hash(vec3(gl_FragCoord.xy, floor(uTime * 30.0)));
      vec3 lightDir = uNight > 0.5 ? uMoonDir : uSunDir;
      float cosT = dot(dir, lightDir);
      // Vorwärtsstreuung (Silberrand an der Sonne) plus etwas Rückstreuung.
      float phase = mix(hgPhase(cosT, 0.65), hgPhase(cosT, -0.2), 0.35) * 4.0 * 3.14159;
      float T = 1.0;
      vec3 L = vec3(0.0);
      for (int i = 0; i < STEPS; i++) {
        vec3 p = origin + dir * (t0 + (float(i) + jitter) * stepLen);
        float d = cloudDensity(p, 1.0);
        if (d > 0.002) {
          // Licht auf dem Weg zur Sonne: wie viel Wolke liegt dazwischen?
          float od = 0.0;
          for (int j = 0; j < 4; j++) od += cloudDensity(p + lightDir * (float(j) + 0.5) * 220.0, 0.0);
          float lightT = exp(-od * 220.0 * 0.0055) ;
          float powder = 1.0 - exp(-d * 6.0);
          float hf = clamp((p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM), 0.0, 1.0);
          // Unterseite dunkel, Kuppen hell: Streulicht nimmt nach oben zu.
          vec3 ambient = mix(uCloudShade * 0.55, uCloudLit * 0.8, smoothstep(0.0, 0.8, hf));
          vec3 direct = mix(uCloudLit, uSunColor * 1.8, 0.5 * uSunVisible) * lightT * phase * mix(1.0, powder, 0.7) * 1.25;
          vec3 lum = ambient + direct;
          float a = exp(-d * stepLen * 0.0045);
          L += T * (1.0 - a) * lum;
          T *= a;
          if (T < 0.02) break;
        }
      }
      // Am Horizont in den Himmel verblassen (dort liegt der Nebel).
      float fade = smoothstep(0.0, 0.07, dir.y) * (1.0 - smoothstep(18000.0, 45000.0, t0));
      col = col * mix(1.0, T, fade) + L * fade;
    }
  }
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.6 + 0.4 * uClouds);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  // Horizont in den Nebel überblenden – identisch zur Nebelfarbe weit entfernter Objekte.
  float fogT = 1.0 - smoothstep(-0.02, uHorizonFog, dir.y);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogT);
}`;

/**
 * Prozedurale Himmelskuppel. Farben, Sonnen- und Mondstand werden vom
 * DayNightCycle gesetzt; die Kuppel folgt der Kamera.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uFogColor: { value: new THREE.Color() },
    uNight: { value: 0 },
    uSunVisible: { value: 1 },
    uHorizonFog: { value: 0.18 },
    uTime: { value: 0 },
    uClouds: cloudUniforms.uClouds,
    uCamPos: { value: new THREE.Vector3() },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uCloudOffset: cloudUniforms.uCloudOffset,
    uFlash: { value: 0 },
    tCloudNoise: cloudUniforms.tCloudNoise,
  };

  constructor(radius = 500) {
    cloudUniforms.tCloudNoise.value ??= createCloudNoise();
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
    this.mesh.name = 'Sky';
    this.mesh.frustumCulled = false;
    // Nach der undurchsichtigen Geometrie zeichnen: verdeckte Himmelspixel (und ihre Wolken-Strahlen)
    // verwirft dann schon der Tiefentest. Die Kuppel liegt auf der Far-Plane.
    this.mesh.renderOrder = 1000;
  }

  follow(position: THREE.Vector3): void {
    this.mesh.position.copy(position);
    this.uniforms.uCamPos.value.copy(position);
  }
}
