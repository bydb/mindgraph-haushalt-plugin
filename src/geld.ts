// Geldbeträge: immer ganzzahlige Cent. Nie mit Gleitkomma-Euro rechnen.

export type Cent = number

/** Symmetrisch um null runden (Math.round(-2.5) wäre -2). Aus Faktura übernommen. */
export function roundCents(x: number): Cent {
  return Math.sign(x) * Math.round(Math.abs(x))
}

/** 1234567 → "12.345,67" (deutsches Format, ohne Währung). */
export function formatCent(c: Cent): string {
  const neg = c < 0
  const abs = Math.abs(Math.trunc(c))
  const euro = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const cent = String(abs % 100).padStart(2, '0')
  return `${neg ? '−' : ''}${euro},${cent}`
}

export function formatEuro(c: Cent): string {
  return `${formatCent(c)} €`
}

/**
 * Deutsche Eingabe „1.234,56“, „1234,5“, „-12“ oder „1234.56“ (ein Punkt mit ≤2 Nachkommastellen
 * gilt als Dezimalpunkt) → Cent. Ungültig → null. Nie raten: „1.234.5“ ist ungültig.
 */
export function parseEuroDe(input: string): Cent | null {
  let s = String(input ?? '').trim().replace(/\s|€/g, '').replace(/^−/, '-')
  if (!s) return null
  const neg = s.startsWith('-')
  if (neg || s.startsWith('+')) s = s.slice(1)
  let euro: string
  let cent = ''
  if (s.includes(',')) {
    const [a, b, ...rest] = s.split(',')
    if (rest.length || !/^\d{1,2}$/.test(b ?? '')) return null
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(a)) return null
    euro = a.replace(/\./g, '')
    cent = b
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    ;[euro, cent] = s.split('.')
  } else if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(s)) {
    euro = s.replace(/\./g, '')
  } else return null
  const v = Number(euro) * 100 + Number(cent.padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(v)) return null
  return neg ? -v : v
}
