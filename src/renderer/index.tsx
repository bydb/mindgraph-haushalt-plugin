// Haushalt — Renderer-Entry (Single-File-ESM, eigenes React). Vertrag: export default { id, activate }.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { RendererHost, RendererModule } from '../host'
import { ApiContext, HostContext, PLUGIN_ID, makeApi } from './api'
import HaushaltView from './HaushaltView'

const plugin: RendererModule = {
  id: PLUGIN_ID,
  activate(host: RendererHost) {
    if (!host.registerWorkspaceTab) {
      host.log('Diese MindGraph-Version kennt keine Arbeitsbereich-Tabs (Plugin-API 0.2.3 nötig).')
      return
    }
    host.registerWorkspaceTab({
      tabId: 'main',
      mount: (container, { host: h }) => {
        const root = createRoot(container)
        root.render(
          <StrictMode>
            <HostContext.Provider value={h}>
              <ApiContext.Provider value={makeApi(h)}>
                <HaushaltView />
              </ApiContext.Provider>
            </HostContext.Provider>
          </StrictMode>,
        )
        return () => root.unmount()
      },
    })
  },
}

export default plugin
