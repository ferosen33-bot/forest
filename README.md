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
| `?load`       | Mit `?autostart`: trotzdem den Spielstand laden         |
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
| Rechtsklick         | Blocken (mit Waffe) / Speer zum Wurf anlegen / Bogen: zielen / Bauen abbrechen |
| `F3`                | Debug-Anzeige (FPS, Draw Calls, …)    |
| `F4`                | Nachbearbeitung an/aus                |
| `T` (mit F3)        | Zeitraffer                            |
| `Y` (mit F3)        | Nächste Wetterlage                    |
| `Esc`               | Pause                                 |

> **Hinweis zu Strg:** `Strg+W` schließt im Browser den Tab. Deshalb ist Ducken zusätzlich auf `C`
> gelegt. Mit der Option „Vollbild“ im Startmenü wird die Keyboard-Lock-API aktiviert – dann
> funktioniert auch `Strg` gefahrlos (Chromium-Browser).

## Aktueller Stand

### Meilenstein 14 – Fernkampf der Späher

- **Steinwürfe:** Sieht ein Späher den Spieler in 6–20 m Entfernung, holt er aus und wirft einen Stein (8 Schaden,
  alle ~3,5 s). Er zielt ballistisch (flache Lösung der Wurfparabel, `utils/ballistics.ts`) mit Vorhalt auf die
  Laufrichtung und etwas Streuung – seitliches Ausweichen lohnt sich. Die Richtung wird nur während des Ausholens
  nachgeführt, danach ist der Wurf festgelegt.
- **Abwehr:** Blocken fängt auch Steine ab (≈ 80 % weniger Schaden). Steine sind sichtbar unterwegs, prallen ab und
  bleiben als aufhebbare Steine liegen.
- **Feindliche Geschosse** nutzen dasselbe System wie Speer und Pfeil: Segment-Raycast pro Physik-Takt, der Spieler ist
  Ziel statt ausgenommen, Gegner und Tiere werden durchflogen (kein Eigenbeschuss).

### Meilenstein 13 – Bogen & Lagerkiste

- **Bogen** (1 Stamm + 2 Stöcke) und **Pfeile** (2 Stöcke + 1 Stein → 4 Pfeile): Linksklick gedrückt halten spannt
  (0,9 s bis voll), Loslassen schießt; Rechtsklick zoomt zum Zielen. Geschwindigkeit 16–46 m/s und Schaden 10–42
  wachsen mit der Spannung (Schaden quadratisch – halb gespannt lohnt kaum). Zu kurz gespannt bleibt der Pfeil in der
  Hand. Pfeile fliegen über das bestehende Geschoss-System (Segment-Raycast, Kopftreffer, Schleichangriff ×3) und
  bleiben stecken oder fallen herab – zum Wiederaufsammeln; ein Teil zerbricht.
- **Lagerkiste** (16 Plätze): `E` öffnet das Inventar mit der Kiste anstelle der Rezepte. Ziehen zwischen Rucksack und
  Kiste (auffüllen, stapeln oder tauschen), `Shift`+Klick bzw. Rechtsklick lagert in das jeweils andere Inventar um.
  Der Inhalt wird mitgespeichert; wird die Kiste zerstört, fällt er heraus. Das Fenster schließt sich, wenn die Kiste
  verschwindet.

### Meilenstein 12 – Einstellungen

- **Einstellungsfenster** im Start- und Pausenmenü:
  - Ton: Gesamtlautstärke, Effekte und Umgebung getrennt
  - Steuerung: Mausempfindlichkeit, Maus invertieren, Sichtfeld (60–100°)
  - Grafik: Qualitätsstufe und Lichtstrahlen/Bloom
- **Grafikstufen:**

  | Stufe | Schatten | Gras-Radius | Sichtweite | Vegetation | Pixelverhältnis |
  | --- | --- | --- | --- | --- | --- |
  | Niedrig | 1024² | aus | 320 m | 190 m | 1 |
  | Mittel | 2048² | 24 m | 400 m | 240 m | 1,5 |
  | Hoch | 2048² | 36 m | 450 m | 280 m | 2 |

- Alles wirkt sofort, ohne Neustart. Das Gras ist nach Entfernung sortiert, ein kleinerer Radius zeichnet einfach
  weniger Büschel. Neu kompiliert wird nur beim Umschalten der Nachbearbeitung bzw. der Schattenauflösung.
- Gespeichert im Browser (getrennt vom Spielstand – „Neues Spiel“ behält sie), defensiv geprüft. `F4` und `?nopost`
  bleiben erhalten und stellen die Einstellung mit um.

### Meilenstein 11 – Gegnertypen & Schleichangriffe

- **Drei Gegnertypen** (Werte in `EnemyKinds.ts` als Faktoren auf `CONFIG.ai`):

  | Typ | Merkmale |
  | --- | --- |
  | **Schrat** | der Standardgegner mit Keule |
  | **Späher** | klein und flink (×1,28 Tempo), halb so viele Lebenspunkte, ohne Keule; sieht und hört weiter, sein Warnschrei alarmiert im doppelten Umkreis; greift an und weicht danach zurück |
  | **Koloss** | ×1,4 Größe, ×2,6 Leben, ×2,2 Schaden, aber langsam und mit lang ausgeholtem, gut ausweichbarem Hieb; taumelt nur bei schweren Treffern, fürchtet kein Feuer und reißt Bauwerke dreimal so schnell ein |

- **Lagerbesetzung:** jedes Lager hat einen Späher, jedes zweite zusätzlich einen Koloss; Gefallene werden durch
  denselben Typ ersetzt. Kollisionskapsel, Kopf-Hitbox und Stufenhöhe skalieren mit der Größe.
- **Schleichangriffe:** Treffer gegen Gegner, die den Spieler nicht bemerkt haben, richten dreifachen Schaden an
  (auch mit dem Wurfspeer, Kopftreffer kommen noch hinzu). Ein lautloser Kill lockt kaum jemanden an.
  Geduckt kann man sich von hinten bis auf etwa 1,2 m heranschleichen, aufrecht wird man schon auf 2,5 m bemerkt.
- Die Lebensanzeige zeigt den Namen des Gegners; der Typ wird im Spielstand gespeichert.

### Meilenstein 10 – Böden, Treppen & Tore

- **Holzboden (2,2 × 2,2 m):** Plattform auf Pfählen, die Dielen liegen knapp über dem höchsten Geländepunkt.
  Böden rasten Kante an Kante an Nachbarböden ein (gleiche Höhe und Ausrichtung) – so lassen sich Hänge ausgleichen
  und Plattformen über Abhänge hinaus bauen. Auch als **Steg** über flachem Wasser (bis 1,6 m Tiefe).
- **Bauen auf Böden:** Wände und Tore rasten bündig auf Bodenkanten ein (Dielenhöhe, Kantenrichtung; die Seite
  bleibt per Drehung wählbar). Lagerfeuer, Unterstand und Fallen stehen auf den Dielen statt im Gelände darunter.
- **Holztreppe:** hängt außen an einer freien Bodenkante (auch vor einem Tor) und führt hinab. Kollision als massiver
  Keil, dessen Schräge unter dem Gelände weiterläuft – keine Kante, an der man hängen bleibt.
- **Holztor:** rastet wie eine Wand ein; `E` öffnet und schließt es (animierter Flügel, Knarren). Offen wird der
  Flügel zum Sensor: durchlässig, aber weiter anvisierbar. Die Wegfindung der Schrate kennt **Durchgänge**:
  Ein offenes Tor macht die Zellen seiner Öffnung passierbar, auch wenn der Sicherheitsrand der Nachbarwände sie
  überdeckt (bei 2-m-Navigationszellen läge sonst meist kein Zellmittelpunkt frei). Geschlossen ist die Basis dicht.
  Böden und Treppen gelten als begehbar, nicht als Hindernis.
- Torzustand wird mitgespeichert.
- **Behoben – Spielerbewegung an Schrägen:** Der Spieler übernahm bisher nach jedem Physik-Schritt die tatsächlich
  erreichte Horizontalgeschwindigkeit („kein Aufstauen an Wänden“). Am Fuß einer Rampe fiel sie dadurch auf fast null,
  und danach zeigte der Bewegungswunsch steiler in den Boden als die Rampe – man kam nie hinauf. Jetzt wird nur noch
  der Anteil in echte Wände (steiler als der Kletterwinkel) abgebaut; an begehbaren Schrägen bleibt der Schwung.

### Meilenstein 9 – Wetter & Wasser

- **Wetterlagen:** klar → bewölkt → Regen (→ Gewitter) → aufklarend. Bewölkung, Regen und Wind gleiten weich auf die
  Zielwerte jeder Phase zu; Regen setzt erst bei dichter Bewölkung ein. Reine Logik in `Weather.ts` (getestet).
- **Himmel & Licht:** Wolkendecke im Himmels-Shader (fBm-Rauschen auf einer Perspektiv-Ebene, zieht mit dem Wind,
  Sonne scheint durch dünne Ränder). Bedeckter Himmel vergraut Himmel, Nebel und Umgebungslicht, schluckt das direkte
  Sonnenlicht und die Lichtstrahlen; Regen verdichtet den Nebel.
- **Regen auf der GPU:** bis zu 9 000 Schlieren in einem Volumen, das mit der Kamera wandert (Modulo im Vertex-Shader,
  im Wind geneigt) – ein Draw Call. Der Boden wird nass (dunkler, glänzender) und trocknet langsam wieder.
- **Gewitter:** Blitze erhellen Himmel und Szene, der Donner folgt mit Schallgeschwindigkeit (nah: Knall + Grollen).
  Sturmwind lässt Bäume und Gras stärker schwanken und rauscht lauter. Regen prasselt – unter dem Dach dumpfer.
- **Nässe & Kälte:** Im Regen wird man nass (Baumkronen halten etwa die Hälfte ab, ein Dach alles), Schwimmen macht
  sofort klatschnass. Am Feuer trocknet man schnell, an der Luft langsam. Nass regeneriert Ausdauer schlechter und
  Gesundheit gar nicht; **nachts nass ohne Feuer kühlt man aus** (Lebensverlust, eigene Todesursache).
  Anzeige: Nässe-Balken ☔ (pulsiert bei Unterkühlung).
- **Feuer im Regen:** Ungeschützte Lagerfeuer erlöschen bei anhaltendem Starkregen – ein Unterstand darüber schützt
  sie. Fackeln brennen im Regen dreimal so schnell herunter.
- **Holzschale:** aus einem Stamm schnitzen. In der Hand am Wasser mit `E` füllen oder im Regen volllaufen lassen
  (≈ 25 s). Trinken mit Linksklick (bzw. Rechtsklick im Inventar) → +45 Durst, die leere Schale bleibt im selben Slot.
- **Schrate im Regen:** sehen 35 % weniger weit und hören Schritte schlechter – Regen ist die beste Zeit zum Schleichen.
- Wetter und Nässe werden mitgespeichert (ältere Spielstände laden weiterhin).
- **Behoben:** Der Dach-Collider des Unterstands (und die Blätterplatten) waren gespiegelt geneigt – vorne lag das Dach
  physikalisch tief statt hoch. Jetzt passen Optik und Kollision zusammen.

### Meilenstein 8 – Speichern & Laden

- **Automatisch:** alle 90 s Spielzeit, beim Pausieren, nach dem Schlafen und beim Verlassen der Seite
  (Tab schließen, Neuladen, App-Wechsel). Nicht im Tod und nicht mitten in einem Baumfall.
- **Startmenü:** Mit vorhandenem Spielstand heißt der Knopf „Fortsetzen“ (mit Tag, Uhrzeit und Speicherzeitpunkt);
  „Neues Spiel“ verwirft den Stand nach Rückfrage. Das Pausenmenü zeigt, wann zuletzt gespeichert wurde.
- **Was gespeichert wird:** Spieler (Position, Blick, Werte, Aufwachpunkt, gewählter Slot), Uhrzeit und Tag,
  Inventar inkl. Haltbarkeit, gefällte Bäume (Stümpfe), angeschlagene Bäume und Felsen, aufgehobene Äste/Steine,
  nachwachsende Beeren, Bauwerke (Zustand, Feuer an/aus), Bratspieße mit Garfortschritt, alle losen Items (auch
  steckende Speere), Schrate (Lager, Position, Gesundheit) und Wild (inkl. noch nicht ausgenommener Beute).
- **Prinzip:** Die Welt entsteht weiterhin deterministisch aus dem Seed; gespeichert werden nur die *Abweichungen*
  davon (≈ 15 KB JSON in `localStorage`). Jedes System hat ein eigenes `serialize()`/`load()`; ein Spielstand passt
  nur zu derselben Welt (Seed + Größe) und Formatversion und wird defensiv geprüft – kaputte oder fremde Stände werden
  ignoriert statt das Spiel abstürzen zu lassen.
- Entwicklung: `?autostart` lädt bewusst keinen Stand (reproduzierbare Tests), `?autostart&load` schon.

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
  kann wieder aufgehoben werden; Wurfschaden ×1,6. Der Wurf zielt vom Schulterpunkt exakt auf den Punkt unter dem
  Fadenkreuz und ist lautlos – erst der Einschlag macht Lärm.
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
│   ├── Rain.ts             GPU-Regen (mitwanderndes Schlieren-Volumen)
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
│   │   ├── Enemy.ts        Gegner: Character Controller, Wahrnehmung, Zustandsautomat
│   │   ├── EnemyKinds.ts   Gegnertypen (Schrat, Späher, Koloss) und Schleichangriff-Faktor
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
│   ├── Weather.ts          Wetterlagen als Zustandsautomat, Blitz & Donner (getestet)
│   ├── Climate.ts          Wetter ↔ Welt: Nässe, Dächer, Feuer im Regen, nasser Boden, Wind, Regenwasser
│   ├── SaveGame.ts         Spielstand-Format, Prüfung, localStorage-Slot (getestet)
│   ├── Settings.ts         Einstellungen, Grafikstufen, Speicherung (getestet)
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
│   ├── SettingsUI.ts       Einstellungsformular (Ton, Steuerung, Grafik)
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
- **Wegfindung & Bauwerke:** Wände, Fallen, Feuer und geschlossene Tore sind Hindernisse (Zähler je Zelle, damit sich
  überlappende Bauwerke korrekt auf- und abbauen); offene Tore setzen eigene Durchgangs-Zähler, die Vorrang haben.
- **Kollisionsgruppen:** Der Spieler läuft durch lose Items. Gefällte Bäume kollidieren nur mit dem Terrain, damit sie sich
  nicht in Nachbarbäumen verkeilen. Aufsammelbares sind Sensoren: per Raycast anvisierbar, aber ohne Kollision.
- **Geschosse vs. Heightfield:** Rapiers Heightfield-Raycast verfehlt bei fast achsparallelen Strahlen gelegentlich den
  Boden. Projektile prüfen deshalb zusätzlich analytisch gegen die Höhenkarte (gleiche Dreiecks-Interpolation) und
  finden den Eintrittspunkt per Bisektion.
- **Reproduzierbare KI-Tests:** Gegner- und Tier-Tests ersetzen `Math.random` durch einen festen Seed.
- **Bundle-Größe:** `@dimforge/rapier3d-compat` bettet sein WASM als base64 ein (~1,7 MB gzip) und wird als eigener Chunk ausgeliefert.

## Roadmap

1. ~~Interaktion & Ressourcen~~ ✓
2. ~~Inventar~~ ✓
3. ~~Crafting~~ ✓
4. ~~Bausystem~~ ✓
5. ~~Kampf~~ ✓
6. ~~Gegner-KI~~ ✓
7. ~~Audio & Effekte~~ ✓ (später noch: Wetter/Regen, Lautstärke-Einstellungen, Grafik-Qualitätsstufen)
8. ~~Größere Welt & Terrain-LOD~~ ✓ · ~~Savegames~~ ✓
9. ~~Jagd & Survival-Ausbau: Speerwurf, Tiere, Fleisch, Kochen, Haltbarkeit~~ ✓
10. ~~Wetter, Regen, Nässe, Wasserschale~~ ✓
11. ~~Böden, Treppen & Tore~~ ✓
12. ~~Gegnertypen & Schleichangriffe~~ ✓
13. ~~Einstellungen (Ton, Steuerung, Grafikstufen)~~ ✓
14. ~~Bogen & Pfeile, Lagerkiste~~ ✓
15. ~~Fernkampf der Späher (Steinwürfe)~~ ✓
