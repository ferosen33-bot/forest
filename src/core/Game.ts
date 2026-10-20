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
  /** Leuchtende Partikel (Glut). */
  readonly embers = new Particles(250, true);
  readonly viewModel = new ViewModel();
  readonly inventory = new Inventory(30, 6);
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
  private readonly torchLight: LightRequest = {
    position: new THREE.Vector3(),
    color: new THREE.Color(),
    intensity: 0,
    distance: 0,
  };

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
    this.interaction = new InteractionSystem({
      physics: this.physics,
      camera: this.camera,
      player: this.player,
      heightMap: this.world.heightMap,
      vegetation: this.world.vegetation,
      worldItems: this.worldItems,
      harvest: this.harvest,
      building: this.building,
      items: this.items,
      audio: this.audio,
      events: this.events,
      config: cfg,
      canSleep: () => this.dayNight.isSleepTime,
      onSleep: (shelter) => this.sleep(shelter),
    });
    this.tools = new ToolController(
      this.inventory,
      this.input,
      this.viewModel,
      this.interaction,
      this.harvest,
      this.building,
      this.player,
      this.audio,
      this.events,
    );

    // Startausrüstung: die Axt aus dem Flugzeugwrack.
    this.inventory.add('axe', 1);

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
      if (this.mode === 'dead') this.player.respawn(this.respawnPoint);
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
      this.worldItems.fixedUpdate(step, water);
      this.physics.step();
      player.afterPhysicsStep();
      this.accumulator -= step;
      steps++;
    }
    if (steps === this.config.physics.maxSubSteps) this.accumulator = 0;
    this.physicsMs = performance.now() - t0;

    if (player.isOutOfWorld) player.spawn(this.respawnPoint);

    player.updateCamera(dt, this.accumulator / step);
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
      `Objekte    ${this.worldItems.size} Items · ${this.building.structures.length} Bauwerke · ${this.harvest.fallingCount} fallend · ${this.particles.activeCount + this.embers.activeCount} Partikel`,
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
