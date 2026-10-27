import * as THREE from 'three';
import type { Input, Action } from '../core/Input';
import type { EventBus } from '../core/EventBus';
import type { Player } from '../entities/Player';
import type { ViewModel } from '../entities/ViewModel';
import { cutsLimbs, getItem, type ItemId, type ItemDef, type ToolStats } from '../entities/items/ItemDefs';
import { CRIT_MULTIPLIER, isWeapon, weaponStats } from '../entities/items/Weapons';
import type { Inventory, ItemStack } from './Inventory';
import type { InteractionSystem } from './InteractionSystem';
import type { HarvestSystem } from './HarvestSystem';
import type { Audio } from './Audio';
import type { BuildingSystem } from './building/BuildingSystem';
import type { EnemyDirector } from './ai/EnemyDirector';
import type { AnimalDirector } from './AnimalDirector';
import type { Projectiles } from './Projectiles';
import type { ItemService } from './ItemService';
import type { Caves } from './Caves';
import type { Skills } from './Skills';
import type { ElementEffects } from './ElementEffects';
import { COUNTER_MULTIPLIER, type CombatMoves } from './CombatMoves';
import type { Gore } from './Gore';

const HOTBAR_KEYS: Action[] = ['hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6'];
const EAT_DURATION = 0.9;
const EAT_AT = 0.55;
/** Schwerer Schlag: Bis hierhin zählt ein Klick als normaler Schlag, danach lädt er auf (s). */
const CHARGE_TAP = 0.2;
/** … und ist nach dieser Zeit voll aufgeladen. */
const CHARGE_FULL = 0.65;
/** Bis zu dieser Entfernung wird der Wurf auf das anvisierte Ziel ausgerichtet (m). */
const AIM_RANGE = 40;

/**
 * Ausrüstung & Werkzeuge: Schnellzugriffs-Auswahl (1–6, Mausrad), Schläge mit dem
 * gehaltenen Werkzeug (Treffer wird im Moment des Aufpralls per Raycast geprüft) und
 * Essen von Nahrung aus der Hand.
 */
/** Gegartes Essen (Talent Feldkoch). */
const COOKED = new Set<ItemId>(['cookedMeat', 'cookedFish', 'jerky', 'stew']);

export class ToolController {
  /** Ausgewählter Slot der Schnellzugriffsleiste. */
  selected = 0;

  /** Laufender Schlag; `heavy` 0 = normal, sonst Stärke des schweren Schlags (0,5 … 1). */
  private swing: { tool: ToolStats; time: number; impactDone: boolean; heavy: number } | null = null;
  /** Linke Maustaste wird mit einer Waffe gehalten: schwerer Schlag lädt auf. */
  private charging: number | null = null;
  private eating: { def: ItemDef; time: number; done: boolean } | null = null;
  /** Wurfwaffe angelegt (rechte Maustaste gehalten). */
  aiming = false;
  /** Spannung des Bogens 0..1 (> 0 = wird gespannt). */
  drawCharge = 0;
  private drawing = false;
  /** Abbrandfaktor der Fackel (Regen lässt sie schneller herunterbrennen) – vom Spiel gesetzt. */
  torchBurnRate = 1;
  private throwCooldown = 0;
  private exhaustedHintCooldown = 0;
  private readonly fromDir = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();

  constructor(
    private readonly inventory: Inventory,
    private readonly input: Input,
    private readonly viewModel: ViewModel,
    private readonly interaction: InteractionSystem,
    private readonly harvest: HarvestSystem,
    private readonly building: BuildingSystem,
    private readonly enemies: EnemyDirector,
    private readonly player: Player,
    private readonly audio: Audio,
    private readonly events: EventBus,
    private readonly animals: AnimalDirector,
    private readonly projectiles: Projectiles,
    private readonly camera: THREE.Camera,
    private readonly items: ItemService,
    private readonly caves: Caves,
    private readonly skills: Skills,
  ) {}

  get equipped(): ItemStack | null {
    return this.inventory.get(this.selected);
  }

  /** Werte des gehaltenen Werkzeugs bzw. der Waffe (mit Seltenheit und Perks). */
  get equippedTool(): ToolStats | undefined {
    const stack = this.equipped;
    if (!stack) return undefined;
    return stack.weapon ? weaponStats(stack.id, stack.weapon).tool : getItem(stack.id).tool;
  }

  select(index: number): void {
    if (index === this.selected) return;
    this.selected = index;
    this.swing = null;
    this.eating = null;
    this.cancelCharge();
    this.cancelDraw();
  }

  /** Läuft gerade ein Schlag, Aufladen oder Essen? */
  get busy(): boolean {
    return !!this.swing || !!this.eating || this.charging !== null;
  }

  private cancelCharge(): void {
    this.charging = null;
    this.viewModel.setCharge(0);
  }

  private cancelDraw(): void {
    this.drawing = false;
    this.drawCharge = 0;
    this.viewModel.setDraw(0);
    this.player.zoom = 0;
  }

  /** @param active false, solange Menüs/Inventar offen sind (nur Animationen laufen weiter). */
  update(dt: number, active: boolean): void {
    this.exhaustedHintCooldown -= dt;
    this.throwCooldown -= dt;

    if (active) {
      HOTBAR_KEYS.forEach((key, i) => {
        if (this.input.wasPressed(key)) this.select(i);
      });
      const wheel = this.input.consumeWheel();
      if (wheel !== 0) {
        const n = this.inventory.hotbarSize;
        this.select((this.selected + wheel + n) % n);
      }
    }

    // Das ViewModel zeigt immer, was im gewählten Slot liegt (auch nach Inventar-Änderungen).
    const stack = this.equipped;
    this.viewModel.equip(stack?.id ?? null);
    this.viewModel.setElement(stack?.weapon?.mod ?? null);
    // Fackeln brennen ab, solange man sie in der Hand hält; die Taschenlampe leert ihre Batterie
    // (sie geht dabei nicht kaputt – eine leere Lampe bleibt für neue Batterien im Rucksack).
    if (stack?.id === 'torch' && !this.player.stats.isDead) this.wearEquipped(dt * this.torchBurnRate);
    if (stack?.id === 'flashlight' && !this.player.stats.isDead && (stack.durability ?? 0) > 1) {
      this.inventory.wear(this.selected, Math.min(dt, (stack.durability ?? 0) - 1));
      if ((stack.durability ?? 0) <= 1) this.events.emit('hud:message', { text: 'Die Batterie der Taschenlampe ist leer.' });
    }

    if (this.swing) this.updateSwing(dt);
    if (this.eating) this.updateEating(dt);

    // Rechte Maustaste: Wurfwaffen anlegen, sonst mit der Waffe blocken.
    const def = stack ? getItem(stack.id) : undefined;
    if (def?.ranged) {
      this.updateBow(dt, active, def);
      return;
    }
    if (this.drawing || this.player.zoom > 0) this.cancelDraw();
    const rmb = active && !this.player.stats.isDead && !!def?.tool && this.input.isMouseDown(2) && !this.swing && !this.eating;
    this.aiming = rmb && !!def?.throwable && !this.viewModel.busy;
    const blocking = rmb && !def?.throwable;
    this.player.blocking = blocking;
    this.viewModel.setBlocking(blocking);
    this.viewModel.setAiming(this.aiming);
    if (this.aiming) {
      if (this.input.wasMousePressed(0) && this.throwCooldown <= 0) this.throwEquipped(def!);
      return;
    }
    // Deckung, Menü oder Tod brechen das Aufladen ab.
    if (blocking || rmb || !active || this.player.stats.isDead) {
      if (this.charging !== null) this.cancelCharge();
      return;
    }

    if (!stack || this.swing || this.eating || this.viewModel.busy) return;

    // Brandflaschen wirft man, statt damit zuzuschlagen.
    if (stack.id === 'molotov') {
      if (this.input.wasMousePressed(0) && this.throwCooldown <= 0) this.throwEquipped(def!);
      return;
    }
    // Steine wirft man, um Gegner abzulenken: der Aufprall lockt sie an die Stelle.
    if (stack.id === 'stone') {
      if (this.input.wasMousePressed(0) && this.throwCooldown <= 0) this.throwStone();
      return;
    }
    if (this.charging !== null) {
      this.updateCharge(dt);
      return;
    }
    // Waffen: Gedrückt halten lädt einen schweren Schlag auf – außer man hackt gerade Holz oder Stein.
    if (def?.tool && this.input.isMouseDown(0) && isWeapon(stack.id) && !this.aimingAtHarvest(def.tool.reach)) {
      this.charging = 0;
      return;
    }
    if (def?.tool && this.input.isMouseDown(0)) this.startSwing(this.equippedTool!);
    else if (def?.food && this.input.wasMousePressed(0)) this.startEating(def);
  }

  /** Blick auf Baum, Fels, Bauwerk oder Feuerstein in Reichweite? (Dort schlägt man im Takt weiter.) */
  private aimingAtHarvest(reach: number): boolean {
    const t = this.interaction.raycast(reach)?.type;
    return t === 'tree' || t === 'rock' || t === 'structure' || t === 'cave';
  }

  /** Taste gehalten: aufladen; losgelassen: normaler oder schwerer Schlag. */
  private updateCharge(dt: number): void {
    const held = (this.charging ?? 0) + dt;
    if (this.input.isMouseDown(0)) {
      this.charging = held;
      this.viewModel.setCharge(held < CHARGE_TAP ? 0 : Math.min(1, (held - CHARGE_TAP) / (CHARGE_FULL - CHARGE_TAP)));
      return;
    }
    this.cancelCharge();
    const tool = this.equippedTool;
    if (!tool) return;
    if (held < CHARGE_TAP) {
      this.startSwing(tool);
      return;
    }
    // 0,5 bei kurzem Aufladen, 1 bei vollem.
    const level = 0.5 + 0.5 * Math.min(1, (held - CHARGE_TAP) / (CHARGE_FULL - CHARGE_TAP));
    this.startSwing(tool, level);
  }

  private startSwing(tool: ToolStats, heavy = 0): void {
    const stamina = tool.staminaCost * this.skills.meleeStamina * (heavy ? 1.4 + heavy : 1);
    if (!this.player.stats.useStamina(stamina)) {
      if (this.exhaustedHintCooldown <= 0) {
        this.events.emit('hud:message', { text: 'Zu erschöpft zum Zuschlagen.' });
        this.exhaustedHintCooldown = 2;
      }
      return;
    }
    if (heavy) {
      // Schwerer Schlag: mehr Wucht, etwas langsamer.
      const t = { ...tool, damage: tool.damage * (1.25 + 0.75 * heavy), treeDamage: tool.treeDamage * (1 + heavy), swingTime: tool.swingTime * 1.1, impactAt: 0.3 };
      this.swing = { tool: t, time: 0, impactDone: false, heavy };
      this.viewModel.playSwing(t.swingTime, t.animation, true);
      this.audio.play('heavySwing');
      return;
    }
    this.swing = { tool, time: 0, impactDone: false, heavy: 0 };
    this.viewModel.playSwing(tool.swingTime, tool.animation);
  }

  private updateSwing(dt: number): void {
    const swing = this.swing!;
    swing.time += dt;
    if (!swing.impactDone && swing.time >= swing.tool.swingTime * swing.tool.impactAt) {
      swing.impactDone = true;
      this.resolveImpact(swing.tool, swing.heavy);
    }
    if (swing.time >= swing.tool.swingTime) this.swing = null;
  }

  /** Trefferprüfung im Moment des Aufpralls. */
  private resolveImpact(tool: ToolStats, heavy: number): void {
    const target = this.interaction.raycast(tool.reach);
    // Horizontale Schlagrichtung aus der Blickrichtung des Spielers.
    this.fromDir.set(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));

    if (!target || target.type === 'water' || target.type === 'item' || target.type === 'bush' || target.type === 'ground' || target.type === 'loot' || target.type === 'note' || target.type === 'event') {
      this.audio.play('swing');
      return;
    }
    const h = target.hit;
    this.point.set(h.point.x, h.point.y, h.point.z);
    this.normal.set(h.normal.x, h.normal.y, h.normal.z);
    // Fertigkeiten verstärken den Schlag je nach Ziel.
    const sk = this.skills;
    switch (target.type) {
      case 'tree':
        this.harvest.hitTree(target.instance, { ...tool, treeDamage: tool.treeDamage * sk.treeDamage }, this.point, this.normal, this.fromDir);
        break;
      case 'rock':
        if (tool.rockYield > 0) {
          this.harvest.hitRock(target.instance, { ...tool, rockYield: tool.rockYield * sk.rockYield }, this.point, this.normal);
        } else {
          this.audio.play('stoneHit');
          this.events.emit('hud:message', { text: 'Damit lässt sich kein Stein abschlagen.' });
        }
        break;
      case 'structure':
        this.building.damage(target.structure, tool.treeDamage, this.point, this.normal);
        break;
      case 'enemy': {
        const enemy = target.enemy;
        const stack = this.equipped;
        const stats = stack?.weapon ? weaponStats(stack.id, stack.weapon) : null;
        // Konter (nach perfekter Parade oder perfektem Ausweichen): immer kritisch und stärker.
        const counter = this.combat?.consumeCounter() ?? false;
        // Kritischer Treffer: deutlich mehr Schaden, eigener Trefferanzeiger. Schwere Schläge treffen öfter kritisch.
        const crit = counter || Math.random() < (stats?.crit ?? 0) + heavy * 0.1;
        const damage = tool.damage * sk.meleeDamage * (crit ? CRIT_MULTIPLIER : 1) * (counter ? COUNTER_MULTIPLIER : 1);
        const kind = counter ? 'counter' : crit ? 'crit' : heavy ? 'heavy' : 'normal';
        this.enemies.damage(enemy, damage, target.zone, this.player.position, this.point, this.normal, kind);
        // Wunden und Zerstückelung: Klingen trennen ab, Wucht zertrümmert.
        this.gore?.onHit(enemy, this.point, this.player.position, {
          cut: cutsLimbs(tool),
          heavy,
          damage: enemy.lastDamage,
          headshot: target.zone === 'head',
        });
        if (crit) this.events.emit('weapon:crit', { position: this.point.clone() });
        if (counter) this.events.emit('combat:tag', { text: 'KONTER!', color: '#ffe08a', big: true });
        // Waffenmod: Der Treffer kann sein Element auslösen.
        const mod = stack?.weapon?.mod;
        if (mod) this.elements?.strike(enemy, mod, tool.weaponClass, this.point, crit || heavy >= 1);
        // Wuchtwaffen lassen den Getroffenen taumeln.
        const stun = (tool.stun ?? (this.staggerAll ? 0.5 : 0)) + (stats?.stagger ?? 0) + (crit ? 0.4 : 0);
        if (!enemy.isDead && heavy) {
          // Voll aufgeladene schwere Waffen werfen um, sonst schleudert der Schlag zurück.
          if (tool.weaponClass === 'heavy' && heavy >= 1) enemy.knockdown(2.2, this.player.position, 7);
          else enemy.shove(this.player.position, 4 + 4 * heavy, 0.5 + stun);
        } else if (stun && !enemy.isDead && !enemy.kind.boss) enemy.stun(stun);
        // Trefferstopp: Die Welt hält kurz an – je wuchtiger der Treffer, desto länger.
        this.combat?.impact(enemy.isDead ? 0.7 : heavy ? 0.45 + 0.4 * heavy : crit ? 0.4 : 0.15);
        if (heavy) this.player.addShake(0.2 + 0.25 * heavy);
        if (stats?.heal) {
          const st = this.player.stats;
          st.health = Math.min(st.max, st.health + stats.heal);
        }
        sk.gain('melee', target.enemy.isDead ? 8 : 2);
        break;
      }
      case 'animal':
        if (target.animal.isDead) {
          this.audio.play('swing');
          return;
        }
        this.animals.damage(target.animal, tool.damage * sk.meleeDamage, this.player.position, this.point, this.normal);
        sk.gain('melee', target.animal.isDead ? 5 : 1.5);
        break;
      case 'cave':
        if (target.cave.type === 'flint') this.caves.hitFlint(target.cave.feature, { ...tool, rockYield: tool.rockYield * sk.flintYield }, this.point, this.normal);
        else if (target.cave.type === 'crate') this.audio.play('chop');
        else {
          this.audio.play('swing');
          return;
        }
        break;
    }
    this.viewModel.playHit();
    this.wearEquipped(1);
  }

  /** Elemente der Waffenmods und Kampfmanöver (setzt das Spiel). */
  elements: ElementEffects | null = null;
  combat: CombatMoves | null = null;
  gore: Gore | null = null;

  /** Talente: jeder Nahkampftreffer betäubt kurz; Gekochtes macht satter. */
  staggerAll = false;
  cookBonus = false;

  /** Gewählte Munition für den Bogen: Brandpfeile, solange welche da sind und sie gewählt sind. */
  private fireAmmo = false;

  private currentAmmo(base: ItemId): ItemId {
    if (base !== 'arrow') return base;
    if (this.fireAmmo && this.inventory.has('fireArrow')) return 'fireArrow';
    if (!this.inventory.has('arrow') && this.inventory.has('fireArrow')) return 'fireArrow';
    return 'arrow';
  }

  private toggleAmmo(): void {
    this.fireAmmo = !this.fireAmmo;
    const has = this.fireAmmo ? this.inventory.count('fireArrow') : this.inventory.count('arrow');
    this.audio.play('pickup', 0.4);
    this.events.emit('hud:message', { text: `Munition: ${this.fireAmmo ? 'Brandpfeile' : 'Pfeile'} (${has})` });
  }

  /** Bogen: Linksklick halten = spannen, loslassen = schießen; Rechtsklick = Zielzoom. */
  private updateBow(dt: number, active: boolean, def: ItemDef): void {
    const r = def.ranged!;
    const usable = active && !this.player.stats.isDead && !this.viewModel.busy;
    this.player.blocking = false;
    this.viewModel.setBlocking(false);
    this.viewModel.setAiming(false);
    this.player.zoom = usable && this.input.isMouseDown(2) ? 1 : 0;
    if (!usable) {
      if (this.drawing) this.cancelDraw();
      return;
    }
    if (this.input.wasPressed('ammo') && !this.drawing) this.toggleAmmo();
    const ammo = this.currentAmmo(r.ammo);
    if (this.input.wasMousePressed(0) && !this.drawing) {
      if (!this.inventory.has(ammo)) {
        this.audio.play('denied');
        this.events.emit('hud:message', { text: `Keine ${getItem(r.ammo).name}e – herstellen oder aufsammeln.` });
        return;
      }
      this.drawing = true;
      this.drawCharge = 0;
      this.audio.play('bowDraw', 0.7);
    }
    if (!this.drawing) return;
    if (this.input.isMouseDown(0)) {
      this.drawCharge = Math.min(1, this.drawCharge + dt / (r.drawTime * this.skills.drawTime));
      this.viewModel.setDraw(this.drawCharge);
      return;
    }
    // Losgelassen: zu wenig gespannt → Pfeil bleibt in der Hand.
    const charge = this.drawCharge;
    this.drawing = false;
    this.drawCharge = 0;
    this.viewModel.setDraw(0);
    if (charge < 0.15 || !this.inventory.remove(ammo, 1)) return;
    const speed = r.minSpeed + (r.maxSpeed - r.minSpeed) * charge;
    const damage = (r.minDamage + (r.maxDamage - r.minDamage) * charge * charge) * this.skills.rangedDamage;
    const { origin, dir } = this.aimRay(0.08, -0.02);
    const velocity = dir.multiplyScalar(speed).add(this.player.velocity);
    velocity.y += 0.6;
    this.projectiles.launch(ammo, undefined, damage, origin, velocity);
    this.audio.play('bowShot');
    if (ammo === 'fireArrow') this.audio.play('ignite', 0.5);
    this.viewModel.playHit();
    this.wearEquipped(1);
  }

  /** Abwurf-/Abschusspunkt seitlich der Kamera, ausgerichtet auf den Punkt unter dem Fadenkreuz. */
  private aimRay(side: number, up: number): { origin: THREE.Vector3; dir: THREE.Vector3 } {
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const look = this.camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(look, this.camera.up).normalize();
    const origin = eye.clone().addScaledVector(right, side).addScaledVector(look, 0.3);
    origin.y += up;
    const aim = this.interaction.raycast(AIM_RANGE);
    const distance = aim && aim.type !== 'water' ? Math.max(4, aim.hit.distance) : AIM_RANGE;
    const dir = eye.addScaledVector(look, distance).sub(origin).normalize();
    return { origin, dir };
  }

  /** Wirft die Waffe in der Hand entlang der Blickrichtung. */
  private throwEquipped(def: ItemDef): void {
    const tool = def.tool!;
    const t = def.throwable!;
    if (!this.player.stats.useStamina(tool.staminaCost * 1.5 * this.skills.meleeStamina)) {
      if (this.exhaustedHintCooldown <= 0) {
        this.events.emit('hud:message', { text: 'Zu erschöpft zum Werfen.' });
        this.exhaustedHintCooldown = 2;
      }
      return;
    }
    const stack = this.inventory.takeFromSlot(this.selected, 1);
    if (!stack) return;
    // Abwurf über der rechten Schulter, aber auf den Punkt unter dem Fadenkreuz gerichtet.
    const { origin, dir: throwDir } = this.aimRay(0.18, 0.05);
    // Leicht angehoben: auf ~12 m fällt der Speer genau auf die Zielhöhe.
    const velocity = throwDir.multiplyScalar(t.speed).add(this.player.velocity);
    velocity.y += 1.2;
    const dmg = weaponStats(stack.id, stack.weapon).tool.damage;
    this.projectiles.launch(stack.id, stack.durability, dmg * t.damageMultiplier * this.skills.rangedDamage, origin, velocity, false, stack.weapon);
    // Der Wurf selbst ist lautlos – erst der Einschlag macht Lärm (sonst flieht das Ziel vorher).
    this.viewModel.playThrow();
    this.throwCooldown = 0.4;
    this.aiming = false;
  }

  /** Stein werfen: wenig Schaden, aber ein lauter Aufprall. */
  private throwStone(): void {
    if (!this.player.stats.useStamina(3)) return;
    if (!this.inventory.takeFromSlot(this.selected, 1)) return;
    const { origin, dir } = this.aimRay(0.18, 0.05);
    const velocity = dir.multiplyScalar(19).add(this.player.velocity);
    velocity.y += 1.5;
    this.projectiles.launch('stone', undefined, 6 * this.skills.rangedDamage, origin, velocity);
    this.viewModel.playThrow();
    this.throwCooldown = 0.5;
  }

  /** Sofort essen (Rechtsklick im Inventar, ohne Animation). */
  consumeFromSlot(slot: number): boolean {
    const stack = this.inventory.get(slot);
    const def = stack ? getItem(stack.id) : undefined;
    if (!def?.food) return false;
    this.consume(slot, def);
    return true;
  }

  /** Nimmt ein Stück aus dem Slot (Behälter bleiben als Leergut zurück) und wendet die Wirkung an. */
  private consume(slot: number, def: ItemDef): void {
    const leftover = def.food?.leftover;
    if (leftover) {
      if (this.inventory.transform(slot, leftover) > 0) this.items.drop(leftover, 1, this.player.position);
    } else {
      this.inventory.takeFromSlot(slot, 1);
    }
    this.applyFood(def);
  }

  private applyFood(def: ItemDef): void {
    const food = def.food!;
    const stats = this.player.stats;
    stats.eat(food.hunger * (this.cookBonus && COOKED.has(def.id) ? 1.5 : 1));
    stats.thirst = Math.max(0, Math.min(stats.max, stats.thirst + food.thirst));
    this.audio.play(food.medicine ? 'craft' : food.hunger === 0 && food.thirst > 0 ? 'drink' : 'eat');
    if (food.medicine) this.events.emit('hud:message', { text: 'Wunden versorgt.' });
    this.events.emit('player:ate', { item: def.id });
    if (food.health >= 0) {
      stats.health = Math.min(stats.max, stats.health + food.health);
    } else {
      // Rohes Fleisch: Übelkeit statt Heilung.
      stats.damage(-food.health, 'sickness');
      this.events.emit('hud:message', { text: 'Dir wird übel …' });
    }
  }

  /** Nutzt das Werkzeug in der Hand ab; meldet, wenn es zerbricht bzw. abbrennt. */
  wearEquipped(amount: number): void {
    const stack = this.equipped;
    if (!stack) return;
    const name = getItem(stack.id).name;
    if (this.inventory.wear(this.selected, amount)) {
      this.audio.play(stack.id === 'torch' ? 'ignite' : 'treeCrack', 0.6);
      this.events.emit('hud:message', { text: stack.id === 'torch' ? 'Die Fackel ist abgebrannt.' : `${name} ist zerbrochen.` });
    }
  }

  private startEating(def: ItemDef): void {
    this.eating = { def, time: 0, done: false };
    this.viewModel.playEat(EAT_DURATION);
  }

  private updateEating(dt: number): void {
    const eating = this.eating!;
    eating.time += dt;
    if (!eating.done && eating.time >= EAT_DURATION * EAT_AT) {
      eating.done = true;
      const food = eating.def.food;
      // Nur essen, wenn das Item noch im Slot liegt (könnte inzwischen verschoben worden sein).
      if (food && this.equipped?.id === eating.def.id) this.consume(this.selected, eating.def);
    }
    if (eating.time >= EAT_DURATION) this.eating = null;
  }
}
