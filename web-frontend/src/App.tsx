import { Routes, Route, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { Header } from './components/layout/Header'
import { Footer } from './components/layout/Footer'
import { ErrorBoundary } from './components/layout/ErrorBoundary'
import { HomePage } from './pages/HomePage'
import { SearchPage } from './pages/SearchPage'
import { VehicleDetailPage } from './pages/VehicleDetailPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { SavedPage } from './pages/SavedPage'
import { DealerLoginPage } from './pages/DealerLoginPage'
import { DealerRegisterPage } from './pages/DealerRegisterPage'
import { NotFoundPage } from './pages/NotFoundPage'

/**
 * The dealer screens are full-bleed layouts in the design — a split-screen
 * sign-in and a centred wizard, both carrying their own branding. Wrapping
 * them in the marketplace header and footer would fight that, so the shell
 * is suppressed on those routes.
 */
const BARE_ROUTES = ['/dealer/login', '/dealer/register']

function App() {
  const { pathname } = useLocation()
  const bare = BARE_ROUTES.includes(pathname)

  return (
    <AuthProvider>
      <div className="app-shell">
        {!bare && <Header />}
        <main className="app-shell__main">
          {/* Inside the router so a crash keeps the header and nav usable. */}
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/dealer/login" element={<DealerLoginPage />} />
              <Route path="/dealer/register" element={<DealerRegisterPage />} />
              <Route
                path="/saved"
                element={
                  <RequireAuth>
                    <SavedPage />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </ErrorBoundary>
        </main>
        {!bare && <Footer />}
      </div>
      <Toaster position="top-right" richColors />
    </AuthProvider>
  )
}

export default App
