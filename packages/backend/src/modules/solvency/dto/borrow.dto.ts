import { IsNumberString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class BorrowDto {
  @IsNotEmpty()
  @IsNumberString()
  positionId!: string;

  @IsNotEmpty()
  @IsNumberString()
  amount!: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  loanDuration!: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  numberOfInstallments!: number;
}
