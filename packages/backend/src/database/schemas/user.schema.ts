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

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
