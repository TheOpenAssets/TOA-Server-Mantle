import { IsString, IsNotEmpty, IsNumberString, IsDateString, IsEnum, IsOptional, ValidateIf } from 'class-validator';

export enum AssetType {
  STATIC = 'STATIC',
  AUCTION = 'AUCTION',
}

export class CreateAssetDto {
  @IsString()
  @IsNotEmpty()
  invoiceNumber!: string;

  @IsNumberString()
  @IsNotEmpty()
  faceValue!: string;

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

  // Token Params
  @IsNumberString()
  @IsNotEmpty()
  totalSupply!: string;

  @IsNumberString()
  @IsNotEmpty()
  minInvestment!: string;

  // Required for both types - minimum raise as percentage of face value
  // Example: "80" means 80% of face value must be raised
  @IsNumberString()
  @IsNotEmpty()
  minRaisePercentage!: string; // Minimum % of face value that must be raised

  // Optional: Maximum raise percentage (defaults to 95% = face value - platform fee - yield margin)
  // Platform fee is 1.5%, and we want to leave at least 5% margin for investor yield
  @IsNumberString()
  @IsOptional()
  maxRaisePercentage?: string; // Maximum % of face value (default: 95%)

  // For STATIC ONLY: Optional price per token (if not provided, uses maxRaise / totalSupply)
  // If provided, must be between minPrice and maxPrice calculated from raise percentages
  @IsNumberString()
  @IsOptional()
  @ValidateIf(o => o.assetType === AssetType.STATIC && o.pricePerToken)
  pricePerToken?: string;

  // Auction-specific params (required only if assetType is AUCTION)
  @IsNumberString()
  @ValidateIf(o => o.assetType === AssetType.AUCTION)
  @IsNotEmpty()
  auctionDuration!: string; // Duration in seconds
}