import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class NotifySettlementDto {
  @ApiProperty({ description: 'Network transaction identifier (EVM hash or Stellar hash)' })
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsNumber()
  @IsNotEmpty()
  bidIndex!: number;

}
