import { Injectable } from '@nestjs/common';
import { recoverAddress, hashMessage } from 'viem';
import { AuthVerificationAdapter } from '../auth-verification-adapter.interface';

@Injectable()
export class EvmAuthVerificationAdapter implements AuthVerificationAdapter {
  async verifySignatureAndExtractAddress(
    nonce: string,
    signature: string,
    claimedAddress: string
  ): Promise<string> {
    const recoveredAddress = await recoverAddress({
      hash: hashMessage(nonce),
      signature: signature as `0x${string}`,
    });

    if (recoveredAddress.toLowerCase() !== claimedAddress.toLowerCase()) {
      throw new Error('Invalid signature');
    }

    return recoveredAddress;
  }
}
