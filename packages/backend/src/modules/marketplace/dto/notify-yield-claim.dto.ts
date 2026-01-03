import { IsString, IsNotEmpty, IsNumberString, IsOptional } from 'class-validator';

export class NotifyYieldClaimDto {
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsNumberString()
  @IsNotEmpty()
  tokensBurned!: string; // Amount of tokens burned (in wei)

  @IsNumberString()
  @IsNotEmpty()
  usdcReceived!: string; // Amount of USDC received (in wei, 6 decimals)

  @IsOptional()
  @IsNumberString()
  blockNumber?: string;
}
