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
    if (!note) return;
    this._open = id;
    const paper = this.root.querySelector<HTMLElement>('.note__paper')!;
    paper.className = `note__paper is-${note.style}`;
    this.root.querySelector<HTMLElement>('[data-ref="noteTitle"]')!.textContent = note.title;
    this.root.querySelector<HTMLElement>('[data-ref="noteText"]')!.textContent = note.text;
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this._open = null;
    this.root.classList.add('hidden');
  }
}
