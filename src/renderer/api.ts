// Haushalt — Renderer-Anbindung: eigene Main-Actions über host.invoke. Kein Zugriff auf App-Interna.

import { createContext, useContext } from 'react'
import type { RendererHost } from '../host'
import type { Cent } from '../geld'
import { type Jahr, type Stammdaten, DEFAULT_FOLDER } from '../model'
import type { QifProblem } from '../qif'
import type { AbschlussVorschlag, Uebersicht } from '../rechnen'
import type * as st from '../store'
import type { VorlageImport } from '../vorlage'

export const PLUGIN_ID = 'mindgraph-haushalt'

export interface Ansicht {
  stamm: Stammdaten
  jahr: Jahr | null
  uebersicht: Uebersicht | null
  warnung: string | null
}

export interface QifLesen {
  token: string
  name: string
  konto: string
  probleme: QifProblem[]
  ignoriert: Record<string, number>
  summe: Cent
  kategorien: string[]
  zuordnung: Record<string, string>
  plan: st.QifPlanZeile[]
}

export interface Abgelegt {
  pfad: string
  extern: string | null
}

export const HostContext = createContext<RendererHost | null>(null)
export function useHost(): RendererHost {
  const h = useContext(HostContext)
  if (!h) throw new Error('Haushalt: Host fehlt')
  return h
}

export type Api = ReturnType<typeof makeApi>
export const ApiContext = createContext<Api | null>(null)
export function useApi(): Api {
  const a = useContext(ApiContext)
  if (!a) throw new Error('Haushalt: Api fehlt')
  return a
}

export function makeApi(host: RendererHost) {
  const call = <T = Ansicht>(action: string, payload: Record<string, unknown>): Promise<T> => {
    if (!host.invoke) throw new Error('Diese MindGraph-Version ist zu alt für das Haushalt-Plugin (Plugin-API 0.2.3 nötig).')
    return host.invoke<T>(`${PLUGIN_ID}.${action}`, payload)
  }
  return (folder: string, jahr: number) => {
    const b = { folder, jahr }
    return {
      load: () => call('load', b),
      saveStamm: (stamm: Stammdaten) => call('saveStamm', { ...b, stamm }),
      jahrAnlegen: (anfangsbestand: Cent) => call('jahrAnlegen', { ...b, anfangsbestand }),
      buchung: (eingabe: st.BuchungEingabe) => call('buchung', { ...b, eingabe }),
      vormerkungLoeschen: (id: string) => call('vormerkungLoeschen', { ...b, id }),
      zurueckziehen: (id: string, grund: string) => call('zurueckziehen', { ...b, id, grund }),
      stornieren: (id: string, grund: string, datum: string) => call('stornieren', { ...b, id, grund, datum }),
      anordnen: (ids: string[]) => call('anordnen', { ...b, ids }),
      abhaken: (abhaken: st.Abhaken) => call('abhaken', { ...b, abhaken }),
      abhakenAufheben: (id: string) => call('abhakenAufheben', { ...b, id }),
      belegAnhaengen: (id: string) => call('belegAnhaengen', { ...b, id }),
      ansatz: (stelleId: string, betrag: Cent) => call('ansatz', { ...b, stelleId, betrag }),
      aenderung: (eingabe: st.AenderungEingabe) => call('aenderung', { ...b, eingabe }),
      aenderungEntfernen: (id: string) => call('aenderungEntfernen', { ...b, id }),
      anfangsbestand: (betrag: Cent) => call('anfangsbestand', { ...b, betrag }),
      qifLesen: () => call<QifLesen | null>('qifLesen', b),
      qifPlan: (token: string, zuordnung: Record<string, string>) => call<st.QifPlanZeile[]>('qifPlan', { ...b, token, zuordnung }),
      qifImport: (token: string, zuordnung: Record<string, string>, konfliktNeueNummer: number[]) =>
        call<Ansicht & { anzahl: number; summe: Cent; archiv: string }>('qifImport', { ...b, token, zuordnung, konfliktNeueNummer }),
      vorlageLesen: () => call<(VorlageImport & { token: string }) | null>('vorlageLesen', b),
      vorlageUebernehmen: (p: { token: string; erstesJahr: number; durchlaufend: string[]; einrichtung: string; kontoBezeichnung: string; anfangsbestand?: number }) =>
        call('vorlageUebernehmen', { ...b, ...p }),
      abschlussVorschlag: () => call<AbschlussVorschlag>('abschlussVorschlag', b),
      abschliessen: (eingabe: st.AbschlussEingabe) => call('abschliessen', { ...b, eingabe }),
      entsperren: (grund: string) => call('entsperren', { ...b, grund }),
      berichtXlsx: (p: { von?: number; bis?: number; speichernUnter: boolean }) => call<Abgelegt>('berichtXlsx', { ...b, ...p }),
      berichtPdf: (p: { von?: number; bis?: number; speichernUnter: boolean }) => call<Abgelegt>('berichtPdf', { ...b, ...p }),
      buchungenCsv: (speichernUnter: boolean) => call<Abgelegt>('buchungenCsv', { ...b, speichernUnter }),
    }
  }
}

export type JahrApi = ReturnType<ReturnType<typeof makeApi>>

// ─── Ablageordner und Jahr (je Rechner, nicht im Vault) ──────────────────────

const FOLDER_KEY = `${PLUGIN_ID}:folder`
const JAHR_KEY = `${PLUGIN_ID}:jahr`

export function readFolder(): string {
  try {
    return localStorage.getItem(FOLDER_KEY)?.trim() || DEFAULT_FOLDER
  } catch {
    return DEFAULT_FOLDER
  }
}
export function writeFolder(folder: string): void {
  try {
    localStorage.setItem(FOLDER_KEY, folder)
  } catch {
    /* ohne Speicher bleibt es beim Standardordner */
  }
}
export function readJahr(): number {
  try {
    const n = Number(localStorage.getItem(JAHR_KEY))
    if (Number.isInteger(n) && n >= 2000 && n <= 2100) return n
  } catch {
    /* Standard */
  }
  return new Date().getFullYear()
}
export function writeJahr(j: number): void {
  try {
    localStorage.setItem(JAHR_KEY, String(j))
  } catch {
    /* egal */
  }
}

export function heuteIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function datumDe(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('.') : iso
}

export function fehlerText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  // IPC hängt gern „Error invoking remote method …: Error: “ davor.
  return m.replace(/^.*?Error:\s*/s, '')
}
