import * as THREE from 'three';
import { mulberry32 } from '../utils/random';

/** Kantenlänge (horizontal) und Höhe des Regen-Volumens um die Kamera (m). */
const BOX = 34;
const HEIGHT = 20;
const MAX_DROPS = 9000;

const vertexShader = /* glsl */ `
attribute vec3 aOffset;   // Startposition im Volumen [0, BOX) × [0, HEIGHT) × [0, BOX)
attribute float aSpeed;
uniform float uTime;
/** Zurückgelegte Fallstrecke-Basis: ∫ Fallgeschwindigkeitsfaktor dt (Schnee fällt langsamer). */
uniform float uFall;
uniform float uSnow;
uniform vec3 uCamera;
uniform vec2 uWind;       // seitlicher Versatz pro Meter Fall
uniform float uBox, uHeight;
varying float vAlpha;
varying float vAlong;

void main() {
  float fall = uFall * aSpeed;
  // Position im Volumen, das mit der Kamera mitwandert (modulo → nahtlos).
  float y = mod(aOffset.y - fall - uCamera.y + uHeight * 0.5, uHeight) - uHeight * 0.5;
  vec2 xz = aOffset.xz + uWind * (aOffset.y - fall);
  // Schneeflocken taumeln seitlich.
  xz += uSnow * 0.35 * vec2(sin(uTime * 1.3 + aOffset.x * 3.1), cos(uTime * 1.1 + aOffset.z * 2.7));
  xz = mod(xz - uCamera.xz + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 center = uCamera + vec3(xz.x, y, xz.y);

  // Schliere entlang der Fallrichtung, Breite quer zur Blickrichtung (Billboard um die Fallachse).
  vec3 fallDir = normalize(vec3(-uWind.x, 1.0, -uWind.y));
  vec3 toCam = normalize(uCamera - center);
  vec3 side = normalize(cross(fallDir, toCam));
  float len = mix(0.45 + aSpeed * 0.02, 0.035, uSnow);
  vec3 world = center + fallDir * position.y * len + side * position.x * mix(0.012, 0.03, uSnow);

  // Nah: fein, fern: ausblenden (Nebel übernimmt den Rest).
  float dist = length(xz);
  vAlpha = (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, dist)) * smoothstep(0.6, 2.0, length(uCamera - center));
  vAlong = position.y + 0.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying float vAlong;
void main() {
  // Zum Ende der Schliere hin auslaufen
  float a = vAlpha * uOpacity * smoothstep(0.0, 0.35, vAlong) * smoothstep(1.0, 0.6, vAlong);
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

/**
 * Regen auf der GPU: ein festes Volumen aus Schlieren wandert mit der Kamera, der Vertex-Shader
 * lässt sie fallen, neigt sie im Wind und wickelt sie per Modulo um – ein Draw Call,
 * keine CPU-Arbeit pro Tropfen. Die Dichte folgt der Regenstärke über `instanceCount`.
 */
export class Rain {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly uniforms = {
    uTime: { value: 0 },
    uFall: { value: 0 },
    uSnow: { value: 0 },
    uCamera: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector2() },
    uBox: { value: BOX },
    uHeight: { value: HEIGHT },
    uColor: { value: new THREE.Color(0xb8c4cc) },
    uOpacity: { value: 0.3 },
  };

  constructor() {
    const rng = mulberry32(77);
    const offsets = new Float32Array(MAX_DROPS * 3);
    const speeds = new Float32Array(MAX_DROPS);
    for (let i = 0; i < MAX_DROPS; i++) {
      offsets[i * 3] = rng() * BOX;
      offsets[i * 3 + 1] = rng() * HEIGHT;
      offsets[i * 3 + 2] = rng() * BOX;
      speeds[i] = 11 + rng() * 5;
    }
    // Quad von -0,5 bis 0,5 (x = Breite, y = Länge)
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    this.geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
    this.geometry.instanceCount = 0;
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = 'Rain';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /**
   * @param intensity Regenstärke 0..1
   * @param wind      Windstärke 0..1 (neigt die Schlieren)
   * @param brightness Umgebungshelligkeit 0..1 (nachts kaum sichtbar)
   */
  update(elapsed: number, camera: THREE.Vector3, intensity: number, wind: number, brightness: number, snow = 0): void {
    const u = this.uniforms;
    const dt = Math.min(0.1, Math.max(0, elapsed - u.uTime.value));
    u.uTime.value = elapsed;
    // Schnee fällt mit ~13 % der Regengeschwindigkeit; integriert, damit Übergänge nicht springen.
    u.uFall.value += dt * (1 - 0.87 * snow);
    u.uSnow.value = snow;
    u.uColor.value.setRGB(0.72 + 0.23 * snow, 0.77 + 0.19 * snow, 0.8 + 0.17 * snow);
    u.uCamera.value.copy(camera);
    u.uWind.value.set(0.12 + wind * 0.35, 0.05 + wind * 0.12);
    u.uOpacity.value = (0.12 + 0.28 * brightness) * (1 + 0.8 * snow);
    this.geometry.instanceCount = Math.floor(MAX_DROPS * Math.min(1, intensity * 1.15));
    this.mesh.visible = this.geometry.instanceCount > 0;
  }

  get drops(): number {
    return this.geometry.instanceCount;
  }
}
