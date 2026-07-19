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
    globals: true,
    // M6-T4: @measured/puck's <Puck> pulls in @dnd-kit/dom, which touches
    // `ResizeObserver` at module top-level import time — earlier than any
    // single test file's own `vi.stubGlobal` call can run. See
    // src/__tests__/stubs/resize-observer-setup.ts.
    setupFiles: ['./src/__tests__/stubs/resize-observer-setup.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/__tests__/**',
        '**/*.test.*',
        '**/*.d.ts',
        'vitest.config.*',
        'next.config.*',
        '**/*.config.*',
        '**/node_modules/**',
      ],
      reporter: ['text-summary', 'text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      // M8-T10 all-source baseline: statements 58.91%, branches 50.16%,
      // functions 51.93%, lines 59.91%. These regression floors should ratchet
      // upward over time toward 80%+, especially branches and functions.
      thresholds: {
        statements: 57,
        branches: 49,
        functions: 50,
        lines: 58,
      },
    },
  },
})
