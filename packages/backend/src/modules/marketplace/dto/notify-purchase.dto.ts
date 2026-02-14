import { IsString, IsNotEmpty, IsNumberString, IsOptional, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class NotifyPurchaseDto {
  @ApiProperty({ description: 'Network transaction identifier (EVM hash or Stellar hash)' })
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

  @IsOptional()
  @IsString()
  type?: string;
}
