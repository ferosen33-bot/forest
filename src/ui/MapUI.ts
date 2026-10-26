import type { HeightMap } from '../world/HeightMap';
import type { PlaceKind } from '../world/Places';
import type { Vegetation } from '../world/Vegetation';
import { isTree } from '../world/Vegetation';
import type { Exploration } from '../systems/Exploration';
import { clamp, smoothstep } from '../utils/math';
import { townWorld, type TownLayout } from '../world/Town';

/** Was die Karte außer dem Gelände zeigt. */
export interface MapMarkers {
  player: { x: number; z: number; bearing: number };
  respawn: { x: number; z: number } | null;
  structures: { x: number; z: number; kind: 'fire' | 'shelter' | 'wall' | 'other' }[];
  /** Entdeckte Schrat-Lager. */
  camps: { x: number; z: number }[];
  /** Entdeckte Höhleneingänge. */
  caves?: { x: number; z: number }[];
  /** Zufallsereignisse (Abwurf, Ritual, verlassenes Lager). */
  events?: { x: number; z: number; kind: 'drop' | 'ritual' | 'camp' }[];
  /** Leuchtturm der Überlebenden (sobald gefunden). */
  harbor?: { x: number; z: number } | null;
  /** Entdeckte besondere Orte (mit Namen). */
  places?: { x: number; z: number; name: string; kind: PlaceKind }[];
}

const RES = 512;

/**
 * Inselkarte (Taste M): Gelände mit Schummerung und Wald, darüber ein Nebel über allem,
 * was noch nicht erkundet wurde, und Markierungen (Spieler mit Blickrichtung, Bauwerke,
 * Aufwachpunkt, entdeckte Lager). Norden ist oben (−Z), Osten rechts (+X).
 */
export class MapUI {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly fog: HTMLCanvasElement;
  private fogVersion = -1;
  private fogSmall: HTMLCanvasElement | null = null;
  private _open = false;
  private readonly biome = { highland: 0, swamp: 0, cliffs: 0 };

  constructor(
    private readonly root: HTMLElement,
    private readonly heightMap: HeightMap,
    vegetation: Vegetation,
    private readonly exploration: Exploration,
  ) {
    this.canvas = root.querySelector('canvas')!;
    this.canvas.width = this.canvas.height = RES;
    this.ctx = this.canvas.getContext('2d')!;
    this.base = this.renderBase(vegetation);
    this.fog = document.createElement('canvas');
    this.fog.width = this.fog.height = RES;
  }

  get open(): boolean {
    return this._open;
  }

  toggle(): void {
    this._open = !this._open;
    this.root.classList.toggle('hidden', !this._open);
  }

  hide(): void {
    this._open = false;
    this.root.classList.add('hidden');
  }

  /** Welt → Kartenpixel */
  /** Straßen und Häuser der Stadt einmalig in die Grundkarte zeichnen (unter dem Erkundungsnebel). */
  drawTown(t: TownLayout): void {
    const ctx = this.base.getContext('2d')!;
    const pt = (x: number, z: number) => {
      const w = townWorld(t, x, z);
      return this.px(w.x, w.z);
    };
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#4a4844';
    for (const s of t.streets) {
      ctx.lineWidth = Math.max(2, (s.width * RES) / this.heightMap.size);
      ctx.beginPath();
      ctx.moveTo(...pt(s.ax, s.az));
      ctx.lineTo(...pt(s.bx, s.bz));
      ctx.stroke();
    }
    ctx.fillStyle = '#6e6658';
    ctx.strokeStyle = '#2b2620';
    ctx.lineWidth = 0.8;
    for (const b of t.buildings) {
      const c = Math.cos(b.rotation);
      const s = Math.sin(b.rotation);
      ctx.beginPath();
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([u, v], i) => {
        const lx = (u * b.w) / 2;
        const lz = (v * b.d) / 2;
        const [x, y] = pt(b.x + c * lx + s * lz, b.z - s * lx + c * lz);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    const [lx, ly] = pt(0, 0);
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(30, 26, 18, 0.85)';
    ctx.fillText(t.name, lx, ly - 26);
  }

  private px(x: number, z: number): [number, number] {
    const s = RES / this.heightMap.size;
    return [(x + this.heightMap.half) * s, (z + this.heightMap.half) * s];
  }

  /** Grundkarte: Wasser nach Tiefe, Strand, Gras, Fels; Schummerung von Nordwesten; Bäume als Punkte. */
  private renderBase(vegetation: Vegetation): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = RES;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(RES, RES);
    const hm = this.heightMap;
    const n: [number, number, number] = [0, 1, 0];
    const light = [-0.55, 0.7, -0.45];
    const ll = Math.hypot(...light);
    for (let py = 0; py < RES; py++) {
      for (let px = 0; px < RES; px++) {
        const x = ((px + 0.5) / RES - 0.5) * hm.size;
        const z = ((py + 0.5) / RES - 0.5) * hm.size;
        const h = hm.heightAt(x, z);
        hm.normalAt(x, z, n);
        let r: number;
        let g: number;
        let b: number;
        const biome = hm.biomes.weights(x, z, this.biome);
        if (h < hm.waterLevel) {
          const t = smoothstep(0, 16, hm.waterLevel - h);
          r = 92 - 60 * t;
          g = 140 - 76 * t;
          b = 150 - 62 * t;
        } else {
          const slope = 1 - n[1];
          const sand = (1 - smoothstep(1.2, 2.6, h)) * (1 - biome.swamp);
          const rock = Math.max(smoothstep(0.3, 0.45, slope), smoothstep(40, 52, h));
          r = 96 + 40 * smoothstep(5, 30, h);
          g = 122 + 18 * smoothstep(5, 30, h);
          b = 64 + 10 * smoothstep(5, 30, h);
          r += (205 - r) * sand;
          g += (184 - g) * sand;
          b += (130 - b) * sand;
          r += (126 - r) * rock;
          g += (120 - g) * rock;
          b += (110 - b) * rock;
          // Moor: dunkles Oliv; Gipfel: Schnee.
          r += (82 - r) * biome.swamp;
          g += (92 - g) * biome.swamp;
          b += (56 - b) * biome.swamp;
          const snow = smoothstep(88, 98, h) * (1 - smoothstep(0.35, 0.55, slope));
          r += (236 - r) * snow;
          g += (240 - g) * snow;
          b += (246 - b) * snow;
          const shade = clamp((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / ll, 0, 1);
          const k = 0.55 + 0.6 * shade;
          r *= k;
          g *= k;
          b *= k;
        }
        const i = (py * RES + px) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Wald: jeder Baum ein dunkler Punkt
    ctx.fillStyle = 'rgba(28, 48, 24, 0.55)';
    for (const v of vegetation.instances) {
      if (!v.alive || !isTree(v.kind)) continue;
      const [px, py] = this.px(v.position.x, v.position.z);
      ctx.fillRect(px - 0.6, py - 0.6, 1.4, 1.4);
    }
    return c;
  }

  /**
   * Nebel über unerkundeten Zellen, nur bei Änderungen neu: erst ein winziges Bild mit einem
   * Pixel pro Zelle, dann einmal weichgezeichnet hochskaliert (statt tausender Einzelflächen).
   */
  private updateFog(): void {
    if (this.fogVersion === this.exploration.version) return;
    this.fogVersion = this.exploration.version;
    const e = this.exploration;
    const small = (this.fogSmall ??= document.createElement('canvas'));
    small.width = small.height = e.cells + 2;
    const sctx = small.getContext('2d')!;
    const img = sctx.createImageData(e.cells + 2, e.cells + 2);
    for (let cz = -1; cz <= e.cells; cz++) {
      for (let cx = -1; cx <= e.cells; cx++) {
        const inside = cx >= 0 && cz >= 0 && cx < e.cells && cz < e.cells;
        const i = ((cz + 1) * (e.cells + 2) + cx + 1) * 4;
        img.data[i] = 217;
        img.data[i + 1] = 207;
        img.data[i + 2] = 180;
        img.data[i + 3] = inside && e.cell(cx, cz) ? 0 : 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    const ctx = this.fog.getContext('2d')!;
    const cell = RES / e.cells;
    ctx.clearRect(0, 0, RES, RES);
    ctx.imageSmoothingEnabled = true;
    ctx.filter = `blur(${cell * 0.7}px)`;
    ctx.drawImage(small, -cell, -cell, RES + 2 * cell, RES + 2 * cell);
    ctx.filter = 'none';
  }

  render(m: MapMarkers): void {
    if (!this._open) return;
    this.updateFog();
    const ctx = this.ctx;
    ctx.drawImage(this.base, 0, 0);
    ctx.drawImage(this.fog, 0, 0);

    // Bauwerke
    for (const s of m.structures) {
      const [x, y] = this.px(s.x, s.z);
      ctx.fillStyle = s.kind === 'fire' ? '#ff9a3c' : s.kind === 'shelter' ? '#f3e6c0' : s.kind === 'wall' ? '#6b4b2e' : '#a8875f';
      const r = s.kind === 'wall' ? 1.6 : 2.6;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Entdeckte Lager: rotes X im Kreis
    ctx.lineWidth = 2;
    for (const c of m.camps) {
      const [x, y] = this.px(c.x, c.z);
      ctx.strokeStyle = '#b3262a';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.moveTo(x - 4, y - 4);
      ctx.lineTo(x + 4, y + 4);
      ctx.moveTo(x + 4, y - 4);
      ctx.lineTo(x - 4, y + 4);
      ctx.stroke();
    }
    // Höhleneingänge: dunkler Bogen auf hellem Fels
    for (const c of m.caves ?? []) {
      const [x, y] = this.px(c.x, c.z);
      ctx.fillStyle = '#cfc8ba';
      ctx.strokeStyle = '#2b2418';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y + 3, 8, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1a1612';
      ctx.beginPath();
      ctx.arc(x, y + 3, 4, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
    }
    // Ereignisse: Abwurf rotes Quadrat mit Kreuz, Ritual oranges Feuer, Lager heller Kreis
    for (const e of m.events ?? []) {
      const [x, y] = this.px(e.x, e.z);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#1a1612';
      if (e.kind === 'drop') {
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(x - 5, y - 5, 10, 10);
        ctx.strokeRect(x - 5, y - 5, 10, 10);
        ctx.beginPath();
        ctx.moveTo(x - 5, y);
        ctx.lineTo(x + 5, y);
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x, y + 5);
        ctx.stroke();
      } else if (e.kind === 'ritual') {
        ctx.fillStyle = '#ff7a2a';
        ctx.beginPath();
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 5, y + 4);
        ctx.lineTo(x - 5, y + 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = '#e8dcc0';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    // Leuchtturm: rot-weißer Turm mit gelbem Licht
    if (m.harbor) {
      const [x, y] = this.px(m.harbor.x, m.harbor.z);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#1a1612';
      ctx.fillStyle = '#f6f1e4';
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 6);
      ctx.lineTo(x + 3, y - 6);
      ctx.lineTo(x + 5, y + 7);
      ctx.lineTo(x - 5, y + 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#b8352a';
      ctx.fillRect(x - 4, y, 8, 3);
      ctx.fillStyle = '#ffd25a';
      ctx.beginPath();
      ctx.arc(x, y - 9, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Besondere Orte: Raute mit Namen
    for (const pl of m.places ?? []) {
      const [x, y] = this.px(pl.x, pl.z);
      const color = { crash: '#d9d6cc', mine: '#8a7a62', hut: '#6f8048', radio: '#c2463a', ferry: '#4a6a8a', chapel: '#e6dcc4', lab: '#7ab8b0', stones: '#9a8a7a' }[pl.kind];
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#1a1612';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 6, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 6, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20, 16, 12, 0.85)';
      ctx.strokeText(pl.name, x, y - 10);
      ctx.fillStyle = '#efe6d2';
      ctx.fillText(pl.name, x, y - 10);
    }
    // Aufwachpunkt: Zelt-Symbol
    if (m.respawn) {
      const [x, y] = this.px(m.respawn.x, m.respawn.z);
      ctx.fillStyle = '#f3e6c0';
      ctx.strokeStyle = '#2b2418';
      ctx.beginPath();
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 7, y + 5);
      ctx.lineTo(x - 7, y + 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // Spieler: Pfeil in Blickrichtung
    const [px, py] = this.px(m.player.x, m.player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(m.player.bearing);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Nordpfeil
    ctx.fillStyle = 'rgba(30, 26, 18, 0.8)';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', RES - 22, 26);
    ctx.beginPath();
    ctx.moveTo(RES - 22, 30);
    ctx.lineTo(RES - 17, 44);
    ctx.lineTo(RES - 27, 44);
    ctx.closePath();
    ctx.fill();
  }
}
