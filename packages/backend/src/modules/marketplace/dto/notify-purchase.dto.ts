import { IsString, IsNotEmpty, IsNumberString, IsOptional, Matches } from 'class-validator';

export class NotifyPurchaseDto {
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @Matches(/^-?\d+$/, { message: 'amount must be a valid number string (can be negative)' })
  @IsNotEmpty()
  amount!: string; // Token amount purchased (in wei) - can be negative

  @IsOptional()
  @IsNumberString()
  blockNumber?: string;
}
