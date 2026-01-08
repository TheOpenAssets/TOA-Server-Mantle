import { IsString, IsEnum, IsNumber, IsEmail, IsUrl, IsOptional, IsEthereumAddress, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartnerStatus, PartnerTier } from '../../../database/schemas/partner.schema';

export class CreatePartnerDto {
  @ApiProperty({ example: 'XYZ Lending' })
  @IsString()
  partnerName!: string;

  @ApiProperty({ example: 'xyz' })
  @IsString()
  partnerPrefix!: string;

  @ApiProperty({ enum: PartnerTier, default: PartnerTier.BASIC })
  @IsEnum(PartnerTier)
  tier!: PartnerTier;

  @ApiProperty({ example: '100000000000' }) // $100k
  @IsString()
  dailyBorrowLimit!: string;

  @ApiProperty({ example: '500000000000' }) // $500k
  @IsString()
  totalBorrowLimit!: string;

  @ApiProperty({ example: 50, description: 'Basis points (50 = 0.5%)' })
  @IsNumber()
  @Min(0)
  @Max(10000)
  platformFeePercentage!: number;

  @ApiProperty({ example: '0xPartnerSettlementWallet...' })
  @IsEthereumAddress()
  settlementAddress!: string;

  @ApiProperty({ example: 'api@xyz-lending.com' })
  @IsEmail()
  contactEmail!: string;

  @ApiPropertyOptional({ example: 'https://partner.com/webhook' })
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;
}

export class UpdatePartnerDto {
  @ApiPropertyOptional({ enum: PartnerStatus })
  @IsOptional()
  @IsEnum(PartnerStatus)
  status?: PartnerStatus;

  @ApiPropertyOptional({ enum: PartnerTier })
  @IsOptional()
  @IsEnum(PartnerTier)
  tier?: PartnerTier;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dailyBorrowLimit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  totalBorrowLimit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  platformFeePercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEthereumAddress()
  settlementAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;
}
