import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

export class InitiateLeveragePurchaseDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string; // Asset ID to purchase

  @IsString()
  @IsNotEmpty()
  tokenAddress!: string; // RWA token contract address

  @IsString()
  @IsNotEmpty()
  tokenAmount!: string; // Amount of tokens to purchase (wei)

  @IsString()
  @IsNotEmpty()
  pricePerToken!: string; // Price per token in USDC (6 decimals)

  @IsString()
  @IsOptional()
  mETHCollateral?: string; // mETH collateral amount (18 decimals) — Mantle

  @IsString()
  @IsOptional()
  stARBCollateral?: string; // stARB collateral amount (18 decimals) — Arbitrum

  /** Normalised accessor — use this in the controller regardless of network */
  get collateral(): string {
    return this.mETHCollateral || this.stARBCollateral || '0';
  }
}

export class GetSwapQuoteDto {
  @IsString()
  @IsNotEmpty()
  mETHAmount!: string; // mETH amount to swap (18 decimals)
}

export class UnwindPositionDto {
  @IsString()
  @IsNotEmpty()
  positionId!: string; // Position ID to unwind
}

export class ClaimYieldFromBurnDto {
  @IsString()
  @IsNotEmpty()
  tokenAmount!: string; // Amount of RWA tokens to burn (wei, 18 decimals)
}

export class ProcessSettlementDto {
  @IsString()
  @IsNotEmpty()
  settlementUSDC!: string; // Settlement USDC amount (wei, 6 decimals)
}
