import * as THREE from 'three';

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 pos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Auf die Far-Plane legen, damit die Kuppel nie Geometrie verdeckt.
  gl_Position = pos.xyww;
}`;

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
uniform float uClouds;    // Bedeckungsgrad 0..1
uniform vec3 uCloudLit;   // Farbe sonnenbeschienener Wolken
uniform vec3 uCloudShade; // Farbe der Wolkenunterseite
uniform vec2 uCloudOffset;
uniform float uFlash;     // Blitz
varying vec3 vDir;

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float cloudFbm(vec2 p) {
  float s = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    s += vnoise(p) * amp;
    p = p * 2.03 + vec2(13.7, 7.1);
    amp *= 0.5;
  }
  return s;
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

  // Wolkendecke: Rauschen auf einer gedachten Ebene über dem Spieler (Perspektive über 1/dir.y).
  if (uClouds > 0.01 && dir.y > 0.0) {
    vec2 uv = dir.xz / (dir.y + 0.12) * 0.9 + uCloudOffset;
    float n = cloudFbm(uv);
    float cover = smoothstep(1.0 - uClouds * 0.95 - 0.05, 1.08 - uClouds * 0.6, n);
    // Dichte Bereiche sind dunkler (Unterseite), Ränder heller.
    float thick = smoothstep(0.45, 0.95, n + uClouds * 0.2);
    vec3 cloud = mix(uCloudLit, uCloudShade, thick);
    // Sonne scheint durch dünne Ränder.
    cloud += uSunColor * pow(sd, 8.0) * (1.0 - thick) * 0.5 * uSunVisible;
    float alpha = cover * smoothstep(0.0, 0.18, dir.y);
    col = mix(col, cloud, alpha);
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
    uClouds: { value: 0 },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uCloudOffset: { value: new THREE.Vector2() },
    uFlash: { value: 0 },
  };

  constructor(radius = 500) {
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
    this.mesh.renderOrder = -1;
  }

  follow(position: THREE.Vector3): void {
    this.mesh.position.copy(position);
  }
}
