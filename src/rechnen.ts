// Rechenregeln des Nebenbuchs. Rein und getestet. Fachregeln: docs/bauplan.md, Abschnitt 2 und 5.
//
// Begriffe je Zeile:
//   ansatz      Ursprungsansatz (eigener + der nicht durchlaufenden Unterstellen)
//   aenderungen Summe der Ansatzänderungen (gleiche Regel)
//   wirksam     ansatz + aenderungen
//   ist         angeordnet + vom Kreis gebucht (ohne zurückgezogene, Storno zieht ab)
//   bestaetigt  nur der vom Kreis gebuchte Teil
//   vorgemerkt  nur Vormerkungen
//   frei        wirksam − ist − vorgemerkt

import type { Cent } from './geld'
import { type Bereich, type Buchung, type Jahr, type Stammdaten, type Stelle, bestaetigt, stellenFuer, wirkung, zaehltZumIst } from './model'

export interface Werte {
  ansatz: Cent
  aenderungen: Cent
  wirksam: Cent
  ist: Cent
  bestaetigt: Cent
  vorgemerkt: Cent
  frei: Cent
}

export interface Zeile extends Werte {
  stelle: Stelle
  ebene: 0 | 1
  /** Ausgabe: frei < 0 bei vorhandenem Ansatz. Einnahme: nie. */
  ueberschritten: boolean
}

export interface Uebersicht {
  zeilen: Zeile[]
  summen: Record<Bereich, { mit: Werte; ohne: Werte }>
  guthaben: {
    anfang: Cent
    /** Nach unseren Buchungen (Ist). */
    unsere: Cent
    /** Nur was der Kreis bestätigt hat. */
    kreis: Cent
    /** Noch nicht vom Kreis bestätigt: Einnahmen − Ausgaben (inkl. offener Posten der Vorjahre). */
    offen: Cent
    /** Davon aus Vorjahren übernommen (F13). */
    vorjahrOffen: Cent
  }
  /** Buchungen auf Stellen, die es in der Gliederung nicht (mehr) gibt — dürfen nicht still verschwinden. */
  unbekannteStellen: string[]
}

const null0 = (): Werte => ({ ansatz: 0, aenderungen: 0, wirksam: 0, ist: 0, bestaetigt: 0, vorgemerkt: 0, frei: 0 })

function add(a: Werte, b: Werte): Werte {
  return {
    ansatz: a.ansatz + b.ansatz,
    aenderungen: a.aenderungen + b.aenderungen,
    wirksam: a.wirksam + b.wirksam,
    ist: a.ist + b.ist,
    bestaetigt: a.bestaetigt + b.bestaetigt,
    vorgemerkt: a.vorgemerkt + b.vorgemerkt,
    frei: a.frei + b.frei,
  }
}

/** Bestätigter Anteil einer Buchung, vorzeichenrichtig (Storno zieht ab), höchstens ihr Betrag. */
function bestaetigtWirkung(jahr: Jahr, b: Buchung): Cent {
  if (!zaehltZumIst(b)) return 0
  const v = Math.min(bestaetigt(jahr, b.id), b.betrag)
  return b.stornoVon ? -v : v
}

/** Werte nur aus Daten, die direkt an dieser Stelle hängen (ohne Unterstellen). */
function direkt(jahr: Jahr, stelleId: string): Werte {
  const w = null0()
  w.ansatz = jahr.ansatz[stelleId] ?? 0
  for (const a of jahr.aenderungen) if (a.stelleId === stelleId) w.aenderungen += a.betrag
  for (const b of jahr.buchungen) {
    if (b.stelleId !== stelleId || b.zurueckgezogen || b.uebertragenNach) continue
    if (b.status === 'vorgemerkt') w.vorgemerkt += wirkung(b)
    else {
      w.ist += wirkung(b)
      w.bestaetigt += bestaetigtWirkung(jahr, b)
    }
  }
  w.wirksam = w.ansatz + w.aenderungen
  w.frei = w.wirksam - w.ist - w.vorgemerkt
  return w
}

/**
 * @param vorjahrOffen  Noch nicht vom Kreis bestätigter Saldo der Vorjahre, wenn der Anfangsbestand aus einem
 *                      Abschluss stammt (F13). Der Kreis-Stand beginnt dann um diesen Betrag anders als unserer.
 */
export function uebersicht(stamm: Stammdaten, jahr: Jahr, vorjahrOffen: Cent = 0): Uebersicht {
  const stellen = stellenFuer(stamm, jahr)
  const zeilen: Zeile[] = []
  const summen: Uebersicht['summen'] = {
    einnahme: { mit: null0(), ohne: null0() },
    ausgabe: { mit: null0(), ohne: null0() },
  }
  const zeile = (stelle: Stelle, ebene: 0 | 1, w: Werte): Zeile => ({
    ...w,
    stelle,
    ebene,
    ueberschritten: stelle.bereich === 'ausgabe' && (w.wirksam !== 0 || w.ist !== 0) && w.frei < 0,
  })

  for (const g of stellen.filter(s => !s.parentId)) {
    const unter = stellen.filter(s => s.parentId === g.id)
    const eigene = direkt(jahr, g.id)
    let gruppe = eigene
    const unterZeilen: Zeile[] = []
    for (const u of unter) {
      const w = direkt(jahr, u.id)
      unterZeilen.push(zeile(u, 1, w))
      summen[u.bereich].mit = add(summen[u.bereich].mit, w)
      if (u.durchlaufend || g.durchlaufend) continue
      gruppe = add(gruppe, w)
      summen[u.bereich].ohne = add(summen[u.bereich].ohne, w)
    }
    zeilen.push(zeile(g, 0, gruppe), ...unterZeilen)
    summen[g.bereich].mit = add(summen[g.bereich].mit, eigene)
    if (!g.durchlaufend) summen[g.bereich].ohne = add(summen[g.bereich].ohne, eigene)
  }

  const bekannt = new Set(stellen.map(s => s.id))
  const unbekannteStellen = [...new Set(jahr.buchungen.filter(b => !bekannt.has(b.stelleId) && !b.zurueckgezogen).map(b => b.stelleId))]

  // Guthaben über ALLE Buchungen (auch durchlaufende), nach Bereich der Stelle.
  const bereichVon = new Map(stellen.map(s => [s.id, s.bereich]))
  let unsere = jahr.anfangsbestand
  let kreis = jahr.anfangsbestand - vorjahrOffen
  for (const b of jahr.buchungen) {
    if (!zaehltZumIst(b)) continue
    const vz = bereichVon.get(b.stelleId) === 'einnahme' ? 1 : -1
    unsere += vz * wirkung(b)
    kreis += vz * bestaetigtWirkung(jahr, b)
  }
  return { zeilen, summen, guthaben: { anfang: jahr.anfangsbestand, unsere, kreis, offen: unsere - kreis, vorjahrOffen }, unbekannteStellen }
}

// ─── Jahresabschluss ─────────────────────────────────────────────────────────

export interface AbschlussVorschlag {
  endstand: Cent
  /** Rest je Ausgaben-Hauptgruppe mit Ansatz, nur wenn > 0. */
  uebertraege: Array<{ stelleId: string; rest: Cent }>
  offeneVormerkungen: Buchung[]
  offeneAnordnungen: Buchung[]
  /** Hindernisse, die vor dem Abschluss behoben werden müssen. */
  hindernisse: string[]
}

export function abschlussVorschlag(stamm: Stammdaten, jahr: Jahr): AbschlussVorschlag {
  const u = uebersicht(stamm, jahr)
  const hindernisse: string[] = []
  if (jahr.gesperrt) hindernisse.push(`${jahr.jahr} ist bereits abgeschlossen.`)
  if (u.unbekannteStellen.length) hindernisse.push(`Buchungen auf unbekannten Stellen: ${u.unbekannteStellen.join(', ')}`)
  return {
    endstand: u.guthaben.unsere,
    uebertraege: u.zeilen
      .filter(z => z.ebene === 0 && z.stelle.bereich === 'ausgabe' && !z.stelle.durchlaufend && z.wirksam > 0 && z.frei + z.vorgemerkt > 0)
      // Vormerkungen sind noch nicht ausgegeben: der Rest ohne sie ist das, was übertragen werden kann.
      .map(z => ({ stelleId: z.stelle.id, rest: z.frei + z.vorgemerkt })),
    offeneVormerkungen: jahr.buchungen.filter(b => b.status === 'vorgemerkt' && !b.zurueckgezogen && !b.uebertragenNach),
    offeneAnordnungen: jahr.buchungen.filter(b => zaehltZumIst(b) && bestaetigt(jahr, b.id) < b.betrag),
    hindernisse,
  }
}
