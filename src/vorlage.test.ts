import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { type Jahr, type Stammdaten, leereStammdaten, leeresJahr } from './model'
import { berichtDaten, berichtZeilen, euroZuCent, leseVorlage } from './vorlage'
import { type SchreibZelle, leseXlsx, schreibeXlsx, spaltenName, zellAdresse } from './xlsx'

// Erfundene Vorlage im Aufbau der Steuerungsgruppen-Tabelle.
const Z = (wert: number | string | null, formel?: string): SchreibZelle => ({ wert, ...(formel ? { formel } : {}) })
const vorlage: Array<Array<SchreibZelle | null>> = [
  [null, null, null, Z('Ansatz 2024'), Z('Ist 2024'), Z('2024 ohne Sonderposten'), Z('Ansatz 2025'), Z('Ist 2025'), Z('Ansatz 2026')],
  [null, null, Z('Kontostand per 01. Januar'), null, Z(1000), null, null, Z(2000.5)],
  [],
  [null, null, Z('Einnahmen')],
  [Z(4100), Z(1), Z('Zuwendungen'), null, Z(1500, 'E6+E7'), null, null, null, null],
  [Z(4101), Z('1a'), Z('Träger'), Z(1500), Z(1500), null, Z(1600), Z('Kein Zahlungseingang'), Z(1600)],
  [null, Z('1d'), Z('Lizenzumlage'), null, Z(0), null, Z(900.1), Z(900.1), Z(900.1)],
  [null, null, Z('Summe Einnahmen'), null, Z(1500, 'SUM(E5:E7)')],
  [],
  [null, null, Z('Ausgaben')],
  [Z(5200), Z(4), Z('Sachaufwand'), Z(8000), Z(300, 'E12'), null, Z(8000), Z(450.25, 'H12+H13'), Z(8000)],
  [Z(5210), Z('4a'), Z('Geräte'), null, Z(300), null, null, Z(400.25), null],
  [Z(5210), Z('4d'), Z('Werkstatt'), null, null, null, null, Z(50)],
  [Z(5230), Z(6), Z('Veranstaltungen'), Z(500), Z(9.14), null, Z(500), Z(0.005), Z(500)],
  [null, null, Z('Summe Ausgaben (mit Lizenzen)'), null, Z(309.14, 'E11+E14')],
  [null, null, Z('Kontostand per 31. Dezember'), null, Z(2190.86, 'E2+E8-E15')],
]

function ids() {
  let i = 0
  return () => `s${++i}`
}

describe('xlsx Grundlagen', () => {
  it('Spaltennamen und Adressen', () => {
    expect(spaltenName(0)).toBe('A')
    expect(spaltenName(25)).toBe('Z')
    expect(spaltenName(26)).toBe('AA')
    expect(zellAdresse('AB12')).toEqual({ c: 27, r: 11 })
  })
  it('Euro → Cent exakt (F09)', () => {
    expect(euroZuCent(175071.1)).toBe(17507110)
    expect(euroZuCent(0.29)).toBe(29)
    expect(euroZuCent(0.005)).toBeNull()
  })
  it('liest das richtige Blatt über die Relations (F10)', () => {
    const blatt = (t: string) => strToU8(`<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${t}</t></is></c></row></sheetData></worksheet>`)
    const bytes = zipSync({
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Haushalt" sheetId="1" r:id="rId7"/><sheet name="Notizen" sheetId="2" r:id="rId3"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId3" Target="worksheets/sheet1.xml"/><Relationship Id="rId7" Target="/xl/worksheets/sheet9.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': blatt('Notiz'),
      'xl/worksheets/sheet9.xml': blatt('Haushalt &amp; Co'),
    })
    const b = leseXlsx(bytes)
    expect(b.map(x => x.name)).toEqual(['Haushalt', 'Notizen'])
    expect(b[0].zeilen[0][0]!.wert).toBe('Haushalt & Co')
  })
  it('lehnt Nicht-Excel ab', () => {
    expect(() => leseXlsx(strToU8('kein zip'))).toThrow(/keine lesbare Excel-Datei/)
  })
})

describe('Erstimport aus der Vorlage', () => {
  const imp = leseVorlage(leseXlsx(schreibeXlsx('Haushalt', vorlage)), ids())
  const s = (kurz: string) => imp.stellen.find(x => x.kurz === kurz)!

  it('erkennt Gliederung mit zwei Ebenen und Bereich', () => {
    expect(imp.stellen.map(x => `${x.nummer}|${x.kurz}|${x.bereich}|${x.parentId ? 'u' : 'g'}`)).toEqual([
      '4100|1|einnahme|g', '4101|1a|einnahme|u', '|1d|einnahme|u',
      '5200|4|ausgabe|g', '5210|4a|ausgabe|u', '5210|4d|ausgabe|u', '5230|6|ausgabe|g',
    ])
    expect(s('1a').parentId).toBe(s('1').id)
  })

  it('Spalten: nur „Ansatz/Ist JJJJ“, Sonderspalten werden gemeldet', () => {
    expect(imp.spalten.map(x => `${x.art} ${x.jahr}`)).toEqual(['ansatz 2024', 'ist 2024', 'ansatz 2025', 'ist 2025', 'ansatz 2026'])
    expect(imp.ignorierteSpalten).toEqual(['2024 ohne Sonderposten'])
  })

  it('Werte in Cent; Gruppenformeln werden nicht übernommen; Text und Unklares werden gemeldet', () => {
    expect(imp.werte[2025][s('1d').id]).toEqual({ ansatz: 90010, ist: 90010 })
    expect(imp.werte[2025][s('1a').id]).toEqual({ ansatz: 160000, text: 'Kein Zahlungseingang' })
    expect(imp.werte[2025][s('4').id]).toEqual({ ansatz: 800000 }) // Ist ist Formel → abgeleitet
    expect(imp.werte[2024][s('1').id]).toBeUndefined()
    expect(imp.werte[2025][s('6').id]).toEqual({ ansatz: 50000 })
    expect(imp.hinweise.some(h => /Kein Zahlungseingang/.test(h))).toBe(true)
    expect(imp.hinweise.some(h => /0.005.*Nachkommastellen/.test(h))).toBe(true)
  })

  it('Kontostände', () => {
    expect(imp.kontostand[2024]).toEqual({ anfang: 100000, ende: 219086 })
    expect(imp.kontostand[2025]).toEqual({ anfang: 200050 })
  })
})

describe('Bericht', () => {
  const imp = leseVorlage(leseXlsx(schreibeXlsx('Haushalt', vorlage)), ids())
  const s = (kurz: string) => imp.stellen.find(x => x.kurz === kurz)!
  const stamm: Stammdaten = { ...leereStammdaten(), einrichtung: 'Musterau', stellen: imp.stellen.map(x => (x.kurz === '1d' ? { ...x, durchlaufend: true } : x)), vorjahre: { 2024: imp.werte[2024], 2025: imp.werte[2025] }, vorjahrKontostand: imp.kontostand }
  const j26: Jahr = {
    ...leeresJahr(2026), anfangsbestand: 300000,
    ansatz: { [s('1a').id]: 160000, [s('4').id]: 800000, [s('6').id]: 50000 },
    buchungen: [
      { id: 'b1', belegnr: '2026 001', datum: '2026-02-01', stelleId: s('4a').id, betrag: 12345, empfaenger: 'M', zweck: '', status: 'angeordnet', quelle: 'hand' },
      { id: 'b2', belegnr: '2026 002', datum: '2026-02-02', stelleId: s('4d').id, betrag: 655, empfaenger: 'M', zweck: '', status: 'angeordnet', quelle: 'hand' },
      { id: 'b3', belegnr: '2026 003', datum: '2026-02-03', stelleId: s('1d').id, betrag: 90010, empfaenger: 'M', zweck: '', status: 'angeordnet', quelle: 'hand' },
    ],
  }
  const d = berichtDaten({ stamm, jahre: [j26], von: 2024, bis: 2026, mitFolgeansatz: true, stand: '16.11.2026' })

  it('Spalten aus Vorjahren und Buchungen', () => {
    expect(d.spalten.map(x => `${x.art} ${x.jahr} ${x.quelle}`)).toEqual([
      'ansatz 2024 vorjahr', 'ist 2024 vorjahr', 'ansatz 2025 vorjahr', 'ist 2025 vorjahr', 'ansatz 2026 buchungen', 'ist 2026 buchungen',
    ])
  })

  it('Gruppen-Ist 2026 als Formel mit richtigem Wert; durchlaufend außerhalb der Gruppe; Summen und Kontostand', () => {
    const { zeilen } = berichtZeilen(d, stamm, [j26])
    const zeile = (name: string) => zeilen.find(z => typeof z[2]?.wert === 'string' && (z[2]!.wert as string).startsWith(name))!
    const ist26 = 3 + 5
    expect(zeile('Sachaufwand')[ist26]).toMatchObject({ wert: 130, formel: expect.stringMatching(/^I\d+\+I\d+$/) })
    expect(zeile('Zuwendungen')[ist26]).toMatchObject({ wert: 0, formel: expect.stringMatching(/^I\d+$/) }) // nur 1a; 1d ist durchlaufend
    expect(zeile('Summe Einnahmen (mit')[ist26]!.wert).toBe(900.1)
    expect(zeile('Summe Einnahmen (ohne')[ist26]!.wert).toBe(0)
    expect(zeile('Summe Ausgaben (mit')[ist26]!.wert).toBe(130)
    expect(zeile('Saldo')[ist26]!.wert).toBe(770.1)
    expect(zeile('Kontostand per 31')[ist26]!.wert).toBe(3000 + 900.1 - 130)
    expect(zeile('Kontostand per 01')[3 + 1]!.wert).toBe(1000)
    // Vorjahr bleibt wie in der Vorlage (Text erhalten)
    expect(zeile('Träger')[3 + 3]!.wert).toBe('Kein Zahlungseingang')
  })

  it('Rundlauf: Bericht ist wieder als Excel lesbar', () => {
    const { zeilen, breiten } = berichtZeilen(d, stamm, [j26])
    const b = leseXlsx(schreibeXlsx('Haushalt', zeilen, breiten))
    expect(b[0].zeilen[0][3]!.wert).toBe('Ansatz 2024')
  })
})
