// Übersicht (Haushaltsüberwachung + Guthaben), Ansatz und Änderungen, Jahresabschluss, Berichte.

import React, { useEffect, useState } from 'react'
import { type Cent, formatCent, formatEuro, parseEuroDe } from '../geld'
import { AENDERUNGS_ARTEN, type AenderungsArt, stelleLabel, stellenFuer } from '../model'
import type { AbschlussVorschlag, Zeile } from '../rechnen'
import { type Abgelegt, datumDe, fehlerText, heuteIso, useHost } from './api'
import type { PaneProps } from './HaushaltView'

function Balken({ z }: { z: Zeile }): React.ReactElement | null {
  if (z.wirksam <= 0 || z.stelle.bereich !== 'ausgabe') return null
  const anteil = Math.min(1, Math.max(0, (z.ist + z.vorgemerkt) / z.wirksam))
  return <div className={`hh-bar ${z.ueberschritten ? 'ueber' : ''}`}><div style={{ width: `${anteil * 100}%` }} /></div>
}

export function UebersichtPane(p: PaneProps): React.ReactElement {
  const u = p.ansicht.uebersicht!
  const g = u.guthaben
  const ueber = u.zeilen.filter(z => z.ebene === 0 && z.ueberschritten)
  const tabelle = (bereich: 'einnahme' | 'ausgabe') => {
    const zeilen = u.zeilen.filter(z => z.stelle.bereich === bereich)
    const s = u.summen[bereich]
    return (
      <div className="hh-card">
        <h3>{bereich === 'einnahme' ? 'Einnahmen' : 'Ausgaben'}</h3>
        <table className="hh-table plain">
          <thead><tr><th>Haushaltsstelle</th><th className="num">Ansatz</th><th className="num">Änderungen</th><th className="num">Ist</th><th className="num">vorgemerkt</th><th className="num">{bereich === 'ausgabe' ? 'frei' : 'offen'}</th></tr></thead>
          <tbody>
            {zeilen.map(z => (
              <tr key={z.stelle.id} className={[z.ebene === 0 ? 'gruppe' : 'unter', z.ueberschritten ? 'ueber' : '', z.stelle.durchlaufend ? 'durch' : ''].join(' ')}>
                <td>{z.stelle.kurz} {z.stelle.name}<span className="hh-tag">{z.stelle.nummer}{z.stelle.durchlaufend ? ' · durchlaufend' : ''}{z.stelle.inaktiv ? ' · stillgelegt' : ''}</span>{z.ebene === 0 && <Balken z={z} />}</td>
                <td className="num">{z.ansatz ? formatCent(z.ansatz) : ''}</td>
                <td className="num">{z.aenderungen ? formatCent(z.aenderungen) : ''}</td>
                <td className="num">{z.ist || z.wirksam ? formatCent(z.ist) : ''}{z.ist !== z.bestaetigt && <div className="hh-muted hh-small" title="davon vom Kreis bestätigt">{formatCent(z.bestaetigt)} best.</div>}</td>
                <td className="num">{z.vorgemerkt ? formatCent(z.vorgemerkt) : ''}</td>
                <td className="num frei">{z.wirksam ? formatCent(z.frei) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td>Summe ohne durchlaufende Posten</td><td className="num">{formatCent(s.ohne.ansatz)}</td><td className="num">{formatCent(s.ohne.aenderungen)}</td><td className="num">{formatCent(s.ohne.ist)}</td><td className="num">{formatCent(s.ohne.vorgemerkt)}</td><td className="num">{formatCent(s.ohne.frei)}</td></tr>
            {s.mit.ist !== s.ohne.ist && <tr><td>Summe mit durchlaufenden Posten</td><td className="num">{formatCent(s.mit.ansatz)}</td><td className="num">{formatCent(s.mit.aenderungen)}</td><td className="num">{formatCent(s.mit.ist)}</td><td className="num">{formatCent(s.mit.vorgemerkt)}</td><td className="num">{formatCent(s.mit.frei)}</td></tr>}
          </tfoot>
        </table>
      </div>
    )
  }
  return (
    <>
      <div className="hh-stats">
        <div className="hh-stat"><span className="hh-stat-label">Guthaben {p.stamm.kontoBezeichnung || 'beim Kreis'}</span><span className="hh-stat-value">{formatEuro(g.unsere)}</span><span className="hh-stat-sub">Anfang {formatEuro(g.anfang)}</span></div>
        <div className="hh-stat"><span className="hh-stat-label">Vom Kreis bestätigt</span><span className="hh-stat-value">{formatEuro(g.kreis)}</span><span className="hh-stat-sub">{g.offen ? `${formatEuro(g.offen)} noch offen` : 'alles abgeglichen'}</span></div>
        <div className="hh-stat"><span className="hh-stat-label">Ausgaben (ohne durchlaufende)</span><span className="hh-stat-value">{formatEuro(u.summen.ausgabe.ohne.ist)}</span><span className="hh-stat-sub">von {formatEuro(u.summen.ausgabe.ohne.wirksam)} · frei {formatEuro(u.summen.ausgabe.ohne.frei)}</span></div>
        <div className={`hh-stat ${ueber.length ? 'warn' : ''}`}><span className="hh-stat-label">Überschritten</span><span className="hh-stat-value">{ueber.length}</span><span className="hh-stat-sub">{ueber.map(z => z.stelle.name).join(', ') || 'keine Haushaltsstelle'}</span></div>
      </div>
      {u.unbekannteStellen.length > 0 && <div className="hh-error">Es gibt Buchungen auf Haushaltsstellen, die in der Gliederung fehlen. Bitte unter Einrichtung prüfen.</div>}
      {tabelle('ausgabe')}
      {tabelle('einnahme')}
    </>
  )
}

// ─── Ansatz ──────────────────────────────────────────────────────────────────

export function AnsatzPane(p: PaneProps): React.ReactElement {
  const { jahr, stamm, api, run, busy } = p
  const stellen = stellenFuer(stamm, jahr)
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [art, setArt] = useState<AenderungsArt>('nachtrag')
  const [stelleId, setStelleId] = useState('')
  const [zielId, setZielId] = useState('')
  const [betrag, setBetrag] = useState('')
  const [datum, setDatum] = useState(heuteIso().startsWith(String(jahr.jahr)) ? heuteIso() : `${jahr.jahr}-01-01`)
  const [bemerkung, setBemerkung] = useState('')
  const [anfang, setAnfang] = useState(formatCent(jahr.anfangsbestand))
  useEffect(() => setAnfang(formatCent(jahr.anfangsbestand)), [jahr.anfangsbestand])
  const zu = jahr.gesperrt
  const speichereAnsatz = (id: string) => {
    const t = edit[id]
    if (t === undefined) return
    const c = t.trim() === '' ? 0 : parseEuroDe(t)
    if (c === null || c < 0) return p.setFehler('Ansatz bitte als Betrag, z. B. 8.000,00.')
    void run(async () => {
      const r = await api.ansatz(id, c)
      setEdit(e => { const n = { ...e }; delete n[id]; return n })
      return r
    })
  }
  const label = (id: string) => { const s = stellen.find(x => x.id === id); return s ? stelleLabel(s) : '?' }
  return (
    <>
      <div className="hh-card">
        <h3>Ursprungsansatz {jahr.jahr}</h3>
        <p className="hh-muted hh-small">Der Ansatz steht meist auf der Hauptgruppe; bei Einnahmen oft auf den Unterstellen. Durchlaufende Posten zählen nicht zur Gruppe.</p>
        <table className="hh-table plain">
          <thead><tr><th>Haushaltsstelle</th><th className="num" style={{ width: 160 }}>Ansatz in €</th></tr></thead>
          <tbody>
            {stellen.filter(s => !s.inaktiv).map(s => (
              <tr key={s.id} className={s.parentId ? 'unter' : 'gruppe'}>
                <td>{s.kurz} {s.name}<span className="hh-tag">{s.nummer}{s.durchlaufend ? ' · durchlaufend' : ''}</span></td>
                <td className="num">
                  <input style={{ textAlign: 'right' }} disabled={zu} value={edit[s.id] ?? (jahr.ansatz[s.id] ? formatCent(jahr.ansatz[s.id]) : '')}
                    onChange={e => setEdit(x => ({ ...x, [s.id]: e.target.value }))} onBlur={() => speichereAnsatz(s.id)} onKeyDown={e => e.key === 'Enter' && speichereAnsatz(s.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hh-grid">
        <div className="hh-card">
          <h3>Ansatzänderung erfassen</h3>
          <div className="hh-segment">
            {(Object.keys(AENDERUNGS_ARTEN) as AenderungsArt[]).map(a => <button key={a} className={art === a ? 'active' : ''} onClick={() => setArt(a)}>{AENDERUNGS_ARTEN[a]}</button>)}
          </div>
          <div className="hh-row">
            <label className="hh-field"><span>{art === 'umschichtung' ? 'Von' : 'Haushaltsstelle'}</span>
              <select value={stelleId} onChange={e => setStelleId(e.target.value)}><option value="">—</option>{stellen.filter(s => !s.inaktiv).map(s => <option key={s.id} value={s.id}>{stelleLabel(s)}</option>)}</select></label>
            {art === 'umschichtung' && <label className="hh-field"><span>Nach</span>
              <select value={zielId} onChange={e => setZielId(e.target.value)}><option value="">—</option>{stellen.filter(s => !s.inaktiv && s.id !== stelleId).map(s => <option key={s.id} value={s.id}>{stelleLabel(s)}</option>)}</select></label>}
          </div>
          <div className="hh-row">
            <label className="hh-field"><span>Betrag in € {art === 'korrektur' && <em>(mit Vorzeichen)</em>}</span><input value={betrag} onChange={e => setBetrag(e.target.value)} inputMode="decimal" /></label>
            <label className="hh-field"><span>Datum</span><input type="date" value={datum} onChange={e => setDatum(e.target.value)} /></label>
          </div>
          <label className="hh-field"><span>Bemerkung <em>(z. B. „Mail Kämmerei vom 3.5.“)</em></span><input value={bemerkung} onChange={e => setBemerkung(e.target.value)} /></label>
          <div className="hh-actions"><button className="hh-btn primary" disabled={busy || zu} onClick={() => {
            const c = parseEuroDe(betrag)
            if (c === null || c === 0) return p.setFehler('Bitte einen Betrag angeben.')
            void run(async () => {
              const r = await api.aenderung({ datum, art, stelleId, zielId: zielId || undefined, betrag: c, bemerkung })
              setBetrag(''); setBemerkung('')
              return r
            })
          }}>Erfassen</button></div>
        </div>
        <div className="hh-card">
          <h3>Guthaben am 1. Januar {jahr.jahr}</h3>
          <p className="hh-muted hh-small">Kommt beim Jahresabschluss aus dem Vorjahr. Von Hand nur ändern, wenn die Liste des Kreises etwas anderes sagt.</p>
          <div className="hh-row">
            <input value={anfang} disabled={zu} onChange={e => setAnfang(e.target.value)} inputMode="decimal" />
            <button className="hh-btn" disabled={busy || zu} onClick={() => {
              const c = parseEuroDe(anfang)
              if (c === null) return p.setFehler('Bitte einen Betrag angeben.')
              void run(() => api.anfangsbestand(c))
            }}>Übernehmen</button>
          </div>
        </div>
      </div>
      <div className="hh-card" style={{ marginTop: 14 }}>
        <h3>Änderungen {jahr.jahr}</h3>
        {jahr.aenderungen.length === 0 ? <p className="hh-muted">Keine.</p> : (
          <table className="hh-table plain">
            <thead><tr><th>Datum</th><th>Art</th><th>Haushaltsstelle</th><th>Bemerkung</th><th className="num">Betrag</th><th /></tr></thead>
            <tbody>
              {[...jahr.aenderungen].sort((a, b) => a.datum.localeCompare(b.datum)).map(a => (
                <tr key={a.id}>
                  <td>{datumDe(a.datum)}</td><td>{AENDERUNGS_ARTEN[a.art]}{a.ausAbschluss ? <span className="hh-tag">aus Abschluss</span> : null}</td><td>{label(a.stelleId)}</td><td>{a.bemerkung}</td>
                  <td className="num">{formatCent(a.betrag)}</td>
                  <td>{!zu && <button className="hh-icon" title="Entfernen" onClick={() => void run(() => api.aenderungEntfernen(a.id))}>×</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

// ─── Abschluss ───────────────────────────────────────────────────────────────

export function AbschlussPane(p: PaneProps): React.ReactElement {
  const { jahr, stamm, api, run, busy } = p
  const stellen = stellenFuer(stamm, jahr)
  const [v, setV] = useState<AbschlussVorschlag | null>(null)
  const [betraege, setBetraege] = useState<Record<string, string>>({})
  const [mitnehmen, setMitnehmen] = useState<Set<string>>(new Set())
  const [grund, setGrund] = useState('')
  const [ok, setOk] = useState(false)
  useEffect(() => {
    if (jahr.gesperrt) return
    api.abschlussVorschlag().then(x => {
      setV(x)
      setBetraege(Object.fromEntries(x.uebertraege.map(u => [u.stelleId, formatCent(u.rest)])))
      setMitnehmen(new Set(x.offeneVormerkungen.map(b => b.id)))
    }, e => p.setFehler(fehlerText(e)))
  }, [api, jahr])

  if (jahr.gesperrt) {
    return (
      <div className="hh-card hh-form">
        <h3>{jahr.jahr} ist abgeschlossen</h3>
        <p>Abgeschlossen am {jahr.abschluss ? datumDe(jahr.abschluss.am.slice(0, 10)) : '?'}, Endstand {formatEuro(jahr.abschluss?.endstand ?? 0)}. Buchungen, die der Kreis erst im neuen Jahr bucht, lassen sich unter <b>Abgleich</b> weiter abhaken.</p>
        <label className="hh-field"><span>Entsperren — nur mit Begründung, steht im Protokoll</span><input value={grund} onChange={e => setGrund(e.target.value)} /></label>
        <div className="hh-actions"><button className="hh-btn danger" disabled={busy || !grund.trim()} onClick={() => void run(() => api.entsperren(grund))}>Entsperren</button></div>
      </div>
    )
  }
  if (!v) return <div className="hh-empty">Rechne …</div>
  const name = (id: string) => { const s = stellen.find(x => x.id === id); return s ? stelleLabel(s) : '?' }
  return (
    <div className="hh-form" style={{ maxWidth: 860 }}>
      <ol className="hh-steps">
        <li>Erst abschließen, wenn die Summen mit der alten Software bzw. der Liste des Kreises übereinstimmen.</li>
        <li>Das Plugin legt {jahr.jahr + 1} an: Guthaben als Anfangsbestand, Reste als Übertrag, ausgewählte Vormerkungen.</li>
        <li>Danach ist {jahr.jahr} gesperrt. Offene Anordnungen bleiben dort und werden weiter abgehakt.</li>
      </ol>
      {v.hindernisse.length > 0 && <div className="hh-error">{v.hindernisse.map(h => <span key={h}>{h}</span>)}</div>}
      <div className="hh-card"><h3>Guthaben {stamm.kontoBezeichnung} am 31.12.{jahr.jahr}</h3><div className="hh-stat-value">{formatEuro(v.endstand)}</div><p className="hh-muted hh-small">wird Anfangsbestand {jahr.jahr + 1}</p></div>
      <div className="hh-card">
        <h3>Übertrag der Reste nach {jahr.jahr + 1}</h3>
        {v.uebertraege.length === 0 ? <p className="hh-muted">Keine Reste.</p> : (
          <table className="hh-table plain"><tbody>
            {v.uebertraege.map(u => (
              <tr key={u.stelleId}><td>{name(u.stelleId)}<div className="hh-muted hh-small">Rest {formatEuro(u.rest)}</div></td>
                <td className="num" style={{ width: 160 }}><input style={{ textAlign: 'right' }} value={betraege[u.stelleId] ?? ''} onChange={e => setBetraege(b => ({ ...b, [u.stelleId]: e.target.value }))} /></td></tr>
            ))}
          </tbody></table>
        )}
        <p className="hh-muted hh-small">Betrag leeren oder 0 = kein Übertrag für diese Stelle.</p>
      </div>
      {v.offeneVormerkungen.length > 0 && (
        <div className="hh-card">
          <h3>Offene Vormerkungen</h3>
          <p className="hh-muted hh-small">Angehakte wandern mit neuer Nummer nach {jahr.jahr + 1}; die übrigen werden zurückgezogen.</p>
          {v.offeneVormerkungen.map(b => (
            <label key={b.id} className="hh-check"><input type="checkbox" checked={mitnehmen.has(b.id)} onChange={() => setMitnehmen(s => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n })} />
              <span>{b.belegnr} · {b.empfaenger} · {formatEuro(b.betrag)}<em>{name(b.stelleId)}</em></span></label>
          ))}
        </div>
      )}
      <div className="hh-card">
        <h3>Noch nicht beim Kreis ({v.offeneAnordnungen.length})</h3>
        {v.offeneAnordnungen.length === 0 ? <p className="hh-muted">Alles abgeglichen.</p> : (
          <ul className="hh-list">{v.offeneAnordnungen.slice(0, 30).map(b => <li key={b.id}>{b.belegnr} · {b.empfaenger} · {formatEuro(b.betrag)}</li>)}</ul>
        )}
      </div>
      <label className="hh-check"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /><span>Die Summen sind geprüft. {jahr.jahr} jetzt abschließen.</span></label>
      <div className="hh-actions">
        <button className="hh-btn primary" disabled={busy || !ok || v.hindernisse.length > 0} onClick={() => {
          const uebertraege: Array<{ stelleId: string; betrag: Cent }> = []
          for (const u of v.uebertraege) {
            const t = (betraege[u.stelleId] ?? '').trim()
            const c = t === '' ? 0 : parseEuroDe(t)
            if (c === null || c < 0) return p.setFehler(`Übertrag für ${name(u.stelleId)} ist kein gültiger Betrag.`)
            uebertraege.push({ stelleId: u.stelleId, betrag: c })
          }
          void run(() => api.abschliessen({ uebertraege, vormerkungenUebernehmen: [...mitnehmen] }))
        }}>{jahr.jahr} abschließen</button>
      </div>
    </div>
  )
}

// ─── Berichte ────────────────────────────────────────────────────────────────

export function BerichtePane(p: PaneProps): React.ReactElement {
  const { api, busy, stamm, jahr } = p
  const host = useHost()
  const alle = [...Object.keys(stamm.vorjahre).map(Number), ...stamm.jahre].sort((a, b) => a - b)
  const [von, setVon] = useState(alle[0] ?? jahr.jahr)
  const [bis, setBis] = useState(jahr.jahr)
  const [extern, setExtern] = useState(false)
  const [ergebnis, setErgebnis] = useState<Abgelegt | null>(null)
  const los = (fn: () => Promise<Abgelegt>) => void p.run(async () => { setErgebnis(await fn()); return null })
  return (
    <div className="hh-grid">
      <div className="hh-card">
        <h3>Haushaltstabelle für die Steuerungsgruppe</h3>
        <p className="hh-muted hh-small">Wie die bisherige Excel-Tabelle: Ansatz und Ist je Jahr, Summen mit und ohne durchlaufende Posten, Kontostand. Vorjahre erscheinen so, wie sie in der alten Tabelle standen; ab dem ersten Plugin-Jahr wird aus den Buchungen gerechnet.</p>
        <div className="hh-row">
          <label className="hh-field"><span>Von</span><select value={von} onChange={e => setVon(Number(e.target.value))}>{[...new Set([...alle, jahr.jahr])].map(j => <option key={j}>{j}</option>)}</select></label>
          <label className="hh-field"><span>Bis</span><select value={bis} onChange={e => setBis(Number(e.target.value))}>{[...new Set([...alle, jahr.jahr])].map(j => <option key={j}>{j}</option>)}</select></label>
        </div>
        <label className="hh-check"><input type="checkbox" checked={extern} onChange={e => setExtern(e.target.checked)} /><span>Zusätzlich „Speichern unter …“<em>Abgelegt wird immer im Vault unter Berichte/</em></span></label>
        <div className="hh-actions">
          <button className="hh-btn primary" disabled={busy} onClick={() => los(() => api.berichtXlsx({ von, bis, speichernUnter: extern }))}>Excel erstellen</button>
          <button className="hh-btn" disabled={busy} onClick={() => los(() => api.berichtPdf({ von, bis, speichernUnter: extern }))}>PDF erstellen</button>
        </div>
      </div>
      <div className="hh-card">
        <h3>Buchungsliste {jahr.jahr}</h3>
        <p className="hh-muted hh-small">Alle Buchungen mit Status, Kreisbestätigung und Beleg — als CSV für Excel (Semikolon, deutsches Zahlenformat).</p>
        <div className="hh-actions"><button className="hh-btn" disabled={busy} onClick={() => los(() => api.buchungenCsv(extern))}>CSV erstellen</button></div>
      </div>
      {ergebnis && (
        <div className="hh-card">
          <h3>Erstellt</h3>
          <p>{ergebnis.pfad}{ergebnis.extern ? <><br />und gespeichert unter {ergebnis.extern}</> : null}</p>
          {ergebnis.pfad.endsWith('.pdf') && <button className="hh-btn" onClick={() => void host.openLink?.(ergebnis.pfad)}>Öffnen</button>}
        </div>
      )}
    </div>
  )
}
