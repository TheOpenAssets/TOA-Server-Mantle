import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

/**
 * Validates that a value is a canonical 4-decimal amount string.
 *
 * Canonical format: decimal string with exactly 4 places after the decimal point.
 * Examples: "1.2345", "100.0000", "0.0001"
 *
 * Per canonical_price_representation.md:
 * - All monetary values (prices, amounts, payments, yields, fees) must use this format
 * - The backend canonical format is the universal representation across all modules
 * - Raw chain precision (wei, stroops) conversions happen ONLY at adapter boundaries
 */
export function IsCanonicalAmount(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isCanonicalAmount',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (typeof value !== 'string') {
            return false;
          }

          // Canonical format: decimal string with exactly 4 decimal places
          // Pattern: optional negative, integer part, dot, exactly 4 digits
          const canonicalPattern = /^-?\d+\.\d{4}$/;

          if (!canonicalPattern.test(value)) {
            return false;
          }

          // Additional check: ensure it's a valid number
          const numValue = parseFloat(value);
          if (isNaN(numValue)) {
            return false;
          }

          // Ensure no leading zeros in integer part (except "0.xxxx")
          const integerPart = value.split('.')[0];
          if (integerPart && integerPart.length > 1 && integerPart.startsWith('0') && integerPart !== '0') {
            return false;
          }

          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a canonical 4-decimal amount string (e.g. "100.0000", "1.2345")`;
        },
      },
    });
  };
}

/**
 * Validates that a value is a canonical 4-decimal amount string OR empty/null (for optional fields).
 */
export function IsOptionalCanonicalAmount(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isOptionalCanonicalAmount',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          // Allow null, undefined, or empty string for optional fields
          if (value === null || value === undefined || value === '') {
            return true;
          }

          if (typeof value !== 'string') {
            return false;
          }

          // Same validation as IsCanonicalAmount
          const canonicalPattern = /^-?\d+\.\d{4}$/;

          if (!canonicalPattern.test(value)) {
            return false;
          }

          const numValue = parseFloat(value);
          if (isNaN(numValue)) {
            return false;
          }

          const integerPart = value.split('.')[0];
          if (integerPart && integerPart.length > 1 && integerPart.startsWith('0') && integerPart !== '0') {
            return false;
          }

          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a canonical 4-decimal amount string (e.g. "100.0000", "1.2345") or empty for optional fields`;
        },
      },
    });
  };
}

/**
 * Validates that a value is a percentage in canonical format (0.0000 to 100.0000).
 */
export function IsCanonicalPercentage(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isCanonicalPercentage',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (typeof value !== 'string') {
            return false;
          }

          // Must be canonical format
          const canonicalPattern = /^-?\d+\.\d{4}$/;
          if (!canonicalPattern.test(value)) {
            return false;
          }

          const numValue = parseFloat(value);
          if (isNaN(numValue)) {
            return false;
          }

          // Must be between 0 and 100
          if (numValue < 0 || numValue > 100) {
            return false;
          }

          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a canonical percentage between 0.0000 and 100.0000`;
        },
      },
    });
  };
}
