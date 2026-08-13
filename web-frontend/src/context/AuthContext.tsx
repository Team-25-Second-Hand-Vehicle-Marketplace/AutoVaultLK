import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { jwtDecode } from "jwt-decode";
import { authApi } from "@/lib/auth-api";
import {
  clearSession,
  getStoredAccessToken,
  getStoredUser,
  persistSession,
} from "@/lib/session";
import type { AuthUser, LoginPayload, UserRole } from "@/types/auth";

type JwtPayload = {
  sub: string;
  email?: string;
  role: UserRole;
  exp?: number;
};

type AuthContextValue = {
  user: AuthUser | null;
  accessToken: string | null;
  isReady: boolean;
  login: (payload: LoginPayload) => Promise<AuthUser>;
  loginAdmin: (payload: LoginPayload) => Promise<AuthUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function userFromToken(accessToken: string, fallback?: AuthUser): AuthUser {
  const payload = jwtDecode<JwtPayload>(accessToken);
  return {
    id: payload.sub,
    email: fallback?.email ?? payload.email ?? "",
    name: fallback?.name ?? payload.email ?? "Account",
    role: payload.role,
    isActive: fallback?.isActive ?? true,
  };
}

function isExpired(accessToken: string) {
  try {
    const payload = jwtDecode<JwtPayload>(accessToken);
    if (!payload.exp) return false;
    return payload.exp * 1000 <= Date.now() + 5_000;
  } catch {
    return true;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialToken = getStoredAccessToken();
  const initialUser = getStoredUser();
  const [accessToken, setAccessToken] = useState<string | null>(
    initialToken && !isExpired(initialToken) ? initialToken : null,
  );
  const [user, setUser] = useState<AuthUser | null>(
    accessToken ? initialUser : null,
  );
  const [isReady] = useState(true);

  const applySession = useCallback((token: string, nextUser?: AuthUser) => {
    const resolved = userFromToken(token, nextUser);
    persistSession(token, resolved);
    setAccessToken(token);
    setUser(resolved);
    return resolved;
  }, []);

  const login = useCallback(
    async (payload: LoginPayload) => {
      const { data } = await authApi.login(payload);
      return applySession(data.accessToken, data.user);
    },
    [applySession],
  );

  const loginAdmin = useCallback(
    async (payload: LoginPayload) => {
      const { data } = await authApi.loginAdmin(payload);
      return applySession(data.accessToken, data.user);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Cookie/session may already be gone.
    } finally {
      clearSession();
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, accessToken, isReady, login, loginAdmin, logout }),
    [user, accessToken, isReady, login, loginAdmin, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- paired context hook
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
