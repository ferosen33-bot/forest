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
| `V`                 | Bogen: Munition wechseln (Pfeile ↔ Brandpfeile) |
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
> (alle gemeinsam gegen die Insel). Jetzt geht es um den Inhalt: Überlebende und Aufträge, Wölfe und Winter,
> Verteidigung in der Fiebernacht, neue Schrecken. Der Mehrspieler-Teil folgt danach.

### Meilenstein 50 – Neue Waffen (Teil B: Nahkampf, Eigenbauten & Rohrbombe)

- **Fünf neue Nahkampfwaffen**, alle mit Seltenheit, Perks und offen für Mods:

  | Waffe | Merkmale | Fundorte |
  |---|---|---|
  | Katana | schnell, rasiermesserscharf, trennt mühelos ab | Sammlervitrinen, Sakristei, Verstecke |
  | Hackbeil | kurz, geht durch Knochen | Kühlschränke |
  | Golfschläger | lang und federnd | Kleiderschränke, Autos |
  | Schlagstock | leicht, schnell, fast unverwüstlich | Autos, Spinde |
  | Mistgabel | sticht auf 3 m Abstand | Regale |

- **Eigenbauten an der Werkbank** (neuer Abschnitt „Waffenbau“), mit eingebautem Element (ein Mod ersetzt es):
  - *Nagelkeule* (1 Stamm, 8 Nägel): jeder Treffer kann blutende Wunden reißen.
  - *Elektrokeule* (Brecheisen, 2 Batterien, Fell): funkt bei Treffern, mit Lichtbögen und Kurzschluss bei
    Nässe.
  - Beide leuchten in der Hand in ihrer Elementfarbe.
- **Rohrbombe** (Werkbank: Lampenöl, 4 Nägel, Batterie), Linksklick wirft:
  - Sie bleibt liegen, piept immer schneller und lockt Schrate in der Nähe an. Nach zwei Sekunden geht
    sie hoch.
  - Die Druckwelle reicht 5,5 m und ist zur Mitte hin stärker. Sie wirft Überlebende um, reißt Glieder ab,
    verletzt Tiere und beschädigt Bauwerke. Wer selbst zu nah steht, wird verletzt (Todesursache „Explosion“).
  - Dazu kommen Feuerball, Funken, aufspritzende Erde, Rauch und ein Lichtblitz. Der Knall ist weit zu
    hören, und das Öl brennt danach noch.
- **Nägel:** neuer Rohstoff aus Werkzeugkisten und Regalen.
- Erlegte Schrate lassen jetzt auch Hackbeil, Golfschläger, Schlagstock oder Mistgabel fallen.
- `systems/Explosives.ts` enthält Zünder, Druckwelle und Feuerball.

### Meilenstein 50 – Neue Waffen (Teil A: Schusswaffen)

- **Vier Schusswaffen**, alle mit Seltenheit und Perks (Wucht, Flink → Feuerrate, Ausgewogen → weniger
  Rückstoß, Niederschmetternd → mehr Wucht, Präzise, Robust, Blutdurst) und offen für Waffenmods:

  | Waffe | Merkmale |
  |---|---|
  | Pistole | 12 Schuss, schnell und genau |
  | Revolver | 6 Schuss, schwer, langsam nachzuladen |
  | Schrotflinte | 6 Patronen, je 9 Schrotkörner; aus der Nähe wirft sie Gegner um und reißt Glieder ab, auf Entfernung verpufft das Schrot; man lädt Patrone für Patrone nach (ein Schuss bricht das ab) |
  | Jagdgewehr | 5 Schuss, sehr wuchtig und weit, mit Zielfernrohr |

- **Steuerung:** Linksklick schießt, Rechtsklick zielt über Kimme und Korn (Waffe vor dem Auge, Zoom,
  viel geringere Streuung), `R` lädt nach. Ein leeres Magazin lädt beim nächsten Schuss von selbst nach.
  Ohne Munition klickt es nur. Wer läuft, streut stärker, wer sich duckt, schießt ruhiger.
- **Munition:** Pistolenmunition (Pistole und Revolver), Schrotpatronen, Gewehrpatronen. Patronen im Magazin
  bleiben an der Waffe, auch beim Ablegen und im Spielstand.
- **Wirkung:**
  - Kopftreffer zählen mehr, Großkaliber zertrümmert beim tödlichen Kopftreffer den Schädel.
  - Kugeln schleudern Getroffene zurück. Elemente greifen wie im Nahkampf.
  - Einschläge in Holz, Stein und Erde werfen Splitter und Staub auf, ins Wasser spritzt es.
- **Gefühl:**
  - Rückstoß reißt die Kamera hoch, die Waffe springt zurück. Ein Mündungsfeuer blitzt an der Mündung und
    erhellt Hand und Umgebung.
  - Jede Waffe hat ihren eigenen Knall, das Gewehr hallt von den Hängen wider. Dazu kommen Klänge für
    Nachladen, Durchladen und Leerklicken.
  - Zielt man mit dem Jagdgewehr ganz an, sieht man durchs Zielfernrohr (schwarzer Rand, feines Fadenkreuz,
    starker Zoom).
- **Lärm:** Jeder Schuss ist weit zu hören (70–120 m) und lockt die Schrate an. Schusswaffen sind stark,
  aber laut.
- **Munitionsanzeige** rechts unten: Magazin groß, Vorrat klein, leer in Rot.
- **Fundorte:**
  - In der Moorhütte liegt sicher das Jagdgewehr, im Labor-Safe ein Revolver, im Schmugglerversteck eine
    Schrotflinte.
  - Pistolen findet man in Autos und Schreibtischen, Schrotflinten in Spinden.
  - Munition liegt in Kisten, Spinden und Schreibtischen. Erlegte Schrate haben manchmal Patronen oder eine
    Pistole dabei.
- Schusswaffen lassen sich an der Werkbank ausbessern.

### Meilenstein 49 – Nahkampf-Ausbau (Teil 4: Zerstückelung)

- **Klingen trennen ab:** Macheten, Säbel, Messer, Äxte und die Feuerwehraxt schneiden Arme, Beine und Köpfe ab.
  - Wo geschnitten wird, hängt vom Trefferpunkt ab (Ellbogen oder Schulter, Knie oder Hüfte).
  - Ein Kopf geht nur beim tödlichen Treffer ab. Ein tödlicher Hieb in den Rumpf kostet Kopf oder Arm.
  - Lebende verlieren Gliedmaßen bei wuchtigen Hieben (ab etwa einem Drittel ihrer Lebenspunkte oder mit
    voll aufgeladenem schweren Schlag). Stöße (Speer) trennen nichts ab.
- **Wuchtwaffen zertrümmern Schädel:** Ein tödlicher Kopftreffer mit Schläger, Rohrzange, Brecheisen oder
  Vorschlaghammer lässt den Kopf zerplatzen, ebenso jeder tödliche Bodenstampfer. Es spritzen Blut, Fleisch
  und Knochensplitter.
- **Abgetrennte Stücke** fliegen vom Angreifer weg, überschlagen sich, tropfen und bleiben im Gras liegen
  (mit Physik, gut 50 Sekunden lang). Es sind echte Teile der Figur in ihrer letzten Haltung, mit blutigem
  Ende. Strahlen, Spieler und Gegner gehen durch sie hindurch.
- **Stümpfe:** Am Körper fällt das Glied im Gelenk zusammen. Dort sitzt ein blutiger Stumpf mit Knochen, aus
  dem drei Sekunden lang im Herzschlag Blut spritzt, immer schwächer.
- **Folgen:** Ohne Bein kriecht der Gegner weiter (eigene Kriech-Animation, niedrige Trefferfläche, gut ein
  Drittel so schnell). Mit einem Arm weniger schlägt er schwächer, ohne Arme beißt er nur noch.
- **Wunden:** Jeder Nahkampftreffer hinterlässt eine Wunde am getroffenen Körperteil, bis zu zehn je Gegner.
  Klingen reißen lange, nasse Schnitte, Wucht hinterlässt dunkle Quetschungen.
- Eigene Klänge fürs Abtrennen und Zertrümmern. In den Einstellungen abschaltbar („Zerstückelung“).
- `entities/enemies/Gore.ts` enthält die Regeln, `systems/Gore.ts` die fliegenden Stücke und Blutfontänen,
  `EnemyAvatars` die Schnitte am Skelett.

### Meilenstein 49 – Nahkampf-Ausbau (Teil 3: Kampfmanöver)

- **Schwerer Schlag:** Linksklick mit einer Waffe gedrückt halten, um auszuholen (die Waffe geht über die
  Schulter und zittert, wenn sie voll aufgeladen ist), dann loslassen.
  - Ein kurzer Klick bleibt ein normaler Schlag.
  - Der schwere Schlag macht bis zu doppelten Schaden, trifft öfter kritisch und kostet mehr Ausdauer.
  - Er schleudert Gegner zurück. Voll aufgeladene schwere Waffen (Vorschlaghammer, Feuerwehraxt) werfen sie um.
  - Schaut man auf Baum, Fels oder Bauwerk, schlägt man wie bisher im Takt weiter.
- **Ausweichen** (`Q`): ein schneller Schritt in Laufrichtung (ohne Richtungstaste nach hinten), mit
  Kamerakippen. In den ersten Augenblicken ist man unverwundbar. Wer einem Schlag so im letzten Moment
  ausweicht, bekommt eine kurze Zeitlupe und ein Konterfenster.
- **Perfekte Parade:** Hebt man die Deckung (Rechtsklick) knapp vor dem Treffer, prallt der Schlag ganz ab
  (PARIERT!). Der Angreifer taumelt zurück, und der nächste Schlag ist ein **Konter**: immer kritisch und noch
  einmal +50 % Schaden.
- **Treten** (`F`): stößt Gegner zurück und bringt sie aus dem Tritt, schafft also Luft. Kolosse wanken nur.
- **Sprungtritt:** aus dem Sprint springen und in der Luft treten. Man fliegt mit Schwung hinein und wirft bis
  zu zwei Gegner um.
- **Bodenstampfer:** `F` bei einem umgeworfenen Gegner bringt einen verheerenden Tritt (70 Schaden).
- **Umgeworfen:** Gegner fallen hin (die Figuren spielen einen Sturz), bleiben gut zwei Sekunden liegen und
  rappeln sich mit einer eigenen Aufsteh-Animation wieder hoch. Treffer verlängern das Liegen nicht, Endgegner
  fallen nicht um.
- **Schadenszahlen** steigen über dem Getroffenen auf:
  - normal weiß, schwere Treffer orange, kritische gelb mit „!“, Konter groß, Schleichangriffe violett
  - Elementschaden klein in der Farbe des Elements
  - in den Einstellungen abschaltbar
- **Trefferstopp:** Bei wuchtigen Treffern steht die Welt für Sekundenbruchteile still (schwere Schläge,
  Kills, Tritte). Dazu kommen Kamerawackeln und Schriftzüge (PARIERT!, AUSGEWICHEN!, KONTER!,
  SPRUNGTRITT!, BODENSTAMPFER!).
- Beim Treten erscheint das eigene Bein mit Stiefel im Bild.
- Schläge kommen zur Hälfte aus dem Handgelenk, deshalb schwingt der Arm nicht mehr samt Schulter ins Bild.
- Eigene Klänge für Tritt, Bodenstampfer, Parade, Ausweichen und schweren Schlag.
- `systems/CombatMoves.ts` enthält Tritte, Konter, Trefferstopp und Zeitlupe, `ui/DamageNumbers.ts` die
  Schadenszahlen.

### Meilenstein 49 – Nahkampf-Ausbau (Teil 2: Mods & Elemente)

- **Vier Waffenmods**, an der Werkbank hergestellt (eigener Abschnitt „Waffenmods“) oder gefunden:
  - *Brandsatz* (Lampenöl, Feuerstein, Stock): **Feuer** setzt in Brand (9 Schaden/s für 5 s). Wer Feuer fängt,
    schlägt kurz um sich. Brennende stecken Nachbarn an, im Wasser erlischt das Feuer, Regen löscht es schneller.
  - *Elektrosatz* (2 Batterien, Fell): **Schock** macht Sofortschaden, lähmt 1,2 s und springt auf zwei Gegner
    in der Nähe über (mit sichtbaren Lichtbögen).
  - *Säuresatz* (4 Leuchtpilze, Flasche): **Ätzend** zersetzt sechs Sekunden lang. Verätzte nehmen ein
    Drittel mehr Schaden aus jeder Quelle.
  - *Widerhaken* (2 Knochen, 2 Feuerstein): **Blutung** reißt bis zu drei Wunden. Sie bluten und verlangsamen.
- **Anbringen:** an der Werkbank per Rechtsklick auf den Mod (die Waffe in der Hand bekommt ihn) oder indem man
  den Mod im Inventar auf die Waffe zieht. Das geht erst ab Seltenheit „Ungewöhnlich“. Ein neuer Mod ersetzt
  den alten.
- **Auslösen:** Jeder Treffer hat eine Chance (38 %, schwere Waffen 60 %, Blutung mit Klingen 55 %). Kritische
  Treffer lösen immer aus, und nach etwas Pech greift das Element spätestens beim dritten Treffer.
- **Kombinationen:**
  - *Wasser + Schock* → **Kurzschluss:** Nasse Gegner (im Regen oder im Wasser) nehmen doppelten Schaden, der
    Schlag springt auf bis zu vier Gegner in 8 m über.
  - *Säure + Feuer* → **Verpuffung:** Feuer an einem verätzten Gegner lässt eine Stichflamme aufschießen, die
    alles ringsum verletzt und anzündet. Wer zu nah steht, verbrennt sich.
  - *Brennendes Öl:* Wer durch die Flammen einer Brandflasche läuft, fängt selbst Feuer und brennt weiter.
- **Schwächen und Widerstände:**
  - Hansen und Kriecher brennen besonders gut. Hansen widersteht Säure und Blutung, Kriecher der Säure.
  - Kolosse und Schreierinnen sind anfällig für Schock, Kolosse kaum für Blutung.
  - Späher und Hetzer bluten schnell, Hetzer brennen auch gut.
- **Sichtbar:**
  - Die Waffe in der Hand leuchtet in der Elementfarbe (zur Klinge hin stärker): Feuer flackert, Schock
    entlädt sich in Blitzen, Säure pulsiert zäh, Blut glimmt im Herzschlag. Glut steigt auf, Funken springen,
    Säure und Blut tropfen ab. Ein farbiges Licht fällt auf Hand und Waffe.
  - Am Gegner sieht man Flammen am Körper (mit Licht), kriechende Lichtbögen, grünen Säuredampf und
    Blutstropfen.
  - Unter dem Fadenkreuz erscheint ein Schriftzug: BRAND, SCHOCK, ÄTZEND, BLUTUNG oder KURZSCHLUSS! bzw.
    VERPUFFUNG!, dazu ANFÄLLIG oder WIDERSTEHT.
  - Slots zeigen einen leuchtenden Punkt in der Elementfarbe, das Inventar nennt Mod und Wirkung.
- Eigene Klänge für Stromschlag, Säure und Verpuffung.
- `entities/items/Elements.ts` enthält Werte und Zustandslogik, `systems/ElementEffects.ts` Auslösen, Wirkung
  und Effekte, `entities/WeaponAura.ts` das Leuchten in der Hand.

### Meilenstein 49 – Nahkampf-Ausbau (Teil 1: Seltenheit & neue Waffen)

- **Jede Waffe ist ein Einzelstück:** Nahkampfwaffen haben eine Seltenheit, und zwar *Gewöhnlich* (grau),
  *Ungewöhnlich* (grün), *Selten* (blau), *Überragend* (violett) oder *Legendär* (orange). Höhere Stufen bringen
  bis +60 % Schaden, bis +80 % Haltbarkeit und Platz für bis zu drei Perks. Legendäre Waffen tragen einen
  Beinamen („Witwenmacher“, „Totenglocke“ …).
- **Perks:** Wucht (+15 % Schaden), Ausgewogen (−25 % Ausdauer), Flink (+15 % Tempo), Robust (+40 %
  Haltbarkeit), Präzise (+12 % Krit), Niederschmetternd (Getroffene taumeln länger), Blutdurst (jeder Treffer
  heilt 3).
- **Kritische Treffer:** Grundchance 8 % (legendär +5 %) für 1,8-fachen Schaden, mit eigener Trefferanzeige.
- **Sieben neue Waffen:** Baseballschläger, Rohrzange, Brecheisen, Vorschlaghammer, Küchenmesser, Feuerwehraxt
  und Säbel. Jede hat eigene Werte (Reichweite, Tempo, Betäubung) und eine Klasse: Klinge, Stumpf oder Schwer.
  Alle sind an der Werkbank reparierbar.
- **Beute:** Die Waffen liegen in Häusern, Werkzeugkisten, Spinden, Autos, Verstecken und bei Ereignissen. Gegner
  lassen gelegentlich eine Waffe fallen (10 %), Bosse immer eine überragende oder legendäre. Auf den
  Nachbarinseln ist die Beute seltener. An der Werkbank hergestellte Waffen werden manchmal besser (40 %
  ungewöhnlich, 8 % selten).
- **Anzeige:** Slots haben einen Rahmen in der Farbe der Seltenheit. Der Name in der Schnellleiste ist eingefärbt
  und nennt die Perks. Im Inventar stehen Schaden, Schläge/s, Krit, Ausdauer, Haltbarkeit und Perks.
- Seltenheit und Perks bleiben beim Ablegen, Werfen, Einlagern und im Spielstand erhalten. Alte Spielstände
  würfeln für vorhandene Waffen einmal nach.
- `entities/items/Weapons.ts` enthält Seltenheiten, Perks, Werte und das Würfeln.

### Meilenstein 48 – Grafik wie aus einem Guss (Teil 3: Kino-Look)

- **Bloom wie in Unreal:** Statt eines kleinen Weichzeichners eine Mip-Kette über sechs Stufen bis 1/64
  Auflösung (13-Tap-Verkleinerung, Zelt-Vergrößerung). Feuer, Lampen und Gegenlicht leuchten weit und weich
  nach, ohne Blockmuster; einzelne extrem helle Pixel werden gedämpft.
- **Augenanpassung, relativ zur Bildstimmung:** Das Spiel misst die mittlere Helligkeit, zur Bildmitte hin
  stärker gewichtet. Die Belichtung ist √(jetzt ÷ woran das Auge gewöhnt ist). Im Gleichgewicht bleibt sie 1,
  Tag und Nacht sehen also aus wie gestaltet. Wer aus einer dunklen Höhle tritt, ist kurz geblendet (gut eine
  Sekunde). Wer hineingeht, sieht erst einmal fast nichts. Nach einem Blitz ist die Nacht kurz noch schwärzer.
- **Linsenreflexe:** Helle Lichter, vor allem die Sonne, werfen gefärbte „Geister“ zur Bildmitte und einen
  schwachen Ring.
- **Tiefenunschärfe beim Zielen** mit dem Bogen: Scharf ist, was im Fadenkreuz liegt. Davor und dahinter wird es
  weich (16 Abtastungen auf einer Spirale). Scharfes blutet nicht in Unscharfes.
- **Bewegungsunschärfe** der Kamera beim schnellen Umsehen, aus Tiefe und Kameramatrix des letzten Bildes und
  auf 60 Bilder/s normiert. Nach Teleports wird nichts verschmiert. Der Gegenstand in der Hand bleibt scharf (das
  Ergebnisbild hat dafür eine eigene Tiefe). In den Einstellungen abschaltbar.
- **Tone Mapping „Khronos PBR Neutral“** statt ACES (direkt verglichen mit ACES und AgX): natürlichere Grün- und
  Himmelstöne, kräftigere Abendfarben.
- Schutz vor ungültigen Pixeln (NaN/Inf): Sie würden sonst über Bloom und Belichtung das ganze Bild schwärzen.
- `systems/CinemaFX.ts` enthält alle Kino-Effekte; `PostFX` ruft sie zwischen Nebel und Endmischung auf.

### Meilenstein 48 – Grafik wie aus einem Guss (Teil 2: Materialien & Himmel)

- **Volumetrische Wolken:** Statt einer flachen Wolkenschicht läuft der Himmels-Shader per Raymarching durch eine
  echte Wolkenschicht (1,5–3,2 km Höhe). Grundlage ist eine kachelbare 3D-Rauschtextur (Perlin-Worley, beim Start
  berechnet). Sonnen- und Mondlicht wird nach Beer-Lambert durch die Wolken gedämpft. Dazu kommen
  Henyey-Greenstein-Streuung (Silberrand an der Sonne) und Pulver-Effekt, die Unterseiten sind dunkel und die
  Kuppen hell. Die Wolken liegen fest in der Welt und ziehen mit dem Wind; der Bedeckungsgrad folgt dem Wetter.
- **Wolkenschatten:** Dieselben Wolken dunkeln das Sonnenlicht am Boden ab. Ihre Schatten ziehen über Wald und
  Hänge (eingebaut in die Kaskaden-Beleuchtung, gilt für alle beleuchteten Materialien).
- **PBR aus Fotos:** Alle Foto-Oberflächen bekommen Rauheit, Umgebungsverdeckung (AO) und Höhe aus Poly-Haven-
  Karten (`*_m.jpg`). Ritzen bekommen weniger Himmelslicht, Putz und Rinde glänzen anders als Sand und Laub.
- **Mischen nach Höhe im Gelände:** Steine ragen aus Sand und Laub heraus, statt mit ihnen zu verschwimmen.
- **Nässe:** Bei und nach Regen werden Boden, Fels, Rinde und Häuser dunkler und glänzend. Auf ebenem Boden stehen
  in Senken Pfützen, die den Himmel spiegeln. Nach dem Regen trocknet alles langsam ab.
- Der Himmel wird jetzt nach der undurchsichtigen Geometrie gezeichnet. Für verdeckte Himmelspixel rechnet der
  Wolken-Shader dann gar nicht erst.

### Meilenstein 48 – Grafik wie aus einem Guss (Teil 1: Schatten & Kantenglättung)

- **Kaskadierte Sonnenschatten:** Statt einer Schattenkarte mit 60 m Reichweite gibt es jetzt drei: scharf bis
  30 m, mittel bis 110 m, grob bis 350 m. Die Übergänge sind weich überblendet. Waldränder, Hänge und Bäume in der
  Ferne werfen jetzt Schatten, und am Rand der alten Schattenkarte schaltet nichts mehr sichtbar um. Die
  Schattenkanten flimmern nicht, weil die Kaskaden auf ihr Texelraster einrasten. Die Lichtstrahlen nutzen die
  mittlere Kaskade.
- `world/CascadedShadows.ts` nutzt die Kaskaden-Lichter von three.js (`CSM`). Die Shader-Bausteine stammen aus
  dem aktuellen three.js; nur der Block der gerichteten Lichter wird ersetzt, damit Metall und Iridiszenz
  unverändert bleiben. Jedes beleuchtete Material bekommt die Erweiterung beim ersten Zeichnen automatisch,
  eigene `onBeforeCompile`-Erweiterungen bleiben erhalten.
- **Alpha-to-Coverage** für Blätter, Schilf und Gras: Die Ränder werden über die 4-fach-Mehrfachabtastung
  geglättet, statt hart ausgeschnitten. Laub und Gras flimmern in Bewegung deutlich weniger.

### Meilenstein 47 – Mehr Möglichkeiten (Teil 4: Spielstile & Talente)

- **Talente:** Jede der acht Fertigkeiten hat zwei Talentstufen (ab Stufe 3 und ab Stufe 7). Auf jeder Stufe wählt
  man eines von zwei Talenten – für immer. So entstehen eigene Spielstile, zum Beispiel:
  - *Holzfällen:* Kraftschlag oder Unermüdlich, dann Holzfäller (+1 Stamm) oder Leise Axt.
  - *Steinmetz:* Steinbrecher oder Kieselsammler, dann Feuersteinkenner oder Feuerhüter (Feuer trotzen dem Regen).
  - *Nahkampf:* Wucht oder Parade, dann Taumelschlag (jeder Treffer betäubt) oder Blutrausch (Kills heilen).
  - *Bogenschießen:* Ruhige Hand oder Sorgsamer Schütze (Pfeile brechen nie), dann Kopfjäger oder Zündler.
  - *Schleichen:* Schattengänger oder Lockruf (Steine locken doppelt so weit), dann Meuchler oder Lautlos.
  - *Überleben:* Genügsam oder Abgehärtet, dann Jäger (mehr Fleisch und Felle) oder Feldkoch.
  - *Handwerk:* Sorgfalt oder Fallensteller (+50 % Fallenschaden), dann Baumeister oder Selbstspanner
    (Fallen spannen sich neu).
  - *Ausdauer:* Läufer oder Schwimmer, dann Zäh (−20 % Schaden) oder Kletterer.
- Das Fertigkeiten-Fenster (`K`) hat jetzt einen Mauszeiger. Es zeigt alle Talente, markiert wählbare und
  meldet, wie viele auf eine Wahl warten. Beim Stufenaufstieg kommt ein Hinweis.
- **Steine werfen:** Ein Stein im Schnellzugriff fliegt per Linksklick. Sein Aufprall lockt Schrate im Umkreis
  von 18 m an die Stelle – so lockt man Wachen von einem Lager weg.
- **Schlammtarnung:** Im Moor auf den Schlamm zu den Füßen blicken und `E` drücken. Vier Minuten lang bist du
  viel schwerer zu sehen (Anzeige 🌿 unten links). Regen wäscht den Schlamm schneller ab, Schwimmen sofort.

### Meilenstein 47 – Mehr Möglichkeiten (Teil 3: Floß & Nachbarinseln)

- **Zwei Nachbarinseln** liegen in den Weltecken vor der Küste: flache Hügel mit Strand, jeweils gut 150 m
  im Durchmesser. Ein mindestens 170 m breiter, tiefer Kanal trennt sie von der Hauptinsel; sie erscheinen
  auf der Karte. Die Orte der Geschichte bleiben auf der Hauptinsel.
- **Offenes Meer:** Ab 12 m Wassertiefe zehren Strömung und Kälte zusätzlich an der Ausdauer; ist sie
  aufgebraucht, verliert man Gesundheit. Ein Hinweis warnt beim ersten Mal. Hinüberschwimmen ist kaum zu schaffen.
- **Floß** (6 Holzstämme, 2 Stöcke, 2 Felle): wird im Wasser gebaut. `E` besteigt es, `W`/`S` paddeln,
  `A`/`D` lenken, `Shift` paddelt kräftiger (kostet Ausdauer). Paddelschläge plätschern und spritzen, das Floß
  schaukelt auf den Wellen und läuft im flachen Wasser auf Grund. `E` steigt ab – aufs nächste Ufer, ins
  flache Wasser oder notfalls ins Meer. Position und Richtung bleiben im Spielstand erhalten.
- **Kletterseil** (3 Felle, 2 Stöcke): ein Pflock mit Lederseil, nur an einer Steilkante baubar – der Bauplan
  dreht sich von selbst zur Kante. Das Seil hängt der Wand entlang bis zum Grund (3,5 bis 45 m). Oben seilt `E`
  dich ab, unten am Seilende klettert `E` wieder hinauf (das kostet Ausdauer). So werden Klippen und Gebirgsstufen
  zu Abkürzungen.
- **Leuchtturm Kaltenhuk** (erste Nachbarinsel): ein weiß-rot gestreifter Turm mit Umgang, Laternenraum und
  **drehendem Leuchtfeuer** – zwei weiche, warme Lichtkegel, die nachts über das Meer streichen und schon von der
  Hauptinsel zu sehen sind. Daneben das Wärterhaus (Pult, Spind, Bett, Logbuch) und ein Ölschuppen mit Lampenöl.
- **Schmugglerbucht** (zweite Nachbarinsel): Kisten unter einer Plane, ein Ruderboot kieloben am Strand. Die
  Schmugglerkiste lohnt die Überfahrt (Brandflaschen, Brandpfeile, Verbandszeug).
- Zwei neue Notizen (24 insgesamt) und ein neues Tagebuch-Kapitel **„Jenseits der Küste“**: Werkbank und Floß
  bauen, Leuchtturm und Schmugglerbucht finden, das Logbuch lesen, ein Kletterseil anbringen.

### Meilenstein 47 – Mehr Möglichkeiten (Teil 2: Lager ausbauen)

- **Werkbank** (3 Holzstämme, 2 Stöcke, 2 Steine): schaltet die neuen Lager-Baupläne frei (sie brauchen eine
  Werkbank im Umkreis von 6 m, im Bauen-Menü als Chip „Werkbank“ markiert). Hier hergestellte Werkzeuge halten ein
  Viertel länger, und `E` bessert das Werkzeug in der Hand für 1 Stock und 1 Stein ganz aus.
- **Trockengestell** (7 Stöcke, 1 Fell): Rohes Fleisch oder Fisch hängt man mit `E` auf, bis zu vier Stück. In drei
  Minuten werden daraus dunkle, geschrumpfte Streifen **Trockenfleisch** – leicht, stapelbar, ohne Feuer essbar.
  Bei Regen trocknet nur, was unter einem Dach hängt.
- **Regentonne** (3 Holzstämme, 1 Fell): sammelt bei Regen bis zu sechs Portionen Trinkwasser. Der Wasserspiegel
  steigt sichtbar; `E` trinkt daraus oder füllt Schale und Flasche.
- **Gartenbeet** (2 Holzstämme, 2 Stöcke): Mit Beeren oder Leuchtpilzen in der Hand pflanzt `E` sie ein. Sie
  wachsen in sechs Minuten heran (Regen beschleunigt), tragen danach immer wieder und ruhen im Winter.
- **Kochtopf** (8 Steine, 3 Stöcke): ein Steinkessel am Dreibein über eigener Feuerstelle (wärmt wie ein
  Lagerfeuer). Wasser eingießen, zwei bis drei Zutaten hinein (Fleisch, Fisch, Pilze, Beeren) – nach einer halben
  Minute köchelnd mit Dampf ist ein **Eintopf** fertig, eine Portion pro Zutat. Geschöpft wird mit leeren Schalen.
- **Bett** (2 Holzstämme, 2 Stöcke, 3 Felle): Wer hier schläft, wacht mit voller Gesundheit auf, Hunger und Durst
  zehren weniger, und hier beginnt man nach dem Tod.
- Alles bleibt im Spielstand erhalten (Trockengrad, Wasserstand, Wachstum, Topfinhalt).

### Meilenstein 47 – Mehr Möglichkeiten (Teil 1: Waffen & Ausrüstung)

- **Knochen:** Wer Wild ausnimmt, bekommt jetzt auch Knochen – zwei bis drei vom Hirsch und vom Wolf, ab und zu
  einen vom Hasen.
- **Knochenkeule** (1 Holzstamm, 3 Knochen, 1 Fell): ein Oberschenkelknochen an einem Stiel. Langsamer und teurer
  an Ausdauer als die Axt, schlägt aber härter zu und lässt jeden Getroffenen (außer Bossen) gut eine Sekunde
  taumeln.
- **Brandpfeile** (3 Pfeile, 1 Lampenöl → 3 Stück): Mit `V` wechselt der Bogen die Munition. Ein Brandpfeil
  verbrennt beim Einschlag und setzt den Boden in Brand – ein kleinerer, kürzerer Brand als bei der
  Brandflasche, der Schrate und Wölfe trotzdem zurückweichen lässt. Sind die gewählten Pfeile aus, nimmt der
  Bogen die anderen.
- **Knochenrüstung** (6 Knochen, 3 Felle): per Rechtsklick anlegen. Sie fängt ein Drittel jedes Treffers ab,
  klappert aber und macht dich ein Viertel auffälliger. Sie bleibt im Spielstand erhalten.

### Meilenstein 46 – Heimweg

- **Die Geschichte hat jetzt ein Ende.** Sie führt quer über die Insel, bis zur Abfahrt mit dem Kutter:
  1. Dr. Albers vermutet, dass die Betriebsleitung mehr wusste. Im **Labor Nordwand** steht es schwarz auf weiß:
     Der Erreger ist ein Pilz aus dem Stollen und springt nicht von Mensch zu Mensch über. Im Tresor liegt die
     **Forschungsakte**.
  2. Mit der Akte und zwei Batterien setzt du an der **Funkstation** einen Funkspruch ab. Ohne Beweis glaubt dir
     niemand, ohne Strom bleibt das Gerät stumm. Das Festland lässt schließlich ein Boot mit Gesunden anlegen.
  3. Jonas will seinen alten Kutter, die **Möwe**, wieder flottmachen: Motorteile aus dem Maschinenraum der Fähre
     und vier Lampenöl als Sprit.
  4. Mia bittet dich, nach ihrer Mama zu suchen. Auf der gestrandeten Fähre liegt **Annes Brief**.
  5. Sag Jonas, dass du bereit bist: Ihr legt ab, und der **Abspann** erzählt, wie es ausgeht. Er hängt davon ab,
     ob Mia den Brief ihrer Mutter hat und ob Hansen, der Erste, gefallen ist. Dazu kommt eine Bilanz. Danach kann
     man auf der Insel weiterspielen.
- **Vier neue Orte:**
  - **Wrack der Fähre** an der Küste: auf ein Riff gelaufen, mit Brücke, Schornstein, fehlendem Rettungsboot,
    Gangway zum Strand und dem Logbuch des Kapitäns.
  - **Kapelle St. Brigid** nahe Altwasser: Glockenturm, umgestürzte Bänke, Kerzen auf dem Altar. Auf dem Friedhof
    sind drei Gräber offen, von innen aufgegraben. Dort liegt das Tagebuch des Pfarrers.
  - **Labor Nordwand** hoch im Gebirge: Betonbau mit Leuchtröhre, die immer wieder aussetzt, leuchtende Proben,
    Tresor, leerer Hubschrauber-Landeplatz und Zaun.
  - **Steinkreis** auf einer Kuppe: neun Menhire, ein Altar mit Leuchtpilzen, Totems mit Geweih und Schädel und
    ein Feuer, das die Schrate am Brennen halten. Ein Lager bewacht den Kreis. Am Hochsitz daneben liegen die
    Aufzeichnungen eines Jägers.
- **Neue Gegenstände:** Motorteile und die Forschungsakte.
- **Sieben neue Notizen:** Logbuch der Fähre, Annes Brief, Tagebuch des Pfarrers, Forschungsbericht,
  Schreibtischnotiz der Betriebsleitung, Aufzeichnungen des Jägers und der Funkspruch selbst.
- **Neue Aufträge:** „Was sie wussten“ und „Ein Funkspruch“ (Albers), „Mama“ (Mia), „Die Möwe“ (Jonas).
- **Tagebuch:** neues Kapitel „Heimweg“.
- **Behoben:**
  - Ein Notiz-Auftrag lässt sich jetzt auch abschließen, wenn man die Notiz schon vor der Annahme gelesen hat.
  - Laufende und fertige Aufträge eines Überlebenden erscheinen jetzt alle im Gespräch, auch wenn er gerade einen
    neuen anbietet.

### Meilenstein 45 – Die große Insel

- **Mehr als doppelt so viel Land:** Die Welt misst jetzt 2,3 × 2,3 km statt 1,5 × 1,5 km, gut 2 km² Land.
  - Es gibt mehr Schrat-Lager, Hirschrudel, Hasen und Wolfsrudel.
  - Alte Spielstände passen nicht zur neuen Insel und werden nicht geladen.
- **Neue Gebiete:**
  - **Gebirge** im Norden: Grate bis rund 145 m mit ewigem Schnee auf den Gipfeln. Die Baumgrenze liegt höher,
    fast nur Nadelbäume, viel Fels.
  - **Moor** im Südwesten: flaches, nasses Land voller knietiefer Tümpel. Dort stehen tote, teils abgebrochene
    Bäume, umgestürzte Stämme liegen im Wasser, dichtes Schilf wiegt sich im Wind. Über dem Moor hängt der Nebel
    auch tagsüber.
  - **Klippenküste** im Osten: Statt Strand fällt das Land in steilen Felswänden ins Meer. Oben liegt windige
    Heide mit vereinzelten Kiefern.
  - Wer ein Gebiet zum ersten Mal betritt, bekommt eine Meldung.
- **Neue Orte**, jeder mit Beute und einer Notiz:
  - **Absturzstelle** der Chartermaschine D-EKLA: zerbrochener Rumpf mit Fensterreihe, abgerissene Tragfläche,
    ein schwelendes Triebwerk, verbrannte Erde, verstreute Sitze und Koffer. Im Cockpit liegt das Bordbuch.
  - **Zeche Altwasser** am Gebirgshang: Mundloch mit Türstock und Laterne, Gleise mit Förderwagen, Abraumhalde,
    das Zechenhaus mit der Anordnung der Betriebsleitung. Der Stollen führt in den Feuersteinstollen zu Hansen.
  - **Hütte im Moor**: auf Pfählen über einem Tümpel, ein Bohlensteg führt hin. Vor der Tür hängen Knochen, drinnen
    liegt das Tagebuch der Einsiedlerin.
  - **Funkstation Klippenkopf**: 30 m hoher Gittermast mit rotem Warnlicht, das nachts weithin blinkt.
    Dazu eine Betonbaracke mit Funktisch, Zaun, Generator und das letzte Funkprotokoll.
- **Tagebuch:** neues Kapitel „Die ganze Insel“ (Gebiete betreten, Orte finden, letztes Funkprotokoll lesen).
- **Karte:** Entdeckte Orte erscheinen mit Namen. Moor und Schneegipfel sind auf der Karte zu sehen.
- **Technik:**
  - `world/Biomes.ts` legt die Gebiete fest (weich überblendet, Ränder mit Rauschen verbogen).
  - Höhenkarte, Bodenfarben, Vegetation, Gras und Karte lesen die Gebiete daraus.
  - Bauplätze der Orte werden vor dem Aufbau von Gelände und Physik gesucht und eingeebnet (`world/Places.ts`).
    Die Modelle bestehen aus Grundkörpern mit Foto-Oberflächen (`world/PlaceMeshes.ts`), die Laufzeit mit
    Behältern, Notizen, Lichtern und Spielstand liegt in `systems/Places.ts`.
  - Kleine Testwelten bleiben reiner Wald, damit die KI-Tests unverändert laufen.

### Meilenstein 44 – Bodennebel & Sonnenstrahlen

- **Sonnenstrahlen durchs Blätterdach:** Durch Lücken in den Kronen fallen schräge Lichtbahnen in den Wald.
  - Sie sind aus jedem Blickwinkel zu sehen, nicht nur gegen die Sonne. Gegen die Sonne gleißen sie.
  - Nachts gibt es schwächere Bahnen im Mondlicht, Wolken dämpfen sie.
- **Bodennebel:** Im Morgengrauen und nachts liegt eine dichte, wabernde Schicht knapp über dem Boden.
  - Sie folgt dem Gelände und zerfasert nach oben. Was dahinter liegt, verschwindet im Dunst.
  - Im Lampenlicht leuchtet sie auf. In kalten Nächten ist sie dichter, im Schneetreiben verweht.
- **Spuren im Nebel:** Wo der Spieler, Schrate oder Wölfe hindurchgehen, reißt der Nebel auf und verwirbelt
  ringsum. Nach einigen Sekunden schließt sich die Lücke wieder.
- **Technik:**
  - Beides läuft im Lichtkegel-Durchgang mit. Der Sehstrahl wird zusätzlich durch die Schattenkarte der Sonne
    verfolgt, die Geländehöhe kommt aus der Höhenkarten-Textur.
  - Der Bodennebel liefert neben dem Streulicht auch die Durchlässigkeit. So verdeckt er das Bild dahinter,
    statt es nur aufzuhellen.

### Meilenstein 43 – Gewitter & Blut

- **Sichtbare Blitze:** Im Gewitter zucken gezackte, verästelte Blitze von der Wolkenbasis bis zum Boden.
  - Der Leitblitz wächst in Sekundenbruchteilen herab, dann flackert der Kanal in mehreren Nachentladungen.
  - Mit jedem Puls leuchten Himmel und Gelände auf, und die Bäume stehen schwarz vor dem Himmel.
  - Ferne Einschläge werden in die Sichtweite geholt, ihre Richtung bleibt.
- **Blut:**
  - Bei Treffern spritzen Tropfen in Schlagrichtung und hinterlassen Flecken, wo sie aufschlagen: auf dem Boden,
    an Wänden und Felsen.
  - Unter Toten breitet sich eine Lache aus.
  - Frisches Blut glänzt nass im Lampenlicht, trocknet über Minuten dunkel ein und verblasst.
  - Auch der Spieler blutet, wenn ihn Schrate oder Wölfe erwischen.
- **Blut auf dem Bildschirm:** Schwere Treffer spritzen Blut an den Bildrand, einzelne Tropfen laufen langsam
  herunter. Nachts ist auch dieses Blut dunkel.

### Meilenstein 42 – Wasser

- **Spiegelungen:** Seen und Meer spiegeln Ufer, Bäume und Feuer.
  - Die Spiegelbilder zittern mit den Wellen.
  - Je flacher man über das Wasser blickt, desto stärker spiegelt es.
- **Wassertiefe:** Flaches Wasser ist klar und grünlich, man sieht den Grund. Tiefes Wasser ist dunkel.
- **Uferschaum:** Schaumkämme laufen aufs Ufer zu, an der Wasserlinie liegt ein ausgefranster Saum. Am Ufer
  glätten sich die Wellen.
- **Sonnenglitzern:** Bei tief stehender Sonne funkelt ein Teppich aus Lichtpunkten auf den Wellen. Nachts ist es
  schwächer, im Mondlicht.
- **Regenringe:** Bei Regen breiten sich überall kleine Kreise auf der Wasseroberfläche aus.
- **Technik:**
  - Die Spiegelungen sind Screen-Space-Reflexionen im Nebel-Durchgang. Das Wasser schreibt dafür Tiefe.
  - Die Geländehöhen liegen als Textur vor. Daraus bestimmt der Wasser-Shader Tiefe und Schaum, und die
    Spiegelung erkennt so Wasser und Strand.
  - Bei Grafikqualität „niedrig“ und in Höhlen sind die Spiegelungen aus.

### Meilenstein 41 – Feuer & Rauch

- **Echte Flammen:** Statt der starren Kegel züngeln die Flammen jetzt. Aufsteigendes Rauschen formt sie zu
  Zungen mit gelbem Kern, orangem Körper und dunkelroten, ausfransenden Spitzen. Jedes Feuer besteht aus einer
  Hauptflamme und kleineren Flammen drumherum.
- **Rauch:** Weiche, faserige Schwaden steigen auf, wachsen und verblassen. Der Wind treibt sie zur Seite.
  - Unten leuchten sie im Feuerschein, oben nehmen sie die Farbe des Himmels an.
  - Nachts sind sie fast unsichtbar.
- **Funkenflug:** Glühende Funken wirbeln in die Höhe und verglimmen. Hin und wieder knackt das Holz und ein
  ganzer Schwarm stiebt auf.
- **Hitzeflimmern:** Über Lagerfeuern und Brandherden flimmert die Luft. Das Bild dahinter wellt sich, Dinge vor
  dem Feuer bleiben ruhig.
- **Feuer nachts:** Flammen, Lampen und Glühwürmchen behalten nachts ihre Farbe. Sie werden nicht mehr mit
  entsättigt und leuchten durch den Bodennebel.
- Die Fackel in der Hand bekommt die neuen Flammen, aber keinen Rauch.

### Meilenstein 40 – Licht im Nebel

- **Sichtbare Lichtkegel:** Der Strahl der Taschenlampe steht nachts als Kegel im Dunst.
  - Treibende Nebelschwaden ziehen durch das Licht.
  - Stämme und Äste werfen dunkle Schneisen hinein (abgeschattet über die Schattenkarte der Lampe).
  - Im Regen, im Schneetreiben und in staubiger Höhlenluft streut das Licht stärker.
- **Leuchthöfe:** Fackeln, Lagerfeuer und brennendes Lampenöl tauchen den Nebel um sich in warmes Licht.
- **Schwebstaub:** Im Lichtkegel und im Feuerschein glitzern winzige Staubkörner, die langsam durch die Luft treiben.
  Ohne Licht sind sie unsichtbar.
- **Glühwürmchen:** In warmen Sommer- und Frühlingsnächten taumeln grüngelbe Lichtpunkte über Gras und Unterholz.
  - Jedes leuchtet in seinem eigenen Rhythmus auf: kurz hell, dann langsam verglimmend.
  - Bei Regen, Kälte, Schnee und tagsüber sind sie verschwunden.
- **Technik:**
  - Neuer Durchgang in der Nachbearbeitung (halbe Auflösung): Jeder Sehstrahl wird bis zur Oberfläche abgetastet.
    Der Startpunkt ist zufällig versetzt, das Ergebnis wird leicht weichgezeichnet.
  - Die Leuchthöfe der Punktlichter werden geschlossen integriert, ohne Abtasten.
  - Schwebstaub kostet keine CPU-Zeit: Ein Würfel aus Teilchen wandert im Vertex-Shader mit der Kamera mit.
  - Bei Grafikqualität „niedrig“ ist das Licht im Nebel aus.

### Meilenstein 39 – Zwei Hände

- **Bogen mit beiden Händen:** Die linke Hand hält den Bogen am Griff, der Arm kommt von links unten ins Bild.
  - Beim Spannen läuft die Sehne in zwei Hälften zur Wange zurück.
  - Der eingelegte Pfeil liegt auf der Sehne, und der Bogen schwenkt zur Mitte, bis der Pfeil aufs Fadenkreuz zeigt.
  - Die rechte Zughand liegt dann an der Wange, außerhalb des Blickfelds.
- **Schale auf der offenen Hand:** Die Schale ruht auf der Handfläche statt in einer Faust. Keine Finger mehr im
  Wasser.
- **Taschenlampe:** Die Faust umschließt den Bügel unter dem Lampengehäuse, statt mitten im Gehäuse zu stecken.
- **Technik:**
  - Der Arm ist jetzt samt Oberarm aus dem MakeHuman-Modell geschnitten (`scripts/prepare-fp-arm.mjs`). Der im
    Modell angewinkelte Ellbogen wird beim Laden gestreckt, sodass ein ausgestreckter Arm nicht mitten im Bild endet.
  - Die Hand kennt zwei Haltungen: Faust und offene Hand.
  - Die linke Hand ist derselbe Arm, gespiegelt.
  - Je Gegenstand lässt sich die Richtung des Unterarms festlegen.

### Meilenstein 38 – Neue Schrecken

- **Hetzer:** Verwandelte aus dem Ort, darunter der Inselpolizist. Sie sind bleich, gebückt und schneller als du.
  - Nachts tauchen sie zu zweit außer Sicht auf und halten auf dich zu.
  - Sie schlagen zu, verschwinden im Dunkel und kommen wieder. Feuer scheuen sie.
- **Die Schreierin:** eine bleiche Frau mit langem schwarzem Haar, die am Rand des Lichts bleibt.
  - Sieht sie dich, holt sie Luft und **schreit**. Der Schrei raubt dir fast alle Ausdauer, lässt die Furcht steigen
    und die Sicht beben.
  - Jeder Schrat im Umkreis von 90 m weiß danach, wo du bist. Sie selbst hält Abstand und flieht, wenn man ihr nahe
    kommt.
- **Hansen, der Erste:** In der hintersten Kammer des Feuersteinstollens, dort, wo laut Schichtbuch alles begann,
  haust der Bergmann, mit dem das Fieber anfing.
  - Er ist ein drei Meter großer Riese im verdreckten Schutzanzug mit Gasmaske, von Pilzen grünlich durchzogen.
  - Sein **Bodenstampfer** trifft rundum, auch hinter seinem Rücken, und lässt die Höhle beben.
  - Bei zwei Dritteln und bei einem Drittel seiner Kraft ruft er Kriecher aus den Spalten. Unter der Hälfte wird er
    rasend und schneller.
  - Feuer und Fallen treffen ihn doppelt: Brandflaschen sind der Schlüssel.
  - Im Kampf zeigt eine breite Lebensleiste oben im Bild seinen Zustand.
  - Besiegt lässt er die Vorräte der letzten Schicht fallen und kehrt nie zurück (im Spielstand gemerkt).
  - Neues Tagebuch-Ziel im Kapitel „Unter der Erde“.
- **Fiebernächte** werden härter: Ab der zweiten laufen Hetzer mit, ab der dritten schreien Schreierinnen.
- Auch Gegner, die in Fallen oder Feuer sterben, zählen jetzt für Tagebuch und Aufträge.
- Figuren und Bewegungen stammen wieder aus Mesh2Motion (CC0): vier neue Figuren und sieben neue Bewegungen, darunter
  Kratzen, Frauengang und Bodenstampfer.

### Meilenstein 37 – Verteidigung

- **Neue Bauwerke für das Lager:**
  - **Barrikade** (1 Stamm, 6 Stöcke): ein spanischer Reiter aus gekreuzten, angespitzten Pfählen. Schnell gebaut,
    rastet an Wänden ein. Wer hineinläuft oder darauf einschlägt, reißt sich auf.
  - **Stachelwand** (3 Stämme, 6 Stöcke): eine Palisade mit schräg nach vorne ragenden Spießen, die stärkste Wand.
    Schrate, die sie einreißen wollen, verletzen sich bei jedem Schlag.
  - **Fallgrube** (8 Stöcke, 2 Steine): unter Ästen und Laub getarnt. Wer drauftritt, stürzt auf die Pfähle
    (75 Schaden) und steckt einige Sekunden fest. Danach liegt sie offen; `E` tarnt sie neu (2 Stöcke).
  - **Klapperleine** (4 Stöcke, 1 Fell): Knochen und Steine an einer Schnur. Quert ein Schrat oder Wolf sie, rasselt
    sie, und du bekommst eine Warnung mit der Entfernung – auch wenn du gerade woanders bist.
- **Stachelfallen** und alle spitzen Bauten nutzen jetzt dieselbe Regel: Schaden beim Hineinlaufen und beim
  Zuschlagen.
- **Reparieren:** Beschädigte Bauwerke zeigen ihren Zustand in Prozent. Mit **R** repariert man sie um die Hälfte
  ihrer Haltbarkeit (je nach Bauwerk 1 Stamm oder ein paar Stöcke).
- **Brandflaschen:** Aus einer leeren Flasche und **Lampenöl** (neu: in Werkzeugkisten, Schränken, Autos und
  verlassenen Lagern) entsteht eine Brandflasche.
  - Linksklick wirft sie, mit Rechtsklick zielt man genauer.
  - Sie zerschellt und setzt den Boden für zwölf Sekunden in Flammen (2,6 m Umkreis). Alles darin verbrennt, auch du.
  - Schrate und Wölfe meiden das Feuer, rasende Horden laufen trotzdem hinein.
  - Regen löscht es schneller, Wasser sofort.
- **Klänge:** Glas zerspringt, das Öl fängt fauchend Feuer, die Klapperleine rasselt, und eine Fallgrube bricht ein.
  Alles ist wie immer synthetisiert.

### Meilenstein 36 – Wölfe & Winter

- **Wolfsrudel:** Drei Rudel mit je drei bis vier Wölfen leben fern vom Strand. Der Leitwolf ist der größte.
  - Sie ziehen gemeinsam durch ihr Revier und heulen nachts. Das Heulen trägt über 400 m.
  - Wenn sie Hunger haben, jagen sie Hirsche. Am Riss fressen sie eine Weile, danach liegt der Kadaver zum Ausnehmen
    da.
- **Wölfe stellen dir nach:** Sie wittern dich nachts auf rund 50 m, am Tag auf etwa 25 m. Geduckt ist es nur gut
  die Hälfte.
  - Das Rudel kreist dich ein und knurrt. Der Kreis zieht sich langsam zu.
  - Es beißt immer nur ein Wolf auf einmal: Er rennt an, schnappt zu und setzt sich wieder ab. Dann ist der nächste dran.
  - Am Tag verlieren Wölfe bald das Interesse, im Winter nicht.
  - Weglaufen hilft nicht, denn Wölfe sind schneller als du.
- **Feuer schützt:**
  - Mit Fackel oder an einem Lagerfeuer halten Wölfe mindestens 11 m Abstand und greifen nicht an.
  - Wer ihnen die Fackel entgegenstreckt, schlägt sie kurz in die Flucht.
- **Gegenwehr:**
  - Verletzte Wölfe fliehen, gesunde greifen nach einem Treffer erst recht an.
  - Fällt die Hälfte des Rudels, flieht der Rest und meidet dich eine Weile.
  - Erlegte Wölfe geben Fleisch und zwei Felle.
- **Winter macht sie kühner:** Im Schnee wittern Wölfe weiter und greifen öfter an. Im Schneesturm sind sie am
  dreistesten.
- **Das Wolfsmodell:** Ein freier Wolf mit Skelett (OpenGameArt, CC0), den ich realistischer gemacht habe:
  - graues Fell statt der Comic-Farben, helle Schnauze, kleinere bernsteinfarbene Augen,
  - nachts leuchten die Augen gelbgrün, wenn ein Wolf dich ansieht.

  Alle Bewegungen werden im Spiel berechnet (`WolfPose.ts`):
  - Schritt, Trab und Galopp mit federndem Rücken,
  - geducktes Anschleichen mit gefletschten Zähnen und Biss mit Sprung,
  - Heulen mit erhobenem Kopf, Fressen, Sturz zur Seite beim Tod.
- **Klänge:** Heulen, Knurren und Biss sind wie alle Geräusche des Spiels synthetisiert. Das Heulen gleitet an und
  ab und hat ein leichtes Vibrato.
- **Spuren im Schnee:** Im Winter bleiben Abdrücke im Schnee: Stiefel, nackte Füße der Schrate, Hufe, Pfoten und
  Hasenläufe.
  - Einer frischen Fährte kann man folgen.
  - Neuschnee deckt die Spuren schneller zu, bei Tauwetter verschwinden sie.
  - Die Abdrücke dunkeln den Schnee darunter ab, so bleiben sie auf grellem Schnee und nachts gleich gut lesbar.
- **Schneesturm:** Ein Gewitter im Winter wird zum Schneesturm.
  - Ein dichter, fahler Schleier nimmt die Sicht.
  - Blitze gibt es keine.
  - Die Kälte beißt auch am Tag.
- **Atemwolken:** Bei Kälte siehst du deinen Atem, beim Rennen schneller und kräftiger.

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
- **Welt:** 1 × 1 km Insel (seit Meilenstein 7: 1,5 × 1,5 km, seit Meilenstein 45: 2,3 × 2,3 km mit Gebirge, Moor und Klippenküste) aus Simplex-fBm + Ridged-Noise mit Stränden, Gebirge und Binnenseen
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
31. ~~Wölfe & Winter: Rudel, Spuren im Schnee~~ ✓
32. ~~Verteidigung: Barrikaden, Stachelwände, Fallen, Brandflaschen~~ ✓
33. ~~Neue Schrecken: neue Gegner, ein Boss in der Mine~~ ✓
34. Koop-Mehrspieler (Server, bis zu 50 Spieler)
