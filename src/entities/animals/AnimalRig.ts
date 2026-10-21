import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RigPart } from '../RigRenderer';
import { jitter } from '../../world/VegetationGeometry';
import { clamp, damp, smoothstep } from '../../utils/math';

export type Species = 'deer' | 'rabbit';
export type AnimalPart = 'body' | 'neck' | 'head' | 'upperLeg' | 'lowerLeg' | 'tail' | 'antlers';

/** Körpermaße einer Art (Meter). Ursprung des Rigs = Boden unter der Körpermitte, Blick +Z. */
interface Shape {
  bodyHeight: number;
  bodyLength: number;
  hipFront: THREE.Vector3;
  hipBack: THREE.Vector3;
  upperLeg: number;
  neckBase: THREE.Vector3;
  neckLength: number;
  tailBase: THREE.Vector3;
}

const SHAPES: Record<Species, Shape> = {
  deer: {
    bodyHeight: 0.98,
    bodyLength: 1.15,
    hipFront: new THREE.Vector3(0.13, -0.12, 0.42),
    hipBack: new THREE.Vector3(0.13, -0.1, -0.42),
    upperLeg: 0.4,
    neckBase: new THREE.Vector3(0, 0.12, 0.48),
    neckLength: 0.5,
    tailBase: new THREE.Vector3(0, 0.12, -0.6),
  },
  rabbit: {
    bodyHeight: 0.17,
    bodyLength: 0.3,
    hipFront: new THREE.Vector3(0.05, -0.04, 0.1),
    hipBack: new THREE.Vector3(0.06, -0.02, -0.1),
    upperLeg: 0.07,
    neckBase: new THREE.Vector3(0, 0.05, 0.13),
    neckLength: 0.05,
    tailBase: new THREE.Vector3(0, 0.04, -0.16),
  },
};

// ---------------------------------------------------------------------------
// Geometrien
// ---------------------------------------------------------------------------

const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts.map(flat), false)!;
  g.computeVertexNormals();
  return g;
}
/** Konisches Teil, das vom Gelenk aus nach unten hängt. */
function hanging(rTop: number, rBottom: number, length: number, segments = 5): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, length, segments, 1);
  g.translate(0, -length / 2, 0);
  return g;
}
/** Teil, das vom Gelenk aus nach vorne (+Z) ragt. */
function forward(g: THREE.BufferGeometry, length: number): THREE.BufferGeometry {
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, length / 2);
  return g;
}

function deerGeometry(): Record<AnimalPart, THREE.BufferGeometry> {
  const body = jitter(new THREE.IcosahedronGeometry(0.5, 1), 0.03, 81);
  body.scale(0.42, 0.5, 1.25);
  const chest = new THREE.IcosahedronGeometry(0.25, 1);
  chest.scale(0.85, 1.05, 1);
  chest.translate(0, -0.02, 0.32);
  const neck = forward(new THREE.CylinderGeometry(0.07, 0.11, 0.55, 6), 0.55);
  const skull = new THREE.CylinderGeometry(0.05, 0.085, 0.32, 6);
  const head = forward(skull, 0.32);
  head.translate(0, 0.02, 0);
  const earL = new THREE.ConeGeometry(0.035, 0.14, 4);
  earL.rotateZ(0.9);
  earL.translate(-0.08, 0.08, 0.04);
  const earR = new THREE.ConeGeometry(0.035, 0.14, 4);
  earR.rotateZ(-0.9);
  earR.translate(0.08, 0.08, 0.04);
  const hoof = new THREE.CylinderGeometry(0.035, 0.04, 0.06, 5);
  hoof.translate(0, -0.44, 0.01);
  const antlerParts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const beam = new THREE.CylinderGeometry(0.012, 0.022, 0.4, 4);
    beam.rotateZ(-side * 0.5);
    beam.rotateX(-0.3);
    beam.translate(side * 0.11, 0.24, 0.0);
    const tine = new THREE.CylinderGeometry(0.008, 0.014, 0.18, 4);
    tine.rotateZ(side * 0.2);
    tine.rotateX(0.5);
    tine.translate(side * 0.16, 0.3, 0.08);
    const tine2 = tine.clone();
    tine2.translate(side * 0.04, 0.1, -0.06);
    antlerParts.push(beam, tine, tine2);
  }
  return {
    body: merge([body, chest]),
    neck: merge([neck]),
    head: merge([head, earL, earR]),
    upperLeg: merge([hanging(0.06, 0.035, 0.4, 5)]),
    lowerLeg: merge([hanging(0.03, 0.022, 0.44, 5), hoof]),
    tail: merge([hanging(0.035, 0.02, 0.12, 4)]),
    antlers: merge(antlerParts),
  };
}

function rabbitGeometry(): Record<AnimalPart, THREE.BufferGeometry> {
  const body = jitter(new THREE.IcosahedronGeometry(0.12, 1), 0.008, 91);
  body.scale(0.85, 0.85, 1.35);
  const head = new THREE.IcosahedronGeometry(0.065, 1);
  head.scale(0.9, 0.9, 1.15);
  head.translate(0, 0.02, 0.05);
  const ears: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const ear = new THREE.CylinderGeometry(0.012, 0.02, 0.13, 4);
    ear.scale(1.6, 1, 0.6);
    ear.rotateX(-0.35);
    ear.rotateZ(-side * 0.12);
    ear.translate(side * 0.025, 0.11, 0.02);
    ears.push(ear);
  }
  const tail = new THREE.IcosahedronGeometry(0.032, 0);
  return {
    body: merge([body]),
    neck: merge([forward(new THREE.CylinderGeometry(0.04, 0.05, 0.06, 5), 0.06)]),
    head: merge([head, ...ears]),
    upperLeg: merge([hanging(0.025, 0.018, 0.07, 4)]),
    lowerLeg: merge([hanging(0.016, 0.014, 0.07, 4)]),
    tail: merge([tail]),
    antlers: merge([new THREE.BoxGeometry(0.001, 0.001, 0.001)]), // Hasen tragen kein Geweih
  };
}

export const ANIMAL_GEOMETRY: Record<Species, Record<AnimalPart, THREE.BufferGeometry>> = {
  deer: deerGeometry(),
  rabbit: rabbitGeometry(),
};

// ---------------------------------------------------------------------------
// Rig & Animation
// ---------------------------------------------------------------------------

export interface AnimalAnim {
  speed: number;
  /** 0 = Kopf oben, 1 = grast (Kopf am Boden). */
  graze: number;
  /** Aufmerksamkeit: Kopf hoch, Schwanz hoch. */
  alert: number;
  lookYaw: number;
  /** Fortschritt der Todesanimation oder < 0. */
  death: number;
}

/**
 * Prozedurales Vierbeiner-Skelett. Hirsche traben/galoppieren (diagonale Beinpaare),
 * Hasen hoppeln (Hinterbeine stoßen ab, Körper im Bogen).
 */
export class AnimalRig {
  readonly root = new THREE.Object3D();
  readonly parts: RigPart<AnimalPart>[] = [];
  readonly anim: AnimalAnim = { speed: 0, graze: 0, alert: 0, lookYaw: 0, death: -1 };
  readonly shape: Shape;

  private readonly body = new THREE.Object3D();
  private readonly neck = new THREE.Object3D();
  private readonly head = new THREE.Object3D();
  private readonly tail = new THREE.Object3D();
  /** Reihenfolge: vorne links, vorne rechts, hinten links, hinten rechts. */
  private readonly hips: THREE.Object3D[] = [];
  private readonly knees: THREE.Object3D[] = [];
  private phase = Math.random() * 10;
  private time = Math.random() * 10;
  steps = 0;
  private lastStep = 0;

  constructor(
    readonly species: Species,
    readonly scale: number,
    antlers: boolean,
  ) {
    const s = (this.shape = SHAPES[species]);
    this.root.add(this.body);
    this.body.position.y = s.bodyHeight;
    this.body.add(this.neck);
    this.neck.position.copy(s.neckBase);
    this.neck.add(this.head);
    this.head.position.set(0, 0, s.neckLength);
    this.body.add(this.tail);
    this.tail.position.copy(s.tailBase);
    this.root.scale.setScalar(scale);

    const hipPos = [
      new THREE.Vector3(-s.hipFront.x, s.hipFront.y, s.hipFront.z),
      new THREE.Vector3(s.hipFront.x, s.hipFront.y, s.hipFront.z),
      new THREE.Vector3(-s.hipBack.x, s.hipBack.y, s.hipBack.z),
      new THREE.Vector3(s.hipBack.x, s.hipBack.y, s.hipBack.z),
    ];
    hipPos.forEach((p, i) => {
      const hip = new THREE.Object3D();
      hip.position.copy(p);
      this.body.add(hip);
      const knee = new THREE.Object3D();
      knee.position.y = -s.upperLeg;
      hip.add(knee);
      // Hasen: kräftige, längere Hinterläufe.
      if (species === 'rabbit' && i >= 2) hip.scale.set(1.4, 1.5, 1.4);
      this.hips.push(hip);
      this.knees.push(knee);
      this.parts.push({ type: 'upperLeg', bone: hip }, { type: 'lowerLeg', bone: knee });
    });
    this.parts.push({ type: 'body', bone: this.body }, { type: 'neck', bone: this.neck }, { type: 'head', bone: this.head }, { type: 'tail', bone: this.tail });
    if (antlers) this.parts.push({ type: 'antlers', bone: this.head });
  }

  update(dt: number): void {
    const a = this.anim;
    const s = this.shape;
    this.time += dt;
    const moving = smoothstep(0.05, 0.5, a.speed);
    const fast = clamp(a.speed / (this.species === 'deer' ? 8 : 6), 0, 1);

    // Schrittzähler (für Hufgeräusche)
    const stepIndex = Math.floor(this.phase / Math.PI);
    if (stepIndex !== this.lastStep) {
      this.lastStep = stepIndex;
      if (a.speed > 0.6 && a.death < 0) this.steps++;
    }

    if (this.species === 'deer') {
      this.phase += dt * (a.speed * 1.5 + moving * 1.2);
      const amp = (0.3 + 0.45 * fast) * moving;
      // Trab: diagonale Beinpaare gleichphasig; beim Galopp größerer Ausschlag.
      const phases = [0, Math.PI, Math.PI, 0];
      this.hips.forEach((hip, i) => {
        const p = this.phase + phases[i] + (i >= 2 ? fast * 0.6 : 0);
        hip.rotation.x = -Math.sin(p) * amp;
        const bend = Math.max(0, Math.sin(p + 0.9)) * (0.4 + 0.7 * fast) * moving;
        this.knees[i].rotation.x = i < 2 ? bend : -bend; // Vorderknie nach hinten, Sprunggelenk nach vorne
      });
      this.body.position.y = s.bodyHeight + Math.abs(Math.sin(this.phase)) * 0.05 * moving - 0.03 * fast;
      this.body.rotation.x = Math.sin(this.phase * 2) * 0.05 * fast;
    } else {
      // Hoppeln: alle Beine paarweise, Körper springt im Bogen.
      this.phase += dt * (a.speed * 3.2 + moving * 2);
      const hop = Math.max(0, Math.sin(this.phase)) * moving;
      this.body.position.y = s.bodyHeight + hop * (0.08 + 0.1 * fast);
      this.body.rotation.x = -Math.cos(this.phase) * 0.25 * moving;
      this.hips.forEach((hip, i) => {
        hip.rotation.x = i < 2 ? -0.5 * hop : 0.9 * hop - 0.2 * moving;
        this.knees[i].rotation.x = i < 2 ? 0.3 * hop : -0.6 * hop;
      });
    }

    // Hals & Kopf: aufrecht, beim Grasen gesenkt, aufmerksam besonders hoch.
    const up = this.species === 'deer' ? -0.95 : -0.2;
    const neckX = up + a.graze * (this.species === 'deer' ? 1.85 : 0.5) - a.alert * 0.25 - fast * 0.4 * (this.species === 'deer' ? 1 : 0);
    this.neck.rotation.set(neckX, a.lookYaw * 0.6, 0);
    this.head.rotation.set(-neckX * 0.65 + 0.25 + Math.sin(this.time * 1.3) * 0.03 * (1 - moving), a.lookYaw * 0.4, 0);
    // Schwanz: bei Gefahr hoch (weißer "Spiegel" warnt die Herde)
    this.tail.rotation.x = -0.3 - a.alert * 1.6 + Math.sin(this.time * 6) * 0.05;

    if (a.death >= 0) {
      const t = 1 - (1 - Math.min(1, a.death)) ** 3;
      this.body.rotation.z = t * Math.PI * 0.5;
      this.body.position.y = s.bodyHeight + (0.22 * (this.species === 'deer' ? 1 : 0.4) - s.bodyHeight) * t;
      this.neck.rotation.x = up + t * 0.9;
      this.hips.forEach((hip) => (hip.rotation.x = 0.2 * t));
    } else {
      this.body.rotation.z = 0;
    }

    this.root.updateMatrixWorld(true);
  }

  /** Dämpft Animationswerte (vom Tier pro Frame aufgerufen). */
  blend(target: Partial<AnimalAnim>, dt: number): void {
    if (target.graze !== undefined) this.anim.graze = damp(this.anim.graze, target.graze, 3, dt);
    if (target.alert !== undefined) this.anim.alert = damp(this.anim.alert, target.alert, 6, dt);
    if (target.lookYaw !== undefined) this.anim.lookYaw = damp(this.anim.lookYaw, target.lookYaw, 5, dt);
  }
}
