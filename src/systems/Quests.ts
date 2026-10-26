import type { EventBus } from '../core/EventBus';
import type { ItemCost, ItemId } from '../entities/items/ItemDefs';
import type { StructureId } from './building/StructureDefs';
import type { SkillId } from './Skills';

/**
 * Aufträge der Überlebenden in der Nordbucht. Reine Logik (getestet): Zustände, Fortschritt über
 * Spielereignisse, Abgabe mit Belohnung. Gespräche (`Survivors`) bieten an und nehmen ab.
 */

export type NpcId = 'jonas' | 'albers' | 'mia';

export type QuestGoal =
  /** Gegenstände beim Auftraggeber abgeben. */
  | { type: 'deliver'; items: ItemCost[] }
  /** Etwas tun (zählt ab Annahme), dann beim Auftraggeber melden. */
  | { type: 'kill'; name?: string; count: number }
  | { type: 'build'; structure: StructureId; count: number }
  | { type: 'note'; id: string }
  | { type: 'collect'; item: ItemId; count: number };

export interface QuestDef {
  id: string;
  giver: NpcId;
  title: string;
  /** Was der Auftraggeber beim Anbieten sagt. */
  offer: string;
  /** Kurzbeschreibung für Tagebuch und Zielanzeige. */
  task: string;
  /** Was er sagt, solange der Auftrag läuft. */
  waiting: string;
  /** Dank beim Abgeben. */
  thanks: string;
  goal: QuestGoal;
  reward: { items: [ItemId, number][]; xp?: [SkillId, number][] };
  /** Erst nach diesen Aufträgen verfügbar. */
  requires?: string[];
}

export const QUESTS: QuestDef[] = [
  {
    id: 'supplies',
    giver: 'jonas',
    title: 'Vorräte für den Leuchtturm',
    offer: 'Wir sind zu dritt und die Kiste ist fast leer. Die Kleine braucht was Richtiges zu essen. Bring mir vier Konserven und zwei Flaschen Wasser – in Altwasser müsste noch etwas zu finden sein.',
    task: 'Jonas 4 Konserven und 2 Wasserflaschen bringen',
    waiting: 'Vier Konserven, zwei Flaschen Wasser. Der Supermarkt, die Häuser – irgendwo ist noch was.',
    thanks: 'Damit kommen wir eine Woche hin. Hier – Pfeile und Batterien, mehr hab ich nicht. Und danke. Ehrlich.',
    goal: { type: 'deliver', items: [{ item: 'cannedFood', count: 4 }, { item: 'waterBottle', count: 2 }] },
    reward: { items: [['arrow', 15], ['battery', 2]], xp: [['survival', 10]] },
  },
  {
    id: 'plaza',
    giver: 'jonas',
    title: 'Der Marktplatz',
    offer: 'Auf dem Marktplatz haben sie sich eingenistet. Solange die da sind, kommt keiner von uns an die Vorräte im Ort. Dünn sie aus – vier von ihnen, das würde schon reichen.',
    task: 'Vier Schrate besiegen',
    waiting: 'Vier von denen. Pass auf den Großen auf, der schlägt Wände ein.',
    thanks: 'Du hast Mut, das muss man dir lassen. Nimm das Verbandszeug, du wirst es brauchen.',
    goal: { type: 'kill', count: 4 },
    reward: { items: [['medkit', 2], ['cannedFood', 3]], xp: [['melee', 15]] },
    requires: ['supplies'],
  },
  {
    id: 'torches',
    giver: 'jonas',
    title: 'Licht gegen die Nacht',
    offer: 'In den Fiebernächten kommen sie trotzdem. Feuer hält die gewöhnlichen Nächte fern – je mehr Licht, desto besser. Stell zwei Standfackeln auf, ich zeig dir, wo sie am meisten bringen.',
    task: 'Zwei Standfackeln bauen',
    waiting: 'Zwei Standfackeln. Pfahl, Stein, Lappen – du weißt, wie das geht.',
    thanks: 'Schon besser. Mia schläft ruhiger, wenn es draußen hell ist. Die Jacke hier hat meinem Bruder gehört. Er braucht sie nicht mehr.',
    goal: { type: 'build', structure: 'torchPost', count: 2 },
    reward: { items: [['jacket', 1]], xp: [['crafting', 10]] },
    requires: ['supplies'],
  },
  {
    id: 'samples',
    giver: 'albers',
    title: 'Proben',
    offer: 'Ich muss verstehen, was die Leute verändert. Alle Erkrankten waren im neuen Stollen – und dort wachsen diese leuchtenden Pilze. Bringen Sie mir fünf davon. Und atmen Sie dort unten nicht zu tief ein.',
    task: 'Dr. Albers 5 Leuchtpilze bringen',
    waiting: 'Fünf Leuchtpilze. Man findet sie in den Höhlen, im Dunkeln leuchten sie türkis.',
    thanks: 'Wunderbar. Faszinierend, wirklich – und erschreckend. Nehmen Sie die Tabletten, Sie haben sie sich verdient.',
    goal: { type: 'deliver', items: [{ item: 'mushroom', count: 5 }] },
    reward: { items: [['painkillers', 3], ['medkit', 1]], xp: [['survival', 10]] },
  },
  {
    id: 'shiftbook',
    giver: 'albers',
    title: 'Was im Stollen geschah',
    offer: 'Die Betriebsleitung hat ein Schichtbuch geführt. Wenn es noch existiert, liegt es im Feuersteinstollen. Lesen Sie es – ich muss wissen, wann es anfing.',
    task: 'Das Schichtbuch im Feuersteinstollen lesen',
    waiting: 'Das Schichtbuch. Im Feuersteinstollen, tief drinnen, bei den alten Vorratskisten.',
    thanks: 'Juli also. Und sie haben weitergearbeitet … Danke. Das hilft mir mehr, als Sie ahnen. Hier, meine alte Lampe – Sie werden sie in den Höhlen brauchen.',
    goal: { type: 'note', id: 'schichtbuch' },
    reward: { items: [['flashlight', 1], ['battery', 2]], xp: [['survival', 10]] },
    requires: ['samples'],
  },
  {
    id: 'lab',
    giver: 'albers',
    title: 'Was sie wussten',
    offer:
      'Die Betriebsleitung hatte oben am Berg eine Station – „Labor Nordwand“, angeblich für Wettermessungen. Ein Hubschrauber flog dort jede Woche hin. ' +
      'Wenn irgendwo steht, was im Stollen wirklich los war, dann dort. Finden Sie heraus, was sie wussten.',
    task: 'Im Labor Nordwand herausfinden, was die Betriebsleitung wusste',
    waiting: 'Das Labor liegt hoch oben im Gebirge, über der Zeche. Folgen Sie den Hängen nach Norden.',
    thanks:
      'Keine Übertragung von Mensch zu Mensch … Mein Gott. Dann hätte man die Gesunden längst herausholen können. ' +
      'Haben Sie die Akte selbst? Behalten Sie sie! Damit glaubt man uns auf dem Festland. Hier, Batterien – Sie werden sie brauchen.',
    goal: { type: 'note', id: 'labor1' },
    reward: { items: [['battery', 3]], xp: [['survival', 15]] },
    requires: ['shiftbook'],
  },
  {
    id: 'radio',
    giver: 'albers',
    title: 'Ein Funkspruch',
    offer:
      'Die Funkstation auf den Klippen hat den stärksten Sender der Insel. Bringen Sie die Akte dorthin und rufen Sie das Festland. ' +
      'Das Gerät braucht Strom – zwei Batterien sollten für einen Funkspruch reichen. Sagen Sie ihnen, was wir wissen.',
    task: 'Mit der Forschungsakte von der Funkstation aus das Festland rufen',
    waiting: 'Die Funkstation Klippenkopf, an der Ostküste. Akte und zwei Batterien. Und sprechen Sie deutlich.',
    thanks: 'Sie lassen uns anlegen? … Entschuldigen Sie. Ich habe so lange nicht mehr geweint. Gehen Sie zu Jonas – er weiß, wie wir hier wegkommen.',
    goal: { type: 'note', id: 'funkspruch' },
    reward: { items: [['medkit', 1]], xp: [['survival', 20]] },
    requires: ['lab'],
  },
  {
    id: 'watch',
    giver: 'mia',
    title: 'Papas Uhr',
    offer: 'Papa hat eine Taschenuhr, die tickt ganz laut. Die liegt bestimmt noch zu Hause im Schrank. Wir wohnen in Altwasser, im Haus mit dem Brief an Tante Marta auf dem Tisch. Holst du sie mir?',
    task: 'Mias Taschenuhr aus ihrem Elternhaus holen',
    waiting: 'Die Uhr ist im Kleiderschrank. In unserem Haus in Altwasser – Mama hat dort einen Brief an Tante Marta geschrieben.',
    thanks: 'Sie tickt noch! … Danke. Du kannst das Fell haben, das hab ich gefunden. Und Papas Angel – die ist mir zu groß.',
    goal: { type: 'collect', item: 'watch', count: 1 },
    reward: { items: [['hide', 3], ['fishingRod', 1]], xp: [['stealth', 10]] },
  },
  {
    id: 'papa',
    giver: 'mia',
    title: 'Papa',
    offer: 'Ich hab Papa gesehen. Bei den Schraten auf dem Marktplatz, der ganz Große. Er hat noch sein rotes Halstuch an. Jonas sagt, er erkennt uns nicht mehr. … Kannst du machen, dass er nicht mehr so traurig herumlaufen muss?',
    task: 'Den Koloss vom Marktplatz besiegen',
    waiting: 'Der ganz Große auf dem Marktplatz. Mit dem roten Halstuch.',
    thanks: '… Ist er jetzt nicht mehr traurig? Danke. Jonas sagt, du sollst das hier haben.',
    goal: { type: 'kill', name: 'Koloss', count: 1 },
    reward: { items: [['arrow', 10], ['medkit', 1], ['cannedFood', 2]], xp: [['melee', 20]] },
    requires: ['watch'],
  },
  {
    id: 'mama',
    giver: 'mia',
    title: 'Mama',
    offer:
      'Mama ist mit der Fähre gefahren. Jonas sagt, die Fähre ist nie drüben angekommen. Er sagt, sie liegt irgendwo an der Küste, auf den Steinen. ' +
      'Kannst du nachsehen? Vielleicht hat Mama mir was dagelassen. Sie lässt mir immer Zettel da.',
    task: 'Die gestrandete Fähre finden und nach Mias Mama suchen',
    waiting: 'Die Fähre heißt „Altwasser“, wie unser Ort. Sie ist ganz groß und hat einen roten Streifen am Schornstein.',
    thanks:
      '… „Nicht, weil ich aufgehört habe.“ … Dann sucht sie mich noch. Oder? … Ich heb den Brief gut auf. Danke, dass du ihn geholt hast.',
    goal: { type: 'note', id: 'anne' },
    reward: { items: [['arrow', 12], ['berries', 4]], xp: [['stealth', 15]] },
    requires: ['papa'],
  },
];

/** Jonas' letzter Auftrag: Erst wenn der Kutter läuft und das Festland Ja gesagt hat, geht es heim. */
export const BOAT_QUEST: QuestDef = {
  id: 'boat',
  giver: 'jonas',
  title: 'Die Möwe',
  offer:
    'Das Festland lässt uns anlegen? Dann brauchen wir nur noch ein Boot, das schwimmt. Die alte Möwe am Steg war mein Kutter – der Motor ist hin, seit dem Sturm. ' +
    'In der gestrandeten Fähre gibt es einen Maschinenraum. Bring mir die Ersatzteile von dort. Und Sprit: Vier Kanister Lampenöl, zur Not läuft sie damit.',
  task: 'Jonas Motorteile von der Fähre und 4 Lampenöl bringen',
  waiting: 'Motorteile aus der Fähre und vier Lampenöl. Dann schrauben wir die Nacht durch, und im ersten Licht legen wir ab.',
  thanks: 'Hörst du das? Sie läuft. Sie läuft! … Pack, was du tragen kannst. Sag mir Bescheid, wenn du bereit bist – dann legen wir ab.',
  goal: { type: 'deliver', items: [{ item: 'enginePart', count: 1 }, { item: 'lampOil', count: 4 }] },
  reward: { items: [['cannedFood', 2], ['waterBottle', 2]], xp: [['crafting', 20]] },
  requires: ['radio', 'supplies'],
};
QUESTS.push(BOAT_QUEST);

export type QuestState = 'locked' | 'available' | 'active' | 'ready' | 'completed';

export interface QuestsSave {
  active: [string, number][];
  completed: string[];
}

const BY_ID = new Map(QUESTS.map((q) => [q.id, q]));
export const getQuest = (id: string): QuestDef | undefined => BY_ID.get(id);

/** Bestand an Gegenständen (das Inventar), für Abgabe-Aufträge. */
export interface Stock {
  count(id: ItemId): number;
}

export class Quests {
  /** Laufende Aufträge mit Fortschritt (Ereignis-Aufträge). */
  private readonly active = new Map<string, number>();
  private readonly completed = new Set<string>();
  /** Schon gelesene Notizen: Ein Notiz-Auftrag ist auch erfüllt, wenn man sie vor der Annahme gefunden hat. */
  private readonly notesRead = new Set<string>();

  constructor(events?: EventBus) {
    if (!events) return;
    events.on('note:read', ({ id }) => void this.notesRead.add(id));
    events.on('enemy:hit', ({ killed, name }) => killed && this.advance((g) => g.type === 'kill' && (!g.name || g.name === name)));
    events.on('structure:placed', ({ id }) => this.advance((g) => g.type === 'build' && g.structure === id));
    events.on('note:read', ({ id }) => this.advance((g) => g.type === 'note' && g.id === id));
  }

  state(id: string, stock?: Stock): QuestState {
    const q = getQuest(id);
    if (!q) return 'locked';
    if (this.completed.has(id)) return 'completed';
    if (this.active.has(id)) return this.isReady(q, stock) ? 'ready' : 'active';
    return (q.requires ?? []).every((r) => this.completed.has(r)) ? 'available' : 'locked';
  }

  /** Fortschritt in [0, Ziel] (für Anzeigen). */
  progress(id: string, stock?: Stock): { have: number; need: number } {
    const q = getQuest(id)!;
    const g = q.goal;
    if (g.type === 'deliver') {
      const need = g.items.reduce((s, c) => s + c.count, 0);
      const have = g.items.reduce((s, c) => s + Math.min(c.count, stock?.count(c.item) ?? 0), 0);
      return { have, need };
    }
    if (g.type === 'collect') return { have: Math.min(g.count, stock?.count(g.item) ?? 0), need: g.count };
    if (g.type === 'note') return { have: this.notesRead.has(g.id) || this.completed.has(id) ? 1 : Math.min(1, this.active.get(id) ?? 0), need: 1 };
    const need = g.count;
    return { have: Math.min(need, this.active.get(id) ?? (this.completed.has(id) ? need : 0)), need };
  }

  private isReady(q: QuestDef, stock?: Stock): boolean {
    const p = this.progress(q.id, stock);
    return p.have >= p.need;
  }

  accept(id: string): boolean {
    if (this.state(id) !== 'available') return false;
    this.active.set(id, 0);
    return true;
  }

  /** Abgeben: nur im Zustand `ready`. @returns die Belohnung (Abgabe-Gegenstände entnimmt der Aufrufer). */
  complete(id: string, stock?: Stock): QuestDef['reward'] | null {
    const q = getQuest(id);
    if (!q || this.state(id, stock) !== 'ready') return null;
    this.active.delete(id);
    this.completed.add(id);
    return q.reward;
  }

  /** Laufende Aufträge (für Tagebuch und Zielanzeige). */
  get running(): QuestDef[] {
    return QUESTS.filter((q) => this.active.has(q.id));
  }

  get done(): QuestDef[] {
    return QUESTS.filter((q) => this.completed.has(q.id));
  }

  private advance(match: (g: QuestGoal) => boolean): void {
    for (const [id, n] of this.active) {
      const g = getQuest(id)!.goal;
      if (match(g)) this.active.set(id, n + 1);
    }
  }

  /** Nach dem Laden: bereits gelesene Notizen (aus dem Tagebuch). */
  markRead(ids: Iterable<string>): void {
    for (const id of ids) this.notesRead.add(id);
  }

  serialize(): QuestsSave {
    return { active: [...this.active], completed: [...this.completed] };
  }

  load(d: QuestsSave): void {
    this.active.clear();
    this.completed.clear();
    for (const [id, n] of d.active ?? []) if (BY_ID.has(id)) this.active.set(id, Number.isFinite(n) ? n : 0);
    for (const id of d.completed ?? []) if (BY_ID.has(id)) this.completed.add(id);
  }
}
