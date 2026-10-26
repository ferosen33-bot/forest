import * as THREE from 'three';

/**
 * Schwebstaub: winzige Teilchen, die um die Kamera in der Luft treiben. Unsichtbar, solange kein Licht
 * auf sie fällt – im Kegel der Taschenlampe und im Schein von Fackel und Feuer glitzern sie auf.
 *
 * Die Teilchen liegen in einem Würfel, der mit der Kamera wandert (Positionen werden im Vertex-Shader
 * um die Kamera herum „umgeklappt“), daher kostet der Staub auf der CPU nichts.
 */

const COUNT = 3000;
/** Kantenlänge des Würfels um die Kamera (m). */
const BOX = 7;
const POINTS = 4;

const vertex = /* glsl */ `
attribute vec3 aSeed;
uniform vec3 uCam;
uniform float uTime;
uniform float uPx;
uniform vec3 uSpotPos;
uniform vec3 uSpotDir;
uniform vec3 uSpotColor;
uniform float uSpotCos;
uniform float uSpotRange;
uniform vec4 uPointPos[${POINTS}];
uniform vec3 uPointColor[${POINTS}];
varying vec3 vColor;
const float BOX = ${BOX.toFixed(1)};

void main() {
  // Langsames Treiben und Taumeln, je Teilchen verschieden.
  vec3 drift = vec3(uTime * 0.05, uTime * -0.012, uTime * 0.03);
  vec3 wobble = 0.25 * vec3(sin(uTime * 0.7 + aSeed.x * 40.0), sin(uTime * 0.5 + aSeed.y * 30.0), cos(uTime * 0.6 + aSeed.z * 50.0));
  vec3 p = position + drift + wobble;
  // In den Würfel um die Kamera klappen.
  p = uCam + mod(p - uCam + BOX * 0.5, BOX) - BOX * 0.5;

  vec3 light = vec3(0.0);
  vec3 toP = p - uSpotPos;
  float d = length(toP);
  float cone = smoothstep(uSpotCos, mix(uSpotCos, 1.0, 0.35), dot(toP / max(d, 1e-3), uSpotDir));
  light += uSpotColor * cone / (1.0 + d * d * 0.4) * (1.0 - smoothstep(uSpotRange * 0.5, uSpotRange, d));
  for (int i = 0; i < ${POINTS}; i++) {
    vec3 lp = uPointPos[i].xyz;
    float dd = distance(p, lp);
    light += uPointColor[i] * (1.0 - smoothstep(0.0, uPointPos[i].w * 0.4, dd)) / (1.0 + dd * dd);
  }
  // Glitzern: Staubkörner drehen sich und blitzen kurz auf.
  float glint = 0.55 + 0.45 * sin(uTime * (2.0 + aSeed.x * 3.0) + aSeed.z * 20.0);
  vColor = light * glint * 0.09;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // Fade zur Würfelkante hin, damit das Umklappen nicht auffällt; vor der Linse ausblenden.
  float r = length(p - uCam);
  vColor *= (1.0 - smoothstep(BOX * 0.35, BOX * 0.5, r)) * smoothstep(0.25, 0.7, r);
  gl_PointSize = clamp(uPx * (0.6 + aSeed.y * 0.8) * 0.012 / -mv.z, 1.0, 6.0);
}`;

const fragment = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  // Unbeleuchteter Staub schreibt keine Tiefe (sonst würde er den Nebel dahinter ausstanzen).
  if (a * max(vColor.r, max(vColor.g, vColor.b)) < 0.004) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

export class Motes {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT * 3; i++) {
      pos[i] = (Math.random() - 0.5) * BOX;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uPx: { value: 720 },
        uSpotPos: { value: new THREE.Vector3() },
        uSpotDir: { value: new THREE.Vector3(0, 0, -1) },
        uSpotColor: { value: new THREE.Color(0, 0, 0) },
        uSpotCos: { value: 0.9 },
        uSpotRange: { value: 30 },
        uPointPos: { value: Array.from({ length: POINTS }, () => new THREE.Vector4()) },
        uPointColor: { value: Array.from({ length: POINTS }, () => new THREE.Color(0, 0, 0)) },
      },
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.name = 'Motes';
    this.points.frustumCulled = false;
  }

  /**
   * @param spot Taschenlampe (oder null), @param lights Punktlichter in der Nähe.
   * @param amount Staubdichte (0 = keiner, z. B. tagsüber oder unter Wasser).
   */
  update(time: number, camera: THREE.PerspectiveCamera, viewportHeight: number, spot: THREE.SpotLight | null, lights: readonly THREE.PointLight[], amount: number): void {
    const u = this.material.uniforms;
    this.points.visible = amount > 0.01;
    if (!this.points.visible) return;
    u.uTime.value = time;
    u.uCam.value.setFromMatrixPosition(camera.matrixWorld);
    // Punktgröße: Weltmaß → Pixel (Brennweite in Pixeln).
    u.uPx.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    if (spot && spot.visible && spot.intensity > 0) {
      spot.getWorldPosition(u.uSpotPos.value);
      u.uSpotDir.value.copy(spot.target.position).sub(u.uSpotPos.value).normalize();
      u.uSpotCos.value = Math.cos(spot.angle);
      u.uSpotRange.value = spot.distance || 30;
      u.uSpotColor.value.copy(spot.color).multiplyScalar(spot.intensity * amount);
    } else u.uSpotColor.value.setRGB(0, 0, 0);
    for (let i = 0; i < POINTS; i++) {
      const l = lights[i];
      if (l && l.intensity > 0) {
        u.uPointPos.value[i].set(l.position.x, l.position.y, l.position.z, l.distance || 10);
        u.uPointColor.value[i].copy(l.color).multiplyScalar(l.intensity * amount);
      } else u.uPointColor.value[i].setRGB(0, 0, 0);
    }
  }
}
