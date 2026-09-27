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
