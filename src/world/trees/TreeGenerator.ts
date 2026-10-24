/**
 * Prozeduraler Baumgenerator – TypeScript-Fassung des Kerns von EZ-Tree
 * (https://github.com/dgreenheck/ez-tree, MIT-Lizenz, © 2024 Daniel Greenheck; siehe LICENSE-EZ-TREE).
 *
 * Übernommen sind Astwachstum (Abschnitte, Knorrigkeit, Wuchskraft, Kinderäste) und Blatt-Karten.
 * Weggelassen sind Materialien, Texturen, Wind-Shader und Spalier – die stellt das Spiel selbst.
 * Ergebnis sind zwei Geometrien: Äste (mit UVs für die Rinde) und Blätter (Karten mit UVs).
 */
import * as THREE from 'three';

export interface TreeParams {
  seed: number;
  type: 'deciduous' | 'evergreen';
  branch: {
    /** Rekursionstiefe (0 = nur Stamm). */
    levels: number;
    /** Winkel der Kinderäste zum Elternast (Grad), je Ebene. */
    angle: number[];
    /** Anzahl Kinderäste je Ebene. */
    children: number[];
    force: { direction: { x: number; y: number; z: number }; strength: number };
    gnarliness: number[];
    length: number[];
    radius: number[];
    sections: number[];
    segments: number[];
    /** Ab welchem Anteil des Elternasts Kinder wachsen. */
    start: number[];
    taper: number[];
    twist: number[];
  };
  leaves: {
    billboard: 'single' | 'double';
    angle: number;
    count: number;
    start: number;
    size: number;
    sizeVariance: number;
  };
}

/** Pseudo-Zufall wie im Original (Multiply-with-carry), damit Seeds dieselben Bäume ergeben. */
class Rng {
  private w: number;
  private z: number;
  constructor(seed: number) {
    this.w = (123456789 + seed) & 0xffffffff;
    this.z = (987654321 - seed) & 0xffffffff;
  }
  random(max = 1, min = 0): number {
    this.z = (36969 * (this.z & 65535) + (this.z >> 16)) & 0xffffffff;
    this.w = (18000 * (this.w & 65535) + (this.w >> 16)) & 0xffffffff;
    const r = (((this.z << 16) + (this.w & 65535)) >>> 0) / 4294967296;
    return (max - min) * r + min;
  }
}

interface Branch {
  origin: THREE.Vector3;
  orientation: THREE.Euler;
  length: number;
  radius: number;
  level: number;
  sectionCount: number;
  segmentCount: number;
}

interface Section {
  origin: THREE.Vector3;
  orientation: THREE.Euler;
  radius: number;
}

export interface TreeGeometry {
  branches: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
}

const UP = new THREE.Vector3(0, 1, 0);

export function generateTree(p: TreeParams): TreeGeometry {
  const rng = new Rng(p.seed);
  const b = { verts: [] as number[], normals: [] as number[], uvs: [] as number[], indices: [] as number[] };
  const l = { verts: [] as number[], uvs: [] as number[], indices: [] as number[] };
  const queue: Branch[] = [
    {
      origin: new THREE.Vector3(),
      orientation: new THREE.Euler(),
      length: p.branch.length[0],
      radius: p.branch.radius[0],
      level: 0,
      sectionCount: p.branch.sections[0],
      segmentCount: p.branch.segments[0],
    },
  ];
  const levels = p.branch.levels;
  const forceDir = new THREE.Vector3(p.branch.force.direction.x, p.branch.force.direction.y, p.branch.force.direction.z);

  const leaf = (origin: THREE.Vector3, orientation: THREE.Euler) => {
    const size = p.leaves.size * (1 + rng.random(p.leaves.sizeVariance, -p.leaves.sizeVariance));
    const quad = (rotation: number) => {
      let i = l.verts.length / 3;
      const rot = new THREE.Euler(0, rotation, 0);
      for (const [x, y] of [
        [-size / 2, size],
        [-size / 2, 0],
        [size / 2, 0],
        [size / 2, size],
      ]) {
        const v = new THREE.Vector3(x, y, 0).applyEuler(rot).applyEuler(orientation).add(origin);
        l.verts.push(v.x, v.y, v.z);
      }
      l.uvs.push(0, 1, 0, 0, 1, 0, 1, 1);
      l.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
      i += 4;
    };
    quad(0);
    if (p.leaves.billboard === 'double') quad(Math.PI / 2);
  };

  /** Punkt, Ausrichtung und Radius an Position t (0..1) entlang der Abschnitte. */
  const along = (sections: Section[], t: number) => {
    const idx = Math.floor(t * (sections.length - 1));
    const a = sections[idx];
    const c = idx === sections.length - 1 ? a : sections[idx + 1];
    const alpha = (t - idx / (sections.length - 1)) / (1 / (sections.length - 1));
    const origin = new THREE.Vector3().lerpVectors(a.origin, c.origin, alpha);
    const qa = new THREE.Quaternion().setFromEuler(a.orientation);
    const qb = new THREE.Quaternion().setFromEuler(c.orientation);
    const orientation = new THREE.Euler().setFromQuaternion(qb.slerp(qa, alpha));
    return { origin, orientation, radius: (1 - alpha) * a.radius + alpha * c.radius };
  };

  const childOrientation = (parent: THREE.Euler, angleDeg: number, radial: number) => {
    const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angleDeg / (180 / Math.PI));
    const q2 = new THREE.Quaternion().setFromAxisAngle(UP, radial);
    const q3 = new THREE.Quaternion().setFromEuler(parent);
    return new THREE.Euler().setFromQuaternion(q3.multiply(q2.multiply(q1)));
  };

  while (queue.length > 0) {
    const br = queue.shift()!;
    const indexOffset = b.verts.length / 3;
    const orientation = br.orientation.clone();
    const origin = br.origin.clone();
    const sectionLength = br.length / br.sectionCount / (p.type === 'deciduous' ? levels - 1 : 1);
    const sections: Section[] = [];

    for (let i = 0; i <= br.sectionCount; i++) {
      let r = br.radius;
      if (i === br.sectionCount && br.level === levels) r = 0.001;
      else if (p.type === 'deciduous') r *= 1 - p.branch.taper[br.level] * (i / br.sectionCount);
      else r *= 1 - i / br.sectionCount;

      let first: { v: THREE.Vector3; n: THREE.Vector3; vy: number } | null = null;
      for (let j = 0; j < br.segmentCount; j++) {
        const angle = (2 * Math.PI * j) / br.segmentCount;
        const n = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).applyEuler(orientation).normalize();
        const v = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(r).applyEuler(orientation).add(origin);
        const vy = i % 2 === 0 ? 0 : 1;
        b.verts.push(v.x, v.y, v.z);
        b.normals.push(n.x, n.y, n.z);
        b.uvs.push(j / br.segmentCount, vy);
        if (j === 0) first = { v, n, vy };
      }
      // Erster Punkt doppelt, damit die Rinden-UVs nahtlos umlaufen.
      b.verts.push(first!.v.x, first!.v.y, first!.v.z);
      b.normals.push(first!.n.x, first!.n.y, first!.n.z);
      b.uvs.push(1, first!.vy);

      sections.push({ origin: origin.clone(), orientation: orientation.clone(), radius: r });
      origin.add(new THREE.Vector3(0, sectionLength, 0).applyEuler(orientation));

      const g = Math.max(1, 1 / Math.sqrt(r)) * p.branch.gnarliness[br.level];
      orientation.x += rng.random(g, -g);
      orientation.z += rng.random(g, -g);
      const qSection = new THREE.Quaternion().setFromEuler(orientation);
      const qTwist = new THREE.Quaternion().setFromAxisAngle(UP, p.branch.twist[br.level]);
      const qForce = new THREE.Quaternion().setFromUnitVectors(UP, forceDir.clone().normalize());
      qSection.multiply(qTwist);
      qSection.rotateTowards(qForce, p.branch.force.strength / r);
      orientation.setFromQuaternion(qSection);
    }

    // Mantel aus Vierecken (ohne Deckel)
    const N = br.segmentCount + 1;
    for (let i = 0; i < br.sectionCount; i++) {
      for (let j = 0; j < br.segmentCount; j++) {
        const v1 = indexOffset + i * N + j;
        const v2 = indexOffset + i * N + (j + 1);
        b.indices.push(v1, v1 + N, v2, v2, v1 + N, v2 + N);
      }
    }

    // Laubbäume: der Ast wächst am Ende weiter (bzw. trägt dort ein Blatt).
    if (p.type === 'deciduous') {
      const last = sections[sections.length - 1];
      if (br.level < levels) {
        queue.push({
          origin: last.origin,
          orientation: last.orientation,
          length: p.branch.length[br.level + 1],
          radius: last.radius,
          level: br.level + 1,
          sectionCount: br.sectionCount,
          segmentCount: br.segmentCount,
        });
      } else {
        leaf(last.origin, last.orientation);
      }
    }

    if (br.level === levels) {
      const radialOffset = rng.random();
      for (let i = 0; i < p.leaves.count; i++) {
        const at = along(sections, rng.random(1, p.leaves.start));
        leaf(at.origin, childOrientation(at.orientation, p.leaves.angle, 2 * Math.PI * (radialOffset + i / p.leaves.count)));
      }
    } else if (br.level < levels) {
      const level = br.level + 1;
      const count = p.branch.children[br.level];
      const radialOffset = rng.random();
      for (let i = 0; i < count; i++) {
        const start = rng.random(1, p.branch.start[level]);
        const at = along(sections, start);
        queue.push({
          origin: at.origin,
          orientation: childOrientation(at.orientation, p.branch.angle[level], 2 * Math.PI * (radialOffset + i / count)),
          length: p.branch.length[level] * (p.type === 'evergreen' ? 1 - start : 1),
          radius: p.branch.radius[level] * at.radius,
          level,
          sectionCount: p.branch.sections[level],
          segmentCount: p.branch.segments[level],
        });
      }
    }
  }

  const branches = new THREE.BufferGeometry();
  branches.setAttribute('position', new THREE.Float32BufferAttribute(b.verts, 3));
  branches.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
  branches.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
  branches.setIndex(b.indices);

  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(l.verts, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(l.uvs, 2));
  leaves.setIndex(l.indices);
  leaves.computeVertexNormals();
  return { branches, leaves };
}
