import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AssetLifecycleService } from '../../assets/services/asset-lifecycle.service';
import { AssetType, CreateAssetDto } from '../../assets/dto/create-asset.dto';
import { User, UserDocument, UserRole } from '../../../database/schemas/user.schema';
import { TypeformWebhookDto } from '../dto/typeform-webhook.dto';

@Injectable()
export class TypeformWebhookService {
  private readonly logger = new Logger(TypeformWebhookService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private assetLifecycleService: AssetLifecycleService,
  ) {}

  async processWebhook(payload: TypeformWebhookDto) {
    this.logger.log(`Processing Typeform webhook: ${payload.event_id}`);

    // 1. Map Typeform fields to asset DTO
    const { dto, walletAddress, fileUrl } = this.mapTypeformToAssetDto(payload.form_response);

    // 2. Download invoice file
    const { buffer, filename, mimetype } = await this.downloadInvoiceFile(fileUrl);

    // 3. Save to temporary storage (mocking Multer file)
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, filename);
    await fs.promises.writeFile(filePath, buffer);

    // 4. Ensure user exists
    await this.ensureOriginatorUser(walletAddress);

    // 5. Create asset
    const multerFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: filename,
      encoding: '7bit',
      mimetype: mimetype,
      buffer: buffer,
      size: buffer.length,
      destination: tempDir,
      filename: filename,
      path: filePath,
      stream: null as any, // Not used
    };

    const result = await this.assetLifecycleService.createAsset(
      walletAddress,
      dto,
      multerFile
    );

    // Cleanup temp file
    // Note: AssetLifecycleService might move it, so we check if it still exists before deleting?
    // The service says: "tempPath: file.path" and then queues hash computation with that path.
    // So we should NOT delete it immediately if the service relies on it existing for the queue job.
    // However, AssetLifecycleService usually moves it to a permanent location or the queue job reads it.
    // Looking at AssetLifecycleService code:
    // await this.assetQueue.add('hash-computation', { assetId, filePath: file.path });
    // So the file must exist for the worker. We should rely on the worker to clean it up or use a periodic cleanup.
    // For now, we leave it there.

    return { assetId: result.assetId };
  }

  private mapTypeformToAssetDto(formResponse: any) {
    const answers = formResponse.answers;
    const findAnswer = (title: string) => {
        // We match by title (case insensitive) or partial match as Typeform titles can vary
        return answers.find((a: any) => {
             // In the plan, it says "field.title" but typically answers have "field: { id: ... }" and definition has titles.
             // The plan's DTO structure shows definition.fields has titles, and answers link to field.id.
             // So we need to look up the title from the definition if we want to be robust, 
             // or assume the answer object has the title populated (Typeform sometimes does this in "enriched" payloads, 
             // but standard payloads might only have field ID).
             
             // However, the provided DTO in the plan shows:
             /*
             answers: Array<{
                field: { id: string; type: string; };
                ...
             }>;
             */
             // It doesn't show title in answer.field.
             
             // So let's look at definition first to find the ID for a given title.
             const fieldDef = formResponse.definition.fields.find((f: any) => 
                f.title.toLowerCase().includes(title.toLowerCase())
             );
             
             if (!fieldDef) return false;
             return a.field.id === fieldDef.id;
        });
    };

    const getValue = (answer: any) => {
        if (!answer) return undefined;
        switch (answer.type) {
            case 'text': return answer.text;
            case 'number': return answer.number?.toString();
            case 'date': return answer.date;
            case 'file_url': return answer.file_url;
            default: return answer.text || answer.number || answer.date;
        }
    };

    const walletAddress = getValue(findAnswer('Wallet Address'));
    const invoiceNumber = getValue(findAnswer('Invoice Number'));
    const faceValue = getValue(findAnswer('Face Value'));
    const currency = getValue(findAnswer('Currency'));
    const issueDate = getValue(findAnswer('Issue Date'));
    const dueDate = getValue(findAnswer('Due Date'));
    const buyerName = getValue(findAnswer('Buyer Name'));
    const industry = getValue(findAnswer('Industry'));
    const riskTier = getValue(findAnswer('Risk Tier'));
    const totalSupply = getValue(findAnswer('Total Supply'));
    const minInvestment = getValue(findAnswer('Min Investment'));
    const fileUrl = getValue(findAnswer('Invoice File'));

    // Asset type and listing parameters
    const assetTypeRaw = getValue(findAnswer('Asset Type'));
    const assetType = (assetTypeRaw?.toUpperCase() === 'STATIC' ? AssetType.STATIC : AssetType.AUCTION);
    const minRaisePercentage = getValue(findAnswer('Min Raise Percentage'));
    const maxRaisePercentage = getValue(findAnswer('Max Raise Percentage'));
    const pricePerToken = getValue(findAnswer('Price Per Token'));
    const auctionDuration = getValue(findAnswer('Auction Duration'));

    // Validate required fields
    if (!walletAddress) throw new BadRequestException('Missing Wallet Address');
    if (!invoiceNumber) throw new BadRequestException('Missing Invoice Number');
    if (!faceValue) throw new BadRequestException('Missing Face Value');
    if (!fileUrl) throw new BadRequestException('Missing Invoice File');

    // Build base DTO
    const dto: CreateAssetDto = {
        invoiceNumber,
        faceValue,
        currency: currency || 'USD',
        issueDate: issueDate || new Date().toISOString(),
        dueDate: dueDate || new Date(Date.now() + 30*24*60*60*1000).toISOString(),
        buyerName: buyerName || 'Unknown Buyer',
        industry: industry || 'General',
        riskTier: riskTier || 'B',
        assetType,
        totalSupply: totalSupply || '100000',
        minInvestment: minInvestment || '100',
        minRaisePercentage: minRaisePercentage || '50', // 50% minimum
    };

    // Add optional max raise percentage
    if (maxRaisePercentage) {
        dto.maxRaisePercentage = maxRaisePercentage;
    }

    // Add type-specific fields
    if (assetType === AssetType.STATIC) {
        // For STATIC: optionally include pricePerToken
        if (pricePerToken) {
            dto.pricePerToken = pricePerToken;
        }
    } else {
        // For AUCTION: auctionDuration is required
        dto.auctionDuration = auctionDuration || (7 * 24 * 60 * 60).toString(); // 7 days default
    }

    return { dto, walletAddress, fileUrl };
  }

  private async downloadInvoiceFile(fileUrl: string) {
    try {
        const response = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'RWA-Platform-Webhook/1.0',
            },
        });

        const contentType = response.headers['content-type'];
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];

        if (!allowedTypes.some(t => contentType.includes(t))) {
            throw new BadRequestException(`Invalid file type: ${contentType}`);
        }

        const buffer = Buffer.from(response.data);
        const ext = this.getExtensionFromMimeType(contentType);
        const filename = `invoice-${Date.now()}.${ext}`;

        return { buffer, filename, mimetype: contentType };
    } catch (error: any) {
        this.logger.error(`Failed to download file: ${error.message}`);
        throw new BadRequestException('Failed to download invoice file');
    }
  }

  private getExtensionFromMimeType(mimeType: string): string {
    if (mimeType.includes('pdf')) return 'pdf';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
    if (mimeType.includes('png')) return 'png';
    return 'bin';
  }

  private async ensureOriginatorUser(walletAddress: string) {
    // Validate format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      throw new BadRequestException('Invalid wallet address format');
    }

    // Find or create
    let user = await this.userModel.findOne({ walletAddress });

    if (!user) {
      this.logger.log(`Creating new originator user for wallet: ${walletAddress}`);
      user = new this.userModel({
        walletAddress,
        role: UserRole.ORIGINATOR,
        kyc: false,
      });
      await user.save();
    }

    return user;
  }

  // Helper for mock Multer file (if needed elsewhere)
  private createMulterFile(filePath: string, filename: string, mimetype: string, size: number): Express.Multer.File {
      return {
          fieldname: 'file',
          originalname: filename,
          encoding: '7bit',
          mimetype,
          buffer: Buffer.alloc(0), // Buffer might be too large to keep in memory if we passed it here, but here we just need interface compliance
          size,
          destination: path.dirname(filePath),
          filename,
          path: filePath,
          stream: null as any,
      };
  }
}
