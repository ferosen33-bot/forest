import * as THREE from 'three';

/**
 * Blut: Bei Treffern spritzen Tropfen in Schlagrichtung, fliegen ballistisch und hinterlassen dort,
 * wo sie aufschlagen, Spritzer – auf dem Boden, an Wänden und Stämmen. Unter Toten breitet sich eine
 * Lache aus. Das Blut glänzt nass im Licht der Lampe und trocknet über Minuten dunkel ein, bevor es
 * verblasst.
 *
 * Tropfen und Flecken sind je ein instanziertes Mesh; die Flecken stammen aus einem gemalten Atlas.
 */

export interface BloodDeps {
  /**
   * Strahl gegen feste Oberflächen (Gelände, Bauwerke, Fels) – nicht gegen Lebewesen.
   * @returns Treffpunkt und Normale oder null.
   */
  raycast: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => { point: THREE.Vector3; normal: THREE.Vector3 } | null;
  waterLevel: number;
}

const DROPS = 160;
const DECALS = 260;
/** So lange bleibt ein Fleck sichtbar (s); die letzten 20 % verblasst er. */
const DECAL_LIFE = 300;
const TILES = 4;

interface Drop {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  size: number;
  life: number;
}

interface Decal {
  age: number;
  /** Lache: wächst nach dem Entstehen auf ihre volle Größe. */
  grow: number;
  size: number;
  matrix: THREE.Matrix4;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** Atlas mit vier Blutformen (Spritzer mit Tropfenkranz, Lache, Schmierspur, Tropfen). */
function makeAtlas(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const T = 128;
  const c = document.createElement('canvas');
  c.width = T * TILES;
  c.height = T;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blob = (x: number, y: number, r: number, alpha = 1) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grad.addColorStop(0.75, `rgba(255,255,255,${alpha * 0.9})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  // Spritzer: Kern mit Ausläufern und Tropfenkranz
  for (let i = 0; i < 9; i++) blob(64 + (rnd() - 0.5) * 22, 64 + (rnd() - 0.5) * 22, 12 + rnd() * 12);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 26 + rnd() * 30;
    blob(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + rnd() * 5);
  }
  // Lache: großer, unregelmäßiger Fleck
  for (let i = 0; i < 14; i++) blob(T + 64 + (rnd() - 0.5) * 50, 64 + (rnd() - 0.5) * 50, 18 + rnd() * 16);
  // Schmierspur
  for (let i = 0; i < 12; i++) blob(T * 2 + 30 + i * 6, 64 + Math.sin(i * 0.8) * 4, 10 - i * 0.6);
  for (let i = 0; i < 6; i++) blob(T * 2 + 100 + rnd() * 20, 64 + (rnd() - 0.5) * 20, 2 + rnd() * 3);
  // Einzelne Tropfen
  for (let i = 0; i < 7; i++) blob(T * 3 + 30 + rnd() * 68, 30 + rnd() * 68, 4 + rnd() * 7);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

export class Blood {
  readonly group = new THREE.Group();
  private readonly drops: Drop[] = [];
  private readonly dropMesh: THREE.InstancedMesh;
  private readonly decalMesh: THREE.InstancedMesh;
  private readonly decals: Decal[] = [];
  private readonly tile = new Float32Array(DECALS);
  private readonly fade = new Float32Array(DECALS);
  private readonly tileAttr: THREE.InstancedBufferAttribute;
  private readonly fadeAttr: THREE.InstancedBufferAttribute;
  private next = 0;
  private refresh = 0;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly yaw = new THREE.Quaternion();

  constructor(private readonly d: BloodDeps) {
    this.group.name = 'Blood';
    const dropMat = new THREE.MeshStandardMaterial({ color: 0x3a0406, roughness: 0.2, metalness: 0 });
    this.dropMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), dropMat, DROPS);
    this.dropMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dropMesh.frustumCulled = false;
    this.dropMesh.count = 0;
    this.dropMesh.castShadow = false;

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.tileAttr = new THREE.InstancedBufferAttribute(this.tile, 1);
    this.fadeAttr = new THREE.InstancedBufferAttribute(this.fade, 1);
    geo.setAttribute('aTile', this.tileAttr);
    geo.setAttribute('aFade', this.fadeAttr);
    // Nasses Blut: dunkelrot, glänzend; eingetrocknet fast schwarz und matt.
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2e0304,
      alphaMap: makeAtlas(),
      transparent: true,
      depthWrite: false,
      roughness: 0.18,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aTile;\nattribute float aFade;\nvarying float vFade;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_ALPHAMAP\nvAlphaMapUv.x = (vAlphaMapUv.x + aTile) * ${(1 / TILES).toFixed(4)};\n#endif\nvFade = aFade;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;')
        .replace(
          '#include <alphamap_fragment>',
          `#include <alphamap_fragment>
// vFade: 1 = frisch, 0..0.5 = eingetrocknet, Alpha schwindet am Ende.
float dry = 1.0 - smoothstep(0.55, 1.0, vFade);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.015, 0.012), dry);
diffuseColor.a *= smoothstep(0.0, 0.2, vFade) * 0.95;`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.75, 1.0 - smoothstep(0.55, 1.0, vFade));');
    };
    mat.customProgramCacheKey = () => 'blood-decal';
    this.decalMesh = new THREE.InstancedMesh(geo, mat, DECALS);
    this.decalMesh.frustumCulled = false;
    this.decalMesh.count = 0;
    this.decalMesh.receiveShadow = true;
    this.decalMesh.renderOrder = 1;
    for (let i = 0; i < DECALS; i++) {
      this.decals.push({ age: Infinity, grow: 1, size: 0, matrix: new THREE.Matrix4(), position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
    }
    this.group.add(this.dropMesh, this.decalMesh);
  }

  /**
   * Blut spritzt aus einer Wunde.
   * @param dir Richtung des Schlags (vom Angreifer weg) – die Tropfen fliegen vor allem dorthin.
   * @param amount 0..1 (Streifschuss … schwerer Treffer)
   */
  spray(point: THREE.Vector3, dir: THREE.Vector3, amount: number): void {
    const n = Math.round(8 + amount * 22);
    for (let i = 0; i < n; i++) {
      if (this.drops.length >= DROPS) this.drops.shift();
      const speed = 1.5 + Math.random() * (2.5 + amount * 3);
      const v = new THREE.Vector3(dir.x + (Math.random() - 0.5) * 1.2, dir.y + 0.15 + Math.random() * 0.6, dir.z + (Math.random() - 0.5) * 1.2)
        .normalize()
        .multiplyScalar(speed);
      this.drops.push({ position: point.clone(), velocity: v, size: 0.008 + Math.random() * 0.014, life: 3 });
    }
    // Direkt unter der Wunde tropft es zu Boden.
    const below = this.d.raycast(point, this.v.set(0, -1, 0), 3);
    if (below) this.addDecal(below.point, below.normal, 0.2 + amount * 0.35, 0, 1);
  }

  /** Lache unter einem Toten, die sich in einigen Sekunden ausbreitet. */
  pool(position: THREE.Vector3, size = 1.2): void {
    const hit = this.d.raycast(this.v.copy(position).setY(position.y + 0.8), new THREE.Vector3(0, -1, 0), 3);
    if (hit) this.addDecal(hit.point, hit.normal, size, 1, 0);
  }

  private addDecal(point: THREE.Vector3, normal: THREE.Vector3, size: number, tile: number, grow: number): void {
    if (point.y < this.d.waterLevel - 0.02) return;
    const i = this.next;
    this.next = (this.next + 1) % DECALS;
    const dcl = this.decals[i];
    dcl.age = 0;
    dcl.grow = grow;
    dcl.size = size;
    dcl.position.copy(point).addScaledVector(normal, 0.01);
    dcl.quaternion.setFromUnitVectors(this.up, normal).multiply(this.yaw.setFromAxisAngle(this.up, Math.random() * Math.PI * 2));
    this.tile[i] = tile;
    this.fade[i] = 1;
    this.tileAttr.needsUpdate = true;
    this.fadeAttr.needsUpdate = true;
    this.writeDecal(i);
    this.decalMesh.count = Math.max(this.decalMesh.count, i + 1);
  }

  private writeDecal(i: number): void {
    const dcl = this.decals[i];
    const k = 0.15 + 0.85 * dcl.grow;
    this.s.set(dcl.size * k, 1, dcl.size * k);
    this.m.compose(dcl.position, dcl.quaternion, this.s);
    this.decalMesh.setMatrixAt(i, this.m);
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    // Tropfen: Schwerkraft, Aufprall auf festen Oberflächen.
    let n = 0;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const p = this.drops[i];
      p.life -= dt;
      p.velocity.y -= 9.81 * dt;
      const step = p.velocity.length() * dt;
      this.v.copy(p.velocity).normalize();
      const hit = step > 0 ? this.d.raycast(p.position, this.v, step + 0.02) : null;
      if (hit || p.life <= 0 || p.position.y < this.d.waterLevel - 0.05) {
        if (hit) this.addDecal(hit.point, hit.normal, 0.06 + p.size * 9 + Math.random() * 0.08, Math.random() < 0.5 ? 0 : 3, 1);
        this.drops.splice(i, 1);
        continue;
      }
      p.position.addScaledVector(p.velocity, dt);
      // In Flugrichtung gestreckt.
      this.q.setFromUnitVectors(this.up, this.v);
      this.s.set(p.size, p.size * (1 + Math.min(3, step * 40)), p.size);
      this.m.compose(p.position, this.q, this.s);
      this.dropMesh.setMatrixAt(n++, this.m);
    }
    this.dropMesh.count = n;
    if (n > 0) this.dropMesh.instanceMatrix.needsUpdate = true;

    // Flecken altern; Lachen breiten sich aus.
    for (let i = 0; i < this.decalMesh.count; i++) {
      const dcl = this.decals[i];
      dcl.age += dt;
      if (dcl.grow < 1) {
        dcl.grow = Math.min(1, dcl.grow + dt / 4);
        this.writeDecal(i);
      }
    }
    this.refresh -= dt;
    if (this.refresh > 0) return;
    this.refresh = 0.5;
    for (let i = 0; i < this.decalMesh.count; i++) {
      const t = this.decals[i].age / DECAL_LIFE;
      // 1 → 0.55: trocknet ein (erste Minuten), danach bis 0 verblassen.
      this.fade[i] = t >= 1 ? 0 : t < 0.2 ? 1 - (t / 0.2) * 0.45 : 0.55 * (1 - (t - 0.2) / 0.8);
    }
    this.fadeAttr.needsUpdate = true;
  }

  clear(): void {
    this.drops.length = 0;
    for (const d of this.decals) d.age = Infinity;
    this.decalMesh.count = 0;
    this.dropMesh.count = 0;
    this.next = 0;
  }
}
