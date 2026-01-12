import { IsString, IsNotEmpty, IsNumberString, IsOptional } from 'class-validator';

export class NotifyLoanRepaymentDto {
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @IsNumberString()
  @IsNotEmpty()
  positionId!: string;

  @IsNumberString()
  @IsNotEmpty()
  repaymentAmount!: string; // USDC repaid (6 decimals)

  @IsOptional()
  @IsNumberString()
  blockNumber?: string;
}
