import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './styles/app.css'
// Loaded last so the reference design's tokens and chrome win over the
// earlier stylesheets. theme.css must precede home.css — the latter uses
// the tokens the former defines.
import './styles/theme.css'
import './styles/home.css'
import './styles/search-skin.css'
import './styles/admin.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
