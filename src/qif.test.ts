import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeQif, nummernImPfad, parseQif, parseQifAmount, parseQifDate } from './qif'

const fixture = () => decodeQif(new Uint8Array(readFileSync(new URL('../test-fixtures/musterau.qif', import.meta.url))))

describe('parseQifAmount', () => {
  it('liest das Quicken-MDY-Format mit Tausender-Komma', () => {
    expect(parseQifAmount('-34,736.00')).toBe(-3473600)
    expect(parseQifAmount('-7.79')).toBe(-779)
    expect(parseQifAmount('-1,234.5')).toBe(-123450)
    expect(parseQifAmount('1,234')).toBe(123400)
  })
  it('liest auch deutsche Schreibweise', () => {
    expect(parseQifAmount('1.234,56')).toBe(123456)
    expect(parseQifAmount('-0,70')).toBe(-70)
  })
  it('rät nicht bei mehrdeutigen Werten', () => {
    expect(parseQifAmount('1.234.5')).toBeNull()
    expect(parseQifAmount('1,23,4.00')).toBeNull()
    expect(parseQifAmount('abc')).toBeNull()
    expect(parseQifAmount('')).toBeNull()
  })
})

describe('parseQifDate', () => {
  it('liest Monat.Tag.Jahr der deutschen Altversion', () => {
    expect(parseQifDate('1.13.26', 'MDY')).toBe('2026-01-13')
    expect(parseQifDate('12.31.26', 'MDY')).toBe('2026-12-31')
    expect(parseQifDate(" 5/ 2'26", 'MDY')).toBe('2026-05-02')
    expect(parseQifDate('5/20/2026', 'MDY')).toBe('2026-05-20')
  })
  it('beachtet DMY', () => {
    expect(parseQifDate('13.1.26', 'DMY')).toBe('2026-01-13')
  })
  it('lehnt unmögliche Daten ab', () => {
    expect(parseQifDate('2.30.26', 'MDY')).toBeNull()
    expect(parseQifDate('13.1.26', 'MDY')).toBeNull()
    expect(parseQifDate('17.02.20525', 'DMY')).toBeNull()
  })
})

describe('parseQif mit Musterdatei (Latin-1, CRLF)', () => {
  const r = parseQif(fixture())

  it('erkennt Konto, Datumsfolge und Umlaute', () => {
    expect(r.konto).toBe('VS 0000')
    expect(r.datumsFolge).toBe('MDY')
    expect(r.buchungen[0].zweck).toBe('Reinigungsbürsten Werkstatt')
  })

  it('übernimmt nur echte Buchungen', () => {
    expect(r.buchungen.map(b => b.nummer)).toEqual(['2026 001', '2026 002', '2026 003', '2026 004'])
    expect(r.ignoriert).toEqual({ memorized: 1 })
  })

  it('verliert nichts still: Split und falsches Datum sind Probleme', () => {
    expect(r.probleme).toHaveLength(2)
    expect(r.probleme[0].meldung).toMatch(/Split/)
    expect(r.probleme[1].meldung).toMatch(/2026 006.*Datum/)
  })

  it('liest Beträge, Status, Kategorie und Klasse', () => {
    const [a, , c, d] = r.buchungen
    expect(a).toMatchObject({ datum: '2026-01-13', betrag: -779, status: 'abgeglichen', kategorie: '5200 Aufw. Sach-, Dienstleistung:5210 Geräte' })
    expect(c).toMatchObject({ betrag: 3473600, status: 'offen', empfaenger: 'Landkreis Musterau' })
    expect(d).toMatchObject({ datum: '2026-12-31', betrag: -123450, status: 'geklaert', klasse: 'MINT' })
  })

  it('Summe = Summe der übernommenen T-Zeilen', () => {
    expect(r.summe).toBe(-779 - 2700 + 3473600 - 123450)
  })

  it('liest Kategorien mit Art', () => {
    expect(r.kategorien.map(k => k.art)).toEqual(['einnahme', 'ausgabe', 'ausgabe'])
  })
})

describe('parseQif ohne Option-Zeile', () => {
  it('warnt, statt still MDY anzunehmen', () => {
    const r = parseQif('!Type:Bank\nD1.2.26\nT-1.00\n^\n')
    expect(r.probleme[0].meldung).toMatch(/Datumsreihenfolge/)
    expect(r.buchungen).toHaveLength(1)
  })
})

describe('nummernImPfad', () => {
  it('liefert die spezifischste Nummer zuerst', () => {
    expect(nummernImPfad('5200 Aufw. Sach-, Dienstleistung:5220 Medien:Software')).toEqual(['5220', '5200'])
    expect(nummernImPfad('5020 Kosten päd. Personal:Reisekosten')).toEqual(['5020'])
    expect(nummernImPfad('Sonstiges')).toEqual([])
  })
})
