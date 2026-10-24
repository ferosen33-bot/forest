import * as THREE from 'three';
import { CONFIG, type GameConfig } from '../config';
import { EventBus } from './EventBus';
import { Input } from './Input';
import { Physics } from './Physics';
import { World } from '../world/World';
import { DayNightCycle } from '../systems/DayNightCycle';
import { Player } from '../entities/Player';
import { ViewModel } from '../entities/ViewModel';
import { WorldItems } from '../entities/items/WorldItems';
import { getItem } from '../entities/items/ItemDefs';
import { Inventory } from '../systems/Inventory';
import { ItemService } from '../systems/ItemService';
import { HarvestSystem } from '../systems/HarvestSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import { ToolController } from '../systems/ToolController';
import { Particles } from '../systems/Particles';
import { Audio } from '../systems/Audio';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { InventoryUI } from '../ui/InventoryUI';
import { renderIcons } from '../ui/ItemIcons';
import type { BuildHint } from '../ui/HUD';
import { Crafting, recipeName, type Recipe } from '../systems/Crafting';
import { BuildingSystem, type Structure } from '../systems/building/BuildingSystem';
import { LightPool, type LightRequest } from '../systems/LightPool';
import { EnemyDirector } from '../systems/ai/EnemyDirector';
import { AnimalDirector } from '../systems/AnimalDirector';
import { Projectiles } from '../systems/Projectiles';
import { Cooking } from '../systems/Cooking';
import { Climate } from '../systems/Climate';
import { Fishing, FishTraps } from '../systems/Fishing';
import { Caves, type CaveTarget } from '../systems/Caves';
import { Settlement } from '../systems/Settlement';
import { townWorld } from '../world/Town';
import { SaveStore, SAVE_VERSION, worldKey, type SaveData } from '../systems/SaveGame';
import { QUALITY, SettingsStore, type Settings } from '../systems/Settings';
import { SettingsUI } from '../ui/SettingsUI';
import { Exploration } from '../systems/Exploration';
import { MapUI } from '../ui/MapUI';
import { Compass } from '../ui/Compass';
import { CHAPTERS, Journal } from '../systems/Journal';
import { JournalUI } from '../ui/JournalUI';
import { NoteUI } from '../ui/NoteUI';
import { SkillsUI } from '../ui/SkillsUI';
import { getSkill, Skills, wireSkillEvents } from '../systems/Skills';
import { Fear } from '../systems/Fear';
import { Horror } from '../systems/Horror';
import { feverLabel, feverNumber, feverPhase, waveInterval, waveSize, type FeverPhase } from '../systems/FeverNight';
import type { ItemId } from '../entities/items/ItemDefs';
import { WorldEvents } from '../systems/WorldEvents';
import { Survivors, type NpcDef } from '../systems/Survivors';
import { Quests } from '../systems/Quests';
import { DialogueUI } from '../ui/DialogueUI';
import { isStructureId } from '../systems/building/StructureDefs';
import { isItemId } from '../entities/items/ItemDefs';
import { Ambience } from '../systems/Ambience';
import { Footsteps } from '../systems/Footsteps';
import { PostFX } from '../systems/PostFX';
import { filmLook, type Look } from '../systems/FilmLook';
import { environmentIntensity, loadForestEnvironment } from '../world/Environment';
import { loadSurfaceTextures } from '../world/SurfaceTextures';
import { loadRockModels } from '../world/RockModels';
import { loadItemModels } from '../entities/items/ItemModels';
import { CharacterLibrary } from '../entities/characters/CharacterLibrary';
import { FirstPersonArm } from '../entities/characters/FirstPersonArm';
import { AnimalModels } from '../entities/animals/AnimalAvatars';

export interface GameOptions {
  container: HTMLElement;
  hudRoot: HTMLElement;
  menuRoot: HTMLElement;
  inventoryRoot: HTMLElement;
  config?: GameConfig;
  /** Startet ohne Menü/Pointer Lock (für Tests & Screenshots). */
  autostart?: boolean;
  /** Vorhandenen Spielstand laden (Standard: ja). */
  loadSave?: boolean;
}

/** Abstand zwischen automatischen Speicherungen (Sekunden Spielzeit). */
const AUTOSAVE_INTERVAL = 90;

/**
 * Spielzustand:
 * - `playing`   Pointer Lock aktiv, volle Steuerung
 * - `inventory` Inventar offen, Maus frei; die Welt läuft weiter (wie im Genre üblich)
 * - `paused`    Pausenmenü, Simulation angehalten
 * - `dead`      Todesbildschirm
 */
export type GameMode = 'loading' | 'playing' | 'inventory' | 'paused' | 'dead';

/** Lässt den Browser einen Frame zeichnen (z. B. damit der Ladetext erscheint). */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Zentrale Spielklasse: erzeugt alle Systeme und betreibt den Game Loop.
 *
 * Game Loop: Physik und Spielerbewegung laufen in festen Schritten (60 Hz, Akkumulator-
 * Verfahren), Rendering so schnell wie der Monitor erlaubt. Die Kamera wird zwischen
 * den letzten beiden Physik-Zuständen interpoliert → flüssig auch bei 144 Hz.
 */
export class Game {
  readonly config: GameConfig;
  readonly events = new EventBus();
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly menu: Menu;
  readonly audio = new Audio();
  readonly particles = new Particles();
  /** Leuchtende Partikel (Glut). */
  readonly embers = new Particles(250, true);
  readonly viewModel = new ViewModel();
  readonly inventory = new Inventory(30, 6);
  readonly postFX: PostFX;
  /** Animierte Figuren für Schrate und Überlebende (null = einfache Körper). */
  private characters: CharacterLibrary | null = null;
  /** Filmlook des letzten Bildes (wird jedes Bild wiederverwendet). */
  private look: Look | null = null;
  readonly crafting = new Crafting(this.inventory);
  /** Fertigkeiten (wachsen durch Tun). */
  readonly skills = new Skills(this.events);
  /** Furcht des Spielers und die nächtlichen Schrecken der Insel. */
  readonly fear = new Fear();
  horror!: Horror;
  worldEvents!: WorldEvents;
  /** Die Überlebenden in der Nordbucht (fehlt, wenn die Insel keinen Platz dafür hat). */
  survivors: Survivors | null = null;
  quests!: Quests;
  private dialogueUI!: DialogueUI;
  private heartbeatTimer = 0;
  private fearVignette: HTMLDivElement | null = null;
  private lastFilter = '';
  private feverState: FeverPhase = 'none';
  private feverWaveTimer = 0;
  private feverLook = 0;

  physics!: Physics;
  world!: World;
  dayNight!: DayNightCycle;
  player!: Player;
  worldItems!: WorldItems;
  items!: ItemService;
  harvest!: HarvestSystem;
  interaction!: InteractionSystem;
  tools!: ToolController;
  building!: BuildingSystem;
  lights!: LightPool;
  enemies!: EnemyDirector;
  animals!: AnimalDirector;
  projectiles!: Projectiles;
  cooking!: Cooking;
  climate!: Climate;
  fishing!: Fishing;
  fishTraps!: FishTraps;
  caves!: Caves;
  /** Die verlassene Stadt (null, falls die Insel keinen Bauplatz bot). */
  settlement: Settlement | null = null;
  /** Laufender Übergang in eine Höhle bzw. hinaus (Abblenden, Teleport in der Mitte). */
  private caveTransition: { timer: number; target: CaveTarget; applied: boolean } | null = null;
  ambience!: Ambience;
  footsteps!: Footsteps;
  hud!: HUD;
  inventoryUI!: InventoryUI;

  mode: GameMode = 'loading';
  private accumulator = 0;
  private lastTime = 0;
  private elapsed = 0;
  private fps = 60;
  private physicsMs = 0;
  private readonly tmpDir = new THREE.Vector3();
  /** Hier wacht der Spieler nach dem Tod auf (zuletzt benutzter Unterstand, sonst Spawn). */
  private respawnPoint = new THREE.Vector3();
  /** Restzeit der Schlaf-Überblendung (> 0 = schläft gerade). */
  private sleepTimer = 0;
  private sleepApplied = false;
  saves!: SaveStore;
  private readonly settingsStore = new SettingsStore();
  settings: Settings;
  private settingsUI!: SettingsUI;
  exploration!: Exploration;
  private mapUI!: MapUI;
  private compass!: Compass;
  journal!: Journal;
  private journalUI!: JournalUI;
  private noteUI!: NoteUI;
  private skillsUI!: SkillsUI;
  private stealthTimer = 0;
  /** Wo die offene Notiz gelesen wurde (weggehen legt sie weg). */
  private readonly noteAt = new THREE.Vector3();
  /** Indizes der Lager, die der Spieler schon gesehen hat (Karte). */
  private readonly discoveredCamps = new Set<number>();
  private exploreTimer = 0;
  private autosaveTimer = 0;
  /** Erst speichern, wenn wirklich gespielt wurde (nicht schon im Startmenü) – und nie nach "Neues Spiel". */
  private saveEnabled = false;
  private lastSaved: Date | null = null;
  private readonly rodTip = new THREE.Vector3();
  private readonly torchLight: LightRequest = {
    position: new THREE.Vector3(),
    color: new THREE.Color(),
    intensity: 0,
    distance: 0,
  };
  /** Kegel der Taschenlampe – mit Schattenwurf (Bäume und Gestalten werfen lange Schatten). */
  private readonly flashlight = new THREE.SpotLight(0xf4f1e6, 0, 38, 0.42, 0.6, 1.6);

  private constructor(private readonly opts: GameOptions) {
    this.config = opts.config ?? CONFIG;
    const g = this.config.graphics;
    this.settings = this.settingsStore.load();
    // ?nopost (URL) hat Vorrang vor der gespeicherten Einstellung.
    if (!g.postProcessing) this.settings.postProcessing = false;

    // Mit Nachbearbeitung übernimmt das HDR-Render-Target das Multisampling.
    this.renderer = new THREE.WebGLRenderer({ antialias: !g.postProcessing, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, g.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Zwei Render-Durchgänge pro Frame (Welt + ViewModel) → Statistik manuell zurücksetzen.
    this.renderer.info.autoReset = false;
    opts.container.appendChild(this.renderer.domElement);
    this.postFX = new PostFX(this.renderer);
    this.postFX.enabled = g.postProcessing;

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(this.config.player.fov, aspect, 0.1, g.viewDistance);
    this.viewModel.setAspect(aspect);
    this.scene.add(this.particles.mesh, this.embers.mesh);

    this.input = new Input(this.renderer.domElement);
    this.menu = new Menu(opts.menuRoot);

    window.addEventListener('resize', this.handleResize);
  }

  /** Erzeugt das Spiel asynchron (WASM-Physik laden, Welt generieren, Shader kompilieren). */
  static async create(opts: GameOptions): Promise<Game> {
    const game = new Game(opts);
    await game.init();
    return game;
  }

  private async init(): Promise<void> {
    const cfg = this.config;

    this.menu.setLoading('Physik wird geladen …');
    this.physics = await Physics.create();
    this.physics.timestep = cfg.physics.timestep;

    this.menu.setLoading('Felsen werden geladen …');
    const [rocks] = await Promise.all([
      loadRockModels().catch((e) => {
        console.warn('[Felsen] Modelle fehlen, einfache Formen:', e);
        return [];
      }),
      loadItemModels().catch((e) => console.warn('[Gegenstände] Modelle fehlen, selbstgebaute Formen:', e)),
    ]);
    this.menu.setLoading('Insel wird generiert …');
    await nextFrame();
    this.world = new World(this.scene, this.physics, cfg, rocks);
    this.dayNight = new DayNightCycle(this.scene, {
      dayLength: cfg.time.dayLength,
      startHour: cfg.time.startHour,
      shadowMapSize: cfg.graphics.shadowMapSize,
      shadowRange: cfg.graphics.shadowRange,
    });
    this.dayNight.linearOutput = this.postFX.enabled;

    this.player = new Player(this.physics, this.camera, this.input, this.world.heightMap, this.events, cfg);
    this.player.spawn(this.world.spawnPoint, this.spawnYaw());
    this.respawnPoint.copy(this.world.spawnPoint);

    // Gameplay-Systeme
    this.worldItems = new WorldItems(this.physics);
    this.scene.add(this.worldItems.group);
    this.items = new ItemService(this.inventory, this.worldItems, this.events, this.audio);
    this.harvest = new HarvestSystem(
      this.physics,
      this.world.vegetation,
      this.worldItems,
      this.items,
      this.particles,
      this.audio,
      this.events,
    );
    this.scene.add(this.harvest.group);
    this.lights = new LightPool(this.scene, 4);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.25;
    this.flashlight.shadow.camera.far = 38;
    this.flashlight.shadow.bias = -0.0004;
    this.flashlight.shadow.normalBias = 0.03;
    this.flashlight.visible = false;
    this.scene.add(this.flashlight, this.flashlight.target);
    this.building = new BuildingSystem(
      this.physics,
      this.world.heightMap,
      this.crafting,
      this.worldItems,
      this.particles,
      this.embers,
      this.lights,
      this.audio,
      this.events,
    );
    this.scene.add(this.building.group);
    this.menu.setLoading('Schrate erwachen …');
    await nextFrame();
    const [characters, animalModels] = await Promise.all([
      CharacterLibrary.load().catch((e) => {
        console.warn('[Figuren] Modelle fehlen, einfache Körper:', e);
        return null;
      }),
      AnimalModels.load().catch((e) => {
        console.warn('[Tiere] Modelle fehlen, einfache Körper:', e);
        return null;
      }),
    ]);
    this.characters = characters;
    await FirstPersonArm.load()
      .then((arm) => this.viewModel.setArm(arm))
      .catch((e) => console.warn('[Hand] Modell fehlt, einfacher Arm:', e));
    const tEnemies = performance.now();
    this.enemies = new EnemyDirector({
      characters: this.characters,
      physics: this.physics,
      heightMap: this.world.heightMap,
      vegetation: this.world.vegetation,
      building: this.building,
      player: this.player,
      camera: this.camera,
      particles: this.particles,
      audio: this.audio,
      events: this.events,
      lights: this.lights,
      dayNight: this.dayNight,
      config: cfg,
      spawnPoint: this.world.spawnPoint,
      isPlayerLit: () => !!this.heldLight(),
      isPlayerFire: () => this.tools.equipped?.id === 'torch',
      rain: () => this.climate.weather.rain,
      playerHidden: () => !!this.caves?.current,
      town: this.world.town
        ? (() => {
            const t = this.world.town!;
            const p = townWorld(t, t.plaza.x, t.plaza.z);
            return { center: t.center, radius: t.radius, plaza: new THREE.Vector3(p.x, t.center.y, p.z) };
          })()
        : null,
      harbor: this.world.harbor ? { center: this.world.harbor.center, radius: 30 } : null,
    });
    this.scene.add(this.enemies.group);
    this.ambience = new Ambience(this.audio, this.world.heightMap, this.world.vegetation);
    this.footsteps = new Footsteps(this.audio, this.world.heightMap, this.physics, this.building, this.events);
    this.enemies.onEnemyStep = (pos, speed) => this.footsteps.enemyStep(pos, speed);
    console.info(
      `[Enemies] Navigationsraster + ${this.enemies.camps.length} Lager in ${(performance.now() - tEnemies).toFixed(0)} ms`,
    );
    this.animals = new AnimalDirector({
      models: animalModels,
      physics: this.physics,
      heightMap: this.world.heightMap,
      nav: this.enemies.nav,
      player: this.player,
      particles: this.particles,
      audio: this.audio,
      events: this.events,
      items: this.items,
      config: cfg,
      spawnPoint: this.world.spawnPoint,
      avoid: this.enemies.camps.map((c) => c.center),
      snares: () => this.building.structures.filter((s) => s.def.interaction === 'snare'),
      onSnared: (snare) => {
        const s = this.building.structures.find((x) => x.position === snare.position);
        if (s) this.building.setArmed(s, false);
        if (snare.position.distanceTo(this.player.position) < 120) {
          this.events.emit('hud:message', { text: 'Eine Schlingfalle hat zugeschnappt.' });
        }
      },
    });
    this.scene.add(this.animals.group);
    this.cooking = new Cooking(this.building, this.items, this.audio, this.events);
    this.menu.setLoading('Höhlen werden vermessen …');
    await nextFrame();
    this.caves = new Caves({
      physics: this.physics,
      heightMap: this.world.heightMap,
      vegetation: this.world.vegetation,
      items: this.items,
      particles: this.particles,
      lights: this.lights,
      audio: this.audio,
      events: this.events,
      seed: cfg.seed,
      spawnPoint: this.world.spawnPoint,
      avoid: this.enemies.camps.map((c) => c.center),
      // Keine Höhle in der Stadt (großzügig: Eingang samt Felshügel).
      avoidAreas: [
        ...(this.world.town ? [{ x: this.world.town.center.x, z: this.world.town.center.z, radius: this.world.town.radius + 50 }] : []),
        ...(this.world.harbor ? [{ x: this.world.harbor.center.x, z: this.world.harbor.center.z, radius: 60 }] : []),
      ],
      markObstacle: (x, z, r) => this.enemies.nav.markCircle(x, z, r, 1),
    });
    this.scene.add(this.caves.group);
    if (this.world.town) {
      this.menu.setLoading('Die Stadt wird aufgebaut …');
      await nextFrame();
      this.settlement = new Settlement({
        physics: this.physics,
        town: this.world.town,
        seed: cfg.seed,
        items: this.items,
        audio: this.audio,
        events: this.events,
        markObstacle: (x, z, yaw, hx, hz) => this.enemies.nav.markBox(x, z, yaw, hx, hz, 1),
        markDoor: (door) => this.enemies.nav.markPassage(door.position.x, door.position.z, door.yaw, door.halfX, door.halfZ, 1),
      });
      this.scene.add(this.settlement.group);
      this.footsteps.town = this.settlement;
    }
    this.enemies.onCaveDwellerKilled = (cave, slot) => this.caves.dwellerKilled(cave, slot, this.dayNight.day);
    // Gefallene Horden-Schrate lassen manchmal etwas fallen.
    this.enemies.onHordeKill = (at) => {
      if (Math.random() > 0.35) return;
      const drops: [ItemId, number][] = [['arrow', 2], ['cannedFood', 1], ['painkillers', 1], ['battery', 1], ['flint', 2], ['rawMeat', 1]];
      const [item, count] = drops[Math.floor(Math.random() * drops.length)];
      this.items.drop(item, count, at.clone().setY(at.y + 1));
    };
    this.climate = new Climate({
      physics: this.physics,
      player: this.player,
      world: this.world,
      building: this.building,
      audio: this.audio,
      events: this.events,
      config: cfg,
    });
    this.scene.add(this.climate.rain.mesh);
    this.scene.add(this.cooking.group);
    this.projectiles = new Projectiles({
      physics: this.physics,
      worldItems: this.worldItems,
      enemies: this.enemies,
      animals: this.animals,
      building: this.building,
      audio: this.audio,
      particles: this.particles,
      events: this.events,
      thrower: () => this.player.collisionShape,
      waterLevel: this.world.heightMap.waterLevel,
      groundAt: (x, z) => this.world.heightMap.heightAt(x, z),
      onPlayerHit: (killed, headshot) => this.skills.gain('archery', killed ? 8 : headshot ? 5 : 3),
      hitPlayer: (damage, from) => {
        this.player.receiveHit(damage, from);
        this.audio.play('hurt');
      },
    });
    this.scene.add(this.projectiles.group);
    this.enemies.onThrow = (origin, velocity, damage) => this.projectiles.launch('stone', undefined, damage, origin, velocity, true);
    this.worldEvents = new WorldEvents({
      physics: this.physics,
      heightMap: this.world.heightMap,
      vegetation: this.world.vegetation,
      enemies: this.enemies,
      items: this.items,
      particles: this.particles,
      lights: this.lights,
      audio: this.audio,
      events: this.events,
      avoid: [
        ...this.enemies.camps.map((c) => ({ x: c.center.x, z: c.center.z, radius: 70 })),
        ...(this.world.town ? [{ x: this.world.town.center.x, z: this.world.town.center.z, radius: this.world.town.radius + 30 }] : []),
        ...this.caves.caves.map((c) => ({ x: c.site.position.x, z: c.site.position.z, radius: 25 })),
        ...(this.world.harbor ? [{ x: this.world.harbor.center.x, z: this.world.harbor.center.z, radius: 80 }] : []),
      ],
      showNote: (title, text) => {
        this.noteUI.showText(title, text);
        this.noteAt.copy(this.player.position);
      },
    });
    this.scene.add(this.worldEvents.group);
    this.quests = new Quests(this.events);
    if (this.world.harbor) {
      this.survivors = new Survivors({
        characters: this.characters,
        physics: this.physics,
        layout: this.world.harbor,
        quests: this.quests,
        inventory: this.inventory,
        items: this.items,
        skills: this.skills,
        lights: this.lights,
        audio: this.audio,
        events: this.events,
        markObstacle: (x, z, yaw, hx, hz) => this.enemies.nav.markBox(x, z, yaw, hx, hz, 1),
      });
      this.scene.add(this.survivors.group);
    }
    this.interaction = new InteractionSystem({
      physics: this.physics,
      camera: this.camera,
      player: this.player,
      heightMap: this.world.heightMap,
      vegetation: this.world.vegetation,
      worldItems: this.worldItems,
      harvest: this.harvest,
      building: this.building,
      enemies: this.enemies,
      animals: this.animals,
      cooking: this.cooking,
      caves: this.caves,
      settlement: this.settlement,
      worldEvents: this.worldEvents,
      survivors: this.survivors,
      items: this.items,
      audio: this.audio,
      events: this.events,
      config: cfg,
      onTalk: (npc) => this.talkTo(npc),
      onCave: (target) => this.startCaveTransition(target),
      onReadNote: (id) => this.readNote(id),
      isNoteRead: (id) => this.journal.notes.has(id),
      canSleep: () =>
        this.feverState === 'night'
          ? 'In der Fiebernacht findet niemand Schlaf'
          : this.dayNight.isSleepTime || 'Schlafen erst ab dem Abend',
      onSleep: (shelter) => this.sleep(shelter),
      heldItem: () => this.tools.equipped?.id ?? null,
      takeHeld: () => void this.inventory.takeFromSlot(this.tools.selected, 1),
      openStorage: (s) => this.openStorage(s),
      transformHeld: (to) => {
        if (this.inventory.transform(this.tools.selected, to) > 0) this.items.drop(to, 1, this.player.position);
      },
    });
    this.tools = new ToolController(
      this.inventory,
      this.input,
      this.viewModel,
      this.interaction,
      this.harvest,
      this.building,
      this.enemies,
      this.player,
      this.audio,
      this.events,
      this.animals,
      this.projectiles,
      this.camera,
      this.items,
      this.caves,
      this.skills,
    );
    wireSkillEvents(this.skills, this.events);
    this.fishing = new Fishing({
      heightMap: this.world.heightMap,
      items: this.items,
      particles: this.particles,
      audio: this.audio,
      events: this.events,
      wearRod: () => this.tools.wearEquipped(1),
      playCast: (duration) => this.viewModel.playCast(duration),
      setRod: (out, pull) => this.viewModel.setRod(out, pull),
    });
    this.scene.add(this.fishing.group);
    this.fishTraps = new FishTraps(this.building, this.events);
    this.horror = new Horror(this.audio, this.world.heightMap, this.fear);
    this.scene.add(this.horror.group);
    this.events.on('player:damaged', ({ amount }) => this.fear.scare(0.12 + amount / 60));

    // Tagebuch und Erkundung gehören zum Spielstand – sie müssen vor dem Laden existieren.
    this.journal = new Journal(this.events);
    this.exploration = new Exploration(cfg.world.size);

    // Spielstand fortsetzen – oder neu beginnen mit der Axt aus dem Flugzeugwrack.
    this.saves = new SaveStore(worldKey(cfg.seed, cfg.world.size, cfg.world.cellSize));
    const save = this.opts.loadSave === false ? null : this.saves.load();
    if (save) {
      this.menu.setLoading('Spielstand wird geladen …');
      await nextFrame();
      this.applySave(save);
    } else {
      this.inventory.add('axe', 1);
    }

    // UI (Icons werden aus den 3D-Modellen gerendert)
    const icons = renderIcons();
    this.hud = new HUD(this.opts.hudRoot, this.events, this.inventory, icons.items);
    this.inventoryUI = new InventoryUI(
      this.opts.inventoryRoot,
      this.inventory,
      icons,
      () => this.tools.selected,
      this.crafting,
    );
    this.noteUI = new NoteUI(document.getElementById('note')!);
    this.dialogueUI = new DialogueUI(document.getElementById('dialogue')!);
    this.skillsUI = new SkillsUI(document.getElementById('skills')!, this.skills);
    this.events.on('skill:levelUp', ({ id, level }) => {
      const s = getSkill(id);
      this.audio.play('craft', 0.8);
      this.events.emit('hud:message', { text: `${s.name} – Stufe ${level}: ${s.effect(level)}` });
      if (this.skillsUI.open) this.skillsUI.render();
    });
    this.journalUI = new JournalUI(document.getElementById('journal')!, this.hud.objectivesElement, this.journal, () =>
      this.quests.running.map((q) => {
        const p = this.quests.progress(q.id, this.inventory);
        const ready = this.quests.state(q.id, this.inventory) === 'ready';
        return { title: q.title, task: ready ? `${q.task} – zurückkehren` : p.need > 1 ? `${q.task} (${p.have}/${p.need})` : q.task };
      }),
    );
    this.events.on('journal:completed', ({ text, chapterDone }) => {
      this.audio.play('craft', 0.7);
      this.events.emit('hud:message', { text: `✔ Ziel erreicht: ${text}` });
      if (chapterDone) {
        const next = CHAPTERS[this.journal.currentChapter];
        this.events.emit('hud:message', { text: next ? `Neues Kapitel im Tagebuch (J): ${next.title}` : 'Alle Ziele im Tagebuch erreicht!' });
      }
    });
    this.mapUI = new MapUI(document.getElementById('map')!, this.world.heightMap, this.world.vegetation, this.exploration);
    if (this.world.town) this.mapUI.drawTown(this.world.town);
    this.compass = new Compass(this.hud.compassCanvas);
    this.inventoryUI.onUse = (slot) => this.useSlot(slot);
    this.inventoryUI.onCraft = (recipe) => this.craft(recipe);
    this.inventoryUI.onDrop = (slot) => {
      this.camera.getWorldDirection(this.tmpDir);
      this.items.throwFromSlot(slot, this.camera.position, this.tmpDir);
    };

    // Collider-Positionen einmal synchronisieren, bevor die erste Bewegung berechnet wird.
    this.physics.step();
    this.player.afterPhysicsStep();
    this.player.updateCamera(0, 1);
    this.dayNight.update(0, 0, this.player.position, false);
    this.world.update(0, 0, this.player.position);

    // Gespeicherte Einstellungen vor dem Vorkompilieren anwenden (Schatten, Nachbearbeitung).
    this.applySettings();
    this.menu.setLoading('Shader werden kompiliert …');
    await nextFrame();
    // Umgebungslicht vor dem Kompilieren laden, sonst übersetzt jedes Material seine Shader später noch einmal.
    await Promise.all([
      loadForestEnvironment(this.renderer, this.scene).catch((e) => console.warn('[Env] Umgebungslicht fehlt:', e)),
      loadSurfaceTextures().catch((e) => console.warn('[Texturen] Foto-Texturen fehlen:', e)),
    ]);
    await this.renderer.compileAsync(this.scene, this.camera);

    this.wireEvents();
    this.settingsUI = new SettingsUI(this.menu.settingsContainer, this.settings);
    this.settingsUI.onChange = (s) => this.updateSettings(s);
    if (save) this.events.emit('hud:message', { text: `Willkommen zurück – ${this.dayNight.clockText}.` });
    if (this.opts.autostart) {
      this.saveEnabled = true;
      this.menu.hide();
      this.hud.visible = true;
      this.mode = 'playing';
    } else {
      this.mode = 'paused';
      this.menu.showStart(save ? this.saves.summary() : null);
    }
  }

  // ---------------------------------------------------------------------------
  // Spielstände
  // ---------------------------------------------------------------------------

  /** Sammelt den kompletten Spielzustand ein (reine Daten, JSON-tauglich). */
  collectSave(): SaveData {
    const p = this.player;
    const s = p.stats;
    const cfg = this.config;
    return {
      version: SAVE_VERSION,
      world: worldKey(cfg.seed, cfg.world.size, cfg.world.cellSize),
      savedAt: new Date().toISOString(),
      player: {
        p: [p.position.x, p.position.y, p.position.z],
        yaw: p.yaw,
        pitch: p.pitch,
        health: s.health,
        stamina: s.stamina,
        hunger: s.hunger,
        thirst: s.thirst,
        respawn: [this.respawnPoint.x, this.respawnPoint.y, this.respawnPoint.z],
        selected: this.tools.selected,
        wetness: s.wetness,
        backpack: this.hasBackpack,
        clothing: s.clothing,
        ...(this.caves.current ? { cave: this.caves.current.index } : {}),
      },
      time: { day: this.dayNight.day, hour: this.dayNight.hour },
      inventory: this.inventory.serialize(),
      vegetation: this.world.vegetation.serialize(),
      harvest: this.harvest.serialize(),
      structures: this.building.serialize(),
      cooking: this.cooking.serialize(),
      items: this.worldItems.serialize(),
      enemies: this.enemies.serialize(),
      animals: this.animals.serialize(),
      weather: this.climate.weather.serialize(),
      explored: this.exploration.serialize(),
      camps: [...this.discoveredCamps],
      journal: this.journal.serialize(),
      caves: this.caves.serialize(),
      ...(this.settlement ? { town: this.settlement.serialize() } : {}),
      skills: this.skills.serialize(),
      worldEvents: this.worldEvents.serialize(),
      quests: this.quests.serialize(),
      ...(this.survivors ? { survivors: this.survivors.serialize() } : {}),
    };
  }

  /** Stellt einen Spielstand in der frisch erzeugten Welt wieder her (nur beim Start). */
  private applySave(d: SaveData): void {
    // Erst den Rucksack vergrößern, sonst würden die zusätzlichen Plätze beim Laden abgeschnitten.
    if (d.player.backpack) this.upgradeBackpack();
    this.player.stats.clothing = d.player.clothing === true;
    this.inventory.load(d.inventory, isItemId);
    this.world.vegetation.load(d.vegetation);
    this.harvest.load(d.harvest);
    const structures = this.building.load(d.structures, isStructureId);
    this.cooking.load(d.cooking, structures);
    this.worldItems.load(d.items, isItemId);
    this.enemies.load(d.enemies);
    this.animals.load(d.animals);

    const p = d.player;
    const s = this.player.stats;
    // In einer Höhle gespeichert: Innenraum (samt Kollision) muss vor dem Aufsetzen stehen.
    if (d.caves) this.caves.load(d.caves);
    if (d.town) this.settlement?.load(d.town);
    if (d.skills) this.skills.load(d.skills);
    if (d.worldEvents) this.worldEvents.load(d.worldEvents);
    if (d.quests) this.quests.load(d.quests);
    if (d.survivors) this.survivors?.load(d.survivors);
    const savedAt = new THREE.Vector3(...p.p);
    const cave = (Number.isInteger(p.cave) ? this.caves.caves[p.cave!] : null) ?? this.caves.caveAt(savedAt);
    if (cave) {
      this.caves.build(cave);
      this.caves.current = cave;
    }
    this.applyUnderground();
    this.player.spawn(savedAt, p.yaw);
    this.player.pitch = p.pitch;
    const clampStat = (v: number) => Math.max(0, Math.min(s.max, Number.isFinite(v) ? v : s.max));
    // Wer tot gespeichert hat (sollte nicht vorkommen), wacht mit etwas Leben auf.
    s.health = Math.max(10, clampStat(p.health));
    s.stamina = clampStat(p.stamina);
    s.hunger = clampStat(p.hunger);
    s.thirst = clampStat(p.thirst);
    s.wetness = Math.max(0, Math.min(1, p.wetness ?? 0));
    if (d.weather) this.climate.weather.load(d.weather);
    if (typeof d.explored === 'string') this.exploration.load(d.explored);
    if (d.journal) this.journal.load(d.journal);
    for (const c of d.camps ?? []) if (Number.isInteger(c) && this.enemies.camps[c]) this.discoveredCamps.add(c);
    this.respawnPoint.set(...p.respawn);
    this.tools.select(Math.max(0, Math.min(this.inventory.hotbarSize - 1, p.selected | 0)));
    this.dayNight.day = Math.max(1, d.time.day | 0);
    this.dayNight.hour = ((d.time.hour % 24) + 24) % 24;
    this.lastSaved = new Date(d.savedAt);
    this.populateCave();
  }

  /** Speichert sofort (nicht im Tod oder beim Laden). @returns true bei Erfolg. */
  saveNow(): boolean {
    if (!this.saveEnabled || this.mode === 'loading' || this.mode === 'dead' || this.player.stats.isDead) return false;
    const ok = this.saves.save(this.collectSave());
    if (ok) this.lastSaved = new Date();
    this.autosaveTimer = 0;
    return ok;
  }

  private updateAutosave(dt: number): void {
    if (this.mode !== 'playing' && this.mode !== 'inventory') return;
    this.autosaveTimer += dt;
    // Nicht mitten in einem Baumfall oder Schlaf speichern (Zwischenzustände).
    if (this.autosaveTimer >= AUTOSAVE_INTERVAL && this.harvest.fallingCount === 0 && this.sleepTimer <= 0) this.saveNow();
  }

  /** Blickrichtung beim Spawn: ins Inselinnere (Richtung Zentrum). */
  private spawnYaw(): number {
    const p = this.world.spawnPoint;
    return Math.atan2(p.x, p.z);
  }

  private wireEvents(): void {
    this.menu.onNewGame = () => {
      if (!window.confirm('Den Spielstand verwerfen und eine neue Insel-Expedition beginnen?')) return;
      this.saveEnabled = false;
      this.saves.clear();
      // Frische Welt = Seite neu laden (alle Systeme starten sauber aus dem Seed).
      window.location.reload();
    };
    // Beim Verlassen der Seite (Tab schließen, Neuladen, App-Wechsel) sichern.
    window.addEventListener('pagehide', () => this.saveNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveNow();
    });

    this.menu.onPlay = (wantsFullscreen) => {
      if (this.mode === 'dead') {
        // Aufgewacht wird immer an der Oberfläche.
        this.caves.current = null;
        this.caveTransition = null;
        this.applyUnderground();
        this.enemies.leaveCave();
        this.player.respawn(this.respawnPoint);
        this.enemies.onPlayerRespawn(this.respawnPoint);
      }
      this.audio.resume();
      if (wantsFullscreen) void this.enterFullscreen();
      void this.input.requestLock();
    };

    this.input.onLockChange = (locked) => {
      if (locked) {
        this.saveEnabled = true;
        this.mode = 'playing';
        this.menu.hide();
        this.hud.visible = true;
        this.audio.resume();
        this.lastTime = performance.now();
      } else if (this.mode === 'playing') {
        this.pause();
      }
    };

    this.events.on('player:blocked', () => {
      this.audio.play('block');
      this.viewModel.playHit();
    });

    this.events.on('player:died', ({ cause }) => {
      this.mode = 'dead';
      this.building.cancel();
      this.sleepTimer = 0;
      this.hud.faded = false;
      this.openChest = null;
      this.inventoryUI.hide();
      this.hud.inventoryOpen = false;
      this.input.exitLock();
      this.menu.showDeath(cause);
    });
  }

  private pause(): void {
    this.mode = 'paused';
    this.mapUI.hide();
    this.journalUI.hide();
    this.noteUI.hide();
    this.dialogueUI.hide();
    this.skillsUI.hide();
    this.saveNow();
    this.menu.showPaused(this.lastSaved);
  }

  /** Lagerkiste, deren Inhalt gerade angezeigt wird. */
  private openChest: Structure | null = null;

  private openStorage(s: Structure): void {
    if (!s.storage) return;
    this.building.cancel();
    this.openChest = s;
    this.mode = 'inventory';
    this.inventoryUI.showChest(s.storage, s.def.name);
    this.hud.inventoryOpen = true;
    this.audio.play('door', 0.5);
    this.input.exitLock();
  }

  private openInventory(): void {
    this.mode = 'inventory';
    this.inventoryUI.show();
    this.hud.inventoryOpen = true;
    this.input.exitLock();
  }

  private closeInventory(): void {
    this.openChest = null;
    this.inventoryUI.hide();
    this.hud.inventoryOpen = false;
    this.mode = 'playing';
    // Ohne gültige User-Geste (z. B. Esc) verweigert der Browser den Pointer Lock → Pausenmenü.
    void this.input.requestLock().then((ok) => {
      if (!ok && this.mode === 'playing') this.pause();
    });
  }

  /** Klick auf ein Rezept: Item herstellen bzw. mit dem Bauplan in den Baumodus wechseln. */
  private craft(recipe: Recipe): void {
    if (!this.crafting.canAfford(recipe.cost)) {
      this.audio.play('denied');
      this.events.emit('hud:message', { text: `Material fehlt für: ${recipeName(recipe)}` });
      return;
    }
    if (recipe.kind === 'structure') {
      if (this.caves.current) {
        this.audio.play('denied');
        this.events.emit('hud:message', { text: 'In der Höhle lässt sich nichts errichten.' });
        return;
      }
      this.closeInventory();
      this.building.begin(recipe.result);
      return;
    }
    const rest = this.crafting.craftItem(recipe, this.skills.craftedDurability);
    if (rest === null) return;
    if (rest > 0) this.worldItems.spawn(recipe.result, rest, this.player.position.clone().add(new THREE.Vector3(0, 1, 0)));
    this.audio.play('craft');
    this.events.emit('item:crafted', { item: recipe.result, count: recipe.count });
    this.events.emit('hud:message', { text: `${recipeName(recipe)} hergestellt.` });
  }

  /** Schlafen im Unterstand: abblenden, Zeit auf den Morgen setzen, Aufwachpunkt merken. */
  private sleep(shelter: Structure): void {
    if (!this.dayNight.isSleepTime || this.sleepTimer > 0 || this.feverState === 'night') return;
    this.sleepTimer = 2.4;
    this.sleepApplied = false;
    this.hud.faded = true;
    const front = new THREE.Vector3(0, 0, 1.8).applyAxisAngle(new THREE.Vector3(0, 1, 0), shelter.rotation);
    this.respawnPoint.copy(shelter.position).add(front);
    this.respawnPoint.y = this.world.heightMap.heightAt(this.respawnPoint.x, this.respawnPoint.z);
  }

  private updateSleep(dt: number): void {
    if (this.sleepTimer <= 0) return;
    this.sleepTimer -= dt;
    // In der Mitte der Überblendung (Bildschirm schwarz) wird die Nacht übersprungen.
    if (!this.sleepApplied && this.sleepTimer < 1.2) {
      this.sleepApplied = true;
      this.dayNight.skipTo(6.5);
      const s = this.player.stats;
      s.hunger = Math.max(5, s.hunger - 18);
      s.thirst = Math.max(5, s.thirst - 22);
      s.stamina = s.max;
      s.health = Math.min(s.max, s.health + 25);
      this.hud.faded = false;
      this.events.emit('hud:message', { text: 'Du hast bis zum Morgen geschlafen. Hier wachst du künftig auf.' });
      this.events.emit('player:slept', {});
      this.saveNow();
    }
  }

  /** Fertigkeiten wirken auf den Spieler; Bewegung und Schleichen bringen laufend Erfahrung. */
  private updateSkills(dt: number, playing: boolean): void {
    const p = this.player;
    const sk = this.skills;
    p.stealthNoise = sk.noise;
    p.stealthVisibility = sk.visibility;
    p.stats.needsFactor = sk.needs;
    p.stats.staminaFactor = sk.staminaUse;
    p.stats.regenFactor = sk.staminaRegen;
    if (!playing || p.stats.isDead) return;
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    if (p.sprinting && speed > 3) sk.gain('athletics', 0.3 * dt);
    if (p.swimming && speed > 0.8) sk.gain('athletics', 0.25 * dt);
    // Schleichen: geduckt in Bewegung, ein ahnungsloser Gegner in der Nähe.
    this.stealthTimer -= dt;
    if (this.stealthTimer <= 0) {
      this.stealthTimer = 1;
      if (p.crouching && speed > 0.4) {
        const near = [...this.enemies.enemies, ...this.enemies.caveDwellers].some(
          (e) => !e.isDead && e.unaware && e.feet.distanceTo(p.position) < 18,
        );
        if (near) sk.gain('stealth', 0.8);
      }
    }
  }

  /**
   * Furcht aus Dunkelheit und Bedrohung, ihre Folgen (Farbverlust, dunkler Rand, Herzschlag, langsamere
   * Erholung) und die nächtlichen Schrecken.
   */
  private updateFear(dt: number, playing: boolean): void {
    const p = this.player;
    const inCave = !!this.caves.current;
    const lit = !!this.heldLight() || this.building.structures.some((s) => s.lit && s.position.distanceTo(p.position) < 10);
    let darkness = inCave ? 1 : Math.min(1, 1 - this.dayNight.daylight + 0.25 * this.feverLook);
    if (lit) darkness *= 0.35;
    let threat = 0;
    for (const e of [...this.enemies.enemies, ...this.enemies.caveDwellers]) {
      if (e.isDead) continue;
      const d = e.feet.distanceTo(p.position);
      if (e.isAggressive && d < 22) threat += 0.45;
      else if (d < 9) threat = Math.max(threat, 0.35);
    }
    const resting = p.stats.isDead || this.sleepTimer > 0;
    const fear = this.fear.update({ dt, darkness, threat: Math.min(1, threat), nearFire: p.stats.warm, resting });
    // Große Angst lähmt: Ausdauer erholt sich langsamer.
    p.stats.regenFactor *= 1 - 0.5 * Math.max(0, fear - 0.5);

    this.horror.update({
      dt,
      darkness: inCave ? 1 : darkness / (lit ? 0.35 : 1),
      inCave,
      player: p.position,
      eye: this.camera.position,
      look: this.camera.getWorldDirection(this.tmpDir),
      moving: Math.hypot(p.velocity.x, p.velocity.z) > 1,
      paused: !playing || resting,
    });

    // Herzschlag ab spürbarer Angst – je größer, desto schneller und lauter.
    this.heartbeatTimer -= dt;
    let pulse = 0;
    if (fear > 0.3 && this.heartbeatTimer <= 0 && !resting) {
      this.heartbeatTimer = 1.3 - 0.8 * fear;
      this.audio.play('heartbeat', Math.min(1, (fear - 0.3) * 1.6));
      pulse = 1;
    }
    this.applyFearLook(fear, pulse);
  }

  /** Fiebernacht: Warnung am Abend, roter Himmel, Horden in Wellen, am Morgen vorüber. */
  private updateFever(dt: number): void {
    const day = this.dayNight.day;
    const hour = this.dayNight.hour;
    if (this.hud.debugVisible && this.input.wasPressed('feverDebug')) {
      // Debug: zum nächsten Fiebertag, kurz vor 21 Uhr.
      this.dayNight.day = Math.ceil((day + (feverPhase(day, hour) === 'night' ? 1 : 0)) / 7) * 7 || 7;
      this.dayNight.hour = 20.95;
    }
    const phase = feverPhase(this.dayNight.day, this.dayNight.hour);
    const n = feverNumber(this.dayNight.day, this.dayNight.hour);
    if (phase !== this.feverState) {
      const was = this.feverState;
      this.feverState = phase;
      if (phase === 'warning') {
        this.events.emit('hud:message', { text: 'Der Himmel färbt sich rot … Heute Nacht ist Fiebernacht. Verbarrikadiere dich – oder lauf.' });
        this.audio.play('scream', { volume: 0.6, position: this.player.position.clone().add(new THREE.Vector3(80, 10, 40)) });
      } else if (phase === 'night') {
        this.events.emit('hud:message', { text: `Die ${n}. Fiebernacht beginnt. Sie kommen.` });
        this.enemies.startHorde();
        this.feverWaveTimer = 6;
      }
      if (was === 'night' && phase !== 'night') {
        this.enemies.endHorde();
        this.events.emit('hud:message', { text: 'Die Fiebernacht ist vorüber. Du hast überlebt.' });
        this.events.emit('fever:survived', { number: n });
        this.skills.gain('survival', 15);
      }
    }
    if (phase === 'night' && !this.player.stats.isDead) {
      this.feverWaveTimer -= dt;
      if (this.feverWaveTimer <= 0) {
        this.feverWaveTimer = waveInterval(n);
        // In der Höhle lauern sie am Eingang.
        const around = this.caves.current ? this.caves.current.site.position : this.player.position;
        this.enemies.spawnHorde(waveSize(n), around, n);
      }
    }
    const target = phase === 'night' ? 1 : phase === 'warning' ? 0.35 : 0;
    this.feverLook += (target - this.feverLook) * Math.min(1, dt * 0.3);
    this.dayNight.fever = this.feverLook;
  }

  /** Bild entsättigen, Rand abdunkeln (pulsiert mit dem Herzschlag). */
  private applyFearLook(fear: number, pulse: number): void {
    if (!this.fearVignette) {
      this.fearVignette = document.createElement('div');
      this.fearVignette.className = 'fear-vignette';
      this.opts.hudRoot.prepend(this.fearVignette);
    }
    const v = this.fearVignette;
    const base = Math.max(0, fear - 0.15) * 1.1;
    if (pulse) {
      v.style.transition = 'none';
      v.style.opacity = String(Math.min(1, base + 0.18));
      void v.offsetWidth;
      v.style.transition = 'opacity 0.45s ease-out';
    }
    v.style.opacity = String(Math.min(1, base));
    const filter = fear > 0.05 ? `saturate(${(1 - 0.6 * fear).toFixed(2)}) contrast(${(1 + 0.12 * fear).toFixed(2)})` : '';
    if (filter !== this.lastFilter) {
      this.lastFilter = filter;
      this.renderer.domElement.style.filter = filter;
    }
  }

  /** Notiz lesen: Leseansicht öffnen, beim ersten Mal ins Tagebuch übernehmen. */
  private readNote(id: string): void {
    const first = !this.journal.notes.has(id);
    this.noteUI.show(id);
    this.noteAt.copy(this.player.position);
    this.audio.play('pickup', 0.5);
    this.mapUI.hide();
    this.journalUI.hide();
    this.events.emit('note:read', { id, first });
    if (first) this.events.emit('hud:message', { text: 'Ins Tagebuch übernommen (J).' });
  }

  /** Gespräch mit einem Überlebenden beginnen (Antworten über die Zifferntasten). */
  private talkTo(npc: NpcDef): void {
    if (!this.survivors) return;
    this.noteUI.hide();
    this.mapUI.hide();
    this.journalUI.hide();
    this.dialogueUI.show(this.survivors.talk(npc.id));
    this.noteAt.copy(this.player.position);
  }

  /** Zifferntasten wählen eine Antwort; `E` oder Weggehen beendet das Gespräch. */
  private updateDialogue(playing: boolean): void {
    const ui = this.dialogueUI;
    if (!ui.open || !this.survivors) return;
    if (!playing || this.player.position.distanceTo(this.noteAt) > 4) {
      ui.hide();
      return;
    }
    const keys = ['hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6'] as const;
    const i = keys.findIndex((k) => this.input.wasPressed(k));
    if (i < 0) return;
    const survivors = this.survivors;
    const npc = ui.npc!;
    if (ui.choose(i, () => survivors.options(npc))) survivors.gesture(npc.id);
  }

  /** Höhle betreten oder verlassen: abblenden, in der Dunkelheit umsetzen, aufblenden. */
  private startCaveTransition(target: CaveTarget): void {
    if (this.caveTransition || this.sleepTimer > 0) return;
    this.caveTransition = { timer: 2.3, target, applied: false };
    this.building.cancel();
    this.hud.faded = true;
    this.audio.play('stepRock', 0.6);
  }

  private updateCaveTransition(dt: number): void {
    const t = this.caveTransition;
    if (!t) return;
    t.timer -= dt;
    // Erst umsetzen, wenn der Bildschirm ganz schwarz ist.
    if (!t.applied && t.timer < 1.0) {
      t.applied = true;
      const to = t.target.type === 'entrance' ? this.caves.enter(t.target.cave) : this.caves.leave();
      if (to) {
        this.player.spawn(to.position, to.yaw);
        this.player.pitch = 0;
      }
      this.populateCave();
      this.applyUnderground();
      this.hud.faded = false;
      if (this.caves.current && t.target.type === 'entrance') {
        this.events.emit('hud:message', { text: `${this.caves.current.name} – ohne Licht siehst du hier kaum die Hand vor Augen.` });
      }
    }
    if (t.timer <= 0) this.caveTransition = null;
  }

  /** Bewohner der aktuellen Höhle erscheinen lassen (bzw. entfernen, wenn man draußen ist). */
  private populateCave(): void {
    const cave = this.caves.current;
    if (cave?.nav) this.enemies.enterCave(cave.index, cave.nav, this.caves.dwellerSpawns(cave, this.dayNight.day));
    else this.enemies.leaveCave();
  }

  /** Licht, Oberwelt und Schritte an den Aufenthaltsort (Höhle/Oberfläche) anpassen. */
  private applyUnderground(): void {
    const inCave = !!this.caves.current;
    this.dayNight.underground = inCave ? 1 : 0;
    this.world.setSurfaceVisible(!inCave);
    this.footsteps.cave = inCave;
  }

  /** Rechtsklick im Inventar: Nahrung essen, alles andere in die Hand nehmen. */
  /** Licht des Items in der Hand (Taschenlampe nur mit geladener Batterie). */
  private heldLight(): ReturnType<typeof getItem>['light'] {
    const stack = this.tools.equipped;
    if (!stack) return undefined;
    if (stack.id === 'flashlight' && (stack.durability ?? 0) <= 1) return undefined;
    return getItem(stack.id).light;
  }

  /** Großer Rucksack: zwölf zusätzliche Plätze (einmalig). */
  private hasBackpack = false;

  private upgradeBackpack(): void {
    if (this.hasBackpack) return;
    this.hasBackpack = true;
    this.inventory.grow(12);
  }

  private useSlot(slot: number): void {
    const stack = this.inventory.get(slot);
    if (!stack) return;
    const use = getItem(stack.id).use;
    if (use === 'backpack') {
      if (this.hasBackpack) {
        this.events.emit('hud:message', { text: 'Du trägst schon einen großen Rucksack.' });
        return;
      }
      this.inventory.takeFromSlot(slot, 1);
      this.upgradeBackpack();
      this.audio.play('craft');
      this.events.emit('hud:message', { text: 'Umgepackt: zwölf Plätze mehr im Rucksack.' });
      return;
    }
    if (use === 'clothing') {
      if (this.player.stats.clothing) {
        this.events.emit('hud:message', { text: 'Du trägst schon warme Kleidung.' });
        return;
      }
      this.inventory.takeFromSlot(slot, 1);
      this.player.stats.clothing = true;
      this.audio.play('craft');
      this.events.emit('hud:message', { text: `${getItem(stack.id).name} angezogen – Kälte und Nässe machen dir jetzt viel weniger aus.` });
      return;
    }
    if (use === 'battery') {
      // Die leerste Taschenlampe im Rucksack bekommt die Batterie.
      let lamp = -1;
      this.inventory.slots.forEach((s, i) => {
        if (s?.id === 'flashlight' && (lamp < 0 || (s.durability ?? 0) < (this.inventory.slots[lamp]!.durability ?? 0))) lamp = i;
      });
      if (lamp < 0) {
        this.events.emit('hud:message', { text: 'Keine Taschenlampe im Rucksack.' });
        return;
      }
      this.inventory.takeFromSlot(slot, 1);
      this.inventory.restore(lamp);
      this.audio.play('pickup');
      this.events.emit('hud:message', { text: 'Neue Batterie eingelegt – die Taschenlampe ist voll.' });
      return;
    }
    if (getItem(stack.id).food) {
      this.tools.consumeFromSlot(slot);
      return;
    }
    if (slot >= this.inventory.hotbarSize) {
      this.inventory.quickMove(slot);
      const moved = this.inventory.slots.findIndex((s, i) => i < this.inventory.hotbarSize && s === stack);
      if (moved >= 0) this.tools.select(moved);
    } else {
      this.tools.select(slot);
    }
  }

  /** Vollbild + Keyboard Lock: erst damit lassen sich Strg+W & Co. im Spiel verwenden. */
  private async enterFullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      const keyboard = (navigator as Navigator & { keyboard?: { lock(keys?: string[]): Promise<void> } }).keyboard;
      await keyboard?.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'ControlRight', 'Tab']);
    } catch (err) {
      console.warn('Vollbild/Keyboard Lock nicht verfügbar:', err);
    }
  }

  start(): void {
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(this.frame);
  }

  private frame = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, 0.1); // lange Hänger nicht nachholen
    this.lastTime = now;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;

    if (this.input.wasPressed('debug')) this.hud.toggleDebug();
    if (this.input.wasPressed('postfx')) {
      this.updateSettings({ ...this.settings, postProcessing: !this.postFX.enabled });
      this.events.emit('hud:message', { text: `Nachbearbeitung ${this.postFX.enabled ? 'an' : 'aus'}` });
    }
    if (this.mode === 'playing' && this.input.wasPressed('map')) {
      this.journalUI.hide();
      this.skillsUI.hide();
      this.mapUI.toggle();
    }
    if (this.mode === 'playing' && this.input.wasPressed('skills')) {
      this.mapUI.hide();
      this.journalUI.hide();
      this.noteUI.hide();
      this.skillsUI.toggle();
    }
    if (this.mode === 'playing' && this.input.wasPressed('journal')) {
      this.mapUI.hide();
      this.skillsUI.hide();
      this.noteUI.hide();
      this.journalUI.toggle();
    }
    const toggleInventory = this.input.wasPressed('inventory') || this.input.wasPressed('craft');
    if (this.mode === 'playing' && toggleInventory && this.sleepTimer <= 0) {
      this.building.cancel();
      this.openInventory();
    } else if (this.mode === 'inventory' && (toggleInventory || this.input.wasPressed('cancel'))) {
      this.closeInventory();
    }

    if (this.mode === 'playing' || this.mode === 'inventory') this.simulate(dt);

    this.render();
    const building = this.building.isActive;
    // Während die Schnur draußen ist, zeigt der Hinweis die Angel; sonst hat das anvisierte Ziel Vorrang.
    const fishingPrompt = this.fishing.busy ? this.fishing.prompt : null;
    const prompt = this.mode === 'playing' && !building ? (fishingPrompt ?? this.interaction.prompt ?? this.fishing.prompt) : null;
    const fever = feverLabel(this.dayNight.day, this.dayNight.hour);
    const where = (this.caves.current ? ` · ${this.caves.current.name}` : '') + (fever ? ` · ${fever}` : '');
    const clock = this.dayNight.clockText.replace(' · ', ` · ${this.climate.season.name} · `) + where;
    this.hud.update(dt, this.player, clock, prompt, this.tools.selected, this.buildHint());
    this.updateNavigation(dt);
    if (this.hud.debugVisible) this.hud.updateDebug(this.debugLines());
    this.input.endFrame();
  };

  private simulate(dt: number): void {
    const step = this.config.physics.timestep;
    const player = this.player;
    this.updateSleep(dt);
    this.updateCaveTransition(dt);
    this.updateAutosave(dt);
    const playing = this.mode === 'playing' && this.sleepTimer <= 0 && !this.caveTransition;
    const water = this.world.heightMap.waterLevel;

    player.handleInput(playing);
    this.dayNight.timeScale = this.hud.debugVisible && this.input.isDown('timeWarp') ? 120 : 1;

    // Fester Physik-Takt
    const t0 = performance.now();
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= step && steps < this.config.physics.maxSubSteps) {
      player.fixedUpdate(step);
      this.enemies.fixedUpdate(step);
      this.animals.fixedUpdate(step);
      this.worldItems.fixedUpdate(step, water);
      this.physics.step();
      player.afterPhysicsStep();
      this.enemies.afterPhysicsStep();
      this.animals.afterPhysicsStep();
      this.projectiles.fixedUpdate(step);
      this.accumulator -= step;
      steps++;
    }
    if (steps === this.config.physics.maxSubSteps) this.accumulator = 0;
    this.physicsMs = performance.now() - t0;

    if (player.isOutOfWorld) player.spawn(this.respawnPoint);

    const alpha = this.accumulator / step;
    player.updateCamera(dt, alpha);
    // Raycasts (Interaktion, Werkzeuge) brauchen die Kamera-Matrix dieses Frames, nicht die des letzten.
    this.camera.updateMatrixWorld();
    this.elapsed += dt;

    // Gameplay
    if (playing && this.building.isActive) this.updateBuildMode();
    const building = this.building.isActive;
    this.interaction.update(this.tools.equippedTool);
    if (playing && !building && this.input.wasPressed('interact')) {
      // Eine offene Notiz legt `E` zuerst weg, ebenso ein laufendes Gespräch.
      if (this.noteUI.open) this.noteUI.hide();
      else if (this.dialogueUI.open) this.dialogueUI.hide();
      else this.interaction.interact();
    }
    this.updateDialogue(playing);
    if (this.noteUI.open && (player.position.distanceTo(this.noteAt) > 3.5 || this.mode !== 'playing')) this.noteUI.hide();
    // Im Gespräch wählen die Zifferntasten Antworten statt Werkzeuge (und es wird nicht zugeschlagen).
    this.tools.update(dt, playing && !building && !this.dialogueUI.open);
    this.harvest.update(dt);
    this.building.update(dt, player.position);
    this.enemies.update(dt, alpha);
    this.animals.update(dt, alpha);
    this.projectiles.update(alpha);
    this.cooking.update(dt);
    this.caves.update(this.dayNight.daylight);
    this.worldItems.update();
    this.particles.update(dt);
    this.embers.update(dt);
    player.stats.warm = this.building.isNearLitFire(player.position) || !!this.survivors?.isNearFire(player.position);
    this.survivors?.update(dt, player.position, this.caves.current ? 0 : 1 - this.dayNight.daylight);
    this.updateSkills(dt, playing);
    this.updateFever(dt);
    this.worldEvents.update({
      dt,
      player: player.position,
      hour: this.dayNight.hour,
      isNight: this.dayNight.isNight,
      inCave: !!this.caves.current,
    });
    this.updateFear(dt, playing);
    this.updateClimate(dt);
    // Kiste zerstört oder zu weit weg → Fenster schließen.
    const chest = this.openChest;
    if (chest && (!this.building.structures.includes(chest) || chest.position.distanceTo(player.position) > 4.5)) this.closeInventory();

    this.dayNight.update(dt, this.elapsed, player.position, player.headUnderwater, this.climate.look);
    this.scene.environmentIntensity = environmentIntensity(this.dayNight.daylight, this.dayNight.underground, this.climate.look.clouds);
    this.world.update(dt, this.elapsed, player.position);
    this.viewModel.update(dt, this.camera, player, player.headBob, this.dayNight);
    this.updateFishing(dt, playing && !building);

    // Fackel in der Hand → Licht an der Flamme; Taschenlampe → ruhiges Licht ein Stück vor der Lampe.
    const light = this.heldLight();
    if (light && this.viewModel.getFlamePosition(this.torchLight.position)) {
      this.torchLight.color.set(light.color);
      this.torchLight.intensity = light.intensity * this.viewModel.flameFlicker;
      this.torchLight.distance = light.distance;
      this.lights.request(this.torchLight);
    }
    // Taschenlampe: schattenwerfender Lichtkegel aus der Lampe, dazu ein schwacher Streulichtschein.
    const lamp = !!light && !!this.viewModel.getLampPosition(this.flashlight.position);
    this.flashlight.visible = lamp;
    if (lamp) {
      this.camera.getWorldDirection(this.tmpDir);
      this.flashlight.color.set(light!.color);
      this.flashlight.intensity = light!.intensity * 4;
      this.flashlight.distance = light!.distance * 1.5;
      this.flashlight.target.position.copy(this.flashlight.position).addScaledVector(this.tmpDir, 10);
      this.flashlight.target.updateMatrixWorld();
      this.torchLight.position.copy(this.flashlight.position).addScaledVector(this.tmpDir, 1.2);
      this.torchLight.color.set(light!.color);
      this.torchLight.intensity = light!.intensity * 0.12;
      this.torchLight.distance = 7;
      this.lights.request(this.torchLight);
    }
    this.lights.update(this.camera.position);

    // Audio: Hörer = Kamera, Unterwasser dumpf, Kulisse und Schritte.
    this.camera.getWorldDirection(this.tmpDir);
    this.audio.setListener(this.camera.position, this.tmpDir);
    this.audio.setUnderwater(player.headUnderwater);
    this.ambience.update(dt, {
      listener: this.camera.position,
      daylight: this.dayNight.daylight,
      underwater: player.headUnderwater,
      rain: this.climate.weather.rain,
      wind: this.climate.weather.wind,
      sheltered: this.climate.sheltered,
      cave: !!this.caves.current,
    });
    this.footsteps.updatePlayer(dt, player);
  }

  /** Angel in der Hand (Linksklick wirft aus bzw. schlägt an) und Fischreusen. */
  private updateFishing(dt: number, active: boolean): void {
    // In der Höhle gibt es kein Wasser zum Angeln.
    const holding = this.tools.equipped?.id === 'fishingRod' && !this.player.stats.isDead && !this.caves.current;
    this.camera.getWorldDirection(this.tmpDir);
    this.fishing.update({
      dt,
      holding,
      active,
      click: active && this.input.wasMousePressed(0),
      eye: this.camera.position,
      look: this.tmpDir,
      tip: holding ? this.viewModel.getRodTip(this.rodTip, this.camera) : null,
      player: this.player.position,
      swimming: this.player.swimming,
      rain: this.climate.weather.rain,
    });
    this.fishTraps.update(dt, this.climate.season.snow);
  }

  /** Erkundung, Kompass, Ziele und (falls offen) Karte. */
  private updateNavigation(dt: number): void {
    this.journal.setDay(this.dayNight.day);
    this.journalUI.update();
    const inCave = this.caves.current;
    // In der Höhle zeigen Karte und Kompass den Eingang als Standort.
    const p = inCave ? inCave.site.position : this.player.position;
    this.exploreTimer -= dt;
    if (this.exploreTimer <= 0 && !inCave) {
      this.exploreTimer = 0.5;
      this.exploration.reveal(p.x, p.z, 70);
      this.caves.updateDiscovery(p);
      this.settlement?.updateDiscovery(p);
      this.enemies.camps.forEach((c, i) => {
        if (!this.discoveredCamps.has(i) && c.center.distanceTo(p) < 60) {
          this.discoveredCamps.add(i);
          this.events.emit('hud:message', { text: 'Ein Schrat-Lager – auf der Karte (M) markiert.' });
          this.events.emit('camp:discovered', { index: i });
        }
      });
    }
    const deg = (r: number) => ((THREE.MathUtils.radToDeg(r) % 360) + 360) % 360;
    // Blickrichtung (−Z = Norden, im Uhrzeigersinn): Peilung = −Gierwinkel.
    const bearing = deg(-this.player.yaw);
    const r = this.respawnPoint;
    const showHome = r.distanceTo(this.world.spawnPoint) > 0.5 && r.distanceTo(p) > 8;
    this.compass.update(bearing, showHome ? deg(Math.atan2(r.x - p.x, -(r.z - p.z))) : null);
    if (!this.mapUI.open) return;
    const kinds: Record<string, 'fire' | 'shelter' | 'wall' | 'other'> = {
      campfire: 'fire',
      torchPost: 'fire',
      shelter: 'shelter',
      wall: 'wall',
      gate: 'wall',
    };
    this.mapUI.render({
      player: { x: p.x, z: p.z, bearing: THREE.MathUtils.degToRad(bearing) },
      respawn: showHome ? { x: r.x, z: r.z } : null,
      structures: this.building.structures.map((s) => ({ x: s.position.x, z: s.position.z, kind: kinds[s.def.id] ?? 'other' })),
      camps: [...this.discoveredCamps].map((i) => this.enemies.camps[i].center),
      caves: this.caves.caves.filter((c) => c.discovered).map((c) => ({ x: c.site.position.x, z: c.site.position.z })),
      events: this.worldEvents.markers(),
      harbor: this.survivors?.marker() ?? null,
    });
    const explored = document.querySelector('[data-ref="mapExplored"]');
    if (explored) explored.textContent = `${Math.round(this.exploration.fraction * 100)} % der Karte erkundet`;
  }

  /** Wetter, Nässe, Regenwasser in der Schale, Fackel im Regen. */
  private updateClimate(dt: number): void {
    const held = this.tools.equipped?.id;
    const climate = this.climate;
    if (this.hud.debugVisible && this.input.wasPressed('weather')) {
      climate.weather.advance();
      this.events.emit('hud:message', { text: `Wetter: ${climate.weather.name}` });
    }
    climate.update({
      dt,
      elapsed: this.elapsed,
      camera: this.camera.position,
      daylight: this.dayNight.daylight,
      isNight: this.dayNight.isNight,
      forest: this.ambience.env.forest,
      holdingBowl: held === 'bowl',
      day: this.dayNight.day,
      hour: this.dayNight.hour,
      underground: !!this.caves.current,
    });
    if (climate.bowlFill >= 1 && held === 'bowl') {
      climate.bowlFill = 0;
      if (this.inventory.transform(this.tools.selected, 'bowlWater') > 0) this.items.drop('bowlWater', 1, this.player.position);
      this.events.emit('hud:message', { text: 'Die Schale hat sich mit Regenwasser gefüllt.' });
    }
    // Im Regen brennt die Fackel deutlich schneller herunter.
    this.tools.torchBurnRate = 1 + 2 * climate.exposure(this.ambience.env.forest);
  }

  /** Baumodus: Drehen, Ghost nachführen, Bauen (Linksklick) und Abbrechen (Rechtsklick/Schnellzugriff). */
  private updateBuildMode(): void {
    const input = this.input;
    const hotbarPressed = (['hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6'] as const).some((k) =>
      input.wasPressed(k),
    );
    if (hotbarPressed || input.wasMousePressed(2)) {
      this.building.cancel();
      return;
    }
    if (input.wasPressed('rotate')) this.building.rotate(1);
    const wheel = input.consumeWheel();
    if (wheel !== 0) this.building.rotate(wheel);

    this.camera.getWorldDirection(this.tmpDir);
    this.building.updateGhost(this.camera.position, this.tmpDir, this.player.yaw, this.player.collisionShape);
    if (!input.isMouseDown(0)) this.building.armed = true;
    else if (this.building.armed && input.wasMousePressed(0)) this.building.confirm();
  }

  private buildHint(): BuildHint | null {
    const def = this.building.active;
    const placement = this.building.placement;
    if (!def || this.mode !== 'playing') return null;
    return {
      name: def.name,
      valid: placement?.valid ?? false,
      reason: placement?.reason,
      cost: def.cost.map((c) => ({ item: c.item, have: this.inventory.count(c.item), need: c.count })),
    };
  }

  private render(): void {
    this.renderer.info.reset();
    const overlay = this.viewModel.visible && this.mode !== 'dead' ? this.viewModel : null;
    if (this.postFX.enabled) {
      const look = (this.look = filmLook(
        {
          daylight: this.dayNight.daylight,
          hour: this.dayNight.hour,
          fever: this.dayNight.fever,
          cave: this.dayNight.underground > 0.5,
          underwater: this.player.headUnderwater,
          fear: this.fear?.value ?? 0,
          rain: this.climate?.weather.rain ?? 0,
          cameraY: this.camera.position.y,
          fogColor: this.dayNight.fog.color,
        },
        this.look ?? undefined,
      ));
      this.postFX.render(this.renderer, this.scene, this.camera, {
        lightDir: this.dayNight.lightDirection(this.tmpDir),
        lightColor: this.dayNight.light.color,
        rays: this.dayNight.rayStrength,
        bloom: this.dayNight.daylight > 0.5 ? 0.45 : 0.8,
        underwater: this.player.headUnderwater,
        grade: look.grade,
        mist: look.mist,
        time: this.elapsed,
        // Der Gegenstand in der Hand bekommt denselben Filmlook (Korn, Farbstimmung), aber keinen Nebel.
        overlay,
      });
      return;
    }
    this.renderer.render(this.scene, this.camera);
    // ViewModel in eigenem Durchgang über die Welt legen (Tiefenpuffer geleert).
    if (overlay) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.viewModel.scene, this.viewModel.camera);
      this.renderer.autoClear = true;
    }
  }

  private debugLines(): string[] {
    const p = this.player;
    const info = this.renderer.info.render;
    const v = p.velocity;
    return [
      `FPS        ${this.fps.toFixed(0)}`,
      `Physik     ${this.physicsMs.toFixed(2)} ms`,
      `Draw Calls ${info.calls}   Dreiecke ${(info.triangles / 1000).toFixed(0)}k`,
      `Position   ${p.position.x.toFixed(1)} ${p.position.y.toFixed(1)} ${p.position.z.toFixed(1)}`,
      `Tempo      ${Math.hypot(v.x, v.z).toFixed(1)} m/s  vy ${v.y.toFixed(1)}`,
      `Zustand    ${[p.grounded && 'Boden', p.crouching && 'Ducken', p.sprinting && 'Sprint', p.swimming && 'Schwimmen']
        .filter(Boolean)
        .join(' ') || 'Luft'}`,
      `Objekte    ${this.worldItems.size} Items · ${this.building.structures.length} Bauwerke · ${this.harvest.fallingCount} fallend · ${this.particles.activeCount + this.embers.activeCount} Partikel`,
      `Ziel       ${this.interaction.target?.type ?? '–'}`,
      `Schrate    ${this.enemies.aliveCount} lebend · ${this.enemies.aggressiveCount} aggressiv · Sicht ${this.enemies.sightRange.toFixed(0)} m`,
      `Terrain-LOD ${this.world.terrain.lodHistogram.join(' / ')} Chunks (Stufe 0–3)`,
      `Wetter     ${this.climate.weather.name} · Wolken ${(this.climate.weather.clouds * 100).toFixed(0)} % · Regen ${(this.climate.weather.rain * 100).toFixed(0)} % · Nässe ${(this.player.stats.wetness * 100).toFixed(0)} %${this.climate.sheltered ? ' · unter Dach' : ''} (Y: weiter)`,
      `Wild       ${this.animals.aliveCount} Tiere · ${this.projectiles.count} Geschosse in der Luft`,
      `Zeit       ${this.dayNight.clockText}  (T halten = Zeitraffer)`,
      `Ereignisse ${this.worldEvents.active} aktiv`,
      `Fieber     ${feverLabel(this.dayNight.day, this.dayNight.hour) || '–'} · Horde ${this.enemies.hordeCount} (N: Fiebernacht)`,
      `Furcht     ${(this.fear.value * 100).toFixed(0)} %${this.fear.hallucinating ? ' · Halluzinationen' : ''} · ${this.horror.activeWatchers} Gestalten`,
    ];
  }

  /** Übernimmt Einstellungen sofort (Ton, Steuerung, Grafik) und speichert sie. */
  updateSettings(s: Settings): void {
    this.settings = s;
    this.settingsStore.save(s);
    this.applySettings();
    this.settingsUI?.set(s);
  }

  private applySettings(): void {
    const s = this.settings;
    this.audio.setVolumes(s.masterVolume, s.sfxVolume, s.ambienceVolume);
    if (this.player) {
      this.player.mouseScale = s.mouseSensitivity;
      this.player.invertY = s.invertY;
      this.player.fov = s.fov;
    }
    // Umschalten der Nachbearbeitung kompiliert die Shader einmal neu (kurzer Ruckler).
    this.postFX.enabled = s.postProcessing;
    this.postFX.ao = s.quality !== 'low';
    if (this.dayNight) this.dayNight.linearOutput = s.postProcessing;

    const q = QUALITY[s.quality];
    this.dayNight?.setShadowMapSize(q.shadowMapSize);
    this.world?.grass?.setRadius(q.grassRadius);
    this.world?.vegetation.setCullDistance(q.vegetationDistance);
    if (this.world) this.world.vegetation.nearTreeDistance = q.nearTrees;
    if (this.camera.far !== q.viewDistance) {
      this.camera.far = q.viewDistance;
      this.camera.updateProjectionMatrix();
    }
    const ratio = Math.min(window.devicePixelRatio, q.maxPixelRatio);
    if (this.renderer.getPixelRatio() !== ratio) {
      this.renderer.setPixelRatio(ratio);
      this.handleResize();
    }
  }

  private handleResize = (): void => {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.viewModel.setAspect(aspect);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.postFX.setSize(size.x, size.y);
  };
}
