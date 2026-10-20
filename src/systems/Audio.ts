/**
 * Prozedurale Soundeffekte über die Web Audio API – ganz ohne Audiodateien.
 * Jeder Effekt wird aus Rauschen, Oszillatoren, Filtern und Hüllkurven synthetisiert.
 *
 * Browser erlauben Audio erst nach einer Nutzerinteraktion: `resume()` beim Spielstart aufrufen.
 */
export type SoundId =
  | 'chop'
  | 'stoneHit'
  | 'swing'
  | 'pickup'
  | 'eat'
  | 'drink'
  | 'treeCrack'
  | 'treeFall'
  | 'denied'
  | 'craft'
  | 'place'
  | 'crackle'
  | 'ignite'
  | 'growl'
  | 'scream'
  | 'enemyAttack'
  | 'fleshHit'
  | 'enemyDeath'
  | 'block'
  | 'hurt';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  /** Ziel-Knoten des aktuellen `play()`-Aufrufs (trägt dessen Lautstärke). */
  private out: GainNode | null = null;
  volume = 0.6;

  /** Startet bzw. reaktiviert den AudioContext (muss aus einer User-Geste kommen). */
  resume(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return; // kein Audio verfügbar (z. B. Headless-Tests)
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      // 1 s weißes Rauschen als Rohmaterial für alle perkussiven Sounds.
      this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** @param volume Lautstärkefaktor dieses Aufrufs (z. B. nach Entfernung abgeschwächt). */
  play(id: SoundId, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running' || volume <= 0.01) return;
    const t = ctx.currentTime;
    const pitch = 0.9 + Math.random() * 0.2;
    this.out = ctx.createGain();
    this.out.gain.value = volume;
    this.out.connect(this.master);

    switch (id) {
      case 'chop':
        this.noise(t, 0.12, 'bandpass', 900 * pitch, 1.2, 0.9);
        this.tone(t, 'sine', 140 * pitch, 60, 0.12, 0.7);
        break;
      case 'stoneHit':
        this.noise(t, 0.07, 'highpass', 2500 * pitch, 0.7, 0.7);
        this.tone(t, 'triangle', 900 * pitch, 400, 0.06, 0.25);
        break;
      case 'swing':
        this.noise(t, 0.2, 'bandpass', 500 * pitch, 0.8, 0.18, 1800);
        break;
      case 'pickup':
        this.tone(t, 'sine', 520, 520, 0.07, 0.25);
        this.tone(t + 0.06, 'sine', 780, 780, 0.09, 0.22);
        break;
      case 'eat':
        for (let i = 0; i < 3; i++) this.noise(t + i * 0.09, 0.05, 'bandpass', 1400 + Math.random() * 600, 2, 0.35);
        break;
      case 'drink':
        for (let i = 0; i < 3; i++) this.tone(t + i * 0.12, 'sine', 300 + Math.random() * 80, 600, 0.08, 0.25);
        break;
      case 'treeCrack':
        for (let i = 0; i < 5; i++) this.noise(t + i * 0.05 + Math.random() * 0.03, 0.04, 'bandpass', 1800, 3, 0.6);
        this.tone(t, 'sawtooth', 90, 55, 0.6, 0.18, 400);
        break;
      case 'treeFall':
        this.noise(t, 1.1, 'lowpass', 600, 0.7, 1.0, 120);
        this.tone(t, 'sine', 70, 35, 0.6, 0.9);
        break;
      case 'denied':
        this.tone(t, 'square', 180, 140, 0.12, 0.12, 1200);
        break;
      case 'craft':
        for (let i = 0; i < 3; i++) {
          this.noise(t + i * 0.14, 0.06, 'bandpass', 700 + i * 120, 1.5, 0.6);
          this.tone(t + i * 0.14, 'sine', 160, 90, 0.08, 0.4);
        }
        break;
      case 'place':
        this.noise(t, 0.25, 'lowpass', 500, 0.8, 0.8);
        this.tone(t, 'sine', 95, 50, 0.25, 0.7);
        break;
      case 'crackle':
        this.noise(t, 0.025 + Math.random() * 0.03, 'highpass', 1800 + Math.random() * 2500, 0.8, 0.5);
        break;
      case 'ignite':
        this.noise(t, 0.6, 'bandpass', 900, 0.6, 0.5, 2500);
        break;
      // Kreaturen: Sägezahn durch Bandpass ("Formant") mit unruhiger Tonhöhe.
      case 'growl':
        this.tone(t, 'sawtooth', 70 * pitch, 55, 0.9, 0.35, 500);
        this.noise(t, 0.8, 'bandpass', 300, 2, 0.2);
        break;
      case 'scream':
        this.tone(t, 'sawtooth', 420 * pitch, 260, 0.9, 0.35, 2200);
        this.tone(t + 0.05, 'square', 610 * pitch, 380, 0.75, 0.12, 1800);
        this.noise(t, 0.8, 'bandpass', 1600, 1.5, 0.3);
        break;
      case 'enemyAttack':
        this.tone(t, 'sawtooth', 180 * pitch, 120, 0.35, 0.3, 900);
        break;
      case 'fleshHit':
        this.noise(t, 0.12, 'lowpass', 700, 1, 1.0);
        this.tone(t, 'sine', 110, 60, 0.15, 0.8);
        break;
      case 'enemyDeath':
        this.tone(t, 'sawtooth', 300 * pitch, 80, 1.2, 0.35, 1200);
        this.noise(t, 1.0, 'bandpass', 500, 1, 0.25);
        break;
      case 'block':
        this.noise(t, 0.08, 'bandpass', 1400, 2, 0.8);
        this.tone(t, 'triangle', 240, 180, 0.1, 0.4);
        break;
      case 'hurt':
        this.tone(t, 'triangle', 220 * pitch, 140, 0.25, 0.4, 1500);
        this.noise(t, 0.15, 'lowpass', 600, 1, 0.6);
        break;
    }
  }

  /** Gefiltertes Rauschen mit exponentiellem Abklingen (optional mit Filter-Sweep). */
  private noise(
    t: number,
    duration: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    gain: number,
    sweepTo?: number,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(env).connect(this.out!);
    src.start(t, Math.random() * 0.5, duration + 0.05);
  }

  /** Oszillator mit Tonhöhen-Rampe und Abkling-Hüllkurve. */
  private tone(
    t: number,
    type: OscillatorType,
    from: number,
    to: number,
    duration: number,
    gain: number,
    lowpass?: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.001, t + duration);
    let node: AudioNode = osc;
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node = osc.connect(f);
    }
    node.connect(env).connect(this.out!);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }
}
