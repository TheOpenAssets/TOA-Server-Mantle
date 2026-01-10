import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { Partner, PartnerDocument, PartnerStatus } from '../../../database/schemas/partner.schema';

@Injectable()
export class PartnerService {
  private readonly logger = new Logger(PartnerService.name);

  constructor(
    @InjectModel(Partner.name) private partnerModel: Model<PartnerDocument>,
  ) {}

  async validateApiKey(apiKey: string): Promise<PartnerDocument | null> {
    try {
      // Hash the incoming API key
      const hashedKey = createHash('sha256').update(apiKey).digest('hex');

      // Find partner by hashed key
      const partner = await this.partnerModel.findOne({ apiKey: hashedKey });

      if (partner) {
        // Update last used timestamp (async, don't wait for it)
        this.partnerModel.updateOne(
          { _id: partner._id },
          { lastUsedAt: new Date() }
        ).exec().catch(err => this.logger.error(`Error updating lastUsedAt: ${err.message}`));
      }

      return partner;
    } catch (error: any) {
      this.logger.error(`API key validation error: ${error.message}`);
      return null;
    }
  }

  generateApiKey(partnerPrefix: string, environment: 'live' | 'sandbox' = 'live'): { apiKey: string; hashedKey: string; prefix: string } {
    // Generate random 32 character string
    const randomHex = randomBytes(16).toString('hex');

    // Format: pk_{partner}_{env}_{random}
    const apiKey = `pk_${partnerPrefix}_${environment}_${randomHex}`;

    // Hash for storage
    const hashedKey = createHash('sha256').update(apiKey).digest('hex');

    // Prefix for identification (first 16 chars)
    const prefix = apiKey.substring(0, 16);

    return { apiKey, hashedKey, prefix };
  }

  async findById(partnerId: string): Promise<PartnerDocument | null> {
    return this.partnerModel.findOne({ partnerId });
  }

  async updateStats(partnerId: string, borrowAmount: bigint, repayAmount: bigint): Promise<void> {
    const update: any = {
      $inc: {
        currentOutstanding: (borrowAmount - repayAmount).toString(),
        totalBorrowed: borrowAmount.toString(),
        totalRepaid: repayAmount.toString(),
      },
    };

    await this.partnerModel.updateOne({ partnerId }, update);
  }

  async createPartner(createDto: any, createdBy: string): Promise<{ partner: Partner; apiKey: string }> {
    const partnerId = `partner_${createDto.partnerPrefix}_${randomBytes(4).toString('hex')}`;
    const { apiKey, hashedKey, prefix } = this.generateApiKey(createDto.partnerPrefix);

    const partner = new this.partnerModel({
      ...createDto,
      partnerId,
      apiKey: hashedKey,
      apiKeyPrefix: prefix,
      createdBy,
      status: PartnerStatus.ACTIVE,
      currentOutstanding: '0',
      totalBorrowed: '0',
      totalRepaid: '0',
    });

    await partner.save();

    return {
      partner,
      apiKey, // Return plaintext once
    };
  }

  async updatePartner(partnerId: string, updateDto: any): Promise<PartnerDocument | null> {
    return this.partnerModel.findOneAndUpdate(
      { partnerId },
      { $set: updateDto },
      { new: true }
    );
  }

  async listPartners(filter: any = {}): Promise<PartnerDocument[]> {
    return this.partnerModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async regenerateApiKey(partnerId: string): Promise<{ apiKey: string } | null> {
    const partner = await this.findById(partnerId);
    if (!partner) return null;

    // Use a generic prefix if we don't have the original one easily, 
    // or extract it from the partnerId if it follows the pattern.
    const prefix = partnerId.split('_')[1] || 'gen';
    const { apiKey, hashedKey, prefix: keyPrefix } = this.generateApiKey(prefix);

    partner.apiKey = hashedKey;
    partner.apiKeyPrefix = keyPrefix;
    await partner.save();

    return { apiKey };
  }
}
