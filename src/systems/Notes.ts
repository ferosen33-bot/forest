/**
 * Die Geschichte der Insel in Fundstücken: Aushänge, Briefe, Funkprotokolle und Tagebuchseiten.
 * Wo eine Notiz liegt, legen Stadt (`TownMeshes`) und Höhlen (`Caves`) fest; gelesene Notizen
 * sammelt das Tagebuch.
 */

export type NoteStyle = 'paper' | 'radio' | 'child';

export interface NoteDef {
  id: string;
  title: string;
  style: NoteStyle;
  text: string;
}

export const NOTES: NoteDef[] = [
  {
    id: 'aushang',
    title: 'Aushang der Gemeinde',
    style: 'paper',
    text:
      'BEKANNTMACHUNG\n\nWegen der anhaltenden Fieberfälle gilt ab sofort eine Ausgangssperre nach Einbruch der Dunkelheit. ' +
      'Der neue Stollen am Hang bleibt bis auf Weiteres geschlossen.\n\nWer Erkrankte sieht, die sich nachts im Wald aufhalten, ' +
      'meldet dies umgehend im Gemeindehaus – NICHT selbst ansprechen.\n\nDie Fähre verkehrt bis auf Weiteres nicht.\n\n– Gemeinde Altwasser',
  },
  {
    id: 'einkauf',
    title: 'Einkaufszettel',
    style: 'paper',
    text:
      'Konserven (viele!)\nWasser in Flaschen\nBatterien – große UND kleine\nVerbandszeug\nKerzen\n\n' +
      'Der Laden schließt jetzt schon um vier. Herr Albers sagt, er macht erst wieder auf, wenn die Fähre kommt.',
  },
  {
    id: 'brief',
    title: 'Brief an Marta',
    style: 'paper',
    text:
      'Liebe Marta,\n\ndie Kinder schlafen endlich. Ich schreibe dir, falls das Telefon nicht wieder geht.\n\n' +
      'Seit Paul aus dem Stollen zurück ist, ist er nicht mehr er selbst. Er sitzt im Dunkeln und erträgt kein Licht. ' +
      'Heute Nacht stand er barfuß im Garten und sah zum Wald hinüber, stundenlang.\n\n' +
      'Wir nehmen das letzte Boot. Wenn du diesen Brief liest, sind wir hoffentlich schon bei dir.\n\nDeine Anne',
  },
  {
    id: 'kind',
    title: 'Heft mit Bleistiftschrift',
    style: 'child',
    text:
      'Herr Brandt von nebenan war drei Tage weg. Gestern war er wieder da und hat an unser Fenster geklopft. ' +
      'Seine Augen haben geleuchtet wie bei einer Katze.\n\nPapa hat die Fenster mit Brettern zugenagelt. ' +
      'Ich darf nicht mehr draußen spielen.\n\nIch hab Angst vor dem Wald.',
  },
  {
    id: 'arzt',
    title: 'Ärztliche Notiz',
    style: 'paper',
    text:
      'Patient H., 41, Bergmann im neuen Stollen. Fieber 40,1. Pupillen geweitet, starke Lichtempfindlichkeit, ' +
      'Haut auffallend blass. Reagiert kaum auf Ansprache – aber auf jedes Geräusch.\n\n' +
      'Dritter Fall dieser Art, alle aus derselben Schicht. Ich vermute einen Erreger aus dem Stollen und habe die Schließung empfohlen.\n\n' +
      'Nachtrag: H. ist aus dem Krankenzimmer verschwunden. Das Fenster wurde von innen geöffnet.',
  },
  {
    id: 'tankwart',
    title: 'Zettel an der Kasse',
    style: 'paper',
    text:
      'An alle, die nach mir kommen:\n\nIn der Werkzeugkiste hinten liegt meine Machete. Nehmt sie.\n\n' +
      'Wenn ihr nachts raus müsst: nehmt Feuer mit. Vor Flammen weichen sie zurück. ' +
      'Eine Taschenlampe macht die Bleichen in den Höhlen nur neugierig.\n\nIch versuche, zum Steg in der Nordbucht zu kommen.\n\n– J. Petersen',
  },
  {
    id: 'funk1',
    title: 'Funkprotokoll, 14. August',
    style: 'radio',
    text:
      'ALTWASSER: Festland, bitte kommen. Wir haben elf Erkrankte, drei davon verschwunden.\n' +
      'FESTLAND: Verstanden, Altwasser. Die Gesundheitsbehörde prüft. Bis dahin bleibt die Insel gesperrt.\n' +
      'ALTWASSER: Wir brauchen einen Arzt, kein Sperrgebiet!\n' +
      'FESTLAND: … Wiederholen Sie die Symptome.\n' +
      'ALTWASSER: Fieber, dann Lichtscheu. Sie hören auf zu sprechen. Und dann gehen sie nachts in den Wald.\n\n[Ende der Aufzeichnung]',
  },
  {
    id: 'funk2',
    title: 'Funkprotokoll, 2. September',
    style: 'radio',
    text:
      'ALTWASSER: … sind aus dem Wald zurückgekommen. Sie tragen Rinde und Knochen am Leib, als hätten sie sich verkleidet. ' +
      'Brandt war dabei. Er hat mich angesehen und nicht erkannt.\n' +
      'ALTWASSER: Sie meiden das Feuer. Wir halten die Tonnen auf dem Marktplatz am Brennen.\n' +
      'ALTWASSER: Festland, wir räumen den Ort. Letzte Fahrt ab dem Steg in der Nordbucht. Wer bis Sonntag nicht da ist –\n\n[Rauschen]',
  },
  {
    id: 'hoehle1',
    title: 'Zerknitterte Seite',
    style: 'paper',
    text:
      'Wir haben uns hier unten versteckt, als sie den Ort überrannt haben. Oben ist es nachts nicht mehr sicher. ' +
      'Hier ist es dunkel, aber die Schrate kommen nicht herein.\n\n' +
      'Nachtrag: Wir sind nicht allein hier unten. Etwas atmet in der Dunkelheit. Es ist bleich – und es hat einmal so gesprochen wie wir.',
  },
  {
    id: 'hoehle2',
    title: 'Letzte Zeilen',
    style: 'paper',
    text:
      'Die Fackel ist fast herunter. Sie bleiben am Rand des Lichts und warten. Ich glaube, einer ist Henning. ' +
      'Er hat meinen Namen geflüstert.\n\nWer das hier findet: Geh nicht ohne Feuer in die Tiefe. ' +
      'Und geh zum Steg in der Nordbucht. Vielleicht liegt da noch ein Boot.',
  },
  {
    id: 'schichtbuch',
    title: 'Schichtbuch, neuer Stollen',
    style: 'paper',
    text:
      '3. Juli – Durchbruch in eine natürliche Kammer. Die Wände voller Pilze, die im Dunkeln leuchten. Warmer, süßlicher Geruch.\n\n' +
      '9. Juli – Weber und Hansen klagen über Kopfschmerz. Viel Staub in der Kammer.\n\n' +
      '17. Juli – Halbe Schicht krank gemeldet. Die Betriebsleitung will trotzdem weiterarbeiten.\n\n' +
      '24. Juli – Stollen auf Anordnung der Gemeinde geschlossen. Zu spät.',
  },
  {
    id: 'bordbuch',
    title: 'Bordbuch, Charterflug D-EKLA',
    style: 'paper',
    text:
      '21:40 – Gewitterfront über der Insel, Ausweichen nach Westen nicht möglich. Funkverbindung zum Festland gestört.\n\n' +
      '21:52 – Kompass dreht sich. Unter uns Feuer im Wald, viele, im Kreis angeordnet. Kein Ort laut Karte.\n\n' +
      '21:58 – Linkes Triebwerk ausgefallen. Versuche Notlandung auf der Lichtung.\n\n' +
      'An die Fluggäste, falls jemand das hier findet: Bleibt beim Wrack und macht Feuer. Sie werden nach uns suchen.\n\n' +
      'Nachtrag, andere Handschrift: Niemand sucht nach uns. Sie haben Hendrik in der ersten Nacht geholt.',
  },
  {
    id: 'zeche',
    title: 'Anordnung der Betriebsleitung',
    style: 'paper',
    text:
      'ZECHE ALTWASSER – AUSHANG FÜR ALLE SCHICHTEN\n\n' +
      'Der Abbau im neuen Stollen wird fortgesetzt. Die Kammer hinter Strecke 3 ist zu meiden, bis die Wetterführung geprüft ist.\n\n' +
      'Gerüchte über eine ansteckende Krankheit sind haltlos. Wer sich wegen Kopfschmerzen oder Lichtempfindlichkeit krankmeldet, ' +
      'wird vom Lohn abgezogen.\n\nDie Laternen am Mundloch bleiben die ganze Nacht an. Die Wache meldet jede Bewegung am Hang.\n\n– Die Betriebsleitung',
  },
  {
    id: 'einsiedlerin',
    title: 'Tagebuch der Einsiedlerin',
    style: 'paper',
    text:
      'Das Moor schützt mich. Sie mögen das schwarze Wasser nicht, und den Torfrauch noch weniger.\n\n' +
      'Letzte Nacht kamen sie trotzdem bis an den Steg. Sie tragen Knochen und Geweihe, sie singen ohne Worte. ' +
      'Am Rand des Sumpfs haben sie Feuer im Kreis entzündet und etwas ins Wasser gelegt.\n\n' +
      'Ich habe Hennings Stimme unter ihnen gehört. Er war der Erste aus dem Stollen.\n\n' +
      'Ich hänge die Knochen vor die Tür, wie sie es tun. Vielleicht halten sie mich dann für eine von ihnen.',
  },
  {
    id: 'funk3',
    title: 'Funkprotokoll, 9. September',
    style: 'radio',
    text:
      'KLIPPENKOPF: Festland, hier Funkstation Klippenkopf. Altwasser ist geräumt, die Fähre kam nicht.\n' +
      'FESTLAND: Verstanden. Die Insel steht unter Quarantäne. Es wird keine Evakuierung geben.\n' +
      'KLIPPENKOPF: Hier sind noch Menschen! Ich sehe Rauch an der Nordbucht.\n' +
      'FESTLAND: … Bleiben Sie in Ihrer Station. Wiederhole: Niemand verlässt die Insel.\n' +
      'KLIPPENKOPF: Sie stehen am Zaun. Das rote Licht am Mast hält sie nicht fern, es lockt sie an. Ich mache es aus und —\n\n[Ende der Aufzeichnung]',
  },
];

const BY_ID = new Map(NOTES.map((n) => [n.id, n]));

export const getNote = (id: string): NoteDef | undefined => BY_ID.get(id);

/** Notizen in der Stadt: Gemeindehaus, Tankstelle, Laden und drei Wohnhäuser. */
export const TOWN_NOTES = {
  hall: ['aushang', 'funk1', 'funk2'],
  gas: ['tankwart'],
  shop: ['einkauf'],
  houses: ['brief', 'kind', 'arzt'],
} as const;

/** Notizen an den besonderen Orten (Absturzstelle, Zeche, Hütte im Moor, Funkstation). */
export const PLACE_NOTES = ['bordbuch', 'zeche', 'einsiedlerin', 'funk3'] as const;

/** Notizen in den Höhlen (je neben der ersten Vorratskiste), nach Höhlen-Index. */
export const CAVE_NOTES = ['hoehle1', 'hoehle2', 'schichtbuch'];
