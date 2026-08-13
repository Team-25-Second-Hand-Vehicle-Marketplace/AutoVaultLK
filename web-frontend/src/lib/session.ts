import type { AuthUser } from "@/types/auth";

const ACCESS_TOKEN_KEY = "autovault.accessToken";
const USER_KEY = "autovault.user";
const CSRF_KEY = "autovault.csrfToken";

export function readCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function captureCsrfCookie() {
  const csrf = readCookie("csrf_token");
  if (csrf) {
    sessionStorage.setItem(CSRF_KEY, csrf);
  }
  return csrf ?? sessionStorage.getItem(CSRF_KEY);
}

export function getCsrfToken() {
  return sessionStorage.getItem(CSRF_KEY) ?? readCookie("csrf_token");
}

export function getStoredAccessToken() {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function persistSession(accessToken: string, user: AuthUser) {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  captureCsrfCookie();
}

export function clearSession() {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(CSRF_KEY);
}
