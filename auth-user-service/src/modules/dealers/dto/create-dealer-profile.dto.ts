import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  COMPANY_NAME_MAX,
  COMPANY_NAME_MIN,
  PHONE_MESSAGE,
  PHONE_REGEX,
} from '../../../common/validation/validation.constants';
import { DealerType } from '../../../infrastructure/database/entities/dealer-profile.entity';

export class CreateDealerProfileDto {
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId!: string;

  @IsEnum(DealerType, {
    message: 'dealerType must be individual or business',
  })
  dealerType!: DealerType;

  @ValidateIf((dto: CreateDealerProfileDto) => dto.dealerType === DealerType.BUSINESS)
  @IsString()
  @MinLength(1, { message: 'businessRegistrationNumber is required for business dealers' })
  @MaxLength(500)
  businessRegistrationNumber?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  businessAddress!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city!: string;

  @IsObject()
  verificationDocuments!: Record<string, unknown>;

  @IsString()
  @MinLength(COMPANY_NAME_MIN)
  @MaxLength(COMPANY_NAME_MAX)
  companyName!: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  contactNumber?: string;
}
