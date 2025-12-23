import { IsString, IsNotEmpty } from 'class-validator';

export class RegisterAssetDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsString()
  @IsNotEmpty()
  attestationHash!: string;

  @IsString()
  @IsNotEmpty()
  blobId!: string;

  @IsString()
  @IsNotEmpty()
  payload!: string; // Hex string

  @IsString()
  @IsNotEmpty()
  signature!: string; // Hex string
}