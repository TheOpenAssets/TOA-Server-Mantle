import { IsString, IsNotEmpty, IsOptional, IsNumberString, IsNumber, Min, Max } from 'class-validator';

export class ListOnMarketplaceDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsOptional()
  @IsNumberString()
  duration?: string; // For auctions — duration in seconds. If not provided, uses default or asset-specific duration.

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5000)
  agreedRateBps?: number; // Annual interest rate in basis points (e.g. 1000 = 10%). Required on IssuerVault-enabled networks (Mantle/Hashkey).
}
