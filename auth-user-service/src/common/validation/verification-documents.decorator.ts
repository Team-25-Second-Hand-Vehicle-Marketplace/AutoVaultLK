import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { DealerType } from '../../infrastructure/database/entities/dealer-profile.entity';
import { NIC_MESSAGE, NIC_REGEX } from './validation.constants';

/** Keys inside `verificationDocuments` this validator looks for. */
export const NIC_DOCUMENT_KEY = 'nic';
export const BUSINESS_REGISTRATION_DOCUMENT_KEY = 'businessRegistrationCertificate';

function describeError(dealerType: unknown, value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'verificationDocuments must be an object';
  }
  const documents = value as Record<string, unknown>;

  if (dealerType === DealerType.INDIVIDUAL) {
    const nic = documents[NIC_DOCUMENT_KEY];
    if (typeof nic !== 'string' || !NIC_REGEX.test(nic)) {
      return `verificationDocuments.${NIC_DOCUMENT_KEY}: ${NIC_MESSAGE}`;
    }
    return null;
  }

  if (dealerType === DealerType.BUSINESS) {
    const cert = documents[BUSINESS_REGISTRATION_DOCUMENT_KEY];
    if (typeof cert !== 'string' || cert.trim().length === 0) {
      return `verificationDocuments.${BUSINESS_REGISTRATION_DOCUMENT_KEY} is required for business dealers`;
    }
    return null;
  }

  // dealerType is missing/invalid on this DTO (e.g. a partial profile update,
  // which doesn't resend dealerType). @IsEnum on dealerType reports that on
  // its own where dealerType is actually present on the class; there is
  // nothing for this validator to check against here.
  return null;
}

@ValidatorConstraint({ name: 'verificationDocumentsForDealerType', async: false })
class VerificationDocumentsForDealerTypeConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown, args: ValidationArguments): boolean {
    const dealerType = (args.object as { dealerType?: DealerType }).dealerType;
    return describeError(dealerType, value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    const dealerType = (args.object as { dealerType?: DealerType }).dealerType;
    return describeError(dealerType, args.value) ?? 'verificationDocuments is invalid';
  }
}

/**
 * Cross-checks `verificationDocuments` against the sibling `dealerType`
 * field: an individual dealer must submit a valid NIC (`nic`), a business
 * dealer must submit a business registration document
 * (`businessRegistrationCertificate`). A no-op when `dealerType` isn't
 * present on the DTO being validated (e.g. profile-update DTOs, which don't
 * resend dealerType since it's immutable after registration).
 */
export function IsVerificationDocumentsForDealerType(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      validator: VerificationDocumentsForDealerTypeConstraint,
    });
  };
}
