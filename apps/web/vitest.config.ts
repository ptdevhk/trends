/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // In tests, force react/react-dom to root node_modules (React 18) so they match
    // @testing-library/react which is hoisted to root and uses root's react-dom (React 18).
    // React 19 elements use Symbol.for('react.transitional.element') which React 18's
    // reconciler doesn't recognise — aliasing everything to React 18 keeps it consistent.
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.d.ts', 'src/vite-env.d.ts'],
    },
  },
})
