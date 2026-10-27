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
  | 'wolfHowl'
  | 'wolfGrowl'
  | 'wolfBite'
  | 'glassBreak'
  | 'shriek'
  | 'slam'
  | 'fireWhoosh'
  | 'rattle'
  | 'radioStatic'
  | 'pitFall'
  | 'throw'
  | 'sizzle'
  | 'zap'
  | 'kick'
  | 'sever'
  | 'crush'
  | 'stomp'
  | 'parry'
  | 'dodge'
  | 'heavySwing'
  | 'acidHiss'
  | 'vaporBlast'
  | 'thunder'
  | 'thunderNear'
  | 'door'
  | 'bowShot'
  | 'bowDraw'
  | 'cast'
  | 'splash'
  | 'reel'
  | 'drip'
  | 'heartbeat'
  | 'whisper'
  | 'knock'
  | 'twig'
  | 'plane'
  | 'drum';

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
      // Längster Effekt ≈ 1,2 s (Heulen ≈ 4 s) – danach Knoten lösen, damit der Audio-Graph nicht wächst.
      const out = this.out;
      setTimeout(
        () => {
          out.disconnect();
          destination!.disconnect();
        },
        id === 'wolfHowl' || id === 'shriek' ? 5500 : 2500,
      );
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
      // Wolf: langgezogenes Heulen – steigt an, hält mit leichtem Vibrato und fällt am Ende ab.
      case 'wolfHowl':
        this.howl(t, pitch);
        break;
      // Knurren: tiefes, rasselndes Grollen (schnelle Lautstärke-Schwankung über Rauschen).
      case 'wolfGrowl':
        this.tone(t, 'sawtooth', 95 * pitch, 80, 0.9, 0.22, 420);
        for (let i = 0; i < 9; i++) this.noise(t + i * 0.09, 0.08, 'bandpass', 260 + Math.random() * 120, 3, 0.22);
        break;
      // Biss: Zähne schnappen zusammen.
      case 'wolfBite':
        this.noise(t, 0.04, 'highpass', 2200, 0.8, 0.9);
        this.tone(t, 'square', 320 * pitch, 140, 0.06, 0.18, 1800);
        this.noise(t + 0.03, 0.15, 'bandpass', 600, 1.2, 0.35);
        break;
      // Schreierin: hoher, kreischender Schrei, der sich überschlägt und lange nachhallt.
      case 'shriek':
        this.tone(t, 'sawtooth', 900 * pitch, 1500, 0.5, 0.35, 4200);
        this.tone(t + 0.45, 'sawtooth', 1500 * pitch, 700, 1.6, 0.32, 3800);
        this.tone(t + 0.05, 'square', 1210 * pitch, 980, 1.9, 0.1, 3000);
        this.noise(t, 2.0, 'bandpass', 2600, 1.8, 0.35, 1400);
        break;
      // Bodenstampfer: dumpfer Schlag, Fels knirscht, Staub rieselt.
      case 'slam':
        this.tone(t, 'sine', 55, 28, 0.9, 1.0);
        this.noise(t, 0.6, 'lowpass', 350, 0.8, 1.0, 90);
        for (let i = 0; i < 6; i++) this.noise(t + 0.2 + Math.random() * 0.6, 0.05, 'highpass', 2400, 0.8, 0.25);
        break;
      // Glas zerspringt: heller Knall, klirrende Scherben.
      case 'glassBreak':
        this.noise(t, 0.05, 'highpass', 3500, 0.7, 1.0);
        for (let i = 0; i < 6; i++) this.tone(t + 0.02 + Math.random() * 0.15, 'sine', 2600 + Math.random() * 2600, 1800, 0.06, 0.12);
        break;
      // Öl fängt Feuer: dumpfes Fauchen, das anschwillt.
      case 'fireWhoosh':
        this.noise(t, 1.1, 'lowpass', 300, 0.8, 0.9, 1600);
        this.tone(t, 'sine', 70, 45, 0.6, 0.5);
        break;
      // Klapperleine: Knochen und Steine schlagen aneinander.
      // Funkrauschen mit Knacksern und einem kurzen Pfeifton.
      case 'radioStatic':
        this.noise(t, 1.4, 'bandpass', 2200, 0.6, 0.35);
        for (let i = 0; i < 5; i++) this.noise(t + Math.random() * 1.2, 0.03, 'highpass', 3000, 1, 0.4);
        this.tone(t + 0.3, 'sine', 1400, 900, 0.4, 0.06);
        break;
      case 'rattle':
        for (let i = 0; i < 10; i++) {
          const at = t + i * 0.06 + Math.random() * 0.04;
          this.tone(at, 'triangle', 700 + Math.random() * 900, 400, 0.05, 0.25, 2600);
          this.noise(at, 0.03, 'bandpass', 1800 + Math.random() * 800, 2, 0.3);
        }
        break;
      // Zweige brechen, ein Körper stürzt auf Pfähle.
      case 'pitFall':
        for (let i = 0; i < 4; i++) this.noise(t + i * 0.04, 0.05, 'bandpass', 1600, 2.5, 0.6);
        this.noise(t + 0.15, 0.3, 'lowpass', 500, 0.8, 1.0);
        this.tone(t + 0.15, 'sine', 90, 40, 0.3, 0.8);
        break;
      case 'throw':
        this.noise(t, 0.35, 'bandpass', 500, 1.2, 0.45, 1800);
        break;
      case 'sizzle':
        this.noise(t, 0.9, 'highpass', 4200 * pitch, 0.4, 0.18);
        break;
      // Abgetrennt: nasser Schnitt, dann ein trockenes Knacken.
      case 'sever':
        this.noise(t, 0.14, 'bandpass', 1400 * pitch, 0.9, 0.8, 500);
        this.noise(t + 0.06, 0.05, 'highpass', 2600, 0.8, 0.7);
        this.tone(t + 0.06, 'square', 240 * pitch, 90, 0.05, 0.35, 1400);
        this.noise(t + 0.1, 0.4, 'lowpass', 700, 0.8, 0.35);
        break;
      // Schädel zertrümmert: dumpfer Schlag mit splitterndem Knirschen.
      case 'crush':
        this.noise(t, 0.1, 'lowpass', 450, 0.8, 1.0);
        this.tone(t, 'sine', 70, 30, 0.22, 1.0);
        for (let i = 0; i < 8; i++) this.noise(t + Math.random() * 0.14, 0.025, 'bandpass', 1500 + Math.random() * 2000, 2, 0.55);
        this.noise(t + 0.08, 0.5, 'lowpass', 600, 0.9, 0.4);
        break;
      // Tritt: dumpfer Aufprall eines Stiefels.
      case 'kick':
        this.noise(t, 0.09, 'lowpass', 600, 0.9, 1.0);
        this.tone(t, 'sine', 120, 50, 0.16, 0.9);
        break;
      // Bodenstampfer: Knirschen und ein schwerer, nasser Schlag.
      case 'stomp':
        this.noise(t, 0.12, 'lowpass', 500, 0.8, 1.0);
        this.tone(t, 'sine', 90, 35, 0.25, 1.0);
        for (let i = 0; i < 5; i++) this.noise(t + 0.02 + Math.random() * 0.1, 0.03, 'bandpass', 1800 + Math.random() * 1200, 2, 0.5);
        break;
      // Parade: Metall auf Holz, ein heller, nachklingender Ton.
      case 'parry':
        this.noise(t, 0.05, 'highpass', 2500, 0.6, 0.9);
        this.tone(t, 'triangle', 1250 * pitch, 1180, 0.45, 0.35);
        this.tone(t, 'sine', 2480 * pitch, 2400, 0.3, 0.18);
        break;
      // Ausweichen: kurzer Luftzug und Schritte im Laub.
      case 'dodge':
        this.noise(t, 0.22, 'bandpass', 700, 0.8, 0.45, 1600);
        this.noise(t + 0.12, 0.06, 'lowpass', 900, 1, 0.4);
        break;
      // Schwerer Schlag: tiefer, langer Luftzug.
      case 'heavySwing':
        this.noise(t, 0.42, 'bandpass', 380, 1.1, 0.8, 900);
        break;
      // Stromschlag: brummender Lichtbogen mit trockenem Knistern.
      case 'zap':
        this.tone(t, 'square', 95 * pitch, 70, 0.35, 0.18, 2400);
        this.tone(t, 'sawtooth', 2400 * pitch, 900, 0.12, 0.08, 6000);
        for (let i = 0; i < 7; i++) this.noise(t + Math.random() * 0.3, 0.015 + Math.random() * 0.02, 'highpass', 3000 + Math.random() * 3000, 0.7, 0.55);
        break;
      // Säure frisst sich in Haut: blubberndes Zischen.
      case 'acidHiss':
        this.noise(t, 0.7, 'bandpass', 2600 * pitch, 0.6, 0.3);
        for (let i = 0; i < 4; i++) this.tone(t + Math.random() * 0.5, 'sine', 500 + Math.random() * 400, 900, 0.05, 0.1);
        break;
      // Säure verpufft im Feuer: dumpfer Schlag und fauchende Stichflamme.
      case 'vaporBlast':
        this.noise(t, 0.12, 'lowpass', 900, 0.6, 1.0);
        this.tone(t, 'sine', 80, 30, 0.45, 1.0);
        this.noise(t + 0.03, 0.9, 'lowpass', 500, 0.7, 0.8, 2400);
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
      // Angel: Rute zischt durch die Luft, Schnur surrt von der Rolle.
      case 'cast':
        this.noise(t, 0.3, 'bandpass', 700, 1.4, 0.4, 2600);
        this.tone(t + 0.12, 'sawtooth', 1400, 900, 0.45, 0.035, 3000);
        break;
      // Schwimmer taucht unter / Köder schlägt auf: kurzes "Plopp" mit Spritzer.
      case 'splash':
        this.tone(t, 'sine', 380 * pitch, 140, 0.12, 0.45);
        this.noise(t + 0.02, 0.3, 'bandpass', 1600 * pitch, 0.8, 0.45, 700);
        break;
      // Einholen: schnelles Klicken der Rolle.
      case 'reel':
        for (let i = 0; i < 10; i++) this.noise(t + i * 0.045, 0.018, 'highpass', 3200, 1, 0.22);
        break;
      // Wassertropfen in der Höhle: heller, fallender "Plink" mit kurzem Nachhall.
      case 'drip':
        this.tone(t, 'sine', 1900 * pitch, 900, 0.07, 0.3);
        this.tone(t + 0.09, 'sine', 1500 * pitch, 800, 0.12, 0.08);
        break;
      // Herzschlag: zwei dumpfe Schläge ("ba-bumm").
      case 'heartbeat':
        this.tone(t, 'sine', 62, 38, 0.16, 0.9);
        this.tone(t + 0.19, 'sine', 55, 34, 0.2, 0.65);
        break;
      // Flüstern: zischelndes Rauschen mit wanderndem Formant, in kurzen Silben.
      case 'whisper':
        for (let i = 0; i < 5; i++) {
          const at = t + i * 0.17 + Math.random() * 0.05;
          this.noise(at, 0.16, 'bandpass', 2200 + Math.random() * 1400, 3.5, 0.22, 1300 + Math.random() * 800);
        }
        this.noise(t, 1.0, 'highpass', 5200, 0.7, 0.06);
        break;
      // Klopfen: Holz auf Holz, trocken und hohl.
      case 'knock':
        this.tone(t, 'triangle', 210 * pitch, 140, 0.09, 0.8, 900);
        this.noise(t, 0.06, 'bandpass', 650, 1.6, 0.7);
        break;
      // Ein Ast knackt unter einem Fuß.
      case 'twig':
        this.noise(t, 0.03, 'highpass', 2600, 0.8, 0.9);
        this.noise(t + 0.035, 0.05, 'bandpass', 1500, 2, 0.6);
        this.tone(t, 'square', 900 * pitch, 260, 0.04, 0.12, 2500);
        break;
      // Propellerflugzeug: tiefes, schwebendes Brummen (wird alle 1,4 s neu angesetzt, überlappend).
      case 'plane':
        this.tone(t, 'sawtooth', 58, 54, 2.2, 0.16, 380);
        this.tone(t, 'sawtooth', 87, 84, 2.2, 0.08, 520);
        this.noise(t, 2.0, 'lowpass', 420, 0.6, 0.25);
        break;
      // Ritualtrommel: dumpfer Schlag mit Fell-Rauschen.
      case 'drum':
        this.tone(t, 'sine', 95 * pitch, 48, 0.42, 0.9);
        this.noise(t, 0.12, 'lowpass', 900, 0.8, 0.4);
        break;
      // Holztor: Knarren (langsamer Ton-Sweep) und dumpfer Anschlag.
      case 'door':
        this.tone(t, 'sawtooth', 150 * pitch, 95, 0.45, 0.16, 700);
        this.noise(t + 0.4, 0.12, 'lowpass', 500, 1, 0.5);
        break;
    }
  }

  /** Wolfsgeheul: ein Ton mit Formantfilter, Gleiten und Vibrato. */
  private howl(t: number, pitch: number): void {
    const ctx = this.ctx!;
    const base = 330 * pitch;
    const dur = 3.6 + Math.random() * 0.8;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base * 0.72, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.18, t + 0.6);
    osc.frequency.setValueAtTime(base * 1.18, t + dur * 0.62);
    osc.frequency.exponentialRampToValueAtTime(base * 0.62, t + dur);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.2;
    const depth = ctx.createGain();
    depth.gain.value = base * 0.012;
    vibrato.connect(depth).connect(osc.frequency);
    // Zwei Formanten wie bei einem offenen „u“: dumpf und klagend.
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 520;
    f1.Q.value = 2.5;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'lowpass';
    f2.frequency.value = 1400;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.5, t + 0.45);
    env.gain.setValueAtTime(0.5, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(f1).connect(f2).connect(env).connect(this.out!);
    // Etwas Atem dazu.
    this.noise(t, dur, 'bandpass', 900, 1.5, 0.05);
    osc.start(t);
    vibrato.start(t);
    osc.stop(t + dur + 0.05);
    vibrato.stop(t + dur + 0.05);
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
