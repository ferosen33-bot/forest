import { getNote } from '../systems/Notes';

/**
 * Leseansicht für Notizen: ein Blatt Papier in der Bildmitte (Funkprotokolle in Schreibmaschinenschrift,
 * Kinderhefte in Bleistift). Das Spiel läuft weiter – `E` schließt, ebenso ein paar Schritte weg.
 */
export class NoteUI {
  private _open: string | null = null;

  constructor(private readonly root: HTMLElement) {}

  get open(): boolean {
    return this._open !== null;
  }

  show(id: string): void {
    const note = getNote(id);
    if (note) this.showText(note.title, note.text, note.style, id);
  }

  /** Beliebiger Text (z. B. Aufzeichnungen aus Zufallsereignissen, die nicht ins Tagebuch gehören). */
  showText(title: string, text: string, style = 'paper', id = title): void {
    this._open = id;
    const paper = this.root.querySelector<HTMLElement>('.note__paper')!;
    paper.className = `note__paper is-${style}`;
    this.root.querySelector<HTMLElement>('[data-ref="noteTitle"]')!.textContent = title;
    this.root.querySelector<HTMLElement>('[data-ref="noteText"]')!.textContent = text;
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this._open = null;
    this.root.classList.add('hidden');
  }
}
