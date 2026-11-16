// Zustandsübergänge. Rein: jede Funktion bekommt den alten Stand und gibt einen neuen zurück oder wirft
// mit einer Meldung, die man im Formular versteht. Main ruft genau einen Übergang je Action auf.
// Regeln: docs/bauplan.md, Abschnitt 2 (Regel 9–11).

import type { Cent } from './geld'
import {
  type Aenderung, type AenderungsArt, type Buchung, type Jahr, type KreisZuordnung, type ProtokollEintrag, type Stammdaten, type Stelle,
  bebuchbar, belegLaufnummer, belegNr, bestaetigt, leeresJahr, pruefeGliederung, qifSchluessel, stellenFuer, zaehltZumIst,
} from './model'
import type { QifBuchung } from './qif'
import { abschlussVorschlag } from './rechnen'

export interface Ctx {
  /** ISO-Zeitstempel, von außen gesetzt (testbar). */
  jetzt: string
  neueId: () => string
}

const heute = (ctx: Ctx) => ctx.jetzt.slice(0, 10)

function log(j: Jahr, ctx: Ctx, e: Omit<ProtokollEintrag, 'zeit'>): Jahr {
  return { ...j, protokoll: [...j.protokoll, { zeit: ctx.jetzt, ...e }] }
}

function offen(j: Jahr, was: string): void {
  if (j.gesperrt) throw new Error(`${j.jahr} ist abgeschlossen — ${was} ist nicht mehr möglich. Entsperren nur mit Begründung (Einrichtung).`)
}

function istDatum(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
}

function pruefeBetrag(betrag: unknown): Cent {
  if (typeof betrag !== 'number' || !Number.isSafeInteger(betrag) || betrag <= 0) throw new Error('Der Betrag muss größer als 0 sein.')
  return betrag
}

function stelleOderFehler(stellen: Stelle[], id: string): Stelle {
  const s = stellen.find(x => x.id === id)
  if (!s) throw new Error('Bitte eine Haushaltsstelle wählen.')
  if (!bebuchbar(stellen, s)) throw new Error(`Auf „${s.name}“ wird nicht direkt gebucht — bitte eine Unterstelle wählen.`)
  if (s.inaktiv) throw new Error(`„${s.name}“ ist stillgelegt.`)
  return s
}

// ─── Stammdaten ──────────────────────────────────────────────────────────────

export function saveStamm(stamm: Stammdaten, neu: Stammdaten, jahre: Jahr[]): Stammdaten {
  const fehler = pruefeGliederung(neu.stellen)
  if (fehler.length) throw new Error(fehler.join('\n'))
  // Stellen mit Buchungen in offenen Jahren dürfen nicht verschwinden (F06: alte Jahre sind eingefroren).
  const ids = new Set(neu.stellen.map(s => s.id))
  for (const j of jahre) {
    if (j.stellen) continue
    const fehlt = j.buchungen.find(b => !ids.has(b.stelleId))
    if (fehlt) throw new Error(`Die Stelle von Buchung ${fehlt.belegnr} (${j.jahr}) fehlt in der neuen Gliederung. Stellen mit Buchungen bitte stilllegen statt löschen.`)
  }
  // Finanzwirksame Merkmale nicht ändern, solange offene Jahre darauf buchen.
  for (const alt of stamm.stellen) {
    const n = neu.stellen.find(s => s.id === alt.id)
    if (!n) continue
    const geaendert = n.bereich !== alt.bereich || (n.parentId ?? '') !== (alt.parentId ?? '') || !!n.durchlaufend !== !!alt.durchlaufend
    if (!geaendert) continue
    const betroffen = jahre.find(j => !j.stellen && j.buchungen.some(b => b.stelleId === alt.id))
    if (betroffen) {
      throw new Error(`„${alt.name}“ hat Buchungen in ${betroffen.jahr}. Bereich, Hauptgruppe und „durchlaufend“ lassen sich dann nicht mehr ändern — sonst ändern sich die Summen rückwirkend. Neue Stelle anlegen und die alte stilllegen.`)
    }
  }
  return { ...neu, version: stamm.version }
}

// ─── Buchungen ───────────────────────────────────────────────────────────────

export interface BuchungEingabe {
  id?: string
  datum: string
  stelleId: string
  betrag: Cent
  empfaenger: string
  zweck: string
  status: 'vorgemerkt' | 'angeordnet'
}

const FELDER: Array<keyof BuchungEingabe> = ['datum', 'stelleId', 'betrag', 'empfaenger', 'zweck', 'status']

export function upsertBuchung(stamm: Stammdaten, j: Jahr, e: BuchungEingabe, ctx: Ctx): { jahr: Jahr; id: string } {
  offen(j, 'Buchen')
  const stellen = stellenFuer(stamm, j)
  if (!istDatum(e.datum)) throw new Error('Bitte ein gültiges Datum angeben.')
  if (Number(e.datum.slice(0, 4)) !== j.jahr) throw new Error(`Das Datum liegt nicht im Haushaltsjahr ${j.jahr}.`)
  stelleOderFehler(stellen, e.stelleId)
  const betrag = pruefeBetrag(e.betrag)
  const status = e.status === 'vorgemerkt' ? 'vorgemerkt' : 'angeordnet'
  const empfaenger = String(e.empfaenger ?? '').trim()
  if (!empfaenger) throw new Error('Bitte Empfänger bzw. Einzahler angeben.')

  if (!e.id) {
    const id = ctx.neueId()
    const b: Buchung = {
      id, belegnr: belegNr(j.jahr, j.naechsteNr), datum: e.datum, stelleId: e.stelleId, betrag, empfaenger, zweck: String(e.zweck ?? '').trim(), status,
      ...(status === 'angeordnet' ? { angeordnetAm: heute(ctx) } : {}), quelle: 'hand',
    }
    return { jahr: log({ ...j, buchungen: [...j.buchungen, b], naechsteNr: j.naechsteNr + 1 }, ctx, { aktion: 'buchung.neu', ref: b.belegnr, nachher: b }), id }
  }

  const alt = j.buchungen.find(b => b.id === e.id)
  if (!alt) throw new Error('Buchung nicht gefunden.')
  if (alt.zurueckgezogen) throw new Error('Zurückgezogene Buchungen lassen sich nicht mehr ändern.')
  if (alt.stornoVon || alt.storniertDurch) throw new Error('Stornierte Buchungen und Gegenbuchungen lassen sich nicht ändern.')
  if (alt.status === 'angeordnet' && status === 'vorgemerkt') throw new Error('Eine angeordnete Buchung kann nicht zurück zur Vormerkung werden — bitte zurückziehen.')
  if (bestaetigt(j, alt.id) > 0 && (betrag !== alt.betrag || e.stelleId !== alt.stelleId)) {
    throw new Error('Diese Buchung ist schon vom Kreis bestätigt. Betrag und Stelle ändern geht nur über Storno und neue Buchung.')
  }
  const neu: Buchung = {
    ...alt, datum: e.datum, stelleId: e.stelleId, betrag, empfaenger, zweck: String(e.zweck ?? '').trim(), status,
    ...(alt.status === 'vorgemerkt' && status === 'angeordnet' ? { angeordnetAm: heute(ctx) } : {}),
  }
  const vorher: Record<string, unknown> = {}
  const nachher: Record<string, unknown> = {}
  for (const k of FELDER) {
    const a = (alt as unknown as Record<string, unknown>)[k]
    const n = (neu as unknown as Record<string, unknown>)[k]
    if (a !== n) {
      vorher[k] = a
      nachher[k] = n
    }
  }
  if (Object.keys(nachher).length === 0) return { jahr: j, id: alt.id }
  const jahr = { ...j, buchungen: j.buchungen.map(b => (b.id === alt.id ? neu : b)) }
  return { jahr: log(jahr, ctx, { aktion: 'buchung.aendern', ref: alt.belegnr, vorher, nachher }), id: alt.id }
}

/** Vormerkungen dürfen gelöscht werden; die Nummer wird nicht wiederverwendet. */
export function loescheVormerkung(j: Jahr, id: string, ctx: Ctx): Jahr {
  offen(j, 'Löschen')
  const b = j.buchungen.find(x => x.id === id)
  if (!b) throw new Error('Buchung nicht gefunden.')
  if (b.status !== 'vorgemerkt') throw new Error('Nur Vormerkungen lassen sich löschen. Angeordnete Buchungen bitte zurückziehen oder stornieren.')
  if (b.beleg) throw new Error('Diese Vormerkung hat einen Beleg. Bitte erst den Beleg lösen oder sie zurückziehen.')
  return log({ ...j, buchungen: j.buchungen.filter(x => x.id !== id) }, ctx, { aktion: 'vormerkung.loeschen', ref: b.belegnr, vorher: b })
}

/** Rücknahme: noch nicht vom Kreis bestätigt → zählt nicht mehr, keine Gegenbuchung (F03). */
export function zurueckziehen(j: Jahr, id: string, grund: string, ctx: Ctx): Jahr {
  offen(j, 'Zurückziehen')
  const b = j.buchungen.find(x => x.id === id)
  if (!b) throw new Error('Buchung nicht gefunden.')
  if (b.zurueckgezogen) return j
  if (bestaetigt(j, id) > 0) throw new Error('Der Kreis hat diese Buchung schon (teilweise) gebucht. Bitte stornieren — die Gegenbuchung wird dann ebenfalls abgeglichen.')
  if (b.stornoVon || b.storniertDurch) throw new Error('Storno-Buchungen lassen sich nicht zurückziehen.')
  if (!grund.trim()) throw new Error('Bitte einen Grund angeben.')
  const z = { am: heute(ctx), grund: grund.trim() }
  return log({ ...j, buchungen: j.buchungen.map(x => (x.id === id ? { ...x, zurueckgezogen: z } : x)) }, ctx, { aktion: 'buchung.zurueckziehen', ref: b.belegnr, grund: z.grund })
}

/** Storno einer vom Kreis gebuchten Buchung: Gegenbuchung mit eigener Nummer, Status angeordnet (F03). */
export function stornieren(j: Jahr, id: string, grund: string, datum: string, ctx: Ctx): { jahr: Jahr; id: string } {
  offen(j, 'Stornieren')
  const b = j.buchungen.find(x => x.id === id)
  if (!b) throw new Error('Buchung nicht gefunden.')
  if (b.storniertDurch) throw new Error('Diese Buchung ist bereits storniert.')
  if (b.stornoVon) throw new Error('Eine Gegenbuchung lässt sich nicht stornieren.')
  if (!zaehltZumIst(b)) throw new Error('Nur angeordnete Buchungen lassen sich stornieren.')
  if (bestaetigt(j, id) === 0) throw new Error('Der Kreis hat diese Buchung noch nicht gebucht — bitte zurückziehen statt stornieren.')
  if (!grund.trim()) throw new Error('Bitte einen Grund angeben.')
  if (!istDatum(datum) || Number(datum.slice(0, 4)) !== j.jahr) throw new Error(`Das Storno-Datum muss im Jahr ${j.jahr} liegen.`)
  const gid = ctx.neueId()
  const g: Buchung = {
    id: gid, belegnr: belegNr(j.jahr, j.naechsteNr), datum, stelleId: b.stelleId, betrag: b.betrag, empfaenger: b.empfaenger,
    zweck: `Storno ${b.belegnr}: ${grund.trim()}`, status: 'angeordnet', angeordnetAm: heute(ctx), stornoVon: b.id, quelle: 'hand',
  }
  const jahr = { ...j, naechsteNr: j.naechsteNr + 1, buchungen: [...j.buchungen.map(x => (x.id === id ? { ...x, storniertDurch: gid } : x)), g] }
  return { jahr: log(jahr, ctx, { aktion: 'buchung.storno', ref: b.belegnr, nachher: g.belegnr, grund: grund.trim() }), id: gid }
}

export function anordnen(j: Jahr, ids: string[], ctx: Ctx): Jahr {
  offen(j, 'Anordnen')
  const set = new Set(ids)
  let n = 0
  const buchungen = j.buchungen.map(b => {
    if (!set.has(b.id) || b.status !== 'vorgemerkt' || b.zurueckgezogen) return b
    n++
    return { ...b, status: 'angeordnet' as const, angeordnetAm: heute(ctx) }
  })
  if (!n) return j
  return log({ ...j, buchungen }, ctx, { aktion: 'anordnen', ref: ids.join(','), nachher: n })
}

// ─── Abgleich mit dem Kreis ──────────────────────────────────────────────────

export interface Abhaken {
  buchungIds: string[]
  datum: string
  kreisStelle?: string
  kreisVorgang?: string
}

/**
 * Etappe 1: je Buchung eine vollständige Zuordnung über den Restbetrag. Erlaubt auch im gesperrten
 * Jahr (F02) — es ändert nur die Bestätigung, nie Beträge oder Stellen.
 */
export function abhaken(j: Jahr, a: Abhaken, ctx: Ctx): Jahr {
  if (!istDatum(a.datum)) throw new Error('Bitte das Buchungsdatum des Kreises angeben.')
  const neue: KreisZuordnung[] = []
  for (const id of a.buchungIds) {
    const b = j.buchungen.find(x => x.id === id)
    if (!b) throw new Error('Buchung nicht gefunden.')
    if (!zaehltZumIst(b)) throw new Error(`${b.belegnr} ist nicht angeordnet und kann nicht abgehakt werden.`)
    const rest = b.betrag - bestaetigt(j, id)
    if (rest <= 0) continue
    neue.push({
      id: ctx.neueId(), teile: [{ buchungId: id, betrag: rest }], datum: a.datum, quelle: 'hand',
      ...(a.kreisStelle?.trim() ? { kreisStelle: a.kreisStelle.trim() } : {}),
      ...(a.kreisVorgang?.trim() ? { kreisVorgang: a.kreisVorgang.trim() } : {}),
    })
  }
  if (!neue.length) return j
  return log({ ...j, kreis: [...j.kreis, ...neue] }, ctx, { aktion: j.gesperrt ? 'abhaken.nachAbschluss' : 'abhaken', ref: neue.map(z => z.teile[0].buchungId).join(','), nachher: neue })
}

/** Haken entfernen (Irrtum). Ebenfalls im gesperrten Jahr erlaubt, protokolliert. */
export function abhakenAufheben(j: Jahr, buchungId: string, ctx: Ctx): Jahr {
  const betroffen = j.kreis.filter(z => z.teile.some(t => t.buchungId === buchungId))
  if (!betroffen.length) return j
  if (betroffen.some(z => z.teile.length > 1)) throw new Error('Diese Bestätigung betrifft mehrere Buchungen und lässt sich hier nicht einzeln lösen.')
  const ids = new Set(betroffen.map(z => z.id))
  return log({ ...j, kreis: j.kreis.filter(z => !ids.has(z.id)) }, ctx, { aktion: 'abhaken.aufheben', ref: buchungId, vorher: betroffen })
}

// ─── Beleg ───────────────────────────────────────────────────────────────────

export function belegVerknuepfen(j: Jahr, id: string, pfad: string, ctx: Ctx): Jahr {
  const b = j.buchungen.find(x => x.id === id)
  if (!b) throw new Error('Buchung nicht gefunden.')
  if (j.gesperrt) offen(j, 'Belege ändern')
  return log({ ...j, buchungen: j.buchungen.map(x => (x.id === id ? { ...x, beleg: pfad } : x)) }, ctx, { aktion: 'beleg', ref: b.belegnr, vorher: b.beleg ?? null, nachher: pfad })
}

// ─── Ansatz ──────────────────────────────────────────────────────────────────

export function setAnsatz(j: Jahr, stelleId: string, betrag: Cent, ctx: Ctx): Jahr {
  offen(j, 'Den Ansatz ändern')
  if (!Number.isSafeInteger(betrag) || betrag < 0) throw new Error('Der Ansatz muss 0 oder größer sein.')
  const vorher = j.ansatz[stelleId] ?? 0
  if (vorher === betrag) return j
  const ansatz = { ...j.ansatz }
  if (betrag === 0) delete ansatz[stelleId]
  else ansatz[stelleId] = betrag
  return log({ ...j, ansatz }, ctx, { aktion: 'ansatz', ref: stelleId, vorher, nachher: betrag })
}

export interface AenderungEingabe {
  datum: string
  art: AenderungsArt
  stelleId: string
  /** Für Umschichtung: Zielstelle; Betrag positiv = von stelleId nach zielId. */
  zielId?: string
  betrag: Cent
  bemerkung: string
}

export function addAenderung(stamm: Stammdaten, j: Jahr, e: AenderungEingabe, ctx: Ctx): Jahr {
  offen(j, 'Eine Ansatzänderung')
  const stellen = stellenFuer(stamm, j)
  if (!istDatum(e.datum)) throw new Error('Bitte ein gültiges Datum angeben.')
  if (!stellen.some(s => s.id === e.stelleId)) throw new Error('Bitte eine Haushaltsstelle wählen.')
  if (!Number.isSafeInteger(e.betrag) || e.betrag === 0) throw new Error('Bitte einen Betrag angeben.')
  const bemerkung = String(e.bemerkung ?? '').trim()
  if (!bemerkung) throw new Error('Bitte eine Bemerkung angeben (z. B. Mail der Kämmerei vom …).')
  let neu: Aenderung[]
  if (e.art === 'umschichtung') {
    if (!e.zielId || e.zielId === e.stelleId || !stellen.some(s => s.id === e.zielId)) throw new Error('Bitte eine andere Zielstelle wählen.')
    const betrag = Math.abs(e.betrag)
    const a = ctx.neueId()
    const b = ctx.neueId()
    neu = [
      { id: a, datum: e.datum, art: 'umschichtung', stelleId: e.stelleId, betrag: -betrag, bemerkung, paarId: b },
      { id: b, datum: e.datum, art: 'umschichtung', stelleId: e.zielId, betrag, bemerkung, paarId: a },
    ]
  } else {
    const betrag = e.art === 'sperre' ? -Math.abs(e.betrag) : e.art === 'korrektur' ? e.betrag : Math.abs(e.betrag)
    neu = [{ id: ctx.neueId(), datum: e.datum, art: e.art, stelleId: e.stelleId, betrag, bemerkung }]
  }
  return log({ ...j, aenderungen: [...j.aenderungen, ...neu] }, ctx, { aktion: 'aenderung', ref: e.art, nachher: neu })
}

/** Entfernt eine Änderung (bei Umschichtung beide Hälften). */
export function entferneAenderung(j: Jahr, id: string, ctx: Ctx): Jahr {
  offen(j, 'Eine Ansatzänderung entfernen')
  const a = j.aenderungen.find(x => x.id === id)
  if (!a) throw new Error('Änderung nicht gefunden.')
  const weg = new Set([a.id, ...(a.paarId ? [a.paarId] : [])])
  return log({ ...j, aenderungen: j.aenderungen.filter(x => !weg.has(x.id)) }, ctx, { aktion: 'aenderung.entfernen', ref: a.art, vorher: j.aenderungen.filter(x => weg.has(x.id)) })
}

export function setAnfangsbestand(j: Jahr, betrag: Cent, ctx: Ctx): Jahr {
  offen(j, 'Den Anfangsbestand ändern')
  if (!Number.isSafeInteger(betrag)) throw new Error('Ungültiger Betrag.')
  if (j.anfangsbestand === betrag) return j
  return log({ ...j, anfangsbestand: betrag }, ctx, { aktion: 'anfangsbestand', vorher: j.anfangsbestand, nachher: betrag })
}

// ─── QIF-Import ──────────────────────────────────────────────────────────────

export interface QifPlanZeile {
  q: QifBuchung
  stelleId: string | null
  aktion: 'neu' | 'doppelt' | 'konflikt' | 'ohneZuordnung' | 'falschesJahr' | 'richtungPasstNicht'
  hinweis?: string
  schluessel: string
}

/** Vorschau: was würde der Import tun? Schreibt nichts. */
export function qifPlan(stamm: Stammdaten, j: Jahr, konto: string, buchungen: QifBuchung[], zuordnung: Record<string, string>): QifPlanZeile[] {
  const stellen = stellenFuer(stamm, j)
  const vorhandeneSchluessel = new Set(j.buchungen.map(b => b.qif?.schluessel).filter(Boolean))
  const vorhandeneNummern = new Set(j.buchungen.map(b => b.belegnr))
  const imPlan = new Set<string>()
  return buchungen.map(q => {
    const schluessel = qifSchluessel(konto, q.datum, q.betrag, q.nummer, q.empfaenger)
    const stelleId = zuordnung[q.kategorie] ?? null
    const s = stelleId ? stellen.find(x => x.id === stelleId) : undefined
    const z = (aktion: QifPlanZeile['aktion'], hinweis?: string): QifPlanZeile => ({ q, stelleId: s ? s.id : null, aktion, hinweis, schluessel })
    if (Number(q.datum.slice(0, 4)) !== j.jahr) return z('falschesJahr', `Datum ${q.datum} liegt nicht in ${j.jahr}`)
    if (vorhandeneSchluessel.has(schluessel) || imPlan.has(schluessel)) return z('doppelt', 'bereits übernommen')
    if (!s || !bebuchbar(stellen, s)) return z('ohneZuordnung', `Kategorie „${q.kategorie || '(leer)'}“ ist keiner bebuchbaren Stelle zugeordnet`)
    const richtig = (s.bereich === 'einnahme') === (q.betrag > 0)
    if (!richtig || q.betrag === 0) return z('richtungPasstNicht', `${q.betrag > 0 ? 'Einnahme' : 'Ausgabe'} auf ${s.bereich === 'einnahme' ? 'Einnahme' : 'Ausgaben'}stelle „${s.name}“`)
    if (q.nummer && vorhandeneNummern.has(q.nummer)) return z('konflikt', `Belegnummer ${q.nummer} ist schon vergeben (andere Buchung)`)
    imPlan.add(schluessel)
    if (q.nummer) vorhandeneNummern.add(q.nummer)
    return z('neu')
  })
}

export interface QifEntscheidung {
  /** Konflikte, die mit neuer Nummer übernommen werden sollen (Satznummern). */
  konfliktNeueNummer: number[]
}

/** Übernimmt alle `neu`-Zeilen plus ausdrücklich freigegebene Konflikte. Status immer `angeordnet` (F08). */
export function qifUebernehmen(j: Jahr, datei: string, plan: QifPlanZeile[], ent: QifEntscheidung, ctx: Ctx): { jahr: Jahr; anzahl: number; summe: Cent } {
  offen(j, 'Importieren')
  const freigabe = new Set(ent.konfliktNeueNummer)
  let naechsteNr = j.naechsteNr
  const neu: Buchung[] = []
  let summe = 0
  // Höchste übernommene Laufnummer bestimmt, wo es weitergeht.
  for (const z of plan) {
    if (z.aktion !== 'neu') continue
    const lauf = belegLaufnummer(z.q.nummer, j.jahr)
    if (lauf !== null && lauf >= naechsteNr) naechsteNr = lauf + 1
  }
  for (const z of plan) {
    const mitNeuerNummer = z.aktion === 'konflikt' && freigabe.has(z.q.satz)
    if (z.aktion !== 'neu' && !mitNeuerNummer) continue
    let belegnr = z.q.nummer
    if (mitNeuerNummer || !belegnr) belegnr = belegNr(j.jahr, naechsteNr++)
    neu.push({
      id: ctx.neueId(), belegnr, datum: z.q.datum, stelleId: z.stelleId!, betrag: Math.abs(z.q.betrag), empfaenger: z.q.empfaenger || '(ohne Empfänger)',
      zweck: z.q.zweck, status: 'angeordnet', angeordnetAm: z.q.datum, quelle: 'qif',
      qif: { datei, satz: z.q.satz, status: z.q.status, schluessel: z.schluessel },
    })
    summe += z.q.betrag
  }
  if (!neu.length) return { jahr: j, anzahl: 0, summe: 0 }
  const jahr = { ...j, naechsteNr, buchungen: [...j.buchungen, ...neu] }
  return { jahr: log(jahr, ctx, { aktion: 'qif.import', ref: datei, nachher: { anzahl: neu.length, summe } }), anzahl: neu.length, summe }
}

// ─── Jahresabschluss (F01, F02, F06) ─────────────────────────────────────────

export interface AbschlussEingabe {
  /** Bestätigte Überträge (Betrag änderbar, 0 = keiner). */
  uebertraege: Array<{ stelleId: string; betrag: Cent }>
  /** Vormerkungen, die ins Folgejahr wandern; alle anderen offenen Vormerkungen werden zurückgezogen. */
  vormerkungenUebernehmen: string[]
}

export interface AbschlussErgebnis {
  alt: Jahr
  folge: Jahr
  abschlussId: string
}

/**
 * Rechnet beide Jahresdateien. Main schreibt ZUERST `folge`, DANN `alt` (Sperre). Läuft der Abschluss
 * erneut (nach Entsperren oder Absturz), werden frühere Abschlusseinträge im Folgejahr ersetzt, nicht verdoppelt.
 */
export function abschliessen(stamm: Stammdaten, alt: Jahr, folgeVorher: Jahr | null, e: AbschlussEingabe, ctx: Ctx): AbschlussErgebnis {
  const v = abschlussVorschlag(stamm, alt)
  if (v.hindernisse.length) throw new Error(v.hindernisse.join('\n'))
  const abschlussId = ctx.neueId()
  const fj = alt.jahr + 1
  let folge = folgeVorher ?? leeresJahr(fj)
  if (folge.gesperrt) throw new Error(`${fj} ist bereits abgeschlossen — ${alt.jahr} kann nicht erneut abgeschlossen werden.`)

  // Frühere Abschlusseinträge entfernen (Idempotenz).
  const frueher = new Set(folge.aenderungen.filter(a => a.ausAbschluss).map(a => a.ausAbschluss!))
  folge = {
    ...folge,
    aenderungen: folge.aenderungen.filter(a => !a.ausAbschluss),
    buchungen: folge.buchungen.filter(b => !(b.uebernommenAus && b.uebernommenAus.jahr === alt.jahr && b.status === 'vorgemerkt' && !b.beleg)),
  }

  const datum = `${fj}-01-01`
  const uebertraege: Aenderung[] = e.uebertraege
    .filter(u => Number.isSafeInteger(u.betrag) && u.betrag > 0)
    .map(u => ({ id: ctx.neueId(), datum, art: 'uebertrag' as const, stelleId: u.stelleId, betrag: u.betrag, bemerkung: `Rest aus ${alt.jahr}`, ausAbschluss: abschlussId }))

  const uebernehmen = new Set(e.vormerkungenUebernehmen)
  const schonDa = new Set(folge.buchungen.map(b => b.uebernommenAus?.id).filter(Boolean))
  let nr = folge.naechsteNr
  const wandern: Buchung[] = []
  for (const b of v.offeneVormerkungen) {
    if (!uebernehmen.has(b.id) || schonDa.has(b.id)) continue
    wandern.push({ ...b, id: ctx.neueId(), belegnr: belegNr(fj, nr++), datum: b.datum < datum ? datum : b.datum, uebernommenAus: { jahr: alt.jahr, id: b.id } })
  }

  folge = log(
    { ...folge, anfangsbestand: v.endstand, aenderungen: [...folge.aenderungen, ...uebertraege], buchungen: [...folge.buchungen, ...wandern], naechsteNr: nr },
    ctx,
    { aktion: 'abschluss.uebernahme', ref: abschlussId, nachher: { ausJahr: alt.jahr, anfangsbestand: v.endstand, uebertraege: uebertraege.length, vormerkungen: wandern.length, ersetzt: [...frueher] } },
  )

  // Altes Jahr: nicht übernommene Vormerkungen zurückziehen, Gliederung einfrieren, sperren.
  const buchungen = alt.buchungen.map(b =>
    b.status === 'vorgemerkt' && !b.zurueckgezogen && !uebernehmen.has(b.id)
      ? { ...b, zurueckgezogen: { am: heute(ctx), grund: 'Jahresabschluss: nicht übernommen' } }
      : b,
  )
  const gesperrt = log(
    { ...alt, buchungen, gesperrt: true, stellen: stellenFuer(stamm, alt), abschluss: { id: abschlussId, am: ctx.jetzt, endstand: v.endstand } },
    ctx,
    { aktion: 'abschluss', ref: abschlussId, nachher: { endstand: v.endstand, offeneAnordnungen: v.offeneAnordnungen.length } },
  )
  return { alt: gesperrt, folge, abschlussId }
}

export function entsperren(j: Jahr, grund: string, ctx: Ctx): Jahr {
  if (!j.gesperrt) return j
  if (!grund.trim()) throw new Error('Bitte einen Grund angeben.')
  const { stellen: _eingefroren, ...rest } = j
  void _eingefroren
  return log({ ...rest, gesperrt: false }, ctx, { aktion: 'entsperren', grund: grund.trim(), vorher: j.abschluss })
}

/** Folgejahr existiert mit Abschlussübernahme, aber das Vorjahr ist nicht gesperrt → unvollständiger Abschluss (F01). */
export function abschlussUnvollstaendig(alt: Jahr, folge: Jahr | null): boolean {
  if (!folge || alt.gesperrt) return false
  return folge.aenderungen.some(a => a.ausAbschluss) || folge.protokoll.some(p => p.aktion === 'abschluss.uebernahme' && (p.nachher as { ausJahr?: number })?.ausJahr === alt.jahr)
}
