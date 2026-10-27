import * as THREE from 'three';
import { ELEMENTS, type ElementId } from './items/Elements';

const MODES: Record<ElementId, number> = { fire: 0, shock: 1, caustic: 2, bleed: 3 };
const POINTS = 48;

/** Leuchtender Rand, nach oben zur Klinge hin stärker; flackert je nach Element. */
const SHELL_VERTEX = /* glsl */ `
uniform mat4 uToItem;
uniform vec2 uBounds;
varying vec3 vNormalV;
varying vec3 vViewV;
varying float vHeight;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewV = -mv.xyz;
  float y = (uToItem * vec4(position, 1.0)).y;
  vHeight = clamp((y - uBounds.x) / max(uBounds.y - uBounds.x, 1e-4), 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const SHELL_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform int uMode;
varying vec3 vNormalV;
varying vec3 vViewV;
varying float vHeight;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float rim = 1.0 - abs(dot(normalize(vNormalV), normalize(vViewV)));
  float glow = pow(rim, 1.8) * 1.1 + 0.22;
  float mask = 0.15 + 0.85 * smoothstep(0.25, 0.7, vHeight);
  float f = 1.0;
  if (uMode == 0) {
    // Feuer: unruhiges Flackern, das am Blatt hochläuft.
    f = 0.7 + 0.3 * sin(uTime * 13.0 - vHeight * 18.0) + 0.2 * sin(uTime * 29.0 + vHeight * 7.0);
  } else if (uMode == 1) {
    // Schock: meist ruhig, dann kurze, helle Entladungen.
    float k = floor(uTime * 22.0);
    f = 0.45 + step(0.78, hash(k)) * 1.8 + 0.25 * step(0.5, hash(k + vHeight * 31.0));
  } else if (uMode == 2) {
    // Säure: langsames, zähes Pulsieren.
    f = 0.65 + 0.35 * sin(uTime * 2.6 + vHeight * 4.0);
  } else {
    // Blutung: dunkles Glimmen, wie ein Herzschlag.
    float beat = fract(uTime * 1.1);
    f = 0.35 + 0.65 * exp(-beat * 7.0) + 0.4 * exp(-max(beat - 0.18, 0.0) * 9.0) * step(0.18, beat);
  }
  gl_FragColor = vec4(uColor * glow * mask * f, 1.0);
}
`;

const POINT_VERTEX = /* glsl */ `
attribute float aLife;
attribute float aSize;
varying float vLife;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vLife = aLife;
  gl_PointSize = aSize * 420.0 / max(-mv.z, 0.05) * smoothstep(0.0, 0.25, aLife);
  gl_Position = projectionMatrix * mv;
}
`;

const POINT_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vLife;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(uColor * a * a * min(1.0, vLife * 2.5), 1.0);
}
`;

interface Mote {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  size: number;
}

/**
 * Sichtbarer Waffenmod in der Hand: ein leuchtender Rand in der Farbe des Elements (zur Klinge hin
 * stärker) und Partikel – Glut steigt auf, Funken springen, Säure und Blut tropfen ab.
 * Hängt am Item-Modell im Viewmodel und schwingt so mit.
 */
export class WeaponAura {
  private element: ElementId | null = null;
  private readonly shells: THREE.Mesh[] = [];
  private readonly shellMaterials: THREE.ShaderMaterial[] = [];
  private readonly motes: Mote[] = [];
  private readonly geometry = new THREE.BufferGeometry();
  private readonly points: THREE.Points;
  private readonly pointMaterial: THREE.ShaderMaterial;
  private readonly box = new THREE.Box3();
  private model: THREE.Object3D | null = null;
  private time = 0;
  private spawn = 0;
  private readonly up = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly worldScale = new THREE.Vector3();

  constructor() {
    const positions = new Float32Array(POINTS * 3);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(POINTS), 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(POINTS), 1).setUsage(THREE.DynamicDrawUsage));
    this.pointMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Vector3() } },
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.pointMaterial);
    this.points.frustumCulled = false;
    for (let i = 0; i < POINTS; i++) this.motes.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, size: 0 });
  }

  /** Farbe für das Licht an der Hand (null = kein Mod). */
  get lightColor(): THREE.Color | null {
    if (!this.element) return null;
    const [r, g, b] = ELEMENTS[this.element].glow;
    const m = Math.max(r, g, b);
    return new THREE.Color(r / m, g / m, b / m);
  }

  /** Flackern des Elements 0..1 (für das Licht an der Hand). */
  get flicker(): number {
    const t = this.time;
    switch (this.element) {
      case 'fire':
        return 0.75 + 0.25 * Math.sin(t * 17) * Math.sin(t * 7.3);
      case 'shock':
        return Math.random() < 0.15 ? 1.6 : 0.35;
      case 'caustic':
        return 0.6 + 0.3 * Math.sin(t * 2.6);
      default:
        return 0.3;
    }
  }

  /** An ein Item-Modell (ohne Griff-Drehung, eigener Ursprung) hängen bzw. lösen. */
  attach(model: THREE.Object3D | null, element: ElementId | null): void {
    this.detach();
    this.element = element;
    if (!model || !element) return;
    this.model = model;
    const [r, g, b] = ELEMENTS[element].glow;
    // Ausdehnung des Items in seinem eigenen Raum (für Höhenmaske und Partikel).
    model.updateMatrixWorld(true);
    const toItem = new THREE.Matrix4().copy(model.matrixWorld).invert();
    this.box.makeEmpty();
    const meshes: THREE.Mesh[] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) meshes.push(m);
    });
    for (const m of meshes) {
      m.geometry.computeBoundingBox();
      const rel = new THREE.Matrix4().multiplyMatrices(toItem, m.matrixWorld);
      this.box.union(m.geometry.boundingBox!.clone().applyMatrix4(rel));
    }
    for (const m of meshes) {
      const rel = new THREE.Matrix4().multiplyMatrices(toItem, m.matrixWorld);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Vector3(r, g, b) },
          uTime: { value: 0 },
          uMode: { value: MODES[element] },
          uToItem: { value: rel },
          uBounds: { value: new THREE.Vector2(this.box.min.y, this.box.max.y) },
        },
        vertexShader: SHELL_VERTEX,
        fragmentShader: SHELL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthFunc: THREE.LessEqualDepth,
        blending: THREE.AdditiveBlending,
      });
      const shell = new THREE.Mesh(m.geometry, material);
      shell.renderOrder = 2;
      m.add(shell);
      this.shells.push(shell);
      this.shellMaterials.push(material);
    }
    this.pointMaterial.uniforms.uColor.value.set(r, g, b);
    for (const p of this.motes) p.life = 0;
    model.add(this.points);
  }

  private detach(): void {
    for (const s of this.shells) s.removeFromParent();
    for (const m of this.shellMaterials) m.dispose();
    this.shells.length = 0;
    this.shellMaterials.length = 0;
    this.points.removeFromParent();
    this.model = null;
  }

  update(dt: number): void {
    this.time += dt;
    for (const m of this.shellMaterials) m.uniforms.uTime.value = this.time;
    if (!this.model || !this.element) return;
    // Weltoben im Raum des Items: Glut steigt nach oben, Tropfen fallen nach unten – wie das Item auch gedreht ist.
    this.model.getWorldQuaternion(this.quat).invert();
    this.model.getWorldScale(this.worldScale);
    this.up.set(0, 1, 0).applyQuaternion(this.quat).divideScalar(this.worldScale.y || 1);
    const rate = { fire: 40, shock: 26, caustic: 14, bleed: 9 }[this.element];
    this.spawn += dt * rate;
    const size = this.box.getSize(new THREE.Vector3());
    for (const p of this.motes) {
      if (p.life > 0) {
        p.life -= dt;
        p.pos.addScaledVector(p.vel, dt);
        if (this.element === 'caustic' || this.element === 'bleed') p.vel.addScaledVector(this.up, -dt * 1.8);
        continue;
      }
      if (this.spawn < 1) continue;
      this.spawn -= 1;
      // Irgendwo im oberen Teil des Items (Klinge, Kopf).
      p.pos.set(
        this.box.min.x + Math.random() * size.x,
        this.box.min.y + (0.45 + Math.random() * 0.55) * size.y,
        this.box.min.z + Math.random() * size.z,
      );
      switch (this.element) {
        case 'fire':
          p.vel.copy(this.up).multiplyScalar(0.18 + Math.random() * 0.2);
          p.life = 0.35 + Math.random() * 0.4;
          p.size = 0.012 + Math.random() * 0.012;
          break;
        case 'shock':
          p.vel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.8 / (this.worldScale.y || 1));
          p.life = 0.06 + Math.random() * 0.1;
          p.size = 0.008 + Math.random() * 0.01;
          break;
        default:
          p.vel.set(0, 0, 0);
          p.life = 0.5 + Math.random() * 0.5;
          p.size = this.element === 'caustic' ? 0.01 + Math.random() * 0.006 : 0.008 + Math.random() * 0.005;
      }
    }
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const life = this.geometry.getAttribute('aLife') as THREE.BufferAttribute;
    const sz = this.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    this.motes.forEach((p, i) => {
      pos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
      life.setX(i, Math.max(0, p.life));
      sz.setX(i, p.size);
    });
    pos.needsUpdate = true;
    life.needsUpdate = true;
    sz.needsUpdate = true;
  }
}
