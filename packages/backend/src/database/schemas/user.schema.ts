import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { UserRole, IUser, IKycDocument, KycStatus, WalletAddress } from '@openassets/types';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User implements IUser {
  @Prop({ required: true, unique: true, index: true, type: String })
  walletAddress!: WalletAddress;

  @Prop({ required: true, enum: UserRole, default: UserRole.INVESTOR, type: String })
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
    aadhaar?: IKycDocument;
  };

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
