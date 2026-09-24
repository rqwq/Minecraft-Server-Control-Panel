import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppProvider } from './state/AppState'
import './styles/base.css'
import './styles/layout.css'
import './styles/worlds.css'
import './styles/console.css'
import './styles/settings.css'
import './styles/servers.css'
import './styles/files.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
)
