import { IsString, IsNotEmpty, IsNumberString, IsOptional } from 'class-validator';

export class NotifyYieldClaimDto {
  @IsString()
  @IsNotEmpty()
  txHash!: string; // Transaction hash of the claim

  @IsString()
  @IsNotEmpty()
  tokenAddress!: string; // RWA token address

  @IsString()
  @IsNotEmpty()
  assetId!: string; // Asset ID

  @IsNumberString()
  @IsNotEmpty()
  tokensBurned!: string; // Amount of RWA tokens burned (in wei)

  @IsNumberString()
  @IsNotEmpty()
  usdcReceived!: string; // Amount of USDC received (in wei, 6 decimals)

  @IsOptional()
  @IsNumberString()
  blockNumber?: string; // Block number (optional)
}
