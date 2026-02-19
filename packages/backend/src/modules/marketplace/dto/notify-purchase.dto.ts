import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsCanonicalAmount } from '../../../utils/validators/canonical-amount.validator';

export class NotifyPurchaseDto {
  @ApiProperty({ description: 'Network transaction identifier (EVM hash or Stellar hash)' })
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsCanonicalAmount()
  @IsNotEmpty()
  amount!: string; // Canonical 4-decimal format (e.g., "100.0000") - can be negative for refunds

  @IsOptional()
  @IsString()
  blockNumber?: string;

  @IsOptional()
  @IsString()
  type?: string;
}
