import { IsString, IsNotEmpty, IsUUID, IsOptional, IsNumberString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class NotifyTrustlineDto {
  @ApiProperty({ description: 'Stellar transaction hash from investor changeTrust operation', example: 'abc123...' })
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @ApiProperty({ description: 'Asset UUID', example: 'f64a0f2f-9c17-43a1-b376-d829ae5595b4' })
  @IsUUID()
  @IsNotEmpty()
  assetId!: string;

  @ApiProperty({ description: 'Network identifier', example: 'stellar', enum: ['stellar'] })
  @IsString()
  @IsNotEmpty()
  @IsEnum(['stellar'], { message: 'network must be "stellar"' })
  network!: string;

  @ApiProperty({ description: 'Optional ledger/block number', required: false })
  @IsNumberString()
  @IsOptional()
  blockNumber?: string;
}

export class CheckAbilityResponseDto {
  @ApiProperty({ description: 'Whether investor can purchase tokens for this asset' })
  canBuy!: boolean;

  @ApiProperty({ description: 'Current trustline status', enum: ['NOT_REQUESTED', 'PENDING', 'APPROVED'] })
  trustlineStatus!: string;

  @ApiProperty({ description: 'Reason if canBuy is false', required: false })
  reason?: string;
}
