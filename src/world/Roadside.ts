import * as THREE from 'three';
import { deriveSeed, mulberry32, randRange } from '../utils/random';
import type { HeightMap } from './HeightMap';
import type { RoadNetwork } from './Roads';
import { townWorld, type TownLayout, type TownProp } from './Town';

/**
 * Was an den Wegen steht – als „Ort“ ohne Häuser (gleicher Baukasten, gleiche Beute-Kofferräume):
 * Strommasten mit durchhängenden Leitungen (manche schief, manche abgerissen), Leitpfosten an den
 * Landstraßen, liegengebliebene Autos (im Graben, quer, mit offener Tür), Wegweiser an den Kreuzungen
 * und die gelben Ortsschilder von Altwasser.
 */

const PAINT = [0x6b2a24, 0x2d4a5e, 0x5d6062, 0x8a7a54, 0x2f4a33, 0x9a9890, 0x3a3a3a];
/** Wege zu diesen Zielen bleiben ohne Strom. */
const NO_POWER = new Set(['crash', 'spawn', 'lab']);

/**
 * @param keepOut Orte, in denen nichts davon stehen soll (Masten, Autos …) – dort gibt es eigene Ausstattung.
 */
export function roadsideLayout(
  net: RoadNetwork,
  hm: HeightMap,
  seed: number,
  town: TownLayout | null,
  keepOut: { x: number; z: number; radius: number }[] = [],
): TownLayout {
  const rng = mulberry32(deriveSeed(seed, 'roadside'));
  const props: TownProp[] = [];
  const free = (x: number, z: number) => !keepOut.some((k) => (x - k.x) ** 2 + (z - k.z) ** 2 < k.radius * k.radius);
  const at = (kind: TownProp['kind'], x: number, z: number, rotation: number, extra: Partial<TownProp> = {}) =>
    (kind === 'townsign' || free(x, z)) &&
    props.push({ kind, x, z, rotation, y: hm.heightAt(x, z), color: PAINT[Math.floor(rng() * PAINT.length)], loot: false, ...extra });

  for (const r of net.roads) {
    const pts = r.points;
    if (pts.length < 6) continue;
    const dir = (k: number) => {
      const a = pts[Math.max(0, k - 2)];
      const b = pts[Math.min(pts.length - 1, k + 2)];
      return Math.atan2(b.x - a.x, b.z - a.z);
    };
    const side = (k: number, off: number) => {
      const yaw = dir(k);
      // Rechts der Fahrtrichtung: (cos, −sin) – wie lokal +X bei Drehung `yaw`.
      return { x: pts[k].x + Math.cos(yaw) * off, z: pts[k].z - Math.sin(yaw) * off, yaw };
    };

    // Strommasten alle 40 m (20 Abtastpunkte) auf einer Seite.
    if (!NO_POWER.has(r.from) && !NO_POWER.has(r.to)) {
      const off = r.width / 2 + 2.6;
      const poles: { x: number; z: number; yaw: number; y: number; tilt: number }[] = [];
      for (let k = 6; k < pts.length - 6; k += 20) {
        const p = side(k, off);
        if (!free(p.x, p.z)) continue;
        const tilt = rng() < 0.07 ? randRange(rng, 0.25, 0.45) * (rng() < 0.5 ? -1 : 1) : 0;
        poles.push({ ...p, y: hm.heightAt(p.x, p.z), tilt });
      }
      poles.forEach((p, i) => {
        const next = poles[i + 1];
        let link: [number, number, number] | undefined;
        if (next && !p.tilt) {
          const dx = next.x - p.x;
          const dz = next.z - p.z;
          const c = Math.cos(p.yaw);
          const s = Math.sin(p.yaw);
          // Welt → lokal (Umkehrung der Drehung um `yaw`).
          const lx = c * dx - s * dz;
          const lz = s * dx + c * dz;
          // Zum schiefen Mast hin ist die Leitung gerissen und hängt bis fast zum Boden.
          const ly = next.tilt ? -6.6 + (next.y - p.y) * 0.5 : next.y - p.y + 7.6;
          link = [next.tilt ? lx * 0.45 : lx, ly, next.tilt ? lz * 0.45 : lz];
        }
        at('pole', p.x, p.z, p.yaw, { tilt: p.tilt, link });
      });
    }

    // Leitpfosten an Landstraßen
    if (r.asphalt) {
      for (let k = 10; k < pts.length - 10; k += 25) {
        for (const s of [-1, 1]) {
          const p = side(k, s * (r.width / 2 + 0.7));
          at('post', p.x, p.z, p.yaw, { tilt: rng() < 0.12 ? randRange(rng, -0.6, 0.6) : 0 });
        }
      }
    }

    // Liegengebliebene Autos: grob alle 250 m einmal gewürfelt.
    for (let k = 40; k < pts.length - 40; k += 125) {
      if (rng() > 0.55) continue;
      const yaw = dir(k);
      const kind = rng();
      if (kind < 0.45) {
        // Am Rand abgestellt
        const p = side(k, r.width / 2 + 0.6);
        at('car', p.x, p.z, yaw + randRange(rng, -0.15, 0.15) + (rng() < 0.5 ? Math.PI : 0), { loot: rng() < 0.7 });
      } else if (kind < 0.8) {
        // Im Graben, schräg vom Weg abgekommen
        const p = side(k, (rng() < 0.5 ? -1 : 1) * (r.width / 2 + 2.4));
        at('car', p.x, p.z, yaw + randRange(rng, 0.5, 1.1) * (rng() < 0.5 ? -1 : 1), { loot: rng() < 0.7 });
      } else {
        // Quer über der Fahrbahn
        at('car', pts[k].x, pts[k].z, yaw + Math.PI / 2 + randRange(rng, -0.3, 0.3), { loot: rng() < 0.6 });
      }
    }
  }

  // Wegweiser an Kreuzungen
  for (const j of net.junctions) {
    const near = net.distance(j.x, j.z, 10);
    if (near > 6) continue;
    // Etwas neben die Kreuzung, damit der Pfosten nicht auf der Fahrbahn steht.
    const a = rng() * Math.PI * 2;
    let x = j.x;
    let z = j.z;
    for (let i = 0; i < 8; i++) {
      x = j.x + Math.sin(a + i * 0.8) * 5;
      z = j.z + Math.cos(a + i * 0.8) * 5;
      if (net.distance(x, z, 6) > 3.4) break;
    }
    const text = j.arms.map((arm) => `${arm.target}|${(arm.distance / 1000).toFixed(1).replace('.', ',')} km|${arm.yaw}`);
    at('signpost', x, z, 0, { text });
  }

  // Ortsschilder an den Ausfahrten von Altwasser
  if (town) {
    for (const e of town.entries ?? []) {
      const w = townWorld(town, e.x + 5, e.z + (e.z > 0 ? -1 : 1));
      const yaw = town.rotation + (e.z > 0 ? 0 : Math.PI);
      at('townsign', w.x, w.z, yaw, { text: [town.name] });
    }
  }

  return {
    name: 'Wege',
    kind: 'road',
    center: new THREE.Vector3(0, 0, 0),
    rotation: 0,
    radius: 0,
    streets: [],
    buildings: [],
    props,
    plaza: { x: 0, z: 0, radius: 0 },
  };
}
