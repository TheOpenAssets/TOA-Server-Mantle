import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';
import * as fs from 'fs';
import { keccak256, toHex } from 'viem';
import { EigenDAService } from '../services/eigenda.service';

@Processor('asset-processing')
export class AssetProcessor extends WorkerHost {
  private readonly logger = new Logger(AssetProcessor.name);

  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectQueue('asset-processing') private assetQueue: Queue,
    private eigenDAService: EigenDAService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing asset job: ${job.name} [${job.id}]`);

    switch (job.name) {
      case 'hash-computation':
        return this.processHash(job.data);
      case 'build-merkle':
        return this.processMerkle(job.data);
      case 'eigenda-anchoring': 
        return this.processEigenDA(job.data);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async processHash(data: { assetId: string; filePath: string }) {
    const { assetId, filePath } = data;
    this.logger.log(`Computing hash for asset ${assetId}`);

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const hash = keccak256(fileBuffer); // Viem handles buffer directly

      await this.assetModel.updateOne(
        { assetId },
        {
          $set: {
            'cryptography.documentHash': hash,
            status: AssetStatus.HASHED,
            'checkpoints.hashed': true,
          },
        },
      );

      this.logger.log(`Hash computed: ${hash}. Queueing Merkle build.`);
      
      // Trigger next step
      await this.assetQueue.add('build-merkle', { assetId });
      
      return { hash };
    } catch (error) {
      this.logger.error(`Hashing failed for ${assetId}`, error);
      throw error;
    }
  }

  private async processMerkle(data: { assetId: string }) {
    const { assetId } = data;
    this.logger.log(`Building Merkle Tree for asset ${assetId}`);

    const asset = await this.assetModel.findOne({ assetId });
    if (!asset || !asset.metadata) throw new Error('Asset not found or missing metadata');

    // Prepare leaves: Document Hash + Metadata Fields
    // Simple implementation: hash(key + value)
    const leaves = [
      asset.cryptography.documentHash,
      keccak256(toHex(`invoice:${asset.metadata.invoiceNumber}`)),
      keccak256(toHex(`value:${asset.metadata.faceValue}`)),
      keccak256(toHex(`buyer:${asset.metadata.buyerName}`)),
    ];

    // Simple Merkle Root (Verification usually done via library like merkletreejs)
    // For prototype, we just hash the leaves together to simulate a root
    const combined = leaves.join('');
    const merkleRoot = keccak256(toHex(combined));

    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          'cryptography.merkleRoot': merkleRoot,
          'cryptography.merkleLeaves': leaves,
          status: AssetStatus.MERKLED,
          'checkpoints.merkled': true,
        },
      },
    );

    this.logger.log(`Merkle Root built: ${merkleRoot}. Ready for Attestation.`);
    
    // In a real flow, next step might be ZK Proof generation or direct Attestation
    // We'll stop here or auto-trigger attestation if admin bot is active.
    
    return { merkleRoot };
  }

  private async processEigenDA(data: { assetId: string }) {
    const { assetId } = data;
    this.logger.log(`Anchoring asset ${assetId} to EigenDA`);

    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) throw new Error('Asset not found');

    // Prepare blob data (simplified JSON for now)
    const blobData = {
        assetId: asset.assetId,
        merkleRoot: asset.cryptography.merkleRoot,
        leaves: asset.cryptography.merkleLeaves,
        metadata: asset.metadata,
        // In real world, include Attestation signature here
    };

    const blobBuffer = Buffer.from(JSON.stringify(blobData));

    // 1. Disperse
    const { requestId } = await this.eigenDAService.disperse(blobBuffer);
    
    // 2. Wait for confirmation
    const blobId = await this.eigenDAService.waitForConfirmation(requestId);

    // 3. Update Asset
    await this.assetModel.updateOne(
        { assetId },
        {
            $set: {
                'eigenDA.blobId': blobId,
                'eigenDA.blobHash': keccak256(toHex(blobBuffer)),
                'eigenDA.dispersedAt': new Date(),
                status: AssetStatus.DA_ANCHORED,
                'checkpoints.daAnchored': true,
            }
        }
    );

    this.logger.log(`Asset ${assetId} anchored to EigenDA. BlobID: ${blobId}`);
    return { blobId };
  }
}
