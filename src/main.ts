import './style.css';
import { Game } from './core/Game';
import { CONFIG } from './config';

/**
 * Einstiegspunkt.
 * URL-Parameter (praktisch beim Entwickeln):
 *   ?seed=123     andere Insel generieren
 *   ?autostart    ohne Menü und Pointer Lock starten (Screenshots, Tests)
 */
const params = new URLSearchParams(window.location.search);
const seedParam = Number(params.get('seed'));
const config = Number.isFinite(seedParam) && params.has('seed') ? { ...CONFIG, seed: seedParam } : CONFIG;

const byId = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} fehlt in index.html`);
  return el;
};

Game.create({
  container: byId('game'),
  hudRoot: byId('hud'),
  menuRoot: byId('menu'),
  inventoryRoot: byId('inventory'),
  config,
  autostart: params.has('autostart'),
})
  .then((game) => {
    game.start();
    if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
  })
  .catch((err: unknown) => {
    console.error(err);
    const subtitle = document.querySelector('[data-ref="subtitle"]');
    if (subtitle) subtitle.textContent = `Fehler beim Start: ${err instanceof Error ? err.message : String(err)}`;
  });
