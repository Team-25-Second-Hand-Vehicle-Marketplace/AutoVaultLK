import { DealerType } from '../../../infrastructure/database/entities/dealer-profile.entity';

export class RegisterDealerDto {
  email!: string;
  password!: string;
  name!: string;
  dealerType!: DealerType;
  businessRegistrationNumber!: string;
  businessAddress!: string;
  city!: string;
  verificationDocuments!: Record<string, unknown>;
  companyName!: string;
  contactNumber!: string;
}
