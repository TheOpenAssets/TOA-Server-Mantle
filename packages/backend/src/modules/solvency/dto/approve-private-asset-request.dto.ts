import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ApprovePrivateAssetRequestDto {
  @IsString()
  @IsNotEmpty()
  finalValuation!: string; // Admin's final valuation in USD (6 decimals)

  @IsString()
  @IsOptional()
  notes?: string; // Admin notes about the approval/valuation
}
