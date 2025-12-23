import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TokenHolder, TokenHolderDocument } from '../../../database/schemas/token-holder.schema';

@Injectable()
export class TokenHolderTrackingService {
  private readonly logger = new Logger(TokenHolderTrackingService.name);

  constructor(
    @InjectModel(TokenHolder.name) private tokenHolderModel: Model<TokenHolderDocument>,
  ) {}

  async updateHolderFromTransferEvent(tokenAddress: string, from: string, to: string, amount: string) {
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
  }

  async getHoldersAboveThreshold(tokenAddress: string, minBalance: bigint) {
    // This requires fetching all and filtering in memory if BigInt comparison not supported directly in query easily with strings
    // Or we rely on string comparison if lengths are padded (not robust)
    // For this implementation, fetch all and filter JS side (ok for MVP)
    const holders = await this.tokenHolderModel.find({ tokenAddress });
    return holders.filter(h => BigInt(h.balance) >= minBalance);
  }
}
