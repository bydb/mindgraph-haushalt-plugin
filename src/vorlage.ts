// Die Haushaltstabelle der Steuerungsgruppe: Zeilen = Gliederung, Spalten = „Ansatz JJJJ“ / „Ist JJJJ“.
// Erstimport (Gliederung, Vorjahre, laufender Ansatz) und Bericht im selben Layout. Rein und getestet.

import type { Cent } from './geld'
import { type Jahr, type Stammdaten, type Stelle, type VorjahrWert, stellenFuer } from './model'
import { uebersicht } from './rechnen'
import { type Blatt, type SchreibZelle, type Zelle, spaltenName } from './xlsx'

// ─── Erstimport ──────────────────────────────────────────────────────────────

export interface VorlageSpalte {
  spalte: number
  jahr: number
  art: 'ansatz' | 'ist'
  titel: string
}

export interface VorlageImport {
  blatt: string
  stellen: Stelle[]
  spalten: VorlageSpalte[]
  /** Jahr → Stelle.id → Wert, nur Zellen ohne Formel bzw. mit gespeichertem Wert. */
  werte: Record<string, Record<string, VorjahrWert>>
  kontostand: Record<string, { anfang?: Cent; ende?: Cent }>
  hinweise: string[]
  /** Spaltenköpfe, die nicht als Ansatz/Ist erkannt wurden (z. B. Sonderspalten). */
  ignorierteSpalten: string[]
}

/** Euro (Zahl aus Excel) → Cent, exakt (F09). Mehr als zwei Nachkommastellen → null. */
export function euroZuCent(v: number): Cent | null {
  const c = v * 100
  const r = Math.round(c)
  if (Math.abs(c - r) > 1e-6 || !Number.isSafeInteger(r)) return null
  return r
}

const textVon = (z: Zelle | undefined): string => (z && typeof z.wert === 'string' ? z.wert.trim() : z && typeof z.wert === 'number' ? String(z.wert) : '')

function kopfSpalte(titel: string, spalte: number): VorlageSpalte | null {
  const t = titel.replace(/\s+/g, ' ').trim()
  const m = /^(Ansatz|Ist|tatsächlich)\s+(\d{4})\b/i.exec(t)
  if (!m) return null
  // Sonderspalten wie „2019 ohne MS-Office …“ beginnen nicht mit Ansatz/Ist.
  return { spalte, jahr: Number(m[2]), art: /^ansatz/i.test(m[1]) ? 'ansatz' : 'ist', titel: t }
}

/** Findet das Blatt mit Ansatz-/Ist-Köpfen (F10: nicht einfach das erste). */
export function findeVorlagenBlatt(blaetter: Blatt[]): Blatt {
  for (const b of blaetter) {
    for (let r = 0; r < Math.min(5, b.zeilen.length); r++) {
      const z = b.zeilen[r] ?? []
      if (z.filter((c, i) => c && kopfSpalte(textVon(c), i)).length >= 2) return b
    }
  }
  throw new Error('In der Datei wurde keine Tabelle mit Spalten „Ansatz JJJJ“ und „Ist JJJJ“ gefunden.')
}

export function leseVorlage(blaetter: Blatt[], neueId: () => string): VorlageImport {
  const blatt = findeVorlagenBlatt(blaetter)
  const hinweise: string[] = []
  // Kopfzeile = erste Zeile mit mindestens zwei Ansatz/Ist-Köpfen.
  let kopfZeile = 0
  for (let r = 0; r < Math.min(5, blatt.zeilen.length); r++) {
    if ((blatt.zeilen[r] ?? []).filter((c, i) => c && kopfSpalte(textVon(c), i)).length >= 2) {
      kopfZeile = r
      break
    }
  }
  const spalten: VorlageSpalte[] = []
  const ignorierteSpalten: string[] = []
  ;(blatt.zeilen[kopfZeile] ?? []).forEach((c, i) => {
    if (i < 3 || !c) return
    const t = textVon(c)
    if (!t) return
    const s = kopfSpalte(t, i)
    if (s) spalten.push(s)
    else ignorierteSpalten.push(t.replace(/\s+/g, ' '))
  })

  const stellen: Stelle[] = []
  const werte: VorlageImport['werte'] = {}
  const kontostand: VorlageImport['kontostand'] = {}
  let bereich: 'einnahme' | 'ausgabe' | null = null
  let gruppe: Stelle | null = null

  type Roh = { cent: Cent; formel: boolean } | { text: string }
  const zellwert = (z: Zelle | undefined, wo: string): Roh | null => {
    if (!z || z.wert === null) {
      if (z?.formel) hinweise.push(`${wo}: Formel ohne gespeicherten Wert — bleibt leer.`)
      return null
    }
    if (typeof z.wert === 'string') {
      const t = z.wert.trim()
      if (!t) return null
      hinweise.push(`${wo}: Text „${t}“ statt Zahl — als Text übernommen.`)
      return { text: t }
    }
    const c = euroZuCent(z.wert)
    if (c === null) {
      hinweise.push(`${wo}: ${z.wert} hat mehr als zwei Nachkommastellen — bitte prüfen, nicht übernommen.`)
      return null
    }
    return { cent: c, formel: z.formel !== undefined }
  }

  for (let r = kopfZeile + 1; r < blatt.zeilen.length; r++) {
    const zeile = blatt.zeilen[r] ?? []
    const a = textVon(zeile[0])
    const b = textVon(zeile[1])
    const c = textVon(zeile[2])
    if (!a && !b && !c) continue
    const wo = `Zeile ${r + 1}`
    if (/^einnahmen$/i.test(c)) {
      bereich = 'einnahme'
      gruppe = null
      continue
    }
    if (/^ausgaben$/i.test(c)) {
      bereich = 'ausgabe'
      gruppe = null
      continue
    }
    if (/^kontostand/i.test(c)) {
      const art = /31\.?\s*dez|ende/i.test(c) ? 'ende' : /0?1\.?\s*jan|anfang/i.test(c) ? 'anfang' : null
      if (!art) continue
      for (const s of spalten) {
        const z = zeile[s.spalte]
        if (!z || typeof z.wert !== 'number') continue
        const ct = euroZuCent(z.wert)
        if (ct === null) continue
        if (z.formel) hinweise.push(`${wo}, ${s.titel}: Kontostand stammt aus der Formel „=${z.formel}“ — bitte prüfen.`)
        ;(kontostand[s.jahr] ??= {})[art] = ct
      }
      continue
    }
    if (/^(summe|saldo|gesamt)/i.test(c) || (!a && !b)) continue
    if (!bereich) {
      hinweise.push(`${wo}: „${c}“ steht vor „Einnahmen“/„Ausgaben“ — übersprungen.`)
      continue
    }
    if (!b) {
      hinweise.push(`${wo}: „${c}“ hat keine Kurzbezeichnung (Spalte B) — übersprungen.`)
      continue
    }
    const istGruppe = /^\d+$/.test(b)
    if (!istGruppe && !gruppe) {
      hinweise.push(`${wo}: Unterstelle „${b} ${c}“ ohne vorangehende Hauptgruppe — übersprungen.`)
      continue
    }
    const stelle: Stelle = {
      id: neueId(),
      nummer: /^\d{3,5}$/.test(a) ? a : '',
      kurz: b,
      name: c || b,
      bereich,
      ...(istGruppe ? {} : { parentId: gruppe!.id }),
    }
    stellen.push(stelle)
    if (istGruppe) gruppe = stelle
    for (const s of spalten) {
      const w = zellwert(zeile[s.spalte], `${wo}, ${s.titel}`)
      if (!w) continue
      // Formeln in Hauptgruppen sind Summen der Unterstellen — abgeleitet, nicht übernehmen.
      if ('cent' in w && w.formel && istGruppe) continue
      const ziel = ((werte[s.jahr] ??= {})[stelle.id] ??= {})
      if ('text' in w) ziel.text = w.text
      else ziel[s.art] = w.cent
    }
  }
  for (const [j, k] of Object.entries(kontostand)) {
    const n = kontostand[Number(j) + 1]?.anfang
    if (k.ende !== undefined && n !== undefined && n !== k.ende) {
      hinweise.push(`Kontostand Ende ${j} (${(k.ende / 100).toFixed(2)}) ≠ Anfang ${Number(j) + 1} (${(n / 100).toFixed(2)}).`)
    }
  }
  if (!stellen.length) throw new Error('In der Tabelle wurden keine Haushaltsstellen erkannt (Spalten A–C, Abschnitte „Einnahmen“/„Ausgaben“).')
  return { blatt: blatt.name, stellen, spalten, werte, kontostand, hinweise, ignorierteSpalten }
}

// ─── Bericht ─────────────────────────────────────────────────────────────────

export interface BerichtSpalte {
  jahr: number
  art: 'ansatz' | 'ist'
  /** 'vorjahr' = feste Zahlen aus dem Erstimport; 'buchungen' = aus den Jahresdateien gerechnet. */
  quelle: 'vorjahr' | 'buchungen'
}

export interface BerichtDaten {
  titel: string
  stand: string
  spalten: BerichtSpalte[]
  stellen: Stelle[]
  /** Stelle.id → Spaltenindex → Wert (Cent) oder Text. */
  werte: Record<string, Array<Cent | string | null>>
}

export interface BerichtEingabe {
  stamm: Stammdaten
  /** Jahresdateien, nach Jahr. */
  jahre: Jahr[]
  von: number
  bis: number
  /** Ansatz des Folgejahres (bis + 1) zusätzlich ausgeben, falls vorhanden. */
  mitFolgeansatz: boolean
  stand: string
}

/** Ursprungsansatz einer Zeile: eigener + nicht durchlaufende Unterstellen. */
function ansatzZeile(stellen: Stelle[], j: Jahr, s: Stelle): Cent | null {
  const ids = [s.id, ...(s.parentId ? [] : stellen.filter(k => k.parentId === s.id && !k.durchlaufend).map(k => k.id))]
  let summe = 0
  let da = false
  for (const id of ids) if (j.ansatz[id] !== undefined) {
    summe += j.ansatz[id]
    da = true
  }
  return da ? summe : null
}

export function berichtDaten(e: BerichtEingabe): BerichtDaten {
  const { stamm } = e
  const jahrMap = new Map(e.jahre.map(j => [j.jahr, j]))
  const spalten: BerichtSpalte[] = []
  for (let y = e.von; y <= e.bis; y++) {
    const quelle = jahrMap.has(y) ? 'buchungen' : stamm.vorjahre[y] ? 'vorjahr' : null
    if (!quelle) continue
    spalten.push({ jahr: y, art: 'ansatz', quelle }, { jahr: y, art: 'ist', quelle })
  }
  const folge = jahrMap.get(e.bis + 1)
  if (e.mitFolgeansatz && (folge || stamm.vorjahre[e.bis + 1])) spalten.push({ jahr: e.bis + 1, art: 'ansatz', quelle: folge ? 'buchungen' : 'vorjahr' })

  const werte: BerichtDaten['werte'] = {}
  for (const s of stamm.stellen) werte[s.id] = spalten.map(() => null)
  spalten.forEach((sp, i) => {
    if (sp.quelle === 'vorjahr') {
      const vj = stamm.vorjahre[sp.jahr] ?? {}
      for (const s of stamm.stellen) {
        const w = vj[s.id]
        if (!w) continue
        const v = w[sp.art]
        werte[s.id][i] = v !== undefined ? v : sp.art === 'ist' && w.text ? w.text : null
      }
      return
    }
    const j = jahrMap.get(sp.jahr)!
    const stellen = stellenFuer(stamm, j)
    if (sp.art === 'ansatz') {
      for (const s of stamm.stellen) werte[s.id][i] = ansatzZeile(stellen, j, s)
      return
    }
    const u = uebersicht(stamm, j)
    for (const z of u.zeilen) if (werte[z.stelle.id]) werte[z.stelle.id][i] = z.ist
  })
  return { titel: stamm.einrichtung ? `Haushalt ${stamm.einrichtung}` : 'Haushalt', stand: e.stand, spalten, stellen: stamm.stellen, werte }
}

const euro = (c: Cent | null): number | null => (c === null ? null : c / 100)

/**
 * Tabelle im Layout der Vorlage, mit Summenformeln. Gruppenzeilen sind die Summe ihrer nicht
 * durchlaufenden Unterstellen (gespeicherter Wert aus der Rechnung, Formel für Excel).
 */
export function berichtZeilen(d: BerichtDaten, stamm: Stammdaten, jahre: Jahr[]): { zeilen: Array<Array<SchreibZelle | null>>; breiten: number[] } {
  const COL0 = 3
  const zeilen: Array<Array<SchreibZelle | null>> = []
  const kopf: Array<SchreibZelle | null> = [{ wert: '', stil: 'kopf' }, { wert: '', stil: 'kopf' }, { wert: `${d.titel} — Stand ${d.stand}`, stil: 'kopf' }]
  for (const s of d.spalten) kopf.push({ wert: `${s.art === 'ansatz' ? 'Ansatz' : 'Ist'} ${s.jahr}`, stil: 'kopf' })
  zeilen.push(kopf)

  const zeileNr = () => zeilen.length + 1 // 1-basiert für die nächste Zeile
  const col = (i: number) => spaltenName(COL0 + i)

  // Kontostand 1.1.
  const jahrMap = new Map(jahre.map(j => [j.jahr, j]))
  const konto = (art: 'anfang' | 'ende'): Array<SchreibZelle | null> => {
    const z: Array<SchreibZelle | null> = [null, null, { wert: art === 'anfang' ? 'Kontostand per 01. Januar' : 'Kontostand per 31. Dezember', stil: 'fett' }]
    for (const s of d.spalten) {
      if (s.art !== 'ist') {
        z.push(null)
        continue
      }
      let v: Cent | undefined
      if (s.quelle === 'buchungen') {
        const j = jahrMap.get(s.jahr)!
        v = art === 'anfang' ? j.anfangsbestand : uebersicht(stamm, j).guthaben.unsere
      } else v = stamm.vorjahrKontostand[s.jahr]?.[art]
      z.push(v === undefined ? null : { wert: euro(v), stil: 'euroFett' })
    }
    return z
  }
  zeilen.push(konto('anfang'))
  zeilen.push([])

  const summenZeilen: Record<'einnahme' | 'ausgabe', { mit: number[]; ohne: number[] }> = { einnahme: { mit: [], ohne: [] }, ausgabe: { mit: [], ohne: [] } }
  for (const bereich of ['einnahme', 'ausgabe'] as const) {
    zeilen.push([null, null, { wert: bereich === 'einnahme' ? 'Einnahmen' : 'Ausgaben', stil: 'fett' }])
    for (const g of d.stellen.filter(s => s.bereich === bereich && !s.parentId)) {
      const unter = d.stellen.filter(s => s.parentId === g.id)
      const gZeile = zeileNr()
      const uZeilen: number[] = []
      const gruppenZelle: Array<SchreibZelle | null> = [
        g.nummer ? { wert: Number(g.nummer) || g.nummer, stil: 'fett' } : null,
        { wert: /^\d+$/.test(g.kurz) ? Number(g.kurz) : g.kurz, stil: 'fett' },
        { wert: g.name + (g.durchlaufend ? ' (durchlaufend)' : ''), stil: 'fett' },
      ]
      zeilen.push(gruppenZelle)
      for (const u of unter) {
        uZeilen.push(zeileNr())
        const z: Array<SchreibZelle | null> = [u.nummer ? { wert: Number(u.nummer) || u.nummer } : null, { wert: u.kurz }, { wert: u.name + (u.durchlaufend ? ' (durchlaufend)' : '') }]
        d.spalten.forEach((_, i) => {
          const v = d.werte[u.id]?.[i] ?? null
          z.push(v === null ? null : typeof v === 'string' ? { wert: v } : { wert: euro(v), stil: 'euro' })
        })
        zeilen.push(z)
      }
      const zaehlende = unter.map((u, k) => (u.durchlaufend ? null : uZeilen[k])).filter((n): n is number => n !== null)
      d.spalten.forEach((sp, i) => {
        const v = d.werte[g.id]?.[i] ?? null
        const c = col(i)
        // Gruppen mit Unterstellen: in gerechneten Jahren Ist (und Ansatz ohne eigenen Wert) als Summenformel.
        // Vorjahre bleiben, wie sie in der Vorlage standen — Geschichte wird nicht nachgerechnet.
        if (zaehlende.length && v === null || (zaehlende.length && sp.quelle === 'buchungen' && sp.art === 'ist')) {
          let summe = 0
          let da = false
          for (const u of unter) {
            if (u.durchlaufend) continue
            const uv = d.werte[u.id]?.[i]
            if (typeof uv === 'number') {
              summe += uv
              da = true
            }
          }
          gruppenZelle.push(da ? { wert: euro(summe), formel: zaehlende.map(n => `${c}${n}`).join('+'), stil: 'euroFett' } : null)
          return
        }
        gruppenZelle.push(v === null ? null : typeof v === 'string' ? { wert: v, stil: 'fett' } : { wert: euro(v), stil: 'euroFett' })
      })
      const ziel = summenZeilen[bereich]
      ziel.mit.push(gZeile)
      for (const n of uZeilen.filter((_, k) => unter[k].durchlaufend)) ziel.mit.push(n)
      if (!g.durchlaufend) ziel.ohne.push(gZeile)
    }
    const summe = (welche: 'mit' | 'ohne', titel: string) => {
      const nrs = summenZeilen[bereich][welche]
      const z: Array<SchreibZelle | null> = [null, null, { wert: titel, stil: 'fett' }]
      d.spalten.forEach((_, i) => {
        const c = col(i)
        z.push(nrs.length ? { wert: null, formel: nrs.map(n => `${c}${n}`).join('+'), stil: 'euroFett' } : null)
      })
      return z
    }
    const label = bereich === 'einnahme' ? 'Einnahmen' : 'Ausgaben'
    const mitNr = zeileNr()
    zeilen.push(summe('mit', `Summe ${label} (mit durchlaufenden Posten)`))
    zeilen.push(summe('ohne', `Summe ${label} (ohne durchlaufende Posten)`))
    ;(summenZeilen[bereich] as { mit: number[]; ohne: number[]; zeile?: number }).zeile = mitNr
    zeilen.push([])
  }
  const eNr = (summenZeilen.einnahme as { zeile?: number }).zeile!
  const aNr = (summenZeilen.ausgabe as { zeile?: number }).zeile!
  const saldo: Array<SchreibZelle | null> = [null, null, { wert: 'Saldo Einnahmen / Ausgaben', stil: 'fett' }]
  d.spalten.forEach((sp, i) => saldo.push(sp.art === 'ist' ? { wert: null, formel: `${col(i)}${eNr}-${col(i)}${aNr}`, stil: 'euroFett' } : null))
  zeilen.push(saldo)
  zeilen.push(konto('ende'))

  // Zwischengespeicherte Werte der Summenformeln nachrechnen (für Anzeigen ohne Neuberechnung).
  for (const z of zeilen) {
    for (const zelle of z) {
      if (!zelle?.formel || zelle.wert !== null) continue
      zelle.wert = rechneFormel(zelle.formel, zeilen)
    }
  }
  const breiten = [8, 6, 42, ...d.spalten.map(() => 15)]
  return { zeilen, breiten }
}

/** Nur „A1+B2-C3“: Summen/Differenzen von Zellbezügen. */
function rechneFormel(f: string, zeilen: Array<Array<SchreibZelle | null>>): number | null {
  let summe = 0
  for (const m of f.matchAll(/([+-]?)([A-Z]+)(\d+)/g)) {
    let c = 0
    for (const ch of m[2]) c = c * 26 + (ch.charCodeAt(0) - 64)
    const z = zeilen[Number(m[3]) - 1]?.[c - 1]
    const v = typeof z?.wert === 'number' ? z.wert : 0
    summe += m[1] === '-' ? -v : v
  }
  return Math.round(summe * 100) / 100
}
