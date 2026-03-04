import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { NetworkType } from '@openassets/types';
import { User } from './user.schema';

export type UserSessionDocument = UserSession & Document;

@Schema({ timestamps: true })
export class UserSession {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user!: Types.ObjectId;

  @Prop({ required: true, index: true })
  walletAddress!: string;

  @Prop({ required: true, enum: NetworkType, index: true, type: String })
  network!: NetworkType;

  @Prop({
    type: {
      jti: String,
      exp: Date,
      deviceHash: String,
      issuedAt: Date,
    },
  })
  currentRefreshToken?: {
    jti: string;
    exp: Date;
    deviceHash: string;
    issuedAt: Date;
  };

  @Prop([
    {
      refreshTokenId: String,
      createdAt: Date,
      revokedAt: Date,
      ipAddress: String,
    },
  ])
  sessionHistory!: {
    refreshTokenId: string;
    createdAt: Date;
    revokedAt?: Date;
    ipAddress?: string;
  }[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSessionSchema = SchemaFactory.createForClass(UserSession);

// Composite unique indexes
UserSessionSchema.index({ user: 1, network: 1 }, { unique: true });
UserSessionSchema.index({ walletAddress: 1, network: 1 }, { unique: true });
