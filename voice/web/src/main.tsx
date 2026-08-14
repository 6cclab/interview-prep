import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// The demo build has no server behind it. Installed before the first render so
// no screen can get a real request out, and behind a build-time flag rather
// than a runtime one — a demo that could be switched on against the live
// instance would be the client-side gate this whole build exists to avoid.
if (import.meta.env.VITE_DEMO === '1') {
  const { installDemoApi } = await import('./demo/install')
  installDemoApi()
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('missing #root element')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
