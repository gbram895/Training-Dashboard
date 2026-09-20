import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/coustard/900.css'
import './index.css'
import App from './App.tsx'
import { applyTheme, getStoredTheme } from './lib/theme.ts'

// Keeps the theme-color meta tag (browser/PWA chrome tint) in sync if the OS
// theme flips while the app is open and the user hasn't overridden it —
// data-theme itself is untouched here since the CSS media query already
// reacts to this on its own.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getStoredTheme() === 'system') applyTheme('system')
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
