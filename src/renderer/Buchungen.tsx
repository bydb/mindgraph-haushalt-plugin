// Buchungen erfassen und bearbeiten; Abgleich mit der Liste des Kreises.

import React, { useMemo, useState } from 'react'
import { formatCent, formatEuro, parseEuroDe } from '../geld'
import { type Buchung, type Status, STATUS_LABEL, bebuchbar, bestaetigt, stelleLabel, stellenFuer, statusVon, zaehltZumIst } from '../model'
import { datumDe, heuteIso, useHost } from './api'
import type { PaneProps } from './HaushaltView'

type Filter = 'alle' | Status | 'zurueckgezogen'

function StatusChip({ b, s }: { b: Buchung; s: Status }): React.ReactElement {
  if (b.zurueckgezogen) return <span className="hh-status s-weg">zurückgezogen</span>
  return <span className={`hh-status s-${s}`}>{STATUS_LABEL[s]}</span>
}

export function BuchungenPane(p: PaneProps): React.ReactElement {
  const { jahr, stamm } = p
  const stellen = stellenFuer(stamm, jahr)
  const [filter, setFilter] = useState<Filter>('alle')
  const [suche, setSuche] = useState('')
  const [stelleFilter, setStelleFilter] = useState('')
  const [offen, setOffen] = useState<string | 'neu' | null>(null)
  const name = (id: string) => {
    const s = stellen.find(x => x.id === id)
    return s ? stelleLabel(s) : `(unbekannt)`
  }
  const liste = useMemo(() => {
    const q = suche.trim().toLowerCase()
    const betrag = parseEuroDe(suche)
    return [...jahr.buchungen]
      .filter(b => {
        if (filter === 'zurueckgezogen') { if (!b.zurueckgezogen) return false } else if (filter !== 'alle' && (b.zurueckgezogen || statusVon(jahr, b) !== filter)) return false
        if (stelleFilter && b.stelleId !== stelleFilter && stellen.find(s => s.id === b.stelleId)?.parentId !== stelleFilter) return false
        if (!q) return true
        return (betrag !== null && Math.abs(betrag) === b.betrag) || [b.belegnr, b.empfaenger, b.zweck, name(b.stelleId)].some(t => t.toLowerCase().includes(q))
      })
      .sort((a, b) => b.belegnr.localeCompare(a.belegnr))
  }, [jahr, filter, suche, stelleFilter, stellen])

  if (offen) {
    const b = offen === 'neu' ? null : jahr.buchungen.find(x => x.id === offen) ?? null
    return <BuchungForm {...p} buchung={b} onClose={() => setOffen(null)} onSaved={id => setOffen(id)} />
  }

  const summe = liste.filter(zaehltZumIst).reduce((s, b) => {
    const st = stellen.find(x => x.id === b.stelleId)
    return s + (st?.bereich === 'einnahme' ? 1 : -1) * (b.stornoVon ? -b.betrag : b.betrag)
  }, 0)

  return (
    <>
      <div className="hh-toolbar">
        <input className="hh-search" placeholder="Suchen: Nummer, Empfänger, Zweck, Betrag" value={suche} onChange={e => setSuche(e.target.value)} />
        <select value={stelleFilter} onChange={e => setStelleFilter(e.target.value)} style={{ maxWidth: 280 }}>
          <option value="">Alle Haushaltsstellen</option>
          {stellen.map(s => <option key={s.id} value={s.id}>{s.parentId ? '  ' : ''}{stelleLabel(s)}</option>)}
        </select>
        <span className="hh-spacer" />
        <button className="hh-btn primary" disabled={jahr.gesperrt || p.busy} onClick={() => setOffen('neu')}>Neue Buchung</button>
      </div>
      <div className="hh-filters">
        {(['alle', 'vorgemerkt', 'angeordnet', 'gebucht', 'zurueckgezogen'] as Filter[]).map(f => (
          <button key={f} className={`hh-chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'alle' ? 'Alle' : f === 'zurueckgezogen' ? 'Zurückgezogen' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>
      {liste.length === 0 ? <div className="hh-empty">Keine Buchungen.</div> : (
        <table className="hh-table">
          <thead><tr><th>Beleg</th><th>Datum</th><th>Haushaltsstelle</th><th>Empfänger / Zweck</th><th className="num">Betrag</th><th>Status</th></tr></thead>
          <tbody>
            {liste.map(b => {
              const st = stellen.find(x => x.id === b.stelleId)
              const vz = st?.bereich === 'einnahme' ? 1 : -1
              return (
                <tr key={b.id} tabIndex={0} className={b.zurueckgezogen ? 'weg' : ''} onClick={() => setOffen(b.id)} onKeyDown={e => e.key === 'Enter' && setOffen(b.id)}>
                  <td className="mono">{b.belegnr}{b.beleg ? '' : <span className="hh-tag" title="Kein Beleg angehängt">ohne Beleg</span>}</td>
                  <td>{datumDe(b.datum)}</td>
                  <td>{name(b.stelleId)}</td>
                  <td>{b.empfaenger}<div className="hh-muted hh-small">{b.zweck}</div></td>
                  <td className="num">{formatCent(vz * (b.stornoVon ? -b.betrag : b.betrag))}</td>
                  <td><StatusChip b={b} s={statusVon(jahr, b)} /></td>
                </tr>
              )
            })}
          </tbody>
          <tfoot><tr><td colSpan={4}>Saldo der gezeigten Buchungen (ohne Vormerkungen)</td><td className="num">{formatCent(summe)}</td><td /></tr></tfoot>
        </table>
      )}
    </>
  )
}

function BuchungForm(p: PaneProps & { buchung: Buchung | null; onClose: () => void; onSaved: (id: string) => void }): React.ReactElement {
  const { jahr, stamm, api, run, busy, buchung: b } = p
  const host = useHost()
  const stellen = stellenFuer(stamm, jahr)
  const bebuchbare = stellen.filter(s => bebuchbar(stellen, s) && !s.inaktiv)
  const [datum, setDatum] = useState(b?.datum ?? (heuteIso().startsWith(String(jahr.jahr)) ? heuteIso() : `${jahr.jahr}-01-01`))
  const [stelleId, setStelleId] = useState(b?.stelleId ?? '')
  const [betrag, setBetrag] = useState(b ? formatCent(b.betrag) : '')
  const [empfaenger, setEmpfaenger] = useState(b?.empfaenger ?? '')
  const [zweck, setZweck] = useState(b?.zweck ?? '')
  const [status, setStatus] = useState<'vorgemerkt' | 'angeordnet'>(b?.status ?? 'angeordnet')
  const [frage, setFrage] = useState<null | 'zurueck' | 'storno'>(null)
  const [grund, setGrund] = useState('')
  const [stornoDatum, setStornoDatum] = useState(heuteIso().startsWith(String(jahr.jahr)) ? heuteIso() : `${jahr.jahr}-12-31`)

  const cent = parseEuroDe(betrag)
  const s = statusVon(jahr, b ?? ({ status, id: '', betrag: 0 } as Buchung))
  const gesperrt = jahr.gesperrt || !!b?.zurueckgezogen || !!b?.stornoVon || !!b?.storniertDurch
  const kreisTeil = b ? bestaetigt(jahr, b.id) : 0
  const stelle = stellen.find(x => x.id === stelleId)
  const ue = p.ansicht.uebersicht
  const gruppe = stelle ? ue?.zeilen.find(z => z.stelle.id === (stelle.parentId ?? stelle.id)) : undefined

  // Empfänger-Vorschläge und gewohnte Stelle je Empfänger aus früheren Buchungen.
  const bekannte = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of jahr.buchungen) if (!x.zurueckgezogen) m.set(x.empfaenger, x.stelleId)
    return m
  }, [jahr])

  const speichern = () => {
    if (cent === null || cent <= 0) return p.setFehler('Bitte einen Betrag größer als 0 angeben, z. B. 1.234,56.')
    void run(async () => {
      const r = await api.buchung({ id: b?.id, datum, stelleId, betrag: cent, empfaenger, zweck, status })
      const neu = b?.id ?? r.jahr?.buchungen.at(-1)?.id
      if (neu) p.onSaved(neu)
      return r
    })
  }

  return (
    <div className="hh-form">
      <div className="hh-editor-head" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <button className="hh-link" onClick={p.onClose}>← Buchungen</button>
        <h2 style={{ margin: 0, fontSize: 16 }}>{b ? `Beleg ${b.belegnr}` : 'Neue Buchung'}</h2>
        {b && <StatusChip b={b} s={s} />}
      </div>
      {b?.stornoVon && <p className="hh-muted">Gegenbuchung zu {jahr.buchungen.find(x => x.id === b.stornoVon)?.belegnr}.</p>}
      {b?.storniertDurch && <p className="hh-muted">Storniert durch {jahr.buchungen.find(x => x.id === b.storniertDurch)?.belegnr}.</p>}
      {b?.zurueckgezogen && <p className="hh-muted">Zurückgezogen am {datumDe(b.zurueckgezogen.am)}: {b.zurueckgezogen.grund}</p>}
      {b?.uebernommenAus && <p className="hh-muted">Vormerkung aus {b.uebernommenAus.jahr} übernommen.</p>}
      {b?.qif && <p className="hh-muted hh-small">Aus Quicken übernommen ({b.qif.datei}, Satz {b.qif.satz}).</p>}

      <div className="hh-card">
        <div className="hh-row">
          <label className="hh-field"><span>Belegdatum</span><input type="date" value={datum} disabled={gesperrt} onChange={e => setDatum(e.target.value)} /></label>
          <label className="hh-field"><span>Betrag in €</span><input value={betrag} disabled={gesperrt || kreisTeil > 0} inputMode="decimal" placeholder="0,00" onChange={e => setBetrag(e.target.value)} /></label>
        </div>
        <label className="hh-field">
          <span>Haushaltsstelle</span>
          <select value={stelleId} disabled={gesperrt || kreisTeil > 0} onChange={e => setStelleId(e.target.value)}>
            <option value="">— bitte wählen —</option>
            {(['ausgabe', 'einnahme'] as const).map(bereich => (
              <optgroup key={bereich} label={bereich === 'ausgabe' ? 'Ausgaben' : 'Einnahmen'}>
                {bebuchbare.filter(x => x.bereich === bereich).map(x => {
                  const g = x.parentId ? stellen.find(y => y.id === x.parentId) : undefined
                  return <option key={x.id} value={x.id}>{g ? `${g.name} › ` : ''}{stelleLabel(x)}{x.durchlaufend ? ' (durchlaufend)' : ''}</option>
                })}
              </optgroup>
            ))}
          </select>
        </label>
        {gruppe && stelle?.bereich === 'ausgabe' && gruppe.wirksam > 0 && (
          <p className={gruppe.ueberschritten ? 'hh-error-inline' : 'hh-muted hh-small'}>
            {gruppe.stelle.name}: frei {formatEuro(gruppe.frei)} von {formatEuro(gruppe.wirksam)}
            {cent && !b && cent > gruppe.frei ? ' — diese Buchung überschreitet den Ansatz (wird trotzdem gebucht).' : ''}
          </p>
        )}
        <label className="hh-field">
          <span>{stelle?.bereich === 'einnahme' ? 'Einzahler' : 'Empfänger'}</span>
          <input list="hh-empf" value={empfaenger} disabled={gesperrt} onChange={e => {
            setEmpfaenger(e.target.value)
            const vorher = bekannte.get(e.target.value)
            if (vorher && !stelleId && !b) setStelleId(vorher)
          }} />
          <datalist id="hh-empf">{[...bekannte.keys()].sort().map(n => <option key={n} value={n} />)}</datalist>
        </label>
        <label className="hh-field"><span>Verwendungszweck <em>(Rechnungsnummer, Kundennummer, Gegenstand)</em></span><textarea rows={2} value={zweck} disabled={gesperrt} onChange={e => setZweck(e.target.value)} /></label>
        <div className="hh-segment">
          <button className={status === 'vorgemerkt' ? 'active' : ''} disabled={gesperrt || b?.status === 'angeordnet'} onClick={() => setStatus('vorgemerkt')}>Vorgemerkt (Bestellung)</button>
          <button className={status === 'angeordnet' ? 'active' : ''} disabled={gesperrt} onClick={() => setStatus('angeordnet')}>Angeordnet (an den Kreis)</button>
        </div>
        <div className="hh-actions">
          {!gesperrt && <button className="hh-btn primary" disabled={busy} onClick={speichern}>{b ? 'Speichern' : 'Buchen'}</button>}
          {b && b.beleg && <button className="hh-btn" onClick={() => void host.openLink?.(b.beleg!)}>Beleg öffnen</button>}
          {b && !jahr.gesperrt && !b.zurueckgezogen && <button className="hh-btn" disabled={busy} onClick={() => void run(() => api.belegAnhaengen(b.id))}>{b.beleg ? 'Beleg ersetzen …' : 'Beleg anhängen …'}</button>}
          <span className="hh-spacer" />
          {b && !gesperrt && b.status === 'vorgemerkt' && !b.beleg && (
            <button className="hh-btn danger" disabled={busy} onClick={() => void run(async () => { const r = await api.vormerkungLoeschen(b.id); p.onClose(); return r })}>Vormerkung löschen</button>
          )}
          {b && !gesperrt && kreisTeil === 0 && b.status === 'angeordnet' && <button className="hh-btn danger" onClick={() => setFrage('zurueck')}>Zurückziehen …</button>}
          {b && !gesperrt && kreisTeil > 0 && <button className="hh-btn danger" onClick={() => setFrage('storno')}>Stornieren …</button>}
        </div>
        {frage && (
          <div className="hh-card" style={{ marginTop: 12, background: 'var(--bg-primary)' }}>
            <p className="hh-small">{frage === 'zurueck'
              ? 'Die Buchung zählt danach nicht mehr. Sie bleibt mit Grund in der Liste sichtbar, die Belegnummer wird nicht neu vergeben.'
              : 'Der Kreis hat diese Buchung schon gebucht. Es entsteht eine Gegenbuchung mit eigener Nummer; sobald der Kreis sie ebenfalls gebucht hat, bitte auch sie abhaken.'}</p>
            <div className="hh-row">
              <label className="hh-field"><span>Grund</span><input value={grund} onChange={e => setGrund(e.target.value)} /></label>
              {frage === 'storno' && <label className="hh-field"><span>Datum der Gegenbuchung</span><input type="date" value={stornoDatum} onChange={e => setStornoDatum(e.target.value)} /></label>}
            </div>
            <div className="hh-actions">
              <button className="hh-btn danger" disabled={busy || !grund.trim()} onClick={() => void run(async () => {
                const r = frage === 'zurueck' ? await api.zurueckziehen(b!.id, grund) : await api.stornieren(b!.id, grund, stornoDatum)
                setFrage(null)
                return r
              })}>{frage === 'zurueck' ? 'Zurückziehen' : 'Gegenbuchung anlegen'}</button>
              <button className="hh-btn" onClick={() => setFrage(null)}>Abbrechen</button>
            </div>
          </div>
        )}
      </div>
      {b && (() => {
        const kz = jahr.kreis.filter(z => z.teile.some(t => t.buchungId === b.id))
        if (!kz.length) return null
        return (
          <div className="hh-card">
            <h3>Vom Kreis gebucht</h3>
            <ul className="hh-list">
              {kz.map(z => <li key={z.id}>{datumDe(z.datum)}: {formatEuro(z.teile.find(t => t.buchungId === b.id)!.betrag)}{z.kreisStelle ? ` · beim Kreis auf ${z.kreisStelle}` : ''}{z.kreisVorgang ? ` · Vorgang ${z.kreisVorgang}` : ''}</li>)}
            </ul>
            <div className="hh-actions"><button className="hh-btn" disabled={p.busy} onClick={() => void run(() => api.abhakenAufheben(b.id))}>Haken entfernen</button></div>
          </div>
        )
      })()}
    </div>
  )
}

export function AbgleichPane(p: PaneProps): React.ReactElement {
  const { jahr, stamm, api, run, busy } = p
  const stellen = stellenFuer(stamm, jahr)
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set())
  const [datum, setDatum] = useState(heuteIso())
  const [kreisStelle, setKreisStelle] = useState('')
  const [kreisVorgang, setKreisVorgang] = useState('')
  const [suche, setSuche] = useState('')
  const offen = jahr.buchungen
    .filter(b => zaehltZumIst(b) && bestaetigt(jahr, b.id) < b.betrag)
    .filter(b => {
      const q = suche.trim().toLowerCase()
      if (!q) return true
      const betrag = parseEuroDe(suche)
      return (betrag !== null && Math.abs(betrag) === b.betrag) || [b.belegnr, b.empfaenger, b.zweck].some(t => t.toLowerCase().includes(q))
    })
    .sort((a, b) => a.datum.localeCompare(b.datum))
  const g = p.ansicht.uebersicht?.guthaben
  const toggle = (id: string) => setAuswahl(s => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  const summeAuswahl = offen.filter(b => auswahl.has(b.id)).reduce((s, b) => s + b.betrag - bestaetigt(jahr, b.id), 0)
  return (
    <>
      <div className="hh-stats">
        <div className="hh-stat"><span className="hh-stat-label">Guthaben nach unseren Buchungen</span><span className="hh-stat-value">{formatEuro(g?.unsere ?? 0)}</span></div>
        <div className="hh-stat"><span className="hh-stat-label">Vom Kreis bestätigt</span><span className="hh-stat-value">{formatEuro(g?.kreis ?? 0)}</span></div>
        <div className={`hh-stat ${g?.offen ? 'warn' : ''}`}><span className="hh-stat-label">Noch nicht beim Kreis</span><span className="hh-stat-value">{formatEuro(g?.offen ?? 0)}</span><span className="hh-stat-sub">{offen.length} offene Buchungen</span></div>
      </div>
      <p className="hh-muted hh-small">Liste des Kreises daneben legen und je Zeile die passende Buchung anhaken. Suche nach Betrag („38,69“) findet am schnellsten. {jahr.gesperrt ? 'Das Jahr ist abgeschlossen — Abhaken bleibt trotzdem möglich.' : ''}</p>
      <div className="hh-toolbar"><input className="hh-search" placeholder="Betrag, Empfänger oder Nummer" value={suche} onChange={e => setSuche(e.target.value)} /></div>
      {offen.length === 0 ? <div className="hh-empty">Alles abgeglichen.</div> : (
        <table className="hh-table">
          <thead><tr><th className="hh-checkcell" /><th>Beleg</th><th>Datum</th><th>Stelle</th><th>Empfänger / Zweck</th><th className="num">Betrag</th></tr></thead>
          <tbody>
            {offen.map(b => {
              const s = stellen.find(x => x.id === b.stelleId)
              const rest = b.betrag - bestaetigt(jahr, b.id)
              return (
                <tr key={b.id} onClick={() => toggle(b.id)}>
                  <td className="hh-checkcell"><input type="checkbox" checked={auswahl.has(b.id)} readOnly /></td>
                  <td className="mono">{b.belegnr}</td>
                  <td>{datumDe(b.datum)}</td>
                  <td>{s ? `${s.nummer} ${s.kurz}` : '?'}</td>
                  <td>{b.empfaenger}<div className="hh-muted hh-small">{b.zweck}</div></td>
                  <td className="num">{s?.bereich === 'einnahme' ? '' : '−'}{formatCent(b.stornoVon ? -rest : rest)}{rest !== b.betrag && <div className="hh-muted hh-small">von {formatCent(b.betrag)}</div>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {auswahl.size > 0 && (
        <div className="hh-actions sticky">
          <span>{auswahl.size} ausgewählt · {formatEuro(summeAuswahl)}</span>
          <label className="hh-field" style={{ margin: 0 }}><span>Beim Kreis gebucht am</span><input type="date" value={datum} onChange={e => setDatum(e.target.value)} /></label>
          <label className="hh-field" style={{ margin: 0, maxWidth: 120 }}><span>Stelle laut Kreis <em>(wenn anders)</em></span><input value={kreisStelle} placeholder="z. B. 5210" onChange={e => setKreisStelle(e.target.value)} /></label>
          <label className="hh-field" style={{ margin: 0, maxWidth: 100 }}><span>Vorgang</span><input value={kreisVorgang} onChange={e => setKreisVorgang(e.target.value)} /></label>
          <button className="hh-btn primary" disabled={busy} onClick={() => void run(async () => {
            const r = await api.abhaken({ buchungIds: [...auswahl], datum, kreisStelle, kreisVorgang })
            setAuswahl(new Set())
            setKreisStelle('')
            return r
          })}>Als vom Kreis gebucht abhaken</button>
          <button className="hh-btn" onClick={() => setAuswahl(new Set())}>Auswahl leeren</button>
        </div>
      )}
    </>
  )
}
