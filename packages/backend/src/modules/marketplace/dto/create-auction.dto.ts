import { IsString, IsNotEmpty, IsNumberString } from 'class-validator';
import { IsCanonicalAmount } from '../../../utils/validators/canonical-amount.validator';

export class CreateAuctionDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsCanonicalAmount()
  reservePrice!: string; // Canonical 4-decimal format (e.g., "0.8500" for 0.85 USDC per token)

  @IsNumberString()
  duration!: string; // Duration in seconds (not a monetary value)
}
