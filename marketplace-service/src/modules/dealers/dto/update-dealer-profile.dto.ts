import {
  IsEnum,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
} from 'class-validator';

import { DealerType } from '../../../infrastructure/database/entities/dealer-profile.view-entity';

export class UpdateDealerProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  companyName?: string;

  @IsOptional()
  @IsPhoneNumber()
  contactNumber?: string;

  @IsOptional()
  @IsEnum(DealerType)
  dealerType?: DealerType;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  businessRegistrationNumber?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  businessAddress?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  city?: string;
}
