import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // Next.js aliases the "server-only" marker at build time; Vitest needs
      // a resolvable stub so server modules (src/lib/db/admin*) can load.
      'server-only': fileURLToPath(
        new URL('./src/__tests__/stubs/server-only.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true
  },
})
