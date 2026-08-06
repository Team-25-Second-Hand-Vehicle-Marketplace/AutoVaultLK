import { DealerType } from '../../../infrastructure/database/entities/dealer-profile.entity';

export class CreateDealerProfileDto {
  userId!: string;
  dealerType!: DealerType;
  businessRegistrationNumber!: string;
  businessAddress!: string;
  city!: string;
  verificationDocuments!: Record<string, unknown>;
  companyName!: string;
  contactNumber!: string;
}
