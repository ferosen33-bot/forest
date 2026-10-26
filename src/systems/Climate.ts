import * as THREE from 'three';
import { surfaceUniforms } from '../world/SurfaceTextures';
import type { EventBus } from '../core/EventBus';
import type { Physics } from '../core/Physics';
import type { Player } from '../entities/Player';
import type { World } from '../world/World';
import { Rain } from '../world/Rain';
import type { BuildingSystem, Structure } from './building/BuildingSystem';
import type { Audio } from './Audio';
import type { GameConfig } from '../config';
import { Weather, type Lightning } from './Weather';
import type { WeatherLook } from './DayNightCycle';
import { deriveSeed, mulberry32 } from '../utils/random';
import { clamp } from '../utils/math';
import { seasonAt, type SeasonState } from './Seasons';
import { seasonUniforms } from '../world/SeasonShader';

export interface ClimateDeps {
  physics: Physics;
  player: Player;
  world: World;
  building: BuildingSystem;
  audio: Audio;
  events: EventBus;
  config: GameConfig;
}

export interface ClimateFrame {
  dt: number;
  elapsed: number;
  camera: THREE.Vector3;
  daylight: number;
  isNight: boolean;
  /** Walddichte um den Spieler (Kronen halten einen Teil des Regens ab). */
  forest: number;
  /** Spieler hält eine (leere) Schale in der Hand. */
  holdingBowl: boolean;
  /** Kalendertag (ab 1) und Uhrzeit – bestimmen die Jahreszeit. */
  day: number;
  hour: number;
  /** In einer Höhle: kein Niederschlag, gleichmäßig kühl statt eisig. */
  underground?: boolean;
}

/** Sekunden ungeschützter Starkregen, bis ein Lagerfeuer erlischt. */
const FIRE_RAIN_TIME = 45;
/** Sekunden im Regen, bis eine gehaltene Schale voll ist. */
const BOWL_FILL_TIME = 25;

/**
 * Verbindet das Wetter mit der Spielwelt: Regen-Darstellung, Nässe des Spielers (Dach und
 * Baumkronen schützen, Feuer trocknet), vom Regen gelöschte Lagerfeuer, nasser Boden,
 * Wind in Bäumen und Gras, Blitz und Donner sowie Regenwasser für die Schale.
 */
export class Climate {
  readonly weather: Weather;
  readonly rain = new Rain();
  /** Spieler steht unter einem Dach. */
  sheltered = false;
  /** Talent Feuerhüter: Feuer halten dem Regen länger stand. */
  fireRainFactor = 1;
  /** Feuchtigkeit des Bodens (folgt dem Regen verzögert). */
  groundWet = 0;
  /** Fortschritt beim Befüllen der Schale im Regen (0..1); 1 = voll → vom Spiel umgewandelt. */
  bowlFill = 0;
  /** Aktuelle Jahreszeit (überblendet). */
  season: SeasonState = seasonAt(1, 8);

  private shelterTimer = 0;
  private blizzardWarned = false;
  private tracksHinted = false;
  private readonly fireRain = new WeakMap<Structure, number>();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly d: ClimateDeps) {
    this.weather = new Weather(mulberry32(deriveSeed(d.config.seed, 'weather') ^ (Date.now() & 0xffff)));
    this.weather.onThunder = (l) => this.thunder(l);
  }

  /** Werte für Licht, Himmel und Nebel. */
  get look(): WeatherLook {
    const w = this.weather;
    return { clouds: w.clouds, rain: w.rain, wind: w.wind, flash: w.flash };
  }

  /** Schneesturm (0..1): Sturm, während Niederschlag als Schnee fällt. */
  get blizzard(): number {
    return this.season.snowfall * this.weather.storm;
  }

  /** Name des Wetters, im Winter mit Schnee statt Regen. */
  get weatherName(): string {
    const w = this.weather;
    if (this.season.snowfall > 0.5) {
      if (w.phase === 'storm') return 'Schneesturm';
      if (w.phase === 'rain') return 'Schneefall';
    }
    return w.name;
  }

  /** Wie stark der Regen den Spieler gerade trifft (0..1) – Schnee durchnässt deutlich weniger. */
  exposure(forest: number): number {
    if (this.sheltered) return 0;
    return this.weather.rain * (1 - 0.5 * forest) * (1 - 0.6 * this.season.snowfall);
  }

  update(f: ClimateFrame): void {
    const { dt } = f;
    const w = this.weather;
    w.update(dt);
    this.applySeason(f);
    const player = this.d.player;
    const stats = player.stats;

    // Dach über dem Kopf? (alle 0,25 s ein Strahl nach oben)
    this.shelterTimer -= dt;
    if (this.shelterTimer <= 0) {
      this.shelterTimer = 0.25;
      // Ab Hüfthöhe prüfen: unter dem Pultdach hockt man oft niedriger als die Kamera stehen würde.
      this.sheltered = f.underground || this.roofAbove(this.tmp.copy(player.position).setY(player.position.y + 0.7));
    }
    // Höhlen haben ihr eigenes, ausgeglichenes Klima.
    if (f.underground) stats.chill = this.season.chill * 0.35;

    // Nässe: Regen und Schwimmen machen nass, Feuer und trockene Luft trocknen.
    const cfg = this.d.config.stats;
    const exposure = this.exposure(f.forest);
    if (player.swimming || player.headUnderwater) stats.wetness = 1;
    else if (exposure > 0.05) stats.wetness = Math.min(1, stats.wetness + (exposure * dt) / cfg.wetTime);
    else if (stats.warm) stats.wetness = Math.max(0, stats.wetness - dt / cfg.dryTimeFire);
    else stats.wetness = Math.max(0, stats.wetness - dt / cfg.dryTimeAir);
    stats.night = f.isNight;

    // Regenwasser sammeln
    if (f.holdingBowl && exposure > 0.2) this.bowlFill = Math.min(1, this.bowlFill + (exposure * dt) / BOWL_FILL_TIME);
    else if (!f.holdingBowl) this.bowlFill = 0;

    this.updateFires(dt);

    // Boden wird nass und dunkel, trocknet langsamer, als er nass wird.
    this.groundWet += clamp(w.rain - this.groundWet, -dt / 240, dt / 50);
    // Dunkel, glänzend und Pfützen übernimmt der Oberflächen-Shader (gilt für Gelände, Felsen, Rinde, Häuser).
    surfaceUniforms.uSurfWet.value = f.underground ? 0 : this.groundWet * (1 - this.season.snowfall);

    this.d.world.vegetation.setWind(w.wind);
    this.d.world.grass?.setWind(w.wind);

    const brightness = clamp(f.daylight * 0.85 + 0.15 + w.flash, 0, 1.5);
    this.rain.update(f.elapsed, f.camera, player.headUnderwater || f.underground ? 0 : w.rain, w.wind, brightness, this.season.snowfall);
  }

  /** Jahreszeit: Laub, Schnee, Gras, Kälte und Beeren. */
  private applySeason(f: ClimateFrame): void {
    const s = (this.season = seasonAt(f.day, f.hour));
    // Hinweise: erster tiefer Schnee, aufziehender Schneesturm.
    if (!this.tracksHinted && s.snow > 0.55) {
      this.tracksHinted = true;
      this.d.events.emit('hud:message', { text: 'Im Schnee bleiben Spuren – deine und die der Tiere. Auch die der Wölfe.' });
    }
    const blizzard = this.blizzard;
    if (!this.blizzardWarned && blizzard > 0.4) {
      this.blizzardWarned = true;
      this.d.events.emit('hud:message', { text: 'Ein Schneesturm! Such Schutz am Feuer – die Wölfe werden dreist.' });
    } else if (blizzard < 0.05) {
      this.blizzardWarned = false;
    }
    const u = seasonUniforms;
    u.uAutumn.value = s.autumn;
    u.uBare.value = s.bare;
    u.uFresh.value = s.fresh;
    u.uSnow.value = s.snow;
    u.uSnowLine.value = this.d.world.heightMap.waterLevel + 0.8;
    this.d.world.grass?.setSeason(s.grass, s.snow);
    this.d.world.vegetation.berriesAvailable = s.snow < 0.4;
    // Im Schneesturm beißt die Kälte auch am Tag.
    this.d.player.stats.chill = s.chill + 0.35 * this.blizzard;
    this.weather.lightningEnabled = s.snowfall < 0.5;
  }

  /** Ungeschützte Lagerfeuer gehen bei anhaltendem Starkregen aus. */
  private updateFires(dt: number): void {
    const rain = this.weather.rain;
    for (const s of this.d.building.structures) {
      if (!s.lit || !s.def.flame) continue;
      let t = this.fireRain.get(s) ?? 0;
      if (rain > 0.45 && !this.roofAbove(this.tmp.copy(s.position).setY(s.position.y + Math.max(1, s.def.flame.height + 0.3)))) t += dt * rain * (1 - 0.5 * this.season.snowfall);
      else t = Math.max(0, t - dt);
      if (t > FIRE_RAIN_TIME * this.fireRainFactor) {
        t = 0;
        this.d.building.setLit(s, false);
        if (s.position.distanceTo(this.d.player.position) < 60) {
          this.d.events.emit('hud:message', {
            text: s.def.flame.warmth
              ? 'Der Regen hat ein Lagerfeuer gelöscht. Ein Unterstand darüber schützt es.'
              : 'Der Regen hat eine Standfackel gelöscht.',
          });
        }
      }
      this.fireRain.set(s, t);
    }
  }

  /** Strahl nach oben: trifft er ein Bauwerk (Dach), ist man geschützt. */
  roofAbove(from: THREE.Vector3): boolean {
    // Sensoren (Büsche, Äste, Köpfe) überspringen – sie halten keinen Regen ab.
    const hit = this.d.physics.raycast(from, this.up, 8, this.d.player.collisionShape, true);
    return !!hit && !!this.d.building.getByCollider(hit.collider);
  }

  private thunder(l: Lightning): void {
    const volume = clamp(1.25 - l.distance / 1600, 0.25, 1);
    this.d.audio.play(l.distance < 450 ? 'thunderNear' : 'thunder', { volume });
  }
}
