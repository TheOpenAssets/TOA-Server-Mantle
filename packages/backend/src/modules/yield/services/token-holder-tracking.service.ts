import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TokenHolder, TokenHolderDocument } from '../../../database/schemas/token-holder.schema';
import { TokenTransferEvent, TokenTransferEventDocument } from '../../../database/schemas/token-transfer-event.schema';

@Injectable()
export class TokenHolderTrackingService {
  private readonly logger = new Logger(TokenHolderTrackingService.name);

  constructor(
    @InjectModel(TokenHolder.name) private tokenHolderModel: Model<TokenHolderDocument>,
    @InjectModel(TokenTransferEvent.name) private transferEventModel: Model<TokenTransferEventDocument>,
  ) {}

  async updateHolderFromTransferEvent(
    tokenAddress: string,
    from: string,
    to: string,
    amount: string,
    blockNumber?: number,
    transactionHash?: string,
  ) {
    const amountBigInt = BigInt(amount);
    const zeroAddress = '0x0000000000000000000000000000000000000000';

    // 1. Decrease balance of sender
    if (from !== zeroAddress) {
      const sender = await this.tokenHolderModel.findOne({ tokenAddress, holderAddress: from });
      if (sender) {
        const newBalance = BigInt(sender.balance) - amountBigInt;
        if (newBalance <= 0n) {
          await this.tokenHolderModel.deleteOne({ _id: sender._id });
        } else {
          sender.balance = newBalance.toString();
          sender.lastUpdated = new Date();
          await sender.save();
        }
      }
    }

    // 2. Increase balance of receiver
    if (to !== zeroAddress) {
      const receiver = await this.tokenHolderModel.findOne({ tokenAddress, holderAddress: to });
      if (receiver) {
        receiver.balance = (BigInt(receiver.balance) + amountBigInt).toString();
        receiver.lastUpdated = new Date();
        await receiver.save();
      } else {
        await this.tokenHolderModel.create({
          tokenAddress,
          holderAddress: to,
          balance: amountBigInt.toString(),
          lastUpdated: new Date(),
        });
      }
    }

    // 3. Record transfer event for time-weighted yield calculations
    await this.transferEventModel.create({
      tokenAddress,
      from,
      to,
      amount,
      blockNumber: blockNumber || 0,
      transactionHash: transactionHash || 'unknown',
      timestamp: new Date(),
    });
  }

  async getHoldersAboveThreshold(tokenAddress: string, minBalance: bigint) {
    // This requires fetching all and filtering in memory if BigInt comparison not supported directly in query easily with strings
    // Or we rely on string comparison if lengths are padded (not robust)
    // For this implementation, fetch all and filter JS side (ok for MVP)
    const holders = await this.tokenHolderModel.find({ tokenAddress });
    return holders.filter(h => BigInt(h.balance) >= minBalance);
  }

  /**
   * Calculate time-weighted token holdings (token-days) for yield distribution
   *
   * @param tokenAddress The token contract address
   * @param fromDate Start date for calculation (typically token deployment or last distribution)
   * @param toDate End date for calculation (typically now)
   * @returns Map of holder address to token-days
   */
  async calculateTokenDays(
    tokenAddress: string,
    fromDate: Date,
    toDate: Date = new Date(),
  ): Promise<Map<string, bigint>> {
    const zeroAddress = '0x0000000000000000000000000000000000000000';

    // Get all transfer events for this token in the time period
    const events = await this.transferEventModel
      .find({
        tokenAddress,
        timestamp: { $gte: fromDate, $lte: toDate },
      })
      .sort({ timestamp: 1 })
      .exec();

    // Track balances over time for each holder
    const holderBalances = new Map<string, bigint>();
    const holderTokenDays = new Map<string, bigint>();
    const holderLastUpdate = new Map<string, Date>();

    // Helper function to accumulate token-days before a balance change
    const accumulateTokenDays = (holder: string, currentTime: Date) => {
      if (holder === zeroAddress) return;

      const balance = holderBalances.get(holder) || 0n;
      const lastUpdate = holderLastUpdate.get(holder) || fromDate;

      if (balance > 0n) {
        const timeDeltaMs = currentTime.getTime() - lastUpdate.getTime();
        const timeDeltaDays = timeDeltaMs / (1000 * 60 * 60 * 24);
        const tokenDays = balance * BigInt(Math.floor(timeDeltaDays * 1e6)) / BigInt(1e6); // Use micro-days for precision

        const currentTokenDays = holderTokenDays.get(holder) || 0n;
        holderTokenDays.set(holder, currentTokenDays + tokenDays);
      }

      holderLastUpdate.set(holder, currentTime);
    };

    // Process all transfer events chronologically
    for (const event of events) {
      // Accumulate token-days for sender before transfer
      if (event.from !== zeroAddress) {
        accumulateTokenDays(event.from, event.timestamp);
        const currentBalance = holderBalances.get(event.from) || 0n;
        holderBalances.set(event.from, currentBalance - BigInt(event.amount));
      }

      // Accumulate token-days for receiver before transfer
      if (event.to !== zeroAddress) {
        accumulateTokenDays(event.to, event.timestamp);
        const currentBalance = holderBalances.get(event.to) || 0n;
        holderBalances.set(event.to, currentBalance + BigInt(event.amount));
      }
    }

    // Final accumulation from last event to toDate
    for (const [holder, balance] of holderBalances.entries()) {
      if (balance > 0n && holder !== zeroAddress) {
        accumulateTokenDays(holder, toDate);
      }
    }

    this.logger.log(
      `Calculated token-days for ${tokenAddress}: ${holderTokenDays.size} holders, ` +
      `total token-days: ${Array.from(holderTokenDays.values()).reduce((a, b) => a + b, 0n)}`,
    );

    return holderTokenDays;
  }
}
