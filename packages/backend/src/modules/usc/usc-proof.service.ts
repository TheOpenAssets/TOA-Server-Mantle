import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, createWalletClient, http, Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { creditcoinTestnet } from '@/src/config/creditcoin-chain';
import { CreditCoinContracts, CreditCoinAbis } from '@contracts/creditcoin';
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

  constructor(private readonly configService: ConfigService) {}

  private getCreditcoinClients() {
    const rpcUrl = this.configService.get<string>('blockchain.creditcoin.rpcUrl');
    if (!rpcUrl) throw new Error('CREDITCOIN_RPC_URL is not configured');

    const pk =
      this.configService.get<string>('blockchain.creditcoin.adminPrivateKey') ||
      this.configService.get<string>('blockchain.adminPrivateKey');
    if (!pk) throw new Error('No Creditcoin private key configured (CREDITCOIN_ADMIN_PRIVATE_KEY or ADMIN_PRIVATE_KEY)');

    const account = privateKeyToAccount(pk as `0x${string}`);
    const transport = http(rpcUrl);

    return {
      walletClient: createWalletClient({ account, chain: creditcoinTestnet, transport }),
      publicClient: createPublicClient({ chain: creditcoinTestnet, transport }),
      account,
    };
  }

  async submitProof(dto: SubmitProofDto): Promise<{ txHash: string; verified: boolean }> {
    try {
      const contractAddress = CreditCoinContracts.USCCreditVerifier as string;
      const contractAbi = CreditCoinAbis.USCCreditVerifier;

      if (!contractAddress || contractAddress === ZERO_ADDRESS) {
        this.logger.warn('USCCreditVerifier not deployed — skipping on-chain verification.');
        return { txHash: '', verified: false };
      }

      const { walletClient, publicClient, account } = this.getCreditcoinClients();

      this.logger.log(
        `Submitting USC proof to Creditcoin EVM: wallet=${dto.walletAddress} ` +
        `chain=${dto.sourceChain} type=${dto.eventType} delta=${dto.scoreDelta}`,
      );

      const hash = await walletClient.writeContract({
        address: contractAddress as Address,
        abi: contractAbi,
        functionName: 'verifyAndRecord',
        args: [
          dto.walletAddress as Address,
          dto.sourceChain,
          EVENT_TYPE_MAP[dto.eventType],
          BigInt(dto.scoreDelta),
          dto.proofData as `0x${string}`,
        ],
        account,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      this.logger.log(`USC proof verified on-chain via 0x0FD2 precompile. txHash: ${hash}`);
      return { txHash: hash, verified: true };
    } catch (error: any) {
      this.logger.error(`USC proof submission failed: ${error.message}`);
      return { txHash: '', verified: false };
    }
  }
}
