/**
 * Backend canonical format for all prices and amounts is a decimal string 
 * with exactly 4 places after the decimal point.
 * e.g. "1.2345", "100.0000", "0.0000"
 */
export type CanonicalAmount = string;

/**
 * Interface for numeric values that might lose precision when converted to 4-decimal canonical format.
 */
export interface PreciseNumeric {
  /**
   * The 4-decimal rounded canonical value used for most calculations and sorting.
   */
  value: CanonicalAmount;

  /**
   * Flag indicating that precision was lost during conversion to 4-decimal format.
   */
  rawPrecise?: boolean;

  /**
   * The full exact value from the chain in plain decimal notation.
   */
  rawPrice?: string;
}
