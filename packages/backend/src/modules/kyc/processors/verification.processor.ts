import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Logger } from '@nestjs/common';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import { DocumentStorageService } from '../services/document-storage.service';
import { BlockchainService } from '../../blockchain/services/blockchain.service';
import { SolvencyBlockchainService } from '../../solvency/services/solvency-blockchain.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationSeverity } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdf = require('pdf-parse');
// import { createWorker } from 'tesseract.js'; // Temporarily disabled due to webpack bundling issues
import { Jimp } from 'jimp';
import jsQR from 'jsqr';
import { parseStringPromise } from 'xml2js';

@Processor('kyc-verification')
export class VerificationProcessor extends WorkerHost {
  private readonly logger = new Logger(VerificationProcessor.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private storageService: DocumentStorageService,
    private blockchainService: BlockchainService,
    private solvencyBlockchainService: SolvencyBlockchainService,
    private notificationService: NotificationService,
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
            console.log(`[KYC] Loading image: ${filePath}`);
            const image = await Jimp.read(dataBuffer);
            const { width, height, data: imgData } = image.bitmap;
            console.log(`[KYC] Image dimensions: ${width}x${height}`);

            // Try multiple preprocessing and scaling approaches
            const scalesToTry = [1, 1.5, 2, 0.75]; // Different scales
            const preprocessors = [
                (img: typeof image) => img.clone(),
                (img: typeof image) => img.clone().greyscale(),
                (img: typeof image) => img.clone().greyscale().contrast(0.8),
                (img: typeof image) => img.clone().greyscale().normalize().contrast(0.5),
                (img: typeof image) => img.clone().invert(),
            ];

            let foundQR = false;
            let attemptCount = 0;

            for (const scale of scalesToTry) {
                if (foundQR) break;

                for (const preprocessor of preprocessors) {
                    if (foundQR) break;
                    attemptCount++;

                    try {
                        let processedImage = preprocessor(image);

                        // Scale if needed
                        if (scale !== 1) {
                            processedImage = processedImage.scale(scale);
                        }

                        const { width: w, height: h, data: d } = processedImage.bitmap;
                        console.log(`[KYC] Attempt ${attemptCount}: scale=${scale}, size=${w}x${h}`);

                        const code = jsQR(new Uint8ClampedArray(d), w, h, {
                            inversionAttempts: 'attemptBoth',
                        });

                        if (code) {
                            foundQR = true;
                            qrDecoded = true;
                            console.log(`[KYC] ✓ QR Code found! Data length: ${code.data.length}`);
                            console.log(`[KYC] QR Data preview: ${code.data.substring(0, 100)}...`);

                            try {
                                // Aadhaar QR is often XML or Secure QR
                                if (code.data.startsWith('<') && code.data.includes('uid')) {
                                    console.log('[KYC] Parsing XML QR data...');
                                    qrData = await parseStringPromise(code.data);
                                    console.log('[KYC] QR data parsed successfully');
                                } else {
                                    console.log('[KYC] Non-XML QR data - storing raw');
                                    qrData = { raw: code.data };
                                }
                            } catch (e) {
                                console.error('[KYC] QR Parse Error', e);
                            }
                        }
                    } catch (err) {
                        console.log(`[KYC] Attempt ${attemptCount} failed:`, err);
                    }
                }
            }

            if (!foundQR) {
                console.log('[KYC] No QR code detected after all attempts');
            }

            // 3. OCR Extraction - TEMPORARILY DISABLED
            // TODO: Fix tesseract.js webpack bundling issues
            // For now, relying on QR code verification only
            console.log('OCR temporarily disabled - using QR verification only');
            extractedText = ''; // Skip OCR for now
        }

        // 4. Verification Logic (QR-Only Mode)
        let score = 0;
        let qrDataMatch = false;

        // QR-Based Verification (No OCR)
        if (qrDecoded) {
            score += 40; // Base points for successful QR decode

            // Validate QR data structure
            if (qrData && qrData.PrintLetterBarcodeData) {
                // XML format: <PrintLetterBarcodeData uid="123..." name="John Doe" ... />
                const attrs = qrData.PrintLetterBarcodeData.$;
                const qrName = attrs.name || '';
                const qrUid = attrs.uid || '';
                const qrDob = attrs.dob || attrs.yob || '';
                const qrGender = attrs.gender || '';
                const qrCareOf = attrs.careOf || '';
                const qrLocality = attrs.locality || '';
                const qrVtcName = attrs.vtcName || '';
                const qrDistrict = attrs.districtName || '';
                const qrState = attrs.stateName || '';
                const qrPincode = attrs.pincode || '';

                console.log(`[KYC] Extracted QR data: name="${qrName}", uid="${qrUid}", locality="${qrLocality}"`);

                // Validate UID (Aadhaar is 12 chars, may be masked with X's)
                if (qrUid && qrUid.length === 12) {
                    score += 30;
                }

                // Validate has name
                if (qrName && qrName.length > 0) {
                    score += 15;
                    qrDataMatch = true;
                }

                // Validate has address fields (locality, district, state, pincode)
                let addressScore = 0;
                if (qrLocality) addressScore += 3;
                if (qrDistrict) addressScore += 3;
                if (qrState) addressScore += 3;
                if (qrPincode && /^\d{6}$/.test(qrPincode)) addressScore += 6;
                score += addressScore;

                // Validate has careOf (guardian/parent name)
                if (qrCareOf) {
                    score += 5;
                }

                // Optional fields (bonus points if present)
                if (qrDob) score += 5;
                if (qrGender && ['M', 'F', 'Male', 'Female'].includes(qrGender)) score += 2;

                console.log(`[KYC] Verification score breakdown: UID(30) + Name(15) + Address(${addressScore}) + CareOf(${qrCareOf ? 5 : 0}) = ${score}`);
            } else if (qrData && qrData.raw) {
                // Secure QR format - give partial credit
                score += 20;
            }
        } else if (extension === '.pdf') {
            // PDF fallback - basic text check only
            if (extractedText.toLowerCase().includes('aadhaar')) score += 50;
            if (extractedText.length > 100) score += 30;
        } else {
            // No QR found in image
            score = 0;
        }

        // Threshold: 80+ for VERIFIED
        const status = score >= 80 ? 'VERIFIED' : 'REJECTED';
        const kycStatus = score >= 80;

        // Extract QR data for storage (matching schema structure)
        let extractedQRData: any = null;
        if (qrDecoded && qrData && qrData.PrintLetterBarcodeData) {
            const attrs = qrData.PrintLetterBarcodeData.$;
            extractedQRData = {
                uid: attrs.uid || null,
                name: attrs.name || null,
                dob: attrs.dob || attrs.yob || null,
                gender: attrs.gender || null,
                address: {
                    careOf: attrs.careOf || null,
                    locality: attrs.locality || null,
                    vtcName: attrs.vtcName || null,
                    district: attrs.districtName || null,
                    state: attrs.stateName || null,
                    pincode: attrs.pincode || null,
                },
            };
        }

        // 5. Update DB (matching schema field names)
        await this.userModel.updateOne(
            { _id: userId },
            {
                $set: {
                    kyc: kycStatus,
                    'kycDocuments.aadhaar.status': status,
                    'kycDocuments.aadhaar.verificationScore': score,
                    'kycDocuments.aadhaar.verifiedAt': new Date(),
                    'kycDocuments.aadhaar.extractedData': extractedQRData,
                    'kycDocuments.aadhaar.verificationMeta': {
                        qr1Decoded: qrDecoded,
                        qr2Decoded: false,
                        qrDataMatch: qrDataMatch,
                        textMatchScore: score,
                    },
                    'kycDocuments.aadhaar.rejectionReason': status === 'REJECTED' ? 'Low verification score' : null
                }
            }
        );

        // 6. Register investor on blockchain if KYC verified
        if (kycStatus && status === 'VERIFIED') {
            try {
                const user = await this.userModel.findById(userId);
                if (user && user.walletAddress) {
                    this.logger.log(`🔗 Registering investor ${user.walletAddress} on blockchain...`);
                    const txHash = await this.blockchainService.registerIdentity(user.walletAddress);
                    this.logger.log(`✅ Investor registered on blockchain: ${txHash}`);

                    // Check if OAID registration already exists, register if not
                    this.logger.log(`🔍 Checking for existing OAID registration for ${user.walletAddress}...`);
                    const hasOAID = await this.solvencyBlockchainService.hasOAIDCreditLine(user.walletAddress);
                    
                    let oaidTxHash: string | undefined;

                    if (!hasOAID) {
                        try {
                            this.logger.log(`🆔 Registering user in OAID system for ${user.walletAddress}...`);
                            const oaidResult = await this.solvencyBlockchainService.registerUserInOAID(user.walletAddress);
                            oaidTxHash = oaidResult.txHash;
                            this.logger.log(`✅ User registered in OAID system: TX: ${oaidTxHash}`);
                        } catch (oaidError) {
                            this.logger.error(`⚠️ Failed to register user in OAID: ${oaidError}`);
                            // Don't fail the whole operation if OAID registration fails
                        }
                    } else {
                        this.logger.log(`✅ User already registered in OAID system`);
                    }

                    // Send success notification
                    await this.notificationService.create({
                        userId: user.walletAddress,
                        walletAddress: user.walletAddress,
                        header: 'KYC Verified - Ready to Invest!',
                        detail: hasOAID 
                            ? 'Your KYC has been approved and your identity has been registered on-chain. You can now purchase RWA tokens!'
                            : 'Your KYC has been approved, identity registered, and OAID profile created on-chain. You can now purchase RWA tokens and access credit features when you deposit collateral!',
                        type: NotificationType.KYC_STATUS,
                        severity: NotificationSeverity.SUCCESS,
                        action: NotificationAction.VIEW_MARKETPLACE,
                        actionMetadata: {
                            txHash,
                            verificationScore: score,
                            oaidRegistered: !hasOAID,
                            oaidTxHash,
                        },
                    });

                    this.logger.log(`📧 Notification sent to ${user.walletAddress}`);
                }
            } catch (error) {
                this.logger.error(`Failed to register investor on blockchain: ${error}`);
                // Don't fail the whole operation if blockchain registration fails
                // KYC is still approved in database
            }
        }

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