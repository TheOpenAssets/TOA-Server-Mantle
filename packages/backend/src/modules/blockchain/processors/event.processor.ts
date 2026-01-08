import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';
import { Bid, BidDocument, BidStatus } from '../../../database/schemas/bid.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import { TokenHolderTrackingService } from '../../yield/services/token-holder-tracking.service';
import { SolvencyPositionService } from '../../solvency/services/solvency-position.service';
import { PositionStatus } from '../../../database/schemas/solvency-position.schema';

@Processor('event-processing')
export class EventProcessor extends WorkerHost {
  private readonly logger = new Logger(EventProcessor.name);

  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private tokenHolderTrackingService: TokenHolderTrackingService,
    private solvencyPositionService: SolvencyPositionService,
  ) {
    super();
  }

  // Helper to convert bytes32 back to UUID format
  private bytes32ToUuid(bytes32: string): string {
    // Remove 0x prefix and trailing zeros
    const hex = bytes32.replace('0x', '').replace(/0+$/, '');
    // Insert hyphens at UUID positions: 8-4-4-4-12
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing event job: ${job.name} [${job.id}]`);

    switch (job.name) {
      case 'process-asset-registered':
        return this.processAssetRegistered(job.data);
      case 'process-token-deployed':
        return this.processTokenDeployed(job.data);
      case 'process-identity-registered':
        return this.processIdentityRegistered(job.data);
      case 'process-transfer':
        return this.processTransfer(job.data);
      case 'process-bid-submitted':
        return this.processBidSubmitted(job.data);
      case 'process-auction-ended':
        return this.processAuctionEnded(job.data);
      case 'process-bid-settled':
        return this.processBidSettled(job.data);

      // SolvencyVault events
      case 'process-solvency-borrow':
        return this.processSolvencyBorrow(job.data);
      case 'process-solvency-repayment':
        return this.processSolvencyRepayment(job.data);
      case 'process-solvency-missed-payment':
        return this.processSolvencyMissedPayment(job.data);
      case 'process-solvency-defaulted':
        return this.processSolvencyDefaulted(job.data);
      case 'process-solvency-liquidated':
        return this.processSolvencyLiquidated(job.data);
      case 'process-solvency-liquidation-settled':
        return this.processSolvencyLiquidationSettled(job.data);
      case 'process-solvency-withdrawal':
        return this.processSolvencyWithdrawal(job.data);
      case 'process-solvency-repayment-plan':
        return this.processSolvencyRepaymentPlan(job.data);

      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async processBidSubmitted(data: any) {
    const { assetId: assetIdBytes32, bidder, tokenAmount, price, bidIndex, txHash, blockNumber } = data;
    const assetId = this.bytes32ToUuid(assetIdBytes32);

    this.logger.log(`Processing new bid for ${assetId} from ${bidder}`);

    const newBid = new this.bidModel({
      assetId,
      bidder,
      tokenAmount,
      price,
      bidIndex,
      transactionHash: txHash,
      blockNumber,
      status: BidStatus.PENDING,
    });
    await newBid.save();

    // Optionally, update asset with bid stats
    await this.assetModel.updateOne(
      { assetId },
      { $inc: { 'listing.totalBids': 1 } }
    );
  }

  private async processAuctionEnded(data: any) {
    const { assetId: assetIdBytes32, clearingPrice, txHash } = data;
    const assetId = this.bytes32ToUuid(assetIdBytes32);

    this.logger.log(`Processing auction end for ${assetId} with clearing price ${clearingPrice}`);

    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          'listing.active': false,
          'listing.clearingPrice': clearingPrice,
          'listing.phase': 'ENDED',
        },
      }
    );

    // Update status of all bids for this auction
    // IMPORTANT: Cannot use MongoDB $gte/$lt on string fields - must compare as BigInt
    // Only bids STRICTLY GREATER than clearing price win (bids AT clearing price lose)
    const bids = await this.bidModel.find({ assetId }).exec();
    const clearingPriceBigInt = BigInt(clearingPrice);

    for (const bid of bids) {
      const bidPrice = BigInt(bid.price);
      const newStatus = bidPrice > clearingPriceBigInt ? BidStatus.WON : BidStatus.LOST;

      await this.bidModel.updateOne(
        { _id: bid._id },
        { $set: { status: newStatus } }
      );
    }

    this.logger.log(`Updated bid statuses for ${bids.length} bids based on clearing price ${clearingPrice}`);
  }

  private async processBidSettled(data: any) {
    const { assetId: assetIdBytes32, bidder, bidIndex, tokensReceived, cost, refund, txHash } = data;
    const assetId = this.bytes32ToUuid(assetIdBytes32);

    this.logger.log(`Processing settlement for bid ${bidIndex} on ${assetId} by ${bidder}`);

    // Determine status: SETTLED if tokens received, REFUNDED if no tokens (lost bid)
    const tokensBigInt = BigInt(tokensReceived);
    const isWinner = tokensBigInt > BigInt(0);
    const status = isWinner ? BidStatus.SETTLED : BidStatus.REFUNDED;

    // Update bid with settlement details
    await this.bidModel.updateOne(
      { assetId, bidIndex },
      {
        $set: {
          status,
          settlementTxHash: txHash, // Save settlement transaction hash
          settledAt: new Date(),
          tokensReceived,
          cost,
          refund,
        },
      }
    );

    // Update listing.sold if tokens were received
    if (isWinner) {
      const asset = await this.assetModel.findOne({ assetId });
      if (asset) {
        const currentSold = BigInt(asset.listing?.sold || '0');
        const newSold = currentSold + tokensBigInt;

        await this.assetModel.updateOne(
          { assetId },
          { $set: { 'listing.sold': newSold.toString() } }
        );

        this.logger.log(
          `Updated listing.sold for ${assetId}: ${currentSold.toString()} + ${tokensReceived} = ${newSold.toString()} tokens`
        );
      }
    } else {
      this.logger.log(
        `Bid ${bidIndex} refunded for ${assetId}: ${refund} USDC (no tokens allocated)`
      );
    }
  }

  private async processAssetRegistered(data: any) {
    const { assetId: assetIdBytes32, blobId, attestationHash, attestor, txHash, blockNumber, timestamp } = data;
    
    // Convert bytes32 to UUID format
    const assetId = this.bytes32ToUuid(assetIdBytes32);
    
    this.logger.log(`Syncing AssetRegistered for ${assetIdBytes32} -> UUID: ${assetId}`);

    const asset = await this.assetModel.findOneAndUpdate(
      { assetId },
      {
        $set: {
          'registry.transactionHash': txHash,
          'registry.blockNumber': blockNumber,
          'registry.registeredAt': new Date(timestamp * 1000),
          status: AssetStatus.REGISTERED,
          'checkpoints.registered': true,
        },
      },
      { new: true }
    );

    if (!asset) {
      this.logger.error(`Asset ${assetId} not found in DB during registration sync`);
      return;
    }

    // TODO: Emit WebSocket to frontend via Gateway
    // this.wsGateway.emit('asset:status-changed', { assetId, status: 'REGISTERED' });
    
    return { assetId, status: 'REGISTERED' };
  }

  private async processTokenDeployed(data: any) {
    const { assetId: assetIdBytes32, tokenAddress, complianceAddress, totalSupply, txHash, blockNumber, timestamp } = data;

    // Convert bytes32 to UUID format
    const assetId = this.bytes32ToUuid(assetIdBytes32);

    this.logger.log(`Syncing TokenSuiteDeployed for ${assetIdBytes32} -> UUID: ${assetId} -> Token: ${tokenAddress}`);

    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          'token.address': tokenAddress,
          'token.compliance': complianceAddress,
          'token.supply': totalSupply.toString(),
          'token.deployedAt': new Date(timestamp * 1000),
          'token.transactionHash': txHash,
          status: AssetStatus.TOKENIZED,
          'checkpoints.tokenized': true,
        },
      }
    );

    // TODO: Initialize tokenHolders collection logic if needed
    // TODO: Emit WebSocket
  }

  private async processIdentityRegistered(data: any) {
    const { wallet, txHash, blockNumber, timestamp } = data;

    this.logger.log(`Syncing IdentityRegistered for ${wallet}`);

    await this.userModel.updateOne(
      { walletAddress: wallet.toLowerCase() },
      {
        $set: {
          kyc: true,
          // You might want to add on-chain metadata to User schema later
        },
      }
    );

    // TODO: Emit WebSocket
  }

  private async processTransfer(data: any) {
    const { tokenAddress, from, to, amount, txHash } = data;
    this.logger.log(`Transfer observed for ${tokenAddress}: ${from} -> ${to} [${amount}]`);

    await this.tokenHolderTrackingService.updateHolderFromTransferEvent(tokenAddress, from, to, amount);
  }

  // ========================================
  // SolvencyVault Event Processors
  // ========================================

  private async processSolvencyBorrow(data: any) {
    const { positionId, amount, totalDebt, txHash, blockNumber } = data;
    this.logger.log(`Processing SolvencyVault borrow for position ${positionId}: borrowed ${amount}, total debt ${totalDebt}`);

    try {
      // The recordBorrow method doesn't sync repayment plan from blockchain
      // We need to sync the full position after borrow
      await this.solvencyPositionService.syncPositionWithBlockchain(positionId);
      this.logger.log(`✅ Position ${positionId} synced after borrow event`);
    } catch (error: any) {
      this.logger.error(`Failed to sync position ${positionId} after borrow: ${error.message}`);
    }
  }

  private async processSolvencyRepayment(data: any) {
    const { positionId, amountPaid, principal, interest, remainingDebt, txHash, blockNumber } = data;
    this.logger.log(`Processing SolvencyVault repayment for position ${positionId}: paid ${amountPaid}, principal ${principal}, interest ${interest}`);

    try {
      await this.solvencyPositionService.recordRepayment(positionId, amountPaid, principal);
      this.logger.log(`✅ Position ${positionId} updated after repayment`);
    } catch (error: any) {
      this.logger.error(`Failed to process repayment for position ${positionId}: ${error.message}`);
    }
  }

  private async processSolvencyMissedPayment(data: any) {
    const { positionId, missedPayments, txHash, blockNumber } = data;
    this.logger.log(`Processing missed payment for position ${positionId}: total missed = ${missedPayments}`);

    try {
      const position = await this.solvencyPositionService.getPosition(positionId);
      position.missedPayments = missedPayments;

      // Update the repayment schedule to mark the current installment as MISSED
      if (position.repaymentSchedule && position.repaymentSchedule.length > 0) {
        const pendingInstallment = position.repaymentSchedule.find((i: any) => i.status === 'PENDING');
        if (pendingInstallment) {
          pendingInstallment.status = 'MISSED';
        }
      }

      // Advance next payment due date
      if (position.nextPaymentDueDate && position.installmentInterval) {
        const intervalMs = position.installmentInterval * 1000;
        position.nextPaymentDueDate = new Date(position.nextPaymentDueDate.getTime() + intervalMs);
      }

      await position.save();
      this.logger.log(`✅ Position ${positionId} marked with ${missedPayments} missed payments`);
    } catch (error: any) {
      this.logger.error(`Failed to process missed payment for position ${positionId}: ${error.message}`);
    }
  }

  private async processSolvencyDefaulted(data: any) {
    const { positionId, txHash, blockNumber } = data;
    this.logger.log(`Processing default for position ${positionId}`);

    try {
      const position = await this.solvencyPositionService.getPosition(positionId);
      position.isDefaulted = true;
      position.status = PositionStatus.ACTIVE; // Still active but defaulted (awaiting liquidation)
      await position.save();
      this.logger.log(`✅ Position ${positionId} marked as defaulted`);
    } catch (error: any) {
      this.logger.error(`Failed to process default for position ${positionId}: ${error.message}`);
    }
  }

  private async processSolvencyLiquidated(data: any) {
    const { positionId, marketplaceListingId, txHash, blockNumber } = data;
    this.logger.log(`Processing liquidation for position ${positionId}`);

    try {
      await this.solvencyPositionService.markLiquidated(positionId, marketplaceListingId, txHash);
      this.logger.log(`✅ Position ${positionId} marked as liquidated`);
    } catch (error: any) {
      this.logger.error(`Failed to process liquidation for position ${positionId}: ${error.message}`);
    }
  }

  private async processSolvencyLiquidationSettled(data: any) {
    const { positionId, yieldReceived, debtRepaid, userRefund, txHash, blockNumber } = data;
    this.logger.log(`Processing liquidation settlement for position ${positionId}: yield ${yieldReceived}, debt repaid ${debtRepaid}, refund ${userRefund}`);

    try {
      const position = await this.solvencyPositionService.getPosition(positionId);
      position.status = PositionStatus.SETTLED;
      position.settledAt = new Date();
      position.debtRecovered = debtRepaid;
      await position.save();
      this.logger.log(`✅ Position ${positionId} marked as settled`);
    } catch (error: any) {
      this.logger.error(`Failed to process liquidation settlement for position ${positionId}: ${error.message}`);
    }
  }

  private async processSolvencyWithdrawal(data: any) {
    const { positionId, amount, remainingCollateral, txHash, blockNumber } = data;
    this.logger.log(`Processing withdrawal for position ${positionId}: withdrew ${amount}, remaining ${remainingCollateral}`);

    try {
      await this.solvencyPositionService.recordWithdrawal(positionId, amount);
      this.logger.log(`✅ Position ${positionId} updated after withdrawal`);
    } catch (error: any) {
      this.logger.error(`Failed to process withdrawal for position ${positionId}: ${error.message}`);
    }
  }

  private async processSolvencyRepaymentPlan(data: any) {
    const { positionId, loanDuration, numberOfInstallments, installmentInterval, txHash, blockNumber } = data;
    this.logger.log(`Processing repayment plan for position ${positionId}: ${numberOfInstallments} installments, interval ${installmentInterval}s`);

    try {
      const position = await this.solvencyPositionService.getPosition(positionId);

      // This event is emitted during borrowUSDC, so the position should already have these details
      // But we'll update them to ensure consistency
      position.loanDuration = loanDuration;
      position.numberOfInstallments = numberOfInstallments;
      position.installmentInterval = installmentInterval;

      // Calculate next payment due date
      const now = new Date();
      position.nextPaymentDueDate = new Date(now.getTime() + (installmentInterval * 1000));

      await position.save();
      this.logger.log(`✅ Position ${positionId} repayment plan updated`);
    } catch (error: any) {
      this.logger.error(`Failed to process repayment plan for position ${positionId}: ${error.message}`);
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }
}
