import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UscEventDocument = UscEvent & Document;

@Schema({ timestamps: true })
export class UscEvent {
  @Prop({ required: true, unique: true, index: true })
  uuid!: string;

  @Prop({ required: true, index: true, lowercase: true })
  walletAddress!: string;

  @Prop({ required: true })
  sourceChain!: string;

  @Prop({ required: true })
  eventType!: string;

  @Prop({ required: true })
  scoreDelta!: number;

  @Prop({ required: true })
  txHash!: string;

  @Prop({ required: true, default: Date.now })
  verifiedAt!: Date;

  @Prop({ required: true })
  blockNumber!: number;
}

export const UscEventSchema = SchemaFactory.createForClass(UscEvent);
