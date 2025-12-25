import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';
import { CreateAssetDto } from '../dto/create-asset.dto';
import { v4 as uuidv4 } from 'uuid';

import { RegisterAssetDto } from '../../blockchain/dto/register-asset.dto';
import { AttestationService } from '../../compliance-engine/services/attestation.service';

@Injectable()
export class AssetLifecycleService {
  private readonly logger = new Logger(AssetLifecycleService.name);

  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectQueue('asset-processing') private assetQueue: Queue,
    private attestationService: AttestationService,
  ) {}

  async getRegisterAssetPayload(assetId: string): Promise<RegisterAssetDto> {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) throw new Error('Asset not found');

    // Convert UUID to bytes32 (remove hyphens and pad to 32 bytes)
    const assetIdBytes32 = '0x' + asset.assetId.replace(/-/g, '').padEnd(64, '0');

    // Mocks for now - in real flow these come from Attestation/EigenDA steps
    return {
        assetId: assetIdBytes32,
        attestationHash: asset.attestation?.hash || '0x' + '0'.repeat(64),
        blobId: asset.eigenDA?.blobId || '0x' + '0'.repeat(64),
        payload: asset.attestation?.payload || '0x',
        signature: asset.attestation?.signature || '0x' + '0'.repeat(130),
    };
  }

  async createAsset(userWallet: string, dto: CreateAssetDto, file: Express.Multer.File) {
    const assetId = uuidv4();
    this.logger.log(`Creating asset ${assetId} for originator ${userWallet}`);

    // Create Asset Record
    const asset = new this.assetModel({
      assetId,
      originator: userWallet,
      status: AssetStatus.UPLOADED,
      metadata: {
        invoiceNumber: dto.invoiceNumber,
        faceValue: dto.faceValue,
        currency: dto.currency,
        issueDate: new Date(dto.issueDate),
        dueDate: new Date(dto.dueDate),
        buyerName: dto.buyerName,
        industry: dto.industry,
        riskTier: dto.riskTier,
      },
      tokenParams: {
        totalSupply: dto.totalSupply,
        pricePerToken: dto.pricePerToken,
        minInvestment: dto.minInvestment,
      },
      files: {
        invoice: {
          tempPath: file.path,
          size: file.size,
          uploadedAt: new Date(),
        },
      },
      checkpoints: {
        uploaded: true,
      },
    });

    await asset.save();

    // Queue Hash Computation
    await this.assetQueue.add('hash-computation', {
      assetId,
      filePath: file.path,
    });

    return {
      assetId,
      status: AssetStatus.UPLOADED,
      message: 'Asset uploaded successfully. Processing started.',
    };
  }

  async getAsset(assetId: string) {
    return this.assetModel.findOne({ assetId });
  }

  async getAssetsByOriginator(originator: string) {
    return this.assetModel.find({ originator });
  }

  async approveAsset(assetId: string, adminWallet: string) {
    this.logger.log(`Asset ${assetId} approved by admin ${adminWallet}`);

    // Get the asset to generate attestation
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new Error('Asset not found');
    }

    // Generate attestation with ECDSA signature
    const attestation = await this.attestationService.generateAttestation(asset, adminWallet);

    // Update asset with attestation and set status to ATTESTED
    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          status: AssetStatus.ATTESTED,
          'checkpoints.attested': true,
          'attestation.payload': attestation.payload,
          'attestation.hash': attestation.hash,
          'attestation.signature': attestation.signature,
          'attestation.attestor': adminWallet,
          'attestation.timestamp': new Date()
        }
      }
    );

    // Queue EigenDA anchoring job
    await this.assetQueue.add('eigenda-anchoring', { assetId });

    this.logger.log(`Asset ${assetId} attested and queued for EigenDA anchoring`);

    return { success: true, assetId, status: AssetStatus.ATTESTED };
  }

  async rejectAsset(assetId: string, reason: string) {
    this.logger.log(`Asset ${assetId} rejected. Reason: ${reason}`);
    return this.assetModel.updateOne(
        { assetId },
        { 
            $set: { 
                status: AssetStatus.REJECTED 
            } 
        }
    );
  }

  async getAllAssets(filters?: {
    status?: AssetStatus;
    originator?: string;
    needsAttention?: boolean;
    page?: number;
    limit?: number;
  }) {
    const query: any = {};

    // Apply status filter
    if (filters?.status) {
      query.status = filters.status;
    }

    // Apply originator filter
    if (filters?.originator) {
      query.originator = filters.originator;
    }

    // Apply "needs attention" filter (assets requiring admin action)
    if (filters?.needsAttention) {
      query.status = {
        $in: [
          AssetStatus.UPLOADED,
          AssetStatus.ATTESTED,
          AssetStatus.REGISTERED,
          AssetStatus.TOKENIZED,
        ],
      };
    }

    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const [assets, total] = await Promise.all([
      this.assetModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.assetModel.countDocuments(query),
    ]);

    return {
      assets,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
