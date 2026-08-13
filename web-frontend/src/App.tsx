import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import { GuestOnly, ProtectedRoute } from "@/components/routes/ProtectedRoute";
import { LandingPage } from "@/pages/landing/LandingPage";
import { LoginPage } from "@/pages/auth/LoginPage";
import { AdminLoginPage } from "@/pages/auth/AdminLoginPage";
import { RegisterBuyerPage } from "@/pages/auth/RegisterBuyerPage";
import { RegisterDealerPage } from "@/pages/auth/RegisterDealerPage";
import { VerifyEmailPage } from "@/pages/auth/VerifyEmailPage";
import { ForgotPasswordPage } from "@/pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "@/pages/auth/ResetPasswordPage";
import { BuyerDashboard } from "@/pages/dashboards/BuyerDashboard";
import { DealerDashboard } from "@/pages/dashboards/DealerDashboard";
import { AdminDashboard } from "@/pages/dashboards/AdminDashboard";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-center" richColors />
        <Routes>
          <Route path="/" element={<LandingPage />} />

          <Route
            path="/auth/login"
            element={
              <GuestOnly>
                <LoginPage />
              </GuestOnly>
            }
          />
          <Route
            path="/auth/login/admin"
            element={
              <GuestOnly>
                <AdminLoginPage />
              </GuestOnly>
            }
          />
          <Route
            path="/auth/register"
            element={<Navigate to="/auth/register/buyer" replace />}
          />
          <Route
            path="/auth/register/buyer"
            element={
              <GuestOnly>
                <RegisterBuyerPage />
              </GuestOnly>
            }
          />
          <Route
            path="/auth/register/dealer"
            element={
              <GuestOnly>
                <RegisterDealerPage />
              </GuestOnly>
            }
          />
          <Route path="/auth/verify-email" element={<VerifyEmailPage />} />
          <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/reset-password" element={<ResetPasswordPage />} />

          <Route
            path="/buyer"
            element={
              <ProtectedRoute role="BUYER">
                <BuyerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dealer"
            element={
              <ProtectedRoute role="DEALER">
                <DealerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute role="ADMIN">
                <AdminDashboard />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
