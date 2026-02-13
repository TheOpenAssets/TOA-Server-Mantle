import { Injectable } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { WalletAddress } from '@openassets/types';
import { AuthVerificationAdapter } from '../auth-verification-adapter.interface';

@Injectable()
export class StellarAuthVerificationAdapter implements AuthVerificationAdapter {
  async verifySignatureAndExtractAddress(
    nonce: string,
    signature: string,
    claimedAddress: WalletAddress
  ): Promise<WalletAddress> {
    try {
      const keypair = Keypair.fromPublicKey(claimedAddress);
      const isValid = keypair.verify(Buffer.from(nonce), Buffer.from(signature, 'base64'));

      if (!isValid) {
        throw new Error('Invalid Stellar signature');
      }

      return claimedAddress;
    } catch (error: any) {
      throw new Error(`Auth verification failed: ${error.message}`);
    }
  }
}
