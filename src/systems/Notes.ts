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
    id: 'leuchtfeuer',
    title: 'Logbuch des Leuchtturmwärters',
    style: 'paper',
    text:
      '3. Juni. Seit dem Unglück im Stollen kommt kein Schiff mehr. Ich halte das Feuer trotzdem am Brennen – irgendwer muss sehen, dass hier noch einer lebt.\n\n' +
      '9. Juni. Sie stehen nachts drüben am Strand und starren ins Licht. Herüber kommen sie nicht. Das tiefe Wasser meiden sie wie das Feuer.\n\n' +
      '21. Juni. Das Öl wird knapp. Im Schuppen hinterm Turm stehen die letzten Fässer. Wer das liest: Lass das Feuer nicht ausgehen.',
  },
  {
    id: 'schmuggler',
    title: 'Zettel in einer Blechdose',
    style: 'paper',
    text:
      'Ware für Brandt: zwei Kisten Konserven, Verbandszeug, Lampenöl, die Brandflaschen. Patronen nimmt er nicht mehr – sagt, gegen DIE hilft nur Feuer.\n\n' +
      'Seit die Fähre auf dem Riff liegt, holt niemand mehr ab. Ich lasse alles hier und versuche es mit dem Ruderboot.\n\n' +
      'Wer das findet: Nimm, was du brauchst. Und fahr nicht im Dunkeln übers offene Wasser.',
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
  // --- Kleine Orte (Meilenstein 52) ---
  {
    id: 'hollmann',
    title: 'Kalender am Küchenschrank (Hof Hollmann)',
    style: 'paper',
    text:
      'Mo – Tierarzt abgesagt. Fähre fährt nicht.\nDi – zwei Kühe fehlen. Zaun hinten offen, nicht kaputt. OFFEN.\n' +
      'Mi – die Kühe gefunden, am Waldrand. Will nicht aufschreiben, wie.\nDo – Jakob ist wieder zur Zeche. Sagt, sie zahlen dreifach für Nachtschichten.\n' +
      'Fr – Spuren im Acker. Barfuß. Viele.\nSa – Jakob nicht heimgekommen.\nSo – Ich lasse das Licht im Stall brennen, damit er den Weg findet.',
  },
  {
    id: 'brinkmann',
    title: 'Zettel unter dem Salzstreuer (Hof Brinkmann)',
    style: 'paper',
    text:
      'Rolf,\n\nwenn du das liest, sind wir mit dem Traktor runter nach Altwasser. Die Hühner sind seit drei Tagen still – nicht tot, STILL. ' +
      'Sie stehen da und schauen alle zum Wald.\n\nDas Gewehr liegt nicht mehr im Schrank, ich hab es mitgenommen. Der Schlüssel für die Scheune hängt am Nagel. ' +
      'Nimm, was du brauchst, aber mach das Tor wieder zu. Und geh nicht nach Sonnenuntergang über den Acker.\n\nGrete',
  },
  {
    id: 'gasthof',
    title: 'Tafel hinter dem Tresen (Gasthof Moorwinkel)',
    style: 'paper',
    text:
      'AUSSCHANK NUR BIS SONNENUNTERGANG.\n\nFensterläden bleiben zu. Wer nachts klopft, bleibt draußen – egal, wie er heißt und wie er klingt.\n\n' +
      'Stammtisch fällt aus, bis die Herren von der Betriebsleitung uns erklären, was in dem neuen Stollen los ist.\n\n' +
      'Darunter, mit Kreide nachgetragen: „Sie klingen wie wir. Das ist das Schlimmste. Sie klingen wie wir.“',
  },
  {
    id: 'moorwinkel1',
    title: 'Schulheft (Moorwinkel)',
    style: 'child',
    text:
      'Mein Ferientagebuch\n\nHeute hat Opa gesagt die Leute im Wald waren mal Bergleute. Er sagt sie haben zu tief gegraben und dann ist etwas mit hoch gekommen ' +
      'das wie Watte aussieht. Mama sagt Opa soll still sein.\n\nIn der Nacht hat jemand unser Lied gesungen. Draußen. Ganz falsch.\n\nIch darf nicht mehr zur Bushaltestelle.',
  },
  {
    id: 'moorwinkel2',
    title: 'Notizblock neben dem Telefon (Moorwinkel)',
    style: 'paper',
    text:
      'Notruf 112 – besetzt (8x)\nPolizei Nordheim – kein Freizeichen\nFähre – „Betrieb eingestellt“ (Band)\nBetriebsleitung Nordwand – legt auf\n\n' +
      'Telefonzelle unten an der Haltestelle geht auch nicht mehr. Habe trotzdem jede Stunde probiert.\n\nUm 3:14 hat es geklingelt. Niemand dran. Nur Atmen. Und ganz hinten: Grubenlampen-Brummen.',
  },
  {
    id: 'rezeption',
    title: 'Gästebuch der Rezeption (Campingplatz Seeblick)',
    style: 'paper',
    text:
      '„Traumhafte Ruhe, wunderbarer See, wir kommen wieder!“ – Fam. Kessler, Platz 7\n\n„Nachts Rufe aus dem Wald. Die Kinder finden es gruselig, ich finde es lustig :)“ – Tom, Zelt 4\n\n' +
      '„Weiß jemand, wohin die Holländer von Platz 3 sind? Auto steht noch da, Zelt offen.“ – ohne Namen\n\n' +
      '„NICHT IN DEN WALD. NICHT DEN RUFEN NACH.“ – quer über die Seite, mit Kugelschreiber eingedrückt',
  },
  {
    id: 'camping1',
    title: 'Tagebuch einer Urlauberin (Hütte am See)',
    style: 'paper',
    text:
      'Tag 5. Die Fähre ist ausgefallen, wir hängen hier fest. Der Platzwart sagt, das kommt vor. Er lügt schlecht.\n\n' +
      'Tag 6. Tom ist nicht vom Holzholen zurück. Ich habe die ganze Nacht seine Stimme gehört, er hat meinen Namen gerufen, ' +
      'immer wieder, immer gleich, als würde ein Band abgespielt.\n\nTag 7. Ich habe die Tür verrammelt. Am Morgen war Erde auf der Klinke. Von außen.',
  },
  {
    id: 'camping2',
    title: 'Postkarte, nie abgeschickt (Hütte am See)',
    style: 'paper',
    text:
      'Liebe Grüße von der Insel! Wetter mittel, See wunderschön, Essen im Gasthof Moorwinkel 1A.\n\n' +
      'Hinten, kleiner geschrieben: Falls ihr nichts mehr von uns hört – das Auto steht am Campingplatz, der Ersatzschlüssel liegt auf dem linken Hinterreifen. ' +
      'Fahrt Richtung Leuchtturm. Nicht durch den Wald. Nie durch den Wald.',
  },
  {
    id: 'saegewerk',
    title: 'Auftragsbuch (Sägewerk Tannenfeld)',
    style: 'paper',
    text:
      'Lieferung Grubenholz an Zeche Altwasser, Stollen 4: 40 Fm Stützbalken – STORNIERT (Betriebsleitung).\n\n' +
      'Neuer Auftrag Betriebsleitung: Bretter, Nägel, Bohlen – „zum Verschließen von Zugängen“. Dringend. Bar bezahlt.\n\n' +
      'Die Tannen am Nordhang haben einen weißen Belag unter der Rinde. Wie Watte. Die Säge verklebt davon. Kowalski hat sich daran geschnitten und hustet seitdem.\n\n' +
      'Kowalski seit Dienstag nicht zur Schicht. Sein Spind steht offen.',
  },
  // --- Fundorte im Wald (Meilenstein 52, Teil B) ---
  {
    id: 'wald1',
    title: 'Wandertagebuch (Zeltlager)',
    style: 'paper',
    text:
      'Tag 3 auf dem Inselrundweg. Kein Empfang, keine Menschenseele. Herrlich.\n\n' +
      'Nachts Schritte ums Zelt. Ein Reh, sagt Lena. Rehe gehen nicht auf zwei Beinen, sage ich.\n\n' +
      'Tag 4. Lena ist früh Wasser holen gegangen. Gerade eben hat sie vom Bach her gerufen, ich solle nachkommen. ' +
      'Ich habe geantwortet. Sie hat genau dasselbe noch mal gerufen. Wort für Wort. Mit genau derselben Betonung.\n\nIch gehe jetzt nachsehen.',
  },
  {
    id: 'wald2',
    title: 'Zettel unter einem Stein (Zeltlager)',
    style: 'paper',
    text:
      'An wen auch immer:\n\nWir sind Richtung Funkstation. Wenn du Licht brauchst: im Rucksack sind Batterien. ' +
      'Mach nachts KEIN Feuer im Wald, das Licht holt sie her. Aber ganz ohne Licht kommen sie auch.\n\n' +
      'Und wenn du jemanden deinen Namen rufen hörst – das sind wir nicht. Das waren wir nie.',
  },
  {
    id: 'wald3',
    title: 'Sprachmemo, abgetippt (Rucksack)',
    style: 'radio',
    text:
      '[Datei 14, 02:47 Uhr]\n„… die Lampe nicht ausmachen. Wenn ich sie ausmache, sind sie da. Sie stehen zwischen den Stämmen ' +
      'und machen nichts. Sie atmen nur. Synchron.“\n\n[Datei 15, 03:12 Uhr]\n„Batterie bei zehn Prozent. Ich lege das Handy auf den Rucksack. Falls jemand das findet: ' +
      'Ich bin nicht weggelaufen. Ich bin gegangen, als sie gerufen haben. Es war Papas Stimme.“\n\n[Ende der Aufnahmen]',
  },
  {
    id: 'wald4',
    title: 'Schussbuch des Jagdpächters (Hochsitz)',
    style: 'paper',
    text:
      '12.10. – 1 Reh (Ricke), Lichtung Nordhang.\n14.10. – nichts. Kein Wild seit zwei Tagen, der Wald ist totenstill.\n' +
      '16.10. – 1 ??? Auf 80 m angesprochen als Wildschwein. Ging auf zwei Beinen weiter. Getroffen, blutete nicht.\n' +
      '17.10. – Hochsitz nachts nicht mehr besetzen. Sie kommen die Leiter nicht hoch – glaube ich. Aber sie warten unten. ' +
      'Die ganze Nacht. Und morgens ist von den Sprossen die Rinde abgekratzt.',
  },
  {
    id: 'wald5',
    title: 'Vergilbter Brief, 1923 (Steinruine)',
    style: 'paper',
    text:
      'Lieber Bruder,\n\nder Pfarrer sagt, der weiße Schimmel im Keller sei Gottes Strafe für den neuen Schacht. Vater sagt, er sei nur Feuchtigkeit. ' +
      'Seit er im Keller schläft, redet Vater nachts mit Stimmen, die nicht seine sind.\n\n' +
      'Wir verlassen den Hof, sobald das Wetter es zulässt. Die Leute aus dem Dorf wollen die Grube zuschütten. Die Herren von der Gesellschaft lassen es nicht zu.\n\nDeine Schwester Hedwig',
  },
  // --- Atemberaubende Orte (Meilenstein 53) ---
  {
    id: 'myzel',
    title: 'Feldbericht P-M/7 (Myzel-Hain)',
    style: 'paper',
    text:
      'PROJEKT MYZEL – Außenstelle, Probe 7\n\nDas Geflecht hat die Bäume nicht getötet. Es benutzt sie. Wurzeln als Leitungen, Stämme als Antennen. ' +
      'Die Fruchtkörper leuchten im Takt – 11 Schläge pro Minute. So langsam schlägt ein Herz im Schlaf.\n\n' +
      'Dr. Albrecht meint, es reagiere auf Wärme. Ich glaube, es reagiert auf Stimmen. Wenn wir sprechen, wird das Leuchten schneller.\n\n' +
      'Seit gestern hört Kessler es auch. Er sagt, es fragt, wie wir heißen.',
  },
  {
    id: 'schleier',
    title: 'Postkarte, 1971 (Der Weiße Schleier)',
    style: 'paper',
    text:
      'Grüße vom Weißen Schleier! Der schönste Wasserfall der Nordsee, sagt der Wirt in Moorwinkel, und er hat recht. ' +
      'Wir haben auf der Bank gesessen, bis die Sonne den Regenbogen gemalt hat. H. hat unsere Namen in die Bank geritzt. Nächstes Jahr wieder!\n\n' +
      'Darunter, viel später, mit Bleistift: „Das Wasser ist das Einzige hier, das nicht nach Schimmel schmeckt. Ich trinke nur noch von oben, von der Kante.“',
  },
  {
    id: 'kutter',
    title: 'Logbuch Kutter „Grete“ (Schiffsfriedhof)',
    style: 'radio',
    text:
      '06:10 Auslaufen mit 14 Personen an Bord, Kurs Festland.\n07:40 Küstenwache auf Kanal 16: Rückkehr befohlen. Sperrgebiet.\n' +
      '07:45 Haben nicht geantwortet.\n08:30 Warnschuss vor den Bug.\n09:15 Nebel. Kompass dreht sich. Sind im Kreis gefahren.\n' +
      '11:00 Wieder vor Grauwasser. Wie ist das möglich.\n11:20 Wir hören eine Glockenboje. Auf der Seekarte ist hier keine Boje.\n11:22 Sie kommt näher.',
  },
  {
    id: 'turm',
    title: 'Brandwachbuch (Feuerwachturm)',
    style: 'paper',
    text:
      '04.10. Sichtweite gut. Kein Rauch. Über der Zeche nachts Licht, obwohl sie stillliegt.\n' +
      '09.10. Lichter im Wald zwischen Moorwinkel und dem Moor. Sie bewegen sich in Reihe, sehr langsam, wie eine Prozession.\n' +
      '12.10. Die Lichter sind keine Lampen. Sie haben keinen Schein, sie leuchten nur selbst.\n' +
      '13.10. Funkgerät tot. Bleibe oben. Von hier sieht man alles kommen.\n15.10. Sie stehen unten am Turm und schauen hoch. Alle. Die ganze Nacht.',
  },
  {
    id: 'tiefensee',
    title: 'Brief einer Enkelin (Tiefensee)',
    style: 'paper',
    text:
      'Oma, du hast mir nie geglaubt, dass ich die Glocke höre.\n\n1958 hat die Bergbaugesellschaft das Tal geflutet, für das Kühlwasser der Zeche. ' +
      'Alle sind gegangen, nur der alte Küster nicht. Er hat gesagt, die Glocke müsse weiterläuten, sonst finden die Toten nicht heim.\n\n' +
      'Heute Nacht hat sie wieder geläutet. Und im Glockenstuhl brannte Licht. Ich nehme das Boot und sehe nach. Wenn ich nicht zurückkomme, weißt du, wo ich bin.',
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
export const PLACE_NOTES = [
  'bordbuch',
  'zeche',
  'einsiedlerin',
  'funk3',
  'faehre',
  'anne',
  'pfarrer',
  'labor1',
  'labor2',
  'steinkreis',
  'leuchtfeuer',
  'schmuggler',
  'myzel',
  'schleier',
  'kutter',
  'turm',
  'tiefensee',
] as const;

/** Notizen in den kleinen Orten (Gehöfte, Moorwinkel, Campingplatz, Sägewerk). */
export const HAMLET_NOTES = ['hollmann', 'brinkmann', 'gasthof', 'moorwinkel1', 'moorwinkel2', 'rezeption', 'camping1', 'camping2', 'saegewerk'] as const;

/** Notizen an den Fundorten im Wald (Zeltlager, Rucksack, Hochsitz, Steinruine). */
export const WILD_NOTES = ['wald1', 'wald2', 'wald3', 'wald4', 'wald5'] as const;

/** Notizen, die keine Fundstelle haben, sondern entstehen (Funkspruch an der Funkstation). */
export const STORY_NOTES = ['funkspruch'] as const;

/** Notizen in den Höhlen (je neben der ersten Vorratskiste), nach Höhlen-Index. */
export const CAVE_NOTES = ['hoehle1', 'hoehle2', 'schichtbuch'];
