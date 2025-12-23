import { Test, TestingModule } from '@nestjs/testing';
import { KycService } from './kyc.service';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { DocumentStorageService } from './document-storage.service';
import { User } from '../../../database/schemas/user.schema';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Model } from 'mongoose';
import { Queue } from 'bullmq';

describe('KycService', () => {
  let service: KycService;
  let userModel: DeepMockProxy<Model<User>>;
  let storageService: DeepMockProxy<DocumentStorageService>;
  let kycQueue: DeepMockProxy<Queue>;

  const mockUser = {
    _id: 'user123',
    walletAddress: '0x123',
    kyc: false,
    kycDocuments: {},
  };

  beforeEach(async () => {
    userModel = mockDeep<Model<User>>();
    storageService = mockDeep<DocumentStorageService>();
    kycQueue = mockDeep<Queue>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: DocumentStorageService, useValue: storageService },
        { provide: getQueueToken('kyc-verification'), useValue: kycQueue },
      ],
    }).compile();

    service = module.get<KycService>(KycService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadDocument', () => {
    const mockFile = {
      buffer: Buffer.from('test'),
      originalname: 'test.pdf',
    } as Express.Multer.File;

    it('should throw BadRequestException if KYC is already verified', async () => {
      const user = { ...mockUser, kyc: true } as any;
      await expect(service.uploadDocument(user, mockFile)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if document is already processing', async () => {
        const user = { 
            ...mockUser, 
            kycDocuments: { aadhaar: { status: 'PROCESSING' } } 
        } as any;
        await expect(service.uploadDocument(user, mockFile)).rejects.toThrow(BadRequestException);
    });

    it('should upload document and add to queue', async () => {
      (storageService.saveDocument as any).mockResolvedValue('file://test-url');
      (userModel.updateOne as any).mockResolvedValue({} as any);
      (kycQueue.add as any).mockResolvedValue({} as any);

      const result = await service.uploadDocument(mockUser as any, mockFile);

      expect(result.status).toBe('PROCESSING');
      expect(storageService.saveDocument).toHaveBeenCalled();
      expect(kycQueue.add).toHaveBeenCalledWith('verify-document', expect.any(Object));
    });
  });

  describe('getStatus', () => {
    it('should return user kyc status and documents', async () => {
      (userModel.findById as any).mockResolvedValue(mockUser);
      const result = await service.getStatus(mockUser as any);
      expect(result).toHaveProperty('kyc', false);
      expect(result).toHaveProperty('documents');
    });
  });

  describe('deleteDocument', () => {
    it('should throw NotFoundException if no document exists', async () => {
      (userModel.findById as any).mockResolvedValue(mockUser);
      await expect(service.deleteDocument(mockUser as any)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if document is already verified', async () => {
      const userWithVerified = {
          ...mockUser,
          kycDocuments: { aadhaar: { status: 'VERIFIED', fileUrl: 'file://...' } }
      };
      (userModel.findById as any).mockResolvedValue(userWithVerified);
      await expect(service.deleteDocument(mockUser as any)).rejects.toThrow(ForbiddenException);
    });

    it('should delete document and update DB', async () => {
        const userWithDoc = {
            ...mockUser,
            kycDocuments: { aadhaar: { status: 'REJECTED', fileUrl: 'file://...' } }
        };
        (userModel.findById as any).mockResolvedValue(userWithDoc);
        (storageService.deleteDocument as any).mockResolvedValue(undefined);
        (userModel.updateOne as any).mockResolvedValue({} as any);

        const result = await service.deleteDocument(mockUser as any);
        expect(result.message).toBe('Document deleted');
        expect(storageService.deleteDocument).toHaveBeenCalled();
        expect(userModel.updateOne).toHaveBeenCalled();
    });
  });
});
