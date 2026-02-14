import { Injectable } from '@nestjs/common';
import { verifyMessage } from 'viem';
import { IAuthVerificationAdapter } from './auth-verification.adapter.interface';

@Injectable()
export class EvmVerificationAdapter implements IAuthVerificationAdapter {
  async verify(address: string, message: string, signature: string): Promise<boolean> {
    try {
      return await verifyMessage({
        address: address as `0x${string}`,
        message: message,
        signature: signature as `0x${string}`,
      });
    } catch (error) {
      return false;
    }
  }
}
