import { IsNumberString, IsNotEmpty } from 'class-validator';

export class WithdrawCollateralDto {
  @IsNumberString()
  @IsNotEmpty()
  positionId!: string; // Position ID

  @IsNumberString()
  @IsNotEmpty()
  amount!: string; // Token amount (18 decimals)
}
