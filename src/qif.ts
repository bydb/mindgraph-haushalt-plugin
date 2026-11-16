// QIF-Leser für Exporte alter deutscher Quicken-Versionen. Rein, ohne Host.
//
// Beobachtetes Format: Latin-1/Windows-1252, CRLF, „!Option:MDY“, Datum „D5.20.26“ (= 20.05.2026),
// Betrag „T-1,234.56“ (Tausender-Komma, Dezimalpunkt), „N2026 003“ Belegnummer, „P“ Empfänger,
// „M“ Verwendungszweck, „L“ Kategoriepfad mit „:“, „CX“ abgeglichen. Daneben Abschnitte für
// Kategorien, Klassen, Konten und gespeicherte Buchungen — die werden gelesen, aber nie als Buchung
// übernommen.
//
// Grundsatz: nichts still verwerfen. Was nicht eindeutig lesbar ist, landet in `probleme`.

import type { Cent } from './geld'

export type QifStatus = 'abgeglichen' | 'geklaert' | 'offen'

export interface QifBuchung {
  /** Laufende Nummer des Datensatzes in der Datei (ab 1), für Rückfragen. */
  satz: number
  datum: string // ISO JJJJ-MM-TT
  betrag: Cent // mit Vorzeichen wie in Quicken: Ausgabe negativ
  nummer: string
  empfaenger: string
  zweck: string
  kategorie: string
  klasse: string
  status: QifStatus
  /** Original-Datumsfeld, für Anzeige bei Problemen. */
  rohDatum: string
}

export interface QifKategorie {
  pfad: string
  beschreibung: string
  art: 'einnahme' | 'ausgabe' | 'unbekannt'
}

export interface QifProblem {
  satz: number
  meldung: string
}

export interface QifErgebnis {
  konto: string
  datumsFolge: 'MDY' | 'DMY'
  buchungen: QifBuchung[]
  kategorien: QifKategorie[]
  probleme: QifProblem[]
  /** Summe aller T-Zeilen der übernommenen Buchungen (Selbstkontrolle gegen die Vorschau). */
  summe: Cent
  /** Datensätze aus Abschnitten, die keine Buchungen sind (Info). */
  ignoriert: Record<string, number>
}

/** Bytes → Text. QIF alter Quicken-Versionen ist Windows-1252; UTF-8 mit BOM wird erkannt. */
export function decodeQif(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3))
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return utf8
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/**
 * QIF-Betrag → Cent. Quicken schreibt in MDY-Dateien „1,234.56“; manche Versionen „1.234,56“.
 * Entscheidend ist das LETZTE Trennzeichen mit genau 1–2 Ziffern danach.
 */
export function parseQifAmount(raw: string): Cent | null {
  let s = raw.trim().replace(/\s/g, '')
  if (!s) return null
  const neg = s.startsWith('-')
  if (neg || s.startsWith('+')) s = s.slice(1)
  const m = /^(.*?)(?:([.,])(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const [, ganzRoh, trenn, nach] = m
  let ganz = ganzRoh
  if (trenn) {
    const andere = trenn === '.' ? ',' : '.'
    if (ganz.includes(trenn)) return null // gleiches Zeichen als Tausender UND Dezimal → unklar
    if (ganz.includes(andere) && !/^\d{1,3}([.,]\d{3})+$/.test(ganz)) return null
    ganz = ganz.split(andere).join('')
  } else {
    // Ohne Dezimalteil: nur reine Ziffern oder saubere Tausendergruppen.
    if (!/^\d+$/.test(ganz)) {
      if (!/^\d{1,3}([.,]\d{3})+$/.test(ganz)) return null
      ganz = ganz.replace(/[.,]/g, '')
    }
  }
  if (!/^\d+$/.test(ganz)) return null
  const v = Number(ganz) * 100 + Number((nach ?? '').padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(v)) return null
  return neg ? -v : v
}

/**
 * QIF-Datum → ISO. Formen: „5.20.26“, „5/20/26“, „5/20'26“, „5/20/2026“, „ 5/ 2'26“.
 * Zweistellige Jahre: „'“ als Trenner bedeutet in Quicken 2000+, sonst 00–79 → 20xx, 80–99 → 19xx.
 */
export function parseQifDate(raw: string, folge: 'MDY' | 'DMY'): string | null {
  const s = raw.trim().replace(/\s+/g, '')
  const m = /^(\d{1,2})[./-](\d{1,2})([./'-])(\d{2}|\d{4})$/.exec(s)
  if (!m) return null
  const [, a, b, trenn, j] = m
  const monat = Number(folge === 'MDY' ? a : b)
  const tag = Number(folge === 'MDY' ? b : a)
  let jahr = Number(j)
  if (j.length === 2) jahr = trenn === "'" || jahr < 80 ? 2000 + jahr : 1900 + jahr
  if (monat < 1 || monat > 12 || tag < 1) return null
  const tageImMonat = new Date(Date.UTC(jahr, monat, 0)).getUTCDate()
  if (tag > tageImMonat) return null
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`
}

function status(c: string | undefined): QifStatus {
  const v = (c ?? '').trim().toUpperCase()
  if (v === 'X' || v === 'R') return 'abgeglichen'
  if (v === '*' || v === 'C') return 'geklaert'
  return 'offen'
}

const BUCHUNGS_TYPEN = new Set(['bank', 'cash', 'ccard', 'oth a', 'oth l'])

export function parseQif(text: string): QifErgebnis {
  const zeilen = text.replace(/\r\n?/g, '\n').split('\n')
  const out: QifErgebnis = { konto: '', datumsFolge: 'MDY', buchungen: [], kategorien: [], probleme: [], summe: 0, ignoriert: {} }
  let abschnitt = ''
  let satz: Array<[string, string]> = []
  let satzNr = 0
  let sahOption = false
  let imKonto = false

  const flush = () => {
    if (satz.length === 0) return
    satzNr++
    const felder = satz
    satz = []
    if (imKonto) {
      const n = felder.find(([k]) => k === 'N')?.[1]
      if (n) out.konto = n.trim()
      return
    }
    if (abschnitt === 'cat') {
      const pfad = felder.find(([k]) => k === 'N')?.[1]?.trim() ?? ''
      if (!pfad) return
      const art = felder.some(([k]) => k === 'I') ? 'einnahme' : felder.some(([k]) => k === 'E') ? 'ausgabe' : 'unbekannt'
      out.kategorien.push({ pfad, beschreibung: felder.find(([k]) => k === 'D')?.[1]?.trim() ?? '', art })
      return
    }
    if (!BUCHUNGS_TYPEN.has(abschnitt)) {
      const key = abschnitt || 'ohne Abschnitt'
      out.ignoriert[key] = (out.ignoriert[key] ?? 0) + 1
      return
    }
    const get = (k: string) => felder.find(([kk]) => kk === k)?.[1] ?? ''
    if (felder.some(([k]) => k === 'S' || k === '$')) {
      out.probleme.push({ satz: satzNr, meldung: `Aufgeteilte Buchung (Split) ${get('N').trim() || get('D')} wird nicht unterstützt — bitte von Hand erfassen.` })
      return
    }
    const rohDatum = get('D')
    const datum = parseQifDate(rohDatum, out.datumsFolge)
    const rohBetrag = get('T') || get('U')
    const betrag = parseQifAmount(rohBetrag)
    const probleme: string[] = []
    if (!datum) probleme.push(`Datum „${rohDatum}“ nicht lesbar`)
    if (betrag === null) probleme.push(`Betrag „${rohBetrag}“ nicht lesbar`)
    const u = get('U')
    if (u && get('T') && parseQifAmount(u) !== betrag) probleme.push(`Beträge T „${get('T')}“ und U „${u}“ weichen ab`)
    const lRoh = get('L').trim()
    if (lRoh.startsWith('[')) probleme.push(`Umbuchung auf Konto ${lRoh} wird nicht unterstützt`)
    if (probleme.length) {
      out.probleme.push({ satz: satzNr, meldung: `${get('N').trim() || 'ohne Nummer'}: ${probleme.join('; ')}` })
      return
    }
    // Kategorie „Pfad/Klasse“: Quicken hängt die Klasse mit „/“ an.
    const slash = lRoh.indexOf('/')
    const kategorie = slash >= 0 ? lRoh.slice(0, slash) : lRoh
    const klasse = slash >= 0 ? lRoh.slice(slash + 1) : ''
    out.buchungen.push({
      satz: satzNr,
      datum: datum!,
      betrag: betrag!,
      nummer: get('N').trim(),
      empfaenger: get('P').trim(),
      zweck: get('M').trim(),
      kategorie,
      klasse,
      status: status(get('C')),
      rohDatum,
    })
    out.summe += betrag!
  }

  for (const zeileRoh of zeilen) {
    const zeile = zeileRoh.replace(/\s+$/, '')
    if (!zeile) continue
    if (zeile.startsWith('!')) {
      flush()
      const kopf = zeile.slice(1).trim()
      const lower = kopf.toLowerCase()
      if (lower.startsWith('option:')) {
        const opt = kopf.slice(7).trim().toUpperCase()
        if (opt === 'MDY' || opt === 'DMY') {
          out.datumsFolge = opt
          sahOption = true
        }
        continue
      }
      if (lower.startsWith('clear:')) continue
      if (lower === 'account') {
        imKonto = true
        continue
      }
      if (lower.startsWith('type:')) {
        imKonto = false
        abschnitt = lower.slice(5).trim()
      }
      continue
    }
    if (zeile === '^') {
      flush()
      continue
    }
    satz.push([zeile[0], zeile.slice(1)])
  }
  flush()

  if (!sahOption) {
    out.probleme.unshift({ satz: 0, meldung: 'Die Datei nennt keine Datumsreihenfolge (!Option:MDY). Angenommen: Monat.Tag.Jahr — bitte die ersten Buchungen prüfen.' })
  }
  return out
}

/** Kategoriepfad → vierstellige Haushaltsnummern darin, vom spezifischsten zum allgemeinsten. */
export function nummernImPfad(pfad: string): string[] {
  return pfad
    .split(':')
    .map(teil => /^\s*(\d{4})\b/.exec(teil)?.[1])
    .filter((n): n is string => Boolean(n))
    .reverse()
}
