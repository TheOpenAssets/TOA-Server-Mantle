import { IsString, IsNotEmpty, IsNumberString } from 'class-validator';

export class EndAuctionDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;
}
