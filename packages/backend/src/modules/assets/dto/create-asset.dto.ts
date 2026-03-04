import { IsString, IsNotEmpty, IsNumberString, IsDateString, IsEnum, IsOptional, ValidateIf } from 'class-validator';
import { IsCanonicalAmount, IsOptionalCanonicalAmount, IsCanonicalPercentage } from '../../../utils/validators/canonical-amount.validator';

export enum AssetType {
  STATIC = 'STATIC',
  AUCTION = 'AUCTION',
}

export class CreateAssetDto {
  @IsString()
  @IsNotEmpty()
  invoiceNumber!: string;

  @IsCanonicalAmount()
  @IsNotEmpty()
  faceValue!: string; // Canonical 4-decimal format, e.g., "100.0000" for 100 USDC

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsDateString()
  @IsNotEmpty()
  issueDate!: string;

  @IsDateString()
  @IsNotEmpty()
  dueDate!: string;

  @IsString()
  @IsNotEmpty()
  buyerName!: string;

  @IsString()
  @IsNotEmpty()
  industry!: string;

  @IsString()
  @IsNotEmpty()
  riskTier!: string;

  // Listing Type
  @IsEnum(AssetType)
  @IsNotEmpty()
  assetType!: AssetType;

  // Token Params - All in canonical 4-decimal format
  @IsCanonicalAmount()
  @IsNotEmpty()
  totalSupply!: string; // Canonical 4-decimal format, e.g., "1000.0000" for 1000 tokens

  @IsCanonicalAmount()
  @IsNotEmpty()
  minInvestment!: string; // Canonical 4-decimal format, e.g., "10.0000" for 10 tokens

  // Required for both types - minimum raise as percentage of face value
  // Example: "80.0000" means 80% of face value must be raised
  @IsCanonicalPercentage()
  @IsNotEmpty()
  minRaisePercentage!: string; // Minimum % of face value in canonical format (0.0000-100.0000)

  // Optional: Maximum raise percentage (defaults to 95% = face value - platform fee - yield margin)
  // Platform fee is 1.5%, and we want to leave at least 5% margin for investor yield
  @IsCanonicalPercentage()
  @IsOptional()
  maxRaisePercentage?: string; // Maximum % of face value in canonical format (default: "95.0000")

  // For STATIC ONLY: Optional price per token (if not provided, uses maxRaise / totalSupply)
  // If provided, must be between minPrice and maxPrice calculated from raise percentages
  @IsOptionalCanonicalAmount()
  @ValidateIf(o => o.assetType === AssetType.STATIC && o.pricePerToken)
  pricePerToken?: string; // Canonical 4-decimal format, e.g., "0.8500" for 0.85 USDC per token

  // Auction-specific params (required only if assetType is AUCTION)
  @IsNumberString()
  @ValidateIf(o => o.assetType === AssetType.AUCTION)
  @IsNotEmpty()
  auctionDuration!: string; // Duration in seconds (not a monetary value, keep as-is)
}