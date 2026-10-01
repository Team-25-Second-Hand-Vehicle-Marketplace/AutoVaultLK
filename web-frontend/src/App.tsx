import { Routes, Route, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { MotionConfig } from 'motion/react'
import { SmoothScroll } from './components/layout/SmoothScroll'
import { PageTransition } from './components/layout/PageTransition'
import { sectionKey } from './components/layout/section-key'
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
import { VerifyEmailPage } from './pages/VerifyEmailPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { SavedPage } from './pages/SavedPage'
import { DealerLoginPage } from './pages/dealers/DealerLoginPage'
import { DealerRegisterPage } from './pages/dealers/DealerRegisterPage'
import { DealerLayout } from './pages/dealers/DealerLayout'
import { DealerDashboardPage } from './pages/dealers/DealerDashboardPage'
import { DealerListingsPage } from './pages/dealers/DealerListingsPage'
import { ManualListingPage } from './pages/dealers/ManualListingPage'
import { DealerProfilePage } from './pages/dealers/DealerProfilePage'
import { BulkUploadPage } from './pages/dealers/BulkUploadPage'
import { UploadStatusPage } from './pages/dealers/UploadStatusPage'
import { UploadHistoryPage } from './pages/dealers/UploadHistoryPage'
import { RequireDealerType } from './pages/dealers/RequireDealerType'
import { RequireVerifiedDealer } from './pages/dealers/RequireVerifiedDealer'
import { NotFoundPage } from './pages/NotFoundPage'
import { AdminLoginPage } from './pages/admin/AdminLoginPage'
import { AdminLayout } from './pages/admin/AdminLayout'
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage'
import { AdminUsersPage } from './pages/admin/AdminUsersPage'
import { AdminUploadsPage } from './pages/admin/AdminUploadsPage'
import { AdminReportsPage } from './pages/admin/AdminReportsPage'
import { AdminAuditLogsPage } from './pages/admin/AdminAuditLogsPage'
import { AdminDictionaryPage } from './pages/admin/AdminDictionaryPage'
import { AdminDashboardPreviewPage } from './pages/admin/AdminDashboardPreviewPage'

/**
 * Full-bleed layouts that carry their own chrome - marketplace header/footer
 * would fight these screens.
 */
const BARE_ROUTES = ['/dealer/login', '/dealer/register', '/admin/login']

function App() {
  const location = useLocation()
  const { pathname } = location
  const bare =
    BARE_ROUTES.includes(pathname) ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/dealer')

  return (
    <MotionConfig reducedMotion="user">
    <AuthProvider>
      <SmoothScroll />
      <div className="app-shell">
        {!bare && <Header />}
        <main className="app-shell__main">
          {/* Inside the router so a crash keeps the header and nav usable. */}
          <ErrorBoundary>
            <PageTransition id={sectionKey(pathname)}>
            {/* location is passed explicitly so the page that is animating out
                keeps rendering its own route instead of jumping to the next. */}
            <Routes location={location}>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/dealer/login" element={<DealerLoginPage />} />
              <Route path="/dealer/register" element={<DealerRegisterPage />} />
              <Route
                path="/dealer"
                element={
                  <RequireRole role="DEALER" loginTo="/dealer/login">
                    <DealerLayout />
                  </RequireRole>
                }
              >
                <Route index element={<DealerDashboardPage />} />
                <Route
                  path="listings"
                  element={
                    <RequireVerifiedDealer>
                      <DealerListingsPage />
                    </RequireVerifiedDealer>
                  }
                />
                <Route
                  path="listings/new"
                  element={
                    <RequireVerifiedDealer>
                      <ManualListingPage />
                    </RequireVerifiedDealer>
                  }
                />
                <Route path="profile" element={<DealerProfilePage />} />
                <Route
                  path="upload"
                  element={
                    <RequireVerifiedDealer>
                      <RequireDealerType type="business" fallbackTo="/dealer/listings">
                        <BulkUploadPage />
                      </RequireDealerType>
                    </RequireVerifiedDealer>
                  }
                />
                <Route
                  path="uploads/:jobId"
                  element={
                    <RequireVerifiedDealer>
                      <RequireDealerType type="business" fallbackTo="/dealer/listings">
                        <UploadStatusPage />
                      </RequireDealerType>
                    </RequireVerifiedDealer>
                  }
                />
                <Route
                  path="uploads"
                  element={
                    <RequireVerifiedDealer>
                      <RequireDealerType type="business" fallbackTo="/dealer/listings">
                        <UploadHistoryPage />
                      </RequireDealerType>
                    </RequireVerifiedDealer>
                  }
                />
              </Route>
              <Route
                path="/saved"
                element={
                  <RequireAuth>
                    <SavedPage />
                  </RequireAuth>
                }
              />
              <Route path="/admin/login" element={<AdminLoginPage />} />
              {/* Dev-only: renders the real dashboard against fixed mock
                  data, no login needed - a way to check a local dashboard
                  change in the browser before pushing it. Stripped out of
                  a production build by this env check; not linked from
                  anywhere in the app. Safe to delete once you're done. */}
              {import.meta.env.DEV && (
                <Route path="/admin/preview" element={<AdminLayout />}>
                  <Route index element={<AdminDashboardPreviewPage />} />
                </Route>
              )}
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
                <Route path="dictionary" element={<AdminDictionaryPage />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
            </PageTransition>
          </ErrorBoundary>
        </main>
        {!bare && <Footer />}
      </div>
      <Toaster position="top-right" richColors />
    </AuthProvider>
    </MotionConfig>
  )
}

export default App
