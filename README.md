# 🌲 Wildwood – Browser-Survival in 3D

Ein First-Person-Survival-Game im Stil von *The Forest*, komplett im Browser:
**Three.js** für das Rendering, **Rapier** (WASM) für die Physik, **Simplex-Noise** für eine prozedural
generierte Wald-Insel und ein schlankes **HTML/CSS-HUD** über dem WebGL-Canvas.

## Schnellstart

```bash
npm install
npm run dev        # Dev-Server auf http://localhost:5173
npm run build      # Typecheck + Produktions-Build nach dist/
npm test           # Unit-Tests (Vitest)
```

URL-Parameter für die Entwicklung:

| Parameter     | Wirkung                                                 |
| ------------- | ------------------------------------------------------- |
| `?seed=42`    | Andere Insel generieren (Standard-Seed: `1337`)         |
| `?autostart`  | Ohne Menü und Pointer Lock starten (Screenshots/Tests)  |

Im Dev-Modus ist die Spielinstanz als `window.game` in der Konsole erreichbar.

## Steuerung

| Taste               | Aktion                                |
| ------------------- | ------------------------------------- |
| `W A S D`           | Bewegen                               |
| Maus                | Umsehen (Pointer Lock)                |
| `Shift`             | Rennen (kostet Ausdauer)              |
| `Leertaste`         | Springen / im Wasser auftauchen       |
| `Strg` / `C`        | Ducken / im Wasser tauchen            |
| `E`                 | Aufheben, Beeren pflücken, Trinken    |
| Linksklick          | Mit Werkzeug schlagen / Nahrung essen |
| `1`–`6` / Mausrad   | Schnellzugriff wählen                 |
| `Tab` / `I`         | Inventar öffnen/schließen             |
| `F3`                | Debug-Anzeige (FPS, Draw Calls, …)    |
| `T` (mit F3)        | Zeitraffer                            |
| `Esc`               | Pause                                 |

> **Hinweis zu Strg:** `Strg+W` schließt im Browser den Tab. Deshalb ist Ducken zusätzlich auf `C`
> gelegt. Mit der Option „Vollbild“ im Startmenü wird die Keyboard-Lock-API aktiviert – dann
> funktioniert auch `Strg` gefahrlos (Chromium-Browser).

## Aktueller Stand

### Meilenstein 2 – Interaktion, Ressourcen & Inventar

- **Interaktionssystem:** ein Raycast pro Frame bestimmt das Ziel; das HUD zeigt Taste, Aktion und Objektname
  („Linksklick · Fällen · Kiefer“, „E · Aufheben · Holzstamm“).
- **Bäume fällen:** Mit der Notfallaxt (Startausrüstung) haben Bäume Lebenspunkte je nach Größe. Jeder Treffer
  lässt den Baum wackeln, wirft Holzspäne und klingt nach Holz. Der gefällte Baum kippt als physikalischer
  Rapier-Körper vom Spieler weg, schlägt auf und zerfällt in 2–4 Holzstämme plus Äste. Zurück bleibt ein begehbarer Stumpf.
- **Steine abschlagen:** Felsen liefern je nach Größe 2–8 Steine, danach sind sie erschöpft.
- **Sammeln:** ~1 000 Beerensträucher (Beeren wachsen nach 6 min nach), ~1 400 Äste und ~300 Steine am Boden.
  Holzstämme und Äste schwimmen auf dem Wasser.
- **Inventar:** 24 Rucksack-Slots + 6 Schnellzugriffs-Slots, Stapelgrößen pro Item, Drag & Drop (verschieben,
  stapeln, tauschen), `Shift`+Klick zum Umlagern, Rechtsklick zum Essen/Ausrüsten, Herausziehen zum Fallenlassen.
  Ist das Inventar voll, fällt der Rest als physisches Item auf den Boden.
- **Ausrüstung:** Schnellzugriff per `1`–`6`/Mausrad, Gegenstand in der Hand (eigener Render-Durchgang, ragt nie
  in Wände) mit Animationen für Ausholen/Zuschlagen, Rückstoß, Essen, Wechseln, Sway und Bob.
- **Feedback:** Partikel (Späne, Funken, Blätter), Trefferanzeige, Item-Meldungen, prozedurale Soundeffekte (Web Audio, ohne Audiodateien).
- **Item-Icons** werden beim Start aus den 3D-Modellen gerendert.

### Meilenstein 1 – Grundgerüst

- **Projekt-Setup:** Vite + TypeScript (strict), Vitest, modulare Ordnerstruktur.
- **Game Loop:** fester Physik-Takt (60 Hz, Akkumulator) + interpolierte Kamera → flüssig bei jeder Bildrate.
- **Player Controller:** Rapier *Kinematic Character Controller* mit Kapsel
  - Mouse-Look, Gehen, Rennen, Springen (Coyote-Time + Sprung-Puffer), Ducken mit Kopffreiheits-Prüfung
  - Treppen-/Kanten-Steigen, Hang-Limit, Snap-to-Ground, Fallschaden
  - Schwimmen mit Auftrieb, Tauchen, Atemluft & Ertrinken
  - Head-Bob, Lande-Einfedern, Sprint-FOV
- **Spieler-Stats:** Gesundheit, Ausdauer (mit Erschöpfung), Hunger, Durst, Regeneration, Tod & Wiederbeleben
- **Welt:** 1 × 1 km Insel aus Simplex-fBm + Ridged-Noise mit Stränden, Gebirge und Binnenseen
  - Chunk-basiertes Terrain-Mesh mit Vertex-Färbung (Sand, Gras, Erde, Fels nach Höhe/Steilheit)
  - ~7 700 Bäume, Büsche und Felsen per *InstancedMesh*, pro Chunk gruppiert (Frustum-Culling), Wind-Animation im Shader
  - Statische Collider für Stämme (Zylinder) und Felsen (konvexe Hülle)
  - Animiertes Wasser (Meer + Seen), Trinken per `E`
- **Atmosphäre:** Tag/Nacht-Zyklus (20 min), prozeduraler Himmel mit Sonne, Mond und Sternen,
  dynamischer Nebel (Morgennebel, dichtere Nächte, Unterwasser-Nebel), Schatten folgen dem Spieler
- **HUD & Menü:** Statusbalken, Uhrzeit, Interaktions-Prompt, Treffer-Vignette, Start/Pause/Tod-Bildschirm

## Projektstruktur

```
src/
├── main.ts                 Einstiegspunkt (URL-Parameter, Bootstrapping)
├── config.ts               Alle Balancing- und Qualitätswerte an einem Ort
├── core/
│   ├── Game.ts             Erzeugt alle Systeme, Game Loop (fester Physik-Takt)
│   ├── Input.ts            Tastatur/Maus, Pointer Lock, Key-Bindings
│   ├── Physics.ts          Rapier-Wrapper, Kollisionsgruppen, Terrain-Heightfield
│   └── EventBus.ts         Typisierte Events zur Entkopplung der Systeme
├── world/
│   ├── HeightMap.ts        Prozedurale Höhenkarte (rein, ohne Three.js → testbar)
│   ├── Terrain.ts          Chunk-Meshes mit Vertex-Farben
│   ├── Water.ts            Wasserfläche mit Wellen-Normalen
│   ├── Vegetation.ts       Platzierung, Instancing, Collider, Entfernen (für Fällen)
│   ├── VegetationGeometry.ts  Low-Poly-Geometrien für Bäume/Büsche/Felsen
│   ├── SkyDome.ts          Himmels-Shader (Gradient, Sonne, Mond, Sterne)
│   └── World.ts            Bündelt alles, sucht den Spawnpunkt
├── entities/
│   ├── Player.ts           First-Person-Controller
│   ├── PlayerStats.ts      Gesundheit, Ausdauer, Hunger, Durst
│   ├── ViewModel.ts        Gegenstand in der Hand + Animationen (eigene Szene/Kamera)
│   └── items/
│       ├── ItemDefs.ts     Item-Registry (Name, Stapelgröße, Werkzeug-/Nahrungswerte)
│       ├── ItemMeshes.ts   Prozedurale 3D-Modelle + Kollisionsformen
│       └── WorldItems.ts   Physische Items in der Welt (Rapier-Rigidbodies, Auftrieb)
├── systems/
│   ├── DayNightCycle.ts    Sonnenstand, Licht, Nebel, Schattenkamera
│   ├── Inventory.ts        Slot-Inventar (reine Logik, getestet)
│   ├── ItemService.ts      Items geben/werfen, Überlauf in die Welt
│   ├── InteractionSystem.ts  Ziel-Raycast, Hinweise, E-Aktionen
│   ├── ToolController.ts   Schnellzugriff, Schläge (Treffer im Aufprallmoment), Essen
│   ├── HarvestSystem.ts    Bäume fällen (fallender Rigidbody → Stämme), Steine abschlagen
│   ├── Particles.ts        Gepooltes Partikelsystem (ein Draw Call)
│   └── Audio.ts            Prozedurale Soundeffekte (Web Audio)
├── ui/
│   ├── HUD.ts              Statusanzeigen, Hinweis, Schnellzugriff, Meldungen
│   ├── InventoryUI.ts      Inventarfenster mit Drag & Drop
│   ├── ItemIcons.ts        Icons aus den 3D-Modellen rendern
│   ├── Menu.ts             Lade-, Start-, Pause- und Todesbildschirm
│   ├── slots.ts / dom.ts   Kleine DOM-Helfer
└── utils/                  Mathe- und Zufallshelfer (deterministischer PRNG)
```

## Technische Notizen

- **Kollision = Optik:** Render-Mesh und Rapier-Heightfield lesen dasselbe Höhenraster und verwenden
  dieselbe Dreiecksdiagonale. Ein Test (`HeightMap.test.ts`) prüft per Raycast, dass beide übereinstimmen.
- **Determinismus:** Die ganze Welt entsteht aus einem Seed (Mulberry32 + abgeleitete Sub-Seeds) – Grundlage für Savegames und Multiplayer.
- **Performance:** Terrain und Vegetation sind in 128-m-Chunks gegliedert, damit Kamera- *und* Schatten-Frustum
  unsichtbare Teile verwerfen. Die Schattenkamera wird im Lichtraum auf das Texelraster gerundet (kein Flimmern).
- **Spielzustände:** `playing` / `inventory` / `paused` / `dead`. Im Inventar ist die Maus frei, die Welt läuft weiter.
- **Kollisionsgruppen:** Der Spieler läuft durch lose Items. Gefällte Bäume kollidieren nur mit dem Terrain, damit sie sich
  nicht in Nachbarbäumen verkeilen. Aufsammelbares sind Sensoren: per Raycast anvisierbar, aber ohne Kollision.
- **Bundle-Größe:** `@dimforge/rapier3d-compat` bettet sein WASM als base64 ein (~1,7 MB gzip) und wird als eigener Chunk ausgeliefert.

## Roadmap

1. ~~Interaktion & Ressourcen~~ ✓
2. ~~Inventar~~ ✓
3. **Crafting:** Rezepte (Stock + Stein = Axt, Holz = Lagerfeuer …), Crafting-Menü
4. **Bausystem:** Ghost-Vorschau am Terrain ausgerichtet, Snapping, Wände/Lagerfeuer/Fallen/Unterstände
5. **Kampf:** Axt-Animation, Hitboxen, Treffer-Feedback
6. **Gegner-KI:** Navigations-Raster auf der Höhenkarte, Patrouille, Wahrnehmung (Sicht/Geräusch), Nahkampf
7. **Audio & Effekte:** Ambient-Sounds, Schritte je Untergrund, God-Rays (Post-Processing), Gras (Basis-SFX sind bereits da)
8. **Welt-Streaming:** LOD für entfernte Chunks, größere bzw. endlose Welten, Savegames
