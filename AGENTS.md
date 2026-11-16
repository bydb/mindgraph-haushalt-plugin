# AGENTS.md — Haushalt-Plugin (für Codex)

Orientierung: `CLAUDE.md` (sobald vorhanden) und `docs/bauplan.md` sind die Quelle. Schwesterprojekt mit gleichem Gerüst: `~/dev/mindgraph-faktura-plugin` (Host-Vertrag `src/host.ts`, Build `build.mjs`). Host-Seite: `~/dev/mindgraph-notes/app/packages/plugin-api/src/` und `~/dev/mindgraph-notes/.claude/rules/plugin-workspace-tabs.md`.

## Rollen
- Claude baut, Codex prüft. Koordination über `docs/codex-collab/<thema>.md` mit den Abschnitten **Aufgabe · Kontext/Anker · Codex-Findings · Claude-Antwort · Status**. Codex schreibt nur in „Codex-Findings“, nie in andere Abschnitte, nie in Code.
- Finding-Format: `### Fxx — Titel` · **Schwere** (hoch/mittel/niedrig) · Beleg (`datei:zeile` oder Abschnitt des Bauplans) · Vorschlag · `[OFFEN]`.
- Kein Code-Edit, kein Commit, kein Push durch Codex.

## Harte Leitplanken
- Öffentliches Repo: keine echten Namen von Einrichtungen, Personen, Lieferanten oder Beträge aus Echtdaten. Testdaten sind erfunden („Musterau“).
- Beträge in Cent, ganzzahlig.
- Kein Node-Built-in im Plugin-Bundle (Build prüft). Keine Cloud-KI.
