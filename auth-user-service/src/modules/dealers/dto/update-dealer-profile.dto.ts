import { PartialType, PickType } from '@nestjs/mapped-types';
import { CreateDealerProfileDto } from './create-dealer-profile.dto';

/** Dealer self-service updates only — not verification_status (admin internal API). */
export class UpdateDealerProfileDto extends PartialType(
  PickType(CreateDealerProfileDto, [
    'businessRegistrationNumber',
    'businessAddress',
    'city',
    'verificationDocuments',
    'companyName',
    'contactNumber',
  ] as const),
) {}
