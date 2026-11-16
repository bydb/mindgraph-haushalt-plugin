import { describe, expect, it } from 'vitest'
import { type Jahr, type Stammdaten, type Stelle, leereStammdaten, leeresJahr, statusVon } from './model'
import type { QifBuchung } from './qif'
import { uebersicht } from './rechnen'
import * as st from './store'

const stellen: Stelle[] = [
  { id: 'e1', nummer: '4100', kurz: '1', name: 'Zuwendungen', bereich: 'einnahme' },
  { id: 'a4', nummer: '5200', kurz: '4', name: 'Sachaufwand', bereich: 'ausgabe' },
  { id: 'a4a', nummer: '5210', kurz: '4a', name: 'Geräte', bereich: 'ausgabe', parentId: 'a4' },
  { id: 'a6', nummer: '5230', kurz: '6', name: 'Veranstaltungen', bereich: 'ausgabe' },
]
const stamm: Stammdaten = { ...leereStammdaten(), stellen }

function ctx(): st.Ctx {
  let i = 0
  return { jetzt: '2026-11-16T10:00:00.000Z', neueId: () => `id${++i}` }
}

const eingabe = (p: Partial<st.BuchungEingabe> = {}): st.BuchungEingabe => ({ datum: '2026-03-01', stelleId: 'a4a', betrag: 100_00, empfaenger: 'Musterhandel', zweck: 'Kabel', status: 'angeordnet', ...p })

describe('Buchen', () => {
  it('vergibt fortlaufende Nummern und protokolliert', () => {
    const c = ctx()
    let j: Jahr = { ...leeresJahr(2026), naechsteNr: 25 }
    j = st.upsertBuchung(stamm, j, eingabe(), c).jahr
    j = st.upsertBuchung(stamm, j, eingabe(), c).jahr
    expect(j.buchungen.map(b => b.belegnr)).toEqual(['2026 025', '2026 026'])
    expect(j.protokoll.map(p => p.aktion)).toEqual(['buchung.neu', 'buchung.neu'])
  })

  it('lehnt Hauptgruppen mit Unterstellen, falsches Jahr und Betrag ≤ 0 ab', () => {
    const j = leeresJahr(2026)
    expect(() => st.upsertBuchung(stamm, j, eingabe({ stelleId: 'a4' }), ctx())).toThrow(/Unterstelle/)
    expect(() => st.upsertBuchung(stamm, j, eingabe({ datum: '2025-12-31' }), ctx())).toThrow(/Haushaltsjahr/)
    expect(() => st.upsertBuchung(stamm, j, eingabe({ betrag: 0 }), ctx())).toThrow(/größer als 0/)
  })

  it('Änderung angeordneter Buchung landet mit alt/neu im Protokoll', () => {
    const c = ctx()
    const r = st.upsertBuchung(stamm, leeresJahr(2026), eingabe(), c)
    const j = st.upsertBuchung(stamm, r.jahr, { ...eingabe({ betrag: 120_00 }), id: r.id }, c).jahr
    expect(j.protokoll.at(-1)).toMatchObject({ aktion: 'buchung.aendern', vorher: { betrag: 100_00 }, nachher: { betrag: 120_00 } })
  })

  it('angeordnete Buchungen lassen sich nicht löschen, Vormerkungen schon', () => {
    const c = ctx()
    const a = st.upsertBuchung(stamm, leeresJahr(2026), eingabe(), c)
    expect(() => st.loescheVormerkung(a.jahr, a.id, c)).toThrow(/Nur Vormerkungen/)
    const v = st.upsertBuchung(stamm, a.jahr, eingabe({ status: 'vorgemerkt' }), c)
    const j = st.loescheVormerkung(v.jahr, v.id, c)
    expect(j.buchungen).toHaveLength(1)
    expect(j.naechsteNr).toBe(3) // Nummer wird nicht wiederverwendet
  })
})

describe('Rücknahme und Storno (F03)', () => {
  it('nicht bestätigt → zurückziehen; bestätigt → nur Storno', () => {
    const c = ctx()
    const r = st.upsertBuchung(stamm, leeresJahr(2026), eingabe(), c)
    expect(() => st.stornieren(r.jahr, r.id, 'x', '2026-04-01', c)).toThrow(/zurückziehen/)
    const weg = st.zurueckziehen(r.jahr, r.id, 'doppelt erfasst', c)
    expect(uebersicht(stamm, weg).guthaben.unsere).toBe(0)

    const gehakt = st.abhaken(r.jahr, { buchungIds: [r.id], datum: '2026-03-20' }, c)
    expect(() => st.zurueckziehen(gehakt, r.id, 'x', c)).toThrow(/stornieren/)
    const s = st.stornieren(gehakt, r.id, 'Gutschrift', '2026-04-01', c)
    const u = uebersicht(stamm, s.jahr)
    expect(u.guthaben.unsere).toBe(0)
    expect(u.guthaben.kreis).toBe(-100_00) // erst wenn der Kreis die Gegenbuchung bucht, ist es 0
    const fertig = st.abhaken(s.jahr, { buchungIds: [s.id], datum: '2026-04-10' }, c)
    expect(uebersicht(stamm, fertig).guthaben.kreis).toBe(0)
  })
})

describe('Abgleich', () => {
  it('setzt gebucht über eine Kreiszuordnung und lässt sich aufheben', () => {
    const c = ctx()
    const r = st.upsertBuchung(stamm, leeresJahr(2026), eingabe(), c)
    const j = st.abhaken(r.jahr, { buchungIds: [r.id], datum: '2026-03-20', kreisStelle: '5210', kreisVorgang: '3' }, c)
    expect(statusVon(j, j.buchungen[0])).toBe('gebucht')
    expect(j.kreis[0]).toMatchObject({ kreisStelle: '5210', kreisVorgang: '3', teile: [{ betrag: 100_00 }] })
    expect(statusVon(st.abhakenAufheben(j, r.id, c), j.buchungen[0])).toBe('angeordnet')
  })
})

describe('Ansatzänderungen', () => {
  it('Umschichtung als Paar, Sperre negativ, Entfernen nimmt beide Hälften', () => {
    const c = ctx()
    let j = st.setAnsatz(leeresJahr(2026), 'a4', 8_000_00, c)
    j = st.addAenderung(stamm, j, { datum: '2026-05-01', art: 'umschichtung', stelleId: 'a4', zielId: 'a6', betrag: 500_00, bemerkung: 'Beschluss' }, c)
    j = st.addAenderung(stamm, j, { datum: '2026-05-02', art: 'sperre', stelleId: 'a4', betrag: 100_00, bemerkung: 'Haushaltssperre' }, c)
    expect(j.aenderungen.map(a => a.betrag)).toEqual([-500_00, 500_00, -100_00])
    j = st.entferneAenderung(j, j.aenderungen[1].id, c)
    expect(j.aenderungen.map(a => a.betrag)).toEqual([-100_00])
  })
})

describe('QIF-Import (F07, F08)', () => {
  const q = (satz: number, p: Partial<QifBuchung>): QifBuchung => ({ satz, datum: '2026-02-01', betrag: -10_00, nummer: `2026 00${satz}`, empfaenger: 'Muster', zweck: '', kategorie: 'Geräte', klasse: '', status: 'abgeglichen', rohDatum: '', ...p })
  const zu = { Geräte: 'a4a', Zuwendung: 'e1', Gruppe: 'a4' }

  it('übernimmt als angeordnet, setzt Nummer fort, erkennt Wiederimport', () => {
    const c = ctx()
    const qs = [q(1, {}), q(2, { betrag: 500_00, kategorie: 'Zuwendung' }), q(3, { kategorie: 'Unbekannt' }), q(4, { kategorie: 'Gruppe' }), q(5, { betrag: 5_00 }), q(6, { datum: '2025-12-31' })]
    const plan = st.qifPlan(stamm, leeresJahr(2026), 'VS 0000', qs, zu)
    expect(plan.map(p => p.aktion)).toEqual(['neu', 'neu', 'ohneZuordnung', 'ohneZuordnung', 'richtungPasstNicht', 'falschesJahr'])
    const r = st.qifUebernehmen(leeresJahr(2026), 'x.qif', plan, { konfliktNeueNummer: [] }, c)
    expect(r.anzahl).toBe(2)
    expect(r.jahr.naechsteNr).toBe(3)
    expect(r.jahr.buchungen.every(b => b.status === 'angeordnet' && b.qif?.status === 'abgeglichen')).toBe(true)
    expect(statusVon(r.jahr, r.jahr.buchungen[0])).toBe('angeordnet')
    // Wiederimport
    const plan2 = st.qifPlan(stamm, r.jahr, 'VS 0000', qs, zu)
    expect(plan2.slice(0, 2).map(p => p.aktion)).toEqual(['doppelt', 'doppelt'])
  })

  it('gleiche Nummer, anderer Inhalt → Konflikt, nur mit Freigabe und neuer Nummer', () => {
    const c = ctx()
    const j = st.upsertBuchung(stamm, { ...leeresJahr(2026), naechsteNr: 7 }, eingabe(), c).jahr // 2026 007
    const plan = st.qifPlan(stamm, j, 'VS 0000', [q(7, { nummer: '2026 007' })], zu)
    expect(plan[0].aktion).toBe('konflikt')
    expect(st.qifUebernehmen(j, 'x', plan, { konfliktNeueNummer: [] }, c).anzahl).toBe(0)
    const r = st.qifUebernehmen(j, 'x', plan, { konfliktNeueNummer: [7] }, c)
    expect(r.jahr.buchungen.at(-1)!.belegnr).toBe('2026 008')
  })
})

describe('Jahresabschluss (F01, F02, F06)', () => {
  function jahrVoll() {
    const c = ctx()
    let j: Jahr = { ...leeresJahr(2026), anfangsbestand: 1_000_00 }
    j = st.setAnsatz(j, 'a4', 1_000_00, c)
    j = st.upsertBuchung(stamm, j, eingabe({ betrag: 300_00 }), c).jahr
    j = st.upsertBuchung(stamm, j, eingabe({ status: 'vorgemerkt', betrag: 50_00, datum: '2026-12-01' }), c).jahr
    j = st.upsertBuchung(stamm, j, eingabe({ status: 'vorgemerkt', betrag: 20_00, zweck: 'verfällt' }), c).jahr
    return { j, c }
  }

  it('überträgt Anfangsbestand, Reste und gewählte Vormerkungen; sperrt und friert ein', () => {
    const { j, c } = jahrVoll()
    const v = j.buchungen[1]
    const r = st.abschliessen(stamm, j, null, { uebertraege: [{ stelleId: 'a4', betrag: 700_00 }], vormerkungenUebernehmen: [v.id] }, c)
    expect(r.folge.anfangsbestand).toBe(700_00)
    expect(r.folge.aenderungen).toMatchObject([{ art: 'uebertrag', stelleId: 'a4', betrag: 700_00 }])
    expect(r.folge.buchungen).toMatchObject([{ belegnr: '2027 001', datum: '2027-01-01', uebernommenAus: { jahr: 2026, id: v.id } }])
    expect(r.alt.gesperrt).toBe(true)
    expect(r.alt.stellen).toEqual(stellen)
    expect(r.alt.buchungen[2].zurueckgezogen).toBeTruthy()
    expect(() => st.upsertBuchung(stamm, r.alt, eingabe(), c)).toThrow(/abgeschlossen/)
  })

  it('offene Anordnung bleibt im alten Jahr und lässt sich nach dem Abschluss abhaken', () => {
    const { j, c } = jahrVoll()
    const r = st.abschliessen(stamm, j, null, { uebertraege: [], vormerkungenUebernehmen: [] }, c)
    const gehakt = st.abhaken(r.alt, { buchungIds: [r.alt.buchungen[0].id], datum: '2027-01-15' }, c)
    expect(statusVon(gehakt, gehakt.buchungen[0])).toBe('gebucht')
    expect(gehakt.protokoll.at(-1)!.aktion).toBe('abhaken.nachAbschluss')
  })

  it('erneuter Abschluss ersetzt statt zu verdoppeln', () => {
    const { j, c } = jahrVoll()
    const v = j.buchungen[1]
    const r1 = st.abschliessen(stamm, j, null, { uebertraege: [{ stelleId: 'a4', betrag: 700_00 }], vormerkungenUebernehmen: [v.id] }, c)
    expect(st.abschlussUnvollstaendig(j, r1.folge)).toBe(true) // Absturz vor der Sperre
    const wieder = st.entsperren(r1.alt, 'Korrektur', c)
    const r2 = st.abschliessen(stamm, wieder, r1.folge, { uebertraege: [{ stelleId: 'a4', betrag: 650_00 }], vormerkungenUebernehmen: [v.id] }, c)
    expect(r2.folge.aenderungen.map(a => a.betrag)).toEqual([650_00])
    expect(r2.folge.buchungen).toHaveLength(1)
  })
})

describe('Gliederung schützen (F06)', () => {
  it('finanzwirksame Merkmale gebuchter Stellen bleiben fest', () => {
    const c = ctx()
    const j = st.upsertBuchung(stamm, leeresJahr(2026), eingabe(), c).jahr
    const neu = { ...stamm, stellen: stellen.map(s => (s.id === 'a4a' ? { ...s, durchlaufend: true } : s)) }
    expect(() => st.saveStamm(stamm, neu, [j])).toThrow(/rückwirkend/)
    const ohne = { ...stamm, stellen: stellen.filter(s => s.id !== 'a4a') }
    expect(() => st.saveStamm(stamm, ohne, [j])).toThrow(/stilllegen/)
  })
})
