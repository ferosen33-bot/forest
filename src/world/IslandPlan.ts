import type { HeightMap } from './HeightMap';
import { placeSites, type PlaceKind, type PlaceSite } from './Places';

/** Die ursprünglichen Orte der Geschichte (brauchen viel Abstand zu Dörfern). */
const STORY_PLACES = new Set<PlaceKind>(['crash', 'mine', 'hut', 'radio', 'ferry', 'chapel', 'lab', 'stones', 'lighthouse', 'smugglers']);
import { findTownSite, generateTown, TOWN_FLAT_BLEND, TOWN_FLAT_RADIUS, townWorld, type TownLayout } from './Town';
import { findHarborSite, generateHarbor, HARBOR_FLAT_BLEND, HARBOR_FLAT_RADIUS, type HarborLayout } from './Harbor';
import { placeHamlets } from './Hamlets';
import { buildRoads, type RoadNetwork, type RoadNode } from './Roads';
import { roadsideLayout } from './Roadside';
import { landmarkLayout, placeLandmarks, placeWeaponSpots, type Landmark } from './Landmarks';

/**
 * Der Plan der Insel – wo Stadt, Hafen, besondere Orte, Dörfer und Wege liegen. Ebnet die Bauplätze
 * ein und legt die Fahrbahnen ins Gelände (verändert die Höhenkarte, also vor Terrain und Physik).
 * Ohne Grafik und Physik, damit er sich testen lässt.
 */
export interface IslandPlan {
  town: TownLayout | null;
  harbor: HarborLayout | null;
  places: PlaceSite[];
  hamlets: TownLayout[];
  roads: RoadNetwork;
  roadside: TownLayout;
  /** Fundorte im Wald und was dort steht. */
  landmarks: Landmark[];
  wild: TownLayout;
  spawn: { x: number; z: number };
}

export function planIsland(hm: HeightMap, seed: number): IslandPlan {
  const site = findTownSite(hm, seed);
  const town = site ? generateTown(seed, site) : null;
  if (site) hm.flatten(site.x, site.z, TOWN_FLAT_RADIUS, TOWN_FLAT_BLEND, site.y);
  const harborSite = findHarborSite(hm, seed, town ? [{ x: town.center.x, z: town.center.z, radius: town.radius + 150 }] : []);
  if (harborSite) hm.flatten(harborSite.x, harborSite.z, HARBOR_FLAT_RADIUS, HARBOR_FLAT_BLEND, harborSite.y);
  const harbor = harborSite ? generateHarbor(hm, harborSite) : null;
  const spawn = findSpawn(hm);
  const places = placeSites(
    hm,
    seed,
    [
      { x: spawn.x, z: spawn.z, radius: 200 },
      ...(town ? [{ x: town.center.x, z: town.center.z, radius: town.radius + 60 }] : []),
      ...(harbor ? [{ x: harbor.center.x, z: harbor.center.z, radius: 90 }] : []),
    ],
    town ? { x: town.center.x, z: town.center.z } : null,
  );
  const hamlets = placeHamlets(hm, seed, [
    { x: spawn.x, z: spawn.z, radius: 160 },
    ...(town ? [{ x: town.center.x, z: town.center.z, radius: town.radius + 120 }] : []),
    ...(harbor ? [{ x: harbor.center.x, z: harbor.center.z, radius: 100 }] : []),
    // Die großen Orte der Geschichte halten weiten Abstand, die kleinen (ab Meilenstein 53) dürfen näher heran.
    ...places.map((p) => ({ x: p.position.x, z: p.position.z, radius: p.radius + (STORY_PLACES.has(p.kind) ? 60 : 10) })),
  ]);
  const roads = buildRoads(hm, seed, roadNodes(town, harbor, places, hamlets, spawn), [
    ...(town ? [{ x: town.center.x, z: town.center.z, radius: town.radius - 4 }] : []),
    ...hamlets.map((h) => ({ x: h.center.x, z: h.center.z, radius: h.radius * 0.8 })),
    ...places.map((p) => ({ x: p.position.x, z: p.position.z, radius: p.radius * 0.6 })),
    ...(harbor ? [{ x: harbor.center.x, z: harbor.center.z, radius: 30 }] : []),
  ]);
  const roadside = roadsideLayout(roads, hm, seed, town, [
    ...(town ? [{ x: town.center.x, z: town.center.z, radius: town.radius + 4 }] : []),
    ...hamlets.map((h) => ({ x: h.center.x, z: h.center.z, radius: h.radius + 3 })),
    ...places.map((p) => ({ x: p.position.x, z: p.position.z, radius: p.radius * 0.8 })),
    ...(harbor ? [{ x: harbor.center.x, z: harbor.center.z, radius: 40 }] : []),
  ]);
  const avoid = [
    { x: spawn.x, z: spawn.z, radius: 20 },
    ...(town ? [{ x: town.center.x, z: town.center.z, radius: town.radius + 30 }] : []),
    ...hamlets.map((h) => ({ x: h.center.x, z: h.center.z, radius: h.radius + 25 })),
    ...places.map((p) => ({ x: p.position.x, z: p.position.z, radius: p.radius + 35 })),
    ...(harbor ? [{ x: harbor.center.x, z: harbor.center.z, radius: 90 }] : []),
  ];
  const landmarks = placeLandmarks(hm, seed, roads, avoid, spawn);
  // Waffenfundstellen kommen hinten dran (die Behälter der übrigen Fundorte behalten ihre Nummern).
  landmarks.push(...placeWeaponSpots(hm, seed, roads, avoid, spawn, landmarks));
  const wild = landmarkLayout(landmarks, hm, seed);
  return { town, harbor, places, hamlets, roads, roadside, landmarks, wild, spawn };
}

/** Knoten des Wegenetzes: Stadtausfahrten, Dörfer, Hafen und die erreichbaren besonderen Orte. */
export function roadNodes(
  town: TownLayout | null,
  harbor: HarborLayout | null,
  places: PlaceSite[],
  hamlets: TownLayout[],
  spawn: { x: number; z: number },
): RoadNode[] {
  const nodes: RoadNode[] = [];
  const entry = (t: TownLayout, id: string) =>
    (t.entries ?? []).forEach((e, i) => {
      const w = townWorld(t, e.x, e.z);
      nodes.push({ id: `${id}${i}`, group: id, name: t.name, x: w.x, z: w.z, major: !t.kind || t.kind === 'town' || t.kind === 'hamlet' });
    });
  if (town) entry(town, 'town');
  for (const h of hamlets) entry(h, h.name);
  if (harbor) nodes.push({ id: 'harbor', name: 'Nordbucht', x: harbor.center.x, z: harbor.center.z, major: false });
  for (const p of places) {
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    // Zeche: vor dem Hof; Funkstation: am Tor (lokal −Z); sonst am Rand des Ortes.
    if (p.kind === 'mine') nodes.push({ id: p.kind, name: p.name, x: p.position.x - fx * 26, z: p.position.z - fz * 26, major: false });
    else if (p.kind === 'radio') nodes.push({ id: p.kind, name: p.name, x: p.position.x - fx * 13, z: p.position.z - fz * 13, major: false });
    else if (p.kind === 'chapel' || p.kind === 'lab' || p.kind === 'crash')
      nodes.push({ id: p.kind, name: p.name, x: p.position.x + fx * p.radius * 0.7, z: p.position.z + fz * p.radius * 0.7, major: false });
  }
  // Ein Waldweg endet unweit der Stelle, an der man zu sich kommt – ein erster Anhaltspunkt.
  nodes.push({ id: 'spawn', name: 'Waldweg', x: spawn.x + 40, z: spawn.z - 30, major: false });
  return nodes;
}

/** Flacher Spawnpunkt im Wald nahe der Südküste: trocken, nicht zu hoch, kaum Gefälle. */
export function findSpawn(hm: HeightMap): { x: number; z: number } {
  const prefX = 0;
  const prefZ = hm.half * 0.42;
  const n: [number, number, number] = [0, 1, 0];
  let best = { x: prefX, z: prefZ };
  let bestScore = Infinity;
  for (let z = -hm.half * 0.8; z <= hm.half * 0.8; z += 6) {
    for (let x = -hm.half * 0.8; x <= hm.half * 0.8; x += 6) {
      const h = hm.heightAt(x, z);
      if (h < hm.waterLevel + 4 || h > 18) continue;
      hm.normalAt(x, z, n);
      if (n[1] < 0.97) continue;
      const score = Math.hypot(x - prefX, z - prefZ) + (1 - n[1]) * 500;
      if (score < bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
  }
  return best;
}

