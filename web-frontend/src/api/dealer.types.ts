export type DealerType = 'individual' | 'business';
export type DealerVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface DealerProfile {
  userId: string;
  dealerType: DealerType;
  companyName: string;
  businessRegistrationNumber: string;
  businessAddress: string;
  city: string;
  contactNumber: string | null;
  verificationStatus: DealerVerificationStatus;
  rejectionReason: string | null;
  createdAt: string;
}

/**
 * PATCH /dealer-profiles/:userId — a dealer's own self-service edits.
 * Mirrors auth-user-service's UpdateDealerProfileDto: dealerType and
 * verificationStatus are not editable here (type is fixed at registration;
 * status changes only through admin approve/reject). All fields optional —
 * every field the caller omits is left untouched, not cleared.
 */
export interface UpdateDealerProfileInput {
  companyName?: string;
  businessRegistrationNumber?: string;
  businessAddress?: string;
  city?: string;
  contactNumber?: string;
}
