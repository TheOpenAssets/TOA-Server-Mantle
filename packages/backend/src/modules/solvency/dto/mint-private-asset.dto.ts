import { IsString, IsNotEmpty, IsNumberString, IsEnum, IsOptional } from 'class-validator';
import { PrivateAssetType } from '../../../database/schemas/private-asset.schema';

export class MintPrivateAssetDto {
  @IsString()
  @IsNotEmpty()
  name!: string; // Token name

  @IsString()
  @IsNotEmpty()
  symbol!: string; // Token symbol

  @IsEnum(PrivateAssetType)
  @IsNotEmpty()
  assetType!: PrivateAssetType;

  @IsNumberString()
  @IsNotEmpty()
  totalSupply!: string; // Wei (18 decimals), usually 1e18

  @IsNumberString()
  @IsNotEmpty()
  valuation!: string; // USD (6 decimals)

  @IsString()
  @IsOptional()
  location?: string; // Physical location

  @IsString()
  @IsOptional()
  documentHash?: string; // IPFS hash

  @IsString()
  @IsNotEmpty()
  issuer!: string; // Issuer wallet address
}
