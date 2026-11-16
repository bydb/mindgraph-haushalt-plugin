# Prüfung Code Etappe 1

## Aufgabe
Adversariales Review des Codes von Etappe 1 (Commit `c514404`) gegen `docs/bauplan.md` und die Findings F01–F12 in `bauplan-review.md`. Gesucht sind echte Fehler, keine Stilfragen:
1. **Geld:** Rechenfehler, Vorzeichen, Doppelzählung, durchlaufende Posten, Storno/Rücknahme, Guthaben (unsere Sicht vs. Kreis-Sicht), Abschluss/Übertrag. Gibt es Eingaben, bei denen Summen in Übersicht, Bericht (Excel/PDF) und CSV voneinander abweichen?
2. **Datenverlust/Korruption:** Wege, auf denen eine Jahresdatei oder `haushalt.json` überschrieben, verdoppelt oder inkonsistent wird (Main-Warteschlange, `saveJahr` + Jahresliste, Abschluss zweier Dateien, Vorlage-Import, QIF-Import + Archiv).
3. **Umgehung der Regeln:** Kann der Renderer über Action-Payloads (Schemas in `manifest.json`) Sperren, Protokoll oder Regeln aus `store.ts` umgehen (z. B. `saveStamm` mit manipulierten Feldern, `abhaken` im gesperrten Jahr mit fremden IDs, `eingabe`-Objekte mit Zusatzfeldern)?
4. **Parser:** `qif.ts`, `xlsx.ts`, `vorlage.ts` — stille Verluste, falsche Zuordnung, präparierte Dateien (Größe, Entities, Formeln).
5. **Bericht:** `vorlage.ts` `berichtZeilen` — falsche Formelbezüge, falsche zwischengespeicherte Werte, Zeilen, die in Summen fehlen oder doppelt sind.
6. **Oberfläche:** Fälle, in denen die UI etwas anzeigt, das nicht dem gespeicherten Stand entspricht (z. B. veraltete Ansicht nach Fehler, falsche Vorzeichen).

## Kontext/Anker
- `src/store.ts`, `src/rechnen.ts`, `src/model.ts`, `src/main/index.ts`, `src/vorlage.ts`, `src/xlsx.ts`, `src/qif.ts`, `src/ausgabe.ts`, `src/renderer/*.tsx`, `manifest.json`
- Tests: `src/*.test.ts` (`npm test` — darf ausgeführt werden)
- Host: `~/dev/mindgraph-notes/app/src/main/plugins/host.ts`, `~/dev/mindgraph-notes/app/src/main/plugins/nativeServices.ts`

## Codex-Findings

### F13 — Kreis-Stand des Folgejahres übernimmt unbestätigte Buchungen
**Schwere:** hoch. **Beleg:** `src/rechnen.ts:122-132,147-159`; `src/store.ts:420-423`. **Fehlerszenario:** 2026 beginnt mit 100,00 €, eine Ausgabe über 20,00 € ist nur angeordnet. Der Abschluss setzt den Anfangsbestand 2027 auf 80,00 €. Solange der Kreis die Ausgabe nicht gebucht hat, beträgt dessen bestätigter Stand noch 100,00 €, die Übersicht 2027 zeigt aber 80,00 € als „vom Kreis bestätigt“. Das spätere Abhaken in der gesperrten 2026er Datei ändert den 2027er Stand nicht. **Vorschlag:** Eigenen und kreisbestätigten Anfangsbestand bzw. jahresübergreifende offene Zuordnungen getrennt fortführen und den Kreis-Stand bei nachträglichem Abgleich neu berechnen. [OFFEN]

### F14 — Fehler zwischen Jahresdatei und Jahresliste lässt das Jahr aus Berichten fallen
**Schwere:** hoch. **Beleg:** `src/main/index.ts:97-109,165-174,381-387`. **Fehlerszenario:** `jahrAnlegen` schreibt `haushalt-2027.json` erfolgreich; das anschließende Schreiben von `haushalt.json` mit `jahre: [2027]` schlägt fehl. Der Aufruf meldet einen Fehler. Beim Wiederholen wirft `jahrAnlegen` „schon angelegt“, während der Mehrjahresbericht 2027 wegen der fehlenden Jahresliste nicht lädt. Der Vault-Host kann keine Ordner auflisten. **Vorschlag:** Wiederanlauf für vorhandene, noch nicht registrierte Jahresdateien implementieren und `jahrAnlegen` in diesem Fall die Jahresliste reparieren lassen. [OFFEN]

### F15 — QIF-Import verwirft verschiedene gleich aussehende Transaktionen
**Schwere:** hoch. **Beleg:** `src/model.ts:277-280`; `src/store.ts:314-332`. **Fehlerszenario:** Zwei QIF-Sätze desselben Kontos haben am selben Tag denselben Betrag und Empfänger, beide ohne `N`-Belegnummer (etwa zwei gleich teure Bestellungen). Obwohl die Sätze verschieden sind, ist ihr Schlüssel identisch. `qifPlan` markiert den zweiten als `doppelt`; er wird nicht importiert und Ist/Guthaben fehlen um einen Betrag. **Vorschlag:** Innerhalb einer Datei gleiche Schlüssel als getrennte Sätze behandeln; für Wiederimport eine stabile Satz-/Datei-Identität oder eine Anzahl je Schlüssel verwenden und unklare Kollisionen als Konflikt zeigen. [OFFEN]

### F16 — Abschluss-Payload kann beliebige Überträge erzeugen
**Schwere:** hoch. **Beleg:** `manifest.json:748-775`; `src/main/index.ts:354-363`; `src/store.ts:390-410`. **Fehlerszenario:** Renderer ruft `abschliessen` mit `eingabe.uebertraege: [{stelleId: 'a4', betrag: 100000000}, {stelleId: 'a4', betrag: 100000000}]` auf, obwohl der Vorschlag für `a4` 0 Cent beträgt. Beide Einträge werden im Folgejahr gespeichert; der wirksame Ansatz steigt dort um 2 Mio. €, ohne Prüfung auf Dubletten oder zulässige Stellen. **Vorschlag:** Eingabe im Store auf existierende Ausgaben-Hauptgruppen, eindeutige IDs und sichere Centwerte prüfen; bewusst geänderte Überträge protokollieren und das verschachtelte Action-Schema begrenzen. [OFFEN]

### F17 — Bericht blendet entfernte Stellen abgeschlossener Jahre aus
**Schwere:** hoch. **Beleg:** `src/store.ts:51-66`; `src/model.ts:226-229`; `src/vorlage.ts:234-256,299-300`. **Fehlerszenario:** 2026 wird mit einer Ausgabenstelle und 100,00 € Ist abgeschlossen. Danach entfernt man diese Stelle aus den Stammdaten; `saveStamm` erlaubt das, weil das abgeschlossene Jahr `j.stellen` besitzt. Die Übersicht 2026 rechnet die eingefrorene Stelle weiter, aber `berichtDaten` und `berichtZeilen` laufen nur über `stamm.stellen`: Im Excel/PDF-Bericht fehlen die 100,00 € vollständig. **Vorschlag:** Berichtsgliederung für jede Jahres-Spalte aus dem jeweiligen `Jahr.stellen` bilden oder entfernte historische Stellen in der gemeinsamen Berichtsgliederung erhalten. [OFFEN]

### F18 — Unvollständige saveStamm-Action löscht die Gliederung
**Schwere:** hoch. **Beleg:** `manifest.json:59-88`; `src/main/index.ts:153-160`; `src/model.ts:157-180`; `src/store.ts:48-69`. **Fehlerszenario:** In einem Vault mit eingerichteter Gliederung, aber ohne Buchungen, ruft der Renderer `saveStamm` mit `{folder, jahr}` auf. Das Schema verlangt `stamm` nicht; `normalizeStamm(undefined)` erzeugt eine leere Gliederung. `saveStamm` findet keine gebuchten Stellen und überschreibt `haushalt.json` mit `stellen: []`. Bereits vorhandene Ansätze/Vorjahreswerte bleiben nur noch unter verwaisten IDs erhalten. **Vorschlag:** `stamm` im Action-Schema verlangen und im Main/Store Form und Pflichtfelder explizit validieren; eine leere Gliederung nur als bewusste Löschoperation zulassen. [OFFEN]

### F19 — Vorlage-Import ersetzt vorhandene Ansätze ohne Buchungen
**Schwere:** mittel. **Beleg:** `src/main/index.ts:309-337`. **Fehlerszenario:** In 2026 wurden bereits ein Ansatz von 5.000,00 € und eine Ansatzänderung eingetragen, aber noch keine Buchung. `vorlageUebernehmen` lässt den Import zu, weil nur `buchungen.length` geprüft wird; anschließend ersetzt `ansatz` den bestehenden Datensatz durch die Excel-Werte, während die alte Änderung stehen bleibt. Die Übersicht zeigt einen neuen wirksamen Ansatz, der weder dem vorherigen Stand noch der reinen Vorlage entspricht. **Vorschlag:** Import nur in leere Jahresdateien erlauben oder den Ersatz vorhandener Ansätze/Änderungen explizit und zeilenweise bestätigen; vor der ersten Schreiboperation sämtliche Zieljahre prüfen. [OFFEN]

### F20 — Nachträglich hinzugefügte Unterstelle lässt alte Direktbuchung im Bericht fehlen
**Schwere:** mittel. **Beleg:** `src/model.ts:221-224`; `src/store.ts:48-69`; `src/rechnen.ts:101-115`; `src/vorlage.ts:318-339`. **Fehlerszenario:** Auf eine Hauptgruppe ohne Kinder werden 100,00 € gebucht. Später wird unter derselben Gruppe eine Unterstelle ergänzt; `saveStamm` lässt dies zu. Die Übersicht zählt die alte Direktbuchung weiter, die Ist-Zelle der Hauptgruppe im Excel/PDF-Bericht wird aber nun als Formel nur aus Unterstellen gebildet und zeigt 0,00 €. **Vorschlag:** Ergänzen von Kindern zu einer bereits direkt bebuchten Gruppe verhindern oder bei der Berichtsformel den eigenen Gruppenwert einbeziehen. [OFFEN]

### F21 — Ungültige Kalendertage werden als Buchungsdatum akzeptiert
**Schwere:** mittel. **Beleg:** `src/store.ts:29-31,89-90,202-204`. **Fehlerszenario:** `buchung` mit `datum: '2026-02-30'` besteht Regex und `Date.parse` (JavaScript normalisiert den Tag in den März), wird aber als 30. Februar gespeichert. `abhaken` akzeptiert denselben ungültigen Zahlungstag. Export und Jahresabgleich zeigen damit nicht existente Datumswerte. **Vorschlag:** ISO-Datum durch Rückvergleich von Jahr/Monat/Tag mit einem UTC-Datum oder explizite Monatslängen prüfen. [OFFEN]

### F22 — Übernommene Vormerkung bleibt im Vorjahr aktiv
**Schwere:** mittel. **Beleg:** `src/store.ts:411-435`; `src/rechnen.ts:74-84,158-159`. **Fehlerszenario:** Eine Vormerkung über 50,00 € aus 2026 wird beim Abschluss nach 2027 übernommen. `abschliessen` legt eine neue Vormerkung in 2027 an, zieht im Vorjahr aber nur *nicht* übernommene Vormerkungen zurück. Die alte bleibt dort aktiv und mindert weiterhin den angezeigten freien Rest 2026; nach Entsperren erscheint sie erneut als offene Vormerkung. **Vorschlag:** Ursprungsbuchung beim Übernehmen mit Zielreferenz als übertragen markieren und sie aus offenen Vormerkungen/Frei herausnehmen; Wiederholung des Abschlusses anhand dieser Referenz behandeln. [OFFEN]

### F23 — Abgleich zeigt Ausgaben-Storno mit doppeltem Minus
**Schwere:** niedrig. **Beleg:** `src/renderer/Buchungen.tsx:272-283`; `src/geld.ts:10-16`. **Fehlerszenario:** Eine Ausgaben-Gegenbuchung über 20,00 € hat `stornoVon`. In der Abgleich-Tabelle setzt die Zelle ein führendes `−` für die Ausgabenstelle und übergibt zugleich `-rest` an `formatCent`, das selbst `−` ergänzt. Angezeigt wird `−−20,00` statt `+20,00` als Rückfluss. **Vorschlag:** Ein einziges vorzeichenrichtiges Cent-Ergebnis aus Bereich und Storno berechnen und einmal formatieren. [OFFEN]

## Claude-Antwort

Alle Findings gegengeprüft (trägt), vom Nutzer zur Umsetzung freigegeben. Belege: `npm test` 56 grün; Main-Ebene zusätzlich mit simuliertem Host gegen echte Dateien (lokal, nicht im Repo).

- F13 [ADRESSIERT] `uebersicht(stamm, jahr, vorjahrOffen)`; Main rechnet die Kette über abgeschlossene Vorjahre bei jedem Laden neu (`vorjahrOffen` in `src/main/index.ts`), spätes Abhaken im alten Jahr wirkt sofort. Test „Kreis-Stand im Folgejahr erbt offene Posten“.
- F14 [ADRESSIERT] `ansicht()` repariert die Jahresliste, wenn die Jahresdatei existiert; `jahrAnlegen` auf vorhandenes Jahr lädt statt zu werfen. Simuliert mit fehlschlagendem Schreiben.
- F15 [ADRESSIERT] Schlüssel mit Vorkommenszähler je Datei (`basis#n`); Wiederimport derselben Datei bleibt `doppelt`, ein zusätzlicher gleicher Satz wird `neu`.
- F16 [ADRESSIERT] `abschliessen` prüft Stellen gegen den Vorschlag, Eindeutigkeit, Betragsgrenzen und Vormerkungs-IDs; Schema von `eingabe` verschachtelt begrenzt.
- F17 [ADRESSIERT] Stellen, die in irgendeinem Jahr (auch gesperrt) oder in Vorjahreswerten verwendet sind, lassen sich nicht löschen (`stelleVerwendet`), nur stilllegen.
- F18 [ADRESSIERT] `stamm` im Schema Pflicht, Main prüft Form; Store verweigert das Leeren einer vorhandenen Gliederung.
- F19 [ADRESSIERT] Vorlage-Import prüft vor dem ersten Schreiben alle Zieljahre und verweigert bei vorhandenen Ansätzen/Änderungen/Sperre.
- F20 [ADRESSIERT] Neue Unterstellen unter direkt bebuchten Gruppen werden abgelehnt (alle Jahre).
- F21 [ADRESSIERT] `istDatum` vergleicht Jahr/Monat/Tag gegen UTC-Datum.
- F22 [ADRESSIERT] Original erhält `uebertragenNach`, zählt nicht mehr als vorgemerkt, ist nicht mehr offen, nicht editierbar; Wiederholung des Abschlusses löscht frühere Übernahmen nicht mehr.
- F23 [ADRESSIERT] Vorzeichen einmal berechnet, einmal formatiert.

## Status
Runde 1 umgesetzt; Nachprüfung durch Codex angefragt.
