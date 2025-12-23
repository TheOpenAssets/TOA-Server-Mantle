import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  ORIGINATOR = 'ORIGINATOR',
  INVESTOR = 'INVESTOR',
  ADMIN = 'ADMIN',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true })
  walletAddress!: string;

  @Prop({ required: true, enum: UserRole, default: UserRole.INVESTOR })
  role!: UserRole;

  @Prop({ required: true, default: false })
  kyc!: boolean;

  @Prop({
    type: {
      aadhaar: {
        documentId: String,
        fileUrl: String,
        uploadedAt: Date,
        verifiedAt: Date,
        verificationScore: Number,
        extractedData: {
          uid: String,
          name: String,
          dob: String,
          gender: String,
          address: {
            careOf: String,
            locality: String,
            vtcName: String,
            district: String,
            state: String,
            pincode: String,
          },
        },
        verificationMeta: {
          qr1Decoded: Boolean,
          qr2Decoded: Boolean,
          qrDataMatch: Boolean,
          textMatchScore: Number,
        },
        status: {
          type: String,
          enum: ['PENDING', 'PROCESSING', 'VERIFIED', 'REJECTED'],
          default: 'PENDING',
        },
        rejectionReason: String,
      },
    },
    default: {},
  })
  kycDocuments!: {
    aadhaar?: {
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
      status: 'PENDING' | 'PROCESSING' | 'VERIFIED' | 'REJECTED';
      rejectionReason?: string;
    };
  };

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
