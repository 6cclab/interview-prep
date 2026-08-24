import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ensureSession } from './session-boot'
import './styles.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('missing #root element')

// Identity first, then render.
//
// The landing screen fetches `/api/problems` and `/api/history` as soon as it
// mounts, and on a deployed instance both fail closed without a session. Awaiting
// here costs one round trip on a local run — where it 404s immediately and
// returns `local` — and buys a picker that is never briefly broken on a deployed
// one. It never rejects: `ensureSession` turns every failure into an outcome, so
// a server that is down still gets the app rendered and its own error banners.
const outcome = await ensureSession()
if (outcome === 'unavailable') {
  console.warn('[voice] could not establish a session; API calls may fail until the server is reachable.')
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
