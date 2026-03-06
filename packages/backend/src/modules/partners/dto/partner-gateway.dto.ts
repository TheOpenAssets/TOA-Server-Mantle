import { IsString, IsUUID, IsOptional, IsNumber, IsPositive, IsInt, Min, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GatewayBorrowDto {
  @ApiProperty({
    example: 'partner_aave_5aceed8c',
    description: 'Partner ID returned by GET /partners/gateway/list',
  })
  @IsString()
  partnerId!: string;

  @ApiProperty({
    example: '5000000000',
    description: 'Amount to borrow in USDC (6 decimals). 5000 USDC = "5000000000"',
  })
  @IsString()
  @Matches(/^\d+$/, { message: 'amount must be a numeric string' })
  amount!: string;

  @ApiProperty({
    example: '0xabc123...def456',
    description:
      'Transaction hash from the user-initiated vault.borrowUSDC() on-chain call. ' +
      'The frontend must call SolvencyVault.borrowUSDC() directly (user signs) before calling this endpoint, ' +
      'because the vault enforces msg.sender == position.user.',
  })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{64}$/, { message: 'vaultTxHash must be a valid 0x-prefixed 32-byte hex transaction hash' })
  vaultTxHash!: string;

  @ApiPropertyOptional({
    example: 2592000,
    description: 'Loan duration in seconds (default: 30 days = 2592000)',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  loanDuration?: number;

  @ApiPropertyOptional({
    example: 4,
    description: 'Solvency position ID to borrow against. If omitted, the first active position is used.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  positionId?: number;
}

export class GatewayRepayDto {
  @ApiProperty({
    example: 'uuid-of-loan',
    description: 'Internal loan ID returned by the borrow endpoint',
  })
  @IsUUID()
  internalLoanId!: string;

  @ApiProperty({
    example: '5000000000',
    description: 'Amount to repay in USDC (6 decimals). Full repayment = remainingDebt value.',
  })
  @IsString()
  @Matches(/^\d+$/, { message: 'amount must be a numeric string' })
  amount!: string;
}
