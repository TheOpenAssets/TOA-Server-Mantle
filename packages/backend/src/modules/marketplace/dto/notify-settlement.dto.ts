import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class NotifySettlementDto {
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsNumber()
  @IsNotEmpty()
  bidIndex!: number;

  @IsOptional()
  @IsNumber()
  blockNumber?: number;
}
