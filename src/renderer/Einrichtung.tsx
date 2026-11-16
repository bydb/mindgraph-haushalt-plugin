// Einrichtung: Ablageordner, Einrichtung/Konto, Gliederung, Erstimport (Excel), Quicken-Import, Protokoll.

import React, { useEffect, useMemo, useState } from 'react'
import { formatCent, formatEuro, parseEuroDe } from '../geld'
import { type Stelle, bebuchbar, stelleLabel, stellenFuer } from '../model'
import type { QifPlanZeile } from '../store'
import type { VorlageImport } from '../vorlage'
import { type Ansicht, type JahrApi, type QifLesen, datumDe } from './api'

interface Props {
  ansicht: Ansicht
  api: JahrApi
  busy: boolean
  run: (fn: () => Promise<Ansicht | null | undefined>) => Promise<boolean>
  setFehler: (m: string | null) => void
  folder: string
  jahrNr: number
  onFolder: (f: string) => void
}

export function EinrichtungPane(p: Props): React.ReactElement {
  const { ansicht, api, run, busy } = p
  const stamm = ansicht.stamm
  const [ordner, setOrdner] = useState(p.folder)
  const [einrichtung, setEinrichtung] = useState(stamm.einrichtung)
  const [konto, setKonto] = useState(stamm.kontoBezeichnung)
  const [stellen, setStellen] = useState<Stelle[]>(stamm.stellen)
  useEffect(() => { setEinrichtung(stamm.einrichtung); setKonto(stamm.kontoBezeichnung); setStellen(stamm.stellen) }, [stamm])
  const geaendert = einrichtung !== stamm.einrichtung || konto !== stamm.kontoBezeichnung || JSON.stringify(stellen) !== JSON.stringify(stamm.stellen)

  const setStelle = (id: string, patch: Partial<Stelle>) => setStellen(ss => ss.map(s => (s.id === id ? { ...s, ...patch } : s)))
  const neueStelle = (parentId?: string) => {
    const g = parentId ? stellen.find(s => s.id === parentId) : undefined
    const s: Stelle = { id: crypto.randomUUID(), nummer: g?.nummer ?? '', kurz: '', name: 'Neue Stelle', bereich: g?.bereich ?? 'ausgabe', ...(parentId ? { parentId } : {}) }
    // Unterstelle direkt hinter die letzte Unterstelle der Gruppe.
    const idx = parentId ? Math.max(...stellen.map((x, i) => (x.id === parentId || x.parentId === parentId ? i : -1))) + 1 : stellen.length
    setStellen(ss => [...ss.slice(0, idx), s, ...ss.slice(idx)])
  }

  return (
    <>
      <div className="hh-grid">
        <div className="hh-card">
          <h3>Ablage</h3>
          <label className="hh-field"><span>Ordner im Vault <em>(gilt für diesen Rechner)</em></span>
            <div className="hh-row"><input value={ordner} onChange={e => setOrdner(e.target.value)} /><button className="hh-btn" disabled={ordner.trim() === p.folder} onClick={() => p.onFolder(ordner.trim())}>Wechseln</button></div>
          </label>
          <label className="hh-field"><span>Einrichtung <em>(steht auf Berichten)</em></span><input value={einrichtung} onChange={e => setEinrichtung(e.target.value)} /></label>
          <label className="hh-field"><span>Konto beim Kreis <em>(Bezeichnung/Nummer)</em></span><input value={konto} onChange={e => setKonto(e.target.value)} /></label>
        </div>
        <VorlageImportCard {...p} />
      </div>

      {stamm.stellen.length > 0 && <QifImportCard {...p} />}

      <div className="hh-card" style={{ marginTop: 14 }}>
        <h3>Gliederung</h3>
        <p className="hh-muted hh-small">Hauptgruppen tragen meist den Ansatz, gebucht wird auf Unterstellen. Stellen mit Buchungen nicht löschen, sondern stilllegen. Bereich, Hauptgruppe und „durchlaufend“ sind nach der ersten Buchung fest — sonst änderten sich die Summen rückwirkend.</p>
        {stellen.length === 0 ? <p className="hh-muted">Noch leer — am einfachsten über „Haushaltstabelle einlesen“.</p> : (
          <table className="hh-table plain">
            <thead><tr><th style={{ width: 80 }}>Nummer</th><th style={{ width: 60 }}>Kurz</th><th>Name</th><th>Bereich</th><th>durchlaufend</th><th>stillgelegt</th><th /></tr></thead>
            <tbody>
              {stellen.map(s => (
                <tr key={s.id} className={s.parentId ? 'unter' : 'gruppe'}>
                  <td><input value={s.nummer} onChange={e => setStelle(s.id, { nummer: e.target.value })} /></td>
                  <td><input value={s.kurz} onChange={e => setStelle(s.id, { kurz: e.target.value })} /></td>
                  <td><input value={s.name} onChange={e => setStelle(s.id, { name: e.target.value })} /></td>
                  <td>{s.parentId ? <span className="hh-muted">{s.bereich === 'einnahme' ? 'Einnahme' : 'Ausgabe'}</span> : (
                    <select value={s.bereich} onChange={e => { const b = e.target.value as Stelle['bereich']; setStellen(ss => ss.map(x => (x.id === s.id || x.parentId === s.id ? { ...x, bereich: b } : x))) }}>
                      <option value="ausgabe">Ausgabe</option><option value="einnahme">Einnahme</option></select>)}</td>
                  <td><input type="checkbox" checked={!!s.durchlaufend} onChange={e => setStelle(s.id, { durchlaufend: e.target.checked || undefined })} /></td>
                  <td><input type="checkbox" checked={!!s.inaktiv} onChange={e => setStelle(s.id, { inaktiv: e.target.checked || undefined })} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!s.parentId && <button className="hh-icon" title="Unterstelle hinzufügen" onClick={() => neueStelle(s.id)}>+</button>}
                    <button className="hh-icon" title="Entfernen" onClick={() => setStellen(ss => ss.filter(x => x.id !== s.id && x.parentId !== s.id))}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="hh-actions">
          <button className="hh-btn" onClick={() => neueStelle()}>Hauptgruppe hinzufügen</button>
          <span className="hh-spacer" />
          {geaendert && <button className="hh-btn" onClick={() => { setEinrichtung(stamm.einrichtung); setKonto(stamm.kontoBezeichnung); setStellen(stamm.stellen) }}>Verwerfen</button>}
          <button className="hh-btn primary" disabled={busy || !geaendert} onClick={() => void run(() => api.saveStamm({ ...stamm, einrichtung, kontoBezeichnung: konto, stellen }))}>Speichern</button>
        </div>
      </div>

      {ansicht.jahr && ansicht.jahr.protokoll.length > 0 && (
        <details className="hh-card">
          <summary><b>Protokoll {ansicht.jahr.jahr}</b> <span className="hh-muted">({ansicht.jahr.protokoll.length} Einträge)</span></summary>
          <table className="hh-table plain hh-protokoll"><tbody>
            {[...ansicht.jahr.protokoll].reverse().slice(0, 300).map((e, i) => (
              <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{datumDe(e.zeit.slice(0, 10))} {e.zeit.slice(11, 16)}</td><td>{e.aktion}</td><td>{e.ref ?? ''}</td><td>{e.grund ?? ''}{e.vorher !== undefined ? ` · vorher ${kurz(e.vorher)}` : ''}{e.nachher !== undefined ? ` · nachher ${kurz(e.nachher)}` : ''}</td></tr>
            ))}
          </tbody></table>
        </details>
      )}
    </>
  )
}

function kurz(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 140 ? `${s.slice(0, 140)}…` : s
}

// ─── Erstimport aus der Haushaltstabelle ─────────────────────────────────────

function VorlageImportCard(p: Props): React.ReactElement {
  const { api, run, busy, ansicht } = p
  const [imp, setImp] = useState<(VorlageImport & { token: string }) | null>(null)
  const [durch, setDurch] = useState<Set<string>>(new Set())
  const [erstesJahr, setErstesJahr] = useState(p.jahrNr)
  const [anfang, setAnfang] = useState('')
  const hatBuchungen = (ansicht.jahr?.buchungen.length ?? 0) > 0
  const lesen = () => void run(async () => {
    const r = await api.vorlageLesen()
    if (r) {
      setImp(r)
      // Vorschlag „durchlaufend“: Namen mit Lizenz/Microsoft/durchlaufend.
      setDurch(new Set(r.stellen.filter(s => /durchlauf|microsoft|ms ?365|lizenz/i.test(s.name)).map(s => s.id)))
      const jahre = r.spalten.map(s => s.jahr)
      const ohneIst = r.spalten.filter(s => s.art === 'ansatz' && !r.spalten.some(t => t.art === 'ist' && t.jahr === s.jahr)).map(s => s.jahr)
      const ej = Math.min(...(ohneIst.length ? ohneIst : [Math.max(...jahre)]))
      setErstesJahr(ej)
      const ende = r.kontostand[ej - 1]?.ende
      setAnfang(ende !== undefined ? formatCent(ende) : '')
    }
    return null
  })
  if (!imp) {
    return (
      <div className="hh-card">
        <h3>Haushaltstabelle einlesen</h3>
        <p className="hh-muted hh-small">Die bisherige Excel-Tabelle (Spalten A–C Gliederung, „Ansatz JJJJ“/„Ist JJJJ“). Daraus entstehen Gliederung, Vorjahreswerte und die Ansätze ab dem ersten Plugin-Jahr. Vorher wird alles angezeigt.</p>
        {hatBuchungen && <p className="hh-error-inline">Es gibt schon Buchungen — die Gliederung lässt sich nicht mehr per Import ersetzen.</p>}
        <div className="hh-actions"><button className="hh-btn primary" disabled={busy || hatBuchungen} onClick={lesen}>Excel-Datei wählen …</button></div>
      </div>
    )
  }
  const jahre = [...new Set(imp.spalten.map(s => s.jahr))]
  return (
    <div className="hh-card">
      <h3>Vorschau: {imp.stellen.length} Haushaltsstellen aus „{imp.blatt}“</h3>
      <p className="hh-small">Spalten: {imp.spalten.map(s => s.titel).join(', ')}</p>
      {imp.ignorierteSpalten.length > 0 && <p className="hh-muted hh-small">Nicht übernommen: {imp.ignorierteSpalten.join(', ')}</p>}
      {imp.hinweise.length > 0 && <details><summary className="hh-small">{imp.hinweise.length} Hinweise zur alten Tabelle</summary><ul className="hh-list hh-small">{imp.hinweise.map(h => <li key={h}>{h}</li>)}</ul></details>}
      <label className="hh-field" style={{ marginTop: 10 }}><span>Erstes Jahr im Plugin <em>(davor: feste Vorjahreswerte; ab hier: Ansätze in die Jahresdatei, Ist aus Buchungen)</em></span>
        <select value={erstesJahr} onChange={e => setErstesJahr(Number(e.target.value))}>{jahre.map(j => <option key={j}>{j}</option>)}</select></label>
      <label className="hh-field"><span>Guthaben beim Kreis am 1. Januar {erstesJahr} <em>(aus der Liste des Kreises — der Endstand der alten Tabelle {imp.kontostand[erstesJahr - 1]?.ende !== undefined ? `war ${formatEuro(imp.kontostand[erstesJahr - 1].ende!)}` : 'fehlt'} und stammt oft aus einer Formel)</em></span>
        <input value={anfang} onChange={e => setAnfang(e.target.value)} inputMode="decimal" placeholder="0,00" /></label>
      <p className="hh-small"><b>Durchlaufende Posten</b> markieren (zählen nicht zur Gruppe):</p>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {imp.stellen.map(s => (
          <label key={s.id} className="hh-check" style={{ margin: '2px 0', paddingLeft: s.parentId ? 18 : 0 }}>
            <input type="checkbox" checked={durch.has(s.id)} onChange={() => setDurch(d => { const n = new Set(d); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n })} />
            <span className={s.parentId ? '' : 'hh-small'}>{stelleLabel(s)} <em>{s.bereich === 'einnahme' ? 'Einnahme' : 'Ausgabe'}</em></span>
          </label>
        ))}
      </div>
      <div className="hh-actions">
        <button className="hh-btn primary" disabled={busy || parseEuroDe(anfang || '0') === null} onClick={() => void run(async () => {
          const r = await api.vorlageUebernehmen({ token: imp.token, erstesJahr, durchlaufend: [...durch], einrichtung: ansicht.stamm.einrichtung, kontoBezeichnung: ansicht.stamm.kontoBezeichnung, anfangsbestand: parseEuroDe(anfang || '0') ?? 0 })
          setImp(null)
          return r
        })}>Übernehmen</button>
        <button className="hh-btn" onClick={() => setImp(null)}>Abbrechen</button>
      </div>
    </div>
  )
}

// ─── Quicken-Import ──────────────────────────────────────────────────────────

const AKTION: Record<QifPlanZeile['aktion'], string> = {
  neu: 'wird übernommen',
  doppelt: 'schon vorhanden',
  konflikt: 'Nummer belegt',
  ohneZuordnung: 'Kategorie nicht zugeordnet',
  falschesJahr: 'anderes Jahr',
  richtungPasstNicht: 'Einnahme/Ausgabe passt nicht',
}

function QifImportCard(p: Props): React.ReactElement {
  const { api, run, busy, ansicht } = p
  const [q, setQ] = useState<QifLesen | null>(null)
  const [zuordnung, setZuordnung] = useState<Record<string, string>>({})
  const [plan, setPlan] = useState<QifPlanZeile[]>([])
  const [konflikte, setKonflikte] = useState<Set<number>>(new Set())
  const [erledigt, setErledigt] = useState<string | null>(null)
  const jahr = ansicht.jahr
  const stellen = jahr ? stellenFuer(ansicht.stamm, jahr) : ansicht.stamm.stellen
  const bebuchbare = stellen.filter(s => bebuchbar(stellen, s) && !s.inaktiv)

  useEffect(() => {
    if (!q) return
    let alive = true
    api.qifPlan(q.token, zuordnung).then(x => { if (alive) setPlan(x) }, () => undefined)
    return () => { alive = false }
  }, [api, q, zuordnung])

  const zaehler = useMemo(() => {
    const m: Partial<Record<QifPlanZeile['aktion'], number>> = {}
    for (const z of plan) m[z.aktion] = (m[z.aktion] ?? 0) + 1
    return m
  }, [plan])
  const summeNeu = plan.filter(z => z.aktion === 'neu' || (z.aktion === 'konflikt' && konflikte.has(z.q.satz))).reduce((s, z) => s + z.q.betrag, 0)

  if (!jahr) return <div className="hh-card" style={{ marginTop: 14 }}><h3>Quicken-Import</h3><p className="hh-muted">Bitte zuerst das Haushaltsjahr {p.jahrNr} anlegen (Reiter Übersicht).</p></div>
  if (!q) {
    return (
      <div className="hh-card" style={{ marginTop: 14 }}>
        <h3>Buchungen aus Quicken übernehmen ({jahr.jahr})</h3>
        <p className="hh-muted hh-small">In Quicken: Datei → Exportieren → QIF. Alle Buchungen kommen als „angeordnet“ herein und werden danach mit der Liste des Kreises abgehakt. Die QIF-Datei wird unverändert unter Archiv-Quicken/ abgelegt.</p>
        {erledigt && <p>{erledigt}</p>}
        <div className="hh-actions"><button className="hh-btn primary" disabled={busy || jahr.gesperrt} onClick={() => void run(async () => {
          const r = await api.qifLesen()
          if (r) { setQ(r); setZuordnung(r.zuordnung); setPlan(r.plan); setKonflikte(new Set()); setErledigt(null) }
          return null
        })}>QIF-Datei wählen …</button></div>
      </div>
    )
  }
  return (
    <div className="hh-card" style={{ marginTop: 14 }}>
      <h3>Quicken-Import: {q.name} {q.konto ? `(Konto ${q.konto})` : ''}</h3>
      <p className="hh-small">{plan.length} Buchungen gelesen · Summe {formatEuro(q.summe)} · {Object.entries(zaehler).map(([k, n]) => `${n} ${AKTION[k as QifPlanZeile['aktion']]}`).join(' · ')}</p>
      {q.probleme.length > 0 && <div className="hh-error"><b>Nicht übernehmbar:</b>{q.probleme.map(x => <span key={x.satz + x.meldung}>{x.meldung}</span>)}</div>}
      <h3 style={{ marginTop: 14 }}>Quicken-Kategorie → Haushaltsstelle</h3>
      <table className="hh-table plain"><tbody>
        {q.kategorien.map(k => (
          <tr key={k}><td className="hh-small">{k || '(ohne Kategorie)'}</td>
            <td style={{ width: '50%' }}><select value={zuordnung[k] ?? ''} onChange={e => setZuordnung(z => ({ ...z, [k]: e.target.value }))}>
              <option value="">— nicht übernehmen —</option>
              {bebuchbare.map(s => <option key={s.id} value={s.id}>{s.bereich === 'einnahme' ? 'E' : 'A'} · {stelleLabel(s)}</option>)}
            </select></td></tr>
        ))}
      </tbody></table>
      <details style={{ marginTop: 10 }} open={plan.some(z => z.aktion !== 'neu' && z.aktion !== 'doppelt')}>
        <summary className="hh-small">Einzelne Buchungen</summary>
        <table className="hh-table plain hh-small"><tbody>
          {plan.map(z => (
            <tr key={z.q.satz}>
              <td className="mono">{z.q.nummer}</td><td>{datumDe(z.q.datum)}</td><td>{z.q.empfaenger}</td><td className="num">{formatEuro(z.q.betrag)}</td>
              <td>{z.aktion === 'konflikt'
                ? <label className="hh-check" style={{ margin: 0 }}><input type="checkbox" checked={konflikte.has(z.q.satz)} onChange={() => setKonflikte(s => { const n = new Set(s); if (n.has(z.q.satz)) n.delete(z.q.satz); else n.add(z.q.satz); return n })} /><span>mit neuer Nummer übernehmen<em>{z.hinweis}</em></span></label>
                : <span className={z.aktion === 'neu' ? '' : 'hh-muted'}>{AKTION[z.aktion]}{z.hinweis && z.aktion !== 'neu' ? ` — ${z.hinweis}` : ''}</span>}</td>
            </tr>
          ))}
        </tbody></table>
      </details>
      <div className="hh-actions">
        <button className="hh-btn primary" disabled={busy || !(zaehler.neu || konflikte.size)} onClick={() => void run(async () => {
          const r = await api.qifImport(q.token, zuordnung, [...konflikte])
          setErledigt(`${r.anzahl} Buchungen übernommen (Summe ${formatEuro(r.summe)}). Original abgelegt: ${r.archiv}`)
          setQ(null)
          return r
        })}>{(zaehler.neu ?? 0) + konflikte.size} Buchungen übernehmen · {formatEuro(summeNeu)}</button>
        <button className="hh-btn" onClick={() => setQ(null)}>Abbrechen</button>
      </div>
    </div>
  )
}
