import { IsString, IsNotEmpty, IsNumberString, IsOptional } from 'class-validator';

export class NotifyBidDto {
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
