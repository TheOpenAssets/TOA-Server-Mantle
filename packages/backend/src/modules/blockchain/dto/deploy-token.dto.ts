import { IsString, IsNotEmpty, IsNumberString, IsOptional } from 'class-validator';

export class DeployTokenDto {
  @IsString()
  @IsNotEmpty()
  assetId: string;

  @IsNumberString()
  @IsNotEmpty()
  totalSupply: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsString()
  @IsNotEmpty()
  issuer: string; // Address

  // Listing params (optional, can be done separately)
  @IsOptional()
  listingParams?: {
    type: 'STATIC' | 'AUCTION';
    price: string;
    minInvestment: string;
  };
}
