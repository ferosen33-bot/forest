import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CollisionGroup, interactionGroups, RAPIER, type Physics } from '../core/Physics';
import type { HeightMap } from './HeightMap';
import type { BiomeWeights } from './Biomes';
import { injectSeason } from './SeasonShader';
import { texturize } from './SurfaceTextures';
import { deriveSeed, mulberry32 } from '../utils/random';
import { smoothstep } from '../utils/math';

/**
 * Ausstattung der Gebiete, die der normale Wald nicht hat:
 * - **Sumpf:** abgestorbene, kahle Bäume (teils schief, teils abgebrochen), umgestürzte Stämme im Wasser
 *   und dichtes Schilf an den Tümpeln.
 * - **Ufer überall:** Schilf an flachen Seeufern.
 *
 * Alles als instanzierte Meshes in Zellen (für Sichtbarkeit nach Entfernung); Stämme haben Kollision.
 */

const CELL = 128;
/** Sichtweite des Schilfs (m) – weiter weg ist es ohnehin nur ein Flimmern. */
const REED_RANGE = 140;

interface DecorCell {
  cx: number;
  cz: number;
  reeds: THREE.InstancedMesh | null;
}

/** Kahler Baum: Stamm mit ein paar steil aufragenden, abgebrochenen Ästen (Höhe 1, Fuß bei 0). */
function snagGeometry(rng: () => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.035, 0.07, 1, 7, 4);
  trunk.translate(0, 0.5, 0);
  // Leicht verdrehter, knorriger Stamm.
  const pos = trunk.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, pos.getX(i) + Math.sin(y * 7) * 0.012);
    pos.setZ(i, pos.getZ(i) + Math.cos(y * 5) * 0.012);
  }
  parts.push(trunk);
  const branches = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < branches; i++) {
    const len = 0.18 + rng() * 0.25;
    const b = new THREE.CylinderGeometry(0.008, 0.022, len, 5);
    b.translate(0, len / 2, 0);
    b.rotateZ(0.5 + rng() * 0.6);
    b.rotateY(rng() * Math.PI * 2);
    b.translate(0, 0.45 + rng() * 0.45, 0);
    parts.push(b);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  g.computeVertexNormals();
  return g;
}

/** Schilfbüschel: drei gekreuzte Flächen mit gemalten Halmen und Rohrkolben. */
function reedGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const p = new THREE.PlaneGeometry(1, 1);
    p.translate(0, 0.5, 0);
    p.rotateY((i / 3) * Math.PI);
    parts.push(p);
  }
  return mergeGeometries(parts);
}

function reedTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const W = 128;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 22; i++) {
    const x = 8 + rnd() * (W - 16);
    const top = H * (0.02 + rnd() * 0.35);
    const lean = (rnd() - 0.5) * 30;
    const w = 2 + rnd() * 3;
    const grad = g.createLinearGradient(0, H, 0, top);
    grad.addColorStop(0, '#3e4a25');
    grad.addColorStop(0.6, '#6f7a3a');
    grad.addColorStop(1, '#a39a5c');
    g.strokeStyle = grad;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, H);
    g.quadraticCurveTo(x + lean * 0.3, (H + top) / 2, x + lean, top);
    g.stroke();
    // Rohrkolben
    if (rnd() < 0.3) {
      g.fillStyle = '#4a3220';
      g.beginPath();
      g.ellipse(x + lean * 0.95, top + 16, 3.5, 13, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class BiomeDecor {
  readonly group = new THREE.Group();
  private readonly cells: DecorCell[] = [];
  private readonly reedUniforms = { uTime: { value: 0 } };
  private readonly colliders: RAPIER.Collider[] = [];
  /** Wie viele Stämme und Schilfbüschel es gibt (für die Debug-Anzeige). */
  readonly counts = { snags: 0, logs: 0, reeds: 0 };

  constructor(
    heightMap: HeightMap,
    physics: Physics,
    seed: number,
    /** Freie Flächen (Spawn, Stadt, Hafen …). */
    clearings: { x: number; z: number; radius: number }[] = [],
    /** Weitere freie Flächen als Abfrage (Wege). */
    exclude?: (x: number, z: number) => boolean,
  ) {
    this.group.name = 'BiomeDecor';
    const hm = heightMap;
    if (!hm.biomes.enabled) return;
    const rng = mulberry32(deriveSeed(seed, 'biome-decor'));
    const b: BiomeWeights = { highland: 0, swamp: 0, cliffs: 0 };
    const n: [number, number, number] = [0, 1, 0];
    const water = hm.waterLevel;
    const free = (x: number, z: number) => !clearings.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.radius * c.radius) && !exclude?.(x, z);

    // --- Tote Bäume und Stämme im Sumpf -------------------------------------------------------
    const snagVariants = [0, 1, 2].map(() => snagGeometry(rng));
    const barkMat = texturize(new THREE.MeshStandardMaterial({ color: 0x5a5249, roughness: 1 }), 'bark', 0.4);
    const snags: THREE.Matrix4[][] = snagVariants.map(() => []);
    const logs: THREE.Matrix4[] = [];
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let gz = -hm.half; gz < hm.half; gz += 9) {
      for (let gx = -hm.half; gx < hm.half; gx += 9) {
        const x = gx + rng() * 9;
        const z = gz + rng() * 9;
        hm.biomes.weights(x, z, b);
        if (b.swamp < 0.35 || !free(x, z)) continue;
        const h = hm.heightAt(x, z);
        if (h < water - 0.55 || h > 3) continue;
        const r = rng();
        if (r < 0.22 * b.swamp) {
          // Stehender toter Baum, manche schief, manche oben abgebrochen.
          const height = 5 + rng() * 7;
          const broken = rng() < 0.3 ? 0.35 + rng() * 0.3 : 1;
          const s = height * broken;
          e.set((rng() - 0.5) * 0.25, rng() * Math.PI * 2, (rng() - 0.5) * 0.25);
          q.setFromEuler(e);
          p.set(x, h - 0.3, z);
          sc.set(height * 0.6, s, height * 0.6);
          snags[Math.floor(rng() * snags.length)].push(new THREE.Matrix4().compose(p, q, sc));
          const radius = height * 0.6 * 0.06;
          this.colliders.push(
            physics.world.createCollider(
              RAPIER.ColliderDesc.cylinder(s / 2, Math.max(0.15, radius))
                .setTranslation(x, h - 0.3 + s / 2, z)
                .setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
              body,
            ),
          );
        } else if (r < 0.3 * b.swamp) {
          // Umgestürzter Stamm, halb im Wasser.
          const len = 5 + rng() * 6;
          const yaw = rng() * Math.PI * 2;
          const radius = 0.22 + rng() * 0.15;
          hm.normalAt(x, z, n);
          q.setFromEuler(e.set(0, yaw, Math.PI / 2 + (rng() - 0.5) * 0.15));
          p.set(x, h + radius * 0.4, z);
          sc.set(radius / 0.07, len, radius / 0.07);
          logs.push(new THREE.Matrix4().compose(p, q, sc));
          this.colliders.push(
            physics.world.createCollider(
              RAPIER.ColliderDesc.capsule(len / 2 - radius, radius)
                .setTranslation(p.x, p.y, p.z)
                .setRotation(q)
                .setCollisionGroups(interactionGroups(CollisionGroup.STATIC)),
              body,
            ),
          );
        }
      }
    }
    snags.forEach((list, i) => {
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(snagVariants[i], barkMat, list.length);
      list.forEach((m, k) => mesh.setMatrixAt(k, m));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.counts.snags += list.length;
    });
    if (logs.length > 0) {
      const logGeo = new THREE.CylinderGeometry(0.06, 0.07, 1, 8);
      const mesh = new THREE.InstancedMesh(logGeo, barkMat, logs.length);
      logs.forEach((m, k) => mesh.setMatrixAt(k, m));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.counts.logs = logs.length;
    }

    // --- Schilf an Tümpeln und flachen Ufern --------------------------------------------------
    const reedGeo = reedGeometry();
    const reedMat = new THREE.MeshStandardMaterial({
      map: reedTexture(),
      alphaTest: 0.45,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    reedMat.onBeforeCompile = (shader) => {
      injectSeason(shader, { foliage: false });
      shader.uniforms.uTime = this.reedUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
// Wind: die Spitzen wiegen sich, der Fuß bleibt stehen.
float reedPhase = dot(instanceMatrix[3].xz, vec2(0.37, 0.21));
transformed.x += sin(uTime * 1.6 + reedPhase) * 0.12 * uv.y * uv.y;
transformed.z += cos(uTime * 1.3 + reedPhase * 1.3) * 0.08 * uv.y * uv.y;`,
        );
    };
    reedMat.customProgramCacheKey = () => 'reeds';
    const perCell = new Map<number, THREE.Matrix4[]>();
    const side = Math.ceil(hm.size / CELL);
    for (let gz = -hm.half; gz < hm.half; gz += 2.2) {
      for (let gx = -hm.half; gx < hm.half; gx += 2.2) {
        const x = gx + rng() * 2.2;
        const z = gz + rng() * 2.2;
        const h = hm.heightAt(x, z);
        // Nur am Wasserrand: knapp darunter bis knapp darüber.
        if (h < water - 0.45 || h > water + 0.5) continue;
        hm.biomes.weights(x, z, b);
        const shore = 1 - smoothstep(0.1, 0.5, Math.abs(h - water + 0.05));
        if (rng() > (0.12 + 0.7 * b.swamp) * shore || !free(x, z)) continue;
        if (b.highland > 0.6) continue;
        const s = 1.2 + rng() * 1.1;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI);
        p.set(x, h - 0.05, z);
        sc.set(s * (0.8 + rng() * 0.5), s, s * (0.8 + rng() * 0.5));
        const key = Math.floor((z + hm.half) / CELL) * side + Math.floor((x + hm.half) / CELL);
        let list = perCell.get(key);
        if (!list) perCell.set(key, (list = []));
        list.push(new THREE.Matrix4().compose(p, q, sc));
      }
    }
    for (const [key, list] of perCell) {
      const mesh = new THREE.InstancedMesh(reedGeo, reedMat, list.length);
      list.forEach((m, k) => mesh.setMatrixAt(k, m));
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.cells.push({ cx: ((key % side) + 0.5) * CELL - hm.half, cz: (Math.floor(key / side) + 0.5) * CELL - hm.half, reeds: mesh });
      this.counts.reeds += list.length;
    }
  }

  /** Schilf nur in der Nähe zeigen, Wind animieren. */
  update(elapsed: number, focus: THREE.Vector3): void {
    this.reedUniforms.uTime.value = elapsed;
    const r = REED_RANGE + CELL * 0.71;
    for (const c of this.cells) {
      if (c.reeds) c.reeds.visible = Math.hypot(c.cx - focus.x, c.cz - focus.z) < r;
    }
  }
}
