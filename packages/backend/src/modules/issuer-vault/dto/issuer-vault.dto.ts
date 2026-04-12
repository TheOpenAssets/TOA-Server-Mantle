import { IsString, IsNotEmpty, IsNumber, IsPositive, Min, Max, IsOptional } from 'class-validator';

// ─── Admin DTOs ───────────────────────────────────────────────────────────────

export class CreateIssuerVaultDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  /** Annual interest rate in basis points (e.g. 1000 = 10%). Max 5000 = 50%. */
  @IsNumber()
  @Min(0)
  @Max(5000)
  agreedRateBps!: number;
}

// ─── Issuer DTOs ──────────────────────────────────────────────────────────────

export class WithdrawLiquidityDto {
  /** USDC amount to withdraw in canonical 6-decimal format (string to avoid precision loss) */
  @IsString()
  @IsNotEmpty()
  amount!: string;
}

export class RepayDebtDto {
  /** USDC amount to repay in canonical 6-decimal format */
  @IsString()
  @IsNotEmpty()
  amount!: string;
}

// ─── Response shape (shared) ─────────────────────────────────────────────────

export class DebtSummaryResponse {
  assetId!: string;
  principalHeld!: string;
  amountWithdrawn!: string;
  outstandingDebt!: string;
  interestOwed!: string;
  totalOwed!: string;
  agreedRateBps!: number;
  withdrawalTimestamp!: number;
  isFullyRepaid!: boolean;
  status!: string;
  contractAddress!: string;
}
