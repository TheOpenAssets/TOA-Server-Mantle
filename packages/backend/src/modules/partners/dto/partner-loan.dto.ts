import { IsString, IsNumber, IsEthereumAddress, IsPositive, Matches, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PartnerBorrowDto {
  @ApiProperty({ example: 123, description: 'OAID Token ID' })
  @IsNumber()
  @IsPositive()
  oaidTokenId!: number;

  @ApiProperty({ example: '0x580F5b09765E71D64613c8F4403234f8790DD7D3', description: 'User wallet address' })
  @IsEthereumAddress()
  userWallet!: string;

  @ApiProperty({ example: '5000000000', description: 'Amount to borrow in USDC (6 decimals)' })
  @IsString()
  @Matches(/^\d+$/)
  borrowAmount!: string;

  @ApiProperty({ example: 'xyz_loan_12345', description: 'Partner unique loan ID' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  partnerLoanId!: string;

  @ApiPropertyOptional({ example: { partnerUserId: 'user_456' }, description: 'Optional metadata' })
  @IsOptional()
  @IsObject()
  metadata?: any;

  @ApiPropertyOptional({ example: 2592000, description: 'Loan duration in seconds (default: 30 days)' })
  @IsOptional()
  @IsNumber()
  loanDuration?: number;

  @ApiPropertyOptional({ example: 1, description: 'Number of installments (default: 1)' })
  @IsOptional()
  @IsNumber()
  numberOfInstallments?: number;
}

export class PartnerRepayDto {
  @ApiProperty({ example: 'xyz_loan_12345', description: 'Partner unique loan ID' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  partnerLoanId!: string;

  @ApiProperty({ example: '5000000000', description: 'Amount to repay in USDC (6 decimals)' })
  @IsString()
  @Matches(/^\d+$/)
  repaymentAmount!: string;

  @ApiPropertyOptional({ example: '0xdef789abc012...', description: 'Optional transaction hash of the USDC transfer' })
  @IsOptional()
  @IsString()
  repaymentTxHash?: string;
}
