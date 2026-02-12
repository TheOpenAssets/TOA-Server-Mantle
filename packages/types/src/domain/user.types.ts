import { WalletAddress } from '../blockchain/addresses';

export enum UserRole {
  ORIGINATOR = 'ORIGINATOR',
  INVESTOR = 'INVESTOR',
  ADMIN = 'ADMIN',
}

export type KycStatus = 'PENDING' | 'PROCESSING' | 'VERIFIED' | 'REJECTED';

export interface IKycDocument {
  documentId: string;
  fileUrl: string;
  uploadedAt: Date;
  verifiedAt?: Date;
  verificationScore?: number;
  extractedData?: {
    uid?: string;
    name?: string;
    dob?: string;
    gender?: string;
    address?: {
      careOf?: string;
      locality?: string;
      vtcName?: string;
      district?: string;
      state?: string;
      pincode?: string;
    };
  };
  verificationMeta?: {
    qr1Decoded?: boolean;
    qr2Decoded?: boolean;
    qrDataMatch?: boolean;
    textMatchScore?: number;
  };
  status: KycStatus;
  rejectionReason?: string;
}

export interface IUser {
  walletAddress: WalletAddress;
  role: UserRole;
  kyc: boolean;
  kycDocuments: {
    aadhaar?: IKycDocument;
  };
  createdAt?: Date;
  updatedAt?: Date;
}
