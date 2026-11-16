// Schmaler, vendorierter Ausschnitt des Plugin-Vertrags von MindGraph Notes (@mindgraph/plugin-api,
// API ≥0.2.3). Das Paket ist nicht auf npm veröffentlicht; die Typen hier sind zur Laufzeit gelöscht.
// Quelle: bydb/mindgraph-notes → app/packages/plugin-api/src/{entry,host,rendererHost}.ts.
// Bei einer neuen API-Version gegen die Quelle abgleichen — nur das, was dieses Plugin nutzt.

// ─── Main-Prozess ─────────────────────────────────────────────────────────────

export interface MainHost {
  vault: {
    read(relPath: string): Promise<string>
    readBytes(relPath: string): Promise<Uint8Array>
    exists(relPath: string): Promise<boolean>
    write(relPath: string, content: string): Promise<void>
    /** Binär schreiben: legt Ordner an, sichert die Vorfassung, schreibt über eine Zwischendatei. */
    writeBytes(relPath: string, bytes: Uint8Array): Promise<void>
  }
  pdf: {
    htmlToPdf(fullHtml: string): Promise<Uint8Array>
  }
  /** Nur gegen manifest.http.allowedHosts (Capability `http.fetch`). */
  http: {
    fetch(url: string, init?: RequestInit): Promise<Response>
  }
  /** Lokales Ollama-Modell der App; Cloud-Modelle nur mit allowCloud (Capability `llm.generate`). */
  llm: {
    generate(prompt: string, opts?: { allowCloud?: boolean; temperature?: number; maxTokens?: number }): Promise<string>
  }
  /** Websuche der App (Capability `web.search`, API ≥0.2.4). Fehlt bei älteren Apps. */
  web?: {
    search(query: string): Promise<Array<{ title: string; url: string; snippet: string }>>
    fetchPage(url: string, opts?: { maxChars?: number }): Promise<{ finalUrl: string; title: string; text: string; truncated: boolean }>
  }
  /** OS-Dialoge (Capability `dialog`): nur die vom Nutzer gewählte Datei wird gelesen/geschrieben. */
  dialog: {
    openFile(opts: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<{ path: string; bytes: Uint8Array } | null>
    saveFile(opts: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }, bytes: Uint8Array): Promise<{ path: string } | null>
  }
  log(...args: unknown[]): void
}

export interface MainContext {
  host: MainHost
  actions: { register(actionId: string, fn: (payload: unknown) => unknown | Promise<unknown>): void }
}

export interface MainEntry {
  id: string
  register(ctx: MainContext): void | Promise<void>
  start?(ctx: MainContext): Promise<void>
  stop?(): Promise<void>
}

/** Identisch zu `definePluginMain` aus @mindgraph/plugin-api — formt nur den Entry. */
export function definePluginMain(meta: { id: string }, setup: (ctx: MainContext) => void | Promise<void>): MainEntry {
  return { id: meta.id, register: setup }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export interface ComposeMailDraft {
  to?: Array<{ name?: string; address: string }>
  subject?: string
  body?: string
  attachments?: Array<{ name: string; bytes: Uint8Array }>
}

export interface RendererHost {
  readonly id: string
  readonly theme: 'light' | 'dark'
  onThemeChange(cb: (theme: 'light' | 'dark') => void): () => void
  log(...args: unknown[]): void
  vault: MainHost['vault']
  openLink?(link: string): Promise<'opened' | 'not-found' | 'refused'>
  registerWorkspaceTab?(opts: { tabId: string; mount: (container: HTMLElement, ctx: { host: RendererHost }) => () => void }): void
  invoke?<T = unknown>(actionId: string, payload?: unknown): Promise<T>
  composeMail?(draft: ComposeMailDraft): Promise<void>
}

export interface RendererModule {
  id: string
  activate(host: RendererHost): void | Promise<void>
  deactivate?(): void | Promise<void>
}
