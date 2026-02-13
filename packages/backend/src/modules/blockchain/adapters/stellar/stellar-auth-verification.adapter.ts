import { Injectable } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { AuthVerificationAdapter } from '../auth-verification-adapter.interface';

@Injectable()
export class StellarAuthVerificationAdapter implements AuthVerificationAdapter {
  async verifySignatureAndExtractAddress(
    nonce: string,
    signature: string,
    claimedAddress: string
  ): Promise<string> {
    try {
      const keypair = Keypair.fromPublicKey(claimedAddress);
      const isValid = keypair.verify(Buffer.from(nonce), Buffer.from(signature, 'base64'));

      if (!isValid) {
        throw new Error('Invalid Stellar signature');
      }

      return claimedAddress;
    } catch (error) {
      throw new Error(`Auth verification failed: ${error.message}`);
    }
  }
}
