import { defineConfig } from 'vitest/config'

// Nur Tests aus src/ — `private/` enthält lokale Prüfungen gegen echte Daten und ist nicht im Repo.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
