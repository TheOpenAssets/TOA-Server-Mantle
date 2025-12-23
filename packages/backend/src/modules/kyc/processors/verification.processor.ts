import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import { DocumentStorageService } from '../services/document-storage.service';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdf = require('pdf-parse');
import { createWorker } from 'tesseract.js';
import { Jimp } from 'jimp';
import jsQR from 'jsqr';
import { parseStringPromise } from 'xml2js';

@Processor('kyc-verification')
export class VerificationProcessor extends WorkerHost {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private storageService: DocumentStorageService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { userId, fileUrl } = job.data;
    
    try {
        const filePath = this.storageService.getFullPath(fileUrl);
        const dataBuffer = fs.readFileSync(filePath);
        const extension = path.extname(filePath).toLowerCase();

        let extractedText = '';
        let qrData: any = null;
        let qrDecoded = false;

        if (extension === '.pdf') {
            const data = await pdf(dataBuffer);
            extractedText = data.text;
            // PDF doesn't support QR extraction in this flow without system binaries
        } else if (['.jpg', '.jpeg', '.png'].includes(extension)) {
            // 1. Load Image
            const image = await Jimp.read(dataBuffer);
            const { width, height, data: imgData } = image.bitmap;

            // 2. Decode QR
            const code = jsQR(new Uint8ClampedArray(imgData), width, height);
            if (code) {
                qrDecoded = true;
                try {
                    // Aadhaar QR is often XML or Secure QR
                    // If XML, we parse it
                    if (code.data.startsWith('<') && code.data.includes('uid')) {
                         qrData = await parseStringPromise(code.data);
                    } else {
                        // Handle Secure QR (Big Integer) - simplified for now
                        // Just storing raw data if it's not XML
                        qrData = { raw: code.data };
                    }
                } catch (e) {
                    console.error('QR Parse Error', e);
                }
            }

            // 3. OCR Extraction
            const worker = await createWorker('eng');
            const ret = await worker.recognize(filePath);
            extractedText = ret.data.text;
            await worker.terminate();
        }

        // 4. Verification Logic
        let score = 0;
        let qrDataMatch = false;

        // Base Points
        if (extractedText.toLowerCase().includes('aadhaar') || extractedText.toLowerCase().includes('government of india')) {
            score += 30;
        }

        // QR Points
        if (qrDecoded) {
            score += 30;
            
            // Cross-Verify
            if (qrData && qrData.PrintLetterBarcodeData) {
                // XML format: <PrintLetterBarcodeData uid="123..." name="John Doe" ... />
                const attrs = qrData.PrintLetterBarcodeData.$;
                const qrName = attrs.name || '';
                const qrUid = attrs.uid || '';

                // Fuzzy check name in text
                if (extractedText.toLowerCase().includes(qrName.toLowerCase())) {
                    score += 20;
                    qrDataMatch = true;
                }
                
                // Check UID last 4 digits
                if (qrUid && extractedText.includes(qrUid.slice(-4))) {
                    score += 20;
                }
            }
        } else if (extension === '.pdf') {
            // PDF fallback scoring
             if (extractedText.length > 100) score += 20;
        }

        const status = score >= 80 ? 'VERIFIED' : 'REJECTED';
        const kycStatus = score >= 80;

        // 5. Update DB
        await this.userModel.updateOne(
            { _id: userId },
            {
                $set: {
                    kyc: kycStatus,
                    'kycDocuments.aadhaar.status': status,
                    'kycDocuments.aadhaar.verificationScore': score,
                    'kycDocuments.aadhaar.verifiedAt': new Date(),
                    'kycDocuments.aadhaar.verificationMeta': {
                        qr1Decoded: qrDecoded,
                        qrDataMatch: qrDataMatch,
                        textMatchScore: score // Simplified
                    },
                    'kycDocuments.aadhaar.rejectionReason': status === 'REJECTED' ? 'Low verification score' : null
                }
            }
        );

        return { status, score, qrDecoded };

    } catch (e) {
        console.error('Verification Error', e);
        await this.userModel.updateOne(
            { _id: userId },
            {
                $set: {
                    'kycDocuments.aadhaar.status': 'REJECTED',
                    'kycDocuments.aadhaar.rejectionReason': 'Processing Error',
                }
            }
        );
        throw e;
    }
  }
}