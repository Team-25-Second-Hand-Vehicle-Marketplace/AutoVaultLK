import { Routes, Route, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { RequireRole } from './auth/RequireRole'
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
import { AdminLoginPage } from './pages/admin/AdminLoginPage'
import { AdminLayout } from './pages/admin/AdminLayout'
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage'
import { AdminUsersPage } from './pages/admin/AdminUsersPage'
import { AdminUploadsPage } from './pages/admin/AdminUploadsPage'
import { AdminReportsPage } from './pages/admin/AdminReportsPage'
import { AdminAuditLogsPage } from './pages/admin/AdminAuditLogsPage'

/**
 * Full-bleed layouts that carry their own chrome — marketplace header/footer
 * would fight these screens.
 */
const BARE_ROUTES = ['/dealer/login', '/dealer/register', '/admin/login']

function App() {
  const { pathname } = useLocation()
  const bare = BARE_ROUTES.includes(pathname) || pathname.startsWith('/admin')

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
              <Route path="/admin/login" element={<AdminLoginPage />} />
              <Route
                path="/admin"
                element={
                  <RequireRole role="ADMIN" loginTo="/admin/login">
                    <AdminLayout />
                  </RequireRole>
                }
              >
                <Route index element={<AdminDashboardPage />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="uploads" element={<AdminUploadsPage />} />
                <Route path="reports" element={<AdminReportsPage />} />
                <Route path="audit-logs" element={<AdminAuditLogsPage />} />
              </Route>
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
