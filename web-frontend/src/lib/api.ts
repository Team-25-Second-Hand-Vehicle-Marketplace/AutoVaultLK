import axios, { type AxiosError } from "axios";
import { clearSession, getCsrfToken, getStoredAccessToken } from "@/lib/session";

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "";

export const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: {
    "X-Device-Label": "web-frontend",
  },
});

api.interceptors.request.use((config) => {
  const token = getStoredAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const path = `${config.baseURL ?? ""}${config.url ?? ""}`;
  const needsCsrf =
    /\/auth\/(refresh|logout|logout\/all|password\/change)/.test(path);
  const csrf = getCsrfToken();
  if (needsCsrf && csrf) {
    config.headers["X-CSRF-Token"] = csrf;
  }

  return config;
});

export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: string | string[] }
      | undefined;
    if (typeof data?.message === "string" && data.message.trim()) {
      return data.message;
    }
    if (Array.isArray(data?.message) && data.message.length > 0) {
      return data.message.join(", ");
    }
    if (error.response?.status === 401) {
      return "Invalid email or password";
    }
    if (error.response?.status === 429) {
      return "Too many attempts. Please try again later.";
    }
  }
  return "Something went wrong. Please try again.";
}

export function isAxiosError(error: unknown): error is AxiosError {
  return axios.isAxiosError(error);
}

export function resetClientSession() {
  clearSession();
}
