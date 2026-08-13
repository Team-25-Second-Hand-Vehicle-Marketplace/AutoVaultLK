import { api } from "@/lib/api";
import type {
  ApiMessageResponse,
  LoginPayload,
  RegisterBuyerPayload,
  RegisterDealerPayload,
  TokenResponse,
} from "@/types/auth";

export const authApi = {
  registerBuyer(payload: RegisterBuyerPayload) {
    return api.post<ApiMessageResponse>("/auth/register/buyer", payload);
  },

  registerDealer(payload: RegisterDealerPayload) {
    return api.post<ApiMessageResponse>("/auth/register/dealer", payload);
  },

  login(payload: LoginPayload) {
    return api.post<TokenResponse>("/auth/login", payload);
  },

  loginAdmin(payload: LoginPayload) {
    return api.post<TokenResponse>("/auth/login/admin", payload);
  },

  refresh() {
    return api.post<TokenResponse>("/auth/refresh", {});
  },

  logout() {
    return api.post("/auth/logout", {});
  },

  verifyEmail(token: string) {
    return api.post<ApiMessageResponse>("/auth/email/verify", { token });
  },

  resendVerification(email: string) {
    return api.post<ApiMessageResponse>("/auth/email/resend-verification", {
      email,
    });
  },

  requestPasswordReset(email: string) {
    return api.post<ApiMessageResponse>("/auth/password-reset/request", {
      email,
    });
  },

  confirmPasswordReset(token: string, newPassword: string) {
    return api.post<ApiMessageResponse>("/auth/password-reset/confirm", {
      token,
      newPassword,
    });
  },
};
