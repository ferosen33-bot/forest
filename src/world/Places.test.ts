import { describe, expect, it } from 'vitest';
import { HeightMap } from './HeightMap';
import { placeSites } from './Places';
import { CONFIG } from '../config';

describe('Gebiete und Orte der großen Insel', () => {
  const w = CONFIG.world;
  const hm = new HeightMap({ size: w.size, cellSize: w.cellSize, seed: CONFIG.seed, waterLevel: w.waterLevel });
  const sites = placeSites(hm, CONFIG.seed, []);

  it('hat Gebirge mit Schneegipfeln, einen Sumpf und Klippen', () => {
    expect(hm.maxHeight).toBeGreaterThan(100);
    // Irgendwo im Sumpf: flach, knapp um den Wasserspiegel.
    let swamp = 0;
    let cliffs = 0;
    for (let z = -hm.half; z < hm.half; z += 24) {
      for (let x = -hm.half; x < hm.half; x += 24) {
        const b = hm.biomes.dominant(x, z);
        const h = hm.heightAt(x, z);
        if (b === 'swamp' && Math.abs(h) < 1.6) swamp++;
        if (b === 'cliffs' && h > 15) cliffs++;
      }
    }
    expect(swamp).toBeGreaterThan(100);
    expect(cliffs).toBeGreaterThan(50);
  });

  it('findet alle Orte an passenden Stellen', () => {
    const kinds = sites.map((s) => s.kind).sort();
    expect(kinds).toEqual(['chapel', 'crash', 'drowned', 'falls', 'ferry', 'grove', 'hut', 'lab', 'lighthouse', 'mine', 'radio', 'smugglers', 'stones', 'tower', 'wrecks']);
    // Fähre im flachen Wasser, Labor hoch im Gebirge, Steinkreis auf einer Kuppe.
    const ferry = sites.find((s) => s.kind === 'ferry')!;
    expect(hm.heightAt(ferry.position.x, ferry.position.z)).toBeLessThan(hm.waterLevel - 1);
    expect(Math.hypot(ferry.position.x, ferry.position.z) / hm.half).toBeGreaterThan(0.6);
    expect(sites.find((s) => s.kind === 'lab')!.position.y).toBeGreaterThan(50);
    const at = (k: string) => sites.find((s) => s.kind === k)!;
    // Hütte steht im Wasser, der Steg führt zu festem Ufer.
    const hut = at('hut');
    expect(hm.heightAt(hut.position.x, hut.position.z)).toBeLessThan(hm.waterLevel);
    expect(hm.heightAt(hut.position.x - Math.sin(hut.yaw) * 11, hut.position.z - Math.cos(hut.yaw) * 11)).toBeGreaterThan(hm.waterLevel + 0.4);
    // Zeche: der Hang steigt hinter dem Mundloch an.
    const mine = at('mine');
    expect(hm.heightAt(mine.position.x + Math.sin(mine.yaw) * 8, mine.position.z + Math.cos(mine.yaw) * 8)).toBeGreaterThan(mine.position.y + 3);
    // Funkstation: hoch über dem Meer.
    expect(at('radio').position.y).toBeGreaterThan(15);
    // Die Orte der Geschichte liegen auf der Hauptinsel, Leuchtturm und Schmugglerbucht auf den Nachbarinseln.
    for (const k of ['lighthouse', 'smugglers']) expect(hm.islets.some((i) => Math.hypot(at(k).position.x - i.x, at(k).position.z - i.z) < i.radius)).toBe(true);
    expect(at('smugglers').position.y).toBeGreaterThan(hm.waterLevel + 0.5);
    for (const site of sites.filter((s) => s.kind !== 'lighthouse' && s.kind !== 'smugglers')) for (const islet of hm.islets) expect(Math.hypot(site.position.x - islet.x, site.position.z - islet.z)).toBeGreaterThan(islet.radius + 40);
    // Orte liegen weit auseinander.
    for (const a of sites) for (const b of sites) if (a !== b) expect(a.position.distanceTo(b.position)).toBeGreaterThan(150);
  });

  it('zwei Nachbarinseln liegen jenseits eines tiefen Kanals', () => {
    expect(hm.islets.length).toBe(2);
    for (const islet of hm.islets) {
      expect(hm.heightAt(islet.x, islet.z)).toBeGreaterThan(8);
      // Auf halbem Weg zur Hauptinsel ist das Meer tief.
      const k = 1 - (islet.radius + 80) / Math.hypot(islet.x, islet.z);
      expect(hm.heightAt(islet.x * k, islet.z * k)).toBeLessThan(hm.waterLevel - 12);
      expect(Math.max(Math.abs(islet.x), Math.abs(islet.z)) + islet.radius).toBeLessThan(hm.half - 30);
    }
  });

  it('kleine Testwelten bleiben ohne Gebiete und Orte', () => {
    const small = new HeightMap({ size: 512, cellSize: 2, seed: 7, waterLevel: 0 });
    expect(small.biomes.enabled).toBe(false);
    expect(placeSites(small, 7, [])).toEqual([]);
    expect(small.islets).toEqual([]);
  });
});
