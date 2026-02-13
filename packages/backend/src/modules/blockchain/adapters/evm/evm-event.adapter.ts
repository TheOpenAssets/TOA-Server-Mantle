import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { 
  createPublicClient, 
  http, 
  Address, 
  decodeEventLog, 
  defineChain,
  PublicClient 
} from 'viem';
import { EventAdapter } from '../event-adapter.interface';
import { Queue } from 'bullmq';
import { EvmContractAdapter } from './evm-contract-loader.adapter';

export class EvmEventAdapter implements EventAdapter {
  private readonly logger = new Logger(EvmEventAdapter.name);
  private publicClient: PublicClient;
  private lastBlockNumber: bigint = 0n;
  private isPolling = false;
  private pollingInterval: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly contractAdapter: EvmContractAdapter,
    private readonly eventQueue: Queue,
  ) {
    const rpcUrl = this.configService.get<string>('blockchain.rpcUrl');
    const chainId = this.configService.get<number>('blockchain.chainId');
    const networkName = this.configService.get<string>('network.networkName');

    const chain = defineChain({
      id: chainId,
      name: networkName,
      network: 'mantle',
      nativeCurrency: { decimals: 18, name: 'MNT', symbol: 'MNT' },
      rpcUrls: {
        default: { http: [rpcUrl] },
        public: { http: [rpcUrl] },
      },
    });

    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as PublicClient;
  }

  async startListening(): Promise<void> {
    this.logger.log('Starting EVM event listener polling...');
    const currentBlock = await this.publicClient.getBlockNumber();
    this.lastBlockNumber = currentBlock > 5n ? currentBlock - 5n : 0n;

    this.pollingInterval = setInterval(() => this.poll(), 3000);
  }

  async stopListening(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }

  private async poll() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const currentBlock = await this.publicClient.getBlockNumber();
      const safeBlock = currentBlock > 5n ? currentBlock - 5n : 0n;

      if (safeBlock <= this.lastBlockNumber) {
        this.isPolling = false;
        return;
      }

      const toBlock = safeBlock;
      const fromBlock = this.lastBlockNumber + 1n;

      // In actual implementation, we'd call the check methods similar to EventListenerService
      // For this phase, we are refactoring the architecture.
      
      this.lastBlockNumber = toBlock;
    } catch (error) {
      this.logger.error('Error polling EVM events:', error);
    } finally {
      this.isPolling = false;
    }
  }
}
