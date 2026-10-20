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
import { renderItemIcons } from '../ui/ItemIcons';

export interface GameOptions {
  container: HTMLElement;
  hudRoot: HTMLElement;
  menuRoot: HTMLElement;
  inventoryRoot: HTMLElement;
  config?: GameConfig;
  /** Startet ohne Menü/Pointer Lock (für Tests & Screenshots). */
  autostart?: boolean;
}

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
  readonly viewModel = new ViewModel();
  readonly inventory = new Inventory(30, 6);

  physics!: Physics;
  world!: World;
  dayNight!: DayNightCycle;
  player!: Player;
  worldItems!: WorldItems;
  items!: ItemService;
  harvest!: HarvestSystem;
  interaction!: InteractionSystem;
  tools!: ToolController;
  hud!: HUD;
  inventoryUI!: InventoryUI;

  mode: GameMode = 'loading';
  private accumulator = 0;
  private lastTime = 0;
  private elapsed = 0;
  private fps = 60;
  private physicsMs = 0;
  private readonly tmpDir = new THREE.Vector3();

  private constructor(private readonly opts: GameOptions) {
    this.config = opts.config ?? CONFIG;
    const g = this.config.graphics;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
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

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(this.config.player.fov, aspect, 0.1, g.viewDistance);
    this.viewModel.setAspect(aspect);
    this.scene.add(this.particles.mesh);

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

    this.player = new Player(this.physics, this.camera, this.input, this.world.heightMap, this.events, cfg);
    this.player.spawn(this.world.spawnPoint, this.spawnYaw());

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
    this.interaction = new InteractionSystem(
      this.physics,
      this.camera,
      this.player,
      this.world.heightMap,
      this.world.vegetation,
      this.worldItems,
      this.harvest,
      this.items,
      this.audio,
      this.events,
      cfg,
    );
    this.tools = new ToolController(
      this.inventory,
      this.input,
      this.viewModel,
      this.interaction,
      this.harvest,
      this.player,
      this.audio,
      this.events,
    );

    // Startausrüstung: die Axt aus dem Flugzeugwrack.
    this.inventory.add('axe', 1);

    // UI (Icons werden aus den 3D-Modellen gerendert)
    const icons = renderItemIcons();
    this.hud = new HUD(this.opts.hudRoot, this.events, this.inventory, icons);
    this.inventoryUI = new InventoryUI(this.opts.inventoryRoot, this.inventory, icons, () => this.tools.selected);
    this.inventoryUI.onUse = (slot) => this.useSlot(slot);
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
    if (this.opts.autostart) {
      this.menu.hide();
      this.hud.visible = true;
      this.mode = 'playing';
    } else {
      this.mode = 'paused';
      this.menu.showStart();
    }
  }

  /** Blickrichtung beim Spawn: ins Inselinnere (Richtung Zentrum). */
  private spawnYaw(): number {
    const p = this.world.spawnPoint;
    return Math.atan2(p.x, p.z);
  }

  private wireEvents(): void {
    this.menu.onPlay = (wantsFullscreen) => {
      if (this.mode === 'dead') this.player.respawn(this.world.spawnPoint);
      this.audio.resume();
      if (wantsFullscreen) void this.enterFullscreen();
      void this.input.requestLock();
    };

    this.input.onLockChange = (locked) => {
      if (locked) {
        this.mode = 'playing';
        this.menu.hide();
        this.hud.visible = true;
        this.audio.resume();
        this.lastTime = performance.now();
      } else if (this.mode === 'playing') {
        this.pause();
      }
    };

    this.events.on('player:died', ({ cause }) => {
      this.mode = 'dead';
      this.inventoryUI.hide();
      this.hud.inventoryOpen = false;
      this.input.exitLock();
      this.menu.showDeath(cause);
    });
  }

  private pause(): void {
    this.mode = 'paused';
    this.menu.showPaused();
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
    if (this.mode === 'playing' && this.input.wasPressed('inventory')) this.openInventory();
    else if (this.mode === 'inventory' && (this.input.wasPressed('inventory') || this.input.wasPressed('cancel'))) {
      this.closeInventory();
    }

    if (this.mode === 'playing' || this.mode === 'inventory') this.simulate(dt);

    this.render();
    const prompt = this.mode === 'playing' ? this.interaction.prompt : null;
    this.hud.update(dt, this.player, this.dayNight.clockText, prompt, this.tools.selected);
    if (this.hud.debugVisible) this.hud.updateDebug(this.debugLines());
    this.input.endFrame();
  };

  private simulate(dt: number): void {
    const step = this.config.physics.timestep;
    const player = this.player;
    const playing = this.mode === 'playing';
    const water = this.world.heightMap.waterLevel;

    player.handleInput(playing);
    this.dayNight.timeScale = this.hud.debugVisible && this.input.isDown('timeWarp') ? 120 : 1;

    // Fester Physik-Takt
    const t0 = performance.now();
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= step && steps < this.config.physics.maxSubSteps) {
      player.fixedUpdate(step);
      this.worldItems.fixedUpdate(step, water);
      this.physics.step();
      player.afterPhysicsStep();
      this.accumulator -= step;
      steps++;
    }
    if (steps === this.config.physics.maxSubSteps) this.accumulator = 0;
    this.physicsMs = performance.now() - t0;

    if (player.isOutOfWorld) player.spawn(this.world.spawnPoint);

    player.updateCamera(dt, this.accumulator / step);
    // Raycasts (Interaktion, Werkzeuge) brauchen die Kamera-Matrix dieses Frames, nicht die des letzten.
    this.camera.updateMatrixWorld();
    this.elapsed += dt;

    // Gameplay
    this.interaction.update(this.tools.equippedTool);
    if (playing && this.input.wasPressed('interact')) this.interaction.interact();
    this.tools.update(dt, playing);
    this.harvest.update(dt);
    this.worldItems.update();
    this.particles.update(dt);

    this.dayNight.update(dt, this.elapsed, player.position, player.headUnderwater);
    this.world.update(dt, this.elapsed, player.position);
    this.viewModel.update(dt, this.camera, player, player.headBob, this.dayNight);
  }

  private render(): void {
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
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
      `Objekte    ${this.worldItems.size} Items · ${this.harvest.fallingCount} fallend · ${this.particles.activeCount} Partikel`,
      `Ziel       ${this.interaction.target?.type ?? '–'}`,
      `Zeit       ${this.dayNight.clockText}  (T halten = Zeitraffer)`,
    ];
  }

  private handleResize = (): void => {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.viewModel.setAspect(aspect);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
