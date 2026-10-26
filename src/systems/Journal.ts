import type { EventBus } from '../core/EventBus';
import type { ItemId } from '../entities/items/ItemDefs';
import type { StructureId } from './building/StructureDefs';

/** Wodurch ein Ziel Fortschritt macht. */
export type Trigger =
  | { on: 'collect'; item: ItemId }
  | { on: 'craft'; item: ItemId }
  | { on: 'build'; structure: StructureId }
  | { on: 'drink' }
  | { on: 'eat'; item?: ItemId }
  | { on: 'fell' }
  | { on: 'kill'; name?: string }
  | { on: 'sneakKill' }
  | { on: 'hunt'; species?: 'deer' | 'rabbit' | 'wolf' }
  | { on: 'cook' }
  | { on: 'fish' }
  | { on: 'cave' }
  | { on: 'crate' }
  | { on: 'town' }
  | { on: 'loot' }
  | { on: 'note'; id?: string }
  | { on: 'fever' }
  | { on: 'event'; kind?: string }
  | { on: 'sleep' }
  | { on: 'camp' }
  | { on: 'harbor' }
  | { on: 'npc' }
  | { on: 'quest' }
  | { on: 'day'; day: number };

export interface Objective {
  id: string;
  text: string;
  trigger: Trigger;
  /** Benötigte Anzahl (Standard 1). */
  count?: number;
}

export interface Chapter {
  title: string;
  intro: string;
  objectives: Objective[];
}

/** Der rote Faden: vom Absturz über den Sieg über einen Koloss bis in die Höhlen. */
export const CHAPTERS: Chapter[] = [
  {
    title: 'Gestrandet',
    intro: 'Das Flugzeug ist verloren, die Insel fremd. Erst einmal das Nötigste.',
    objectives: [
      { id: 'sticks', text: 'Stöcke sammeln', trigger: { on: 'collect', item: 'stick' }, count: 6 },
      { id: 'stones', text: 'Steine sammeln', trigger: { on: 'collect', item: 'stone' }, count: 4 },
      { id: 'drink', text: 'Wasser trinken', trigger: { on: 'drink' } },
      { id: 'berries', text: 'Beeren essen', trigger: { on: 'eat', item: 'berries' } },
      { id: 'campfire', text: 'Ein Lagerfeuer bauen', trigger: { on: 'build', structure: 'campfire' } },
    ],
  },
  {
    title: 'Ein Dach über dem Kopf',
    intro: 'Die Nächte sind lang, und irgendetwas bewegt sich zwischen den Bäumen.',
    objectives: [
      { id: 'fell', text: 'Bäume fällen', trigger: { on: 'fell' }, count: 3 },
      { id: 'stoneAxe', text: 'Eine Steinaxt herstellen', trigger: { on: 'craft', item: 'stoneAxe' } },
      { id: 'shelter', text: 'Einen Unterstand bauen', trigger: { on: 'build', structure: 'shelter' } },
      { id: 'sleep', text: 'Im Unterstand schlafen', trigger: { on: 'sleep' } },
      { id: 'walls', text: 'Holzwände errichten', trigger: { on: 'build', structure: 'wall' }, count: 4 },
    ],
  },
  {
    title: 'Jäger und Sammler',
    intro: 'Beeren allein machen nicht satt. Zeit, auf die Jagd zu gehen.',
    objectives: [
      { id: 'spear', text: 'Einen Speer herstellen', trigger: { on: 'craft', item: 'spear' } },
      { id: 'hunt', text: 'Ein Tier erlegen', trigger: { on: 'hunt' } },
      { id: 'cook', text: 'Fleisch am Feuer braten', trigger: { on: 'cook' } },
      { id: 'fish', text: 'Einen Fisch fangen', trigger: { on: 'fish' } },
      { id: 'bow', text: 'Einen Bogen herstellen', trigger: { on: 'craft', item: 'bow' } },
      { id: 'deer', text: 'Hirsche erlegen', trigger: { on: 'hunt', species: 'deer' }, count: 2 },
    ],
  },
  {
    title: 'Die Schrate',
    intro: 'Sie leben in Lagern im Inneren der Insel. Wer überleben will, muss sie kennen – und schlagen.',
    objectives: [
      { id: 'camp', text: 'Ein Schrat-Lager entdecken', trigger: { on: 'camp' } },
      { id: 'kill', text: 'Schrate besiegen', trigger: { on: 'kill' }, count: 3 },
      { id: 'sneak', text: 'Einen Gegner lautlos ausschalten', trigger: { on: 'sneakKill' } },
      { id: 'coat', text: 'Einen Fellmantel herstellen', trigger: { on: 'craft', item: 'furCoat' } },
      { id: 'koloss', text: 'Einen Koloss besiegen', trigger: { on: 'kill', name: 'Koloss' } },
      { id: 'fever', text: 'Eine Fiebernacht überleben', trigger: { on: 'fever' } },
      { id: 'drop', text: 'Eine Versorgungskiste öffnen', trigger: { on: 'event', kind: 'drop' } },
      { id: 'ritual', text: 'Die Opfergabe eines Rituals an dich nehmen', trigger: { on: 'event', kind: 'ritual' } },
      { id: 'day10', text: 'Zehn Tage überleben', trigger: { on: 'day', day: 10 } },
    ],
  },
  {
    title: 'Unter der Erde',
    intro: 'In den Hängen öffnen sich dunkle Löcher. Wer dort war, hat Spuren hinterlassen – und Vorräte.',
    objectives: [
      { id: 'cave', text: 'Eine Höhle betreten', trigger: { on: 'cave' } },
      { id: 'flint', text: 'Feuerstein abschlagen', trigger: { on: 'collect', item: 'flint' }, count: 5 },
      { id: 'flintAxe', text: 'Eine Feuersteinaxt herstellen', trigger: { on: 'craft', item: 'flintAxe' } },
      { id: 'mushroom', text: 'Leuchtpilze essen', trigger: { on: 'eat', item: 'mushroom' } },
      { id: 'crates', text: 'Alte Vorratskisten öffnen', trigger: { on: 'crate' }, count: 3 },
      { id: 'kriecher', text: 'Kriecher besiegen', trigger: { on: 'kill', name: 'Kriecher' }, count: 3 },
      { id: 'caves', text: 'Alle drei Höhlen erkunden', trigger: { on: 'cave' }, count: 3 },
    ],
  },
  {
    title: 'Die verlassene Stadt',
    intro: 'Hinter den Hügeln liegt ein Ort mit Straßen und Häusern. Niemand ist mehr da – zumindest kein Mensch.',
    objectives: [
      { id: 'town', text: 'Die Stadt finden', trigger: { on: 'town' } },
      { id: 'loot', text: 'Schränke, Regale und Autos durchsuchen', trigger: { on: 'loot' }, count: 15 },
      { id: 'canned', text: 'Eine Konserve essen', trigger: { on: 'eat', item: 'cannedFood' } },
      { id: 'machete', text: 'Eine Machete finden', trigger: { on: 'collect', item: 'machete' } },
      { id: 'flashlight', text: 'Eine Taschenlampe finden', trigger: { on: 'collect', item: 'flashlight' } },
      { id: 'notes3', text: 'Notizen der Bewohner lesen', trigger: { on: 'note' }, count: 3 },
    ],
  },
  {
    title: 'Was geschah',
    intro: 'Briefe, Aushänge, ein Funkgerät. Die Bewohner haben Spuren hinterlassen – und eine Warnung.',
    objectives: [
      { id: 'radio1', text: 'Das erste Funkprotokoll lesen', trigger: { on: 'note', id: 'funk1' } },
      { id: 'radio2', text: 'Das letzte Funkprotokoll lesen', trigger: { on: 'note', id: 'funk2' } },
      { id: 'doctor', text: 'Die Notiz des Arztes finden', trigger: { on: 'note', id: 'arzt' } },
      { id: 'shiftbook', text: 'Das Schichtbuch im Stollen finden', trigger: { on: 'note', id: 'schichtbuch' } },
      { id: 'allNotes', text: 'Alle Notizen finden', trigger: { on: 'note' }, count: 11 },
    ],
  },
  {
    title: 'Die Nordbucht',
    intro: 'Die Funkprotokolle sprechen vom Steg in der Nordbucht. Vielleicht hat dort jemand überlebt.',
    objectives: [
      { id: 'harbor', text: 'Die Überlebenden in der Nordbucht finden', trigger: { on: 'harbor' } },
      { id: 'npcs', text: 'Mit allen Überlebenden sprechen', trigger: { on: 'npc' }, count: 3 },
      { id: 'quests3', text: 'Drei Aufträge erledigen', trigger: { on: 'quest' }, count: 3 },
      { id: 'questsAll', text: 'Alle Aufträge erledigen', trigger: { on: 'quest' }, count: 7 },
    ],
  },
];

export interface JournalSave {
  progress: [string, number][];
  /** Seit Meilenstein 23: gelesene Notizen. */
  notes?: string[];
}

/**
 * Tagebuch: verfolgt die Ziele aller Kapitel über Spielereignisse. Ein Kapitel ist "aktiv",
 * solange es offene Ziele hat; Ziele späterer Kapitel zählen schon mit (wer vorgreift, verliert nichts).
 */
export class Journal {
  private readonly progress = new Map<string, number>();
  /** Gelesene Notizen (Ids, in Fundreihenfolge). */
  readonly notes = new Set<string>();
  private readonly byTrigger: Objective[] = CHAPTERS.flatMap((c) => c.objectives);

  constructor(private readonly events: EventBus) {
    events.on('item:collected', ({ item, count }) => this.advance((t) => t.on === 'collect' && t.item === item, count));
    events.on('item:crafted', ({ item }) => this.advance((t) => t.on === 'craft' && t.item === item));
    events.on('structure:placed', ({ id }) => this.advance((t) => t.on === 'build' && t.structure === id));
    events.on('player:drank', () => this.advance((t) => t.on === 'drink'));
    events.on('player:ate', ({ item }) => this.advance((t) => t.on === 'eat' && (!t.item || t.item === item)));
    events.on('tree:felled', () => this.advance((t) => t.on === 'fell'));
    events.on('enemy:hit', ({ killed, name, sneak }) => {
      if (!killed) return;
      this.advance((t) => t.on === 'kill' && (!t.name || t.name === name));
      if (sneak) this.advance((t) => t.on === 'sneakKill');
    });
    events.on('animal:killed', ({ species }) => this.advance((t) => t.on === 'hunt' && (!t.species || t.species === species)));
    events.on('food:cooked', ({ count }) => this.advance((t) => t.on === 'cook', count));
    events.on('cave:entered', ({ first }) => {
      if (first) this.advance((t) => t.on === 'cave');
    });
    events.on('cave:crate', () => this.advance((t) => t.on === 'crate'));
    events.on('town:discovered', () => this.advance((t) => t.on === 'town'));
    events.on('loot:searched', () => this.advance((t) => t.on === 'loot'));
    events.on('fever:survived', () => this.advance((t) => t.on === 'fever'));
    events.on('world:event', ({ kind, phase }) => {
      if (phase === 'looted') this.advance((t) => t.on === 'event' && (!t.kind || t.kind === kind));
    });
    events.on('note:read', ({ id, first }) => {
      if (!first) return;
      this.notes.add(id);
      this.advance((t) => t.on === 'note' && (!t.id || t.id === id));
    });
    events.on('fish:caught', ({ count }) => this.advance((t) => t.on === 'fish', count));
    events.on('player:slept', () => this.advance((t) => t.on === 'sleep'));
    events.on('camp:discovered', () => this.advance((t) => t.on === 'camp'));
    events.on('harbor:found', () => this.advance((t) => t.on === 'harbor'));
    events.on('npc:met', () => this.advance((t) => t.on === 'npc'));
    events.on('quest:completed', () => this.advance((t) => t.on === 'quest'));
  }

  /** Vom Spiel täglich aufgerufen (für "x Tage überleben"). */
  setDay(day: number): void {
    for (const o of this.byTrigger) {
      if (o.trigger.on === 'day' && !this.isDone(o) && day >= o.trigger.day) this.set(o, 1);
    }
  }

  count(o: Objective): number {
    return Math.min(this.progress.get(o.id) ?? 0, o.count ?? 1);
  }

  isDone(o: Objective): boolean {
    return (this.progress.get(o.id) ?? 0) >= (o.count ?? 1);
  }

  /** Index des ersten Kapitels mit offenen Zielen (= CHAPTERS.length, wenn alles erledigt ist). */
  get currentChapter(): number {
    const i = CHAPTERS.findIndex((c) => c.objectives.some((o) => !this.isDone(o)));
    return i < 0 ? CHAPTERS.length : i;
  }

  /** Bis zu `n` offene Ziele des aktuellen Kapitels (für den HUD-Anzeiger). */
  openObjectives(n = 3): Objective[] {
    const chapter = CHAPTERS[this.currentChapter];
    return chapter ? chapter.objectives.filter((o) => !this.isDone(o)).slice(0, n) : [];
  }

  get completedCount(): number {
    return this.byTrigger.filter((o) => this.isDone(o)).length;
  }

  get totalCount(): number {
    return this.byTrigger.length;
  }

  serialize(): JournalSave {
    return { progress: [...this.progress], notes: [...this.notes] };
  }

  load(d: JournalSave): void {
    this.progress.clear();
    const known = new Set(this.byTrigger.map((o) => o.id));
    for (const [id, n] of d.progress ?? []) if (known.has(id) && Number.isFinite(n)) this.progress.set(id, n);
    this.notes.clear();
    for (const id of d.notes ?? []) if (typeof id === 'string') this.notes.add(id);
  }

  private advance(match: (t: Trigger) => boolean, amount = 1): void {
    for (const o of this.byTrigger) {
      if (!this.isDone(o) && match(o.trigger)) this.set(o, (this.progress.get(o.id) ?? 0) + amount);
    }
  }

  private set(o: Objective, value: number): void {
    const chapterBefore = this.currentChapter;
    this.progress.set(o.id, value);
    if (this.isDone(o)) {
      this.events.emit('journal:completed', { id: o.id, text: o.text, chapterDone: this.currentChapter > chapterBefore });
    }
  }
}
