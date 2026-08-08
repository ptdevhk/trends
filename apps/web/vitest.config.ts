/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // In tests, force react/react-dom to root node_modules (React 19, pinned as a
    // root devDependency) so they match @testing-library/react which is hoisted to
    // root and uses root's react-dom (React 19). Mixed React versions (18 at root
    // via stale hoisting) produce divergent act()/effect behavior in tests.
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: /^react\/jsx-runtime$/, replacement: path.resolve(__dirname, '../../node_modules/react/jsx-runtime') },
      { find: /^react\/jsx-dev-runtime$/, replacement: path.resolve(__dirname, '../../node_modules/react/jsx-dev-runtime') },
      { find: /^react-dom\/client$/, replacement: path.resolve(__dirname, '../../node_modules/react-dom/client') },
      { find: /^react-dom$/, replacement: path.resolve(__dirname, '../../node_modules/react-dom') },
      { find: /^react$/, replacement: path.resolve(__dirname, '../../node_modules/react') },
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    // Watchdog: an infinite React update loop ("Maximum update depth exceeded")
    // used to stream warnings for 30 minutes until the CI job timeout killed
    // the run. Fail the offending test immediately instead — the message tells
    // the developer what the usual cause is (an effect depending on an
    // unstable callback, e.g. `t` from an unstable react-i18next mock).
    onConsoleLog(log, type) {
      if ((type === 'stderr' || type === 'error') && log.includes('Maximum update depth exceeded')) {
        throw new Error(
          'Detected an infinite React update loop ("Maximum update depth exceeded"). ' +
            'Likely cause: a mount effect depends on a useCallback that closes over `t` ' +
            '(or another per-render value) from a react-i18next mock. Omit `t` from the ' +
            'callback deps and/or make the mock return a module-scope `t`.',
        )
      }
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.d.ts', 'src/vite-env.d.ts'],
    },
  },
})
