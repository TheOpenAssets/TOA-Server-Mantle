import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TokenTransferEvent, TokenTransferEventDocument } from '../../../database/schemas/token-transfer-event.schema';
import { createPublicClient, http, Address } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TransferEventBackfillService {
  private readonly logger = new Logger(TransferEventBackfillService.name);
  private publicClient;

  constructor(
    @InjectModel(TokenTransferEvent.name) private transferEventModel: Model<TokenTransferEventDocument>,
    private configService: ConfigService,
  ) {
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });
  }

  /**
   * Backfill transfer events for a token from blockchain
   * This is needed for tokens that were deployed before we implemented event tracking
   */
  async backfillTransferEvents(tokenAddress: string, fromBlock?: bigint): Promise<number> {
    this.logger.log(`Backfilling transfer events for ${tokenAddress}...`);

    // Check if we already have events
    const existingCount = await this.transferEventModel.countDocuments({ tokenAddress });
    if (existingCount > 0) {
      this.logger.log(`Found ${existingCount} existing events, skipping backfill`);
      return existingCount;
    }

    // ERC20 Transfer event signature
    const transferEventAbi = {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'value', type: 'uint256', indexed: false },
      ],
    } as const;

    try {
      // If no fromBlock specified, use a reasonable default (last 1M blocks instead of 0)
      // This avoids RPC rate limits on very large block ranges
      let startBlock = fromBlock;
      if (!startBlock) {
        const currentBlock = await this.publicClient.getBlockNumber();
        // Query last 1 million blocks (roughly last few months for Mantle)
        startBlock = currentBlock > 1000000n ? currentBlock - 1000000n : 0n;
        this.logger.log(`No fromBlock specified, using last 1M blocks from ${startBlock}`);
      }

      // Get logs from blockchain
      this.logger.log(`Querying Transfer events from block ${startBlock} to latest...`);
      const logs = await this.publicClient.getLogs({
        address: tokenAddress as Address,
        event: transferEventAbi,
        fromBlock: startBlock,
        toBlock: 'latest',
      });

      this.logger.log(`Found ${logs.length} Transfer events from blockchain`);

      if (logs.length === 0) {
        return 0;
      }

      // Get block timestamps for all events
      const events = [];
      for (const log of logs) {
        const block = await this.publicClient.getBlock({
          blockNumber: log.blockNumber,
        });

        events.push({
          tokenAddress: tokenAddress.toLowerCase(),
          from: log.args.from!.toLowerCase(),
          to: log.args.to!.toLowerCase(),
          amount: log.args.value!.toString(),
          blockNumber: Number(log.blockNumber),
          transactionHash: log.transactionHash,
          timestamp: new Date(Number(block.timestamp) * 1000),
        });
      }

      // Sort by block number to ensure chronological order
      events.sort((a, b) => a.blockNumber - b.blockNumber);

      // Batch insert
      await this.transferEventModel.insertMany(events);

      this.logger.log(`Successfully backfilled ${events.length} transfer events`);
      return events.length;
    } catch (error: any) {
      this.logger.error(`Failed to backfill transfer events: ${error?.message || error}`);
      throw error;
    }
  }

  /**
   * Check if backfill is needed for a token
   */
  async needsBackfill(tokenAddress: string): Promise<boolean> {
    const count = await this.transferEventModel.countDocuments({ tokenAddress });
    return count === 0;
  }
}
