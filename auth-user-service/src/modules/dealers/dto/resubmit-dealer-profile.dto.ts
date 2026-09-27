import { IsObject } from 'class-validator';
import { IntersectionType, PartialType, PickType } from '@nestjs/mapped-types';
import { CreateDealerProfileDto } from './create-dealer-profile.dto';

/** The same self-service fields UpdateDealerProfileDto allows, still optional here. */
class ResubmitDealerProfileOptionalFieldsDto extends PartialType(
  PickType(CreateDealerProfileDto, [
    'businessRegistrationNumber',
    'businessAddress',
    'city',
    'companyName',
    'contactNumber',
  ] as const),
) {}

/**
 * The one field ResubmitDealerProfileDto requires that
 * UpdateDealerProfileDto doesn't — split into its own named class because a
 * decorated property needs a real class declaration, not an inline class
 * expression, for `@IsObject` to attach correctly.
 */
class RequiredVerificationDocumentsDto {
  @IsObject()
  verificationDocuments!: Record<string, unknown>;
}

/**
 * A rejected dealer fixing their details and trying again. Only
 * shape-checked here (`@IsObject`); the dealerType-aware check (NIC vs
 * business cert) runs in DealerProfilesService.resubmit() against the
 * profile's actual stored dealerType, not a DTO field — see
 * verificationDocumentsError's doc comment for why.
 */
export class ResubmitDealerProfileDto extends IntersectionType(
  ResubmitDealerProfileOptionalFieldsDto,
  RequiredVerificationDocumentsDto,
) {}
