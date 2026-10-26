/**
 * Blut auf dem Bildschirm: Ein schwerer Treffer spritzt ein paar Flecken an den Bildrand, von denen
 * einzelne Tropfen langsam herunterlaufen. Nach einigen Sekunden verblassen sie wieder.
 *
 * Jeder Spritzer wird einmal in eine kleine Leinwand gemalt; die sichtbare Leinwand setzt sie nur
 * zusammen (und das nur, solange Blut zu sehen ist). Das Blut ist dunkel und durchscheinend, mit
 * hartem, unregelmäßigem Rand.
 */

interface Splat {
  image: HTMLCanvasElement;
  x: number;
  y: number;
  age: number;
  life: number;
  /** Rinnen: wie weit die Tropfen schon gelaufen sind (px). */
  drips: { x: number; y: number; len: number; speed: number; width: number }[];
}

/** Auflösung der Bildschirm-Leinwand relativ zum Fenster (das Blut ist weich, mehr braucht es nicht). */
const SCALE = 0.5;
const MAX_SPLATS = 7;

export class ScreenBlood {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly splats: Splat[] = [];
  private dirty = false;
  private light = '';

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'screen-blood';
    parent.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    this.canvas.width = Math.max(1, Math.round(window.innerWidth * SCALE));
    this.canvas.height = Math.max(1, Math.round(window.innerHeight * SCALE));
    this.dirty = true;
  }

  /**
   * Treffer: je stärker, desto mehr und größere Spritzer.
   * @param side -1 links … 1 rechts (aus welcher Richtung der Schlag kam), 0 = beliebig
   */
  hit(amount: number, side = 0): void {
    const n = amount >= 25 ? 3 : amount >= 14 ? 2 : 1;
    const w = this.canvas.width;
    const h = this.canvas.height;
    for (let i = 0; i < n; i++) {
      if (this.splats.length >= MAX_SPLATS) this.splats.shift();
      const r = Math.min(w, h) * (0.07 + Math.random() * 0.06 + Math.min(0.06, amount / 400));
      // Am Bildrand, eher auf der Seite, von der der Schlag kam; die Bildmitte bleibt frei.
      const s = side !== 0 && Math.random() < 0.75 ? Math.sign(side) : Math.random() < 0.5 ? -1 : 1;
      const x = s < 0 ? Math.random() * w * 0.22 : w - Math.random() * w * 0.22;
      const y = h * (0.05 + Math.random() * 0.75);
      const image = paintSplat(r);
      const drips = [];
      const k = 1 + Math.floor(Math.random() * 3);
      for (let j = 0; j < k; j++) {
        drips.push({ x: (Math.random() - 0.5) * r * 0.8, y: r * 0.15, len: 0, speed: 6 + Math.random() * 14, width: 1 + Math.random() * 1.6 });
      }
      this.splats.push({ image, x, y, age: 0, life: 6 + Math.random() * 4, drips });
    }
    this.dirty = true;
  }

  /** Helligkeit der Umgebung (0..1): Nachts ist auch das Blut auf dem Bildschirm dunkel. */
  setLight(light: number): void {
    const v = (0.3 + 0.7 * Math.min(1, Math.max(0, light))).toFixed(2);
    if (v !== this.light) {
      this.light = v;
      this.canvas.style.filter = `blur(0.4px) brightness(${v})`;
    }
  }

  clear(): void {
    this.splats.length = 0;
    this.dirty = true;
  }

  update(dt: number): void {
    if (this.splats.length === 0 && !this.dirty) return;
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      s.age += dt;
      if (s.age >= s.life) this.splats.splice(i, 1);
      // Tropfen laufen anfangs schneller, dann stocken sie.
      else for (const d of s.drips) d.len += d.speed * dt * Math.max(0.1, 1 - s.age / s.life);
    }
    const g = this.ctx;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.splats) {
      const fade = Math.min(1, s.age / 0.08) * (1 - Math.max(0, (s.age - s.life * 0.6) / (s.life * 0.4)));
      g.globalAlpha = Math.max(0, fade);
      g.drawImage(s.image, s.x - s.image.width / 2, s.y - s.image.height / 2);
      g.strokeStyle = 'rgba(85, 4, 4, 0.6)';
      g.lineCap = 'round';
      for (const d of s.drips) {
        g.lineWidth = d.width;
        g.beginPath();
        g.moveTo(s.x + d.x, s.y + d.y);
        g.lineTo(s.x + d.x, s.y + d.y + d.len);
        g.stroke();
        g.beginPath();
        g.arc(s.x + d.x, s.y + d.y + d.len, d.width * 1.1, 0, Math.PI * 2);
        g.fillStyle = 'rgba(80, 3, 3, 0.65)';
        g.fill();
      }
    }
    g.globalAlpha = 1;
    this.dirty = false;
  }
}

/** Unregelmäßiger, scharf begrenzter Fleck (Blut hat einen harten Rand). */
function noisyBlob(g: CanvasRenderingContext2D, x: number, y: number, r: number, wobble: number, fill: string): void {
  const n = 28;
  const phase = Math.random() * 10;
  const f1 = 2 + Math.floor(Math.random() * 3);
  const f2 = 5 + Math.floor(Math.random() * 4);
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + wobble * (0.6 * Math.sin(a * f1 + phase) + 0.4 * Math.sin(a * f2 - phase * 1.7));
    const px = x + Math.cos(a) * r * k;
    const py = y + Math.sin(a) * r * k;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

/** Ein Spritzer: dunkler Kern, ausgefranster Rand, Kranz aus Tropfen, die nach außen gezogen sind. */
function paintSplat(r: number): HTMLCanvasElement {
  const size = Math.ceil(r * 3);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  // Körper aus mehreren überlappenden Flecken – dort, wo sie sich decken, wird das Blut dichter.
  for (let i = 0; i < 4; i++) {
    noisyBlob(g, cx + (Math.random() - 0.5) * r * 0.5, cy + (Math.random() - 0.5) * r * 0.5, r * (0.3 + Math.random() * 0.25), 0.25, 'rgba(92, 6, 6, 0.42)');
  }
  noisyBlob(g, cx, cy, r * 0.22, 0.3, 'rgba(45, 0, 0, 0.45)');
  // Ausläufer und Tropfen, radial in die Länge gezogen.
  const a0 = Math.random() * Math.PI * 2;
  for (let i = 0; i < 22; i++) {
    const a = i < 10 ? a0 + (Math.random() - 0.5) * 1.4 : Math.random() * Math.PI * 2;
    const d = r * (0.55 + Math.random() * 0.75);
    const rr = r * (0.02 + Math.random() * 0.06) * (i < 10 ? 1.4 : 1);
    g.save();
    g.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
    g.rotate(a);
    g.scale(1.8 + Math.random() * 1.5, 1);
    noisyBlob(g, 0, 0, rr, 0.15, 'rgba(100, 6, 6, 0.6)');
    g.restore();
  }
  return c;
}
