import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { detectNetworkType, NetworkType } from '../utils/wallet.util';
import { EvmVerificationAdapter } from '../adapters/evm-verification.adapter';
import { StellarVerificationAdapter } from '../adapters/stellar-verification.adapter';

@Injectable()
export class SignatureService {
  constructor(
    private readonly evmAdapter: EvmVerificationAdapter,
    private readonly stellarAdapter: StellarVerificationAdapter,
  ) {}

  async verifySignature(
    walletAddress: string,
    message: string,
    signature: string,
  ): Promise<boolean> {
    const network = detectNetworkType(walletAddress);

    switch (network) {
      case NetworkType.MANTLE:
        return this.evmAdapter.verify(walletAddress, message, signature);
      case NetworkType.STELLAR:
        return this.stellarAdapter.verify(walletAddress, message, signature);
      default:
        return false;
    }
  }
}
