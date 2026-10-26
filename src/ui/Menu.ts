import { collectRefs } from './dom';
import type { DamageSource } from '../core/EventBus';
import type { SaveSummary } from '../systems/SaveGame';

export type MenuState = 'loading' | 'start' | 'paused' | 'dead' | 'hidden';

const DEATH_TEXT: Record<DamageSource, string> = {
  fall: 'Du bist zu tief gestürzt.',
  starvation: 'Du bist verhungert.',
  dehydration: 'Du bist verdurstet.',
  drowning: 'Du bist ertrunken.',
  enemy: 'Du wurdest getötet.',
  sickness: 'Das rohe Fleisch war zu viel für deinen Magen.',
  cold: 'Nass bis auf die Haut bist du in der Nacht erfroren.',
  fire: 'Du bist in den Flammen umgekommen.',
  world: 'Du bist gestorben.',
};

/** Vollbild-Menü für Ladebildschirm, Start, Pause und Tod. */
export class Menu {
  private readonly el;
  private state: MenuState = 'loading';

  /** Wird beim Klick auf den Haupt-Button aufgerufen (aus einer User-Geste heraus). */
  onPlay: ((wantsFullscreen: boolean) => void) | null = null;
  /** "Neues Spiel" (nur sichtbar, wenn ein Spielstand existiert). */
  onNewGame: (() => void) | null = null;

  constructor(private readonly root: HTMLElement) {
    this.el = collectRefs(root, [
      'subtitle',
      'play',
      'newGame',
      'saveInfo',
      'controls',
      'fullscreen',
      'fullscreenOption',
      'settingsButton',
      'settings',
      'settingsForm',
      'settingsBack',
      'mainPanel',
    ] as const);
    this.el.settingsButton.addEventListener('click', () => this.toggleSettings(true));
    this.el.settingsBack.addEventListener('click', () => this.toggleSettings(false));
    this.el.play.addEventListener('click', () => {
      this.onPlay?.((this.el.fullscreen as HTMLInputElement).checked);
    });
    this.el.newGame.addEventListener('click', () => this.onNewGame?.());
  }

  /** Container, in den das Einstellungsformular gebaut wird. */
  get settingsContainer(): HTMLElement {
    return this.el.settingsForm;
  }

  private toggleSettings(open: boolean): void {
    this.el.settings.classList.toggle('hidden', !open);
    this.el.mainPanel.classList.toggle('hidden', open);
  }

  get current(): MenuState {
    return this.state;
  }

  setLoading(text: string): void {
    this.state = 'loading';
    this.show(text, null);
  }

  /** @param save Kurzinfo des geladenen Spielstands (null = neues Spiel). */
  showStart(save: SaveSummary | null): void {
    this.state = 'start';
    if (save) {
      const h = Math.floor(save.hour);
      const m = Math.floor((save.hour - h) * 60);
      const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      this.show(`Spielstand: Tag ${save.day} · ${clock} Uhr`, 'Fortsetzen', `Gespeichert ${formatDate(save.savedAt)}`);
      this.el.newGame.classList.remove('hidden');
    } else {
      this.show('Überlebe auf der Insel.', 'Spielen');
    }
  }

  showPaused(lastSaved: Date | null): void {
    this.state = 'paused';
    this.show('Pausiert', 'Weiterspielen', lastSaved ? `Automatisch gespeichert ${formatDate(lastSaved)}` : null);
  }

  showDeath(cause: DamageSource): void {
    this.state = 'dead';
    this.show(DEATH_TEXT[cause], 'Wiederbeleben');
  }

  showError(text: string): void {
    this.state = 'loading';
    this.show(text, null);
  }

  hide(): void {
    this.state = 'hidden';
    this.root.classList.add('hidden');
  }

  private show(subtitle: string, button: string | null, saveInfo: string | null = null): void {
    this.root.classList.remove('hidden');
    this.el.newGame.classList.add('hidden');
    this.el.saveInfo.classList.toggle('hidden', !saveInfo);
    this.el.saveInfo.textContent = saveInfo ?? '';
    this.el.subtitle.textContent = subtitle;
    this.el.play.classList.toggle('hidden', button === null);
    if (button) this.el.play.textContent = button;
    const interactive = button !== null;
    this.el.controls.classList.toggle('hidden', !interactive || this.state === 'dead');
    this.el.fullscreenOption.classList.toggle('hidden', !interactive || this.state === 'dead');
    this.el.settingsButton.classList.toggle('hidden', !interactive || this.state === 'dead');
    this.toggleSettings(false);
  }
}

/** "heute 14:32" bzw. "am 03.05. um 14:32". */
function formatDate(d: Date): string {
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const today = new Date().toDateString() === d.toDateString();
  return today ? `heute ${time}` : `am ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} um ${time}`;
}
