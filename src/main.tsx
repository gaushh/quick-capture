import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyAppearanceToDocument, getStoredAppearance } from './theme.ts'

applyAppearanceToDocument(getStoredAppearance())

// StrictMode intentionally removed: this is an Electron desktop app that uses IPC
// listeners and MediaRecorder. StrictMode's double-invoke of effects in dev mode
// causes the pill:summon listener to register twice, triggering auto-recording on
// launch, and can create a second phantom recording session.
createRoot(document.getElementById('root')!).render(<App />)
