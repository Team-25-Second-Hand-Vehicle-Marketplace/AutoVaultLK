import { Matches, MaxLength, MinLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_STRENGTH_MESSAGE,
  PASSWORD_STRENGTH_REGEX,
} from './validation.constants';

/** FR-06 password policy for registration and password change DTOs. */
export function IsStrongPassword() {
  return function (target: object, propertyKey: string) {
    MinLength(PASSWORD_MIN_LENGTH, {
      message: `password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    })(target, propertyKey);
    MaxLength(PASSWORD_MAX_LENGTH, {
      message: `password must be at most ${PASSWORD_MAX_LENGTH} characters`,
    })(target, propertyKey);
    Matches(PASSWORD_STRENGTH_REGEX, {
      message: PASSWORD_STRENGTH_MESSAGE,
    })(target, propertyKey);
  };
}
