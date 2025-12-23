import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import { TokenHolderTrackingService } from '../../yield/services/token-holder-tracking.service';

@Processor('event-processing')
export class EventProcessor extends WorkerHost {
  private readonly logger = new Logger(EventProcessor.name);

  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private tokenHolderTrackingService: TokenHolderTrackingService,
  ) {
    super();
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
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async processAssetRegistered(data: any) {
    const { assetId, blobId, attestationHash, attestor, txHash, blockNumber, timestamp } = data;
    
    this.logger.log(`Syncing AssetRegistered for ${assetId}`);

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
    const { assetId, tokenAddress, complianceAddress, totalSupply, txHash, blockNumber, timestamp } = data;

    this.logger.log(`Syncing TokenSuiteDeployed for ${assetId} -> ${tokenAddress}`);

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

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }
}
