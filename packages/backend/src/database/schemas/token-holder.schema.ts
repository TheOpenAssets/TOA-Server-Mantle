import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TokenHolderDocument = TokenHolder & Document;

@Schema({ timestamps: true })
export class TokenHolder {
  @Prop({ required: true, index: true })
  tokenAddress!: string;

  @Prop({ required: true, index: true })
  holderAddress!: string;

  @Prop({ required: true })
  balance!: string; // Store as string to handle BigInt

  @Prop()
  lastUpdated?: Date;
}

export const TokenHolderSchema = SchemaFactory.createForClass(TokenHolder);