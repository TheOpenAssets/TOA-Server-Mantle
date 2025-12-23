import { IsString, IsNotEmpty, IsNumber, IsDateString } from 'class-validator';

export class RecordSettlementDto {
  @IsString()
  @IsNotEmpty()
  assetId: string;

  @IsNumber()
  @IsNotEmpty()
  settlementAmount: number;

  @IsDateString()
  @IsNotEmpty()
  settlementDate: string;
}

export class ConfirmUSDCDto {
  @IsString()
  @IsNotEmpty()
  settlementId: string;

  @IsString()
  @IsNotEmpty()
  usdcAmount: string;
}

export class DistributeDto {
  @IsString()
  @IsNotEmpty()
  settlementId: string;
}
