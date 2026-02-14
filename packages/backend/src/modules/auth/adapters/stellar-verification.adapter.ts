import { Injectable } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { IAuthVerificationAdapter } from './auth-verification.adapter.interface';

@Injectable()
export class StellarVerificationAdapter implements IAuthVerificationAdapter {
  async verify(address: string, message: string, signature: string): Promise<boolean> {
    try {
      const keypair = Keypair.fromPublicKey(address);
      const messageBytes = Buffer.from(message, 'utf-8');
      const signatureBytes = Buffer.from(signature, 'base64');
      
      return keypair.verify(messageBytes, signatureBytes);
    } catch (error) {
      return false;
    }
  }
}
