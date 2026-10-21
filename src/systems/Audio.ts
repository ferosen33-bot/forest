/**
 * Prozedurale Soundeffekte über die Web Audio API – ganz ohne Audiodateien.
 * Jeder Effekt wird aus Rauschen, Oszillatoren, Filtern und Hüllkurven synthetisiert.
 *
 * Signalweg:  Effekte ─┐
 *                      ├─► Master ─► Unterwasser-Tiefpass ─► Ausgang
 *            Ambiente ─┘
 * Effekte mit Position laufen über einen HRTF-Panner (3D-Ortung relativ zur Kamera).
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
  | 'hurt'
  | 'land'
  | 'stepGrass'
  | 'stepSand'
  | 'stepRock'
  | 'stepWood'
  | 'stepWater'
  | 'hoof'
  | 'deerAlarm'
  | 'throw'
  | 'sizzle'
  | 'thunder'
  | 'thunderNear'
  | 'door'
  | 'bowShot'
  | 'bowDraw';

export interface PlayOptions {
  volume?: number;
  /** Weltposition der Quelle → räumlicher Klang. Ohne Position: direkt "im Kopf". */
  position?: { x: number; y: number; z: number };
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private underwaterFilter: BiquadFilterNode | null = null;
  private noise1s: AudioBuffer | null = null;
  /** Ziel-Knoten des aktuellen `play()`-Aufrufs (trägt dessen Lautstärke). */
  private out: GainNode | null = null;
  private underwater = false;
  /** Lautstärken 0..1 (Einstellungen); Gesamt wird intern auf 0,6 skaliert. */
  volume = 0.6;
  sfxVolume = 1;
  ambienceVolume = 0.8;

  /** Laufender AudioContext (null, solange Audio noch nicht freigegeben ist). */
  get context(): AudioContext | null {
    return this.ctx && this.ctx.state === 'running' ? this.ctx : null;
  }

  /** Eingang für Hintergrundgeräusche (Wind, Brandung, Tiere). */
  get ambienceBus(): GainNode | null {
    return this.ambience;
  }

  /** 1 s weißes Rauschen – Rohmaterial für Effekte und Ambiente. */
  get noiseBuffer(): AudioBuffer | null {
    return this.noise1s;
  }

  /** Lautstärken setzen (0..1); wirkt sofort, auch bevor Audio freigegeben ist. */
  setVolumes(master: number, sfx: number, ambience: number): void {
    this.volume = 0.6 * master;
    this.sfxVolume = sfx;
    this.ambienceVolume = 0.8 * ambience;
    const t = this.ctx?.currentTime ?? 0;
    this.master?.gain.setTargetAtTime(this.volume, t, 0.05);
    this.sfx?.gain.setTargetAtTime(this.sfxVolume, t, 0.05);
    this.ambience?.gain.setTargetAtTime(this.ambienceVolume, t, 0.05);
  }

  /** Startet bzw. reaktiviert den AudioContext (muss aus einer User-Geste kommen). */
  resume(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return; // kein Audio verfügbar (z. B. Headless-Tests)
      }
      const ctx = this.ctx;
      this.underwaterFilter = ctx.createBiquadFilter();
      this.underwaterFilter.type = 'lowpass';
      this.underwaterFilter.frequency.value = 20000;
      this.underwaterFilter.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.underwaterFilter);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = this.sfxVolume;
      this.sfx.connect(this.master);
      this.ambience = ctx.createGain();
      this.ambience.gain.value = this.ambienceVolume;
      this.ambience.connect(this.master);
      // 1 s weißes Rauschen als Rohmaterial für alle perkussiven Sounds.
      this.noise1s = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise1s.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /**
   * Position und Blickrichtung des Hörers (Kamera) – jedes Frame setzen.
   */
  setListener(pos: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }): void {
    const ctx = this.context;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      // Ältere Implementierungen (Firefox) kennen nur die Methoden-API.
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  /** Kopf unter Wasser: alles dumpf (Tiefpass auf dem Master). */
  setUnderwater(on: boolean): void {
    const ctx = this.context;
    if (!ctx || !this.underwaterFilter || on === this.underwater) return;
    this.underwater = on;
    this.underwaterFilter.frequency.setTargetAtTime(on ? 550 : 20000, ctx.currentTime, 0.08);
  }

  /** Erzeugt einen räumlichen Ausgang an `pos` (für eigene Klänge, z. B. Vogelrufe). */
  createSpatialOutput(pos: { x: number; y: number; z: number }, bus: 'sfx' | 'ambience' = 'sfx'): AudioNode | null {
    const ctx = this.context;
    const target = bus === 'sfx' ? this.sfx : this.ambience;
    if (!ctx || !target) return null;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 4;
    panner.maxDistance = 120;
    panner.rolloffFactor = 1.1;
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;
    panner.connect(target);
    return panner;
  }

  /**
   * Spielt einen Effekt.
   * @param opts Lautstärkefaktor oder Optionen (Lautstärke, Weltposition für 3D-Klang).
   */
  play(id: SoundId, opts: number | PlayOptions = 1): void {
    const ctx = this.context;
    const volume = typeof opts === 'number' ? opts : (opts.volume ?? 1);
    const position = typeof opts === 'number' ? undefined : opts.position;
    if (!ctx || !this.sfx || volume <= 0.01) return;
    const t = ctx.currentTime;
    const pitch = 0.9 + Math.random() * 0.2;
    this.out = ctx.createGain();
    this.out.gain.value = volume;
    const destination = position ? this.createSpatialOutput(position) : this.sfx;
    this.out.connect(destination!);
    if (position) {
      // Längster Effekt ≈ 1,2 s – danach Knoten lösen, damit der Audio-Graph nicht wächst.
      const out = this.out;
      setTimeout(() => {
        out.disconnect();
        destination!.disconnect();
      }, 2500);
    }

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
      case 'land':
        this.noise(t, 0.18, 'lowpass', 400, 0.8, 0.9);
        this.tone(t, 'sine', 80, 45, 0.18, 0.6);
        break;
      // Schritte: kurze, gefilterte Rauschimpulse – Farbe und Länge je Untergrund.
      case 'stepGrass':
        this.noise(t, 0.09, 'bandpass', 2200 * pitch, 0.9, 0.35);
        this.noise(t + 0.02, 0.06, 'lowpass', 500, 0.7, 0.25);
        break;
      case 'stepSand':
        this.noise(t, 0.13, 'highpass', 2800 * pitch, 0.5, 0.22);
        this.noise(t, 0.08, 'lowpass', 350, 0.7, 0.2);
        break;
      case 'stepRock':
        this.noise(t, 0.035, 'bandpass', 3200 * pitch, 1.5, 0.4);
        this.tone(t, 'triangle', 380 * pitch, 260, 0.04, 0.12);
        break;
      case 'stepWood':
        this.tone(t, 'sine', 170 * pitch, 110, 0.09, 0.45);
        this.noise(t, 0.05, 'bandpass', 900, 1.4, 0.3);
        break;
      case 'stepWater':
        this.noise(t, 0.22, 'bandpass', 1300 * pitch, 0.7, 0.45, 600);
        this.tone(t + 0.02, 'sine', 500 * pitch, 900, 0.06, 0.12);
        break;
      // Tiere
      case 'hoof':
        this.tone(t, 'sine', 120 * pitch, 70, 0.07, 0.4);
        this.noise(t, 0.05, 'bandpass', 1100 * pitch, 1.2, 0.25);
        break;
      case 'deerAlarm':
        // Schrecken des Rehwilds: kurzes, heiseres "Bellen", zweimal.
        for (const dt of [0, 0.42]) {
          this.tone(t + dt, 'sawtooth', 820 * pitch, 430, 0.22, 0.3, 1900);
          this.noise(t + dt, 0.2, 'bandpass', 1300, 2, 0.25);
        }
        break;
      case 'throw':
        this.noise(t, 0.35, 'bandpass', 500, 1.2, 0.45, 1800);
        break;
      case 'sizzle':
        this.noise(t, 0.9, 'highpass', 4200 * pitch, 0.4, 0.18);
        break;
      // Donner: langes, tiefes Grollen; nah zusätzlich ein trockener Knall.
      case 'thunderNear':
        this.noise(t, 0.35, 'highpass', 900, 0.5, 0.9);
        this.noise(t + 0.05, 1.2, 'lowpass', 1200, 0.6, 0.7, 200);
        this.rumble(t, pitch);
        break;
      case 'thunder':
        this.rumble(t, pitch);
        break;
      // Bogen: Sehne schnellt (tiefer Zupfton + Luftzug), Spannen knarzt leise.
      case 'bowShot':
        this.tone(t, 'triangle', 190 * pitch, 120, 0.18, 0.5, 1600);
        this.noise(t, 0.25, 'bandpass', 900, 1, 0.25, 2600);
        break;
      case 'bowDraw':
        this.tone(t, 'sawtooth', 120 * pitch, 160, 0.5, 0.05, 600);
        break;
      // Holztor: Knarren (langsamer Ton-Sweep) und dumpfer Anschlag.
      case 'door':
        this.tone(t, 'sawtooth', 150 * pitch, 95, 0.45, 0.16, 700);
        this.noise(t + 0.4, 0.12, 'lowpass', 500, 1, 0.5);
        break;
    }
  }

  /** Grollen des Donners (zwei überlagerte, tiefe Rauschwellen). */
  private rumble(t: number, pitch: number): void {
    this.noise(t, 5, 'lowpass', 260 * pitch, 0.8, 0.9, 60);
    this.noise(t + 0.4 + Math.random() * 0.5, 3.2, 'lowpass', 160 * pitch, 0.9, 0.7, 50);
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
    src.buffer = this.noise1s;
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
