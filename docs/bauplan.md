# Bauplan Haushalt (Etappe 1)

Stand 16.11.2026. Grundlage: Grill-Interview mit dem Nutzer, echte Beispieldaten eines Medienzentrums (liegen **nicht** im Repo).

## 1. Worum es geht

Ein Medienzentrum führt seinen Haushalt als **Nebenbuch**. Der Kreis bucht und bezahlt alles offiziell; das Medienzentrum hat kein eigenes Konto. Der Kreis führt für das Medienzentrum ein Verrechnungskonto mit Guthaben und Übertrag ins Folgejahr. Bisher lief das in einer sehr alten Quicken-Version; die Steuerungsgruppe bekommt eine Excel-Tabelle (Zeilen = Haushaltsstellen, Spalten = Ansatz/Ist je Jahr).

Das Plugin ersetzt Quicken: Haushaltsstellen, Buchungen mit Beleg, Überwachung (Ansatz – Ist = Rest), Guthaben beim Kreis, Abgleich mit der Liste des Kreises, Jahresabschluss mit Übertrag, Bericht für die Steuerungsgruppe.

Nicht Ziel: Rechnungen schreiben (das macht Faktura), doppelte Buchführung, revisionssichere Finanzbuchhaltung, Zahlungsverkehr.

## 2. Fachregeln (vom Nutzer bestätigt)

1. **Gliederung mit zwei Ebenen.** Hauptgruppe (z. B. `5200` / Kurz `4` / „Aufw. Sach-, Dienstleistung“) trägt den **Ansatz**. Gebucht wird auf **Unterstellen** (`5210` / `4a` Geräte, `5210` / `4d` MINT-Space). Unterstellen sind kein eigener Topf. Eine Hauptgruppe ohne Unterstellen ist selbst bebuchbar (`5230` Veranstaltungen, `5290` Sonstige).
   - Die vierstellige Nummer ist **nicht eindeutig** (`5010` steht für Gruppe und beide Unterstellen). Identität ist eine interne ID; Anzeige „Nummer · Kurz · Name“.
   - Es gibt Stellen ohne Nummer (`1d` Schulträger Microsoft365-Lizenz).
2. **Einnahmen und Ausgaben**, je Stelle festgelegt (Bereich `einnahme` / `ausgabe`).
3. **Durchlaufende Posten** (MS365: Einnahme `1d`, Ausgabe `5c` unter `5220`) zählen **nicht** zur Summe und nicht zum Ansatz ihrer Gruppe. Summen gibt es „mit“ und „ohne“ durchlaufende Posten.
4. **Status einer Buchung:** `vorgemerkt` → `angeordnet` → `gebucht` (vom Kreis gebucht, nach Abgleich).
   - **Ist** = angeordnet + gebucht. **Vorgemerkt** wird getrennt gezeigt. **Frei** = wirksamer Ansatz − Ist − vorgemerkt.
5. **Ansatzänderungen sind eigene Einträge**: `uebertrag` (Rest aus Vorjahr), `nachtrag`, `umschichtung` (erzeugt zwei gekoppelte Einträge −/+), `sperre` (negativ), `korrektur`. Jede mit Datum, Betrag, Bemerkung. Wirksamer Ansatz = Ursprungsansatz + Summe Änderungen.
6. **Überschreitung warnt, sperrt nicht.**
7. **Guthaben beim Kreis** = Anfangsbestand 1.1. + Einnahmen − Ausgaben (inkl. durchlaufend). Zwei Stände: „nach unseren Buchungen“ (Ist) und „vom Kreis bestätigt“ (nur `gebucht`).
8. **Belegnummer** im Format der Altdaten: `JJJJ NNN` (`2026 025`), fortlaufend je Jahr, vergeben beim Anlegen; nie wiederverwendet (auch nicht nach Storno/Löschen eines Vormerkers).
9. **Änderbarkeit (Nebenbuch, kein GoBD-Zwang, aber nachvollziehbar):**
   - `vorgemerkt`: frei änderbar und löschbar.
   - `angeordnet` / `gebucht`: Felder änderbar, **jede Änderung landet mit alt/neu im Protokoll**; Löschen nicht möglich.
   - **Rücknahme vs. Storno (F03):** Eine `angeordnet`e Buchung ohne Kreisbestätigung wird **zurückgezogen** (`zurueckgezogen: {am, grund}`): zählt nirgends mehr, keine Gegenbuchung. Eine `gebucht`e Buchung bekommt eine **Gegenbuchung** (`stornoVon`, eigene Nummer, Status `angeordnet`); der vom Kreis bestätigte Stand ändert sich erst, wenn auch die Gegenbuchung abgehakt ist — gewollt.
   - Abgeschlossenes Jahr: gesperrt für Beträge, Stellen, neue Buchungen, Änderungen. **Abhaken (Kreisbestätigung) bleibt erlaubt** (F02) und wird protokolliert. Entsperren nur mit Begründung, steht im Protokoll.
10. **Jahresabschluss** ist ein Vorschlag: Endstand Guthaben → Anfangsbestand Folgejahr; je Ausgaben-Hauptgruppe Rest = wirksamer Ansatz − Ist → vorgeschlagener `uebertrag` im Folgejahr (einzeln bestätigen, Betrag änderbar). Offene Vormerkungen: einzeln ins Folgejahr übernehmen (neue Nummer, Verweis) oder zurückziehen. Offene Anordnungen **bleiben im alten Jahr** und werden dort später abgehakt (F02); der Abschluss zeigt sie als Liste „noch nicht beim Kreis“.
    - **Idempotent (F01):** Abschluss hat eine `abschlussId`. Reihenfolge: Folgejahr schreiben (Anfangsbestand, Überträge mit `ausAbschluss: abschlussId`) → Vorjahr sperren (`abschluss: {id, am, endstand}`). Ein erneuter Lauf ersetzt alle Einträge mit derselben oder einer älteren `ausAbschluss`-Kennung statt sie zu verdoppeln; ein Folgejahr ohne gesperrtes Vorjahr wird beim Laden als „Abschluss unvollständig“ gemeldet und lässt sich fortsetzen.
    - **Gliederung einfrieren (F06):** Beim Sperren wird die für das Jahr gültige Gliederung (`stellen`) in die Jahresdatei kopiert; Berichte über gesperrte Jahre nutzen diese Kopie.
11. **Abgleich mit dem Kreis in Etappe 1 von Hand**: Liste offener (`angeordnet`) Buchungen, filterbar nach Stelle/Betrag, abhaken → `gebucht`. Jedes Abhaken legt eine **Kreiszuordnung** an (F05, siehe Modell) mit Datum, Betrag, optional Kreis-Stelle und Kreis-Vorgang. Etappe 2 nutzt dieselbe Struktur für 1:n.

## 3. Ablage im Vault

Ordner je Rechner wählbar (`localStorage`, Standard `Haushalt`). Ein Schreiber (Main), Warteschlange wie bei Faktura, Schreiben nur über `host.vault.writeBytes` (Backup + Zwischendatei).

```
Haushalt/
  haushalt.json            Stammdaten: Einrichtung, Kontobezeichnung, Gliederung, QIF-Zuordnung, Vorjahreswerte
  2026/
    haushalt-2026.json     Jahr: Anfangsbestand, Ansätze, Änderungen, Buchungen, Protokoll, nächste Nummer, gesperrt
    Belege/
      2026 025 - Musterhosting GmbH.pdf
  Berichte/                erzeugte Excel/PDF/CSV mit Datum im Namen (Akte)
  Archiv-Quicken/          unveränderte Altdateien (QIF/QDF), vom Nutzer abgelegt
```

**Abweichung vom Gespräch:** Im Interview war „eine Datei je Buchung“ genannt — das war für mehrere Bucher gedacht. Bei einer Person ist eine Datei je Jahr einfacher, mit Faktura erprobt, und das Jahr bleibt als Ganzes lesbar. Belege bleiben einzelne PDFs.

Belege (F04): **eine** serialisierte Main-Action `belegAnhaengen` öffnet den OS-Dialog (`host.dialog.openFile`, Capability `dialog`), bekommt die Bytes, wählt den Namen (Belegnummer + Empfänger, bereinigt, nie überschreiben → ` (2)`), schreibt per `writeBytes` und verknüpft in derselben Warteschlange. Scheitert das Verknüpfen, bleibt ein PDF ohne Verweis liegen. Der Vault-Dienst kann keine Ordner auflisten, deshalb erkennt das Plugin solche Dateien nicht selbst; da Schreiben und Verknüpfen in derselben Warteschlange laufen, bleibt das Fenster klein. (Abweichung vom ursprünglichen Plan, siehe Status unten.) QIF und Excel kommen über denselben Dialog in Main. Berichte: in `Berichte/` im Vault und auf Wunsch zusätzlich „Speichern unter …“ (`host.dialog.saveFile`) (F11).

## 4. Datenmodell (Kern, `src/model.ts`, rein und getestet)

```ts
type Cent = number                     // ganzzahlig, roundCents wie Faktura
interface Stelle {
  id: string; nummer: string; kurz: string; name: string
  bereich: 'einnahme' | 'ausgabe'
  parentId?: string                    // Unterstelle → Hauptgruppe
  durchlaufend?: boolean
  inaktiv?: boolean                    // bleibt für alte Jahre sichtbar
}
interface Stammdaten {
  version: 1
  einrichtung: string; kontoBezeichnung: string   // z. B. „VS 0000“
  stellen: Stelle[]
  qifZuordnung: Record<string, string>            // Quicken-Kategoriepfad → Stelle.id
  vorjahre: Record<string /*Jahr*/, Record<string /*Stelle.id*/, { ansatz?: Cent; ist?: Cent; text?: string }>>
  vorjahrKontostand?: Record<string, { anfang?: Cent; ende?: Cent }>
}
interface Buchung {
  id: string; belegnr: string
  datum: string                         // ISO, Rechnungs-/Belegdatum
  stelleId: string; betrag: Cent        // immer > 0; Richtung aus Stelle.bereich
  empfaenger: string; zweck: string
  status: 'vorgemerkt' | 'angeordnet' | 'gebucht'
  angeordnetAm?: string
  beleg?: string                        // Vault-Pfad
  stornoVon?: string; storniertDurch?: string
  zurueckgezogen?: { am: string; grund: string }
  uebernommenAus?: { jahr: number; id: string }   // Vormerkung aus Vorjahr
  quelle: 'hand' | 'qif'
  qif?: { datei: string; satz: number; status: string; schluessel: string }  // Herkunft, F07/F08
}
/** Bestätigung durch den Kreis (F05). Etappe 1: genau eine je abgehakter Buchung; Etappe 2: n:m mit Teilbeträgen. */
interface KreisZuordnung {
  id: string
  teile: Array<{ buchungId: string; betrag: Cent }>
  datum: string                         // Buchungs-/Zahlungsdatum beim Kreis
  kreisStelle?: string                  // vierstellig, wie auf der Kreisliste
  kreisVorgang?: string                 // „Vorgang“-Spalte der Kreisliste (Monat)
  kreisText?: string                    // Empfänger/Zweck laut Kreis
  quelle: 'hand' | 'kreisliste'
}
// Status `gebucht` ⇔ Summe der Teile für die Buchung = Betrag (Etappe 1 immer vollständig).
interface Aenderung { id: string; datum: string; art: 'uebertrag'|'nachtrag'|'umschichtung'|'sperre'|'korrektur'; stelleId: string; betrag: Cent /*±*/; bemerkung: string; paarId?: string; ausAbschluss?: string }
interface Jahr {
  version: 1; jahr: number; gesperrt: boolean
  anfangsbestand: Cent
  ansatz: Record<string /*Hauptgruppe/bebuchbare Stelle*/, Cent>
  aenderungen: Aenderung[]; buchungen: Buchung[]
  kreis: KreisZuordnung[]
  naechsteNr: number
  abschluss?: { id: string; am: string; endstand: Cent }
  stellen?: Stelle[]                    // eingefrorene Gliederung, nur in gesperrten Jahren (F06)
  protokoll: Array<{ zeit: string; aktion: string; ref?: string; vorher?: unknown; nachher?: unknown; grund?: string }>
}
```

Ein Storno ist eine Buchung mit **negativem** Betrag? — Nein: Betrag bleibt > 0, `stornoVon` gesetzt, Rechnung zieht sie ab. (Klar trennbar in Listen und Export.)

## 5. Rechnen (`src/rechnen.ts`, rein und getestet)

- `wirksamerAnsatz(jahr, gruppe)`, `ist(jahr, stelle|gruppe, {durchlaufend})`, `vorgemerkt(...)`, `frei(...)`.
- `uebersicht(stamm, jahr)` → Zeilen in Gliederungsreihenfolge mit Ansatz, Änderungen, Ist, vorgemerkt, frei, Warnung; Summen Einnahmen/Ausgaben mit/ohne durchlaufend; Guthaben (unsere Sicht / Kreis-Sicht).
- `abschlussVorschlag(stamm, jahr)` → Endstand, Übertrag je Gruppe, offene Vormerkungen.
- Testfälle aus der Excel-Logik: `5220` Summe = `5a` + `5b` ohne `5c`; „Summe Ausgaben mit MS365“ enthält `5c`.

## 6. QIF-Import (`src/qif.ts`, rein und getestet)

Beobachtetes Format (deutsche Quicken-Altversion): Latin-1, CRLF, `!Option:MDY`, Datum `D5.20.26` = 20.05.2026, Beträge `T-1,234.56`, `N2026 003` = Belegnummer, `P` Empfänger, `M` Verwendungszweck, `L` Kategoriepfad mit `:`, `CX` = abgeglichen. Zusätzlich Abschnitte `!Type:Cat` (mit Budgetzeilen `B`), `!Type:Class`, `!Account`, `!Type:Memorized` — werden gelesen, aber nicht als Buchung übernommen.

- Parser: Abschnitte, Datensätze bis `^`, Splits (`S`/`E`/`$`) erkennen → als nicht unterstützt melden (im Beispiel keine), nicht still verlieren.
- Datum: Option MDY/DMY beachten; Formen `M.D.YY`, `M/D'YY`, `M/D/YYYY`. Unklare → Fehlerzeile.
- Betrag: `1,234.56` (MDY-Datei) — Tausender-Komma; Vorzeichen bestimmt Richtung und muss zum Bereich der zugeordneten Stelle passen, sonst Warnung.
- Vorschau vor dem Schreiben: Anzahl, Summe je Kategorie, Summe gesamt = Summe der `T`-Zeilen (Selbstkontrolle).
- Duplikate (F07): Schlüssel = Konto + Datum + Betrag + Nummer + Empfänger. Gleicher Schlüssel schon im Jahr → übersprungen und gezeigt (Wiederimport). Nur gleiche **Nummer** bei anderem Inhalt → Konflikt, den der Nutzer entscheidet (übernehmen mit neuer Nummer / auslassen); nie still.
- Zuordnung Kategoriepfad → Stelle: einmal festlegen, in `qifZuordnung` gespeichert; Vorschlag über die vierstellige Nummer im Pfad (`…:5220 Medien:Software` → Unterstelle `5b`, wenn Name passt). Nichts wird ohne Zuordnung importiert.
- Status (F08, vom Nutzer geklärt): Quicken-„X“ heißt beim Nutzer nur „in Quicken erfasst“, **nicht** „vom Kreis gebucht“. Alle importierten Buchungen werden `angeordnet`; das Quicken-Zeichen bleibt in `qif.status`. `naechsteNr` = max(importierte Nummer)+1.

## 7. Erstimport aus der Steuerungsgruppen-Excel (`src/xlsx.ts`)

Reines JS (kein Node-Built-in): `fflate` (≥ 0.8.3, ältere hängen bei kaputtem ZIP64) zum Entpacken; Blatt über `workbook.xml` + Relations finden, nicht `sheet1.xml` annehmen; Zellen `s` (Shared String), `inlineStr`, `str`, `n` (F10). Zahlen sind **Euro** und werden exakt auf Cent umgerechnet; mehr als zwei Nachkommastellen nach Rundung auf 1e-6 → gemeldet (F09). Grenzen gegen präparierte Dateien: Größe der entpackten Teile begrenzt. Erkennt:
- Gliederung aus Spalten A (Nummer), B (Kurz), C (Name); Abschnitte „Einnahmen“/„Ausgaben“; Kurz als Ganzzahl = Hauptgruppe, Kurz mit Buchstabe = Unterstelle der vorangehenden Hauptgruppe; Summenzeilen („Summe …“, „Saldo …“, „Kontostand …“) werden übersprungen.
- Kopfzeile „Ansatz JJJJ“ / „Ist JJJJ“ → `vorjahre`; Formeln werden **nicht** ausgewertet: Zellen mit Formel ohne zwischengespeicherten Wert bleiben leer und werden gemeldet; Text in Zahlenzellen (`167.82,85`) wird gemeldet, nicht geraten.
- Ansatz des laufenden Jahres → `Jahr.ansatz`.
- Ergebnis immer als Vorschau; Nutzer markiert durchlaufende Stellen und bestätigt.

## 8. Bericht für die Steuerungsgruppe

- **Excel** im Layout der Vorlage: Spalten A–C Gliederung, dann je Jahr „Ansatz JJJJ“ / „Ist JJJJ“, zuletzt „Ansatz Folgejahr“; Zeilen Kontostand 1.1., Einnahmen, Summe Einnahmen, Ausgaben, Summe Ausgaben mit/ohne durchlaufend, Saldo, Kontostand 31.12. Werte als Zahlen, Summen als **Formeln**. Jahre: Standard alle vorhandenen, Zeitraum wählbar. Selbst geschriebenes SpreadsheetML (fflate zum Packen).
- **PDF** derselben Tabelle über `host.pdf.htmlToPdf`, mit Stand-Datum.
- Weitere Ausgaben Etappe 1: Kontoblatt je Stelle, offene Posten gegenüber dem Kreis, Abschlussblatt, Buchungsliste als CSV (Semikolon, deutsches Zahlenformat, UTF-8 mit BOM).

## 9. Main-Actions (alle mit `folder`, serialisiert)

`load` · `saveStammdaten` · `ensureJahr` · `upsertBuchung` · `deleteVormerkung` · `storno` · `setStatus` (einzeln/mehrere) · `linkBeleg` · `belegPfad` (Vorschlag) · `addAenderung` (Umschichtung erzeugt Paar) · `setAnsatz` · `qifPreview` / `qifImport` · `xlsxPreview` / `xlsxImport` · `abschlussVorschlag` / `abschliessen` · `entsperren` · `exportXlsx` · `exportPdf` · `exportCsv`.

Capabilities: `vault.read`, `vault.write`, `pdf.render`, `dialog`. **Kein** `llm.generate`, **kein** `http.fetch` in Etappe 1. `privacy.containsPersonalData: true`, `localOnly: true`.

## 10. Oberfläche (ein Arbeitsbereich-Tab „Haushalt“)

Jahr-Auswahl oben. Reiter:
1. **Übersicht** — Tabelle je Stelle (Ansatz, Änderungen, Ist, vorgemerkt, frei, Balken), Summen, Guthaben-Karte.
2. **Buchungen** — Liste mit Filter (Stelle, Status, Text, Betrag), Neu/Bearbeiten-Formular mit Beleg-Ablage, Storno, Mehrfach-Abhaken.
3. **Abgleich** — offene Posten, Abhaken mit Datum, Summe „noch nicht beim Kreis“.
4. **Ansatz** — Ansätze und Änderungen je Gruppe.
5. **Abschluss** — Vorschlag, Bestätigen, Sperren.
6. **Berichte** — Excel/PDF/CSV.
7. **Einrichtung** — Ordner, Kontobezeichnung, Gliederung (bearbeiten, durchlaufend markieren), Importe (Excel, QIF), Protokoll.

## 11. Tests und Testdaten

- Echte Dateien des Nutzers bleiben außerhalb des Repos (`private/` steht in `.gitignore`).
- `test-fixtures/` enthält **erfundene** Daten im echten Format: QIF mit 6 Buchungen (Latin-1, MDY, Tausender-Komma, `CX`/ohne C, eine Einnahme, ein Split zum Ablehnen), kleine xlsx im Layout der Vorlage (per Testhelfer erzeugt).
- Pflichttests: Datum `D1.13.26` → 2026-01-13; `T-34,736.00` → −3 473 600 Cent; Gruppensumme ohne durchlaufend; frei = Ansatz + Änderungen − Ist − vorgemerkt; Umschichtung erzeugt Paar mit Summe 0; Belegnummer nach Import; Abschlussvorschlag; kein Löschen angeordneter Buchungen; Protokolleintrag bei Änderung.

## 12. Offene Fragen an den Prüfer

- Ist eine Datei je Jahr robust genug (Größe ~ einige hundert Buchungen/Jahr)?
- Fehlt im Modell etwas, das der Abgleich-Assistent (Etappe 2: Kreis-PDF, 1:n-Zuordnung, andere Stelle) später braucht?
- Lücken bei QIF-Varianten oder der xlsx-Auswertung?
- Wo kann der Jahresabschluss Geld „verlieren“ oder doppelt zählen?
