export type UserRole = "BUYER" | "DEALER" | "ADMIN";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
};

export type TokenResponse = {
  accessToken: string;
  refreshToken?: string;
  user: AuthUser;
};

export type RegisterBuyerPayload = {
  name: string;
  email: string;
  password: string;
  deviceLabel?: string;
};

export type DealerType = "individual" | "business";

export type RegisterDealerPayload = {
  name: string;
  email: string;
  password: string;
  dealerType: DealerType;
  companyName: string;
  businessAddress: string;
  city: string;
  businessRegistrationNumber?: string;
  contactNumber?: string;
  verificationDocuments: Record<string, unknown>;
};

export type LoginPayload = {
  email: string;
  password: string;
  deviceLabel?: string;
};

export type ApiMessageResponse = {
  message?: string;
  emailVerificationRequired?: boolean;
  verificationToken?: string;
  verificationStatus?: string;
  user?: AuthUser;
};
