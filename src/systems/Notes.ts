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
  {
    id: 'faehre',
    title: 'Logbuch der Fähre „Altwasser“',
    style: 'paper',
    text:
      '12. September, 6:10 – Letzte Fahrt. 46 Menschen an Bord, zugelassen sind 30. Am Steg mussten wir die Leinen kappen, sie kamen aus dem Wald.\n\n' +
      '9:30 – Vor Nordheim liegt ein Patrouillenboot. Warnschüsse. Wir dürfen nicht anlegen. Ich habe gebettelt.\n\n' +
      '14:00 – Kehrt gemacht. Sturm aus West, das Ruder klemmt.\n\n' +
      '19:45 – Auf das Riff vor der Küste gelaufen. Wer schwimmen kann, geht an Land. Ich bleibe beim Schiff.\n\n' +
      'Nachtrag: Die Feuer am Strand sind nicht unsere.',
  },
  {
    id: 'anne',
    title: 'Brief an Mia',
    style: 'paper',
    text:
      'Mia, mein Schatz,\n\nich habe dir versprochen, dass wir zusammen fahren. Als sie zum Steg kamen, hat Jonas dich auf den Arm genommen ' +
      'und ist mit dir weggerannt. Ich habe es vom Deck aus gesehen, und ich war so froh, dass du nicht hier bist.\n\n' +
      'Wir sind auf ein Riff gelaufen. Ich gehe an Land und suche dich. Wenn ich dich nicht finde, dann weil der Wald zu groß ist – nicht, weil ich aufgehört habe.\n\n' +
      'An wen auch immer: Meine Tochter heißt Mia. Sie ist acht und hat Angst im Dunkeln. Sagen Sie ihr, dass ich sie lieb habe.\n\nMama',
  },
  {
    id: 'pfarrer',
    title: 'Tagebuch des Pfarrers',
    style: 'paper',
    text:
      'Wir haben Henning Weber am Montag begraben, den ersten aus der Kammer. Seine Frau wollte den Sarg nicht öffnen lassen.\n\n' +
      'Mittwoch – Das Grab ist offen. Die Erde liegt rings herum, als hätte jemand von innen gegraben. Keine Spuren, die zum Ort führen. Nur zum Wald.\n\n' +
      'Freitag – Zwei weitere Gräber offen. Ich habe den Friedhof abgesperrt und läute nachts nicht mehr die Glocke. Sie kommen, wenn sie läutet.\n\n' +
      'Herr, vergib uns. Wir haben sie lebendig begraben.',
  },
  {
    id: 'labor1',
    title: 'Forschungsbericht – Projekt Myzel',
    style: 'paper',
    text:
      'VERTRAULICH – NUR FÜR DIE BETRIEBSLEITUNG\n\nErreger: Pilzmyzel (Arbeitsname M-7) aus Kammer B des neuen Stollens. Aufnahme über die Atemwege (Sporen).\n\n' +
      'Verlauf: Fieber, Lichtempfindlichkeit, Verlust der Sprache. Der Wirt sucht Dunkelheit und die Nähe anderer Befallener.\n\n' +
      'Wichtig: Eine Übertragung von Mensch zu Mensch konnte in keinem Fall nachgewiesen werden. Wer die Kammer nie betreten hat, ist nicht gefährdet.\n\n' +
      'Empfehlung: Kammer versiegeln. Belegschaft vorerst NICHT unterrichten.',
  },
  {
    id: 'labor2',
    title: 'Notiz auf dem Schreibtisch',
    style: 'paper',
    text:
      'Hubschrauber kommt um 14 Uhr. Nur die Proben und die Messreihen mitnehmen, alles andere bleibt hier.\n\n' +
      'Der Gemeinde gegenüber gilt weiter: Grubengas, keine Krankheit. Die Akte im Tresor wird vernichtet – das übernehme ich selbst.\n\n' +
      'Nachtrag, zittrige Schrift: Keine Zeit mehr. Sie stehen am Zaun. Die Akte bleibt im Tresor – möge sie niemand finden.',
  },
  {
    id: 'steinkreis',
    title: 'Aufzeichnungen eines Jägers',
    style: 'paper',
    text:
      'Dritte Nacht auf dem Hochsitz. Sie kommen jede Nacht zum Kreis, immer kurz nach Mitternacht.\n\n' +
      'Sie tragen die leuchtenden Pilze aus dem Stollen herauf und legen sie auf den flachen Stein in der Mitte. Dann stehen sie nur da. Stundenlang. Sie summen.\n\n' +
      'Einer hat die Hände auf den Stein gelegt und zum Berg geschaut, als würde dort jemand rufen.\n\nIch gehe nicht wieder hin.',
  },
  {
    id: 'funkspruch',
    title: 'Funkspruch ans Festland',
    style: 'radio',
    text:
      'KLIPPENKOPF: Festland, bitte kommen. Hier spricht ein Überlebender des Charterflugs D-EKLA. Ich habe die Akte der Betriebsleitung.\n' +
      'FESTLAND: … Wiederholen Sie. Welche Akte?\n' +
      'KLIPPENKOPF: Projekt Myzel. Es ist ein Pilz aus dem Stollen. Keine Ansteckung von Mensch zu Mensch – sie haben es gewusst und geschwiegen.\n' +
      'FESTLAND: [lange Pause] Verstanden. Wenn das stimmt, ändert es alles. Wir schicken keine Fähre. Aber ein Boot mit Gesunden darf in Nordheim anlegen.\n' +
      'FESTLAND: Kommen Sie bei Tagesanbruch. Und bringen Sie diese Akte mit.\n\n[Ende der Verbindung]',
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
export const PLACE_NOTES = ['bordbuch', 'zeche', 'einsiedlerin', 'funk3', 'faehre', 'anne', 'pfarrer', 'labor1', 'labor2', 'steinkreis'] as const;

/** Notizen, die keine Fundstelle haben, sondern entstehen (Funkspruch an der Funkstation). */
export const STORY_NOTES = ['funkspruch'] as const;

/** Notizen in den Höhlen (je neben der ersten Vorratskiste), nach Höhlen-Index. */
export const CAVE_NOTES = ['hoehle1', 'hoehle2', 'schichtbuch'];
