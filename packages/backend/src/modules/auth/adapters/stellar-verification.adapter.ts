import { Injectable } from '@nestjs/common';
import { Keypair, hash } from '@stellar/stellar-sdk';
import { IAuthVerificationAdapter } from './auth-verification.adapter.interface';

@Injectable()
export class StellarVerificationAdapter implements IAuthVerificationAdapter {
  async verify(address: string, message: string, signature: string): Promise<boolean> {
    try {
      const keypair = Keypair.fromPublicKey(address);
      const signatureBytes = Buffer.from(signature, 'base64');

      // Freighter (SEP-53): prepends prefix then SHA-256 hashes before signing
      const SEP53_PREFIX = 'Stellar Signed Message:\n';
      const prefixedMessage = Buffer.concat([
        Buffer.from(SEP53_PREFIX, 'utf-8'),
        Buffer.from(message, 'utf-8'),
      ]);
      const messageHash = hash(prefixedMessage);

      return keypair.verify(messageHash, signatureBytes);
    } catch (error) {
      return false;
    }
  }
}
