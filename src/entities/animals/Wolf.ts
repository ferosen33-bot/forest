import * as THREE from 'three';
import { Animal, type AnimalContext } from './Animal';
import { clamp } from '../../utils/math';

/** Schaden eines Bisses (bei Skalierung 1). */
const BITE_DAMAGE = 10;
/** Abstand, aus dem ein Wolf zubeißt bzw. trifft (m). */
const BITE_REACH = 1.7;
const BITE_HIT = 2.2;
/** Dauer eines Bisses (s). */
const BITE_TIME = 0.55;
/** Abstand zum Feuer, den Wölfe beim Umkreisen halten (m). */
const FIRE_RADIUS = 11;

/**
 * Kühnheit der Wölfe: im Sommer 1, im Winter (Schnee, wenig Beute) deutlich höher, im Schneesturm am
 * höchsten – dann wittern sie weiter, greifen öfter an und lassen sich auch tagsüber nicht abschütteln.
 */
export function wolfBoldness(snow: number, storm: number): number {
  return 1 + 0.5 * clamp(snow, 0, 1) + 0.35 * clamp(storm, 0, 1) * clamp(snow, 0, 1);
}

/**
 * Ein Wolfsrudel: zieht gemeinsam durch sein Revier, heult nachts, jagt Hirsche und stellt dem Spieler
 * nach. Beim Umkreisen beißt immer nur ein Wolf zu („Angriffsrecht“ geht reihum); je länger die Jagd
 * dauert, desto enger wird der Kreis. Feuer und Fackeln halten das Rudel auf Abstand, Verluste
 * brechen seinen Mut.
 */
export class WolfPack {
  readonly members: Wolf[] = [];
  /** Das Rudel stellt dem Spieler nach. */
  engaged = false;
  /** Wolf mit Angriffsrecht. */
  token: Wolf | null = null;
  private tokenCooldown = 2;
  /** Wie eng der Kreis schon ist (0..1). */
  pressure = 0;
  /** Angst nach Verlusten (0..1); ab 0,6 flieht das ganze Rudel. */
  fear = 0;
  /** Sekunden, bis das Rudel nach einer Flucht wieder angreift. */
  private calm = 0;
  private engagedFor = 0;
  private howlTimer = 40 + Math.random() * 80;
  private hunger = 90 + Math.random() * 200;
  prey: Animal | null = null;
  readonly carcass = new THREE.Vector3();
  feeding = 0;
  /** Erster Kontakt (für den Hinweis im HUD). */
  onFirstEngage: (() => void) | null = null;

  constructor(readonly home: THREE.Vector3) {}

  get leader(): Wolf | null {
    return this.members.find((w) => !w.isDead) ?? null;
  }

  get alive(): number {
    return this.members.filter((w) => !w.isDead).length;
  }

  /** Bereit zum Angriff? (nicht direkt nach einer Flucht, nicht mit zu vielen Verlusten) */
  get willing(): boolean {
    return this.calm <= 0 && this.fear < 0.6;
  }

  engage(): void {
    if (this.engaged || !this.willing) return;
    this.engaged = true;
    this.engagedFor = 0;
    this.prey = null;
    this.feeding = 0;
    for (const w of this.members) if (!w.isDead && w.state !== 'flee') w.beginStalk();
    this.onFirstEngage?.();
    this.onFirstEngage = null;
  }

  disengage(flee: boolean, from?: THREE.Vector3): void {
    this.engaged = false;
    this.token = null;
    this.pressure = 0;
    if (flee) this.calm = 90 + Math.random() * 60;
    for (const w of this.members) {
      if (w.isDead) continue;
      if (flee && from) w.flee(from);
      else w.rest();
    }
  }

  /** Ein Mitglied ist gefallen. */
  lost(from: THREE.Vector3): void {
    if (this.token && this.token.isDead) this.token = null;
    this.fear += 0.6 / Math.max(1, this.members.length - 1);
    if (this.fear >= 0.6 || this.alive <= 1) this.disengage(true, from);
  }

  /** Darf `w` jetzt angreifen? Vergibt das Angriffsrecht. */
  requestAttack(w: Wolf, aggression: number, dt: number): boolean {
    if (this.token || this.tokenCooldown > 0) return false;
    if (Math.random() > aggression * dt * 1.2) return false;
    this.token = w;
    return true;
  }

  releaseAttack(w: Wolf): void {
    if (this.token !== w) return;
    this.token = null;
    // Je enger der Kreis, desto schneller folgt der nächste Biss.
    this.tokenCooldown = 1.2 + Math.random() * 2.5 * (1 - 0.6 * this.pressure);
  }

  update(dt: number, ctx: AnimalContext): void {
    this.tokenCooldown -= dt;
    this.calm -= dt;
    this.fear = Math.max(0, this.fear - dt / 400);
    if (this.token?.isDead) this.token = null;
    const leader = this.leader;
    if (!leader) return;
    const p = ctx.player;
    if (this.engaged) {
      this.engagedFor += dt;
      // Nachts zieht sich der Kreis schnell zu, am Tag kaum – dann verlieren Wölfe bald das Interesse.
      this.pressure = clamp(this.pressure + dt * (ctx.isNight ? 0.02 : 0.006) * ctx.boldness, 0, 1);
      const far = leader.feet.distanceTo(p.position) > 85;
      const bored = !ctx.isNight && ctx.boldness < 1.3 && this.engagedFor > 50;
      if (p.isDead || p.hidden || far || bored) this.disengage(false);
      return;
    }
    // Heulen in der Nacht
    if (ctx.isNight && this.feeding <= 0) {
      this.howlTimer -= dt;
      if (this.howlTimer <= 0) {
        this.howlTimer = 70 + Math.random() * 110;
        this.members.forEach((w, i) => w.howl(i === 0 ? 0 : 0.5 + Math.random() * 1.2));
      }
    }
    // Fressen am Riss
    if (this.feeding > 0) {
      this.feeding -= dt;
      if (this.feeding <= 0) for (const w of this.members) if (!w.isDead) w.rest();
      return;
    }
    // Jagd auf Hirsche
    if (this.prey) {
      if (this.prey.isDead) {
        this.carcass.copy(this.prey.feet);
        this.prey = null;
        this.feeding = 50;
        this.hunger = 250 + Math.random() * 250;
        for (const w of this.members) if (!w.isDead) w.feed(this.carcass);
      } else if (this.prey.feet.distanceTo(leader.feet) > 90) {
        this.prey = null;
        for (const w of this.members) if (!w.isDead) w.rest();
      }
      return;
    }
    this.hunger -= dt * (ctx.isNight ? 1.5 : 1) * ctx.boldness;
    if (this.hunger <= 0) {
      this.hunger = 40;
      const prey = ctx.prey(leader.feet, 75);
      if (prey) {
        this.prey = prey;
        for (const w of this.members) if (!w.isDead && w.state !== 'flee') w.hunt();
      }
    }
  }
}

type AttackPhase = 'charge' | 'bite' | 'retreat';

export class Wolf extends Animal {
  /** Rudel (wird direkt nach dem Erzeugen gesetzt). */
  pack!: WolfPack;
  /** Umlaufrichtung und -winkel beim Einkreisen. */
  private orbitDir = Math.random() < 0.5 ? -1 : 1;
  private orbitAngle = Math.random() * Math.PI * 2;
  private phase: AttackPhase = 'charge';
  private bitten = false;
  private growlTimer = 3 + Math.random() * 6;
  private howlDelay = -1;
  private biteTimer = 0;
  private readonly goal = new THREE.Vector3();

  override get name(): string {
    return 'Wolf';
  }

  beginStalk(): void {
    this.state = 'stalk';
    this.path = null;
    this.rig.anim.attack = -1;
  }

  rest(): void {
    if (this.isDead) return;
    this.state = 'graze';
    this.timer = 3 + Math.random() * 6;
    this.rig.anim.attack = -1;
  }

  flee(from: THREE.Vector3): void {
    if (this.isDead) return;
    this.threat.copy(from);
    this.pickFleeTarget();
    this.state = 'flee';
    this.timer = 8 + Math.random() * 4;
    this.rig.anim.attack = -1;
  }

  howl(delay: number): void {
    if (this.isDead || (this.state !== 'graze' && this.state !== 'wander')) return;
    this.howlDelay = delay;
  }

  hunt(): void {
    this.state = 'hunt';
    this.path = null;
  }

  feed(at: THREE.Vector3): void {
    this.state = 'feed';
    this.goal.set(at.x + (Math.random() - 0.5) * 2.4, 0, at.z + (Math.random() - 0.5) * 2.4);
    this.path = null;
  }

  /** Treffer: verletzte Wölfe fliehen, gesunde gehen zum Gegenangriff über. */
  override scare(from: THREE.Vector3): void {
    if (this.isDead) return;
    if (this.health < this.maxHealth * 0.35) {
      this.flee(from);
      return;
    }
    if (this.pack.willing) {
      this.pack.engage();
      if (this.state !== 'attack') this.beginStalk();
    } else {
      this.flee(from);
    }
  }

  /** Lärm in der Ferne: nachts oder im Winter schauen Wölfe nach, sonst meiden sie ihn. */
  hear(pos: THREE.Vector3, ctx: AnimalContext): void {
    if (this.isDead || this.pack.engaged || this.state === 'flee' || this.state === 'hunt' || this.state === 'feed') return;
    if (ctx.isNight || ctx.boldness > 1.3) {
      if (this === this.pack.leader) {
        this.target.set(pos.x, 0, pos.z);
        this.state = 'wander';
        this.path = null;
      }
    } else if (pos.distanceTo(this.feet) < 25) {
      this.flee(pos);
    }
  }

  protected override sense(dt: number, ctx: AnimalContext): void {
    this.senseTimer -= dt;
    if (this.senseTimer > 0) return;
    this.senseTimer = 0.25;
    const p = ctx.player;
    if (p.isDead || p.hidden || this.pack.engaged || this.state === 'flee') return;
    const radius = (ctx.isNight ? 48 : 26) * ctx.boldness * (p.crouching ? 0.55 : 1) * (p.sprinting ? 1.3 : 1);
    if (this.feet.distanceTo(p.position) < radius) this.pack.engage();
  }

  protected override think(dt: number, ctx: AnimalContext): void {
    this.timer -= dt;
    this.hitTimer -= dt;
    this.biteTimer -= dt;
    this.desiredSpeed = 0;
    const a = this.rig.anim;
    if (this.state !== 'attack') a.attack = -1;
    this.rig.blend({ graze: this.state === 'feed' ? 1 : 0, alert: this.state === 'stalk' || this.state === 'attack' ? 1 : 0 }, dt);
    a.howl += clamp((this.state === 'howl' ? 1 : 0) - a.howl, -dt * 3, dt * 3);
    if (this.state !== 'stalk' && this.state !== 'attack') this.rig.blend({ lookYaw: 0 }, dt);

    if (this.howlDelay >= 0) {
      this.howlDelay -= dt;
      if (this.howlDelay < 0) {
        this.state = 'howl';
        this.timer = 3.6;
        ctx.sound('wolfHowl', this.feet);
      }
    }

    // Nach kurzem Zurückweichen (Fackel) wieder ins Einkreisen.
    if (this.pack.engaged && (this.state === 'graze' || this.state === 'wander' || this.state === 'howl')) this.beginStalk();

    switch (this.state) {
      case 'graze':
        if (this.timer <= 0) this.wanderWithPack(ctx);
        break;
      case 'wander': {
        const leader = this.pack.leader;
        if (leader && leader !== this) {
          // Mitglieder folgen dem Leitwolf in lockerer Reihe.
          if (leader.feet.distanceTo(this.feet) < 4 && leader.state !== 'wander') {
            this.rest();
            break;
          }
          this.target.copy(leader.feet).addScaledVector(this.offsetFromLeader(), 1);
          this.moveTo(this.target, leader.feet.distanceTo(this.feet) > 14 ? 3.5 : this.stats.walkSpeed * 1.2, ctx);
        } else if (this.moveTo(this.target, this.stats.walkSpeed, ctx)) {
          this.rest();
          this.timer = 6 + Math.random() * 10;
        }
        break;
      }
      case 'howl':
        if (this.timer <= 0) this.rest();
        break;
      case 'stalk':
        this.stalk(dt, ctx);
        break;
      case 'attack':
        this.attack(dt, ctx);
        break;
      case 'hunt': {
        const prey = this.pack.prey;
        if (!prey || prey.isDead) break;
        // Von der Seite treiben: jeder Wolf läuft einen etwas anderen Punkt an.
        this.goal.copy(prey.feet).addScaledVector(this.offsetFromLeader(), 0.35);
        this.moveTo(this.goal, this.stats.runSpeed * 0.95, ctx);
        const d = prey.feet.distanceTo(this.feet);
        if (d < 25 && prey.state !== 'flee') prey.scare(this.feet);
        if (d < BITE_REACH && this.biteTimer <= 0) {
          this.biteTimer = 0.8;
          prey.takeDamage(16, this.feet);
          if (d < 30) ctx.sound('wolfBite', this.feet);
        }
        break;
      }
      case 'feed':
        if (this.goal.distanceTo(this.feet.clone().setY(0)) > 1.4) this.moveTo(this.goal, this.stats.walkSpeed * 1.5, ctx);
        else this.faceTowards(this.pack.carcass, dt, 2);
        break;
      case 'flee':
        this.rig.blend({ alert: 0 }, dt);
        if (this.moveTo(this.target, this.stats.runSpeed, ctx) || this.timer <= 0) {
          this.rest();
          this.home.copy(this.feet);
        }
        break;
    }
  }

  /** Umkreisen: Abstand halten, langsam wandern, den Spieler nie aus den Augen lassen. */
  private stalk(dt: number, ctx: AnimalContext): void {
    const p = ctx.player.position;
    const pack = this.pack;
    const fire = ctx.player.torch || ctx.fireNear(p, 7);
    let radius = THREE.MathUtils.lerp(17, 7.5, pack.pressure);
    if (fire) radius = Math.max(radius, FIRE_RADIUS);
    this.orbitAngle += this.orbitDir * dt * (0.22 + 0.25 * pack.pressure);
    // Aus der eigenen Richtung zum Spieler einschwenken, nicht quer durch die Mitte laufen.
    const own = Math.atan2(this.feet.x - p.x, this.feet.z - p.z);
    const diff = Math.atan2(Math.sin(own - this.orbitAngle), Math.cos(own - this.orbitAngle));
    this.orbitAngle += clamp(diff, -dt, dt) * 0.8;
    this.goal.set(p.x + Math.sin(this.orbitAngle) * radius, 0, p.z + Math.cos(this.orbitAngle) * radius);
    const d = this.goal.distanceTo(this.feet.clone().setY(0));
    this.moveTo(this.goal, d > 5 ? 5 : 2 + d * 0.4, ctx);
    if (d < 1.5) this.faceTowards(p, dt, 2);
    this.look(p, dt);

    // Fackel direkt vor der Nase: zurückweichen.
    const dist = this.feet.distanceTo(p);
    if (ctx.player.torch && dist < 4.5) {
      this.flee(p);
      this.timer = 2 + Math.random();
      return;
    }

    this.growlTimer -= dt;
    if (this.growlTimer <= 0) {
      this.growlTimer = 5 + Math.random() * 8;
      if (dist < 22) ctx.sound('wolfGrowl', this.feet);
    }
    if (fire) return;
    const aggression = (ctx.isNight ? 0.6 : 0.12) * ctx.boldness * (0.4 + pack.pressure);
    if (dist < radius + 6 && pack.requestAttack(this, aggression, dt)) {
      this.state = 'attack';
      this.phase = 'charge';
      this.timer = 4;
      this.path = null;
    }
  }

  /** Angriff: anrennen, zubeißen, absetzen – dann geht das Angriffsrecht an den nächsten. */
  private attack(dt: number, ctx: AnimalContext): void {
    const p = ctx.player.position;
    const a = this.rig.anim;
    const dist = this.feet.distanceTo(p);
    this.look(p, dt);
    if (ctx.player.torch && dist < 5 && this.phase !== 'bite') {
      this.pack.releaseAttack(this);
      this.flee(p);
      this.timer = 2.5;
      return;
    }
    switch (this.phase) {
      case 'charge':
        this.moveTo(p, this.stats.runSpeed, ctx);
        if (dist < BITE_REACH) {
          this.phase = 'bite';
          this.bitten = false;
          a.attack = 0;
          ctx.sound('wolfGrowl', this.feet);
        } else if (this.timer <= 0) {
          this.endAttack();
        }
        break;
      case 'bite':
        this.faceTowards(p, dt, 8);
        // Im Sprung noch etwas nachsetzen.
        if (dist > 1.1) this.moveTo(p, 3, ctx);
        a.attack = Math.min(1, a.attack + dt / BITE_TIME);
        if (!this.bitten && a.attack >= 0.45) {
          this.bitten = true;
          ctx.sound('wolfBite', this.feet);
          if (dist < BITE_HIT) ctx.hitPlayer(BITE_DAMAGE * this.rig.scale, this.feet);
        }
        if (a.attack >= 1) {
          a.attack = -1;
          this.phase = 'retreat';
          const away = new THREE.Vector3().subVectors(this.feet, p).setY(0);
          if (away.lengthSq() < 0.01) away.set(1, 0, 0);
          away.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.4);
          this.goal.copy(p).addScaledVector(away, 9 + Math.random() * 3).setY(0);
          this.timer = 2.5;
          this.pack.releaseAttack(this);
        }
        break;
      case 'retreat':
        if (this.moveTo(this.goal, this.stats.runSpeed * 0.8, ctx) || this.timer <= 0) this.endAttack();
        break;
    }
  }

  private endAttack(): void {
    this.pack.releaseAttack(this);
    this.rig.anim.attack = -1;
    this.state = 'stalk';
    this.orbitAngle = Math.random() * Math.PI * 2;
  }

  private look(p: THREE.Vector3, dt: number): void {
    const ang = Math.atan2(p.x - this.feet.x, p.z - this.feet.z) - this.yaw;
    this.rig.blend({ lookYaw: clamp(Math.atan2(Math.sin(ang), Math.cos(ang)), -1.1, 1.1) }, dt);
  }

  private wanderWithPack(ctx: AnimalContext): void {
    if (this === this.pack.leader) {
      for (let i = 0; i < 6; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = 10 + Math.random() * this.stats.wanderRadius;
        const x = this.pack.home.x + Math.cos(ang) * r;
        const z = this.pack.home.z + Math.sin(ang) * r;
        if (ctx.nav.isWalkable(x, z)) {
          this.target.set(x, 0, z);
          this.state = 'wander';
          this.path = null;
          return;
        }
      }
      this.timer = 3;
    } else {
      this.state = 'wander';
    }
  }

  /** Fester Platz in der Reihe hinter dem Leitwolf. */
  private offsetFromLeader(): THREE.Vector3 {
    const i = Math.max(1, this.pack.members.indexOf(this));
    const ang = i * 2.1;
    return new THREE.Vector3(Math.sin(ang) * (2 + i), 0, Math.cos(ang) * (2 + i));
  }
}
