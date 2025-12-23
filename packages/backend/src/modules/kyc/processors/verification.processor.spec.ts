import { Test, TestingModule } from '@nestjs/testing';
import { VerificationProcessor } from './verification.processor';
import { getModelToken } from '@nestjs/mongoose';
import { DocumentStorageService } from '../services/document-storage.service';
import { User } from '../../../database/schemas/user.schema';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Model } from 'mongoose';
import * as fs from 'fs';
import { Job } from 'bullmq';

// Mock heavy external libraries
jest.mock('pdf-parse', () => jest.fn());
const mockTesseractWorker = {
  recognize: jest.fn().mockResolvedValue({ data: { text: 'Aadhaar Government of India John Doe 4701' } }),
  terminate: jest.fn(),
};
jest.mock('tesseract.js', () => ({
  createWorker: jest.fn(() => Promise.resolve(mockTesseractWorker)),
}));
jest.mock('jimp', () => ({
  Jimp: {
    read: jest.fn().mockResolvedValue({
      bitmap: { width: 100, height: 100, data: Buffer.from([]) },
    }),
  },
}));
jest.mock('jsqr', () => jest.fn());
jest.mock('xml2js', () => ({
  parseStringPromise: jest.fn(),
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(),
}));

describe('VerificationProcessor', () => {
  let processor: VerificationProcessor;
  let userModel: DeepMockProxy<Model<User>>;
  let storageService: DeepMockProxy<DocumentStorageService>;

  beforeEach(async () => {
    userModel = mockDeep<Model<User>>();
    storageService = mockDeep<DocumentStorageService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationProcessor,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: DocumentStorageService, useValue: storageService },
      ],
    }).compile();

    processor = module.get<VerificationProcessor>(VerificationProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process', () => {
    const mockJob = {
      data: {
        userId: 'user123',
        fileUrl: 'file://kyc-documents/0x123/doc.jpg',
        documentId: 'doc123',
      },
    } as Job;

    it('should successfully verify an Aadhaar image with QR and OCR', async () => {
      (storageService.getFullPath as any).mockReturnValue('/absolute/path/doc.jpg');
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('fake-data'));
      
      const jsQR = require('jsqr');
      jsQR.mockReturnValue({ data: '<PrintLetterBarcodeData uid="123456784701" name="John Doe"/>' });
      
      const { parseStringPromise } = require('xml2js');
      parseStringPromise.mockResolvedValue({
        PrintLetterBarcodeData: { $: { uid: '123456784701', name: 'John Doe' } }
      });

      (userModel.updateOne as any).mockResolvedValue({} as any);

      const result = await processor.process(mockJob);

      expect(result.status).toBe('VERIFIED');
      expect(result.score).toBeGreaterThanOrEqual(80);
      expect(userModel.updateOne).toHaveBeenCalledWith(
        { _id: 'user123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            kyc: true,
            'kycDocuments.aadhaar.status': 'VERIFIED'
          })
        })
      );
    });

    it('should reject if keywords and QR are missing', async () => {
        (storageService.getFullPath as any).mockReturnValue('/absolute/path/doc.jpg');
        (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('fake-data'));
        
        const jsQR = require('jsqr');
        jsQR.mockReturnValue(null); // No QR
        
        mockTesseractWorker.recognize.mockResolvedValue({ data: { text: 'random text nothing useful' } });

        const result = await processor.process(mockJob);

        expect(result.status).toBe('REJECTED');
        expect(userModel.updateOne).toHaveBeenCalledWith(
            { _id: 'user123' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    kyc: false,
                    'kycDocuments.aadhaar.status': 'REJECTED'
                })
            })
        );
    });
  });
});
