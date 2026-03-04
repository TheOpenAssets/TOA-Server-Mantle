import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Address } from 'viem';
import { getActiveChain } from '@/src/config/active-chain';
import { WalletService } from '@/src/modules/blockchain/services/wallet.service';
import { ContractLoaderService } from '@/src/modules/blockchain/services/contract-loader.service';
import { SubmitProofDto, CrossChainEventType } from './dto/submit-proof.dto';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const EVENT_TYPE_MAP: Record<CrossChainEventType, number> = {
  [CrossChainEventType.REPAYMENT]: 0,
  [CrossChainEventType.DEFAULT]: 1,
  [CrossChainEventType.STAKE]: 2,
};

@Injectable()
export class UscProofService {
  private readonly logger = new Logger(UscProofService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly contractLoader: ContractLoaderService,
    private readonly configService: ConfigService,
  ) {}

  async submitProof(dto: SubmitProofDto): Promise<{ txHash: string; verified: boolean }> {
    try {
      const contractAddress = this.contractLoader.getContractAddress('USCCreditVerifier');
      const contractAbi = this.contractLoader.getContractAbi('USCCreditVerifier');

      if (!contractAddress || contractAddress === ZERO_ADDRESS) {
        this.logger.warn(
          'USCCreditVerifier contract address is zero or not configured. Skipping on-chain verification.',
        );
        return { txHash: '', verified: false };
      }

      const wallet = this.walletService.getPlatformWallet();
      const publicClient = createPublicClient({
        chain: getActiveChain(),
        transport: http(this.configService.get('blockchain.rpcUrl')),
      });

      const eventTypeUint8 = EVENT_TYPE_MAP[dto.eventType];
      const proofBytes = dto.proofData as `0x${string}`;

      const hash = await wallet.writeContract({
        address: contractAddress as Address,
        abi: contractAbi,
        functionName: 'verifyAndRecord',
        args: [
          dto.walletAddress as Address,
          dto.sourceChain,
          eventTypeUint8,
          BigInt(dto.scoreDelta),
          proofBytes,
        ],
        account: wallet.account!,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      this.logger.log(`USC proof verified on-chain. txHash: ${hash}`);
      return { txHash: hash, verified: true };
    } catch (error: any) {
      this.logger.error(`Failed to submit USC proof: ${error.message}`);
      return { txHash: '', verified: false };
    }
  }
}
