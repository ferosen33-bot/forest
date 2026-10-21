import { collectRefs } from './dom';
import type { DamageSource } from '../core/EventBus';

export type MenuState = 'loading' | 'start' | 'paused' | 'dead' | 'hidden';

const DEATH_TEXT: Record<DamageSource, string> = {
  fall: 'Du bist zu tief gestürzt.',
  starvation: 'Du bist verhungert.',
  dehydration: 'Du bist verdurstet.',
  drowning: 'Du bist ertrunken.',
  enemy: 'Du wurdest getötet.',
  sickness: 'Das rohe Fleisch war zu viel für deinen Magen.',
  world: 'Du bist gestorben.',
};

/** Vollbild-Menü für Ladebildschirm, Start, Pause und Tod. */
export class Menu {
  private readonly el;
  private state: MenuState = 'loading';

  /** Wird beim Klick auf den Haupt-Button aufgerufen (aus einer User-Geste heraus). */
  onPlay: ((wantsFullscreen: boolean) => void) | null = null;

  constructor(private readonly root: HTMLElement) {
    this.el = collectRefs(root, ['subtitle', 'play', 'controls', 'fullscreen', 'fullscreenOption'] as const);
    this.el.play.addEventListener('click', () => {
      this.onPlay?.((this.el.fullscreen as HTMLInputElement).checked);
    });
  }

  get current(): MenuState {
    return this.state;
  }

  setLoading(text: string): void {
    this.state = 'loading';
    this.show(text, null);
  }

  showStart(): void {
    this.state = 'start';
    this.show('Überlebe auf der Insel.', 'Spielen');
  }

  showPaused(): void {
    this.state = 'paused';
    this.show('Pausiert', 'Weiterspielen');
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

  private show(subtitle: string, button: string | null): void {
    this.root.classList.remove('hidden');
    this.el.subtitle.textContent = subtitle;
    this.el.play.classList.toggle('hidden', button === null);
    if (button) this.el.play.textContent = button;
    const interactive = button !== null;
    this.el.controls.classList.toggle('hidden', !interactive || this.state === 'dead');
    this.el.fullscreenOption.classList.toggle('hidden', !interactive || this.state === 'dead');
  }
}
