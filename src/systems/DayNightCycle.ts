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
/** Fiebernacht: blutroter Himmel, rötlicher Nebel und Mond. */
const FEVER_SKY = new THREE.Color(0x3a0705);
const FEVER_HORIZON = new THREE.Color(0x7a1a0e);
const FEVER_FOG = new THREE.Color(0x2a0806);
const FEVER_MOON = new THREE.Color(0xff5a3a);
/** Höhle: fast schwarz, kaum Restlicht (Fackel nötig). */
const CAVE_FOG = new THREE.Color(0x040506);
const CAVE_SKY = new THREE.Color(0x2a313b);
const CAVE_GROUND = new THREE.Color(0x0c0b0a);
/** Grauer Himmel bei geschlossener Wolkendecke (Tag bzw. Nacht). */
const OVERCAST_DAY = new THREE.Color(0x6f7880);
const OVERCAST_NIGHT = new THREE.Color(0x0a0d12);
const CLOUD_LIT = new THREE.Color(0xf2efe8);
const CLOUD_DUSK = new THREE.Color(0xe8a07a);
const CLOUD_SHADE_DAY = new THREE.Color(0x5d646c);
const CLOUD_NIGHT = new THREE.Color(0x141820);

/** Wetter-Einfluss auf Licht, Himmel und Nebel. */
export interface WeatherLook {
  clouds: number;
  rain: number;
  wind: number;
  flash: number;
}

const CALM: WeatherLook = { clouds: 0.15, rain: 0, wind: 0.3, flash: 0 };

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
  /** true, wenn in ein lineares HDR-Target gerendert wird (Post-Processing aktiv). */
  linearOutput = false;
  /** 1 = in einer Höhle: Sonne/Mond aus, kaum Umgebungslicht, dichter dunkler Nebel. */
  underground = 0;
  /** 1 = Fiebernacht: roter Himmel, roter Mond (vom Spiel weich ein- und ausgeblendet). */
  fever = 0;

  private readonly sunDir = new THREE.Vector3();
  private readonly moonDir = new THREE.Vector3();
  private readonly lightView = new THREE.Matrix4();
  private readonly lightViewInv = new THREE.Matrix4();
  private readonly snapped = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private weather: WeatherLook = CALM;
  private texelSize: number;
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
  update(dt: number, elapsed: number, focus: THREE.Vector3, underwater: boolean, weather: WeatherLook = CALM): void {
    this.weather = weather;
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
    // Bedeckter Himmel: Farben vergrauen, Abendrot verblasst.
    const overcast = smoothstep(0.35, 1, weather.clouds) * 0.85;
    if (overcast > 0) {
      const grey = this.tmpColor.copy(OVERCAST_NIGHT).lerp(OVERCAST_DAY, ambientT);
      const u0 = this.sky.uniforms;
      u0.uZenith.value.lerp(grey, overcast);
      u0.uHorizon.value.lerp(grey, overcast * 0.9);
      this.fog.color.lerp(grey, overcast * 0.8);
      this.hemi.color.lerp(grey, overcast * 0.5);
    }

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
    // Wolken schlucken das direkte Licht – die Szene wird weicher und flacher.
    this.light.intensity *= 1 - 0.8 * smoothstep(0.3, 1, weather.clouds);
    // Umgebungslicht: nachts gedämpft, aber lesbar (Silhouetten sollen erkennbar bleiben).
    this.hemi.intensity = lerp(0.75, 1.15, ambientT) * (1 - 0.2 * weather.clouds) + weather.flash * 2.5;

    // Nebel: tagsüber lichter, nachts dichter, morgens Bodennebel.
    const morningMist = smoothstep(4.5, 6.5, this.hour) * (1 - smoothstep(7, 9.5, this.hour));
    let density = 0.0085 + (1 - dayT) * 0.008 + morningMist * 0.014 + weather.rain * 0.012 + weather.clouds * 0.0015;
    if (underwater) {
      density = 0.085;
      this.fog.color.lerp(UNDERWATER, 0.85);
    }
    const fever = this.fever * (1 - ambientT);
    if (fever > 0) {
      this.sky.uniforms.uZenith.value.lerp(FEVER_SKY, fever);
      this.sky.uniforms.uHorizon.value.lerp(FEVER_HORIZON, fever);
      this.fog.color.lerp(FEVER_FOG, fever);
      this.hemi.color.lerp(FEVER_HORIZON, fever * 0.6);
      if (!sunUp) {
        this.light.color.lerp(FEVER_MOON, fever);
        this.light.intensity *= 1 + 0.6 * fever;
      }
    }
    const cave = this.underground;
    if (cave > 0) {
      this.light.intensity *= 1 - cave;
      this.hemi.intensity = lerp(this.hemi.intensity, 0.4, cave);
      this.hemi.color.lerp(CAVE_SKY, cave);
      this.hemi.groundColor.lerp(CAVE_GROUND, cave);
      this.fog.color.lerp(CAVE_FOG, cave);
      density = lerp(density, 0.06, cave);
    }
    this.fog.density = density;

    // Himmel
    const u = this.sky.uniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uSunColor.value.copy(SUN_DAY).lerp(SUN_DUSK, duskT);
    u.uSunVisible.value = smoothstep(-0.05, 0.02, e) * (1 - 0.9 * smoothstep(0.4, 0.95, weather.clouds));
    u.uClouds.value = weather.clouds;
    u.uFlash.value = weather.flash;
    u.uCloudLit.value.copy(CLOUD_NIGHT).lerp(CLOUD_LIT, ambientT).lerp(CLOUD_DUSK, duskT * 0.6 * (1 - overcast));
    u.uCloudShade.value.copy(CLOUD_NIGHT).lerp(CLOUD_SHADE_DAY, ambientT);
    if (overcast > 0) u.uCloudLit.value.lerp(u.uCloudShade.value, overcast * 0.5);
    // Wolken ziehen mit dem Wind.
    u.uCloudOffset.value.x += dt * (0.004 + weather.wind * 0.012);
    u.uCloudOffset.value.y += dt * (0.0015 + weather.wind * 0.004);
    u.uNight.value = 1 - smoothstep(-0.2, 0.05, e);
    u.uHorizonFog.value = 0.12 + morningMist * 0.12 + (underwater ? 1 : 0);
    // Three.js mischt Nebel im Farbraum des Render-Ziels: Bildschirm = sRGB, HDR-Target = linear.
    // Die Kuppel muss dasselbe tun, sonst passt der Horizont nicht zum vernebelten Gelände.
    u.uFogColor.value.copy(this.fog.color);
    if (!this.linearOutput) u.uFogColor.value.convertLinearToSRGB();
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

  /** Schatten-Auflösung ändern (Grafikstufe); die Shadow-Map wird beim nächsten Rendern neu angelegt. */
  setShadowMapSize(size: number): void {
    const s = this.light.shadow;
    if (s.mapSize.x === size) return;
    s.mapSize.set(size, size);
    s.map?.dispose();
    s.map = null;
    this.texelSize = (this.opts.shadowRange * 2) / size;
  }

  /** Richtung zur aktuellen Lichtquelle (Sonne oder Mond). */
  lightDirection(out: THREE.Vector3): THREE.Vector3 {
    return out.subVectors(this.light.position, this.light.target.position).normalize();
  }

  /**
   * Stärke der Lichtstrahlen: am kräftigsten bei tief stehender Sonne und Morgennebel,
   * mittags schwächer, nachts nur ein Hauch Mondlicht.
   */
  get rayStrength(): number {
    const e = this.sunDir.y;
    const fog = THREE.MathUtils.clamp((this.fog.density - 0.0085) / 0.014, 0, 1);
    const clear = 1 - smoothstep(0.35, 0.9, this.weather.clouds);
    if (this.underground > 0) return 0;
    if (e > -0.02) return 0.6 * smoothstep(-0.02, 0.1, e) * (1 - 0.55 * smoothstep(0.3, 0.9, e)) * (1 + 0.9 * fog) * clear;
    return 0.1 * smoothstep(0.05, 0.3, -e) * clear;
  }

  /** Sonnenstand normalisiert in [0, 1] für UI-Zwecke. */
  get daylight(): number {
    return clamp(smoothstep(-0.08, 0.3, this.sunDir.y), 0, 1);
  }
}
