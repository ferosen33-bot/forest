import * as THREE from 'three';
import { SkyDome } from '../world/SkyDome';
import { clamp, lerp, smoothstep } from '../utils/math';

/** Farbsatz für einen Tageszeit-Zustand. */
interface Palette {
  zenith: THREE.Color;
  horizon: THREE.Color;
  fog: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
}

const palette = (zenith: number, horizon: number, fog: number, hemiSky: number, hemiGround: number): Palette => ({
  zenith: new THREE.Color(zenith),
  horizon: new THREE.Color(horizon),
  fog: new THREE.Color(fog),
  hemiSky: new THREE.Color(hemiSky),
  hemiGround: new THREE.Color(hemiGround),
});

const NIGHT = palette(0x05091a, 0x0e1626, 0x0b121e, 0x3d4f7c, 0x14181f);
const DAY = palette(0x4677ad, 0xa9bdc6, 0x98abb0, 0xc6d8e8, 0x4a4330);
const DUSK = palette(0x343a6c, 0xd38b5d, 0x9c7a66, 0xd8a483, 0x3a2c22);

const SUN_DAY = new THREE.Color(0xfff1da);
const SUN_DUSK = new THREE.Color(0xff8e45);
const MOON = new THREE.Color(0x8da6dc);
const UNDERWATER = new THREE.Color(0x0b3a46);

export interface DayNightOptions {
  dayLength: number;
  startHour: number;
  shadowMapSize: number;
  shadowRange: number;
}

/**
 * Tag/Nacht-Zyklus: bewegt Sonne und Mond, mischt Himmels-, Nebel- und
 * Umgebungslicht-Farben und lässt die Schattenkamera dem Spieler folgen.
 */
export class DayNightCycle {
  readonly sky = new SkyDome(400);
  readonly light: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;

  /** Uhrzeit in Stunden [0, 24). */
  hour: number;
  day = 1;
  /** Zeitraffer-Faktor (Debug). */
  timeScale = 1;

  private readonly sunDir = new THREE.Vector3();
  private readonly moonDir = new THREE.Vector3();
  private readonly lightView = new THREE.Matrix4();
  private readonly lightViewInv = new THREE.Matrix4();
  private readonly snapped = new THREE.Vector3();
  private readonly texelSize: number;
  private static readonly ORIGIN = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(
    scene: THREE.Scene,
    private readonly opts: DayNightOptions,
  ) {
    this.hour = opts.startHour;

    this.fog = new THREE.FogExp2(DAY.fog.getHex(), 0.01);
    scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, 1);
    scene.add(this.hemi);

    this.light = new THREE.DirectionalLight(SUN_DAY, 3);
    this.light.castShadow = true;
    const s = this.light.shadow;
    s.mapSize.set(opts.shadowMapSize, opts.shadowMapSize);
    s.camera.left = -opts.shadowRange;
    s.camera.right = opts.shadowRange;
    s.camera.top = opts.shadowRange;
    s.camera.bottom = -opts.shadowRange;
    s.camera.near = 1;
    s.camera.far = 500;
    s.bias = -0.0004;
    s.normalBias = 0.05;
    s.camera.updateProjectionMatrix();
    this.texelSize = (opts.shadowRange * 2) / opts.shadowMapSize;
    scene.add(this.light, this.light.target);

    scene.add(this.sky.mesh);
  }

  /** Sonnenhöhe als Sinus des Sonnenwinkels: 1 = Zenit, 0 = Horizont, <0 = Nacht. */
  get sunElevation(): number {
    return this.sunDir.y;
  }

  get isNight(): boolean {
    return this.sunDir.y < -0.05;
  }

  /** Formatierte Uhrzeit, z. B. "Tag 2 · 06:45". */
  get clockText(): string {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `Tag ${this.day} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Ist es spät genug zum Schlafen (abends oder nachts)? */
  get isSleepTime(): boolean {
    return this.hour >= 19 || this.hour < 5;
  }

  /** Springt vorwärts zur angegebenen Uhrzeit (über Mitternacht → nächster Tag). */
  skipTo(hour: number): void {
    if (hour <= this.hour) this.day++;
    this.hour = hour;
  }

  /**
   * @param focus Position, um die herum Schatten berechnet werden (Spieler).
   * @param underwater Kamera ist unter Wasser → dichter, blaugrüner Nebel.
   */
  update(dt: number, elapsed: number, focus: THREE.Vector3, underwater: boolean): void {
    this.hour += (dt * this.timeScale * 24) / this.opts.dayLength;
    if (this.hour >= 24) {
      this.hour -= 24;
      this.day++;
    }

    // Sonnenbahn: Aufgang 6 Uhr im Osten (+X), Zenit 12 Uhr, Untergang 18 Uhr.
    const angle = ((this.hour - 6) / 24) * Math.PI * 2;
    this.sunDir.set(Math.cos(angle), Math.sin(angle), 0.35).normalize();
    const e = this.sunDir.y;

    // Mischfaktoren
    const dayT = smoothstep(-0.08, 0.3, e);
    const duskT = 1 - smoothstep(0, 0.32, Math.abs(e - 0.03));
    // Umgebungslicht folgt einer längeren Dämmerungskurve: Nach Sonnenuntergang ist der
    // Himmel noch hell, also soll auch die Szene nicht schlagartig schwarz werden.
    const ambientT = smoothstep(-0.22, 0.12, e);
    this.blendPalette(dayT, duskT * 0.85, ambientT);

    // Richtungslicht: tagsüber Sonne, nachts Mond (Wechsel bei Intensität ≈ 0 am Horizont).
    const sunUp = e > -0.02;
    this.moonDir.copy(this.sunDir).negate();
    const lightDir = sunUp ? this.sunDir : this.moonDir;
    if (sunUp) {
      this.light.intensity = 3.2 * smoothstep(-0.02, 0.15, e);
      this.light.color.copy(SUN_DAY).lerp(SUN_DUSK, duskT);
    } else {
      this.light.intensity = 0.75 * smoothstep(-0.02, 0.2, -e);
      this.light.color.copy(MOON);
    }
    // Umgebungslicht: nachts gedämpft, aber lesbar (Silhouetten sollen erkennbar bleiben).
    this.hemi.intensity = lerp(0.75, 1.15, ambientT);

    // Nebel: tagsüber lichter, nachts dichter, morgens Bodennebel.
    const morningMist = smoothstep(4.5, 6.5, this.hour) * (1 - smoothstep(7, 9.5, this.hour));
    let density = 0.0085 + (1 - dayT) * 0.008 + morningMist * 0.014;
    if (underwater) {
      density = 0.085;
      this.fog.color.lerp(UNDERWATER, 0.85);
    }
    this.fog.density = density;

    // Himmel
    const u = this.sky.uniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uSunColor.value.copy(SUN_DAY).lerp(SUN_DUSK, duskT);
    u.uSunVisible.value = smoothstep(-0.05, 0.02, e);
    u.uNight.value = 1 - smoothstep(-0.2, 0.05, e);
    u.uHorizonFog.value = 0.12 + morningMist * 0.12 + (underwater ? 1 : 0);
    // Three.js mischt Nebel im Ausgabe-Farbraum (sRGB) – die Kuppel muss dasselbe tun.
    u.uFogColor.value.copy(this.fog.color).convertLinearToSRGB();
    u.uTime.value = elapsed;
    this.sky.follow(focus);

    this.updateShadowCamera(lightDir, focus);
  }

  private blendPalette(dayT: number, duskT: number, ambientT: number): void {
    const mix = (key: keyof Palette, target: THREE.Color, t: number) => {
      target.copy(NIGHT[key]).lerp(DAY[key], t).lerp(DUSK[key], duskT);
    };
    mix('zenith', this.sky.uniforms.uZenith.value, dayT);
    mix('horizon', this.sky.uniforms.uHorizon.value, dayT);
    mix('fog', this.fog.color, dayT);
    mix('hemiSky', this.hemi.color, ambientT);
    mix('hemiGround', this.hemi.groundColor, ambientT);
  }

  /**
   * Positioniert Licht und Schattenkamera um den Fokuspunkt. Der Mittelpunkt wird im
   * Licht-Raum auf das Shadow-Map-Texelraster gerundet – das verhindert flimmernde
   * Schattenkanten, wenn sich der Spieler bewegt.
   */
  private updateShadowCamera(dir: THREE.Vector3, focus: THREE.Vector3): void {
    this.lightView.lookAt(dir, DayNightCycle.ORIGIN, DayNightCycle.UP);
    this.lightViewInv.copy(this.lightView).invert();

    const p = this.snapped.copy(focus).applyMatrix4(this.lightViewInv);
    p.x = Math.round(p.x / this.texelSize) * this.texelSize;
    p.y = Math.round(p.y / this.texelSize) * this.texelSize;
    p.applyMatrix4(this.lightView);

    this.light.target.position.copy(p);
    this.light.position.copy(p).addScaledVector(dir, 200);
    this.light.target.updateMatrixWorld();
  }

  /** Sonnenstand normalisiert in [0, 1] für UI-Zwecke. */
  get daylight(): number {
    return clamp(smoothstep(-0.08, 0.3, this.sunDir.y), 0, 1);
  }
}
