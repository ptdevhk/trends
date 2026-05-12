import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './styles/globals.css'
import App from './App.tsx'
import { initWebVitals } from './lib/web-vitals'
import { initSentry } from './lib/sentry'

import { ConvexProvider, ConvexReactClient } from 'convex/react'

initSentry()
initWebVitals()

const convexUrl = import.meta.env.VITE_CONVEX_URL
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null
const enableStrictMode = import.meta.env.PROD || import.meta.env.VITE_ENABLE_STRICT_MODE === 'true'

const app = convex ? (
  <ConvexProvider client={convex}>
    <App />
  </ConvexProvider>
) : (
  <div className="p-4 bg-yellow-100 text-yellow-800">
    Warning: VITE_CONVEX_URL not set in .env
    <App />
  </div>
)

createRoot(document.getElementById('root')!).render(
  enableStrictMode ? <StrictMode>{app}</StrictMode> : app,
)
