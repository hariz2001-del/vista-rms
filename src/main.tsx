import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { IS_DEMO } from './lib/mode.ts'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Cannot start Vista RMS: #root is missing from index.html')
}

async function start(root: HTMLElement) {
  if (IS_DEMO) {
    // The visitor's own demo, if they have one in the current 3-hour window.
    const [{ loadDemoState, scheduleDemoReset }, { restoreDemoState }] = await Promise.all([
      import('./data/demo-session.ts'),
      import('./data/store.ts'),
    ])
    restoreDemoState(await loadDemoState())
    scheduleDemoReset()
  }
  const { default: App } = await import('./App.tsx')
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start(rootElement)
