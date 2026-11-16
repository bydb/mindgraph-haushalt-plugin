// Minimales XLSX lesen und schreiben, reines JS (fflate), keine Node-Built-ins, kein DOMParser
// (der Main-Prozess hat keinen). Nur das, was die Haushaltsvorlage braucht: ein Blatt, Text, Zahlen,
// Formeln mit zwischengespeichertem Wert. Bauplan Abschnitt 7/8, Findings F09/F10.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

/** Obergrenze je entpacktem Teil — Schutz gegen präparierte Dateien („Zip-Bombe“). */
const MAX_TEIL = 30 * 1024 * 1024

export interface Zelle {
  /** Zahl (zwischengespeicherter Wert bei Formeln) oder Text. */
  wert: number | string | null
  formel?: string
}

export interface Blatt {
  name: string
  /** zeilen[r][c], 0-basiert. */
  zeilen: Array<Array<Zelle | undefined>>
}

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    const l = e.toLowerCase()
    if (l === 'lt') return '<'
    if (l === 'gt') return '>'
    if (l === 'amp') return '&'
    if (l === 'quot') return '"'
    if (l === 'apos') return "'"
    const cp = l.startsWith('#x') ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10)
    return Number.isFinite(cp) ? String.fromCodePoint(cp) : ''
  })
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return m ? decodeXml(m[1]) : undefined
}

/** Text aus <t>…</t>, auch über mehrere Runs (<r><t>…</t></r>). */
function texte(xml: string): string {
  let out = ''
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decodeXml(m[1] ?? '')
  return out
}

/** „AB12“ → { c: 27, r: 11 } (0-basiert). */
export function zellAdresse(ref: string): { c: number; r: number } | null {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(ref)
  if (!m) return null
  let c = 0
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { c: c - 1, r: Number(m[2]) - 1 }
}

export function spaltenName(c: number): string {
  let n = c + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function aufloesen(basis: string, ziel: string): string {
  if (ziel.startsWith('/')) return ziel.slice(1)
  const teile = basis.split('/').slice(0, -1)
  for (const seg of ziel.split('/')) {
    if (seg === '..') teile.pop()
    else if (seg && seg !== '.') teile.push(seg)
  }
  return teile.join('/')
}

/** Liest alle Blätter in Workbook-Reihenfolge (F10: über workbook.xml + Relations, nicht sheet1.xml). */
export function leseXlsx(bytes: Uint8Array): Blatt[] {
  let dateien: Record<string, Uint8Array>
  try {
    dateien = unzipSync(bytes, {
      filter: f => {
        if (f.originalSize > MAX_TEIL) throw new Error(`Teil ${f.name} ist zu groß.`)
        return f.name.endsWith('.xml') || f.name.endsWith('.rels')
      },
    })
  } catch (err) {
    throw new Error(`Die Datei ist keine lesbare Excel-Datei (.xlsx): ${err instanceof Error ? err.message : String(err)}`)
  }
  const text = (p: string): string | null => (dateien[p] ? strFromU8(dateien[p]) : null)
  const wb = text('xl/workbook.xml')
  if (!wb) throw new Error('Die Datei ist keine Excel-Datei (xl/workbook.xml fehlt). Ältere .xls bitte in Excel als .xlsx speichern.')
  const rels = text('xl/_rels/workbook.xml.rels') ?? ''
  const relZiel = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    const t = attr(m[0], 'Target')
    if (id && t) relZiel.set(id, aufloesen('xl/workbook.xml', t))
  }

  const shared: string[] = []
  const ss = text('xl/sharedStrings.xml')
  if (ss) for (const m of ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(texte(m[1]))

  const blaetter: Blatt[] = []
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attr(m[0], 'name') ?? ''
    const rid = attr(m[0], 'r:id')
    const pfad = rid ? relZiel.get(rid) : undefined
    const xml = pfad ? text(pfad) : null
    if (!xml) continue
    const zeilen: Blatt['zeilen'] = []
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const kopf = c[1]
      const inhalt = c[2] ?? ''
      const ref = attr(`<c${kopf}>`, 'r')
      const pos = ref ? zellAdresse(ref) : null
      if (!pos) continue
      const typ = attr(`<c${kopf}>`, 't')
      const f = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inhalt)?.[1]
      const v = /<v>([\s\S]*?)<\/v>/.exec(inhalt)?.[1]
      let wert: Zelle['wert'] = null
      if (typ === 's') wert = v !== undefined ? (shared[Number(v)] ?? null) : null
      else if (typ === 'inlineStr') wert = texte(/<is>([\s\S]*?)<\/is>/.exec(inhalt)?.[1] ?? '')
      else if (typ === 'str' || typ === 'e') wert = v !== undefined ? decodeXml(v) : null
      else if (typ === 'b') wert = v === '1' ? 'WAHR' : 'FALSCH'
      else if (v !== undefined && v.trim() !== '') {
        const n = Number(v)
        wert = Number.isFinite(n) ? n : decodeXml(v)
      }
      if (wert === null && f === undefined) continue
      ;(zeilen[pos.r] ??= [])[pos.c] = { wert, ...(f !== undefined ? { formel: decodeXml(f) } : {}) }
    }
    blaetter.push({ name, zeilen })
  }
  if (!blaetter.length) throw new Error('Die Excel-Datei enthält kein lesbares Tabellenblatt.')
  return blaetter
}

// ─── Schreiben ───────────────────────────────────────────────────────────────

export type Stil = 'normal' | 'fett' | 'euro' | 'euroFett' | 'kopf'

export interface SchreibZelle {
  wert: number | string | null
  /** Formel ohne „=“; `wert` ist dann der zwischengespeicherte Wert. */
  formel?: string
  stil?: Stil
}

const STIL_INDEX: Record<Stil, number> = { normal: 0, fett: 1, euro: 2, euroFett: 3, kopf: 4 }

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

export function schreibeXlsx(blattName: string, zeilen: Array<Array<SchreibZelle | null>>, spaltenBreiten: number[] = []): Uint8Array {
  const rows: string[] = []
  zeilen.forEach((zeile, r) => {
    const cells: string[] = []
    zeile.forEach((z, c) => {
      if (!z || (z.wert === null && !z.formel)) return
      const ref = `${spaltenName(c)}${r + 1}`
      const s = STIL_INDEX[z.stil ?? 'normal']
      const sAttr = s ? ` s="${s}"` : ''
      if (z.formel) {
        const v = typeof z.wert === 'number' ? `<v>${z.wert}</v>` : ''
        cells.push(`<c r="${ref}"${sAttr}><f>${escapeXml(z.formel)}</f>${v}</c>`)
      } else if (typeof z.wert === 'number') {
        cells.push(`<c r="${ref}"${sAttr}><v>${z.wert}</v></c>`)
      } else {
        cells.push(`<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(z.wert))}</t></is></c>`)
      }
    })
    rows.push(`<row r="${r + 1}">${cells.join('')}</row>`)
  })
  const cols = spaltenBreiten.length
    ? `<cols>${spaltenBreiten.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : ''
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane xSplit="3" ySplit="1" topLeftCell="D2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows.join('')}</sheetData></worksheet>`
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(blattName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }
  // Feste Zeitstempel → gleiche Eingabe, gleiche Bytes.
  return zipSync(files, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') })
}
