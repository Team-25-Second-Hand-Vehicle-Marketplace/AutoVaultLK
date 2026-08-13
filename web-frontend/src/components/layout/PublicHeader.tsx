import { Link, NavLink } from "react-router-dom";
import { Logo } from "@/components/brand/Logo";
import { useAuth } from "@/context/AuthContext";
import { dashboardPath } from "@/lib/roles";

export function PublicHeader() {
  const { user } = useAuth();

  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo inverted />
        <nav className="flex items-center gap-2 text-sm">
          <NavLink
            to="/auth/login"
            className="hidden rounded-full px-4 py-2 text-white/80 no-underline hover:text-white sm:inline"
          >
            Sign in
          </NavLink>
          {user ? (
            <Link
              to={dashboardPath(user.role)}
              className="rounded-full bg-teal px-4 py-2 font-semibold text-white no-underline hover:bg-teal-bright"
            >
              Go to dashboard
            </Link>
          ) : (
            <Link
              to="/auth/register/buyer"
              className="rounded-full bg-teal px-4 py-2 font-semibold text-white no-underline hover:bg-teal-bright"
            >
              Get started
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
