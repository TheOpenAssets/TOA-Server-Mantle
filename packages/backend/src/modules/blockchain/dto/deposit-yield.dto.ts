import { IsString, IsNotEmpty, IsNumberString, IsArray } from 'class-validator';

export class DepositYieldDto {
  @IsString()
  @IsNotEmpty()
  tokenAddress: string;

  @IsNumberString()
  @IsNotEmpty()
  amount: string;
}

export class DistributeYieldDto {
  @IsString()
  @IsNotEmpty()
  tokenAddress: string;

  @IsArray()
  @IsString({ each: true })
  holders: string[];

  @IsArray()
  @IsNumberString({}, { each: true })
  amounts: string[];
}
