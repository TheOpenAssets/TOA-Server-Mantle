import { IsString, IsNotEmpty, IsNumberString, IsOptional } from 'class-validator';

export class NotifyPurchaseDto {
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsNumberString()
  @IsNotEmpty()
  amount!: string; // Token amount purchased (in wei)

  @IsOptional()
  @IsNumberString()
  blockNumber?: string;
}
