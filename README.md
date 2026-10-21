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
| `?nopost`     | Ohne Nachbearbeitung (für schwächere Grafikkarten)      |

Im Dev-Modus ist die Spielinstanz als `window.game` in der Konsole erreichbar.

## Steuerung

| Taste               | Aktion                                |
| ------------------- | ------------------------------------- |
| `W A S D`           | Bewegen                               |
| Maus                | Umsehen (Pointer Lock)                |
| `Shift`             | Rennen (kostet Ausdauer)              |
| `Leertaste`         | Springen / im Wasser auftauchen       |
| `Strg` / `C`        | Ducken / im Wasser tauchen            |
| `E`                 | Aufheben, Pflücken, Trinken, Ausnehmen, Fleisch braten/abnehmen |
| Linksklick          | Mit Werkzeug schlagen / Nahrung essen / Speer werfen (beim Zielen) |
| `1`–`6` / Mausrad   | Schnellzugriff wählen                 |
| `Tab` / `I`         | Inventar öffnen/schließen             |
| `B`                 | Herstellen & Bauen (Inventar)         |
| `R` / Mausrad       | Bauvorschau drehen                    |
| Rechtsklick         | Blocken (mit Waffe) / Speer zum Wurf anlegen / Bauen abbrechen |
| `F3`                | Debug-Anzeige (FPS, Draw Calls, …)    |
| `F4`                | Nachbearbeitung an/aus                |
| `T` (mit F3)        | Zeitraffer                            |
| `Esc`               | Pause                                 |

> **Hinweis zu Strg:** `Strg+W` schließt im Browser den Tab. Deshalb ist Ducken zusätzlich auf `C`
> gelegt. Mit der Option „Vollbild“ im Startmenü wird die Keyboard-Lock-API aktiviert – dann
> funktioniert auch `Strg` gefahrlos (Chromium-Browser).

## Aktueller Stand

### Meilenstein 7 – Größere Welt & Terrain-LOD

- **Insel 1,5 × 1,5 km** (2,25-fache Fläche): Die Rausch-Frequenzen sind absolut, die Inselmaske relativ – die größere
  Insel bekommt dadurch mehr Hügel, Gebirgszüge und Seen statt nur gestreckter Formen. Rund 21 000 Bäume/Büsche/Felsen,
  sechs Schrat-Lager, sieben Hirschrudel, 18 Hasen.
- **Terrain-LOD:** Jeder 128-m-Chunk liegt in vier Auflösungen vor (2 / 4 / 8 / 16 m Rasterabstand). Die Stufe richtet
  sich nach der Entfernung zum Chunk-Rand (mit Hysterese gegen Flackern); in Spielernähe ist es immer die volle
  Auflösung, die exakt der Kollision entspricht. Gröbere Stufen nehmen jedes n-te Sample der vollen Auflösung
  (gleiche Höhen, Normalen und Farben → keine Farbsprünge).
- **Schürzen statt Risse:** An jedem Chunk-Rand hängt eine nach außen gerichtete, senkrechte Schürze, die Spalten zwischen
  Nachbarn unterschiedlicher Stufe verdeckt – ohne Nachbar-abhängige Index-Puffer.
- Ferne Stufen werfen keine Schatten (liegen ohnehin außerhalb der Schattenkamera). Im Debug-Overlay (`F3`) zeigt
  „Terrain-LOD“ die Verteilung der Chunks auf die Stufen.
- Ladezeit trotz doppelter Fläche ≈ 1,5 s für Höhenkarte, Terrain (alle Stufen) und Vegetation zusammen.

### Meilenstein 6 – Survival-Ausbau: Jagd, Kochen, Haltbarkeit

- **Wild:** Hirschrudel (mit und ohne Geweih) und Hasen auf offenen Wiesen, prozedural animiert (Trab/Galopp,
  Hoppeln, Grasen, Sichern mit erhobenem Schwanz, Umkippen beim Tod). Alle Tiere einer Art = ein Draw Call pro Körperteil
  (gemeinsamer `RigRenderer` mit den Schraten).
- **Flucht-KI:** Tiere grasen und streifen umher. Kommt der Spieler zu nah, sichert ein Hirsch kurz, bellt und
  warnt das Rudel, dann flieht alles im Galopp (schneller als der Spieler). Geduckt halbiert sich die Fluchtdistanz
  deutlich, Rennen vergrößert sie. Lärm (Bäume fällen, Kämpfe, Würfe) verscheucht Wild im weiten Umkreis.
  Bestände wachsen fernab des Spielers nach.
- **Speerwurf:** Rechte Maustaste legt den Speer an, linke wirft. Das Geschoss fliegt ballistisch (auf ~12 m genau
  auf die Bildmitte), richtet sich nach der Flugbahn aus und prüft pro Physik-Takt das zurückgelegte Segment per Raycast
  (kein Durchtunneln, Kopftreffer bei Schraten). Im Boden, in Bäumen und Bauwerken bleibt der Speer stecken und
  kann wieder aufgehoben werden; Wurfschaden ×1,6.
- **Jagdbeute:** Erlegte Tiere mit `E` ausnehmen → rohes Fleisch (Hirsch 3, Hase 1). Roh gegessen macht es satt, aber
  krank (Gesundheit sinkt).
- **Kochen:** Mit rohem Fleisch in der Hand legt `E` an einem brennenden Lagerfeuer ein Stück auf den Bratspieß
  (bis zu drei, 12 s Garzeit, sichtbare Verfärbung, Brutzeln). Fertiges nimmt `E` ab – gebratenes Fleisch sättigt
  stark und heilt.
- **Haltbarkeit:** Werkzeuge nutzen sich pro Treffer ab, Fackeln brennen in der Hand herunter (Zustandsbalken im
  Inventar und Schnellzugriff). Beschädigte Werkzeuge stapeln nicht und behalten ihren Zustand beim Fallenlassen und Werfen.

### Meilenstein 5 – Atmosphäre: Audio & Effekte

- **3D-Audio:** Effekte mit Position laufen über HRTF-Panner. Man hört, aus welcher Richtung ein Schrat knurrt oder
  ein Baum fällt (je höher der Ton, desto klarer die Ortung). Unter Wasser klingt alles dumpf (Tiefpass auf dem Master).
- **Kulisse** (prozedural, ohne Audiodateien): böiger Wind (stärker in der Höhe und im Offenen, im Wald gedämpft),
  Brandung bzw. Plätschern je nach Wassernähe (Meer lauter als See), Vogelrufe am Tag (häufiger im Wald),
  Grillen und Eulen in der Nacht, Unterwasser-Rauschen.
- **Schritte je Untergrund:** Gras, Sand, Fels, Holz (auf Bauwerken) und Wasser – synchron zum Head-Bob,
  leiser beim Schleichen, Schwimmzüge, Landegeräusch. Auch die Schrate sind räumlich zu hören, wenn sie sich nähern.
- **Gras:** ~14 000 Büschel komplett auf der GPU. Der Vertex-Shader liest Bodenhöhe (gleiche Dreiecks-Interpolation
  wie die Kollision) und Dichte aus Texturen; dazu Wind, Wegbiegen um den Spieler und Ausblenden am Rand.
  Ein Draw Call, keine CPU-Arbeit pro Frame.
- **Nachbearbeitung** (HDR-Render-Target mit MSAA):
  - Lichtstrahlen (Sonne bzw. Mond) durch Bäume, am stärksten bei tiefer Sonne und Morgennebel
  - Bloom für Feuer, Fackel, Sonne und die Augen der Schrate
  - Vignette, ACES-Tone-Mapping am Ende
  - Abschaltbar mit `F4` bzw. `?nopost`. Beim Umschalten werden die Shader einmalig neu kompiliert (kurzer Ruckler).

### Meilenstein 4 – Gegner-KI & Kampf

- **Schrate:** hagere Waldkreaturen mit glimmenden Augen und Keulen, die in Lagern (Totem, Feuer, Pfahlring) leben (seit Meilenstein 7: sechs).
  Prozedurale Animation: Gehen/Rennen, lauernde Haltung, Ausholen und Zuschlagen, Zucken bei Treffern, Schreien, Umfallen.
  Alle Schrate zusammen brauchen ≈ 9 Draw Calls, weil jedes Körperteil als InstancedMesh gerendert wird.
- **Wahrnehmung:**
  - **Sicht:** Sichtkegel von 120° plus Sichtlinie per Raycast. Tagsüber 32 m, nachts 14 m; mit Fackel oder am Feuer
    34 m; geduckt nur 55 %. Misstrauen baut sich auf Distanz langsam auf (Schleichen lohnt sich).
  - **Gehör:** Sprinten (22 m), Gehen (9 m), geduckt (2,5 m), Holzhacken (30 m), fallende Bäume (45 m), Bauen, Kampf.
- **Verhalten:** Patrouille ums Lager → Nachsehen (Geräusch/Sichtung) → Schrei + Artgenossen alarmieren → Verfolgen
  → Angriff mit sichtbarem Ausholen (ausweichbar, die Richtung ist ab dem Schlag festgelegt) → bei wenig Leben Flucht.
  Spur verloren → am letzten bekannten Ort suchen. Nachts halten sie Abstand zu brennenden Lagerfeuern, außer man greift sie an.
- **Wegfindung:** Navigationsraster aus der Höhenkarte (kein Wasser, keine Steilhänge, Bäume/Felsen/Bauwerke als
  Hindernisse) mit A* (begrenztes Budget pro Takt) und Sichtlinien-Glättung. Gebaute Wände versperren Wege wirklich.
  Ist man eingemauert, schlagen sie die Wand ein. Wasser ist eine Fluchtmöglichkeit: Schrate schwimmen nicht.
- **Kampf:** Treffer per Raycast im Aufprallmoment, Kopftreffer ×2, Rückstoß und Taumeln (unterbricht deren Angriff),
  Blut, Lebensbalken, rote Treffer- bzw. Kill-Markierung. **Blocken** (rechte Maustaste) schluckt 80 % des Schadens
  gegen Ausdauer. Bei Treffern wackelt die Kamera und eine Anzeige zeigt die Richtung des Angreifers.
- **Fallen:** Stachelfallen verletzen hineinlaufende Schrate (und nutzen sich dabei ab).
- **Regie:** Nachts schickt das nächste Lager Jagdgruppen los. Gefallene Schrate werden ersetzt, wenn man weit weg ist.
  Nach dem eigenen Tod beruhigen sich alle, und niemand lauert am Aufwachpunkt. Weit entfernte Schrate pausieren (LOD).

### Meilenstein 3 – Crafting & Bausystem

- **Herstellen** (rechte Spalte im Inventar, `B`): Rezepte zeigen Icon und vorhandene/benötigte Materialien;
  Hergestelltes landet im Inventar (bei vollem Inventar fällt der Rest auf den Boden).
  - **Steinaxt** (1 Stock, 2 Steine): fällt Bäume deutlich schneller und schlägt 2 Steine pro Treffer ab
  - **Speer** (2 Stöcke, 1 Stein): Stoß-Waffe mit großer Reichweite (für das kommende Kampfsystem)
  - **Fackel** (2 Stöcke): leuchtet in der Hand, mit flackernder Flamme
- **Bauen:** Wählt man einen Bauplan, erscheint eine transparente Vorschau vor dem Spieler, die dem Gelände folgt
  und sich drehen lässt (`R`/Mausrad). Grün heißt baubar; rot nennt den Grund („Kein Platz“, „Du stehst im Weg“,
  „Untergrund zu steil“, „Nicht im Wasser“, „Material fehlt“). Material wird erst beim Platzieren verbraucht.
  Reicht es für ein weiteres Stück, bleibt der Baumodus aktiv.
  - **Lagerfeuer** (3 Stöcke, 4 Steine): Licht, Flammen, aufsteigende Glut, Knistern; mit `E` löschen/anzünden.
    Am Feuer regenerieren sich Gesundheit (×4) und Ausdauer (×1,6) schneller.
  - **Holzwand** (2 Stämme): Palisadenstück, das an den Enden anderer Wände einrastet
  - **Unterstand** (3 Stämme, 4 Stöcke): ab 19 Uhr mit `E` bis zum Morgen schlafen (kostet Hunger und Durst,
    füllt Ausdauer und etwas Gesundheit auf) – und hier wacht man nach dem Tod wieder auf
  - **Stachelfalle** (6 Stöcke, 2 Steine): versperrt Wege. Schaden an Gegnern kommt mit dem KI-Meilenstein.
- **Abreißen:** Bauwerke mit der Axt zerschlagen; die Hälfte des Materials fällt heraus.
- **Licht:** feste Anzahl Punktlichter, jedes Frame den nächstgelegenen Feuern/der Fackel zugewiesen. So gibt es keine
  Shader-Neukompilierung (Ruckler) beim Bauen eines Feuers.

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
- **Welt:** 1 × 1 km Insel (seit Meilenstein 7: 1,5 × 1,5 km) aus Simplex-fBm + Ridged-Noise mit Stränden, Gebirge und Binnenseen
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
│   ├── Terrain.ts          Chunk-Meshes mit Vertex-Farben, 4 LOD-Stufen + Schürzen
│   ├── Water.ts            Wasserfläche mit Wellen-Normalen
│   ├── Vegetation.ts       Platzierung, Instancing, Collider, Entfernen (für Fällen)
│   ├── VegetationGeometry.ts  Low-Poly-Geometrien für Bäume/Büsche/Felsen
│   ├── SkyDome.ts          Himmels-Shader (Gradient, Sonne, Mond, Sterne)
│   ├── Grass.ts            GPU-Gras (Höhe/Dichte aus Texturen, Wind, Wegbiegen)
│   └── World.ts            Bündelt alles, sucht den Spawnpunkt
├── entities/
│   ├── Player.ts           First-Person-Controller
│   ├── PlayerStats.ts      Gesundheit, Ausdauer, Hunger, Durst
│   ├── ViewModel.ts        Gegenstand in der Hand + Animationen (eigene Szene/Kamera)
│   ├── FireEffect.ts       Flackernde Flamme (Lagerfeuer, Fackel)
│   ├── RigRenderer.ts      Instanziertes Zeichnen prozeduraler Skelette (Gegner & Tiere)
│   ├── animals/
│   │   ├── Animal.ts       Wildtier: Character Controller, Flucht-KI, Tod/Leiche (getestet)
│   │   └── AnimalRig.ts    Vierbeiner-Skelett (Hirsch, Hase) + Geometrien
│   ├── enemies/
│   │   ├── Enemy.ts        Schrat: Character Controller, Wahrnehmung, Zustandsautomat
│   │   ├── EnemyRig.ts     Prozedurales Skelett + Animation, Körperteil-Geometrien
│   │   └── EnemyRenderer.ts  Alle Gegner als InstancedMeshes (ein Draw Call pro Körperteil)
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
│   ├── Crafting.ts         Rezepte + Materialverbrauch (reine Logik, getestet)
│   ├── LightPool.ts        Fester Pool an Punktlichtern für Feuer & Fackel
│   ├── Particles.ts        Gepooltes Partikelsystem (Späne; leuchtend für Glut)
│   ├── Audio.ts            Prozedurale Soundeffekte, Busse, 3D-Panner, Unterwasser-Filter
│   ├── Ambience.ts         Wind, Brandung, Vögel, Grillen, Eulen
│   ├── Footsteps.ts        Schritte je Untergrund (Spieler & Schrate)
│   ├── PostFX.ts           Lichtstrahlen, Bloom, Vignette, Tone Mapping
│   ├── AnimalDirector.ts   Wild: Verteilung, Rudel-Warnung, Treffer, Ausnehmen, Nachwachsen
│   ├── Projectiles.ts      Wurfgeschosse (ballistisch, Segment-Raycast, Steckenbleiben)
│   ├── Cooking.ts          Bratspieß am Lagerfeuer
│   ├── ai/
│   │   ├── NavGrid.ts      Navigationsraster + A* + Pfadglättung (getestet)
│   │   ├── EnemyDirector.ts  Lager, Spawns, Geräusche, Jagdgruppen, Treffer, LOD
│   │   └── CampModel.ts    Modell eines Schrat-Lagers
│   └── building/
│       ├── StructureDefs.ts  Bauwerke: Modelle (pro Material verschmolzen), Collider, Kosten
│       └── BuildingSystem.ts Vorschau, Platzierungsprüfung, Einrasten, Bauen, Abreißen, Feuer
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
3. ~~Crafting~~ ✓
4. ~~Bausystem~~ ✓
5. ~~Kampf~~ ✓
6. ~~Gegner-KI~~ ✓
7. ~~Audio & Effekte~~ ✓ (später noch: Wetter/Regen, Lautstärke-Einstellungen, Grafik-Qualitätsstufen)
8. ~~Größere Welt & Terrain-LOD~~ ✓ · **Savegames** (Meilenstein 8)
9. ~~Jagd & Survival-Ausbau: Speerwurf, Tiere, Fleisch, Kochen, Haltbarkeit~~ ✓
10. Später: unterschiedliche Gegnertypen, Schleichangriffe, Wasserbehälter, weitere Bauteile (Böden, Tore)
