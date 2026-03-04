import { WalletAddress } from '@openassets/types';

export interface AuthVerificationAdapter {
  verifySignatureAndExtractAddress(
    nonce: string,
    signature: string,
    claimedAddress: WalletAddress
  ): Promise<WalletAddress>;
}
