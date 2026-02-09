import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './styles/globals.css'
import App from './App.tsx'

import { ConvexProvider, ConvexReactClient } from 'convex/react'

const convexUrl = import.meta.env.VITE_CONVEX_URL
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {convex ? (
      <ConvexProvider client={convex}>
        <App />
      </ConvexProvider>
    ) : (
      <div className="p-4 bg-yellow-100 text-yellow-800">
        Warning: VITE_CONVEX_URL not set in .env
        <App />
      </div>
    )}
  </StrictMode>,
)
