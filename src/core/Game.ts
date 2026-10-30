import * as THREE from 'three';
import { CONFIG, type GameConfig } from '../config';
import { EventBus } from './EventBus';
import { Input } from './Input';
import { Physics } from './Physics';
import { World } from '../world/World';
import { DayNightCycle } from '../systems/DayNightCycle';
import { MUD_TIME, Player } from '../entities/Player';
import type { BiomeWeights } from '../world/Biomes';
import { ViewModel } from '../entities/ViewModel';
import { WorldItems } from '../entities/items/WorldItems';
import { getItem } from '../entities/items/ItemDefs';
import { canMod, isWeapon, maxDurability, rollWeapon, weaponName, weaponOf } from '../entities/items/Weapons';
import { ELEMENTS } from '../entities/items/Elements';
import { Inventory } from '../systems/Inventory';
import { ItemService } from '../systems/ItemService';
import { HarvestSystem } from '../systems/HarvestSystem';
import { InteractionSystem, type Prompt } from '../systems/InteractionSystem';
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
import { Projectiles, STONE_NOISE } from '../systems/Projectiles';
import { Enemy } from '../entities/enemies/Enemy';
import { Cooking } from '../systems/Cooking';
import { Camp } from '../systems/Camp';
import { Rafts } from '../systems/Rafts';
import { CascadedShadows } from '../world/CascadedShadows';
import { Ropes } from '../systems/Ropes';
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
import { getPerk, getSkill, PERK_LEVELS, Skills, wireSkillEvents, type PerkId } from '../systems/Skills';
import { Fear } from '../systems/Fear';
import { Horror } from '../systems/Horror';
import { feverLabel, feverNumber, feverPhase, waveInterval, waveSize, type FeverPhase } from '../systems/FeverNight';
import type { ItemCost, ItemId } from '../entities/items/ItemDefs';
import { WorldEvents } from '../systems/WorldEvents';
import { Survivors, type NpcDef } from '../systems/Survivors';
import { Quests } from '../systems/Quests';
import { DialogueUI } from '../ui/DialogueUI';
import { getStructure, isStructureId } from '../systems/building/StructureDefs';
import { isItemId } from '../entities/items/ItemDefs';
import { Ambience } from '../systems/Ambience';
import { Footsteps } from '../systems/Footsteps';
import { PostFX, type HeatSource, type VolumetricLights } from '../systems/PostFX';
import { FireEffect } from '../entities/FireEffect';
import { filmLook, morningMist, type Look } from '../systems/FilmLook';
import { FogWake } from '../world/FogWake';
import { environmentIntensity, loadForestEnvironment } from '../world/Environment';
import { loadSurfaceTextures } from '../world/SurfaceTextures';
import { loadRockModels } from '../world/RockModels';
import { loadItemModels } from '../entities/items/ItemModels';
import { CharacterLibrary } from '../entities/characters/CharacterLibrary';
import { FirstPersonArm } from '../entities/characters/FirstPersonArm';
import { AnimalModels } from '../entities/animals/AnimalAvatars';
import { wolfBoldness } from '../entities/animals/Wolf';
import { SnowTracks } from '../world/SnowTracks';
import { Breath } from '../world/Breath';
import { Fireflies } from '../world/Fireflies';
import { LightningBolt } from '../world/LightningBolt';
import { Blood } from '../systems/Blood';
import { Places } from '../systems/Places';
import { EndingUI } from '../ui/EndingUI';
import { NOTES } from '../systems/Notes';
import { Motes } from '../world/Motes';
import { Defenses, type Intruder } from '../systems/Defenses';
import { ElementEffects } from '../systems/ElementEffects';
import { CombatMoves } from '../systems/CombatMoves';
import { Gore } from '../systems/Gore';
import { Explosives } from '../systems/Explosives';
import { HouseBases } from '../systems/HouseBases';
import { Companion, COMPANION_ID } from '../systems/Companion';
import { Atmosphere } from '../systems/Atmosphere';
import { DamageNumbers } from '../ui/DamageNumbers';

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
/** Abstand zur Werkbank, in dem ihre Baupläne gelten (m). */
const WORKBENCH_RADIUS = 6;
/** Werkzeuge, die sich an der Werkbank ausbessern lassen (Fackel und Taschenlampe nicht). */
const REPAIRABLE = new Set<ItemId>([
  'axe', 'stoneAxe', 'flintAxe', 'machete', 'spear', 'bow', 'fishingRod', 'boneClub',
  'baseballBat', 'pipeWrench', 'crowbar', 'sledgehammer', 'kitchenKnife', 'fireAxe', 'sabre',
  'pistol', 'revolver', 'shotgun', 'huntingRifle',
  'katana', 'cleaver', 'golfClub', 'baton', 'pitchfork', 'nailBat', 'shockBar',
]);
/** Was Schrate fallen lassen können (gewichtet). */
const ENEMY_WEAPON_DROPS: ItemId[] = ['pipeWrench', 'crowbar', 'baseballBat', 'kitchenKnife', 'machete', 'baseballBat', 'crowbar', 'fireAxe', 'sledgehammer', 'sabre', 'pistol', 'cleaver', 'golfClub', 'baton', 'pitchfork'];
/** Chance, dass ein erlegter Schrat eine Waffe fallen lässt. */
const ENEMY_WEAPON_CHANCE = 0.1;
/** Debug-Waffenkammer (F3, dann G). */
const ARMORY_WEAPONS: ItemId[] = ['pistol', 'revolver', 'shotgun', 'huntingRifle', 'katana', 'nailBat', 'shockBar'];
const ARMORY_SUPPLIES: [ItemId, number][] = [['pistolAmmo', 60], ['shells', 30], ['rifleAmmo', 20], ['pipeBomb', 3]];
/** Munition, die erlegte Schrate fallen lassen können, und wie oft. */
const ENEMY_AMMO_DROPS: ItemId[] = ['pistolAmmo', 'pistolAmmo', 'shells', 'rifleAmmo'];
const ENEMY_AMMO_CHANCE = 0.12;
const TOOL_REPAIR_COST: ItemCost[] = [
  { item: 'stick', count: 1 },
  { item: 'stone', count: 1 },
];

/**
 * Spielzustand:
 * - `playing`   Pointer Lock aktiv, volle Steuerung
 * - `inventory` Inventar offen, Maus frei; die Welt läuft weiter (wie im Genre üblich)
 * - `paused`    Pausenmenü, Simulation angehalten
 * - `dead`      Todesbildschirm
 */
export type GameMode = 'loading' | 'playing' | 'inventory' | 'paused' | 'dead' | 'ending';

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
  readonly embers = new Particles(450, true);
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
  camp!: Camp;
  shadows!: CascadedShadows;
  rafts!: Rafts;
  ropes!: Ropes;
  climate!: Climate;
  fishing!: Fishing;
  fishTraps!: FishTraps;
  caves!: Caves;
  /** Die verlassene Stadt (null, falls die Insel keinen Bauplatz bot). */
  settlement: Settlement | null = null;
  /** Absturzstelle, Zeche, Hütte im Moor, Funkstation. */
  places!: Places;
  /** Laufender Übergang in eine Höhle bzw. hinaus (Abblenden, Teleport in der Mitte). */
  private caveTransition: { timer: number; target: CaveTarget; applied: boolean } | null = null;
  ambience!: Ambience;
  footsteps!: Footsteps;
  /** Abdrücke im Schnee. */
  snowTracks!: SnowTracks;
  private readonly breath = new Breath();
  private readonly motes = new Motes();
  private blood!: Blood;
  private readonly tmpBlood = new THREE.Vector3();
  private readonly tmpBloodAt = new THREE.Vector3();
  private readonly bolts = [new LightningBolt(), new LightningBolt()];
  private readonly boltLight: LightRequest = { position: new THREE.Vector3(), color: new THREE.Color(0.75, 0.8, 1), intensity: 0, distance: 900 };
  private fireflies!: Fireflies;
  defenses!: Defenses;
  /** Elemente der Waffenmods (Brand, Schock, Säure, Blutung). */
  elementFx!: ElementEffects;
  private readonly intruderCache = new WeakMap<object, Intruder>();
  hud!: HUD;
  /** Kampfmanöver (Tritte, Ausweichen, Parade, Trefferstopp) und Schadenszahlen. */
  combat!: CombatMoves;
  /** Wunden und abgetrennte Gliedmaßen. */
  gore!: Gore;
  /** Rohrbomben. */
  explosives!: Explosives;
  /** Verbarrikadierte Stadthäuser als Basis (fehlt ohne Stadt). */
  houseBases: HouseBases | null = null;
  /** Ben, der Begleiter aus der Funkstation (null ohne Funkstation). */
  companion: Companion | null = null;
  /** Flackernde Lichter, Krähen, Windspiele, die Glocke um Mitternacht. */
  atmosphere!: Atmosphere;
  private damageNumbers!: DamageNumbers;
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
  private sleepComfort = false;
  /** Dauer des letzten Bildes (s) – für Augenanpassung und Bewegungsunschärfe. */
  private frameDt = 1 / 60;
  private readonly tmpBiome: BiomeWeights = { highland: 0, swamp: 0, cliffs: 0 };
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
  private endingUI!: EndingUI;
  /** Fortschritt der Hauptgeschichte (Funkspruch, Abfahrt) und Bilanz für den Abspann. */
  private story = { transmitted: false, ended: false, kills: 0, hansen: false };
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
  /** Mündungsfeuer in der Welt (Restdauer) und Blick durchs Zielfernrohr. */
  private muzzleTime = 0;
  private scoped = false;
  private readonly muzzleLight: LightRequest = { position: new THREE.Vector3(), color: new THREE.Color(0xffb060), intensity: 0, distance: 22 };
  private readonly torchLight: LightRequest = {
    position: new THREE.Vector3(),
    color: new THREE.Color(),
    intensity: 0,
    distance: 0,
  };
  /** Kegel der Taschenlampe – mit Schattenwurf (Bäume und Gestalten werfen lange Schatten). */
  private readonly flashlight = new THREE.SpotLight(0xf4f1e6, 0, 38, 0.42, 0.6, 1.6);
  private readonly volLights: VolumetricLights = { spot: null, points: [], air: 0, strength: 0 };
  private readonly volSun = { light: null as unknown as THREE.DirectionalLight, strength: 0 };
  private readonly volGround = {
    density: 0,
    ambient: new THREE.Color(),
    heightTexture: null as unknown as THREE.Texture,
    heightMapping: new THREE.Vector3(),
    wakes: [] as readonly THREE.Vector4[],
  };
  private readonly fogWake = new FogWake();
  private readonly biomeTmp = { highland: 0, swamp: 0, cliffs: 0 };
  private readonly heat: HeatSource[] = [];
  private readonly fireAmbient = new THREE.Color();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpWaterDir = new THREE.Vector3();

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
    // Khronos PBR Neutral: natürlichere Grün- und Himmelstöne als ACES, kräftigere Abendfarben (verglichen mit ACES und AgX).
    this.renderer.toneMapping = THREE.NeutralToneMapping;
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
    // Die Sonne wirft ihre Schatten über drei Kaskaden; das eigentliche Sonnenlicht liefert nur noch die Werte.
    this.scene.remove(this.dayNight.light);
    this.dayNight.light.castShadow = false;
    this.shadows = new CascadedShadows(this.scene, this.camera, QUALITY[this.settings.quality].shadowMapSize);

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
    await FirstPersonArm.loadPair()
      .then(([right, left]) => this.viewModel.setArm(right, left))
      .catch((e) => console.warn('[Hand] Modell fehlt, einfacher Arm:', e));
    const tEnemies = performance.now();
    this.blood = new Blood({
      waterLevel: this.world.heightMap.waterLevel,
      raycast: (origin, dir, maxDist) => {
        const hit = this.physics.raycast(origin, dir, maxDist, undefined, true);
        if (!hit) return null;
        // Nur feste Oberflächen: Gelände, Bauwerke, Fels – nicht Schrate, Tiere oder der Spieler.
        const body = hit.collider.parent();
        if (body && !body.isFixed()) return null;
        return { point: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z), normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) };
      },
    });
    this.scene.add(this.blood.group);
    this.enemies = new EnemyDirector({
      blood: this.blood,
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
      avoidAreas: [
        ...this.world.places.map((p) => ({ x: p.position.x, z: p.position.z, radius: p.radius + 60 })),
        ...this.world.hamlets.map((h) => ({ x: h.center.x, z: h.center.z, radius: h.radius + 70 })),
      ],
      // Neben dem Steinkreis lagern die Schrate, die ihn bewachen.
      extraCamps: this.world.places
        .filter((p) => p.kind === 'stones')
        .map((p) => {
          const x = p.position.x + Math.sin(p.yaw) * 17;
          const z = p.position.z + Math.cos(p.yaw) * 17;
          return new THREE.Vector3(x, this.world.heightMap.heightAt(x, z), z);
        })
        // Moorwinkel und das Sägewerk sind nicht ganz verlassen.
        .concat(
          this.world.hamlets
            .filter((h) => h.kind === 'hamlet' || h.kind === 'sawmill')
            .map((h) => {
              const w = townWorld(h, h.kind === 'hamlet' ? -22 : 0, h.kind === 'hamlet' ? -6 : 6);
              return new THREE.Vector3(w.x, h.center.y, w.z);
            }),
        ),
      extraFire: (pos, radius) => this.defenses?.fireNear(pos, radius) ?? null,
    });
    this.scene.add(this.enemies.group);
    this.ambience = new Ambience(this.audio, this.world.heightMap, this.world.vegetation);
    this.footsteps = new Footsteps(this.audio, this.world.heightMap, this.physics, this.building, this.events);
    this.snowTracks = new SnowTracks(this.world.heightMap);
    this.fireflies = new Fireflies(this.world.heightMap);
    this.scene.add(this.snowTracks.mesh, this.breath.group, this.motes.points, this.fireflies.points);
    let enemyFoot = 1;
    this.enemies.onEnemyStep = (pos, speed, yaw) => {
      this.footsteps.enemyStep(pos, speed);
      enemyFoot = -enemyFoot;
      this.snowTracks.add('boot', pos, yaw, enemyFoot * 0.11, 0.95);
    };
    this.footsteps.onStep = (pos, foot) => this.snowTracks.add('boot', pos, this.player.yaw + Math.PI, foot * 0.11);
    console.info(
      `[Enemies] Navigationsraster + ${this.enemies.camps.length} Lager in ${(performance.now() - tEnemies).toFixed(0)} ms`,
    );
    this.animals = new AnimalDirector({
      blood: this.blood,
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
      hitPlayer: (amount, from) => {
        this.player.receiveHit(amount, from);
        this.audio.play('hurt');
      },
      fireNear: (pos, radius) =>
        this.building.structures.some((s) => s.lit && !!s.def.flame && s.position.distanceTo(pos) < radius) || !!this.defenses?.fireNear(pos, radius),
      playerTorch: () => this.tools.equipped?.id === 'torch',
      playerHidden: () => !!this.caves?.current,
      isNight: () => this.dayNight.isNight,
      wolfBoldness: () => wolfBoldness(this.climate.season.snow, this.climate.weather.storm),
      onSnared: (snare) => {
        const s = this.building.structures.find((x) => x.position === snare.position);
        if (s) this.building.setArmed(s, false);
        if (snare.position.distanceTo(this.player.position) < 120) {
          this.events.emit('hud:message', { text: 'Eine Schlingfalle hat zugeschnappt.' });
        }
      },
    });
    this.scene.add(this.animals.group);
    this.animals.onTrack = (kind, pos, heading, side, scale) => this.snowTracks.add(kind, pos, heading, side, scale);
    this.defenses = new Defenses({
      building: this.building,
      heightMap: this.world.heightMap,
      lights: this.lights,
      audio: this.audio,
      particles: this.particles,
      events: this.events,
      intruders: () => this.intruders(),
      player: {
        position: this.player.position,
        hurt: (amount, from) => this.player.stats.damage(amount, 'fire', true, from.clone()),
      },
    });
    this.scene.add(this.defenses.group);
    const enemies = this.enemies;
    this.elementFx = new ElementEffects({
      enemies: function* () {
        yield* enemies.enemies;
        yield* enemies.caveDwellers;
      },
      hurt: (e, amount, from, element) => enemies.hurt(e, amount, from, element),
      particles: this.particles,
      embers: this.embers,
      lights: this.lights,
      audio: this.audio,
      events: this.events,
      heightMap: this.world.heightMap,
      rain: () => (this.caves.current ? 0 : this.climate.weather.rain * (1 - this.climate.season.snowfall * 0.6)),
      blood: this.blood,
      player: {
        position: this.player.position,
        hurt: (amount, from) => this.player.stats.damage(amount, 'fire', true, from.clone()),
      },
    });
    this.scene.add(this.elementFx.group);
    this.cooking = new Cooking(this.building, this.items, this.audio, this.events);
    this.camp = new Camp({
      building: this.building,
      items: this.items,
      inventory: this.inventory,
      audio: this.audio,
      events: this.events,
      particles: this.particles,
      heldItem: () => this.tools.equipped?.id ?? null,
      takeHeld: () => void this.inventory.takeFromSlot(this.tools.selected, 1),
      transformHeld: (to) => {
        if (this.inventory.transform(this.tools.selected, to) > 0) this.items.drop(to, 1, this.player.position);
      },
      drink: (amount) => this.player.stats.drink(amount),
      drinkAmount: cfg.stats.drinkAmount,
      repairHeld: () => this.repairHeld(),
      repairPrompt: () => (this.repairableHeld() ? 'Werkzeug ausbessern (1 Stock, 1 Stein)' : null),
      roofAbove: (pos) => this.climate.roofAbove(pos),
    });
    this.crafting.nearWorkbench = () => this.nearWorkbench();
    this.rafts = new Rafts({
      building: this.building,
      player: this.player,
      heightMap: this.world.heightMap,
      audio: this.audio,
      events: this.events,
      particles: this.particles,
    });
    this.ropes = new Ropes({
      building: this.building,
      player: this.player,
      heightMap: this.world.heightMap,
      audio: this.audio,
      events: this.events,
    });
    this.scene.add(this.ropes.group);
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
        ...this.world.places.filter((p) => p.kind !== 'mine').map((p) => ({ x: p.position.x, z: p.position.z, radius: p.radius + 40 })),
        ...this.world.hamlets.map((h) => ({ x: h.center.x, z: h.center.z, radius: h.radius + 40 })),
      ],
      markObstacle: (x, z, r) => this.enemies.nav.markCircle(x, z, r, 1),
      // Der Feuersteinstollen (Hansens Höhle) beginnt im Mundloch der Zeche.
      fixedSites: Object.fromEntries(
        this.world.places.filter((p) => p.kind === 'mine').map((p) => [2, { position: p.position.clone(), into: p.yaw }]),
      ),
    });
    this.scene.add(this.caves.group);
    this.places = new Places({
      physics: this.physics,
      heightMap: this.world.heightMap,
      seed: cfg.seed,
      sites: this.world.places,
      items: this.items,
      audio: this.audio,
      events: this.events,
      lights: this.lights,
      markObstacle: (x, z, yaw, hx, hz) => this.enemies.nav.markBox(x, z, yaw, hx, hz, 1),
    });
    this.scene.add(this.places.group);
    if (this.world.town) {
      this.menu.setLoading('Die Stadt wird aufgebaut …');
      await nextFrame();
      this.settlement = new Settlement({
        physics: this.physics,
        towns: [this.world.town, ...this.world.hamlets, this.world.roadside, this.world.wild],
        seed: cfg.seed,
        items: this.items,
        audio: this.audio,
        events: this.events,
        markObstacle: (x, z, yaw, hx, hz) => this.enemies.nav.markBox(x, z, yaw, hx, hz, 1),
        markDoor: (door) => this.enemies.nav.markPassage(door.position.x, door.position.z, door.yaw, door.halfX, door.halfZ, 1),
      });
      this.scene.add(this.settlement.group);
      this.footsteps.town = this.settlement;
      this.houseBases = new HouseBases({
        openings: this.settlement.openings,
        building: this.building,
        crafting: this.crafting,
        audio: this.audio,
        events: this.events,
        particles: this.particles,
        onClaim: (_house, center, quiet) => {
          this.respawnPoint.copy(center).setY(center.y + 0.1);
          if (quiet) return;
          this.audio.play('craft');
          this.events.emit('hud:message', { text: 'Das Haus ist rundum verbarrikadiert – ab jetzt ist es deine Basis. Hier wachst du künftig auf.' });
          this.saveNow();
        },
      });
    }
    this.enemies.onCaveDwellerKilled = (cave, slot) => this.caves.dwellerKilled(cave, slot, this.dayNight.day);
    // Schrei der Schreierin: Mark und Bein – Ausdauer weg, Furcht steigt, die Sicht bebt.
    let screamHinted = false;
    this.enemies.onScream = (_from, strength) => {
      const stats = this.player.stats;
      stats.stamina = Math.min(stats.stamina, stats.stamina * (1 - strength));
      this.fear.scare(0.5 * strength);
      this.player.addShake(0.5 * strength);
      if (!screamHinted && strength > 0.3) {
        screamHinted = true;
        this.events.emit('hud:message', { text: 'Ein Schrei geht dir durch Mark und Bein – jetzt wissen alle, wo du bist.' });
      }
    };
    this.enemies.onSlam = (at, distance) => {
      this.player.addShake(THREE.MathUtils.clamp(1 - distance / 14, 0, 1));
      this.particles.burst(at.clone().setY(at.y + 0.2), { count: 24, color: 0x5a5248, speed: 3.5, spread: 1, size: 0.05, life: 1.4 });
    };
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
    for (const b of this.bolts) this.scene.add(b.mesh);
    this.climate.weather.onLightning = (l) => this.strikeLightning(l.distance, l.angle);
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
      onShatter: (point) => this.defenses.ignite(point, this.skills.has('pyro') ? 1.3 : 1),
      onIgnite: (point) => this.defenses.ignite(point, this.skills.has('pyro') ? 0.75 : 0.45),
      onBomb: (point) => this.explosives.arm(point),
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
        ...this.world.hamlets.map((h) => ({ x: h.center.x, z: h.center.z, radius: h.radius + 20 })),
        ...(this.world.harbor ? [{ x: this.world.harbor.center.x, z: this.world.harbor.center.z, radius: 80 }] : []),
        ...this.places.areas,
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
        canDepart: () => !this.story.ended,
        onDepart: () => this.depart(),
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
      camp: this.camp,
      rafts: this.rafts,
      ropes: this.ropes,
      caves: this.caves,
      settlement: this.settlement,
      places: this.places,
      worldEvents: this.worldEvents,
      survivors: this.survivors,
      companion: { getNpc: (c) => this.companion?.getNpc(c) },
      items: this.items,
      audio: this.audio,
      events: this.events,
      config: cfg,
      onTalk: (npc) => this.talkTo(npc),
      usePrompt: (id) => this.usePrompt(id),
      fallback: () => this.mudAction() ?? this.houseBases?.action(this.camera.position, this.camera.getWorldDirection(new THREE.Vector3())) ?? null,
      onUse: (id) => this.useThing(id),
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
    this.tools.elements = this.elementFx;
    this.gore = new Gore({ physics: this.physics, enemies: this.enemies, blood: this.blood, particles: this.particles, audio: this.audio });
    this.gore.enabled = this.settings.gore;
    this.scene.add(this.gore.group);
    this.createCompanion();
    this.atmosphere = new Atmosphere({
      layouts: [...(this.world.town ? [this.world.town] : []), ...this.world.hamlets, this.world.roadside, this.world.wild],
      places: this.world.places,
      lights: this.lights,
      audio: this.audio,
      events: this.events,
      seed: cfg.seed,
    });
    this.scene.add(this.atmosphere.group);
    this.tools.gore = this.gore;
    this.explosives = new Explosives({
      enemies: this.enemies,
      animals: this.animals,
      building: this.building,
      heightMap: this.world.heightMap,
      particles: this.particles,
      embers: this.embers,
      lights: this.lights,
      audio: this.audio,
      events: this.events,
      gore: this.gore,
      player: {
        position: this.player.position,
        hurt: (amount, from) => this.player.stats.damage(amount, 'explosion', true, from.clone()),
        addShake: (amount) => this.player.addShake(amount),
      },
      ignite: (point, scale) => this.defenses.ignite(point, scale),
    });
    this.scene.add(this.explosives.group);
    this.combat = new CombatMoves({
      gore: this.gore,
      input: this.input,
      player: this.player,
      viewModel: this.viewModel,
      enemies: this.enemies,
      audio: this.audio,
      events: this.events,
      skills: this.skills,
      blood: this.blood,
    });
    this.tools.combat = this.combat;
    this.tools.particles = this.particles;
    this.tools.waterLevel = this.world.heightMap.waterLevel;
    this.events.on('gun:fired', () => (this.muzzleTime = 0.07));
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
    // Erlegte Schrate lassen ab und zu eine Waffe fallen; Bosse immer eine gute.
    this.events.on('enemy:killed', ({ position, boss }) => {
      // Manche hatten noch Patronen in der Tasche.
      if (Math.random() < ENEMY_AMMO_CHANCE) {
        const ammo = ENEMY_AMMO_DROPS[Math.floor(Math.random() * ENEMY_AMMO_DROPS.length)];
        this.items.drop(ammo, ammo === 'pistolAmmo' ? 4 + Math.floor(Math.random() * 6) : 2 + Math.floor(Math.random() * 3), position.clone().setY(position.y + 0.8));
      }
      if (!boss && Math.random() > ENEMY_WEAPON_CHANCE) return;
      const id = ENEMY_WEAPON_DROPS[Math.floor(Math.random() * ENEMY_WEAPON_DROPS.length)];
      const weapon = boss ? weaponOf(Math.random() < 0.5 ? 'legendary' : 'superior') : rollWeapon(Math.random, this.items.luck);
      this.items.drop(id, 1, position.clone().setY(position.y + 1), weapon);
    });
    this.events.on('enemy:hit', ({ killed, name }) => {
      if (!killed) return;
      this.story.kills++;
      if (this.skills.has('bloodlust') && !this.player.stats.isDead) {
        const st = this.player.stats;
        st.health = Math.min(st.max, st.health + 12);
      }
      if (name === 'Hansen, der Erste') this.story.hansen = true;
    });
    // Wer blutet, hinterlässt Spuren: Bisse und Schläge spritzen Blut auf den Boden.
    this.events.on('player:damaged', ({ amount, source, from }) => {
      if (source !== 'enemy' || amount < 6) return;
      const p = this.player.position;
      const dir = from ? this.tmpBlood.set(p.x - from.x, 0, p.z - from.z).normalize() : this.tmpBlood.set(0, 0, 0);
      this.blood.spray(this.tmpBloodAt.copy(p).setY(p.y + 1.1), dir, Math.min(0.6, amount / 50));
    });

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
    this.damageNumbers = new DamageNumbers(this.opts.hudRoot, this.events);
    this.damageNumbers.enabled = this.settings.damageNumbers;
    this.inventoryUI = new InventoryUI(
      this.opts.inventoryRoot,
      this.inventory,
      icons,
      () => this.tools.selected,
      this.crafting,
    );
    this.noteUI = new NoteUI(document.getElementById('note')!);
    this.endingUI = new EndingUI();
    this.dialogueUI = new DialogueUI(document.getElementById('dialogue')!);
    this.skillsUI = new SkillsUI(document.getElementById('skills')!, this.skills);
    this.events.on('skill:levelUp', ({ id, level }) => {
      const s = getSkill(id);
      this.audio.play('craft', 0.8);
      this.events.emit('hud:message', { text: `${s.name} – Stufe ${level}: ${s.effect(level)}` });
      if (PERK_LEVELS.some((l, tier) => level >= l && this.skills.chosen(id, tier as 0 | 1) === null)) this.events.emit('hud:message', { text: `Neues Talent für ${s.name} wählbar – K öffnet die Fertigkeiten.` });
      if (this.skillsUI.open) this.skillsUI.render();
    });
    this.skillsUI.onChoose = (id) => {
      if (!this.skills.choose(id)) return;
      this.audio.play('craft');
      this.events.emit('hud:message', { text: `Talent gelernt: ${getPerk(id).name} – ${getPerk(id).text}` });
      this.skillsUI.render();
      this.saveNow();
    };
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
    this.mapUI.drawRoads(this.world.roads);
    if (this.world.town) this.mapUI.drawTown(this.world.town);
    for (const h of this.world.hamlets) this.mapUI.drawTown(h);
    this.compass = new Compass(this.hud.compassCanvas);
    this.inventoryUI.onUse = (slot) => this.useSlot(slot);
    this.inventoryUI.onApplyMod = (modSlot, weaponSlot) => this.applyMod(modSlot, weaponSlot);
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
        armor: s.armor,
        ...(this.caves.current ? { cave: this.caves.current.index } : {}),
      },
      time: { day: this.dayNight.day, hour: this.dayNight.hour },
      inventory: this.inventory.serialize(),
      vegetation: this.world.vegetation.serialize(),
      harvest: this.harvest.serialize(),
      structures: this.building.serialize(),
      cooking: this.cooking.serialize(),
      camp: this.camp.serialize(),
      items: this.worldItems.serialize(),
      enemies: this.enemies.serialize(),
      animals: this.animals.serialize(),
      weather: this.climate.weather.serialize(),
      explored: this.exploration.serialize(),
      camps: [...this.discoveredCamps],
      journal: this.journal.serialize(),
      caves: this.caves.serialize(),
      ...(this.settlement ? { town: this.settlement.serialize() } : {}),
      places: this.places.serialize(),
      story: { ...this.story },
      skills: this.skills.serialize(),
      talents: this.skills.serializePerks(),
      worldEvents: this.worldEvents.serialize(),
      quests: this.quests.serialize(),
      ...(this.survivors ? { survivors: this.survivors.serialize() } : {}),
      ...(this.companion ? { companion: this.companion.serialize() } : {}),
    };
  }

  /** Stellt einen Spielstand in der frisch erzeugten Welt wieder her (nur beim Start). */
  private applySave(d: SaveData): void {
    // Erst den Rucksack vergrößern, sonst würden die zusätzlichen Plätze beim Laden abgeschnitten.
    if (d.player.backpack) this.upgradeBackpack();
    this.player.stats.clothing = d.player.clothing === true;
    this.player.stats.armor = d.player.armor === true;
    this.inventory.load(d.inventory, isItemId);
    this.world.vegetation.load(d.vegetation);
    this.harvest.load(d.harvest);
    const structures = this.building.load(d.structures, isStructureId);
    this.houseBases?.refresh();
    this.cooking.load(d.cooking, structures);
    this.camp.load(d.camp, structures);
    this.worldItems.load(d.items, isItemId);
    this.enemies.load(d.enemies);
    this.animals.load(d.animals);

    const p = d.player;
    const s = this.player.stats;
    // In einer Höhle gespeichert: Innenraum (samt Kollision) muss vor dem Aufsetzen stehen.
    if (d.caves) this.caves.load(d.caves);
    if (d.town) this.settlement?.load(d.town);
    if (d.places) this.places.load(d.places);
    if (d.skills) this.skills.load(d.skills);
    this.skills.loadPerks(d.talents);
    if (d.worldEvents) this.worldEvents.load(d.worldEvents);
    if (d.quests) this.quests.load(d.quests);
    if (d.story) this.story = { ...this.story, ...d.story };
    if (d.survivors) this.survivors?.load(d.survivors);
    this.companion?.load(d.companion, isItemId);
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
    this.quests.markRead(this.journal.notes);
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
    this.skillsUI.hide();
    this.hud.inventoryOpen = false;
    this.mode = 'playing';
    // Ohne gültige User-Geste (z. B. Esc) verweigert der Browser den Pointer Lock → Pausenmenü.
    void this.input.requestLock().then((ok) => {
      if (!ok && this.mode === 'playing') this.pause();
    });
  }

  /** Klick auf ein Rezept: Item herstellen bzw. mit dem Bauplan in den Baumodus wechseln. */
  private craft(recipe: Recipe): void {
    const cost = recipe.kind === 'structure' ? this.building.costOf(getStructure(recipe.result)) : recipe.cost;
    if (!this.crafting.canAfford(cost)) {
      this.audio.play('denied');
      this.events.emit('hud:message', { text: `Material fehlt für: ${recipeName(recipe)}` });
      return;
    }
    if (!this.crafting.canMake(recipe)) {
      this.audio.play('denied');
      this.events.emit('hud:message', { text: `${recipeName(recipe)}: Dafür brauchst du eine Werkbank in der Nähe.` });
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
    // An der Werkbank hergestellte Werkzeuge halten ein Viertel länger.
    // An der Werkbank gefertigte Waffen geraten manchmal besser (ungewöhnlich, selten selten).
    const bench = this.nearWorkbench();
    const roll = Math.random();
    const weapon = isWeapon(recipe.result) && bench && roll < 0.4 ? weaponOf(roll < 0.08 ? 'rare' : 'uncommon') : undefined;
    const rest = this.crafting.craftItem(recipe, this.skills.craftedDurability * (bench ? 1.25 : 1), weapon);
    if (rest === null) return;
    if (rest > 0) this.worldItems.spawn(recipe.result, rest, this.player.position.clone().add(new THREE.Vector3(0, 1, 0)));
    this.audio.play('craft');
    this.events.emit('item:crafted', { item: recipe.result, count: recipe.count });
    this.events.emit('hud:message', { text: `${recipeName(recipe)} hergestellt.` });
  }

  /** Steht der Spieler an einer Werkbank? */
  private nearWorkbench(): boolean {
    const p = this.player.position;
    return this.building.structures.some((s) => s.def.camp === 'workbench' && s.position.distanceTo(p) < WORKBENCH_RADIUS);
  }

  /**
   * Waffenmod anbringen – an der Werkbank, auf die Waffe in der Hand (Rechtsklick auf den Mod) oder auf
   * die, auf die er im Inventar gezogen wurde.
   * @returns true, wenn der Versuch behandelt wurde (auch abgelehnt); false, wenn es kein Mod ist.
   */
  private applyMod(modSlot: number, weaponSlot = this.tools.selected): boolean {
    const mod = this.inventory.get(modSlot);
    const element = mod ? getItem(mod.id).mod : undefined;
    if (!mod || !element) return false;
    const deny = (text: string): true => {
      this.audio.play('denied');
      this.events.emit('hud:message', { text });
      return true;
    };
    const target = this.inventory.get(weaponSlot);
    if (!target?.weapon) return deny('Nimm die Waffe in die Hand, die den Mod bekommen soll – oder zieh ihn im Inventar auf die Waffe.');
    const name = weaponName(target.id, target.weapon);
    if (!this.nearWorkbench()) return deny('Mods lassen sich nur an der Werkbank anbringen.');
    if (!canMod(target.weapon)) return deny(`${name} ist zu gewöhnlich für einen Mod – das geht erst ab „Ungewöhnlich“ (grün).`);
    if (target.weapon.mod === element) return deny(`${name} trägt diesen Mod schon.`);
    const old = target.weapon.mod;
    this.inventory.takeFromSlot(modSlot, 1);
    this.inventory.setMod(weaponSlot, element);
    this.audio.play('craft');
    const replaced = old ? ` (ersetzt ${ELEMENTS[old].name})` : '';
    this.events.emit('hud:message', { text: `${name}: ${ELEMENTS[element].name}-Mod angebracht${replaced}.` });
    return true;
  }

  /** Werkzeug in der Hand, das abgenutzt ist und sich an der Werkbank ausbessern lässt. */
  private repairableHeld(): boolean {
    const stack = this.inventory.get(this.tools.selected);
    if (!stack || !REPAIRABLE.has(stack.id)) return false;
    const max = maxDurability(stack.id, stack.weapon) ?? 0;
    return stack.durability !== undefined && stack.durability < max * 0.95;
  }

  private repairHeld(): boolean {
    if (!this.repairableHeld()) return false;
    if (!this.crafting.consume(TOOL_REPAIR_COST)) {
      this.audio.play('denied');
      this.events.emit('hud:message', { text: 'Zum Ausbessern brauchst du 1 Stock und 1 Stein.' });
      return false;
    }
    const stack = this.inventory.get(this.tools.selected)!;
    this.inventory.restore(this.tools.selected);
    this.events.emit('hud:message', { text: `${getItem(stack.id).name} ausgebessert.` });
    return true;
  }

  /** Schlafen im Unterstand oder Bett: abblenden, Zeit auf den Morgen setzen, Aufwachpunkt merken. */
  private sleep(shelter: Structure): void {
    if (!this.dayNight.isSleepTime || this.sleepTimer > 0 || this.feverState === 'night') return;
    this.sleepTimer = 2.4;
    this.sleepApplied = false;
    this.sleepComfort = shelter.def.comfort === true;
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
      // Im Bett schläft man tiefer: volle Gesundheit, und die Nacht zehrt weniger.
      const bed = this.sleepComfort;
      s.hunger = Math.max(5, s.hunger - (bed ? 10 : 18));
      s.thirst = Math.max(5, s.thirst - (bed ? 12 : 22));
      s.stamina = s.max;
      s.health = bed ? s.max : Math.min(s.max, s.health + 25);
      this.hud.faded = false;
      this.events.emit('hud:message', {
        text: bed ? 'Im eigenen Bett ausgeschlafen – du fühlst dich wie neu. Hier wachst du künftig auf.' : 'Du hast bis zum Morgen geschlafen. Hier wachst du künftig auf.',
      });
      this.events.emit('player:slept', {});
      this.saveNow();
    }
  }

  /** Im Moor: Blick auf den Schlamm zu den Füßen → damit einreiben (Tarnung). */
  private mudAction(): { prompt: Prompt; run: () => void } | null {
    const p = this.player;
    if (this.caves.current || p.swimming || p.carrier || p.pitch > -0.55) return null;
    const hm = this.world.heightMap;
    const ground = hm.heightAt(p.position.x, p.position.z);
    if (ground > hm.waterLevel + 0.9) return null;
    if (hm.biomes.weights(p.position.x, p.position.z, this.tmpBiome).swamp < 0.5) return null;
    return {
      prompt: { key: 'E', action: p.mud > 0 ? 'Schlamm auffrischen' : 'Mit Schlamm tarnen', label: 'Moorschlamm' },
      run: () => {
        p.mud = MUD_TIME;
        this.audio.play('stepWater', 0.9);
        this.particles.burst(p.position.clone().setY(p.position.y + 0.3), { count: 14, color: 0x3a2e1e, speed: 1.6, size: 0.04 });
        this.events.emit('hud:message', { text: 'Mit Schlamm eingerieben – Schrate sehen dich schlechter. Wasser und Regen waschen ihn ab.' });
      },
    };
  }

  /** Schlamm trocknet mit der Zeit ab; Regen wäscht ihn schneller, Schwimmen sofort ab. */
  private updateMud(dt: number): void {
    const p = this.player;
    if (p.mud <= 0) return;
    const rain = this.climate.sheltered ? 0 : this.climate.weather.rain;
    p.mud = Math.max(0, p.mud - dt * (p.swimming ? 40 : 1 + 3 * rain));
    if (p.mud === 0) this.events.emit('hud:message', { text: 'Der Schlamm ist abgewaschen.' });
  }

  /** Talente: setzt die Stellschrauben der betroffenen Systeme (billig, daher jedes Frame). */
  private applyPerks(): void {
    const has = (id: PerkId) => this.skills.has(id);
    const p = this.player;
    // Auf den Nachbarinseln liegt bessere Beute (dorthin kommt man nur mit dem Floß).
    const onIslet = this.world.heightMap.islets.some((i) => Math.hypot(p.position.x - i.x, p.position.z - i.z) < i.radius * 1.2);
    this.items.luck = onIslet ? 1.2 : 0;
    this.harvest.extraLogs = has('lumberjack') ? 1 : 0;
    this.harvest.noiseFactor = has('quietAxe') ? 0.5 : 1;
    this.interaction.pickupCount = has('pebbles') ? 2 : 1;
    this.climate.fireRainFactor = has('firekeeper') ? 2 : 1;
    p.blockFactor = has('parry') ? 0.1 : 0.2;
    p.blockStamina = has('parry') ? 0.5 : 1;
    this.tools.staggerAll = has('stagger');
    this.projectiles.arrowsKeep = has('recover');
    this.projectiles.headBonus = has('headhunter') ? 1.5 : 1;
    this.projectiles.stoneNoise = STONE_NOISE * (has('lure') ? 2 : 1);
    this.enemies.sneakFactor = has('assassin') ? 1.5 : 1;
    p.stats.coldFactor = has('hardy') ? 0.5 : 1;
    this.animals.bonusYield = has('hunter') ? 1 : 0;
    this.tools.cookBonus = has('cook');
    this.defenses.trapFactor = has('trapper') ? 1.5 : 1;
    Enemy.trapFactor = this.defenses.trapFactor;
    this.building.enemyDamageFactor = has('builder') ? 0.67 : 1;
    this.building.autoRearm = has('autoTrap');
    p.sprintFactor = has('runner') ? 1.12 : 1;
    p.stats.swimFactor = has('swimmer') ? 0.5 : 1;
    p.damageTaken = has('tough') ? 0.8 : 1;
    p.fallFactor = has('climber') ? 1.4 : 1;
    this.ropes.speedFactor = has('climber') ? 2 : 1;
  }

  /** Fertigkeiten wirken auf den Spieler; Bewegung und Schleichen bringen laufend Erfahrung. */
  private updateSkills(dt: number, playing: boolean): void {
    const p = this.player;
    const sk = this.skills;
    p.stealthNoise = sk.noise;
    p.stealthVisibility = sk.visibility;
    this.applyPerks();
    if (playing) this.updateMud(dt);
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
  /** Hinweis am Funkgerät der Station. */
  private usePrompt(id: string): { key: 'E' | null; action: string; label?: string } {
    if (id === 'lookout') return { key: 'E', action: 'Rundblick', label: 'Fernglas' };
    if (id === 'telescope') return { key: 'E', action: 'Durchschauen', label: 'Teleskop' };
    if (id !== 'transmitter') return { key: null, action: '…' };
    if (this.story.transmitted) return { key: null, action: 'Funkgerät', label: 'Nur noch Rauschen' };
    return { key: 'E', action: 'Funkspruch absetzen', label: 'Funkgerät' };
  }

  /** Funkgerät benutzen: braucht Strom und einen Beweis, dann antwortet das Festland. */
  private useThing(id: string): void {
    if (id === 'lookout') return this.lookout();
    if (id === 'telescope') return this.telescope();
    if (id !== 'transmitter' || this.story.transmitted) return;
    const inv = this.inventory;
    if (inv.count('battery') < 2) {
      this.events.emit('hud:message', { text: 'Das Funkgerät ist tot. Es braucht Strom – zwei Batterien.' });
      return;
    }
    if (inv.count('documents') < 1) {
      this.audio.play('radioStatic', { volume: 0.5 });
      this.events.emit('hud:message', {
        text: '„Festland, bitte kommen …“ – Rauschen, dann: „Die Insel ist gesperrt. Ende.“ Ohne Beweise glaubt dir niemand.',
      });
      return;
    }
    inv.remove('battery', 2);
    this.story.transmitted = true;
    this.audio.play('radioStatic', { volume: 0.6 });
    this.events.emit('hud:message', { text: 'Verbindung zum Festland!' });
    this.readNote('funkspruch');
  }

  /** Fernglas im Feuerwachturm: deckt die Karte weit ums Land auf. */
  private lookout(): void {
    const site = this.places.site('tower');
    if (!site) return;
    this.exploration.reveal(site.position.x, site.position.z, 560);
    this.audio.play('pickup', { volume: 0.5 });
    this.events.emit('hud:message', { text: 'Durchs Fernglas siehst du die halbe Insel – Dächer, Wege, Rauch über der Zeche. Die Karte (M) zeigt jetzt das Umland.' });
  }

  /** Sternwarte: nachts zeigt das tief gestellte Teleskop die Lichter aller Orte der Insel. */
  private telescope(): void {
    if (!this.dayNight.isNight) {
      this.events.emit('hud:message', { text: 'Bei Tag zeigt das Teleskop nur Dunst und blassen Himmel. Nachts wiederkommen.' });
      return;
    }
    const n = this.places.sightAll();
    this.audio.play('pickup', { volume: 0.5 });
    this.events.emit('hud:message', {
      text: n
        ? `Tief gestellt zeigt das Teleskop Lichter über der ganzen Insel. ${n === 1 ? 'Ein neuer Ort ist' : `${n} neue Orte sind`} jetzt auf der Karte (M) eingetragen.`
        : 'Du kennst jedes Licht da draußen schon. Nur eins bewegt sich – auf dich zu.',
    });
  }

  /** Mit der Möwe ablegen: Abspann. Danach kann man auf der Insel weiterspielen. */
  private depart(): void {
    this.mode = 'ending';
    this.dialogueUI.hide();
    this.noteUI.hide();
    this.mapUI.hide();
    this.journalUI.hide();
    this.saveNow();
    this.hud.visible = false;
    this.input.exitLock();
    this.audio.play('craft', { volume: 0.4 });
    const notes = this.journal.notes;
    const mama = notes.has('anne');
    const paragraphs = [
      'Im ersten Licht legt die Möwe ab. Jonas steht am Ruder und flucht leise auf den Motor, der hustet, aber läuft. ' +
        'Dr. Albers hält die Akte mit beiden Armen fest, als könnte der Wind sie ihr noch nehmen.',
      mama
        ? 'Mia sitzt am Heck und liest den Brief ihrer Mutter, wieder und wieder, bis die Insel hinter ihnen im Nebel verschwindet. Dann faltet sie ihn sorgfältig zusammen.'
        : 'Mia sitzt am Heck und schaut zum Wald zurück. Sie fragt nicht mehr nach ihrer Mama. Noch nicht.',
      this.story.hansen
        ? 'Im Berg ist es still geworden, seit Hansen, der Erste, gefallen ist. Ob die Schrate das spüren, weiß niemand.'
        : 'Hinter ihnen, tief im Berg, ruft etwas nach den Seinen. Am Steinkreis brennt das Feuer weiter.',
      'In Nordheim wartet ein Ausschuss. Die Akte reicht, um die Zeche für immer zu versiegeln und die Betriebsleitung vor Gericht zu bringen. ' +
        'Die Insel bleibt gesperrt. Aber ihr seid frei.',
      'Für die Welt ist der Charterflug D-EKLA verschollen. Du weißt es besser.',
    ];
    const days = this.dayNight.day;
    const kills = this.story.kills;
    const stats = `${days} ${days === 1 ? 'Tag' : 'Tage'} überlebt · ${kills} ${kills === 1 ? 'Schrat' : 'Schrate'} besiegt · ${notes.size} von ${NOTES.length} Notizen gefunden`;
    this.endingUI.show({ title: 'Heimweg', paragraphs, stats }, () => {
      this.story.ended = true;
      this.hud.visible = true;
      this.events.emit('story:ended', {});
      this.events.emit('hud:message', { text: 'Die Insel lässt dich nicht ganz los. Es gibt noch Orte, die du nicht gesehen hast …' });
      void this.input.requestLock();
    });
  }

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

  /** Ben sitzt verletzt in der Baracke der Funkstation. */
  private createCompanion(): void {
    const site = this.places.site('radio');
    if (!site) return;
    // Lokal (x, z) → Welt wie in PlaceMeshes (Drehung um Y); hinten links in der Baracke, Blick zur Tür.
    const lx = -4.6;
    const lz = -0.4;
    const c = Math.cos(site.yaw);
    const sn = Math.sin(site.yaw);
    const x = site.position.x + lx * c + lz * sn;
    const z = site.position.z - lx * sn + lz * c;
    const y = this.world.heightMap.heightAt(site.position.x, site.position.z) + 0.3;
    this.companion = new Companion({
      physics: this.physics,
      nav: this.enemies.nav,
      characters: this.characters,
      player: this.player,
      inventory: this.inventory,
      items: this.items,
      enemies: this.enemies,
      building: this.building,
      vegetation: this.world.vegetation,
      harvest: this.harvest,
      worldItems: this.worldItems,
      audio: this.audio,
      events: this.events,
      particles: this.particles,
      gore: this.gore,
      spawn: { position: new THREE.Vector3(x, y, z), yaw: site.yaw + Math.PI / 2 },
      home: () => this.respawnPoint,
      playerHidden: () => !!this.caves.current,
    });
    this.companion.heldSlot = () => this.tools.selected;
    this.scene.add(this.companion.group);
  }

  /** Gespräch mit einem Überlebenden beginnen (Antworten über die Zifferntasten). */
  private talkTo(npc: { id: string; name: string }): void {
    const companion = npc.id === COMPANION_ID ? this.companion : null;
    if (!companion && !this.survivors) return;
    this.noteUI.hide();
    this.mapUI.hide();
    this.journalUI.hide();
    if (companion) this.dialogueUI.show({ npc: companion.def, text: companion.greeting(), options: companion.options() });
    else this.dialogueUI.show(this.survivors!.talk(npc.id as NpcDef['id']));
    this.noteAt.copy(this.player.position);
  }

  /** Zifferntasten wählen eine Antwort; `E` oder Weggehen beendet das Gespräch. */
  private updateDialogue(playing: boolean): void {
    const ui = this.dialogueUI;
    if (!ui.open) return;
    if (!playing || this.player.position.distanceTo(this.noteAt) > 4) {
      ui.hide();
      return;
    }
    const keys = ['hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6'] as const;
    const i = keys.findIndex((k) => this.input.wasPressed(k));
    if (i < 0) return;
    const npc = ui.npc!;
    const companion = npc.id === COMPANION_ID ? this.companion : null;
    if (companion) {
      ui.choose(i, () => companion.options());
      return;
    }
    const survivors = this.survivors;
    const def = survivors?.getDef(npc.id);
    if (!survivors || !def) return ui.hide();
    if (ui.choose(i, () => survivors.options(def))) survivors.gesture(def.id);
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

  /** Schrate und Wölfe in der Nähe – für Fallen und Brandherde. */
  /** Fußpunkte der Schrate und Wölfe in der Nähe (für die Spuren im Bodennebel). */
  private *nearbyFeet(): Generator<THREE.Vector3> {
    const p = this.player.position;
    for (const who of this.intruders()) if (!who.isDead && who.feet.distanceToSquared(p) < 30 * 30) yield who.feet;
  }

  private *intruders(): Generator<Intruder> {
    const cache = this.intruderCache;
    for (const e of [...this.enemies.enemies, ...this.enemies.caveDwellers]) {
      if (!e.active || e.isDead) continue;
      let w = cache.get(e);
      if (!w) {
        const enemies = this.enemies;
        w = {
          kind: 'schrat',
          get feet() {
            return e.feet;
          },
          get isDead() {
            return e.isDead;
          },
          hurt: (amount, from) => void enemies.hurt(e, amount, from),
          stun: (seconds) => e.stun(seconds),
          ignite: (seconds) => this.elementFx.ignite(e, seconds),
        };
        cache.set(e, w);
      }
      yield w;
    }
    for (const a of this.animals.animals) {
      if (a.species !== 'wolf' || a.isDead || !a.active) continue;
      let w = cache.get(a);
      if (!w) {
        const animals = this.animals;
        w = {
          kind: 'wolf',
          get feet() {
            return a.feet;
          },
          get isDead() {
            return a.isDead;
          },
          hurt: (amount, from) => void animals.hurt(a, amount, from),
        };
        cache.set(a, w);
      }
      yield w;
    }
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
    if (use === 'armor') {
      if (this.player.stats.armor) {
        this.events.emit('hud:message', { text: 'Du trägst schon eine Rüstung.' });
        return;
      }
      this.inventory.takeFromSlot(slot, 1);
      this.player.stats.armor = true;
      this.audio.play('craft');
      this.events.emit('hud:message', { text: 'Knochenrüstung angelegt – sie fängt Schläge ab, klappert aber hörbar.' });
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
    if (getItem(stack.id).mod) {
      this.applyMod(slot);
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
    this.frameDt = dt;
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
    if (this.mode === 'playing' && this.input.wasPressed('skills') && this.sleepTimer <= 0) {
      // Fertigkeiten mit Mauszeiger: Talente wählt man per Klick.
      this.mapUI.hide();
      this.journalUI.hide();
      this.noteUI.hide();
      this.building.cancel();
      this.mode = 'inventory';
      this.hud.inventoryOpen = true;
      this.skillsUI.show();
      this.input.exitLock();
    } else if (this.mode === 'inventory' && this.skillsUI.open && this.input.wasPressed('skills')) {
      this.closeInventory();
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

    // Trefferstopp und Zeitlupe verlangsamen die Spielwelt, nicht aber Menüs und Anzeige.
    if (this.mode === 'playing' || this.mode === 'inventory') this.simulate(dt * this.combat.timeScale(dt));

    this.render();
    const building = this.building.isActive;
    // Während die Schnur draußen ist, zeigt der Hinweis die Angel; sonst hat das anvisierte Ziel Vorrang.
    const fishingPrompt = this.fishing.busy ? this.fishing.prompt : null;
    const prompt = this.mode === 'playing' && !building ? (fishingPrompt ?? this.interaction.prompt ?? this.fishing.prompt) : null;
    const fever = feverLabel(this.dayNight.day, this.dayNight.hour);
    const where = (this.caves.current ? ` · ${this.caves.current.name}` : '') + (fever ? ` · ${fever}` : '');
    const clock = this.dayNight.clockText.replace(' · ', ` · ${this.climate.season.name} · `) + where;
    const boss = this.enemies.activeBoss;
    this.hud.setBoss(boss ? { name: boss.kind.name, fraction: boss.health / boss.maxHealth } : null);
    this.hud.update(dt, this.player, clock, prompt, this.tools.selected, this.buildHint());
    this.damageNumbers.update(dt, this.camera, window.innerWidth, window.innerHeight);
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
    this.beginFireFrame();
    this.dayNight.timeScale = this.hud.debugVisible && this.input.isDown('timeWarp') ? 120 : 1;

    // Fester Physik-Takt
    const t0 = performance.now();
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= step && steps < this.config.physics.maxSubSteps) {
      player.fixedUpdate(step);
      this.enemies.fixedUpdate(step);
      this.animals.fixedUpdate(step);
      this.companion?.fixedUpdate(step);
      this.worldItems.fixedUpdate(step, water);
      this.physics.step();
      player.afterPhysicsStep();
      this.enemies.afterPhysicsStep();
      this.animals.afterPhysicsStep();
      this.companion?.afterPhysicsStep();
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
    if (playing && !building && this.input.wasPressed('repair')) this.interaction.repair();
    this.updateDialogue(playing);
    if (this.noteUI.open && (player.position.distanceTo(this.noteAt) > 3.5 || this.mode !== 'playing')) this.noteUI.hide();
    // Im Gespräch wählen die Zifferntasten Antworten statt Werkzeuge (und es wird nicht zugeschlagen).
    this.tools.update(dt, playing && !building && !this.dialogueUI.open);
    this.combat.update(dt, playing && !building && !this.dialogueUI.open, this.tools.busy);
    this.harvest.update(dt);
    this.building.update(dt, player.position);
    this.defenses.rain = this.climate.weather.rain * (1 - this.climate.season.snowfall * 0.5);
    this.defenses.update(dt);
    this.enemies.update(dt, alpha);
    this.elementFx.update(dt);
    this.gore.update(dt);
    this.explosives.update(dt);
    this.animals.update(dt, alpha);
    this.projectiles.update(alpha);
    this.cooking.update(dt);
    this.rafts.update(dt);
    this.ropes.update();
    this.camp.update(dt, { rain: this.climate.weather.rain * (1 - this.climate.season.snowfall), winter: this.climate.season.snow > 0.4 });
    this.caves.update(this.dayNight.daylight);
    this.worldItems.update();
    this.particles.update(dt);
    this.embers.update(dt);
    player.stats.warm = this.building.isNearLitFire(player.position) || !!this.survivors?.isNearFire(player.position);
    this.survivors?.update(dt, player.position, this.caves.current ? 0 : 1 - this.dayNight.daylight);
    if (this.companion) {
      this.companion.update(dt, alpha);
      this.building.costFactor = this.companion.helpsBuilding ? 0.75 : 1;
    }
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
    this.updateLightning(dt);
    this.places.update(dt, player.position, this.dayNight.isNight, !!this.caves.current);
    this.fogWake.update(dt, player.position, this.nearbyFeet());
    this.blood.update(dt);
    // Kiste zerstört oder zu weit weg → Fenster schließen.
    const chest = this.openChest;
    if (chest && (!this.building.structures.includes(chest) || chest.position.distanceTo(player.position) > 4.5)) this.closeInventory();

    this.dayNight.update(dt, this.elapsed, player.position, player.headUnderwater, this.climate.look);
    this.scene.environmentIntensity = environmentIntensity(this.dayNight.daylight, this.dayNight.underground, this.climate.look.clouds);
    this.world.update(dt, this.elapsed, player.position);
    this.world.water.setEnvironment(
      this.dayNight.lightDirection(this.tmpWaterDir),
      this.dayNight.light.color,
      this.dayNight.light.intensity,
      this.climate.weather.rain * (1 - this.climate.season.snowfall),
    );
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
    // Mündungsfeuer: ein kurzer, heller Blitz vor der Waffe erhellt die Umgebung.
    this.muzzleTime -= dt;
    if (this.muzzleTime > 0) {
      this.camera.getWorldDirection(this.tmpDir);
      this.muzzleLight.position.copy(this.camera.position).addScaledVector(this.tmpDir, 1.2);
      this.muzzleLight.intensity = 60 * (this.muzzleTime / 0.07);
      this.lights.request(this.muzzleLight);
    }
    // Zielfernrohr: voll angelegt sieht man nur noch durchs Glas.
    const scoped = this.tools.equipped?.id === 'huntingRifle' && this.viewModel.adsLevel > 0.9;
    this.hud.setScope(scoped);
    this.scoped = scoped;
    this.hud.setAmmo(this.tools.ammoInfo);
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
    this.atmosphere.update(dt, {
      listener: this.camera.position,
      daylight: this.dayNight.daylight,
      hour: this.dayNight.hour,
      wind: this.climate.weather.wind,
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
      places: this.places.markers,
    });
    const explored = document.querySelector('[data-ref="mapExplored"]');
    if (explored) explored.textContent = `${Math.round(this.exploration.fraction * 100)} % der Karte erkundet`;
  }

  /** Debug-Waffenkammer: alles zum Ausprobieren (was nicht passt, fällt vor die Füße). */
  private giveArmory(): void {
    const at = this.player.position;
    for (const id of ARMORY_WEAPONS) this.items.give(id, 1, at, undefined, weaponOf('rare'));
    for (const [id, count] of ARMORY_SUPPLIES) this.items.give(id, count, at);
    this.events.emit('hud:message', { text: 'Waffenkammer: Schusswaffen, Munition, Nahkampfwaffen und Rohrbomben.' });
  }

  /** Wetter, Nässe, Regenwasser in der Schale, Fackel im Regen. */
  private updateClimate(dt: number): void {
    const held = this.tools.equipped?.id;
    const climate = this.climate;
    if (this.hud.debugVisible && this.input.wasPressed('armory')) this.giveArmory();
    if (this.hud.debugVisible && this.input.wasPressed('weather')) {
      climate.weather.advance();
      this.events.emit('hud:message', { text: `Wetter: ${climate.weatherName}` });
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
    const tracks = this.snowTracks;
    tracks.snow = climate.season.snow;
    tracks.snowfall = climate.season.snowfall * climate.weather.rain;
    tracks.enabled = !this.caves.current;
    tracks.update(dt);
    // Atemwolken: im Winter immer, im Herbst in kalten Nächten; nicht im Wasser und nicht in Höhlen.
    const p = this.player;
    const season = climate.season;
    const cold = this.caves.current || p.headUnderwater ? 0 : (season.chill * (this.dayNight.isNight ? 1 : 0.6) + 0.3 * climate.blizzard - 0.22) / 0.4;
    const moving = Math.hypot(p.velocity.x, p.velocity.z) > 0.6;
    const light = Math.max(this.dayNight.daylight, this.heldLight() ? 0.6 : 0);
    this.breath.update(dt, this.camera, THREE.MathUtils.clamp(cold, 0, 1), p.sprinting && moving ? 1 : moving ? 0.3 : 0, light);
    // Schwebstaub im Lichtkegel, Glühwürmchen in warmen Nächten.
    const viewH = this.renderer.domElement.height;
    this.motes.update(this.elapsed, this.camera, viewH, this.flashlight, this.lights.lights, p.headUnderwater ? 0 : 1);
    const night = 1 - this.dayNight.daylight;
    const flies = Fireflies.amount(night, season.chill, season.snow, climate.weather.rain, !!this.caves.current);
    this.fireflies.update(dt, this.elapsed, this.camera, viewH, p.position, flies);
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
      cost: this.building.costOf(def).map((c) => ({ item: c.item, have: this.inventory.count(c.item), need: c.count })),
    };
  }

  private render(): void {
    this.renderer.info.reset();
    this.camera.updateMatrixWorld();
    this.shadows.update(this.dayNight.light);
    const overlay = this.viewModel.visible && this.mode !== 'dead' && !this.scoped ? this.viewModel : null;
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
          blizzard: this.climate?.blizzard ?? 0,
          cameraY: this.camera.position.y,
          fogColor: this.dayNight.fog.color,
        },
        this.look ?? undefined,
      ));
      this.postFX.render(this.renderer, this.scene, this.camera, {
        lightDir: this.dayNight.lightDirection(this.tmpDir),
        lightColor: this.dayNight.light.color,
        rays: this.dayNight.rayStrength,
        bloom: this.dayNight.daylight > 0.5 ? 0.45 : 0.62,
        underwater: this.player.headUnderwater,
        grade: look.grade,
        mist: look.mist,
        time: this.elapsed,
        // Der Gegenstand in der Hand bekommt denselben Filmlook (Korn, Farbstimmung), aber keinen Nebel.
        overlay,
        volumetric: this.volumetric(),
        heat: this.heatSources(),
        water: this.settings.quality === 'low' || this.caves.current ? null : this.world.water,
        cinema: {
          dt: this.frameDt,
          motionBlur: this.settings.motionBlur && this.mode === 'playing' ? 1 : 0,
          // Beim Zielen mit dem Bogen verschwimmt, was nicht im Fadenkreuz liegt.
          dof: this.mode === 'playing' ? THREE.MathUtils.smoothstep(this.player.zoom, 0.15, 0.9) : 0,
          adapt: this.mode !== 'dead',
        },
        lens: this.dayNight.daylight > 0.3 ? 0.05 : 0.08,
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

  /**
   * Sichtbarer Blitz zum Einschlag des Wetters. Ferne Einschläge werden in die Sichtweite geholt
   * (Richtung bleibt), damit der Kanal nicht hinter der Sichtgrenze verschwindet.
   */
  private strikeLightning(distance: number, angle: number): void {
    if (this.caves.current) return;
    const bolt = this.bolts.find((b) => !b.active) ?? this.bolts[0];
    const shown = Math.min(distance, 140 + (distance - 150) * 0.16);
    const p = this.player.position;
    const x = p.x + Math.sin(angle) * shown;
    const z = p.z + Math.cos(angle) * shown;
    const hm = this.world.heightMap;
    const ground = new THREE.Vector3(x, Math.max(hm.heightAt(x, z), hm.waterLevel), z);
    bolt.strike(ground, Math.max(0.8, shown / 150));
  }

  /** Blitze flackern: Himmel und Gelände leuchten mit jeder Nachentladung auf. */
  private updateLightning(dt: number): void {
    const w = this.climate.weather;
    let flash = 0;
    for (const b of this.bolts) {
      b.update(dt);
      if (b.brightness <= 0) continue;
      const near = 1 - THREE.MathUtils.clamp(b.ground.distanceTo(this.player.position) / 450, 0, 0.85);
      flash = Math.max(flash, b.brightness * near);
      this.boltLight.position.copy(b.ground).setY(b.ground.y + 140);
      this.boltLight.intensity = 2.5e4 * b.brightness * near;
      this.lights.request(this.boltLight);
    }
    w.flash = Math.max(w.flash, flash * 0.9);
    const lit = this.caves.current ? 0.15 : this.dayNight.daylight;
    this.hud.screenBlood.setLight(Math.max(lit, this.heldLight() ? 0.45 : 0, w.flash));
  }

  /** Feuer: gemeinsame Zeit, Rauchfarbe (Umgebungslicht) und Wind für Rauch und Funken. */
  private beginFireFrame(): void {
    const cave = !!this.caves.current;
    this.fireAmbient.copy(this.dayNight.fog.color).multiplyScalar(cave ? 0.4 : 1);
    FireEffect.beginFrame(this.elapsed, this.fireAmbient);
    const wind = cave ? 0 : this.climate.weather.wind;
    FireEffect.wind.set(0.94, 0.34).multiplyScalar(cave ? 0.05 : 0.25 + wind * 2.2);
  }

  /** Hitzeflimmern über den Feuern, die in diesem Bild brennen. */
  private heatSources(): HeatSource[] {
    const out = this.heat;
    out.length = 0;
    for (const f of FireEffect.heatSources) {
      if (out.length >= 8 || !f.object.parent) continue;
      let shown = true;
      for (let o: THREE.Object3D | null = f.object; o; o = o.parent) if (!o.visible) shown = false;
      if (!shown) continue;
      const pos = f.object.getWorldPosition(new THREE.Vector3());
      const size = f.size * f.object.getWorldScale(this.tmpScale).x;
      if (size > 0.05) out.push({ position: pos, size });
    }
    return out;
  }

  /** Licht im Nebel: Lichtkegel der Taschenlampe, Leuchthöfe um Feuer – nachts, im Regen und unter Tage. */
  private volumetric(): VolumetricLights | null {
    const cave = this.dayNight.underground > 0.5;
    const rain = this.climate?.weather.rain ?? 0;
    const blizzard = this.climate?.blizzard ?? 0;
    this.volLights.spot = this.flashlight;
    this.volLights.points = this.lights.lights;
    // Höhlenluft ist staubig, Regen und Schneetreiben streuen das Licht stark.
    this.volLights.air = (cave ? 0.035 : 0.014) + 0.02 * rain + 0.05 * blizzard;
    this.volLights.strength = cave ? 1 : THREE.MathUtils.lerp(1, 0.15, this.dayNight.daylight);
    // Sonnen- bzw. Mondstrahlen durchs Blätterdach; Wolken dämpfen sie, unter Tage gibt es keine.
    const clouds = this.climate?.weather.clouds ?? 0;
    // Die mittlere Kaskade deckt Spieler und Umgebung ab (die nahe reicht nur 30 m weit).
    this.volSun.light = this.shadows.lights[1];
    this.volSun.strength = cave ? 0 : 0.5 * (1 - 0.85 * clouds) * (this.dayNight.isNight ? 0.6 : 1);
    this.volLights.sun = this.volSun;
    // Bodennebel: im Morgengrauen dicht, nachts ein Schleier über dem Boden, im Schneetreiben verweht.
    const hour = this.dayNight.hour;
    const night = 1 - this.dayNight.daylight;
    const chill = this.climate?.season.chill ?? 0;
    const g = this.volGround;
    // Über dem Moor hängt der Nebel auch tagsüber.
    const swamp = this.world.heightMap.biomes.weights(this.player.position.x, this.player.position.z, this.biomeTmp).swamp;
    g.density = cave
      ? 0
      : 0.5 * THREE.MathUtils.clamp(morningMist(hour) + night * (0.4 + 0.4 * chill) + swamp * 0.55, 0, 1) * (1 - blizzard) * (1 - 0.4 * rain);
    g.ambient.copy(this.dayNight.fog.color).multiplyScalar(1.1);
    g.heightTexture = this.world.water.heightTexture;
    g.heightMapping = this.world.water.heightMapping;
    g.wakes = this.fogWake.wakes;
    this.volLights.ground = g;
    return this.settings.quality === 'low' ? null : this.volLights;
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
      `Wetter     ${this.climate.weatherName} · Wolken ${(this.climate.weather.clouds * 100).toFixed(0)} % · Regen ${(this.climate.weather.rain * 100).toFixed(0)} % · Nässe ${(this.player.stats.wetness * 100).toFixed(0)} %${this.climate.sheltered ? ' · unter Dach' : ''} (Y: weiter)`,
      `Wild       ${this.animals.aliveCount} Tiere · ${this.projectiles.count} Geschosse in der Luft`,
      `Zeit       ${this.dayNight.clockText}  (T halten = Zeitraffer)`,
      `Ereignisse ${this.worldEvents.active} aktiv`,
      `Fieber     ${feverLabel(this.dayNight.day, this.dayNight.hour) || '–'} · Horde ${this.enemies.hordeCount} (N: Fiebernacht)`,
      `Waffen     G: Waffenkammer (alle Schusswaffen, Munition, Rohrbomben)`,
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
    if (this.damageNumbers) this.damageNumbers.enabled = s.damageNumbers;
    if (this.gore) this.gore.enabled = s.gore;
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
    this.shadows?.setMapSize(q.shadowMapSize);
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
