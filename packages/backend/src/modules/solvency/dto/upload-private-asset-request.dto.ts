import { IsString, IsEnum, IsOptional, IsNotEmpty } from 'class-validator';
import { PrivateAssetType } from '../../../database/schemas/private-asset-request.schema';

export class UploadPrivateAssetRequestDto {
  @IsString()
  @IsNotEmpty()
  name!: string; // e.g., "123 Main St Property Deed"

  @IsEnum(PrivateAssetType)
  assetType!: PrivateAssetType; // DEED, BOND, INVOICE, EQUIPMENT, OTHER

  @IsString()
  @IsOptional()
  location?: string; // e.g., "California, USA"

  @IsString()
  @IsNotEmpty()
  claimedValuation!: string; // User's claimed value in USD (6 decimals, e.g., "500000000000" for $500k)

  @IsString()
  @IsNotEmpty()
  documentHash!: string; // IPFS hash of uploaded documents

  @IsString()
  @IsOptional()
  documentUrl?: string; // Optional direct URL to documents

  @IsString()
  @IsOptional()
  description?: string; // User's description/notes about the asset

  @IsOptional()
  metadata?: {
    fileSize?: number;
    fileType?: string;
    additionalNotes?: string;
  };
}
