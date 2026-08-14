import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';

export type ValidationFieldError = {
  field: string;
  message: string;
};

function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): ValidationFieldError[] {
  const details: ValidationFieldError[] = [];

  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;

    if (error.constraints) {
      for (const message of Object.values(error.constraints)) {
        details.push({ field, message });
      }
    }

    if (error.children?.length) {
      details.push(...flattenValidationErrors(error.children, field));
    }
  }

  return details;
}

export function validationExceptionFactory(errors: ValidationError[]) {
  const details = flattenValidationErrors(errors);

  return new BadRequestException({
    statusCode: 400,
    error: 'Validation failed',
    message:
      details.length === 1
        ? details[0].message
        : 'One or more fields failed validation',
    details,
  });
}

export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: validationExceptionFactory,
  });
}
