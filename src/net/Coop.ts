import * as THREE from 'three';
import type { Physics } from '../core/Physics';
import type { EventBus } from '../core/EventBus';
import type { Player } from '../entities/Player';
import type { CharacterLibrary } from '../entities/characters/CharacterLibrary';
import { Enemy } from '../entities/enemies/Enemy';
import type { EnemyDirector } from '../systems/ai/EnemyDirector';
import type { DayNightCycle } from '../systems/DayNightCycle';
import type { Weather } from '../systems/Weather';
import type { Audio } from '../systems/Audio';
import type { ItemId } from '../entities/items/ItemDefs';
import { cleanName, type NetMessage, type PlayerState } from './Protocol';
import { Session, type Transport } from './Session';
import { PeerTransport } from './PeerTransport';
import { RemotePlayer } from './RemotePlayers';

/**
 * Koop (Meilenstein 61): zu zweit (bis zu viert) auf derselben Insel.
 *
 * - Wer die Lobby eröffnet, ist Gastgeber: Bei ihm denken die Gegner, laufen Tageszeit und Wetter.
 *   Jeder Gegner nimmt sich den nächsten Spieler vor.
 * - Mitspieler sehen dieselben Gegner (Abbilder), schlagen sie, und der Gastgeber verrechnet es.
 *   Treffen Gegner einen Mitspieler, meldet der Gastgeber den Schaden.
 * - Jeder behält sein eigenes Inventar, seinen Spielstand und seine Fundstücke.
 */

export interface CoopDeps {
  scene: THREE.Scene;
  physics: Physics;
  characters: CharacterLibrary | null;
  player: Player;
  camera: THREE.Camera;
  tools: { readonly equipped: { id: ItemId } | null; readonly swings: number };
  enemies: EnemyDirector;
  dayNight: DayNightCycle;
  weather: Weather;
  events: EventBus;
  audio: Audio;
  seed: number;
  inCave: () => boolean;
  heightAt: (x: number, z: number) => number;
  /** Vermittlung (Standard: PeerJS über den öffentlichen Server). */
  transport?: Transport;
}

const STATE_INTERVAL = 1 / 15;
const ENEMY_INTERVAL = 0.1;
const WORLD_INTERVAL = 2;
/** Gegner in diesem Umkreis um einen Mitspieler werden ihm gemeldet. */
const ENEMY_RADIUS = 170;
const NAME_KEY = 'wildwood.name';

export class Coop {
  readonly session: Session;
  readonly group = new THREE.Group();
  private readonly remotes = new Map<string, RemotePlayer>();
  private stateTimer = 0;
  private enemyTimer = 0;
  private worldTimer = 0;
  private shots = 0;
  private lastTick = 0;
  /** Mitspieler: einmal neben den Gastgeber stellen, sobald seine Position bekannt ist. */
  private placed = false;
  private lastPlayers: PlayerState[] = [];
  name: string;
  /** Statuszeile (Menü). */
  onStatus: ((text: string) => void) | null = null;

  constructor(private readonly d: CoopDeps) {
    this.group.name = 'Koop';
    d.scene.add(this.group);
    const server = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('peer') : null;
    this.session = new Session(d.transport ?? new PeerTransport(server));
    this.name = readName();
    this.session.onStatus = (t) => this.onStatus?.(t);
    this.session.onNotice = (t) => d.events.emit('hud:message', { text: t });
    this.session.onMessage = (m, from) => this.handle(m, from);
    this.session.onLeave = (id) => this.dropRemote(id);
    d.events.on('gun:fired', () => this.shots++);
  }

  get active(): boolean {
    return this.session.active;
  }

  get isHost(): boolean {
    return this.session.isHost;
  }

  get isClient(): boolean {
    return this.session.role === 'client';
  }

  get code(): string | null {
    return this.session.code;
  }

  /** Namen aller anderen in der Lobby (für die Anzeige). */
  get others(): PlayerState[] {
    return [...this.remotes.values()].map((r) => r.state);
  }

  setName(name: string): void {
    this.name = cleanName(name);
    try {
      localStorage.setItem(NAME_KEY, this.name);
    } catch {
      /* egal */
    }
  }

  /** Lobby eröffnen. @returns Code. */
  host(): Promise<string> {
    return this.session.host(this.name, this.d.seed);
  }

  /**
   * Lobby beitreten.
   * @returns 'ok' oder – wenn der Gastgeber auf einer anderen Insel spielt – deren Seed (dann muss die
   *   Welt mit diesem Seed neu geladen werden).
   */
  async join(code: string): Promise<'ok' | number> {
    const seed = await this.session.join(code, this.name);
    if (seed !== this.d.seed) {
      this.session.leave();
      return seed;
    }
    this.d.enemies.becomePuppet();
    Enemy.relay = (e, hit) => this.session.send({ t: 'hit', enemy: e.id, hit });
    this.placed = false;
    return 'ok';
  }

  leave(): void {
    this.session.leave();
    this.afterLeave();
  }

  private afterLeave(): void {
    for (const id of [...this.remotes.keys()]) this.dropRemote(id);
    if (Enemy.relay) {
      Enemy.relay = null;
      // Wieder allein: Die Abbilder verschwinden, die Lager füllen sich mit der Zeit von selbst.
      this.d.enemies.applyNet([]);
      this.d.enemies.puppetMode = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Takt
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    if (!this.active) {
      if (this.remotes.size || Enemy.relay) this.afterLeave();
      return;
    }
    // Gesendet wird nach echter Zeit: Die Spielzeit steht bei Trefferstopps fast still und ist je Bild gedeckelt.
    const now = performance.now();
    const real = this.lastTick ? Math.min((now - this.lastTick) / 1000, 1) : dt;
    this.lastTick = now;
    const s = this.session;
    this.stateTimer -= real;
    if (this.stateTimer <= 0) {
      this.stateTimer = STATE_INTERVAL;
      const own = this.ownState();
      if (s.isHost) {
        const list = [own, ...s.guestStates()];
        s.broadcast({ t: 'players', list });
        this.applyPlayers(s.guestStates());
      } else s.send({ t: 'state', s: own });
    }
    if (s.isHost) {
      s.prune();
      this.enemyTimer -= real;
      if (this.enemyTimer <= 0) {
        this.enemyTimer = ENEMY_INTERVAL;
        for (const g of s.guestStates()) {
          const at = new THREE.Vector3(...g.p);
          s.sendTo(g.id, { t: 'enemies', list: this.d.enemies.snapshotsNear(at, ENEMY_RADIUS) });
        }
      }
      this.worldTimer -= real;
      if (this.worldTimer <= 0) {
        this.worldTimer = WORLD_INTERVAL;
        s.broadcast({ t: 'world', day: this.d.dayNight.day, hour: this.d.dayNight.hour, weather: this.d.weather.serialize() });
      }
    }
    for (const r of this.remotes.values()) r.update(dt, this.d.camera);
  }

  private ownState(): PlayerState {
    const p = this.d.player;
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      id: this.session.myId,
      name: this.isHost ? this.session.hostName : this.name,
      p: [r(p.position.x), r(p.position.y), r(p.position.z)],
      yaw: r(p.yaw),
      pitch: r(p.pitch),
      speed: r(Math.hypot(p.velocity.x, p.velocity.z)),
      crouch: p.crouching,
      item: this.d.tools.equipped?.id ?? null,
      swings: this.d.tools.swings + this.shots,
      hp: r(p.stats.health / p.stats.max),
      dead: p.stats.isDead,
      hidden: this.d.inCave(),
    };
  }

  // ---------------------------------------------------------------------------
  // Nachrichten
  // ---------------------------------------------------------------------------

  private handle(m: NetMessage, from: string): void {
    const d = this.d;
    if (this.isHost) {
      if (m.t === 'hit') {
        const killed = d.enemies.applyRemoteHit(m.enemy, m.hit, from);
        if (killed) {
          const f = killed.feet;
          this.session.sendTo(from, { t: 'kill', enemy: killed.id, name: killed.kind.name, boss: !!killed.kind.boss, p: [f.x, f.y, f.z], headshot: false });
        }
      }
      return;
    }
    switch (m.t) {
      case 'players': {
        const others = m.list.filter((p) => p.id !== this.session.myId);
        this.applyPlayers(others);
        // Beim Beitreten neben den Gastgeber stellen.
        const host = others.find((p) => p.id === 'host');
        if (!this.placed && host) {
          this.placed = true;
          const a = host.yaw + Math.PI / 2;
          const x = host.p[0] - Math.sin(a) * 2.5;
          const z = host.p[2] - Math.cos(a) * 2.5;
          const at = new THREE.Vector3(x, Math.max(d.heightAt(x, z), host.p[1]) + 0.2, z);
          d.player.spawn(at, host.yaw);
          d.events.emit('hud:message', { text: `Du bist bei ${host.name}.` });
        }
        break;
      }
      case 'world': {
        const diff = Math.abs(m.hour - d.dayNight.hour);
        if (m.day !== d.dayNight.day || Math.min(diff, 24 - diff) > 0.02) {
          d.dayNight.day = m.day;
          d.dayNight.hour = m.hour;
        }
        d.weather.load(m.weather);
        break;
      }
      case 'enemies':
        d.enemies.applyNet(m.list);
        break;
      case 'hurt': {
        const from3 = new THREE.Vector3(...m.from);
        const outcome = d.player.receiveHit(m.amount, from3);
        if (outcome === 'hit' || outcome === 'blocked') d.audio.play('hurt');
        break;
      }
      case 'kill': {
        // Eigener Treffer hat ihn erledigt: Tagebuch, Fertigkeiten und Beute wie allein.
        const at = new THREE.Vector3(...m.p);
        d.events.emit('enemy:hit', { health: 0, maxHealth: 1, killed: true, headshot: m.headshot, sneak: false, name: m.name });
        d.events.emit('enemy:killed', { position: at, boss: m.boss });
        break;
      }
      case 'notice':
        d.events.emit('hud:message', { text: m.text });
        break;
    }
  }

  /** Figuren anlegen, bewegen und entfernen. */
  private applyPlayers(list: PlayerState[]): void {
    this.lastPlayers = list;
    const seen = new Set<string>();
    for (const s of list) {
      seen.add(s.id);
      let r = this.remotes.get(s.id);
      if (!r) {
        r = new RemotePlayer(s, this.remotes.size + (this.isHost ? 0 : 1), this.d.physics, this.d.characters, (amount, from) => {
          this.session.sendTo(s.id, { t: 'hurt', amount: Math.round(amount * 10) / 10, from: [from.x, from.y, from.z] });
        });
        this.remotes.set(s.id, r);
        this.group.add(r.group);
        if (this.isHost) this.d.enemies.remoteTargets.set(s.id, r.asTarget);
      }
      r.apply(s);
    }
    // Mitspieler: wer nicht mehr in der Liste steht, ist gegangen.
    if (!this.isHost) for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.dropRemote(id);
  }

  private dropRemote(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    r.dispose();
    this.remotes.delete(id);
    this.d.enemies.remoteTargets.delete(id);
  }

  /** Für Tests und die Karte: zuletzt bekannte Mitspieler. */
  get players(): readonly PlayerState[] {
    return this.lastPlayers;
  }
}

function readName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return cleanName(saved);
  } catch {
    /* kein Speicher */
  }
  return `Überlebender ${Math.floor(Math.random() * 90 + 10)}`;
}
