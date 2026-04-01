import { IsString, Matches } from 'class-validator';

export class SyncOrderTxDto {
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{64}$/, { message: 'txHash must be a valid 0x transaction hash' })
  txHash!: string;
}
