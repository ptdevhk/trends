import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const apiPort = process.env.API_PORT || '3000'
const mcpPort = process.env.MCP_PORT || '3333'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            // Feature-based app code splitting
            if (
              id.includes('/components/search/') ||
              id.includes('/hooks/useConvexResumes') ||
              id.includes('/hooks/useResumeSearchState') ||
              id.includes('/hooks/useStableQuery') ||
              id.includes('/lib/highlight') ||
              id.includes('/lib/resume-scoring') ||
              id.includes('/lib/retry')
            ) {
              return 'search-feature'
            }
            if (
              id.includes('/pages/Settings') ||
              id.includes('/layouts/Settings') ||
              id.includes('/pages/SystemSettings')
            ) {
              return 'settings-feature'
            }
            return undefined
          }

          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router-dom/') ||
            id.includes('/@remix-run/router/')
          ) {
            return 'react-vendor'
          }

          if (id.includes('/convex/')) {
            return 'convex-vendor'
          }

          if (
            id.includes('/i18next/') ||
            id.includes('/react-i18next/') ||
            id.includes('/i18next-browser-languagedetector/')
          ) {
            return 'i18n-vendor'
          }

          if (id.includes('/@radix-ui/')) {
            return 'radix-vendor'
          }

          if (
            id.includes('/date-fns/') ||
            id.includes('/lucide-react/') ||
            id.includes('/sonner/') ||
            id.includes('/clsx/') ||
            id.includes('/class-variance-authority/') ||
            id.includes('/tailwind-merge/')
          ) {
            return 'ui-vendor'
          }

          return undefined
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    configureServer(server) {
      // Nightly-UAT F11: Node's 5 s default keepAliveTimeout closes idle
      // keep-alive sockets that the browser still holds in its pool; reusing
      // a closed socket resets the request (net::ERR_FAILED) — browser-only,
      // bursts of 3, self-heals on reload. The API server got the same
      // keepAliveTimeout raise; keep this leg alive too. headersTimeout must
      // stay above keepAliveTimeout (Node docs).
      server.httpServer.keepAliveTimeout = 65_000
      server.httpServer.headersTimeout = 70_000
    },
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
      '/worker': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
      '/mcp': {
        target: `http://localhost:${mcpPort}`,
        changeOrigin: true,
      },
    },
  },
})
