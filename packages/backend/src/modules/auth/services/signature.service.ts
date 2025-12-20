import { Injectable } from '@nestjs/common';
import { verifyMessage } from 'viem';

@Injectable()
export class SignatureService {
  async verifySignature(
    walletAddress: string,
    message: string,
    signature: string,
  ): Promise<boolean> {
    try {
      const valid = await verifyMessage({
        address: walletAddress as `0x${string}`,
        message: message,
        signature: signature as `0x${string}`,
      });
      return valid;
    } catch (error) {
      return false;
    }
  }
}
