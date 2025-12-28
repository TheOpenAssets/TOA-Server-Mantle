import { IsString, IsNotEmpty, IsEnum, IsOptional, IsNumberString } from 'class-validator';

export enum ListingType {
  STATIC = 'STATIC',
  AUCTION = 'AUCTION',
}

export class ListOnMarketplaceDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsOptional()
  @IsNumberString()
  duration?: string; // Optional: For auctions - duration in seconds. If not provided, uses default or asset-specific duration
}
