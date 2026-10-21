import './style.css';
import { Game } from './core/Game';
import { CONFIG } from './config';
import { RAPIER } from './core/Physics';

/**
 * Einstiegspunkt.
 * URL-Parameter (praktisch beim Entwickeln):
 *   ?seed=123     andere Insel generieren
 *   ?autostart    ohne Menü und Pointer Lock starten (Screenshots, Tests) – lädt keinen Spielstand …
 *   ?load         … außer mit diesem Parameter
 *   ?nopost       ohne Nachbearbeitung (Lichtstrahlen, Bloom) – für schwache Grafikkarten
 */
const params = new URLSearchParams(window.location.search);
const seedParam = Number(params.get('seed'));
const config = {
  ...CONFIG,
  seed: Number.isFinite(seedParam) && params.has('seed') ? seedParam : CONFIG.seed,
  graphics: { ...CONFIG.graphics, postProcessing: CONFIG.graphics.postProcessing && !params.has('nopost') },
};

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
  loadSave: !params.has('autostart') || params.has('load'),
})
  .then((game) => {
    game.start();
    // Dev-Hilfen für die Konsole: Spielinstanz und Rapier (z. B. für eigene Physik-Abfragen).
    if (import.meta.env.DEV) Object.assign(window, { game, RAPIER });
  })
  .catch((err: unknown) => {
    console.error(err);
    const subtitle = document.querySelector('[data-ref="subtitle"]');
    if (subtitle) subtitle.textContent = `Fehler beim Start: ${err instanceof Error ? err.message : String(err)}`;
  });
