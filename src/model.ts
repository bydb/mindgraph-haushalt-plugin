// Datenmodell des Haushalts-Nebenbuchs. Rein, ohne Host. Beträge in Cent.
// Fachregeln: docs/bauplan.md, Abschnitt 2.

import type { Cent } from './geld'

export const DATA_VERSION = 1
export const DEFAULT_FOLDER = 'Haushalt'
export const STAMM_FILE = 'haushalt.json'

export type Bereich = 'einnahme' | 'ausgabe'

export interface Stelle {
  id: string
  /** Vierstellige Haushaltsnummer; nicht eindeutig (Gruppe und Unterstellen teilen sie), darf fehlen. */
  nummer: string
  /** Kurzbezeichnung der Vorlage, z. B. „4“ oder „4a“. */
  kurz: string
  name: string
  bereich: Bereich
  /** Unterstelle → Hauptgruppe. Hauptgruppen haben keinen parentId. */
  parentId?: string
  /** Durchlaufender Posten: zählt nicht zur Gruppensumme und nicht zum Gruppenansatz. */
  durchlaufend?: boolean
  inaktiv?: boolean
}

export interface VorjahrWert {
  ansatz?: Cent
  ist?: Cent
  /** Text statt Zahl in der Vorlage, z. B. „Kein Zahlungseingang“. */
  text?: string
}

export interface Stammdaten {
  version: number
  einrichtung: string
  kontoBezeichnung: string
  stellen: Stelle[]
  /** Quicken-Kategoriepfad → Stelle.id */
  qifZuordnung: Record<string, string>
  /** Jahr → Stelle.id → Werte (feste Zahlen aus der Vorlage, nicht aus Buchungen). */
  vorjahre: Record<string, Record<string, VorjahrWert>>
  vorjahrKontostand: Record<string, { anfang?: Cent; ende?: Cent }>
  /** Jahre mit eigener Jahresdatei (der Vault-Dienst kann keine Ordner auflisten). */
  jahre: number[]
}

export type Status = 'vorgemerkt' | 'angeordnet' | 'gebucht'

export interface Buchung {
  id: string
  belegnr: string
  /** ISO-Datum des Belegs (Rechnungsdatum). */
  datum: string
  stelleId: string
  /** Immer > 0. Richtung ergibt sich aus Stelle.bereich, Storno kehrt um. */
  betrag: Cent
  empfaenger: string
  zweck: string
  /** Gespeichert sind nur vorgemerkt/angeordnet; `gebucht` wird aus den Kreiszuordnungen abgeleitet. */
  status: 'vorgemerkt' | 'angeordnet'
  angeordnetAm?: string
  beleg?: string
  stornoVon?: string
  storniertDurch?: string
  zurueckgezogen?: { am: string; grund: string }
  uebernommenAus?: { jahr: number; id: string }
  /** Vormerkung beim Abschluss ins Folgejahr übertragen (F22): zählt hier nicht mehr. */
  uebertragenNach?: { jahr: number; id: string }
  quelle: 'hand' | 'qif'
  qif?: { datei: string; satz: number; status: string; schluessel: string }
}

export interface KreisZuordnung {
  id: string
  teile: Array<{ buchungId: string; betrag: Cent }>
  datum: string
  kreisStelle?: string
  kreisVorgang?: string
  kreisText?: string
  quelle: 'hand' | 'kreisliste'
}

export type AenderungsArt = 'uebertrag' | 'nachtrag' | 'umschichtung' | 'sperre' | 'korrektur'

export interface Aenderung {
  id: string
  datum: string
  art: AenderungsArt
  stelleId: string
  /** Mit Vorzeichen: Sperre negativ, Umschichtung −/+ als Paar. */
  betrag: Cent
  bemerkung: string
  paarId?: string
  ausAbschluss?: string
}

export interface ProtokollEintrag {
  zeit: string
  aktion: string
  ref?: string
  vorher?: unknown
  nachher?: unknown
  grund?: string
}

export interface Jahr {
  version: number
  jahr: number
  gesperrt: boolean
  anfangsbestand: Cent
  /** Ursprungsansatz je Stelle (Gruppe oder Unterstelle). */
  ansatz: Record<string, Cent>
  aenderungen: Aenderung[]
  buchungen: Buchung[]
  kreis: KreisZuordnung[]
  naechsteNr: number
  abschluss?: { id: string; am: string; endstand: Cent }
  /** Anfangsbestand stammt unverändert aus diesem Abschluss des Vorjahres (F24). Fehlt nach Handkorrektur. */
  anfangAusAbschluss?: string
  /** Eingefrorene Gliederung eines gesperrten Jahres. */
  stellen?: Stelle[]
  protokoll: ProtokollEintrag[]
}

export const AENDERUNGS_ARTEN: Record<AenderungsArt, string> = {
  uebertrag: 'Übertrag aus Vorjahr',
  nachtrag: 'Nachtrag / Zuweisung',
  umschichtung: 'Umschichtung',
  sperre: 'Sperre',
  korrektur: 'Korrektur',
}

export const STATUS_LABEL: Record<Status, string> = {
  vorgemerkt: 'vorgemerkt',
  angeordnet: 'angeordnet',
  gebucht: 'vom Kreis gebucht',
}

/** Gültiges ISO-Datum JJJJ-MM-TT mit existierendem Kalendertag (F21: kein 30. Februar). */
export function istDatum(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** Ist die Stelle in irgendeinem Jahr oder in den Vorjahreswerten verwendet? */
export function stelleVerwendet(id: string, jahre: Jahr[], stamm: Stammdaten): boolean {
  return jahre.some(j => j.buchungen.some(b => b.stelleId === id) || j.ansatz[id] !== undefined || j.aenderungen.some(a => a.stelleId === id))
    || Object.values(stamm.vorjahre).some(w => w[id] !== undefined)
}

// ─── Belegnummern ────────────────────────────────────────────────────────────

/** „2026 025“ — Format der Quicken-Altdaten. */
export function belegNr(jahr: number, n: number): string {
  return `${jahr} ${String(n).padStart(3, '0')}`
}

/** „2026 025“ → 25, wenn das Jahr passt; sonst null. */
export function belegLaufnummer(nr: string, jahr: number): number | null {
  const m = /^(\d{4})\s+(\d{1,6})$/.exec(nr.trim())
  if (!m || Number(m[1]) !== jahr) return null
  return Number(m[2])
}

// ─── Normalisieren (Lesen fremder/alter Dateien) ─────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const cent = (v: unknown): Cent => (typeof v === 'number' && Number.isSafeInteger(v) ? v : 0)
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const obj = <T>(v: unknown): T => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : ({} as T))

export function leereStammdaten(): Stammdaten {
  return { version: DATA_VERSION, einrichtung: '', kontoBezeichnung: '', stellen: [], qifZuordnung: {}, vorjahre: {}, vorjahrKontostand: {}, jahre: [] }
}

export function normalizeStamm(raw: unknown): Stammdaten {
  const r = obj<Partial<Stammdaten>>(raw)
  return {
    version: DATA_VERSION,
    einrichtung: str(r.einrichtung),
    kontoBezeichnung: str(r.kontoBezeichnung),
    stellen: arr<Stelle>(r.stellen).filter(s => s && typeof s.id === 'string').map(s => ({
      id: s.id,
      nummer: str(s.nummer),
      kurz: str(s.kurz),
      name: str(s.name),
      bereich: s.bereich === 'einnahme' ? 'einnahme' : 'ausgabe',
      ...(s.parentId ? { parentId: str(s.parentId) } : {}),
      ...(s.durchlaufend ? { durchlaufend: true } : {}),
      ...(s.inaktiv ? { inaktiv: true } : {}),
    })),
    qifZuordnung: obj<Record<string, string>>(r.qifZuordnung),
    vorjahre: obj(r.vorjahre),
    vorjahrKontostand: obj(r.vorjahrKontostand),
    jahre: arr<number>(r.jahre).filter(j => Number.isInteger(j) && j > 1900 && j < 3000).sort((a, b) => a - b),
  }
}

export function leeresJahr(jahr: number): Jahr {
  return { version: DATA_VERSION, jahr, gesperrt: false, anfangsbestand: 0, ansatz: {}, aenderungen: [], buchungen: [], kreis: [], naechsteNr: 1, protokoll: [] }
}

export function normalizeJahr(raw: unknown, jahr: number): Jahr {
  const r = obj<Partial<Jahr>>(raw)
  if (typeof r.jahr === 'number' && r.jahr !== jahr) throw new Error(`Die Jahresdatei gehört zu ${r.jahr}, erwartet ${jahr}.`)
  return {
    version: DATA_VERSION,
    jahr,
    gesperrt: r.gesperrt === true,
    anfangsbestand: cent(r.anfangsbestand),
    ansatz: obj(r.ansatz),
    aenderungen: arr<Aenderung>(r.aenderungen),
    buchungen: arr<Buchung>(r.buchungen),
    kreis: arr<KreisZuordnung>(r.kreis),
    naechsteNr: typeof r.naechsteNr === 'number' && r.naechsteNr >= 1 ? r.naechsteNr : 1,
    ...(r.abschluss ? { abschluss: r.abschluss } : {}),
    ...(typeof r.anfangAusAbschluss === 'string' ? { anfangAusAbschluss: r.anfangAusAbschluss } : {}),
    ...(Array.isArray(r.stellen) ? { stellen: r.stellen } : {}),
    protokoll: arr<ProtokollEintrag>(r.protokoll),
  }
}

export function jahrRelPath(folder: string, jahr: number): string {
  return `${folder}/${jahr}/haushalt-${jahr}.json`
}

// ─── Gliederung ──────────────────────────────────────────────────────────────

export function stelleLabel(s: Stelle): string {
  return [s.nummer, s.kurz, s.name].filter(Boolean).join(' · ')
}

export function kinder(stellen: Stelle[], id: string): Stelle[] {
  return stellen.filter(s => s.parentId === id)
}

/** Bebuchbar ist eine Stelle ohne Unterstellen. */
export function bebuchbar(stellen: Stelle[], s: Stelle): boolean {
  return !stellen.some(k => k.parentId === s.id)
}

/** Die Gliederung, die für ein Jahr gilt: eingefroren, sonst die aktuelle. */
export function stellenFuer(stamm: Stammdaten, jahr: Jahr): Stelle[] {
  return jahr.stellen ?? stamm.stellen
}

/**
 * Prüft die Gliederung: eindeutige IDs, Eltern existieren und sind Hauptgruppen, gleicher Bereich.
 * Gibt Fehlermeldungen zurück (leer = in Ordnung).
 */
export function pruefeGliederung(stellen: Stelle[]): string[] {
  const fehler: string[] = []
  const ids = new Set<string>()
  for (const s of stellen) {
    if (ids.has(s.id)) fehler.push(`Doppelte ID ${s.id}`)
    ids.add(s.id)
    if (!s.name.trim()) fehler.push(`Stelle ${s.nummer || s.kurz || s.id} hat keinen Namen`)
  }
  for (const s of stellen) {
    if (!s.parentId) continue
    const p = stellen.find(x => x.id === s.parentId)
    if (!p) fehler.push(`${stelleLabel(s)}: Hauptgruppe fehlt`)
    else if (p.parentId) fehler.push(`${stelleLabel(s)}: nur zwei Ebenen erlaubt`)
    else if (p.bereich !== s.bereich) fehler.push(`${stelleLabel(s)}: Bereich weicht von der Hauptgruppe ab`)
  }
  return fehler
}

// ─── Buchungen ───────────────────────────────────────────────────────────────

/** Bestätigter Betrag einer Buchung laut Kreiszuordnungen. */
export function bestaetigt(jahr: Jahr, buchungId: string): Cent {
  let s = 0
  for (const z of jahr.kreis) for (const t of z.teile) if (t.buchungId === buchungId) s += t.betrag
  return s
}

export function statusVon(jahr: Jahr, b: Buchung): Status {
  if (b.status === 'angeordnet' && bestaetigt(jahr, b.id) >= b.betrag) return 'gebucht'
  return b.status
}

/** Zählt die Buchung zum Ist? (angeordnet oder gebucht, nicht zurückgezogen) */
export function zaehltZumIst(b: Buchung): boolean {
  return !b.zurueckgezogen && b.status === 'angeordnet'
}

/** Wirkung auf die Stelle: Storno-Gegenbuchungen ziehen ab. */
export function wirkung(b: Buchung): Cent {
  return b.stornoVon ? -b.betrag : b.betrag
}

/** Schlüssel für QIF-Duplikate (F07): Konto + Datum + Betrag + Nummer + Empfänger. */
export function qifSchluessel(konto: string, datum: string, betrag: Cent, nummer: string, empfaenger: string): string {
  return [konto.trim(), datum, String(betrag), nummer.trim(), empfaenger.trim().toLowerCase()].join('|')
}

/** Sicherer Dateiname für Belege: Belegnummer + Empfänger, ohne Pfadzeichen. */
export function belegDateiname(belegnr: string, empfaenger: string, endung = 'pdf'): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  const e = clean(empfaenger).slice(0, 60)
  return `${clean(belegnr)}${e ? ` - ${e}` : ''}.${endung.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'pdf'}`
}
