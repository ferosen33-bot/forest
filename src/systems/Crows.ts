import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import { deriveSeed, mulberry32 } from '../utils/random';
import type { Audio } from './Audio';

export interface CrowDeps {
  /** Sitzplätze: Zaunpfähle, Masten, Vogelscheuchen, Totems, Dachfirste. */
  perches: THREE.Vector3[];
  audio: Audio;
  events: EventBus;
  seed: number;
}

interface Crow {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  flying: boolean;
  /** Flügelschlag-Phase */
  phase: number;
  /** Zeit bis zum nächsten Hüpfer bzw. Lebensdauer im Flug. */
  timer: number;
  perch: number;
}

const MAX = 18;
/** So nah lassen sie einen kommen (m); Lärm im Umkreis scheucht sie ebenfalls auf. */
const SHY = 12;

/**
 * Krähen: kleine Schwärme auf Sitzplätzen in der Nähe (nur bei Tageslicht), die krächzen, herumhüpfen
 * und mit Geflatter auffliegen, wenn man ihnen zu nahe kommt oder ein Schuss fällt. Drei Instanz-Meshes
 * (Körper, linker und rechter Flügel) – ein paar Draw Calls für alle Vögel.
 */
export class Crows {
  readonly group = new THREE.Group();
  private readonly crows: Crow[] = [];
  private readonly body: THREE.InstancedMesh;
  private readonly wingL: THREE.InstancedMesh;
  private readonly wingR: THREE.InstancedMesh;
  private readonly rng: () => number;
  /** Sitzplatz → Sperrzeit nach dem Auffliegen (s). */
  private readonly cooldown = new Map<number, number>();
  private spawnTimer = 2;
  private cawTimer = 3;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  /** Etwas größer als echt, damit man sie auf Zäunen und Masten auch sieht. */
  private readonly one = new THREE.Vector3(1.35, 1.35, 1.35);
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly d: CrowDeps) {
    this.group.name = 'Crows';
    this.rng = mulberry32(deriveSeed(d.seed, 'crows'));
    const mat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7 });
    const bodyGeo = new THREE.ConeGeometry(0.07, 0.36, 6);
    bodyGeo.rotateX(Math.PI / 2);
    const head = new THREE.SphereGeometry(0.06, 6, 5);
    head.translate(0, 0.05, 0.17);
    const beak = new THREE.ConeGeometry(0.02, 0.08, 4);
    beak.rotateX(Math.PI / 2);
    beak.translate(0, 0.045, 0.25);
    const merged = mergeSimple([bodyGeo, head, beak]);
    this.body = new THREE.InstancedMesh(merged, mat, MAX);
    // Flügel: flaches Dreieck, Drehpunkt an der Schulter (x = 0).
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.08, 0.32, 0, -0.04, 0, 0, -0.12], 3));
    wing.computeVertexNormals();
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.8, side: THREE.DoubleSide });
    this.wingL = new THREE.InstancedMesh(wing, wingMat, MAX);
    const wingR = wing.clone();
    wingR.scale(-1, 1, 1);
    this.wingR = new THREE.InstancedMesh(wingR, wingMat, MAX);
    for (const mesh of [this.body, this.wingL, this.wingR]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.group.add(mesh);
    }
    d.events.on('noise', ({ position, radius }) => {
      for (const c of this.crows) if (!c.flying && c.position.distanceTo(position) < Math.min(60, radius * 1.2)) this.scare(c, position);
    });
  }

  get perchCount(): number {
    return this.d.perches.length;
  }

  get count(): number {
    return this.crows.length;
  }

  get sitting(): number {
    return this.crows.filter((c) => !c.flying).length;
  }

  update(dt: number, listener: THREE.Vector3, daylight: number, hidden: boolean): void {
    if (hidden) {
      this.crows.length = 0;
      this.render();
      return;
    }
    for (const [k, v] of this.cooldown) {
      if (v <= dt) this.cooldown.delete(k);
      else this.cooldown.set(k, v - dt);
    }
    // Neue Schwärme bei Tag in mittlerer Entfernung (nie direkt vor der Nase).
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && daylight > 0.25) {
      this.spawnTimer = 4 + this.rng() * 4;
      if (this.crows.length < MAX - 5) this.spawnFlock(listener);
    }
    let sittingNear = 0;
    for (let i = this.crows.length - 1; i >= 0; i--) {
      const c = this.crows[i];
      const dist = c.position.distanceTo(listener);
      if (!c.flying) {
        if (dist < SHY) this.scare(c, listener);
        else if (dist > 130 || daylight < 0.12) {
          this.crows.splice(i, 1);
          continue;
        }
        sittingNear += dist < 60 ? 1 : 0;
        // Hüpfen, umdrehen, picken
        c.timer -= dt;
        if (c.timer <= 0) {
          c.timer = 0.8 + this.rng() * 3;
          c.yaw += (this.rng() - 0.5) * 2.2;
        }
        c.phase = 0;
      } else {
        c.timer -= dt;
        c.phase += dt * 22;
        c.velocity.y += (c.velocity.y < 5 ? 3 : -1) * dt;
        c.position.addScaledVector(c.velocity, dt);
        c.yaw = Math.atan2(c.velocity.x, c.velocity.z);
        if (c.timer <= 0) {
          this.crows.splice(i, 1);
          continue;
        }
      }
    }
    // Ab und zu krächzt einer der sitzenden.
    this.cawTimer -= dt;
    if (this.cawTimer <= 0) {
      this.cawTimer = 3 + this.rng() * 7;
      const sitting = this.crows.filter((c) => !c.flying && c.position.distanceTo(listener) < 60);
      if (sitting.length && sittingNear) this.d.audio.play('crow', { position: sitting[Math.floor(this.rng() * sitting.length)].position, volume: 0.7 });
    }
    this.render();
  }

  private spawnFlock(listener: THREE.Vector3): void {
    const candidates: number[] = [];
    this.d.perches.forEach((p, i) => {
      if (this.cooldown.has(i) || this.crows.some((c) => c.perch === i)) return;
      const d = p.distanceTo(listener);
      if (d > 28 && d < 85) candidates.push(i);
    });
    if (!candidates.length) return;
    const i = candidates[Math.floor(this.rng() * candidates.length)];
    const p = this.d.perches[i];
    const n = 1 + Math.floor(this.rng() * 4);
    // Dicht nebeneinander auf dem Sitzplatz (Zaunlatte, Querholz, First).
    for (let k = 0; k < n && this.crows.length < MAX; k++) {
      const pos = p.clone();
      if (k > 0) {
        pos.x += (this.rng() - 0.5) * 0.9;
        pos.z += (this.rng() - 0.5) * 0.9;
      }
      this.crows.push({ position: pos, velocity: new THREE.Vector3(), yaw: this.rng() * Math.PI * 2, flying: false, phase: 0, timer: this.rng() * 2, perch: i });
    }
  }

  private scare(c: Crow, from: THREE.Vector3): void {
    // Alle vom selben Sitzplatz fliegen mit auf.
    for (const o of this.crows) {
      if (o.flying || o.perch !== c.perch) continue;
      o.flying = true;
      o.timer = 6 + this.rng() * 3;
      const away = this.tmp.subVectors(o.position, from).setY(0);
      if (away.lengthSq() < 0.01) away.set(1, 0, 0);
      away.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (this.rng() - 0.5) * 1.2);
      o.velocity.set(away.x * 7, 3 + this.rng() * 2, away.z * 7);
      o.phase = this.rng() * 6;
    }
    this.cooldown.set(c.perch, 60);
    this.d.audio.play('flap', { position: c.position, volume: 0.8 });
    this.d.audio.play('crow', { position: c.position, volume: 0.9 });
  }

  private render(): void {
    const n = this.crows.length;
    this.body.count = this.wingL.count = this.wingR.count = n;
    for (let i = 0; i < n; i++) {
      const c = this.crows[i];
      this.q.setFromEuler(this.e.set(c.flying ? -0.15 : 0.2, c.yaw, 0));
      this.m.compose(c.position, this.q, this.one);
      this.body.setMatrixAt(i, this.m);
      // Flügel: im Flug schlagend, im Sitzen angelegt.
      const flap = c.flying ? Math.sin(c.phase) * 0.9 : 1.35;
      for (const [mesh, side] of [[this.wingL, 1], [this.wingR, -1]] as [THREE.InstancedMesh, number][]) {
        this.q.setFromEuler(this.e.set(c.flying ? -0.15 : 0.2, c.yaw, side * (c.flying ? flap : -flap), 'YXZ'));
        this.m.compose(this.tmp.copy(c.position).setY(c.position.y + 0.04), this.q, this.one);
        mesh.setMatrixAt(i, this.m);
      }
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.wingL.instanceMatrix.needsUpdate = true;
    this.wingR.instanceMatrix.needsUpdate = true;
  }
}

/** Kleine Geometrien zusammenführen (nur Positionen und Normalen). */
function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    g.computeVertexNormals();
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
