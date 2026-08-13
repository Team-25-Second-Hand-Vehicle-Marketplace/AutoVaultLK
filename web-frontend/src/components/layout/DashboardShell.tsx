import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { roleLabel } from "@/lib/roles";

type DashboardShellProps = {
  title: string;
  children: ReactNode;
};

export function DashboardShell({ title, children }: DashboardShellProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  return (
    <div className="min-h-svh bg-canvas">
      <header className="border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Logo />
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-navy">{user?.name}</p>
              <p className="text-xs text-muted">
                {user ? roleLabel(user.role) : ""} · {user?.email}
              </p>
            </div>
            <Button variant="ghost" onClick={() => void handleLogout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal">
              {user ? roleLabel(user.role) : "Account"}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy">
              {title}
            </h1>
          </div>
          <Link
            to="/"
            className="text-sm text-muted no-underline hover:text-navy"
          >
            View marketplace
          </Link>
        </div>
        {children}
      </main>
    </div>
  );
}
