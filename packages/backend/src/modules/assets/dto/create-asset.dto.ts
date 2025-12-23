import { IsString, IsNotEmpty, IsNumberString, IsDateString, IsEnum } from 'class-validator';

export class CreateAssetDto {
  @IsString()
  @IsNotEmpty()
  invoiceNumber!: string;

  @IsNumberString()
  @IsNotEmpty()
  faceValue!: string;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsDateString()
  @IsNotEmpty()
  issueDate!: string;

  @IsDateString()
  @IsNotEmpty()
  dueDate!: string;

  @IsString()
  @IsNotEmpty()
  buyerName!: string;

  @IsString()
  @IsNotEmpty()
  industry!: string;

  @IsString()
  @IsNotEmpty()
  riskTier!: string;

  // Token Params
  @IsNumberString()
  @IsNotEmpty()
  totalSupply!: string;

  @IsNumberString()
  @IsNotEmpty()
  pricePerToken!: string;

  @IsNumberString()
  @IsNotEmpty()
  minInvestment!: string;
}