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
| `E`                 | Aufheben, Pflücken, Trinken, Ausnehmen, Fleisch/Fisch braten, Reuse leeren, Feuer an/aus |
| Linksklick          | Mit Werkzeug schlagen / Nahrung essen / Speer werfen (beim Zielen) / Angel auswerfen, anschlagen |
| `1`–`6` / Mausrad   | Schnellzugriff wählen                 |
| `Tab` / `I`         | Inventar öffnen/schließen             |
| `B`                 | Herstellen & Bauen (Inventar)         |
| `M`                 | Inselkarte ein/aus                    |
| `J`                 | Tagebuch & Ziele                      |
| `K`                 | Fertigkeiten                          |
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

> **Richtung:** Ein Open-World-Survival-Horror im Geist von *The Forest*, mit Plündern und Erkunden wie in *DayZ*,
> Horden-Nächten wie in *7 Days to Die*, Rollenspiel durch Fertigkeiten – und später **Koop-Mehrspieler**
> (alle gemeinsam gegen die Insel). Jetzt geht es um den Inhalt: Überlebende und Aufträge, das Fieber, Wölfe und
> Winter, Verteidigung in der Fiebernacht, neue Schrecken. Der Mehrspieler-Teil folgt danach.

### Meilenstein 35 – Horrorfilm-Optik (Teil 7: Tiere)

- **Echte Tiere:** Statt kantiger Körper laufen Hirsch, Hirschkuh und Hase als fertig modellierte, texturierte Tiere
  mit Skelett über die Insel (OpenGameArt, „created for the wonderful world of Kelgar“, CC0).
  - Hirsche mit Geweih, Hirschkühe ohne. Jedes Tier hat einen leicht anderen Fellton.
  - Der Hase hat ein Fell aus Haarkarten und eine Normalen-Karte.
- **Bewegungen aus der KI:** Grasen (Kopf am Boden, kauen), Sichern (Umschauen), Ruhen, Gehen und Flucht im Galopp
  gehen weich ineinander über. Das Tempo der Beine folgt der Geschwindigkeit.
  - Erlegte Tiere brechen zusammen und bleiben liegen, bis man sie ausnimmt.
  - Auch aus einem Spielstand geladene Tiere liegen gleich am Boden.
- **Gang für das Rotwild:** Dem Modell fehlte ein Schritt. `scripts/prepare-animals.py` erzeugt ihn in Blender über
  die Fuß-IK des Skeletts:
  - Kreuzgang: hinten links, vorne links, hinten rechts, vorne rechts.
  - Die Hufe heben sich und knicken in der Schwungphase ein.
  - Rumpf und Kopf nicken mit.
- **Aufbereitung:** `scripts/prepare-animals.py` (Blender als Python-Modul) übernimmt diese Schritte:
  - Szene säubern und Materialien aus den eingepackten Texturen neu aufbauen.
  - Bewegungen auswählen und benennen.
  - Den falsch benannten Vorderfuß der Hirschkuh reparieren (ihr linkes Vorderbein war in allen Bewegungen steif).

  `scripts/compress-animals.mjs` verkleinert danach die Texturen (zusammen gut 3 MB).
- Fehlen die Modelle, bleiben die bisherigen einfachen Körper.

### Meilenstein 34 – Horrorfilm-Optik (Teil 6: Gras)

- **Echtes Gras:** Statt grüner Dreiecke stehen fotografierte Grasbüschel (Poly Haven „Grass Medium 01“, CC0) als
  zwei gekreuzte Karten je Büschel.
  - Fünf verschiedene Büschel, zufällig gedreht und in der Größe variiert.
  - Die Breite folgt dem Seitenverhältnis des Bildes.
  - Unten sind sie dunkler (Eigenschatten), oben wiegen sie im Wind und biegen sich weg, wenn man durchläuft.
- **Jahreszeiten:** Im Herbst und unter Schnee wird zur Trockengras-Textur überblendet. Auch im Sommer sind einzelne
  Büschel schon trocken.
- Der Atlas ist freigestellt und neu gepackt (`scripts/prepare-grass.py`): nur das jeweilige Büschel, ohne Fremdteile,
  mit ausgebluteten Rändern gegen helle Säume beim Verkleinern.

### Meilenstein 33 – Horrorfilm-Optik (Teil 5: Hände und Werkzeuge)

- **Echte Hand in der Ich-Ansicht:** ein realistischer rechter Unterarm mit Hand und Fingern.
  - Er ist aus dem MakeHuman-Avatar des Projekts [TalkingHead](https://github.com/met4citizen/TalkingHead) (CC0)
    ausgeschnitten: `scripts/prepare-fp-arm.mjs` macht aus 36 MB rund 370 KB.
  - Die Faust wird prozedural geformt: Die Fingerglieder krümmen sich um die Knöchellinie, der Daumen legt sich
    darüber.
  - Für jedes Werkzeug dreht sich der Arm so, dass der Stiel quer durch die Faust läuft und der Unterarm zur
    Kamera zeigt.
  - Die Halte-Posen sitzen etwas höher, damit Hand und Handgelenk im Bild sind.
- **Fotogescannte Werkzeuge und Gegenstände** von Poly Haven (CC0): Beil (die Notfallaxt), Machete, Taschenlampe,
  Verbandskasten, rostige Konserve, Holzschale (mit Wasser).
  - Sie erscheinen in der Hand, in der Welt und als Inventar-Symbole.
  - Gegenstände ohne Scan (Fackel, Steinaxt, Stöcke, Steine, Speer …) bekommen Foto-Oberflächen aus Holz, Rinde und
    Stein.
- **Technik:** `entities/items/ItemModels.ts` bringt jeden Scan auf die Konvention der Item-Modelle: Längsachse +Y,
  Ursprung in der Mitte, Größe wie zuvor, Lampenpunkt an der Linse. Fehlen die Dateien, bleiben die selbstgebauten
  Modelle.

### Meilenstein 32 – Horrorfilm-Optik (Teil 4: echte Figuren)

- **Schrate sind jetzt Gestalten aus einem Horrorfilm.** Die Figuren sind animiert und fotobasiert texturiert, im
  Stil früher Silent-Hill- und Resident-Evil-Spiele. Sie stammen aus [Mesh2Motion](https://github.com/mesh2motion/mesh2motion-app)
  (CC0). Alle teilen ein Skelett und ca. 30 Bewegungen.
  - **Schrat:** gesichtslose, verweste, bandagierte und bleiche Gestalten (zufällig je Schrat, selten ein Clown).
    Sie schleichen im Zombie-Gang, rennen, schlagen zu und schreien, wenn sie dich entdecken.
  - **Späher:** eine bleiche Frau mit langem schwarzem Haar, die geduckt schleicht und mit Steinen wirft.
  - **Koloss:** ein Schlachter mit Schweinemaske, schwerer Gang, Faustschlag.
  - **Kriecher** (Höhlen): ein Skelettwesen, das auf allen vieren kriecht.
- Die Bewegungen hängen direkt an der KI:
  - Gehen, Laufen und Ruhe werden nach Tempo überblendet, mit Schrittgeschwindigkeit passend zum Boden.
  - Der Angriff folgt genau dem Ausholen der KI, der Treffer kommt im richtigen Moment.
  - Dazu kommen Zusammenzucken bei Treffern, ein Warnschrei und vier verschiedene Tode.
  - Horden laufen nicht im Gleichschritt.
- **Leuchtende Augen** sitzen am Kopfknochen. Nachts sieht man oft zuerst nur sie, am Tag schimmern sie kaum.
- **Die Überlebenden** sind echte Menschen:
  - Jonas mit Stoppelbart und Polohemd.
  - Dr. Albers im gelben Schutzanzug (sie erforscht die Seuche).
  - Mia kauert zitternd am Feuer.

  Wer spricht, gestikuliert mit einer Gesprächsbewegung, und alle drehen den Kopf zu dir.
- **Leistung:**
  - Eine Figur hat nur 900–1.600 Dreiecke, auch volle Horden bleiben also leicht.
  - Ferne Figuren rechnen ihre Bewegung seltener (ab 35 m und ab 70 m).
- **Technik:**
  - `entities/characters/CharacterLibrary.ts` lädt die Figuren, passt die Bewegungen je Figur an ihre Knochen an und
    normiert die Größe. Die Augen werden über die inverse Bind-Matrix des Kopfknochens gesetzt.
  - `EnemyAvatars.ts` übersetzt den KI-Zustand in überblendete Bewegungen.
  - Das alte Prozedur-Skelett läuft unsichtbar weiter: Es liefert Sichtlinien, Schritte und Trefferzonen.

### Meilenstein 31 – Horrorfilm-Optik (Teil 3: realistische Bäume, Büsche und Felsen)

- **Echte Bäume statt Klötzchen:** Kiefern mit Nadelzweigen, Eichen mit Ästen und Foto-Blättern, Sträucher mit
  Blattwerk – erzeugt mit einer Fassung des Baumgenerators [EZ-Tree](https://github.com/dgreenheck/ez-tree)
  (MIT, `world/trees/TreeGenerator.ts`). Je Art gibt es zwei Varianten. Sie bewegen sich im Wind, verfärben sich im
  Herbst, tragen im Winter Schnee und werfen durchbrochene Blattschatten.
- **Nah und fern:** Realistische Bäume erscheinen im Umkreis des Spielers. Auf „Hoch“ sind das 60 m, auf „Mittel“
  32 m, auf „Niedrig“ ist es aus. Weiter weg und im Nebel bleiben die einfachen Formen.
  - Ein Baum hat 4.000–5.000 Dreiecke, ein Strauch etwa 2.000.
  - Bei rund 300 Bäumen und Büschen in der Nähe ergibt das etwa 3 Mio. Dreiecke je Bild.
- **Fotogescannte Felsen** (Poly Haven, CC0): zwei Felsen und ein Findling für die großen Brocken. Sie wurden mit
  [meshoptimizer](https://github.com/zeux/meshoptimizer) von bis zu 66.000 auf 1.400–4.800 Dreiecke vereinfacht
  (`scripts/prepare-rocks.mjs`). Die Kollisionshülle stammt aus derselben Form.
- **Fällen:** Der fallende Baum ist das realistische Modell. Beim Aufprall trudeln flache Blätter bzw. Nadeln herab.
- **Beeren** hängen als kleine runde Trauben im Strauch.
- **Quellen:** `public/models/rocks/CREDITS.md` und `public/textures/trees/CREDITS.md`.

### Meilenstein 30 – Horrorfilm-Optik (Teil 2: Foto-Texturen)

- **Echte Foto-Texturen** von [Poly Haven](https://polyhaven.com) (CC0, Quellen in `public/textures/CREDITS.md`):
  - **Boden:** Waldboden mit Laub und Zweigen, Matsch, Felswände an steilen Hängen, Sand am Strand und unter Wasser.
  - **Bäume und Felsen:** Kiefernrinde an Stämmen, feine Blattstruktur in den Kronen, bemooster Fels.
  - **Stadt und Hafen:** rauer Putz an Wänden und Giebeln, Asphalt auf Straßen und Dächern, verwitterte Bretter.
  - **Selbstgebautes und Höhlen:** Rinde, Schnittholz, Stein; die Höhlenwände sind aus echtem Fels.
- Jede Oberfläche hat eine eigene Struktur (Normalen). Im Lichtkegel der Taschenlampe werfen Rinde, Steine und Laub
  feine Schatten.
- **Technik:** `world/SurfaceTextures.ts`
  - Alle Oberflächen liegen als Ebenen in zwei Textur-Arrays (Farbe 1024 px, Normalen 512 px). Projiziert wird über
    Weltkoordinaten: eben von oben fürs Gelände, dreiachsig für Hänge, Stämme und Wände. Gelände und Quader-Modelle
    brauchen dafür keine UV-Koordinaten.
  - Das Foto wird als Detail auf die bisherige Vertexfarbe gelegt (Textur ÷ Durchschnittsfarbe). Paletten,
    Jahreszeiten und Schnee bleiben dadurch erhalten.
  - Gegen sichtbare Kachelmuster wird eine zweite, gedrehte Abtastung eingemischt. In der Ferne blendet die Struktur
    aus.
  - Das Gelände speichert je Vertex die Anteile der Oberflächen (`splat`), die Stadtbauten eine Oberflächen-Kennung
    (`surf`).

### Meilenstein 29 – Horrorfilm-Optik (Teil 1: Licht & Bild)

- **Filmlook** in der Nachbearbeitung, je nach Lage überblendet (`systems/FilmLook.ts`, getestet):
  - kühl-entsättigter Tag, blaustichige Nacht, grünlich-fahle Höhle, blutrote Fiebernacht, Unterwasser;
  - Filmkorn, Vignette und leichte Farbsäume am Bildrand;
  - Angst verstärkt Korn, Vignette und Farbsäume und nimmt Farbe aus dem Bild;
  - Flammen und Lampen behalten ihre warme Farbe.
- **Bodennebel**, der dem Gelände folgt und in Senken hängt: dicht im Morgengrauen, nachts und im Regen, dünn am
  hellen Tag. Er wird aus der Tiefe berechnet (exponentieller Höhennebel), der Horizont verschwimmt im Dunst.
- **Umgebungsverdeckung** mit [n8ao](https://github.com/N8python/n8ao): Ecken, Spalten und Bodenkontakt werden dunkel.
  Auf „Niedrig“ ist sie aus.
- **Umgebungslicht** aus einem HDR-Waldpanorama (Poly Haven, CC0, über
  [@pmndrs/assets](https://github.com/pmndrs/assets)). Es ist am Tag dezent, nachts und in Höhlen aus.
- **Taschenlampe mit Schattenwurf:** Gras, Bäume und Gestalten werfen im Lichtkegel lange Schatten.
- Der Gegenstand in der Hand bekommt denselben Filmlook (aber keinen Nebel).

### Meilenstein 28 – Die Nordbucht: Überlebende & Aufträge

- Im Norden der Insel steht ein **Leuchtturm** an einer Bucht, mit Steg, Bootshaus („NORDBUCHT“) und einem
  zerschlagenen Boot. Am Fuß des Turms halten drei Menschen ein Feuer am Brennen. Tagsüber verrät sie der Rauch (70 m),
  nachts der Lichtkegel, der über die Insel streicht (220 m). Danach steht der Leuchtturm auf der Karte.
- Das Lagerfeuer wärmt, und die Schrate halten Abstand. Im Umkreis entsteht kein Schratlager, kein Zufallsereignis
  und keine Höhle.
- **Die Überlebenden:** Jonas Petersen (Tankwart), Dr. Imke Albers (die Inselärztin) und die kleine Mia. Sie wenden
  den Kopf zu dir, wenn du näher kommst, und gestikulieren beim Reden. Mit `E` beginnt ein **Gespräch**:
  - Die Zifferntasten `1`–`6` wählen eine Antwort.
  - Fragen sind möglich wie „Wer bist du?“ und „Was ist hier passiert?“. Jede Figur erzählt ihren Teil der Geschichte.
  - Aufträge kann man annehmen, nach dem Stand fragen und abgeben.
  - `E` oder ein paar Schritte weg beenden das Gespräch.
- **Sieben Aufträge** mit Belohnungen (Gegenstände und Erfahrung), die aufeinander aufbauen:
  - **Jonas:**
    - Vorräte bringen (4 Konserven, 2 Wasserflaschen).
    - Danach den Marktplatz ausdünnen (4 Schrate) und zwei Standfackeln bauen.
  - **Dr. Albers:**
    - 5 Leuchtpilze aus den Höhlen bringen.
    - Danach das Schichtbuch im Feuersteinstollen lesen. Ihre Belohnung ist eine Taschenlampe.
  - **Mia:**
    - Papas Taschenuhr holen: Sie liegt im Kleiderschrank des Hauses mit dem Brief an Tante Marta.
    - Danach „Papa“: der Koloss mit dem roten Halstuch auf dem Marktplatz.
- Laufende Aufträge stehen mit Fortschritt im Zielanzeiger und im Tagebuch, das ein neues Kapitel „Die Nordbucht“ hat.
  Aufträge und Bekanntschaften bleiben im Spielstand.
- **Technik:**
  - `world/Harbor.ts` sucht den Platz (eben, nahe am Ufer, mit tiefem Wasser für den Steg, möglichst weit im Norden)
    und baut alles mit dem Quader-Baukasten der Stadt.
  - `systems/Quests.ts` ist reine, getestete Auftragslogik: Zustände, Fortschritt über Spielereignisse, Abgabe.
  - `systems/Survivors.ts` enthält das Lager, die Figuren und den Gesprächsablauf.
  - `ui/DialogueUI.ts` zeigt das Gespräch an.

### Meilenstein 27 – Die Insel lebt (Zufallsereignisse)

- Alle 5–10 Minuten passiert irgendwo in 120–320 m Entfernung etwas (höchstens drei Ereignisse zugleich,
  nicht in Stadt, Lagern oder vor Höhlen):
  - **Versorgungsabwurf:** Ein Flugzeug brummt tief über die Insel (Meldung mit Himmelsrichtung) und wirft eine Kiste
    am Fallschirm ab. Roter Rauch steigt minutenlang auf, die Stelle ist auf der Karte markiert. Drin:
    Verbandszeug, Konserven, Wasser, Pfeile, Batterien, mit Glück Taschenlampe, Machete oder Winterjacke. Aber: Der
    Lärm lockt Schrate aus dem nächsten Lager an.
  - **Schrat-Ritual** (nachts): Trommeln dröhnen weithin (Meldung mit Richtung); an einem großen Feuer mit Totems
    versammeln sich vier Schrate, daneben liegt eine Opfergabe (Felle, Feuerstein, Fleisch, Arznei). Kämpfen oder
    heranschleichen. Im Morgengrauen erlischt das Feuer und die Schrate verschwinden.
  - **Verlassenes Lager:** Zelt, kalte Feuerstelle, eine zusammengesunkene Gestalt, ein Rucksack zum Durchsuchen und
    die letzte Aufzeichnung eines Überlebenden (vier verschiedene).
- Karte: Abwurf (rot), Ritual (orange), Lager (hell). Abwürfe und Lager bleiben im Spielstand. Tagebuch-Ziele für
  Kiste und Opfergabe, Erfahrung in Überleben.

### Meilenstein 26 – Die Fiebernacht

- **Jeden siebten Tag** (Tag 7, 14, 21 …) färbt sich ab 17 Uhr der Himmel rot und eine Warnung erscheint; von
  **21 bis 5 Uhr** ist Fiebernacht: blutroter Himmel und Nebel, roter Mond, die Uhrzeile zeigt „FIEBERNACHT“ (am
  Vortag „Fiebernacht morgen“).
- **Horden in Wellen:** Alle 90 s (später schneller, bis 45 s) erscheinen 40–65 m entfernt neue Schrate und Späher –
  ab der zweiten Fiebernacht auch Kolosse – mit einem Chor von Schreien. Sie sind **rasend** (scheuen kein Feuer),
  verlieren nie die Witterung und schlagen sich durch Wände, die ihnen den Weg versperren. Jede Woche werden die
  Wellen größer (3, 5, 7 … bis 9 Gegner, höchstens 14 zugleich). Wer in einer Höhle Zuflucht sucht, findet sie
  am Eingang lauernd.
- In der Fiebernacht kann niemand schlafen; die Furcht steigt zusätzlich. Gefallene Horden-Schrate lassen manchmal
  Pfeile, Konserven, Schmerzmittel, Batterien, Feuerstein oder Fleisch fallen.
- **Morgengrauen:** Die Überlebenden ziehen sich zurück; wer durchhält, bekommt Erfahrung (Überleben) und das
  Tagebuch-Ziel „Eine Fiebernacht überleben“. Debug: `F3` + `N` springt kurz vor die nächste Fiebernacht.
- `FeverNight.ts` ist der reine, getestete Zeitplan (Phasen, Nummer, Wellengröße und -abstand).

### Meilenstein 25 – Furcht & nächtlicher Horror

- **Furcht** (0–100 %): steigt in der Dunkelheit ohne Licht (nachts, in Höhlen), stärker bei nahen oder
  jagenden Gegnern und durch Schreckmomente und Treffer; am Feuer, im Licht und bei Tag legt sie sich. Folgen:
  Das Bild verliert Farbe, der Rand wird dunkel und pulsiert mit einem Herzschlag, der mit der Angst schneller und
  lauter wird; bei großer Angst erholt sich die Ausdauer langsamer.
- **Die Insel spielt Streiche** (nur im Dunkeln, häufiger je größer die Furcht, ab 60 % „Halluzinationen“ –
  doppelt so oft): hagere **Gestalten mit glimmenden Augen** stehen am Rand des Blickfelds und verschwinden mit
  einem Flüstern, sobald man hinsieht oder näher kommt; dreimaliges **Klopfen** aus dem Wald; ein **knackender
  Ast** im Rücken; **Schreie** in der Ferne; **Schritte, die folgen** – und verstummen, wenn man stehen bleibt;
  in Höhlen **Flüstern** dicht hinter einem.
- `Fear.ts` (rein, getestet) berechnet die Furcht aus Dunkelheit, Bedrohung und Schreck; `Horror.ts` führt Regie
  über die Ereignisse; neue Klänge: Herzschlag, Flüstern, Klopfen, knackender Ast. F3 zeigt Furcht und Gestalten.

### Meilenstein 24 – Fertigkeiten

- **Acht Fertigkeiten, die durch Tun wachsen** (Stufe 0–10, Taste `K`): Holzfällen (Bäume treffen und fällen →
  mehr Schaden an Bäumen), Steinmetz (Felsen und Feuerstein → mehr Ausbeute), Nahkampf (Treffer mit Waffen →
  mehr Schaden, weniger Ausdauer je Schlag), Bogenschießen (Treffer mit Pfeil und Speer → mehr Schaden, kürzere
  Spannzeit), Schleichen (geduckt nahe an ahnungslosen Gegnern, Schleichangriffe → leiser und schwerer zu
  sehen), Überleben (kochen, angeln, ausnehmen, plündern, schlafen → weniger Hunger und Durst), Handwerk
  (herstellen und bauen → haltbarere Werkzeuge) und Ausdauer (rennen, schwimmen → weniger Verbrauch, schnellere
  Erholung).
- Jede Stufe braucht etwas mehr Erfahrung (20 + 15 × Stufe); ein gefällter Baum bringt gut die Hälfte der ersten
  Holzfäll-Stufe. Stufenaufstiege werden mit ihrer neuen Wirkung gemeldet.
- `Skills.ts` ist reine, getestete Logik; die Erfahrung hängt an vorhandenen Spielereignissen (Treffer, gefällte
  Bäume, Kochen, Angeln, Herstellen …), Wirkungen greifen über Faktoren in Werkzeugschlag, Bogen, Geschossen,
  Spielerwerten und der Haltbarkeit neu hergestellter Werkzeuge. Erfahrung wird gespeichert.

### Meilenstein 23 – Was geschah

- **Elf Notizen** erzählen, was aus Altwasser wurde: Aushang und zwei Funkprotokolle im Gemeindehaus, ein
  Einkaufszettel an der Supermarktkasse, ein Zettel des Tankwarts, ein Brief, ein Kinderheft und eine ärztliche
  Notiz in drei Wohnhäusern, dazu je eine Seite neben der ersten Vorratskiste jeder Höhle – darunter das
  Schichtbuch des Feuersteinstollens. (Ohne zu viel zu verraten: Es begann im neuen Stollen, und wer das Fieber
  bekam, ging nachts in den Wald – oder in die Tiefe. Die letzte Fahrt legte am Steg in der Nordbucht ab.)
- `E` liest eine Notiz in einer eigenen Ansicht (Papier; Funkprotokolle in Schreibmaschinenschrift, das Kinderheft
  auf liniertem Papier). `E` legt sie wieder weg, ebenso ein paar Schritte. Beim ersten Lesen wandert sie ins
  **Tagebuch** (Abschnitt „Gefundene Notizen“) und bleibt im Spielstand.
- Neues Kapitel **„Was geschah“** (beide Funkprotokolle, die Notiz des Arztes, das Schichtbuch, alle elf Notizen);
  im Stadt-Kapitel zählt „Notizen der Bewohner lesen“.

### Meilenstein 22 – Die verlassene Stadt

- **Altwasser**, eine verlassene Kleinstadt im Inselinneren: Hauptstraße und zwei Querstraßen mit Mittellinien,
  Straßenlaternen, liegengebliebenen Autos, Mülltonnen und Briefkästen; rund 20 Gebäude:
  - **Wohnhäuser** mit Satteldach, Tür, Fenstern und zwei Räumen (Wohnküche, Schlafzimmer), Möbeln und zum Teil
    vernagelten Fenstern – man kann hineingehen;
  - ein **Supermarkt** („MARKT“) mit Regalreihen und Kasse, eine **Tankstelle** mit Dach über den Zapfsäulen,
    das **Gemeindehaus** mit weithin sichtbarem Funkmast und zwei **ausgebrannte Ruinen**.
- **Plündern:** 60 durchsuchbare Behälter (Kühlschrank, Küchen- und Kleiderschrank, Regal, Kasse, Werkzeugkiste,
  Schreibtisch, Kofferraum) mit je Behälter fest ausgewürfelten Fundstücken; die Werkzeugkisten von Tankstelle und
  Laden enthalten garantiert Machete bzw. Taschenlampe. Durchsuchtes bleibt im Spielstand leer.
- **Neue Gegenstände:** Konserve (macht ohne Feuer satt), Wasserflasche (leer an jedem Gewässer wieder füllbar –
  Füllen ist jetzt allgemein über `fillsTo` gelöst, wie bei der Holzschale), Schmerzmittel, **Machete** (schnelle,
  starke Nahkampfwaffe), **Taschenlampe** (hell und weit, brennt im Regen nicht ab, aber Kriecher scheuen ihr kaltes
  Licht nicht; Batterie hält ~5 Minuten), Batterie (Rechtsklick lädt die leerste Lampe), Winterjacke (wärmt wie
  der Fellmantel).
- **Gefahr:** Schrate haben sich auf dem Marktplatz eingerichtet – das größte Lager der Insel mit fünf Mitgliedern,
  darunter ein Koloss. Wände, Möbel und Autos sind Hindernisse ihrer Wegfindung, Türen bleiben Durchgänge.
- **Technik:** Der Stadtplan (`world/Town.ts`) ist rein und getestet: Bauplatzsuche (geringste Höhenspanne, weit vom
  Spawn), Gebäude ohne Überschneidungen und abseits der Fahrbahn. Die Höhenkarte wird *vor* dem Aufbau von Gelände
  und Physik eingeebnet (`HeightMap.flatten`), ein „Stadtfaktor“ macht den Boden staubig und hält Gras von Straßen
  und Häusern fern. `world/TownMeshes.ts` baut alles aus Quadern mit Vertexfarben und verschmilzt die ganze Stadt
  zu zwei Meshes (mit/ohne Schnee im Winter) plus drei Schildern – ~690 Kollisionsquader, Aufbau in ~0,1 s.
  Schritte klingen auf Dielen nach Holz und auf Asphalt nach Stein; die Karte zeigt Straßen und Häuser.
- Tagebuch-Kapitel **„Die verlassene Stadt“** (Stadt finden, 15 Behälter durchsuchen, Konserve, Machete, Taschenlampe).

### Meilenstein 21 – Höhlenbewohner

- **Kriecher**: bleiche, tief gebückte Höhlenbewohner mit glühenden Augen – in der Dunkelheit sieht man oft nur
  diese. Fast blind (kurze Sichtweite, mit Fackel etwas weiter, denn Licht verrät), aber mit feinem Gehör:
  Schritte tragen im Fels weit, Schleichen hilft. Sie schlagen zu und ziehen sich gleich wieder ins Dunkel zurück.
- **Fackel oder Waffe?** Den Schein einer Fackel in der Hand scheuen sie und lauern in etwa acht Metern Abstand –
  wer sie angreift, provoziert sie aber, und dann kommen sie trotzdem. Mit der Waffe in der Hand ist man im Dunkeln.
- Erster Raum hinter dem Eingang ist ruhig, jede weitere Kammer hat einen Bewohner, die hinterste zwei. Besiegte
  Kriecher sind nach zwei Tagen ersetzt (im Spielstand gemerkt). Beim Verlassen der Höhle verschwinden sie.
- **Technik:** Die vorhandene Gegner-KI läuft unverändert – sie fragt Wegfindung jetzt über eine Schnittstelle
  (`NavQuery`) ab. Unter Tage beantwortet die `CaveNav`: ein NavGrid über der **Bodenkarte der Höhle**, die direkt aus
  dem Voxelraster des Höhlengenerators entsteht (je Säule der höchste Luftraum mit genug Kopffreiheit), in
  Höhlenkoordinaten und nach außen in Weltkoordinaten übersetzt. Der Gegner-Direktor führt die Bewohner der
  aktuellen Höhle als eigene Population mit eigenem Wahrnehmungs-Kontext (die einzige „Flamme“ ist die Fackel des
  Spielers); Treffer, Kopftreffer, Schleichangriffe, Geräusche und Darstellung teilen sie mit den Schraten.
  Tests prüfen, dass vom Eingang aus Wege in jede Kammer gefunden werden.
- Tagebuch: „Kriecher besiegen“ im Kapitel „Unter der Erde“.

### Meilenstein 20 – Höhlen

- **Drei Höhlen** (Tropfsteinhöhle, Pilzgrotte, Feuersteinstollen) mit Eingängen an Berghängen: ein Felshügel mit
  dunkler Öffnung, die Bäume davor sind gerodet. Wer in die Nähe kommt, entdeckt den Eingang (Kartensymbol);
  `E` betritt die Höhle mit Ab- und Aufblende, innen führt `E` an der hellen Öffnung wieder hinaus.
- **Prozedurale Innenräume** (`world/CaveGenerator.ts`, rein und getestet): 4–6 Kammern (gestauchte Ellipsoide mit
  ebenem Boden) und geschwungene Gänge (Kapseln) als weich vereinigte Abstandsfunktion, mit 3D-Rauschen zu Fels
  verformt – an Wänden und Decke schroff, am Boden nur leicht uneben. Die Felshülle entsteht per **Surface Nets**
  (ein Punkt je Gitterzelle, ein Viereck je Kante mit Vorzeichenwechsel, 0,7-m-Raster): geschlossen, ohne
  Tabellen, ~15 000 Dreiecke in rund 0,1–0,2 s; daraus auch die Trimesh-Kollision. Gebaut wird erst beim ersten
  Betreten. Die Tests prüfen per Flutfüllung, dass jede Kammer und jede Ausstattung zu Fuß erreichbar ist.
- **Wo die Höhlen liegen:** Die Innenräume schweben unsichtbar hoch über der Insel (je Höhle eine eigene Etage):
  außerhalb des Physik-Höhenfelds, nie im Wasser. In der Höhle werden Gelände, Wasser, Vegetation und Gras nicht
  gezeichnet; Karte und Kompass zeigen den Eingang als Standort.
- **Dunkelheit:** Sonne und Mond aus, kaum Umgebungslicht, dichter schwarzer Nebel – ohne Fackel sieht man nur den
  Lichtschein des Eingangs (folgt dem Tageslicht draußen) und türkis **leuchtende Pilze**. Kein Regen, Kälte stark
  gedämpft, statt Wind und Vögeln ein tiefes Brummen und tropfendes Wasser; Schritte klingen nach Fels.
- **Schrate verlieren die Spur**, solange der Spieler in einer Höhle ist (keine Jagdtrupps, keine Geräusche).
- **Beute:** Feuersteinadern (mit der Axt abschlagen, je drei Stück) → **Feuersteinaxt** (2 Stöcke + 3 Feuerstein,
  fällt fast doppelt so schnell wie die Steinaxt). **Leuchtpilze** zum Essen. **Alte Vorratskisten** mit
  Verbandszeug (+45 Gesundheit) und zwei festen Fundstücken je Kiste. Dazu Tropfsteine und Knochen.
- Spielstand: entdeckte/besuchte Höhlen, geöffnete Kisten, gepflückte Pilze, abgebauter Feuerstein und ob man in
  einer Höhle gespeichert hat. In der Höhle lässt sich nichts bauen; wer dort stirbt, wacht draußen auf.
- Neues Tagebuch-Kapitel **„Unter der Erde“** (Höhle betreten, Feuerstein, Feuersteinaxt, Leuchtpilze, Kisten,
  alle drei Höhlen).
- **Fehlerkorrektur:** Spielstände mit Karten- oder Tagebuchdaten (seit Meilenstein 15) ließen sich nicht laden –
  Tagebuch und Erkundung wurden erst nach dem Laden erzeugt.

### Meilenstein 19 – Angeln, Fischreusen & Standfackeln

- **Angelrute** (2 Stöcke + 1 Fell): Linksklick wirft den Schwimmer dorthin, wo der Blick das Wasser trifft
  (3–16 m, mindestens 30 cm tief). Nach einer Weile – in tiefem Wasser und bei Regen schneller – zuckt er
  ein paar Mal (noch nicht anschlagen!) und taucht dann unter: Jetzt bleibt gut eine Sekunde zum Klicken.
  Zu früh geklickt holt man leer ein, zu spät ist der Fisch weg. Die Schnur hängt sichtbar zwischen
  Rutenspitze und Schwimmer durch; sie setzt dank Umrechnung zwischen den beiden Kamera-Sichtfeldern genau an der
  gezeichneten Spitze an. Jeder Wurf kostet die Rute etwas Haltbarkeit (40 Würfe).
- **Fisch:** roh nur im Notfall essbar, am Lagerfeuer gebraten eine gute Mahlzeit. Der Bratspieß nimmt jetzt
  Fleisch und Fisch gemischt (alte Spielstände bleiben gültig). Angeln ist die verlässliche Nahrung im Winter.
- **Fischreuse** (6 Stöcke) wird im flachen Wasser (25–130 cm) gebaut, der Korb ragt dabei etwas aus dem
  Wasser. Sie fängt alle ~100 s mit gut 50 % Chance einen Fisch (im Winter seltener, höchstens drei) und füllt
  sich über Nacht. Gefangene Fische liegen sichtbar im Korb; `E` nimmt sie heraus, beim Abriss treiben sie heraus.
- **Standfackel** (4 Stöcke + 2 Steine): leuchtet dauerhaft, bis man sie mit `E` löscht oder Regen sie ausmacht,
  und hält Schrate nachts auf Abstand wie ein Lagerfeuer – wärmt aber nicht. Intern beschreibt ein `flame`-Eintrag
  am Bauwerk Flammengröße, Licht und Wärme; Lagerfeuer und Standfackel teilen sich dieselbe Logik.
- Neues Tagebuch-Ziel im Kapitel „Jäger und Sammler“: einen Fisch fangen.

### Meilenstein 18 – Jahreszeiten

- **Sommer → Herbst → Winter → Frühling**, je vier Tage (Tag 1 = Sommer); am letzten Tag einer Jahreszeit wird
  weich in die nächste übergeblendet. Die Uhr zeigt die Jahreszeit an (`Tag 7 · Herbst · 14:20`). Reine Logik in
  `Seasons.ts` (getestet), die Darstellung über gemeinsame Shader-Uniforms (`world/SeasonShader.ts`).
- **Laub:** Laubbäume färben sich im Herbst – jeder Baum je nach Position rot, orange oder gelb – und stehen im
  Winter kahl und graubraun; im Frühling treibt frisches Grün. Nadelbäume bleiben grün. Erkannt werden Blätter am
  Grünüberschuss der Vertexfarbe, sodass Stämme unverändert bleiben; Laubbäume haben ein eigenes Material.
- **Schnee:** Im Winter liegt Schnee auf flachem Gelände, Felsen, Kronen und Büschen (nach Flächenneigung, erst
  oberhalb der Strandlinie), das Gras ist kurz und bereift, Niederschlag fällt als langsam taumelnde Flocken.
  Schnee durchnässt weniger als Regen und löscht Feuer langsamer.
- **Kälte:** Jahreszeiten haben eine Grundkälte (Herbst leicht, Winter stark) – nachts voll, tagsüber zu einem
  Drittel. Eine Winternacht ohne Feuer oder Fellmantel führt auch trocken zur Unterkühlung.
- **Beeren** sind im Winter erfroren (nicht pflückbar, wachsen erst im Frühling nach).

### Meilenstein 17 – Tagebuch & Ziele

- **Vier Kapitel mit 21 Zielen** (inzwischen fünf Kapitel) als roter Faden: *Gestrandet* (Stöcke, Steine, trinken, essen, Lagerfeuer) →
  *Ein Dach über dem Kopf* (Bäume fällen, Steinaxt, Unterstand, schlafen, Wände) → *Jäger und Sammler* (Speer, Tier
  erlegen, Fleisch braten, Bogen, Hirsche) → *Die Schrate* (Lager entdecken, Schrate besiegen, lautloser Kill,
  Fellmantel, Koloss, zehn Tage überleben).
- Der Fortschritt kommt allein aus Spielereignissen (`item:collected`, `structure:placed`, `enemy:hit` …, neu:
  `animal:killed`, `player:slept`, `camp:discovered`, `food:cooked`); Ziele späterer Kapitel zählen schon mit.
- **Zielanzeiger** im HUD (unter der Uhr): aktuelles Kapitel und die nächsten offenen Ziele mit Zählern.
  Erreichte Ziele und neue Kapitel werden gemeldet.
- **Tagebuch** (`J`): alle Kapitel mit Einleitung, Haken und Fortschritt; spätere Kapitel zeigen nur ihren Titel.
  Der Fortschritt wird gespeichert. Die Definitionen liegen in `systems/Journal.ts` (reine Logik, getestet).

### Meilenstein 16 – Felle, Ausrüstung & Schlingfallen

- **Felle:** Ausnehmen liefert zusätzlich Felle (Hirsch 2, Hase 1).
- **Großer Rucksack** (4 Felle + 2 Stöcke): per Rechtsklick „umpacken“ → 12 zusätzliche Rucksackplätze (einmalig;
  das Inventar wächst zur Laufzeit, das Fenster legt die neuen Plätze automatisch an).
- **Fellmantel** (5 Felle): per Rechtsklick anziehen. Nässe kühlt nur noch zu 40 % aus – nachts nass ohne Feuer
  droht keine Unterkühlung mehr, die Gesundheit regeneriert weiter. Rucksack und Mantel werden gespeichert.
- **Schlingfalle** (3 Stöcke): Hasen im Umkreis von 45 m schnuppern gelegentlich heran; wer in die Schlinge läuft,
  ist gefangen (der Ast schnellt hoch, Meldung in der Nähe). Den Hasen ausnehmen, die Falle mit `E` neu spannen.
  Fallen sind für Spieler und Schrate kein Hindernis (Sensor-Collider, kein Eintrag im Wegnetz).

### Meilenstein 15 – Karte & Kompass

- **Kompass** oben im HUD: Himmelsrichtungen und Gradstriche laufen mit der Blickrichtung mit (Norden = −Z), ein
  Dreieck zeigt zum Aufwachpunkt, sobald man einen Unterstand benutzt hat.
- **Inselkarte** (`M`): einmal beim Laden aus der Höhenkarte gezeichnet – Wasser nach Tiefe, Strand, Wiese, Fels,
  Schummerung von Nordwesten, jeder Baum als Punkt. Darüber liegt Pergament-Nebel über allem, was man noch nicht
  gesehen hat (128² Zellen, Aufdeckradius 70 m). Markiert sind Spieler mit Blickrichtung, eigene Bauwerke,
  Aufwachpunkt und entdeckte Schrat-Lager. Die Karte deckt das Spiel nicht ab – man kann mit offener Karte laufen.
- Der Nebel wird als winziges Bild (ein Pixel pro Zelle) einmal weichgezeichnet hochskaliert und nur bei neuen Zellen
  neu berechnet. Erkundung und entdeckte Lager werden gespeichert (≈ 2,7 KB Base64-Bitfeld).

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
│   ├── CaveGenerator.ts    Höhlen: Grundriss, Abstandsfunktion, Surface Nets, Eingangssuche (getestet)
│   ├── Town.ts             Stadtplan: Bauplatz, Straßen, Gebäude, Requisiten, Stadtfaktor (getestet)
│   ├── TownMeshes.ts       Gebäude, Möbel, Autos → verschmolzene Meshes, Kollider, Behälter, Türen
│   ├── Harbor.ts           Nordbucht: Platzsuche, Leuchtturm, Steg, Bootshaus, Lager der Überlebenden
│   ├── Environment.ts      Umgebungslicht aus einem HDR-Waldpanorama (CC0)
│   ├── SurfaceTextures.ts  Foto-Texturen (Textur-Arrays, ebene/dreiachsige Projektion, Shader-Einbau)
│   ├── RockModels.ts       Fotogescannte Felsen laden (Mesh + Kollisionshülle)
│   ├── trees/              Baumgenerator (nach EZ-Tree, MIT) und Modelle für Bäume und Sträucher
│   ├── Terrain.ts          Chunk-Meshes mit Vertex-Farben, 4 LOD-Stufen + Schürzen
│   ├── Water.ts            Wasserfläche mit Wellen-Normalen
│   ├── Vegetation.ts       Platzierung, Instancing, Collider, Entfernen (für Fällen)
│   ├── VegetationGeometry.ts  Low-Poly-Geometrien für Bäume/Büsche/Felsen
│   ├── SkyDome.ts          Himmels-Shader (Gradient, Sonne, Mond, Sterne)
│   ├── Grass.ts            GPU-Gras (Höhe/Dichte aus Texturen, Wind, Wegbiegen)
│   ├── Rain.ts             GPU-Regen bzw. -Schnee (mitwanderndes Schlieren-Volumen)
│   ├── SeasonShader.ts     Laubfärbung und Schnee für Vegetation, Felsen, Gelände
│   └── World.ts            Bündelt alles, sucht den Spawnpunkt
├── entities/
│   ├── Player.ts           First-Person-Controller
│   ├── PlayerStats.ts      Gesundheit, Ausdauer, Hunger, Durst
│   ├── ViewModel.ts        Gegenstand in der Hand + Animationen (eigene Szene/Kamera)
│   ├── FireEffect.ts       Flackernde Flamme (Lagerfeuer, Fackel)
│   ├── characters/         Animierte Figuren (Mesh2Motion, CC0): Bibliothek und Steuerung der Schrate
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
│   ├── PostFX.ts           Umgebungsverdeckung, Bodennebel, Lichtstrahlen, Bloom, Filmlook, Tone Mapping
│   ├── AnimalDirector.ts   Wild: Verteilung, Rudel-Warnung, Treffer, Ausnehmen, Nachwachsen
│   ├── Projectiles.ts      Wurfgeschosse (ballistisch, Segment-Raycast, Steckenbleiben)
│   ├── Cooking.ts          Bratspieß am Lagerfeuer (Fleisch, Fisch)
│   ├── Fishing.ts          Angeln (Wurf, Biss, Schnur) und Fischreusen (getestet)
│   ├── Caves.ts            Höhleneingänge, Innenräume, Ausstattung, Bewohner-Plätze, Zustand
│   ├── Settlement.ts       Stadt zur Laufzeit: Kollision, Beutetabellen, Durchsuchen, Entdeckung
│   ├── Notes.ts            Die Notizen der Geschichte und ihre Fundorte (getestet)
│   ├── Skills.ts           Fertigkeiten: Erfahrung, Stufen, Wirkungen (getestet)
│   ├── Fear.ts             Furcht aus Dunkelheit, Bedrohung und Schreck (getestet)
│   ├── Horror.ts           Nächtliche Schrecken: Gestalten, Klopfen, Schritte, Flüstern
│   ├── FeverNight.ts       Zeitplan der Fiebernacht (getestet)
│   ├── WorldEvents.ts      Zufallsereignisse: Versorgungsabwurf, Schrat-Ritual, verlassenes Lager
│   ├── FilmLook.ts         Farbstimmung und Bodennebel je nach Tageszeit, Ort und Angst (getestet)
│   ├── Quests.ts           Aufträge: Zustände, Fortschritt, Abgabe (getestet)
│   ├── Survivors.ts        Die Überlebenden: Figuren, Lagerfeuer, Leuchtfeuer, Gespräche
│   ├── Weather.ts          Wetterlagen als Zustandsautomat, Blitz & Donner (getestet)
│   ├── Climate.ts          Wetter ↔ Welt: Nässe, Dächer, Feuer im Regen, nasser Boden, Wind, Regenwasser
│   ├── SaveGame.ts         Spielstand-Format, Prüfung, localStorage-Slot (getestet)
│   ├── Settings.ts         Einstellungen, Grafikstufen, Speicherung (getestet)
│   ├── Exploration.ts      Erkundete Kartenzellen (getestet)
│   ├── Journal.ts          Tagebuch: Kapitel, Ziele, Fortschritt über Ereignisse (getestet)
│   ├── Seasons.ts          Jahreszeiten mit Überblendung (getestet)
│   ├── ai/
│   │   ├── NavGrid.ts      Navigationsraster + A* + Pfadglättung (getestet)
│   │   ├── CaveNav.ts      Wegfindung in Höhlen (NavGrid über der Bodenkarte, getestet)
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
│   ├── MapUI.ts            Inselkarte mit Schummerung, Nebel und Markierungen
│   ├── Compass.ts          Kompassband im HUD
│   ├── JournalUI.ts        Tagebuch-Fenster und Zielanzeiger (samt laufender Aufträge)
│   ├── DialogueUI.ts       Gesprächsfenster mit nummerierten Antworten
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
16. ~~Karte & Kompass~~ ✓
17. ~~Felle, großer Rucksack, Fellmantel, Schlingfallen~~ ✓
18. ~~Tagebuch & Ziele~~ ✓
19. ~~Jahreszeiten~~ ✓
20. ~~Angeln, Fischreusen & Standfackeln~~ ✓
21. ~~Höhlen (Dunkelheit, Feuerstein, Vorratskisten)~~ ✓
22. ~~Höhlenbewohner~~ ✓
23. ~~Die verlassene Stadt~~ ✓
24. ~~Was geschah: Notizen, Briefe und Funkprotokolle~~ ✓
25. ~~Fertigkeiten~~ ✓
26. ~~Furcht & nächtlicher Horror~~ ✓
27. ~~Die Fiebernacht (Horden alle sieben Tage)~~ ✓
28. ~~Zufallsereignisse~~ ✓
29. ~~Die Nordbucht: Überlebende & Aufträge~~ ✓
30. ~~Horrorfilm-Optik, Teil 1: Licht & Bild~~ ✓ · ~~Teil 2: Foto-Texturen~~ ✓ · ~~Teil 3: Bäume, Büsche, Felsen~~ ✓ · ~~Teil 4: Figuren~~ ✓ · ~~Teil 5: Hände und Werkzeuge~~ ✓ · ~~Teil 6: Gras~~ ✓ · ~~Teil 7: Tiere~~ ✓
31. Das Fieber: Infektion, Heilmittel, Forschungsstation
32. Wölfe & Winter: Rudel, Spuren im Schnee
33. Verteidigung: Barrikaden, Stachelwände, Fallen, Brandflaschen
34. Neue Schrecken: neue Gegner, ein Boss in der Mine
35. Koop-Mehrspieler (Server, bis zu 50 Spieler)
