const WIDTH = 420;
const HEIGHT = 30;
/** Sichtbarer Ausschnitt des Kompassbands in Grad. */
const SPAN = 150;
const LABELS: Record<number, string> = { 0: 'N', 45: 'NO', 90: 'O', 135: 'SO', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

/**
 * Kompassband oben im HUD: Himmelsrichtungen und Gradstriche laufen mit der Blickrichtung,
 * dazu eine Markierung in Richtung des Aufwachpunkts (Unterstand).
 */
export class Compass {
  private readonly ctx: CanvasRenderingContext2D;
  private last = '';

  constructor(canvas: HTMLCanvasElement) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = WIDTH * ratio;
    canvas.height = HEIGHT * ratio;
    canvas.style.width = `${WIDTH}px`;
    canvas.style.height = `${HEIGHT}px`;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(ratio, ratio);
  }

  /**
   * @param bearing Blickrichtung in Grad (0 = Norden, im Uhrzeigersinn)
   * @param home Richtung zum Aufwachpunkt in Grad (oder null)
   */
  update(bearing: number, home: number | null): void {
    const key = `${bearing.toFixed(1)}|${home?.toFixed(0) ?? ''}`;
    if (key === this.last) return;
    this.last = key;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const toX = (deg: number) => {
      let d = deg - bearing;
      d = ((((d + 180) % 360) + 360) % 360) - 180;
      return WIDTH / 2 + (d / SPAN) * WIDTH;
    };
    ctx.textAlign = 'center';
    for (let deg = 0; deg < 360; deg += 15) {
      const x = toX(deg);
      if (x < -20 || x > WIDTH + 20) continue;
      // Zur Mitte hin deutlicher, am Rand ausblenden.
      const fade = 1 - Math.abs(x - WIDTH / 2) / (WIDTH / 2);
      const label = LABELS[deg];
      ctx.globalAlpha = 0.25 + 0.75 * fade;
      ctx.fillStyle = deg === 0 ? '#ff8a6a' : '#e9e2cf';
      if (label) {
        ctx.font = label.length === 1 ? '600 16px Oswald, system-ui, sans-serif' : '500 13px "Barlow Condensed", system-ui, sans-serif';
        ctx.fillText(label, x, 19);
      } else {
        ctx.fillRect(x - 0.5, 9, 1, 7);
      }
    }
    if (home !== null) {
      const x = toX(home);
      if (x > 0 && x < WIDTH) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#f3e6c0';
        ctx.beginPath();
        ctx.moveTo(x, HEIGHT - 2);
        ctx.lineTo(x + 5, HEIGHT - 9);
        ctx.lineTo(x - 5, HEIGHT - 9);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Mittelmarke
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(WIDTH / 2 - 1, 0, 2, 5);
    ctx.globalAlpha = 1;
  }
}
