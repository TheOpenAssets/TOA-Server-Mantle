import { IsString, IsNotEmpty, IsEnum, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum SourceChain {
  ETHEREUM = 'ETHEREUM',
  BSC = 'BSC',
  BITCOIN = 'BITCOIN',
}

export enum CrossChainEventType {
  REPAYMENT = 'REPAYMENT',
  DEFAULT = 'DEFAULT',
  STAKE = 'STAKE',
}

export class SubmitProofDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  walletAddress!: string;

  @IsEnum(SourceChain)
  @ApiProperty({ enum: SourceChain })
  sourceChain!: SourceChain;

  @IsEnum(CrossChainEventType)
  @ApiProperty({ enum: CrossChainEventType })
  eventType!: CrossChainEventType;

  @IsNumber()
  @ApiProperty()
  scoreDelta!: number;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Hex-encoded STARK proof bytes' })
  proofData!: string;
}
