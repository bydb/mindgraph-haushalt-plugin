// Haushalt — Main-Entry. Einziger Schreiber der Daten.
//
// Jede Action: Dateien lesen → genau ein Übergang aus store.ts → zurückschreiben, alles in EINER
// Warteschlange (zwei schnelle Klicks vergeben sonst dieselbe Belegnummer). Schreiben nur über
// host.vault.writeBytes (legt Ordner an, sichert die Vorfassung, schreibt über eine Zwischendatei).
// Dateien vom Rechner kommen nur über den OS-Dialog (host.dialog) — nie ein Pfad aus dem Renderer.
//
// Importiert NIE rohes fs/electron (der Build verbietet es).

import { definePluginMain } from '../host'
import type { Cent } from '../geld'
import { type Jahr, type Stammdaten, STAMM_FILE, belegDateiname, jahrRelPath, leereStammdaten, leeresJahr, normalizeJahr, normalizeStamm, stellenFuer } from '../model'
import { type QifBuchung, decodeQif, nummernImPfad, parseQif } from '../qif'
import { abschlussVorschlag, uebersicht } from '../rechnen'
import * as st from '../store'
import { type VorlageImport, berichtDaten, berichtZeilen, leseVorlage } from '../vorlage'
import { leseXlsx, schreibeXlsx } from '../xlsx'
import { berichtHtml, buchungenCsv } from '../ausgabe'

export const PLUGIN_ID = 'mindgraph-haushalt'

/** Vault-relativer Ordner ohne Ausbruch: keine absoluten Pfade, kein `..`. */
export function safeFolder(folder: unknown): string {
  const f = String(folder ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!f || f.split('/').some(seg => seg === '..' || seg === '.' || seg === '') || /^[a-zA-Z]:/.test(f)) {
    throw new Error('Ungültiger Ordner für den Haushalt.')
  }
  return f
}

function safeJahr(j: unknown): number {
  const n = Number(j)
  if (!Number.isInteger(n) || n < 2000 || n > 2100) throw new Error('Ungültiges Haushaltsjahr.')
  return n
}

const MAX_BELEG = 25 * 1024 * 1024
const MAX_IMPORT = 10 * 1024 * 1024

function newId(): string {
  return crypto.randomUUID()
}

function ctx(): st.Ctx {
  return { jetzt: new Date().toISOString(), neueId: newId }
}

function heuteDe(): string {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

function dateiDatum(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`
}

export default definePluginMain({ id: PLUGIN_ID }, ({ host, actions }) => {
  host.log('register')
  const A = (name: string): string => `${PLUGIN_ID}.${name}`
  const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2) + '\n')

  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  const readJson = async (rel: string): Promise<unknown | null> => {
    if (!(await host.vault.exists(rel))) return null
    const text = await host.vault.read(rel)
    try {
      return JSON.parse(text)
    } catch {
      // Nie über eine unlesbare Datei schreiben — sonst wären Buchungen weg.
      throw new Error(`${rel} ist kein gültiges JSON. Bitte die Datei prüfen (Sicherungen unter .mindgraph/backups).`)
    }
  }

  const loadStamm = async (folder: string): Promise<Stammdaten> => {
    const raw = await readJson(`${folder}/${STAMM_FILE}`)
    return raw === null ? leereStammdaten() : normalizeStamm(raw)
  }
  const saveStamm = (folder: string, s: Stammdaten) => host.vault.writeBytes(`${folder}/${STAMM_FILE}`, enc(s))

  const loadJahr = async (folder: string, jahr: number): Promise<Jahr | null> => {
    const raw = await readJson(jahrRelPath(folder, jahr))
    return raw === null ? null : normalizeJahr(raw, jahr)
  }
  const mustJahr = async (folder: string, jahr: number): Promise<Jahr> => {
    const j = await loadJahr(folder, jahr)
    if (!j) throw new Error(`Für ${jahr} gibt es noch keine Daten. Bitte das Jahr zuerst anlegen.`)
    return j
  }
  const saveJahr = async (folder: string, j: Jahr, stamm?: Stammdaten): Promise<void> => {
    await host.vault.writeBytes(jahrRelPath(folder, j.jahr), enc(j))
    const s = stamm ?? (await loadStamm(folder))
    if (!s.jahre.includes(j.jahr)) await saveStamm(folder, { ...s, jahre: [...s.jahre, j.jahr].sort((a, b) => a - b) })
  }

  const loadAlleJahre = async (folder: string, stamm: Stammdaten): Promise<Jahr[]> => {
    const out: Jahr[] = []
    for (const y of stamm.jahre) {
      const j = await loadJahr(folder, y)
      if (j) out.push(j)
    }
    return out
  }

  /**
   * Noch nicht vom Kreis bestätigter Saldo, den ein Jahr aus seinen Vorjahren erbt (F13). Gilt nur, solange
   * der Anfangsbestand aus einem Abschluss stammt; wird bei jedem Laden neu gerechnet, damit spätes Abhaken
   * im alten Jahr sofort im neuen ankommt.
   */
  const vorjahrOffen = async (folder: string, stamm: Stammdaten, j: Jahr, tiefe = 0): Promise<number> => {
    if (tiefe > 50 || !j.anfangAusAbschluss) return 0
    const vj = await loadJahr(folder, j.jahr - 1)
    // Nur wenn der Anfangsbestand unverändert aus GENAU diesem Abschluss stammt (F24).
    if (!vj?.abschluss || vj.abschluss.id !== j.anfangAusAbschluss) return 0
    const erbe = await vorjahrOffen(folder, stamm, vj, tiefe + 1)
    return uebersicht(stamm, vj, erbe).guthaben.offen
  }

  /** Antwort für die Oberfläche: Stammdaten + gewähltes Jahr + abgeleitete Sicht. */
  const ansicht = async (folder: string, jahr: number, stammIn?: Stammdaten, jahrIn?: Jahr | null) => {
    const stamm = stammIn ?? (await loadStamm(folder))
    const j = jahrIn !== undefined ? jahrIn : await loadJahr(folder, jahr)
    // Jahresdatei vorhanden, aber nicht in der Liste (abgebrochenes Anlegen, F14): Liste reparieren.
    if (j && !stamm.jahre.includes(j.jahr)) {
      stamm.jahre = [...stamm.jahre, j.jahr].sort((a, b) => a - b)
      await saveStamm(folder, stamm)
    }
    let warnung: string | null = null
    if (j) {
      const folge = await loadJahr(folder, jahr + 1)
      if (st.abschlussUnvollstaendig(j, folge)) warnung = `Der Abschluss ${jahr} ist nicht vollständig: ${jahr + 1} hat bereits Überträge, ${jahr} ist aber nicht gesperrt. Bitte den Abschluss erneut ausführen.`
    }
    return { stamm, jahr: j, uebersicht: j ? uebersicht(stamm, j, await vorjahrOffen(folder, stamm, j)) : null, warnung }
  }

  type P = Record<string, unknown> & { folder: string; jahr: number }
  const parse = (payload: unknown): P => {
    const p = (payload ?? {}) as Record<string, unknown>
    return { ...p, folder: safeFolder(p.folder), jahr: p.jahr === undefined ? new Date().getFullYear() : safeJahr(p.jahr) }
  }

  /** Lesen → ein Übergang am Jahr → schreiben → neue Ansicht. */
  const mitJahr = (name: string, fn: (p: P, stamm: Stammdaten, j: Jahr) => Jahr | { jahr: Jahr }) =>
    actions.register(A(name), payload =>
      serial(async () => {
        const p = parse(payload)
        const stamm = await loadStamm(p.folder)
        const j = await mustJahr(p.folder, p.jahr)
        const r = fn(p, stamm, j)
        const neu = 'protokoll' in r ? r : r.jahr
        if (neu !== j) await saveJahr(p.folder, neu, stamm)
        return ansicht(p.folder, p.jahr, stamm, neu)
      }),
    )

  // ─── Laden, Stammdaten, Jahre ─────────────────────────────────────────────

  actions.register(A('load'), payload =>
    serial(async () => {
      const p = parse(payload)
      return ansicht(p.folder, p.jahr)
    }),
  )

  actions.register(A('saveStamm'), payload =>
    serial(async () => {
      const p = parse(payload)
      const alt = await loadStamm(p.folder)
      const roh = (payload as { stamm?: unknown }).stamm
      if (!roh || typeof roh !== 'object' || !Array.isArray((roh as { stellen?: unknown }).stellen)) throw new Error('Gliederung fehlt im Aufruf.')
      const neuRaw = normalizeStamm(roh)
      // Jahresliste, Vorjahreswerte und QIF-Zuordnung verwaltet Main, nicht das Formular.
      const neu = st.saveStamm(alt, { ...neuRaw, jahre: alt.jahre, vorjahre: alt.vorjahre, vorjahrKontostand: alt.vorjahrKontostand, qifZuordnung: { ...alt.qifZuordnung, ...neuRaw.qifZuordnung } }, await loadAlleJahre(p.folder, alt))
      await saveStamm(p.folder, neu)
      return ansicht(p.folder, p.jahr, neu)
    }),
  )

  actions.register(A('jahrAnlegen'), payload =>
    serial(async () => {
      const p = parse(payload)
      const stamm = await loadStamm(p.folder)
      if (await loadJahr(p.folder, p.jahr)) return ansicht(p.folder, p.jahr, stamm) // repariert ggf. die Jahresliste
      const anfang = Number((payload as { anfangsbestand?: unknown }).anfangsbestand ?? 0)
      const j: Jahr = { ...leeresJahr(p.jahr), anfangsbestand: Number.isSafeInteger(anfang) ? anfang : 0 }
      const neu = { ...j, protokoll: [{ zeit: new Date().toISOString(), aktion: 'jahr.anlegen', nachher: { anfangsbestand: j.anfangsbestand } }] }
      await saveJahr(p.folder, neu, stamm)
      return ansicht(p.folder, p.jahr, await loadStamm(p.folder), neu)
    }),
  )

  // ─── Buchungen ────────────────────────────────────────────────────────────

  mitJahr('buchung', (p, stamm, j) => st.upsertBuchung(stamm, j, p.eingabe as st.BuchungEingabe, ctx()))
  mitJahr('vormerkungLoeschen', (p, _s, j) => st.loescheVormerkung(j, String(p.id), ctx()))
  mitJahr('zurueckziehen', (p, _s, j) => st.zurueckziehen(j, String(p.id), String(p.grund ?? ''), ctx()))
  mitJahr('stornieren', (p, _s, j) => st.stornieren(j, String(p.id), String(p.grund ?? ''), String(p.datum ?? ''), ctx()))
  mitJahr('anordnen', (p, _s, j) => st.anordnen(j, (p.ids as string[]) ?? [], ctx()))
  mitJahr('abhaken', (p, _s, j) => st.abhaken(j, p.abhaken as st.Abhaken, ctx()))
  mitJahr('abhakenAufheben', (p, _s, j) => st.abhakenAufheben(j, String(p.id), ctx()))

  actions.register(A('belegAnhaengen'), payload =>
    serial(async () => {
      const p = parse(payload)
      const stamm = await loadStamm(p.folder)
      const j = await mustJahr(p.folder, p.jahr)
      const b = j.buchungen.find(x => x.id === p.id)
      if (!b) throw new Error('Buchung nicht gefunden.')
      if (j.gesperrt) throw new Error(`${j.jahr} ist abgeschlossen — Belege lassen sich nicht mehr ändern.`)
      const datei = await host.dialog.openFile({ title: `Beleg für ${b.belegnr}`, filters: [{ name: 'Belege', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }] })
      if (!datei) return ansicht(p.folder, p.jahr, stamm, j)
      if (datei.bytes.length > MAX_BELEG) throw new Error('Der Beleg ist größer als 25 MB.')
      const endung = (/\.([a-z0-9]{1,5})$/i.exec(datei.path)?.[1] ?? 'pdf').toLowerCase()
      let rel = `${p.folder}/${j.jahr}/Belege/${belegDateiname(b.belegnr, b.empfaenger, endung)}`
      for (let n = 2; await host.vault.exists(rel); n++) rel = rel.replace(/( \(\d+\))?(\.[a-z0-9]+)$/i, ` (${n})$2`)
      await host.vault.writeBytes(rel, datei.bytes)
      const neu = st.belegVerknuepfen(j, b.id, rel, ctx())
      await saveJahr(p.folder, neu, stamm)
      return ansicht(p.folder, p.jahr, stamm, neu)
    }),
  )

  // ─── Ansatz ───────────────────────────────────────────────────────────────

  mitJahr('ansatz', (p, _s, j) => st.setAnsatz(j, String(p.stelleId), Number(p.betrag), ctx()))
  mitJahr('aenderung', (p, stamm, j) => st.addAenderung(stamm, j, p.eingabe as st.AenderungEingabe, ctx()))
  mitJahr('aenderungEntfernen', (p, _s, j) => st.entferneAenderung(j, String(p.id), ctx()))
  mitJahr('anfangsbestand', (p, _s, j) => st.setAnfangsbestand(j, Number(p.betrag), ctx()))

  // ─── QIF-Import ───────────────────────────────────────────────────────────

  const qifCache = new Map<string, { name: string; bytes: Uint8Array; konto: string; buchungen: QifBuchung[] }>()

  const vorschlagZuordnung = (stamm: Stammdaten, j: Jahr, kategorien: string[]): Record<string, string> => {
    const stellen = stellenFuer(stamm, j)
    const out: Record<string, string> = {}
    for (const k of kategorien) {
      if (stamm.qifZuordnung[k]) {
        out[k] = stamm.qifZuordnung[k]
        continue
      }
      const letzter = k.split(':').at(-1)!.replace(/^\s*\d{4}\s*/, '').trim().toLowerCase()
      for (const nr of nummernImPfad(k)) {
        const kandidaten = stellen.filter(s => s.nummer === nr && !stellen.some(u => u.parentId === s.id))
        const genau = kandidaten.find(s => s.name.trim().toLowerCase() === letzter) ?? (kandidaten.length === 1 ? kandidaten[0] : undefined)
        if (genau) {
          out[k] = genau.id
          break
        }
      }
    }
    return out
  }

  actions.register(A('qifLesen'), payload =>
    serial(async () => {
      const p = parse(payload)
      const stamm = await loadStamm(p.folder)
      const j = await mustJahr(p.folder, p.jahr)
      const datei = await host.dialog.openFile({ title: 'Quicken-Export (QIF) wählen', filters: [{ name: 'Quicken QIF', extensions: ['qif', 'QIF'] }] })
      if (!datei) return null
      if (datei.bytes.length > MAX_IMPORT) throw new Error('Die Datei ist größer als 10 MB.')
      const r = parseQif(decodeQif(datei.bytes))
      const token = newId()
      const name = datei.path.split(/[\\/]/).pop() ?? 'import.qif'
      qifCache.set(token, { name, bytes: datei.bytes, konto: r.konto, buchungen: r.buchungen })
      const kategorien = [...new Set(r.buchungen.map(b => b.kategorie))].sort()
      const zuordnung = vorschlagZuordnung(stamm, j, kategorien)
      return { token, name, konto: r.konto, probleme: r.probleme, ignoriert: r.ignoriert, summe: r.summe, kategorien, zuordnung, plan: st.qifPlan(stamm, j, r.konto, r.buchungen, zuordnung, name) }
    }),
  )

  actions.register(A('qifPlan'), payload =>
    serial(async () => {
      const p = parse(payload)
      const c = qifCache.get(String(p.token))
      if (!c) throw new Error('Der Import ist abgelaufen. Bitte die Datei erneut wählen.')
      const stamm = await loadStamm(p.folder)
      const j = await mustJahr(p.folder, p.jahr)
      return st.qifPlan(stamm, j, c.konto, c.buchungen, (p.zuordnung as Record<string, string>) ?? {}, c.name)
    }),
  )

  actions.register(A('qifImport'), payload =>
    serial(async () => {
      const p = parse(payload)
      const c = qifCache.get(String(p.token))
      if (!c) throw new Error('Der Import ist abgelaufen. Bitte die Datei erneut wählen.')
      const zuordnung = (p.zuordnung as Record<string, string>) ?? {}
      const stamm = await loadStamm(p.folder)
      const j = await mustJahr(p.folder, p.jahr)
      const plan = st.qifPlan(stamm, j, c.konto, c.buchungen, zuordnung, c.name)
      const r = st.qifUebernehmen(j, c.name, plan, { konfliktNeueNummer: (p.konfliktNeueNummer as number[]) ?? [] }, ctx())
      // Originaldatei unverändert ins Archiv (nie überschreiben).
      let arch = `${p.folder}/Archiv-Quicken/${c.name}`
      for (let n = 2; await host.vault.exists(arch); n++) arch = arch.replace(/( \(\d+\))?(\.[^.]+)?$/, (_m, _a, ext) => ` (${n})${ext ?? ''}`)
      await host.vault.writeBytes(arch, c.bytes)
      const stammNeu = { ...stamm, qifZuordnung: { ...stamm.qifZuordnung, ...zuordnung } }
      await saveStamm(p.folder, stammNeu)
      if (r.anzahl) await saveJahr(p.folder, r.jahr, stammNeu)
      qifCache.delete(String(p.token))
      return { anzahl: r.anzahl, summe: r.summe, archiv: arch, ...(await ansicht(p.folder, p.jahr, stammNeu, r.jahr)) }
    }),
  )

  // ─── Erstimport aus der Excel-Vorlage ─────────────────────────────────────

  const vorlageCache = new Map<string, VorlageImport>()

  actions.register(A('vorlageLesen'), payload =>
    serial(async () => {
      parse(payload)
      const datei = await host.dialog.openFile({ title: 'Haushaltstabelle (Excel) wählen', filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
      if (!datei) return null
      if (datei.bytes.length > MAX_IMPORT) throw new Error('Die Datei ist größer als 10 MB.')
      const imp = leseVorlage(leseXlsx(datei.bytes), newId)
      const token = newId()
      vorlageCache.set(token, imp)
      return { token, ...imp }
    }),
  )

  actions.register(A('vorlageUebernehmen'), payload =>
    serial(async () => {
      const p = parse(payload)
      const imp = vorlageCache.get(String(p.token))
      if (!imp) throw new Error('Der Import ist abgelaufen. Bitte die Datei erneut wählen.')
      const erstesJahr = safeJahr(p.erstesJahr)
      const durchlaufend = new Set((p.durchlaufend as string[]) ?? [])
      const stamm = await loadStamm(p.folder)
      const jahre = await loadAlleJahre(p.folder, stamm)
      if (jahre.some(j => j.buchungen.length)) throw new Error('Es gibt schon Buchungen. Die Gliederung lässt sich dann nicht mehr per Import ersetzen — bitte unter Einrichtung bearbeiten.')
      // Nur in leere Jahre importieren (F19) — vor dem ersten Schreiben alle Zieljahre prüfen.
      for (const y of Object.keys(imp.werte).map(Number).filter(y => y >= erstesJahr)) {
        const j = await loadJahr(p.folder, y)
        if (j && (Object.keys(j.ansatz).length || j.aenderungen.length || j.gesperrt)) {
          throw new Error(`${y} hat schon Ansätze oder Änderungen. Der Import überschreibt keine vorhandenen Werte — bitte dort von Hand anpassen oder ein späteres erstes Jahr wählen.`)
        }
      }
      const stellen = imp.stellen.map(s => (durchlaufend.has(s.id) ? { ...s, durchlaufend: true } : s))
      const vorjahre: Stammdaten['vorjahre'] = {}
      const kontostand: Stammdaten['vorjahrKontostand'] = {}
      for (const [y, w] of Object.entries(imp.werte)) if (Number(y) < erstesJahr) vorjahre[y] = w
      for (const [y, k] of Object.entries(imp.kontostand)) if (Number(y) < erstesJahr) kontostand[y] = k
      const neu: Stammdaten = { ...stamm, einrichtung: String(p.einrichtung ?? stamm.einrichtung), kontoBezeichnung: String(p.kontoBezeichnung ?? stamm.kontoBezeichnung), stellen, vorjahre, vorjahrKontostand: kontostand }
      st.saveStamm(leereStammdaten(), neu, []) // prüft die Gliederung (Jahre sind leer, siehe oben)
      await saveStamm(p.folder, neu)
      // Ansätze ab dem ersten Plugin-Jahr in die Jahresdateien.
      for (const [y, w] of Object.entries(imp.werte)) {
        const jahr = Number(y)
        if (jahr < erstesJahr) continue
        const ansatz: Record<string, Cent> = {}
        for (const [id, v] of Object.entries(w)) if (v.ansatz !== undefined) ansatz[id] = v.ansatz
        if (!Object.keys(ansatz).length) continue
        const j = (await loadJahr(p.folder, jahr)) ?? leeresJahr(jahr)
        if (j.gesperrt) continue
        // Anfangsbestand nur, wenn der Nutzer ihn im Import bestätigt hat — der Endstand der alten Tabelle
        // kam real aus einer fehlerhaften Formel (Ende 2025 −11.892,02 statt 1.229,33 laut Kreisliste).
        const bestaetigt = Number(p.anfangsbestand)
        const anfang = jahr === erstesJahr && p.anfangsbestand !== undefined && Number.isSafeInteger(bestaetigt) ? bestaetigt : j.anfangsbestand
        await saveJahr(p.folder, { ...j, ansatz, anfangsbestand: anfang, protokoll: [...j.protokoll, { zeit: new Date().toISOString(), aktion: 'vorlage.import', nachher: { ansaetze: Object.keys(ansatz).length } }] }, await loadStamm(p.folder))
      }
      vorlageCache.delete(String(p.token))
      return ansicht(p.folder, p.jahr)
    }),
  )

  // ─── Jahresabschluss ──────────────────────────────────────────────────────

  actions.register(A('abschlussVorschlag'), payload =>
    serial(async () => {
      const p = parse(payload)
      const stamm = await loadStamm(p.folder)
      return abschlussVorschlag(stamm, await mustJahr(p.folder, p.jahr))
    }),
  )

  actions.register(A('abschliessen'), payload =>
    serial(async () => {
      const p = parse(payload)
      const stamm = await loadStamm(p.folder)
      const alt = await mustJahr(p.folder, p.jahr)
      const folge = await loadJahr(p.folder, p.jahr + 1)
      const r = st.abschliessen(stamm, alt, folge, p.eingabe as st.AbschlussEingabe, ctx())
      // Reihenfolge (F01): erst das Folgejahr, dann die Sperre.
      await saveJahr(p.folder, r.folge, stamm)
      await saveJahr(p.folder, r.alt, await loadStamm(p.folder))
      return ansicht(p.folder, p.jahr, undefined, r.alt)
    }),
  )

  mitJahr('entsperren', (p, _s, j) => st.entsperren(j, String(p.grund ?? ''), ctx()))

  // ─── Berichte ─────────────────────────────────────────────────────────────

  const ablegen = async (folder: string, name: string, bytes: Uint8Array, speichernUnter: boolean, filter: { name: string; extensions: string[] }) => {
    let rel = `${folder}/Berichte/${name}`
    for (let n = 2; await host.vault.exists(rel); n++) rel = rel.replace(/( \(\d+\))?(\.[a-z]+)$/i, ` (${n})$2`)
    await host.vault.writeBytes(rel, bytes)
    let extern: string | null = null
    if (speichernUnter) extern = (await host.dialog.saveFile({ title: 'Bericht speichern', defaultPath: name, filters: [filter] }, bytes))?.path ?? null
    return { pfad: rel, extern }
  }

  const berichtLaden = async (p: P) => {
    const stamm = await loadStamm(p.folder)
    const jahre = await loadAlleJahre(p.folder, stamm)
    const alleJahre = [...Object.keys(stamm.vorjahre).map(Number), ...stamm.jahre]
    const von = p.von === undefined ? Math.min(...alleJahre, p.jahr) : safeJahr(p.von)
    const bis = p.bis === undefined ? p.jahr : safeJahr(p.bis)
    const d = berichtDaten({ stamm, jahre, von, bis, mitFolgeansatz: p.mitFolgeansatz !== false, stand: heuteDe() })
    return { stamm, jahre, d }
  }

  actions.register(A('berichtXlsx'), payload =>
    serial(async () => {
      const p = parse(payload)
      const { stamm, jahre, d } = await berichtLaden(p)
      const { zeilen, breiten } = berichtZeilen(d, stamm, jahre)
      const bytes = schreibeXlsx('Haushalt', zeilen, breiten)
      return ablegen(p.folder, `Haushalt ${dateiDatum()}.xlsx`, bytes, p.speichernUnter === true, { name: 'Excel', extensions: ['xlsx'] })
    }),
  )

  actions.register(A('berichtPdf'), payload =>
    serial(async () => {
      const p = parse(payload)
      const { stamm, jahre, d } = await berichtLaden(p)
      const { zeilen } = berichtZeilen(d, stamm, jahre)
      const bytes = await host.pdf.htmlToPdf(berichtHtml(d.titel, `Stand ${d.stand}`, zeilen))
      return ablegen(p.folder, `Haushalt ${dateiDatum()}.pdf`, bytes, p.speichernUnter === true, { name: 'PDF', extensions: ['pdf'] })
    }),
  )

  actions.register(A('buchungenCsv'), payload =>
    serial(async () => {
      const p = parse(payload)
      const stamm = await loadStamm(p.folder)
      const j = await mustJahr(p.folder, p.jahr)
      const bytes = new TextEncoder().encode('﻿' + buchungenCsv(stamm, j))
      return ablegen(p.folder, `Buchungen ${p.jahr} ${dateiDatum()}.csv`, bytes, p.speichernUnter === true, { name: 'CSV', extensions: ['csv'] })
    }),
  )

  host.log("bereit")
})
