import { IsString, IsNotEmpty, IsNumberString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class NotifyBidDto {
  @ApiProperty({ description: 'Network transaction identifier (EVM hash or Stellar hash)' })
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsNumberString()
  @IsNotEmpty()
  tokenAmount!: string; // Token amount to buy (in wei)

  @IsNumberString()
  @IsNotEmpty()
  price!: string; // Bid price per token (in USDC wei)

  @IsOptional()
  @IsNumberString()
  blockNumber?: string;
}
