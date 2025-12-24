import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import { DocumentStorageService } from './document-storage.service';

@Injectable()
export class KycService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private storageService: DocumentStorageService,
    @InjectQueue('kyc-verification') private kycQueue: Queue,
  ) {}

  async uploadDocument(user: UserDocument, file: Express.Multer.File) {
    if (user.kyc) {
      throw new BadRequestException('KYC already verified');
    }

    // Check if already processing
    if (user.kycDocuments?.aadhaar?.status === 'PROCESSING' || user.kycDocuments?.aadhaar?.status === 'VERIFIED') {
       throw new BadRequestException('Document already uploaded and processing or verified');
    }

    const documentId = uuidv4();
    const fileUrl = await this.storageService.saveDocument(file, user.walletAddress, documentId);

    // Update User DB
    await this.userModel.updateOne(
      { _id: user._id },
      {
        $set: {
          'kycDocuments.aadhaar': {
            documentId,
            fileUrl,
            uploadedAt: new Date(),
            status: 'PROCESSING',
          },
        },
      },
    );

    // Add to Queue
    await this.kycQueue.add('verify-document', {
      userId: user._id.toString(),
      walletAddress: user.walletAddress,
      fileUrl,
      documentId,
    });

    return {
      documentId,
      status: 'PROCESSING',
      message: 'Document uploaded, verification in progress',
    };
  }

  async getStatus(user: UserDocument) {
    const fullUser = await this.userModel.findById(user._id);
    return {
      kyc: fullUser?.kyc,
      documents: fullUser?.kycDocuments,
    };
  }

  async deleteDocument(user: UserDocument) {
      const fullUser = await this.userModel.findById(user._id);
      const aadhaar = fullUser?.kycDocuments?.aadhaar;

      if (!aadhaar) {
          throw new NotFoundException('No document found');
      }

      if (aadhaar.status === 'VERIFIED') {
          throw new ForbiddenException('Cannot delete verified document');
      }

      // Delete file
      await this.storageService.deleteDocument(aadhaar.fileUrl);

      // Unset in DB
      await this.userModel.updateOne(
          { _id: user._id },
          { $unset: { 'kycDocuments.aadhaar': "" } }
      );

      return { message: 'Document deleted' };
  }

  async getDocument(user: UserDocument) {
    const fullUser = await this.userModel.findById(user._id);
    const aadhaar = fullUser?.kycDocuments?.aadhaar;

    if (!aadhaar) {
      throw new NotFoundException('No document found');
    }

    const filePath = this.storageService.getFullPath(aadhaar.fileUrl);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Document file not found');
    }

    const fileExtension = path.extname(filePath).toLowerCase();
    const contentTypeMap: { [key: string]: string } = {
      '.pdf': 'application/pdf',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
    };

    const contentType = contentTypeMap[fileExtension] || 'application/octet-stream';
    const file = fs.createReadStream(filePath);

    return { file, contentType };
  }

  async manualApprove(user: UserDocument) {
    // TEMPORARY: Manual KYC approval for testing (REMOVE IN PRODUCTION!)
    const fullUser = await this.userModel.findById(user._id);

    if (!fullUser?.kycDocuments?.aadhaar) {
      throw new NotFoundException('No KYC document found');
    }

    await this.userModel.updateOne(
      { _id: user._id },
      {
        $set: {
          kyc: true,
          'kycDocuments.aadhaar.status': 'VERIFIED',
          'kycDocuments.aadhaar.verificationScore': 100,
          'kycDocuments.aadhaar.verifiedAt': new Date(),
          'kycDocuments.aadhaar.verificationMeta.manualApproval': true,
        },
      },
    );

    return {
      message: 'KYC manually approved (testing mode)',
      kyc: true,
      status: 'VERIFIED',
    };
  }
}
