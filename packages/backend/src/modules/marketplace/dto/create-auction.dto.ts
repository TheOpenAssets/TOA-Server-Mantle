import { IsString, IsNotEmpty, IsNumberString } from 'class-validator';

export class CreateAuctionDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsNumberString()
  reservePrice!: string;

  @IsNumberString()
  duration!: string; // in seconds
}
