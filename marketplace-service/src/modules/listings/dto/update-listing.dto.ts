import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateListingDto } from './create-listing.dto';

export class UpdateListingDto extends PartialType(
  OmitType(CreateListingDto, ['status'] as const),
) {}