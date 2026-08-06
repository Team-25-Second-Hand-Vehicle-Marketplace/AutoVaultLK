import {
  DealerType,
  VerificationStatus,
} from '../../../infrastructure/database/entities/dealer-profile.entity';

export class UpdateDealerProfileDto {
  dealerType?: DealerType;
  businessRegistrationNumber?: string;
  businessAddress?: string;
  city?: string;
  verificationDocuments?: Record<string, unknown>;
  companyName?: string;
  contactNumber?: string;
  verificationStatus?: VerificationStatus;
}
