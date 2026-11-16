import { describe, expect, it } from 'vitest'
import { type Buchung, type Jahr, type Stammdaten, type Stelle, belegDateiname, belegLaufnummer, belegNr, leereStammdaten, leeresJahr, pruefeGliederung, statusVon } from './model'
import { abschlussVorschlag, uebersicht } from './rechnen'

// Erfundene Gliederung im Aufbau der Steuerungsgruppen-Vorlage.
const S = (id: string, nummer: string, kurz: string, name: string, bereich: 'einnahme' | 'ausgabe', extra: Partial<Stelle> = {}): Stelle => ({ id, nummer, kurz, name, bereich, ...extra })
const stellen: Stelle[] = [
  S('e1', '4100', '1', 'Zuwendungen', 'einnahme'),
  S('e1a', '4101', '1a', 'Träger', 'einnahme', { parentId: 'e1' }),
  S('e1d', '', '1d', 'Lizenzumlage', 'einnahme', { parentId: 'e1', durchlaufend: true }),
  S('a4', '5200', '4', 'Sachaufwand', 'ausgabe'),
  S('a4a', '5210', '4a', 'Geräte', 'ausgabe', { parentId: 'a4' }),
  S('a4d', '5210', '4d', 'Werkstatt', 'ausgabe', { parentId: 'a4' }),
  S('a5', '5220', '5', 'Medien', 'ausgabe'),
  S('a5b', '5220', '5b', 'Software', 'ausgabe', { parentId: 'a5' }),
  S('a5c', '5220', '5c', 'Lizenzen', 'ausgabe', { parentId: 'a5', durchlaufend: true }),
  S('a6', '5230', '6', 'Veranstaltungen', 'ausgabe'),
]
const stamm: Stammdaten = { ...leereStammdaten(), stellen }

let n = 0
const B = (stelleId: string, betrag: number, extra: Partial<Buchung> = {}): Buchung => ({
  id: `b${++n}`, belegnr: belegNr(2026, n), datum: '2026-03-01', stelleId, betrag, empfaenger: 'Muster', zweck: '', status: 'angeordnet', quelle: 'hand', ...extra,
})

function jahrMit(buchungen: Buchung[], patch: Partial<Jahr> = {}): Jahr {
  return { ...leeresJahr(2026), anfangsbestand: 1_000_00, ansatz: { a4: 8_000_00, a5: 4_000_00, a6: 500_00, e1a: 16_700_00, e1d: 175_000_00, a5c: 175_000_00 }, buchungen, ...patch }
}

describe('uebersicht', () => {
  it('Gruppensumme ohne durchlaufende Unterstelle, Summe „mit“ enthält sie', () => {
    const j = jahrMit([B('a5b', 100_00), B('a5c', 175_000_00), B('a4a', 50_00), B('a4d', 25_00)])
    const u = uebersicht(stamm, j)
    const medien = u.zeilen.find(z => z.stelle.id === 'a5')!
    expect(medien.ist).toBe(100_00)
    expect(medien.ansatz).toBe(4_000_00) // 5c-Ansatz zählt nicht zur Gruppe
    expect(u.zeilen.find(z => z.stelle.id === 'a5c')!.ist).toBe(175_000_00)
    expect(u.zeilen.find(z => z.stelle.id === 'a4')!.ist).toBe(75_00)
    expect(u.summen.ausgabe.ohne.ist).toBe(175_00)
    expect(u.summen.ausgabe.mit.ist).toBe(175_175_00)
  })

  it('frei = Ansatz + Änderungen − Ist − vorgemerkt; Überschreitung wird markiert, nicht verhindert', () => {
    const j = jahrMit([B('a6', 400_00), B('a6', 200_00, { status: 'vorgemerkt' })], {
      aenderungen: [{ id: 'x', datum: '2026-05-01', art: 'sperre', stelleId: 'a6', betrag: -50_00, bemerkung: '' }],
    })
    const z = uebersicht(stamm, j).zeilen.find(z => z.stelle.id === 'a6')!
    expect(z.wirksam).toBe(450_00)
    expect(z.vorgemerkt).toBe(200_00)
    expect(z.frei).toBe(-150_00)
    expect(z.ueberschritten).toBe(true)
  })

  it('Umschichtung als Paar ändert die Gesamtsumme nicht', () => {
    const j = jahrMit([], {
      aenderungen: [
        { id: 'u1', datum: '2026-06-01', art: 'umschichtung', stelleId: 'a4', betrag: -1_000_00, bemerkung: '', paarId: 'u2' },
        { id: 'u2', datum: '2026-06-01', art: 'umschichtung', stelleId: 'a5', betrag: 1_000_00, bemerkung: '', paarId: 'u1' },
      ],
    })
    const u = uebersicht(stamm, j)
    expect(u.zeilen.find(z => z.stelle.id === 'a4')!.wirksam).toBe(7_000_00)
    expect(u.zeilen.find(z => z.stelle.id === 'a5')!.wirksam).toBe(5_000_00)
    expect(u.summen.ausgabe.ohne.wirksam).toBe(12_500_00)
  })

  it('Guthaben: unsere Sicht vs. Kreis-Sicht, durchlaufende zählen beim Guthaben', () => {
    const ein = B('e1a', 5_000_00)
    const aus = B('a4a', 300_00)
    const lizEin = B('e1d', 2_000_00)
    const lizAus = B('a5c', 2_000_00)
    const j = jahrMit([ein, aus, lizEin, lizAus], {
      kreis: [{ id: 'k1', teile: [{ buchungId: ein.id, betrag: 5_000_00 }], datum: '2026-04-01', quelle: 'hand' }],
    })
    const g = uebersicht(stamm, j).guthaben
    expect(g.unsere).toBe(1_000_00 + 5_000_00 - 300_00 + 2_000_00 - 2_000_00)
    expect(g.kreis).toBe(1_000_00 + 5_000_00)
    expect(g.offen).toBe(-300_00)
    expect(statusVon(j, ein)).toBe('gebucht')
    expect(statusVon(j, aus)).toBe('angeordnet')
  })

  it('1:n — erst beide Teile machen die Buchung „gebucht“', () => {
    const b = B('a4a', 38_69)
    const teil1 = { id: 'k1', teile: [{ buchungId: b.id, betrag: 33_69 }], datum: '2026-05-16', quelle: 'kreisliste' as const }
    expect(statusVon(jahrMit([b], { kreis: [teil1] }), b)).toBe('angeordnet')
    const teil2 = { id: 'k2', teile: [{ buchungId: b.id, betrag: 5_00 }], datum: '2026-06-11', quelle: 'kreisliste' as const }
    const j = jahrMit([b], { kreis: [teil1, teil2] })
    expect(statusVon(j, b)).toBe('gebucht')
    expect(uebersicht(stamm, j).guthaben.kreis).toBe(1_000_00 - 38_69)
  })

  it('zurückgezogene Buchungen zählen nirgends; Storno-Gegenbuchung zieht ab', () => {
    const weg = B('a6', 100_00, { zurueckgezogen: { am: '2026-04-01', grund: 'doppelt' } })
    const orig = B('a6', 80_00, { storniertDurch: 'g' })
    const gegen = B('a6', 80_00, { id: 'g', stornoVon: orig.id })
    const u = uebersicht(stamm, jahrMit([weg, orig, gegen]))
    expect(u.zeilen.find(z => z.stelle.id === 'a6')!.ist).toBe(0)
    expect(u.guthaben.unsere).toBe(1_000_00)
  })

  it('meldet Buchungen auf unbekannten Stellen statt sie zu verschlucken', () => {
    expect(uebersicht(stamm, jahrMit([B('gibtsnicht', 1_00)])).unbekannteStellen).toEqual(['gibtsnicht'])
  })
})

describe('abschlussVorschlag', () => {
  it('Rest je Ausgabengruppe, offene Posten, Endstand', () => {
    const v = B('a6', 100_00, { status: 'vorgemerkt' })
    const offen = B('a4a', 1_000_00)
    const j = jahrMit([v, offen])
    const a = abschlussVorschlag(stamm, j)
    expect(a.endstand).toBe(1_000_00 - 1_000_00)
    expect(a.uebertraege).toEqual([
      { stelleId: 'a4', rest: 7_000_00 },
      { stelleId: 'a5', rest: 4_000_00 },
      { stelleId: 'a6', rest: 500_00 },
    ])
    expect(a.offeneVormerkungen.map(b => b.id)).toEqual([v.id])
    expect(a.offeneAnordnungen.map(b => b.id)).toEqual([offen.id])
    expect(a.hindernisse).toEqual([])
  })
})

describe('Hilfen', () => {
  it('Belegnummern im Quicken-Format', () => {
    expect(belegNr(2026, 25)).toBe('2026 025')
    expect(belegLaufnummer('2026 024', 2026)).toBe(24)
    expect(belegLaufnummer('2025 024', 2026)).toBeNull()
  })
  it('Belegdateiname ohne Pfadzeichen', () => {
    expect(belegDateiname('2026 025', 'A/B: C*D')).toBe('2026 025 - A B C D.pdf')
  })
  it('Gliederungsprüfung', () => {
    expect(pruefeGliederung(stellen)).toEqual([])
    expect(pruefeGliederung([...stellen, S('x', '1', 'x', 'X', 'einnahme', { parentId: 'a4' })])).toHaveLength(1)
  })
})
