import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { NormalizeEmail } from '../../../common/validation/normalize-email.decorator';
import { IsStrongPassword } from '../../../common/validation/password.decorator';
import {
  COMPANY_NAME_MAX,
  COMPANY_NAME_MIN,
  PERSON_NAME_MAX,
  PERSON_NAME_MIN,
  PHONE_MESSAGE,
  PHONE_REGEX,
} from '../../../common/validation/validation.constants';
import { DealerType } from '../../../infrastructure/database/entities/dealer-profile.entity';

export class RegisterDealerDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsString()
  @IsNotEmpty({ message: 'email must not be empty' })
  email!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;

  @IsString()
  @MinLength(PERSON_NAME_MIN, {
    message: `name must be at least ${PERSON_NAME_MIN} characters`,
  })
  @MaxLength(PERSON_NAME_MAX, {
    message: `name must be at most ${PERSON_NAME_MAX} characters`,
  })
  name!: string;

  @IsEnum(DealerType, {
    message: 'dealerType must be individual or business',
  })
  dealerType!: DealerType;

  @ValidateIf((dto: RegisterDealerDto) => dto.dealerType === DealerType.BUSINESS)
  @IsString()
  @IsNotEmpty({ message: 'businessRegistrationNumber is required for business dealers' })
  @MaxLength(500)
  businessRegistrationNumber?: string;

  @IsString()
  @MinLength(5, { message: 'businessAddress must be at least 5 characters' })
  @MaxLength(500)
  businessAddress!: string;

  @IsString()
  @MinLength(2, { message: 'city must be at least 2 characters' })
  @MaxLength(100)
  city!: string;

  @IsObject({ message: 'verificationDocuments must be an object' })
  verificationDocuments!: Record<string, unknown>;

  @IsString()
  @MinLength(COMPANY_NAME_MIN, {
    message: `companyName must be at least ${COMPANY_NAME_MIN} characters`,
  })
  @MaxLength(COMPANY_NAME_MAX)
  companyName!: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  contactNumber?: string;
}
