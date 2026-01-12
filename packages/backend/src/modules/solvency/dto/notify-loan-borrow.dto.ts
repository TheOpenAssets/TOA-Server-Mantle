import { IsString, IsNotEmpty, IsNumberString, IsOptional } from 'class-validator';

export class NotifyLoanBorrowDto {
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @IsNumberString()
  @IsNotEmpty()
  positionId!: string;

  @IsNumberString()
  @IsNotEmpty()
  borrowAmount!: string; // USDC borrowed (6 decimals)

  @IsNumberString()
  @IsNotEmpty()
  loanDuration!: string; // Duration in seconds

  @IsNumberString()
  @IsNotEmpty()
  numberOfInstallments!: string;

  @IsOptional()
  @IsNumberString()
  blockNumber?: string;
}
