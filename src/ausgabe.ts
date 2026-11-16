// Ausgaben als Text: HTML für das PDF der Steuerungsgruppen-Tabelle und CSV der Buchungen. Rein.

import { formatCent } from './geld'
import { type Jahr, type Stammdaten, STATUS_LABEL, stelleLabel, stellenFuer, statusVon } from './model'
import type { SchreibZelle } from './xlsx'

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

const zahl = (v: number) => formatCent(Math.round(v * 100))

/** Dieselben Zeilen wie im Excel-Bericht, als druckbare Tabelle im Querformat. */
export function berichtHtml(titel: string, untertitel: string, zeilen: Array<Array<SchreibZelle | null>>): string {
  const breite = Math.max(...zeilen.map(z => z.length))
  const kopf = zeilen[0] ?? []
  const th = Array.from({ length: breite }, (_, i) => `<th>${esc(i === 2 ? '' : kopf[i]?.wert ?? '')}</th>`).join('')
  const rows = zeilen.slice(1).map(z => {
    if (!z.length) return `<tr class="leer"><td colspan="${breite}"></td></tr>`
    const fett = z.some(c => c?.stil === 'fett' || c?.stil === 'euroFett')
    const tds = Array.from({ length: breite }, (_, i) => {
      const c = z[i]
      if (!c || c.wert === null) return '<td></td>'
      const istZahl = typeof c.wert === 'number' && i >= 3
      return `<td class="${istZahl ? 'n' : ''}">${esc(istZahl ? zahl(c.wert as number) : c.wert)}</td>`
    }).join('')
    return `<tr class="${fett ? 'f' : ''}">${tds}</tr>`
  }).join('')
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>
@page { size: A4 landscape; margin: 12mm; }
body { font: 8.5pt/1.3 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; }
h1 { font-size: 13pt; margin: 0 0 2mm; } p { margin: 0 0 4mm; color: #555; }
table { border-collapse: collapse; width: 100%; }
th { background: #dce6f1; text-align: right; padding: 1.5mm 1.5mm; font-weight: 600; white-space: nowrap; }
th:nth-child(-n+3) { text-align: left; }
td { padding: 0.8mm 1.5mm; border-bottom: 0.2mm solid #e5e7eb; white-space: nowrap; }
td.n { text-align: right; font-variant-numeric: tabular-nums; }
tr.f td { font-weight: 600; }
tr.leer td { border: 0; height: 2mm; }
thead { display: table-header-group; }
</style></head><body><h1>${esc(titel)}</h1><p>${esc(untertitel)} · Beträge in Euro</p><table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></body></html>`
}

function csvFeld(v: string): string {
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** Alle Buchungen eines Jahres, Semikolon, deutsches Zahlenformat (Excel-tauglich). */
export function buchungenCsv(stamm: Stammdaten, j: Jahr): string {
  const stellen = stellenFuer(stamm, j)
  const kopf = ['Belegnr', 'Datum', 'Haushaltsstelle', 'Bereich', 'Empfänger/Einzahler', 'Verwendungszweck', 'Betrag', 'Status', 'Kreis gebucht am', 'Kreis-Stelle', 'Storno von', 'Zurückgezogen', 'Beleg']
  const zeilen = [kopf.join(';')]
  for (const b of [...j.buchungen].sort((a, c) => a.belegnr.localeCompare(c.belegnr))) {
    const s = stellen.find(x => x.id === b.stelleId)
    const kz = j.kreis.filter(z => z.teile.some(t => t.buchungId === b.id))
    const orig = b.stornoVon ? j.buchungen.find(x => x.id === b.stornoVon)?.belegnr ?? '' : ''
    const betrag = (b.stornoVon ? -1 : 1) * b.betrag
    zeilen.push([
      b.belegnr,
      b.datum.split('-').reverse().join('.'),
      s ? stelleLabel(s) : `(unbekannt ${b.stelleId})`,
      s?.bereich === 'einnahme' ? 'Einnahme' : 'Ausgabe',
      b.empfaenger,
      b.zweck,
      formatCent(betrag).replace('−', '-').replace(/\./g, ''),
      STATUS_LABEL[statusVon(j, b)],
      kz.map(z => z.datum.split('-').reverse().join('.')).join(', '),
      kz.map(z => z.kreisStelle ?? '').filter(Boolean).join(', '),
      orig,
      b.zurueckgezogen ? `${b.zurueckgezogen.am}: ${b.zurueckgezogen.grund}` : '',
      b.beleg ?? '',
    ].map(v => csvFeld(String(v))).join(';'))
  }
  return zeilen.join('\r\n') + '\r\n'
}
