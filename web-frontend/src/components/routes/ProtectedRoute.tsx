import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { dashboardPath } from "@/lib/roles";
import type { UserRole } from "@/types/auth";

export function ProtectedRoute({
  role,
  children,
}: {
  role: UserRole;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    const loginTo = role === "ADMIN" ? "/auth/login/admin" : "/auth/login";
    return <Navigate to={loginTo} replace state={{ from: location.pathname }} />;
  }

  if (user.role !== role) {
    return <Navigate to={dashboardPath(user.role)} replace />;
  }

  return children;
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user) {
    return <Navigate to={dashboardPath(user.role)} replace />;
  }
  return children;
}
