import type { UserRole } from "@/types/auth";

export function dashboardPath(role: UserRole) {
  if (role === "ADMIN") return "/admin";
  if (role === "DEALER") return "/dealer";
  return "/buyer";
}

export function roleLabel(role: UserRole) {
  if (role === "ADMIN") return "Administrator";
  if (role === "DEALER") return "Dealer";
  return "Buyer";
}
