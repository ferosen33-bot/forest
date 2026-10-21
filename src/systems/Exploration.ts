/**
 * Erkundete Gebiete ("Nebel des Krieges" der Karte): ein grobes Raster über der Insel,
 * dessen Zellen im Umkreis des Spielers aufgedeckt werden.
 */
export class Exploration {
  readonly cells: number;
  readonly cellSize: number;
  private readonly half: number;
  private readonly revealed: Uint8Array;
  /** Zähler, der bei jeder neuen Zelle steigt (Karte zeichnet nur bei Änderungen neu). */
  version = 0;

  constructor(worldSize: number, cells = 128) {
    this.cells = cells;
    this.cellSize = worldSize / cells;
    this.half = worldSize / 2;
    this.revealed = new Uint8Array(cells * cells);
  }

  /** Deckt alle Zellen im Kreis um (x, z) auf. */
  reveal(x: number, z: number, radius: number): void {
    const cs = this.cellSize;
    const cx0 = Math.max(0, Math.floor((x - radius + this.half) / cs));
    const cz0 = Math.max(0, Math.floor((z - radius + this.half) / cs));
    const cx1 = Math.min(this.cells - 1, Math.floor((x + radius + this.half) / cs));
    const cz1 = Math.min(this.cells - 1, Math.floor((z + radius + this.half) / cs));
    const r2 = radius * radius;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const dx = (cx + 0.5) * cs - this.half - x;
        const dz = (cz + 0.5) * cs - this.half - z;
        if (dx * dx + dz * dz > r2) continue;
        const i = cz * this.cells + cx;
        if (!this.revealed[i]) {
          this.revealed[i] = 1;
          this.version++;
        }
      }
    }
  }

  isRevealed(x: number, z: number): boolean {
    const cx = Math.floor((x + this.half) / this.cellSize);
    const cz = Math.floor((z + this.half) / this.cellSize);
    if (cx < 0 || cz < 0 || cx >= this.cells || cz >= this.cells) return false;
    return this.revealed[cz * this.cells + cx] === 1;
  }

  /** Zelle (cx, cz) aufgedeckt? (für das Zeichnen der Karte) */
  cell(cx: number, cz: number): boolean {
    return this.revealed[cz * this.cells + cx] === 1;
  }

  /** Anteil der erkundeten Insel-Zellen in [0, 1]. */
  get fraction(): number {
    let n = 0;
    for (const v of this.revealed) n += v;
    return n / this.revealed.length;
  }

  /** Kompakt als Base64 (1 Bit pro Zelle → 2 KB bei 128²). */
  serialize(): string {
    const bytes = new Uint8Array(Math.ceil(this.revealed.length / 8));
    for (let i = 0; i < this.revealed.length; i++) if (this.revealed[i]) bytes[i >> 3] |= 1 << (i & 7);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  load(data: string): void {
    let bin: string;
    try {
      bin = atob(data);
    } catch {
      return;
    }
    for (let i = 0; i < this.revealed.length; i++) {
      const byte = bin.charCodeAt(i >> 3) || 0;
      this.revealed[i] = (byte >> (i & 7)) & 1;
    }
    this.version++;
  }
}
