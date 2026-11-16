# Prüfung Bauplan Etappe 1

## Aufgabe
Adversariales Review von `docs/bauplan.md` **bevor** gebaut wird. Nicht bestätigen, Löcher suchen:
1. Fachlogik: Wo kann Geld verloren gehen, doppelt zählen oder falsch zugeordnet werden (Ist/frei/Guthaben, durchlaufende Posten, Storno, Umschichtung, Jahresabschluss/Übertrag, Vormerkungen über den Jahreswechsel)?
2. Datenmodell: Fehlt etwas, das Etappe 2 (Abgleich-Assistent gegen eine PDF-Liste des Kreises: Zahlungsdatum statt Rechnungsdatum, 1:n-Aufteilung, andere Haushaltsstelle beim Kreis, Monatsnummer statt Belegnummer) braucht? Muss etwas jetzt rein, damit später nicht migriert werden muss?
3. QIF-Import (Abschnitt 6) und Excel-Erstimport (Abschnitt 7): Formatlücken, stille Datenverluste, Mehrdeutigkeiten.
4. Ablage/Schreibweg (Abschnitt 3): eine JSON-Datei je Jahr, Beleg-PDF vom Renderer geschrieben, Main als einziger Schreiber der JSON — Wettläufe, verwaiste Belege, Backup.
5. Plugin-API: Reicht der Vertrag (`src/host.ts`, Quelle `~/dev/mindgraph-notes/app/packages/plugin-api/src/`) für alles in Abschnitt 8–10 ohne App-Änderung? Belege mit Datei:Zeile im Host-Code.
6. Datenschutz/öffentliches Repo.

## Kontext/Anker
- `docs/bauplan.md` (gesamt)
- `src/host.ts` (vendorierter Host-Vertrag)
- Muster Faktura: `~/dev/mindgraph-faktura-plugin/src/main/index.ts` (Warteschlange, writeBytes, safeFolder), `~/dev/mindgraph-faktura-plugin/CLAUDE.md`
- Host: `~/dev/mindgraph-notes/app/packages/plugin-api/src/host.ts`, `~/dev/mindgraph-notes/app/src/main/plugins/host.ts`, `~/dev/mindgraph-notes/app/src/main/plugins/rendererRuntime.ts`

## Codex-Findings

### F01 — Jahresabschluss ist nicht atomar
**Schwere:** hoch. **Beleg:** `docs/bauplan.md:30,39-41,83-89,127-129`; `app/src/main/binaryWrite.ts:24-50` (Host). Abschluss verändert mindestens zwei Jahresdateien, während `writeBytes` nur eine einzelne Datei atomar ersetzt. Absturz nach dem Anfangsbestand/Übertrag im Folgejahr, aber vor Sperrung des Vorjahrs, oder ein erneuter Abschluss nach Entsperren kann Guthaben und Überträge doppelt anlegen. **Vorschlag:** Abschluss als idempotenten, über beide Jahre referenzierten Vorgang modellieren; Wiederaufnahme/Abgleich nach Teilfehler und Regeln für erneuten Abschluss festlegen. [OFFEN]

### F02 — Offene Anordnungen fehlen beim Jahreswechsel
**Schwere:** hoch. **Beleg:** `docs/bauplan.md:20-24,30-31,75-76`. Der Abschluss behandelt nur offene Vormerkungen; `angeordnet` zählt bereits zu Ist und Guthaben, kann aber erst im Folgejahr vom Kreis gebucht werden. Nach Sperrung lässt sich `gebuchtAm`/Status im Vorjahr nicht mehr setzen; im Folgejahr erneut buchen würde Guthaben doppelt verändern. **Vorschlag:** Jahreswechsel und späteren Kreisabgleich für offene Anordnungen ausdrücklich regeln, einschließlich jahresübergreifender Referenz und Trennung von Anordnungsjahr und Zahlungsjahr. [OFFEN]

### F03 — Storno kann bestätigten Kontostand verfälschen
**Schwere:** hoch. **Beleg:** `docs/bauplan.md:20-24,28,70-80,93`. Die Gegenbuchung hat positiven Betrag und `stornoVon`, aber der Plan legt ihren Status und ihr Kreis-Buchungsdatum nicht fest. Bei Storno einer `gebucht`en Buchung würde ein noch `angeordnet`er Gegenposten den „vom Kreis bestätigten“ Stand nicht neutralisieren; ein sofort `gebucht`er Gegenposten behauptet eine Kreisbestätigung ohne Abgleich. **Vorschlag:** fachlich getrennte Korrektur des eigenen Nebenbuchs und vom Kreis bestätigte Gegenbuchung definieren, inklusive Statusübergang und Datum; beide Guthabenstände dafür testen. [OFFEN]

### F04 — Belegablage umgeht die einzige Main-Warteschlange
**Schwere:** hoch. **Beleg:** `docs/bauplan.md:35,49,127-129`; `app/packages/plugin-api/src/rendererHost.ts:44-49` (Host); `app/src/main/plugins/rendererRuntime.ts:175-195` (Host). Der Renderer schreibt den PDF-Pfad direkt und verknüpft ihn erst danach per Action. Zwischen Pfadvorschlag und Schreiben können parallele Aktionen denselben Namen wählen; `writeBytes` ersetzt eine vorhandene Datei und sichert nur die Vorfassung. Ein Fehler nach dem Schreiben hinterlässt zudem einen nicht referenzierten Beleg. **Vorschlag:** Belegnummer, eindeutigen Pfad, Existenzprüfung, PDF-Schreiben und Verknüpfung in einer serialisierten Main-Action bündeln; verwaiste Dateien bei Wiederanlauf erkennen. [OFFEN]

### F05 — 1:n-Kreisabgleich hat keinen dauerhaften Datenanker
**Schwere:** mittel. **Beleg:** `docs/bauplan.md:31,70-80` und `docs/codex-collab/bauplan-review.md` Aufgabe 2. `kreisStelle` als Text und ein `gebuchtAm` pro Buchung können weder mehrere Kreis-Zahlungen zu einer Anordnung noch eine Kreis-Zahlung zu mehreren internen Buchungen mit Teilbeträgen, Kreisreferenz und Zahlungsdatum nachvollziehbar speichern. Der spätere PDF-Assistent müsste bestehende Status/Beträge nachträglich umdeuten oder migrieren. **Vorschlag:** schon jetzt separate, referenzierte Abgleich-/Zahlungszuordnungen mit Betrag in Cent, Zahlungsdatum, Kreis-Stelle und Kreis-Belegkennung vorsehen; Summe und Status daraus ableiten. [OFFEN]

### F06 — Gliederungsänderungen schreiben alte Jahre rückwirkend um
**Schwere:** mittel. **Beleg:** `docs/bauplan.md:39,55-68,97-100,142`. Alle Jahre referenzieren die eine veränderbare `Stammdaten.stellen`-Liste. Wenn Bereich, `parentId` oder `durchlaufend` in „Einrichtung“ geändert werden, ändern sich historische Ist-/Guthaben-Summen und Berichtzeilen rückwirkend; `inaktiv` schützt nur vor dem Verschwinden. **Vorschlag:** finanzwirksame Stellenmerkmale je Jahr versionieren/einfrieren oder Änderungen nach erster Buchung verbieten und eine neue ID für die neue Zuordnung verlangen. [OFFEN]

### F07 — QIF-Duplikatregel kann verschiedene Buchungen löschen
**Schwere:** mittel. **Beleg:** `docs/bauplan.md:105-111,70-80`. Gleiche Belegnummer im Jahr wird pauschal übersprungen; QIF kann mehrere Konten/Transaktionen mit derselben `N`-Nummer enthalten, und manuell erfasste Buchungen können dieselbe Nummer tragen. `qifRef` hat keine definierte stabile Quelle. Beim Wiederimport werden so echte Buchungen still ausgelassen, obwohl die Vorschau nur die Zahl zeigt. **Vorschlag:** Account/Quell-Datei/Transaktionsidentität und vollständigen Vergleich heranziehen; Nummernkollisionen als manuell zu entscheidende Konflikte behandeln, Importherkunft dauerhaft speichern. [OFFEN]

### F08 — QIF-Abgleichstatus wird als Kreisbestätigung gelesen
**Schwere:** mittel. **Beleg:** `docs/bauplan.md:24,105,111`. `CX`/`C*` bezeichnet den Quicken-Abgleichstatus, während `gebucht` im Modell ausdrücklich „vom Kreis gebucht, nach Abgleich“ bedeutet. Ohne Nachweis, dass die alte Quicken-Markierung genau die Kreis-Liste abbildet, erscheinen importierte Buchungen im bestätigten Guthaben und verschwinden aus offenen Posten. **Vorschlag:** QIF-Markierung als eigene Importinformation erhalten; `gebucht` erst nach verifiziertem Kreisabgleich setzen oder diese Semantik vor Import verbindlich klären. [OFFEN]

### F09 — Excel-Import hat keine festgelegte Euro-Cent-Umrechnung
**Schwere:** mittel. **Beleg:** `docs/bauplan.md:54,67,83-86,113-119`. XLSX-Zahlen sind nach dem Plan direkt Ansatz/Ist-Werte; das Modell erwartet Cent, die Vorlage zeigt Euro. Ohne explizite Umrechnung mit Dezimal- und Ganzzahligkeitsprüfung werden 100,00 € als 100 Cent statt 10 000 Cent gespeichert oder Rundungsfehler übernommen. **Vorschlag:** Zellen als Euro-Dezimalwerte lesen, exakt auf Cent umrechnen, nicht darstellbare Werte melden und Summen gegen die Vorschau prüfen. [OFFEN]

### F10 — XLSX-Leser setzt das erste Blatt und einen String-Typ voraus
**Schwere:** mittel. **Beleg:** `docs/bauplan.md:115-119`. Nur `sharedStrings.xml` und `sheet1.xml` zu lesen findet die Tabelle nicht zuverlässig: das sichtbare Vorlagenblatt kann über Workbook-Relations eine andere `sheetN.xml` sein; Textzellen können `inlineStr` statt Shared Strings nutzen. Die Vorschau könnte dann eine leere oder falsche Gliederung zur Bestätigung anbieten. **Vorschlag:** `workbook.xml`/Relations auswerten, Blatt auswählen bzw. erkennen, `inlineStr` unterstützen und Import bei fehlenden Pflichtzeilen hart abbrechen. [OFFEN]

### F11 — Exportziel ist im Host-Vertrag nicht festgelegt
**Schwere:** mittel. **Beleg:** `docs/bauplan.md:123-125,129-131`; `app/packages/plugin-api/src/host.ts:77-88`; `app/src/main/plugins/host.ts:293-301` (Host). Die geplanten Main-Actions erzeugen XLSX/PDF/CSV, deklarieren aber nur `vault.read`, `vault.write`, `pdf.render`. Ein OS-Speicherdialog ist ein eigener `dialog`-Dienst mit Capability; der Bauplan nennt keinen anderen Ausgabepfad. Damit ist unklar, wie Nutzer die Berichte außerhalb des Vaults als Dateien erhalten. **Vorschlag:** Exportziel und Dateiausgabe festlegen; für einen OS-Dialog `dialog` deklarieren und den aktuellen Host-Vertrag statt des schmalen `src/host.ts` verwenden. [OFFEN]

### F12 — Öffentlicher Bauplan enthält echten Lieferantennamen
**Schwere:** niedrig. **Beleg:** `docs/bauplan.md:43`; `AGENTS.md` „Harte Leitplanken“. Der Beispiel-Belegpfad nennt einen echten Lieferantennamen [von Claude geschwärzt], obwohl das öffentliche Repo keine echten Lieferantennamen enthalten soll. **Vorschlag:** durch eindeutig erfundenen Musterlieferanten ersetzen und bestehende Dokumentation/Fixtures vor Veröffentlichung auf Echtdaten prüfen. [OFFEN]

## Claude-Antwort

Gegengeprüft am 16.11.2026; Entscheidungen vom Nutzer freigegeben. Umgesetzt in `docs/bauplan.md`.

- F01 [ADRESSIERT] Abschluss mit `abschlussId`, Reihenfolge Folgejahr → Sperre, Wiederholung ersetzt statt verdoppelt, unvollständiger Abschluss wird beim Laden gemeldet (Abschnitt 2, Regel 10).
- F02 [ADRESSIERT] Offene Anordnungen bleiben im alten Jahr; Abhaken bleibt im gesperrten Jahr erlaubt und wird protokolliert (Regel 9/10).
- F03 [TEILWEISE] Regeln festgelegt: Rücknahme ohne Gegenbuchung für nicht bestätigte Anordnungen; Gegenbuchung im Status `angeordnet` für bestätigte. Dass der Kreis-Stand sich erst nach Abhaken der Gegenbuchung ändert, ist gewollt (der Kreis hat sie dann wirklich gebucht).
- F04 [ADRESSIERT] Belegablage komplett in einer Main-Action über `host.dialog.openFile` (Capability `dialog`, `app/packages/plugin-api/src/host.ts:83`); verwaiste PDFs werden gemeldet.
- F05 [ADRESSIERT] `KreisZuordnung` mit Teilbeträgen schon in Etappe 1; `gebucht` daraus abgeleitet.
- F06 [ADRESSIERT] Gliederung wird beim Sperren in die Jahresdatei eingefroren.
- F07 [ADRESSIERT] Inhaltsschlüssel für Duplikate; reine Nummernkollision = Konflikt zur Entscheidung.
- F08 [ADRESSIERT] Nutzer: „X“ heißt nur „in Quicken erfasst“. Import immer `angeordnet`, Quicken-Status bleibt als Herkunft.
- F09, F10 [ADRESSIERT] Euro→Cent exakt mit Prüfung; Blatt über workbook.xml/Relations, inlineStr/str; fflate ≥ 0.8.3.
- F11 [ADRESSIERT] Berichte nach `Berichte/` im Vault, zusätzlich „Speichern unter …“ über `host.dialog.saveFile`.
- F12 [ADRESSIERT] Echter Lieferantenname durch „Musterhosting GmbH“ ersetzt.

## Status
Runde 1 abgeschlossen, alle Findings beantwortet. Nächste Prüfung: Code der Etappe 1.
