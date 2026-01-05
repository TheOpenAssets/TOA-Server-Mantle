import { IsNumberString, IsNotEmpty } from 'class-validator';

export class BorrowDto {
  @IsNumberString()
  @IsNotEmpty()
  positionId!: string; // Position ID

  @IsNumberString()
  @IsNotEmpty()
  amount!: string; // USDC amount (6 decimals)
}
