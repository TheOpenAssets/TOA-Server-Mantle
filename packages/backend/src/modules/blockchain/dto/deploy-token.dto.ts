import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class DeployTokenDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  symbol!: string;

  // These are now optional - will be fetched from asset record if not provided
  @IsOptional()
  @IsString()
  totalSupply?: string;

  @IsOptional()
  @IsString()
  issuer?: string; // Address

  // Listing params (optional, can be done separately)
  @IsOptional()
  listingParams?: {
    type: 'STATIC' | 'AUCTION';
    price: string;
    minInvestment: string;
  };
}