import { IsString, IsNotEmpty, IsNumberString, IsEnum, IsBoolean, IsOptional } from 'class-validator';
import { TokenType } from '../../../database/schemas/solvency-position.schema';

export class DepositCollateralDto {
  @IsString()
  @IsNotEmpty()
  collateralTokenAddress!: string;

  @IsNumberString()
  @IsNotEmpty()
  collateralAmount!: string; // Wei (18 decimals)

  @IsNumberString()
  @IsNotEmpty()
  tokenValueUSD!: string; // Wei (6 decimals)

  @IsEnum(TokenType)
  @IsNotEmpty()
  tokenType!: TokenType;

  @IsBoolean()
  @IsOptional()
  issueOAID?: boolean; // Whether to issue OAID credit line
}
