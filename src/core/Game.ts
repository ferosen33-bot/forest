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
import { SaveStore, SAVE_VERSION, worldKey, type SaveData } from '../systems/SaveGame';
import { isStructureId } from '../systems/building/StructureDefs';
import { isItemId } from '../entities/items/ItemDefs';
import { Ambience } from '../systems/Ambience';
import { Footsteps } from '../systems/Footsteps';
import { PostFX } from '../systems/PostFX';

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
  readonly crafting = new Crafting(this.inventory);

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
  private autosaveTimer = 0;
  /** Erst speichern, wenn wirklich gespielt wurde (nicht schon im Startmenü) – und nie nach "Neues Spiel". */
  private saveEnabled = false;
  private lastSaved: Date | null = null;
  private readonly torchLight: LightRequest = {
    position: new THREE.Vector3(),
    color: new THREE.Color(),
    intensity: 0,
    distance: 0,
  };

  private constructor(private readonly opts: GameOptions) {
    this.config = opts.config ?? CONFIG;
    const g = this.config.graphics;

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

    this.menu.setLoading('Insel wird generiert …');
    await nextFrame();
    this.world = new World(this.scene, this.physics, cfg);
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
    const tEnemies = performance.now();
    this.enemies = new EnemyDirector({
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
      isPlayerLit: () => !!(this.tools.equipped && getItem(this.tools.equipped.id).light),
    });
    this.scene.add(this.enemies.group);
    this.ambience = new Ambience(this.audio, this.world.heightMap, this.world.vegetation);
    this.footsteps = new Footsteps(this.audio, this.world.heightMap, this.physics, this.building, this.events);
    this.enemies.onEnemyStep = (pos, speed) => this.footsteps.enemyStep(pos, speed);
    console.info(
      `[Enemies] Navigationsraster + ${this.enemies.camps.length} Lager in ${(performance.now() - tEnemies).toFixed(0)} ms`,
    );
    this.animals = new AnimalDirector({
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
    });
    this.scene.add(this.animals.group);
    this.cooking = new Cooking(this.building, this.items, this.audio, this.events);
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
    });
    this.scene.add(this.projectiles.group);
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
      items: this.items,
      audio: this.audio,
      events: this.events,
      config: cfg,
      canSleep: () => this.dayNight.isSleepTime,
      onSleep: (shelter) => this.sleep(shelter),
      heldItem: () => this.tools.equipped?.id ?? null,
      takeHeld: () => void this.inventory.takeFromSlot(this.tools.selected, 1),
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
    );

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

    this.menu.setLoading('Shader werden kompiliert …');
    await nextFrame();
    await this.renderer.compileAsync(this.scene, this.camera);

    this.wireEvents();
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
    };
  }

  /** Stellt einen Spielstand in der frisch erzeugten Welt wieder her (nur beim Start). */
  private applySave(d: SaveData): void {
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
    this.player.spawn(new THREE.Vector3(...p.p), p.yaw);
    this.player.pitch = p.pitch;
    const clampStat = (v: number) => Math.max(0, Math.min(s.max, Number.isFinite(v) ? v : s.max));
    // Wer tot gespeichert hat (sollte nicht vorkommen), wacht mit etwas Leben auf.
    s.health = Math.max(10, clampStat(p.health));
    s.stamina = clampStat(p.stamina);
    s.hunger = clampStat(p.hunger);
    s.thirst = clampStat(p.thirst);
    this.respawnPoint.set(...p.respawn);
    this.tools.select(Math.max(0, Math.min(this.inventory.hotbarSize - 1, p.selected | 0)));
    this.dayNight.day = Math.max(1, d.time.day | 0);
    this.dayNight.hour = ((d.time.hour % 24) + 24) % 24;
    this.lastSaved = new Date(d.savedAt);
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
      this.inventoryUI.hide();
      this.hud.inventoryOpen = false;
      this.input.exitLock();
      this.menu.showDeath(cause);
    });
  }

  private pause(): void {
    this.mode = 'paused';
    this.saveNow();
    this.menu.showPaused(this.lastSaved);
  }

  private openInventory(): void {
    this.mode = 'inventory';
    this.inventoryUI.show();
    this.hud.inventoryOpen = true;
    this.input.exitLock();
  }

  private closeInventory(): void {
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
      this.closeInventory();
      this.building.begin(recipe.result);
      return;
    }
    const rest = this.crafting.craftItem(recipe);
    if (rest === null) return;
    if (rest > 0) this.worldItems.spawn(recipe.result, rest, this.player.position.clone().add(new THREE.Vector3(0, 1, 0)));
    this.audio.play('craft');
    this.events.emit('item:crafted', { item: recipe.result, count: recipe.count });
    this.events.emit('hud:message', { text: `${recipeName(recipe)} hergestellt.` });
  }

  /** Schlafen im Unterstand: abblenden, Zeit auf den Morgen setzen, Aufwachpunkt merken. */
  private sleep(shelter: Structure): void {
    if (!this.dayNight.isSleepTime || this.sleepTimer > 0) return;
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
      this.saveNow();
    }
  }

  /** Rechtsklick im Inventar: Nahrung essen, alles andere in die Hand nehmen. */
  private useSlot(slot: number): void {
    const stack = this.inventory.get(slot);
    if (!stack) return;
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
      this.postFX.enabled = !this.postFX.enabled;
      this.dayNight.linearOutput = this.postFX.enabled;
      this.events.emit('hud:message', { text: `Nachbearbeitung ${this.postFX.enabled ? 'an' : 'aus'}` });
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
    const prompt = this.mode === 'playing' && !building ? this.interaction.prompt : null;
    this.hud.update(dt, this.player, this.dayNight.clockText, prompt, this.tools.selected, this.buildHint());
    if (this.hud.debugVisible) this.hud.updateDebug(this.debugLines());
    this.input.endFrame();
  };

  private simulate(dt: number): void {
    const step = this.config.physics.timestep;
    const player = this.player;
    this.updateSleep(dt);
    this.updateAutosave(dt);
    const playing = this.mode === 'playing' && this.sleepTimer <= 0;
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
    if (playing && !building && this.input.wasPressed('interact')) this.interaction.interact();
    this.tools.update(dt, playing && !building);
    this.harvest.update(dt);
    this.building.update(dt, player.position);
    this.enemies.update(dt, alpha);
    this.animals.update(dt, alpha);
    this.projectiles.update(alpha);
    this.cooking.update(dt);
    this.worldItems.update();
    this.particles.update(dt);
    this.embers.update(dt);
    player.stats.warm = this.building.isNearLitFire(player.position);

    this.dayNight.update(dt, this.elapsed, player.position, player.headUnderwater);
    this.world.update(dt, this.elapsed, player.position);
    this.viewModel.update(dt, this.camera, player, player.headBob, this.dayNight);

    // Fackel in der Hand → Licht an der Flamme.
    const light = this.tools.equipped ? getItem(this.tools.equipped.id).light : undefined;
    if (light && this.viewModel.getFlamePosition(this.torchLight.position)) {
      this.torchLight.color.set(light.color);
      this.torchLight.intensity = light.intensity * this.viewModel.flameFlicker;
      this.torchLight.distance = light.distance;
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
    });
    this.footsteps.updatePlayer(dt, player);
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
    if (this.postFX.enabled) {
      this.postFX.render(this.renderer, this.scene, this.camera, {
        lightDir: this.dayNight.lightDirection(this.tmpDir),
        lightColor: this.dayNight.light.color,
        rays: this.dayNight.rayStrength,
        bloom: this.dayNight.daylight > 0.5 ? 0.45 : 0.8,
        underwater: this.player.headUnderwater,
      });
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    // ViewModel in eigenem Durchgang über die Welt legen (Tiefenpuffer geleert).
    if (this.viewModel.visible && this.mode !== 'dead') {
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
      `Wild       ${this.animals.aliveCount} Tiere · ${this.projectiles.count} Geschosse in der Luft`,
      `Zeit       ${this.dayNight.clockText}  (T halten = Zeitraffer)`,
    ];
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
