import { IsString, IsNotEmpty, IsEnum, IsOptional, IsNumberString } from 'class-validator';

export enum ListingType {
  STATIC = 'STATIC',
  AUCTION = 'AUCTION',
}

export class ListOnMarketplaceDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsEnum(ListingType)
  type!: ListingType;

  @IsNumberString()
  @IsNotEmpty()
  price!: string; // Price per token in USDC (wei)

  @IsNumberString()
  @IsNotEmpty()
  minInvestment!: string; // Minimum investment in USDC (wei)

  @IsOptional()
  @IsNumberString()
  duration?: string; // For auctions: duration in seconds
}
