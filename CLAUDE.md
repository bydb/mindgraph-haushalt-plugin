# Haushalt — Nebenbuch-Plugin für MindGraph Notes

Externes, signiertes Plugin (ID `mindgraph-haushalt`). Ersetzt eine alte Quicken-Version in einer Einrichtung, deren Träger (Kreis) offiziell bucht und zahlt. Fachregeln und Entscheidungen: `docs/bauplan.md` (Quelle). Host-Vertrag: schmale Kopie in `src/host.ts` (Plugin-API ≥0.2.3, Quelle `bydb/mindgraph-notes` → `app/packages/plugin-api`). Gerüst wie `mindgraph-faktura-plugin`.

## Aufbau
- Rein und getestet: `geld.ts` (Cent), `model.ts` (Typen, Normalisieren, Belegnummern), `rechnen.ts` (Übersicht, Guthaben, Abschlussvorschlag), `store.ts` (alle Zustandsübergänge), `qif.ts` (Quicken-Export), `xlsx.ts` (XLSX lesen/schreiben mit fflate), `vorlage.ts` (Steuerungsgruppen-Tabelle: Erstimport + Bericht), `ausgabe.ts` (PDF-HTML, CSV).
- `src/main/index.ts` ist der **einzige Schreiber**: lesen → genau ein Übergang aus `store.ts` → schreiben, alles in einer Warteschlange. Dateien vom Rechner nur über `host.dialog` (nie ein Pfad aus dem Renderer). Schreiben nur über `vault.writeBytes`.
- Ablage: `<Ordner>/haushalt.json` (Stammdaten, Gliederung, Vorjahre, QIF-Zuordnung, Jahresliste), `<Ordner>/<JJJJ>/haushalt-<JJJJ>.json`, Belege `<Ordner>/<JJJJ>/Belege/`, Berichte `<Ordner>/Berichte/`, QIF-Originale `<Ordner>/Archiv-Quicken/`.
- `fflate` ≥ 0.8.3 (ältere hängen bei kaputtem ZIP64). Im Main-Bundle per `alias` auf die Browser-Variante, die Node-Variante importiert `module`.

## Regeln, die nicht aufweichen
- Beträge in Cent, ganzzahlig. Gespeicherter Status nur `vorgemerkt`/`angeordnet`; „vom Kreis gebucht“ ist abgeleitet aus `kreis[]`-Zuordnungen (Etappe 2 nutzt sie für 1:n).
- Angeordnete Buchungen nie löschen: zurückziehen (nicht bestätigt) oder stornieren (bestätigt, Gegenbuchung). Jede Änderung ins Protokoll.
- Gesperrtes Jahr: keine Beträge/Stellen/Buchungen mehr — Abhaken bleibt erlaubt (Kreis bucht Dezember-Anordnungen im Januar).
- Abschluss: erst Folgejahr schreiben, dann sperren; Wiederholung ersetzt Einträge mit `ausAbschluss`, verdoppelt nie.
- QIF-Status „X“ heißt beim Nutzer nur „in Quicken erfasst“ → Import immer `angeordnet`.
- Öffentliches Repo: **keine echten Namen** (Einrichtungen, Personen, Lieferanten, Kontonummern) in Code, Tests, Doku. Echte Dateien nur in `private/` (gitignored); lokale Gegenproben dort mit `npx vitest run --config private/vitest.config.ts`.

## Prüfen
`npm test`, `npm run typecheck`, `npm run build`. In der App: Testprofil `~/dev/mindgraph-test`, nie der Produktiv-Vault.

## Zusammenarbeit
Codex prüft, Claude baut: `AGENTS.md`, Aufgaben unter `docs/codex-collab/`.
