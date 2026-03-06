import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createPublicClient, http } from 'viem';
import { creditcoinTestnet } from '@/src/config/creditcoin-chain';
import { CreditCoinContracts, CreditCoinAbis } from '@contracts/creditcoin';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

@Injectable()
export class UscEventListenerService implements OnModuleInit {
  private readonly logger = new Logger(UscEventListenerService.name);
  private lastBlockNumber: bigint = 0n;
  private isPolling = false;
  private publicClient: any;
  private contractAddress: string | null = null;
  private contractAbi: any = null;

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue('usc-events') private readonly uscQueue: Queue,
  ) {}

  async onModuleInit() {
    const address = CreditCoinContracts.USCCreditVerifier as string;

    if (!address || address === ZERO_ADDRESS) {
      this.logger.warn(
        'USCCreditVerifier address is zero or not configured. USC event listener will not start.',
      );
      return;
    }

    this.contractAddress = address;
    this.contractAbi = CreditCoinAbis.USCCreditVerifier;

    const rpcUrl = this.configService.get<string>('blockchain.creditcoin.rpcUrl');
    if (!rpcUrl) {
      this.logger.warn('CREDITCOIN_RPC_URL is not configured. USC event listener will not start.');
      return;
    }

    this.publicClient = createPublicClient({
      chain: creditcoinTestnet,
      transport: http(rpcUrl),
    });

    try {
      const currentBlock = await this.publicClient.getBlockNumber();
      this.lastBlockNumber = currentBlock > 5n ? currentBlock - 5n : 0n;
      this.logger.log(`USC event listener starting from block ${this.lastBlockNumber}`);
    } catch (error: any) {
      this.logger.error(`Failed to get initial block number for USC listener: ${error.message}`);
      return;
    }

    setInterval(() => this.pollUscEvents(), 5000);
  }

  private async pollUscEvents() {
    if (this.isPolling) return;

    this.isPolling = true;
    try {
      const currentBlock = await this.publicClient.getBlockNumber();

      if (currentBlock <= this.lastBlockNumber) return;

      const logs = await this.publicClient.getLogs({
        address: this.contractAddress,
        abi: this.contractAbi,
        eventName: 'CrossChainEventVerified',
        fromBlock: this.lastBlockNumber + 1n,
        toBlock: currentBlock,
      });

      for (const log of logs) {
        const { wallet, sourceChain, eventType, scoreDelta } = log.args as any;
        await this.uscQueue.add('usc-event-verified', {
          walletAddress: wallet,
          sourceChain,
          eventType: String(eventType),
          scoreDelta: Number(scoreDelta),
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
        });
        this.logger.log(`Enqueued USC event for wallet ${wallet} from chain ${sourceChain}`);
      }

      this.lastBlockNumber = currentBlock;
    } catch (error: any) {
      this.logger.error(`Error polling USC events: ${error.message}`);
    } finally {
      this.isPolling = false;
    }
  }
}
