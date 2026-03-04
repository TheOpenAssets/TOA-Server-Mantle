import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsCanonicalAmount } from '../../../utils/validators/canonical-amount.validator';

export class NotifyBidDto {
  @ApiProperty({ description: 'Network transaction identifier (EVM hash or Stellar hash)' })
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsCanonicalAmount()
  @IsNotEmpty()
  tokenAmount!: string; // Canonical 4-decimal format (e.g., "100.0000" for 100 tokens)

  @IsCanonicalAmount()
  @IsNotEmpty()
  price!: string; // Canonical 4-decimal format (e.g., "0.8500" for 0.85 USDC per token)

  @IsOptional()
  @IsString()
  blockNumber?: string;
}
