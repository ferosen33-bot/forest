import { CHAPTERS, type Journal } from '../systems/Journal';

/**
 * Tagebuch (Taste J): alle Kapitel mit ihren Zielen, erledigte abgehakt, offene mit Fortschritt.
 * Spätere Kapitel bleiben bis auf ihren Titel verborgen, bis das vorige abgeschlossen ist.
 * Dazu der kompakte Zielanzeiger im HUD (nächste offene Ziele des aktuellen Kapitels).
 */
export class JournalUI {
  private _open = false;
  private lastTracker = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly tracker: HTMLElement,
    private readonly journal: Journal,
  ) {}

  get open(): boolean {
    return this._open;
  }

  toggle(): void {
    this._open = !this._open;
    this.root.classList.toggle('hidden', !this._open);
    if (this._open) this.renderBook();
  }

  hide(): void {
    this._open = false;
    this.root.classList.add('hidden');
  }

  /** Nach jeder Änderung aufrufen (günstig – baut nur bei neuem Inhalt neu). */
  update(): void {
    const items = this.journal.openObjectives(3);
    const chapter = CHAPTERS[this.journal.currentChapter];
    const key = (chapter?.title ?? '') + items.map((o) => `${o.id}:${this.journal.count(o)}`).join('|');
    if (key !== this.lastTracker) {
      this.lastTracker = key;
      this.tracker.replaceChildren();
      if (chapter) {
        const title = document.createElement('div');
        title.className = 'objectives__title';
        title.textContent = chapter.title;
        this.tracker.append(title);
        for (const o of items) {
          const row = document.createElement('div');
          row.className = 'objectives__item';
          const n = o.count ?? 1;
          row.textContent = n > 1 ? `${o.text} (${this.journal.count(o)}/${n})` : o.text;
          this.tracker.append(row);
        }
      }
      if (this._open) this.renderBook();
    }
  }

  private renderBook(): void {
    const page = this.root.querySelector<HTMLElement>('[data-ref="journalPages"]')!;
    const summary = this.root.querySelector<HTMLElement>('[data-ref="journalSummary"]')!;
    summary.textContent = `${this.journal.completedCount} von ${this.journal.totalCount} Zielen erreicht`;
    page.replaceChildren();
    const current = this.journal.currentChapter;
    CHAPTERS.forEach((c, i) => {
      const section = document.createElement('section');
      section.className = 'journal__chapter' + (i < current ? ' is-done' : i > current ? ' is-locked' : '');
      const h = document.createElement('h3');
      h.textContent = `${i + 1}. ${c.title}`;
      section.append(h);
      if (i <= current) {
        const intro = document.createElement('p');
        intro.className = 'journal__intro';
        intro.textContent = c.intro;
        section.append(intro);
        const list = document.createElement('ul');
        for (const o of c.objectives) {
          const li = document.createElement('li');
          const done = this.journal.isDone(o);
          li.className = done ? 'is-done' : '';
          const n = o.count ?? 1;
          li.textContent = (done ? '✔ ' : '○ ') + o.text + (n > 1 && !done ? ` (${this.journal.count(o)}/${n})` : '');
          list.append(li);
        }
        section.append(list);
      }
      page.append(section);
    });
    if (current >= CHAPTERS.length) {
      const end = document.createElement('p');
      end.className = 'journal__intro';
      end.textContent = 'Alle Ziele erreicht. Die Insel gehört dir – vorerst.';
      page.append(end);
    }
  }
}
