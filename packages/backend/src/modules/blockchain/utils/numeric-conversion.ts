import { formatUnits, parseUnits } from 'viem';
import { PreciseNumeric } from '@openassets/types';

/**
 * Converts a chain-native integer (as string or bigint) to the canonical 4-decimal format.
 * Detects precision loss and returns a PreciseNumeric object.
 * 
 * @param raw The raw integer value from the blockchain (wei, stroops, etc.)
 * @param decimals The number of decimals for this token/unit on the chain
 * @returns A PreciseNumeric object with the 4-decimal canonical value
 */
export function toCanonical(raw: string | bigint, decimals: number): PreciseNumeric {
  const rawBigInt = typeof raw === 'string' ? BigInt(raw) : raw;
  
  // Convert to full-precision decimal string using viem's formatUnits
  // This handles the division by 10^decimals correctly
  const fullPrecision = formatUnits(rawBigInt, decimals);
  
  // Parse the full precision string to handle rounding and precision loss detection
  const [integerPart, fractionalPart = ''] = fullPrecision.split('.');
  
  // Canonical value has exactly 4 decimal places
  // We use truncation/rounding to 4 places. 
  // The spec says "exactly 4 places after the decimal point".
  const canonicalFraction = fractionalPart.padEnd(4, '0').substring(0, 4);
  const canonicalValue = `${integerPart || '0'}.${canonicalFraction}`;
  
  // Detect precision loss: if there are more than 4 decimals AND they are not all zeros
  const lostPrecision = fractionalPart.length > 4 && fractionalPart.substring(4).replace(/0+$/, '').length > 0;
  
  if (lostPrecision) {
    return {
      value: canonicalValue,
      rawPrecise: true,
      rawPrice: fullPrecision,
    };
  }
  
  return {
    value: canonicalValue,
  };
}

/**
 * Converts a canonical string (or any decimal string) back to a chain-native integer.
 * 
 * @param decimalString The decimal string to convert (e.g. "1.2345")
 * @param decimals The number of decimals for this token/unit on the chain
 * @returns A bigint representing the raw integer value (wei, stroops, etc.)
 */
export function fromCanonical(decimalString: string, decimals: number): bigint {
  // We must handle cases where the input might have more decimals than the target
  // parseUnits will throw if there are more fractional digits than decimals
  const [integerPart, fractionalPart = ''] = decimalString.split('.');
  const safeFractionalPart = fractionalPart.substring(0, decimals);
  const safeDecimalString = fractionalPart.length > decimals 
    ? `${integerPart}.${safeFractionalPart}`
    : decimalString;

  return parseUnits(safeDecimalString, decimals);
}
