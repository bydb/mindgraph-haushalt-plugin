// Haushalt — Arbeitsbereich-Tab: Rahmen mit Jahr, Reitern und gemeinsamem Lade-/Fehlerzustand.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { formatEuro, parseEuroDe } from '../geld'
import { type Jahr, type Stammdaten } from '../model'
import { type Ansicht, type JahrApi, fehlerText, readFolder, readJahr, useApi, writeFolder, writeJahr } from './api'
import { AbgleichPane, BuchungenPane } from './Buchungen'
import { AnsatzPane, AbschlussPane, BerichtePane, UebersichtPane } from './Auswertung'
import { EinrichtungPane } from './Einrichtung'

type Section = 'uebersicht' | 'buchungen' | 'abgleich' | 'ansatz' | 'abschluss' | 'berichte' | 'einrichtung'

const SECTIONS: Array<[Section, string]> = [
  ['uebersicht', 'Übersicht'],
  ['buchungen', 'Buchungen'],
  ['abgleich', 'Abgleich'],
  ['ansatz', 'Ansatz'],
  ['abschluss', 'Abschluss'],
  ['berichte', 'Berichte'],
  ['einrichtung', 'Einrichtung'],
]

export interface PaneProps {
  ansicht: Ansicht
  jahr: Jahr
  stamm: Stammdaten
  api: JahrApi
  busy: boolean
  /** Führt eine Änderung aus; liefert die neue Ansicht. true = erfolgreich. */
  run: (fn: () => Promise<Ansicht | null | undefined>) => Promise<boolean>
  setFehler: (m: string | null) => void
  gotoSection: (s: Section) => void
}

export default function HaushaltView(): React.ReactElement {
  const makeJahrApi = useApi()
  const [folder, setFolder] = useState(readFolder)
  const [jahrNr, setJahrNr] = useState(readJahr)
  const [ansicht, setAnsicht] = useState<Ansicht | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [section, setSection] = useState<Section>('uebersicht')
  const api = useMemo(() => makeJahrApi(folder, jahrNr), [makeJahrApi, folder, jahrNr])

  const reload = useCallback(async () => {
    try {
      setAnsicht(await api.load())
      setFehler(null)
    } catch (e) {
      setFehler(fehlerText(e))
    }
  }, [api])

  useEffect(() => { setAnsicht(null); void reload() }, [reload])

  const run = useCallback(async (fn: () => Promise<Ansicht | null | undefined>): Promise<boolean> => {
    setBusy(true)
    try {
      const r = await fn()
      if (r && 'stamm' in r) setAnsicht(r)
      setFehler(null)
      return true
    } catch (e) {
      setFehler(fehlerText(e))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const jahre = useMemo(() => {
    const s = new Set<number>([jahrNr, new Date().getFullYear(), ...(ansicht?.stamm.jahre ?? [])])
    const max = Math.max(...s)
    s.add(max + 1)
    return [...s].sort((a, b) => b - a)
  }, [ansicht, jahrNr])

  const waehleJahr = (j: number) => {
    writeJahr(j)
    setJahrNr(j)
  }

  const stamm = ansicht?.stamm
  const jahr = ansicht?.jahr ?? null
  const ohneGliederung = stamm && stamm.stellen.length === 0

  return (
    <div className="hh-root">
      <header className="hh-header">
        <div className="hh-title">
          <h1>Haushalt</h1>
          {stamm?.einrichtung && <span className="hh-folder">{stamm.einrichtung}{stamm.kontoBezeichnung ? ` · ${stamm.kontoBezeichnung}` : ''}</span>}
        </div>
        <label className="hh-year" title="Haushaltsjahr">
          <select value={jahrNr} onChange={e => waehleJahr(Number(e.target.value))}>
            {jahre.map(j => <option key={j} value={j}>{j}{stamm?.jahre.includes(j) ? '' : ' (neu)'}</option>)}
          </select>
        </label>
        {jahr?.gesperrt && <span className="hh-status s-gebucht">abgeschlossen</span>}
        <nav className="hh-nav">
          {SECTIONS.map(([id, label]) => (
            <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>{label}</button>
          ))}
        </nav>
      </header>

      {fehler && (
        <div className="hh-error" role="alert">
          <span>{fehler}</span>
          <button className="hh-link" onClick={() => setFehler(null)}>Schließen</button>
        </div>
      )}
      {ansicht?.warnung && <div className="hh-warn">{ansicht.warnung}</div>}

      <main className="hh-body">
        {!ansicht && !fehler && <div className="hh-empty">Lade …</div>}
        {ansicht && stamm && section === 'einrichtung' && (
          <EinrichtungPane ansicht={ansicht} api={api} busy={busy} run={run} setFehler={setFehler} folder={folder} jahrNr={jahrNr}
            onFolder={f => { writeFolder(f); setFolder(f) }} />
        )}
        {ansicht && stamm && section !== 'einrichtung' && ohneGliederung && (
          <div className="hh-empty">
            <p>Noch keine Haushaltsstellen eingerichtet.</p>
            <ol className="hh-steps" style={{ textAlign: 'left', display: 'inline-block' }}>
              <li>Unter <b>Einrichtung</b> die bisherige Haushaltstabelle (Excel) einlesen — daraus entstehen Gliederung, Vorjahre und Ansätze.</li>
              <li>Danach Buchungen aus Quicken (QIF) übernehmen oder neu erfassen.</li>
            </ol>
            <div><button className="hh-btn primary" onClick={() => setSection('einrichtung')}>Zur Einrichtung</button></div>
          </div>
        )}
        {ansicht && stamm && section !== 'einrichtung' && !ohneGliederung && !jahr && (
          <JahrAnlegen jahrNr={jahrNr} ansicht={ansicht} busy={busy} onAnlegen={c => run(() => api.jahrAnlegen(c))} />
        )}
        {ansicht && stamm && jahr && !ohneGliederung && section !== 'einrichtung' && (() => {
          const p: PaneProps = { ansicht, jahr, stamm, api, busy, run, setFehler, gotoSection: setSection }
          switch (section) {
            case 'uebersicht': return <UebersichtPane {...p} />
            case 'buchungen': return <BuchungenPane {...p} />
            case 'abgleich': return <AbgleichPane {...p} />
            case 'ansatz': return <AnsatzPane {...p} />
            case 'abschluss': return <AbschlussPane {...p} />
            case 'berichte': return <BerichtePane {...p} />
          }
        })()}
      </main>
    </div>
  )
}

function JahrAnlegen({ jahrNr, ansicht, busy, onAnlegen }: { jahrNr: number; ansicht: Ansicht; busy: boolean; onAnlegen: (c: number) => void }): React.ReactElement {
  const vorjahrEnde = ansicht.stamm.vorjahrKontostand[jahrNr - 1]?.ende
  const [text, setText] = useState(vorjahrEnde !== undefined ? formatEuro(vorjahrEnde).replace(' €', '') : '0,00')
  const wert = parseEuroDe(text)
  return (
    <div className="hh-card hh-form">
      <h3>Haushaltsjahr {jahrNr} anlegen</h3>
      <p className="hh-muted">Für {jahrNr} gibt es noch keine Daten. Ist {jahrNr - 1} im Plugin abgeschlossen, legt der Abschluss das Jahr selbst an — mit Anfangsbestand und Überträgen.</p>
      <label className="hh-field">
        <span>Guthaben beim Kreis am 1. Januar {jahrNr} <em>(laut Liste des Kreises oder Endstand der alten Tabelle)</em></span>
        <input value={text} onChange={e => setText(e.target.value)} inputMode="decimal" />
      </label>
      <div className="hh-actions">
        <button className="hh-btn primary" disabled={busy || wert === null} onClick={() => wert !== null && onAnlegen(wert)}>Jahr anlegen</button>
      </div>
    </div>
  )
}
