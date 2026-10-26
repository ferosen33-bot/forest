/**
 * Abspann: Das Bild wird schwarz, dann erscheinen Absatz für Absatz die letzten Zeilen der Geschichte,
 * zuletzt eine kleine Bilanz und die Wahl, auf der Insel weiterzuspielen.
 */

export interface Ending {
  title: string;
  paragraphs: string[];
  stats: string;
}

export class EndingUI {
  private readonly root: HTMLElement;
  private onClose: (() => void) | null = null;
  private _open = false;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'ending hidden';
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return this._open;
  }

  show(ending: Ending, onClose: () => void): void {
    this._open = true;
    this.onClose = onClose;
    this.root.replaceChildren();
    const inner = document.createElement('div');
    inner.className = 'ending__inner';
    const title = document.createElement('h1');
    title.className = 'ending__title';
    title.textContent = ending.title;
    inner.appendChild(title);
    // Jeder Absatz blendet etwas später ein.
    let delay = 2.5;
    for (const text of ending.paragraphs) {
      const p = document.createElement('p');
      p.className = 'ending__text';
      p.textContent = text;
      p.style.animationDelay = `${delay}s`;
      delay += 2.6;
      inner.appendChild(p);
    }
    const stats = document.createElement('p');
    stats.className = 'ending__stats ending__text';
    stats.textContent = ending.stats;
    stats.style.animationDelay = `${delay + 0.5}s`;
    inner.appendChild(stats);
    const button = document.createElement('button');
    button.className = 'ending__button ending__text';
    button.textContent = 'Weiterspielen';
    button.style.animationDelay = `${delay + 1.5}s`;
    button.addEventListener('click', () => this.hide());
    inner.appendChild(button);
    this.root.appendChild(inner);
    this.root.classList.remove('hidden');
    // Neu starten, damit die Überblendung jedes Mal läuft.
    void this.root.offsetWidth;
    this.root.classList.add('is-visible');
  }

  hide(): void {
    if (!this._open) return;
    this._open = false;
    this.root.classList.remove('is-visible');
    this.root.classList.add('hidden');
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }
}
