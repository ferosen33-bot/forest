import type { DialogueOption, DialogueView } from '../systems/Survivors';

/**
 * Gesprächsfenster am unteren Bildrand: Name, was die Person sagt, nummerierte Antworten.
 * Wie bei Notizen läuft das Spiel weiter – Zifferntasten wählen, `E` beendet das Gespräch,
 * ebenso ein paar Schritte weg.
 */
export class DialogueUI {
  private view: DialogueView | null = null;
  private readonly name: HTMLElement;
  private readonly text: HTMLElement;
  private readonly list: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.name = root.querySelector<HTMLElement>('[data-ref="dialogueName"]')!;
    this.text = root.querySelector<HTMLElement>('[data-ref="dialogueText"]')!;
    this.list = root.querySelector<HTMLElement>('[data-ref="dialogueOptions"]')!;
  }

  get open(): boolean {
    return this.view !== null;
  }

  /** Gesprächspartner (null, wenn geschlossen). */
  get npc(): DialogueView['npc'] | null {
    return this.view?.npc ?? null;
  }

  show(view: DialogueView): void {
    this.view = view;
    this.name.textContent = view.npc.name;
    this.text.textContent = view.text;
    this.renderOptions(view.options);
    this.root.classList.remove('hidden');
  }

  /**
   * Wählt Antwort `index` (0-basiert).
   * @param refresh liefert die Antworten im neuen Zustand (Aufträge können sich geändert haben).
   * @returns false, wenn das Gespräch damit endet.
   */
  choose(index: number, refresh: () => DialogueOption[]): boolean {
    const option = this.view?.options[index];
    if (!this.view || !option) return true;
    const result = option.run();
    if (result.close) {
      this.hide();
      return false;
    }
    this.view = { ...this.view, text: result.text ?? this.view.text, options: refresh() };
    this.show(this.view);
    return true;
  }

  hide(): void {
    this.view = null;
    this.root.classList.add('hidden');
  }

  private renderOptions(options: DialogueOption[]): void {
    this.list.replaceChildren(
      ...options.map((o, i) => {
        const li = document.createElement('li');
        const key = document.createElement('kbd');
        key.textContent = String(i + 1);
        li.append(key, ` ${o.text}`);
        if (o.text.startsWith('[Abgeben]')) li.classList.add('is-turnin');
        return li;
      }),
    );
  }
}
