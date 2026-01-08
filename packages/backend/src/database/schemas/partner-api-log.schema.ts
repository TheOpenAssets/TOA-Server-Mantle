import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PartnerApiLogDocument = PartnerApiLog & Document;

@Schema({ timestamps: true })
export class PartnerApiLog {
  @Prop({ required: true, index: true })
  partnerId!: string;

  @Prop({ required: true })
  partnerName!: string;

  // Request Details
  @Prop({ required: true })
  endpoint!: string;                  // "/partners/borrow"

  @Prop({ required: true })
  method!: string;                    // "POST"

  @Prop({ required: true })
  ipAddress!: string;

  @Prop()
  userAgent?: string;

  // Request Data (sanitized - no sensitive info)
  @Prop({ type: Object })
  requestPayload?: any;

  // Response
  @Prop({ required: true })
  statusCode!: number;                // 200, 400, 401, etc.

  @Prop({ required: true })
  responseTime!: number;              // Milliseconds

  @Prop({ required: true })
  success!: boolean;

  @Prop()
  errorMessage?: string;

  // Context
  @Prop()
  userWallet?: string;                // If related to user operation

  @Prop()
  oaidTokenId?: number;

  @Prop()
  loanId?: string;

  // Timestamp
  @Prop({ required: true, index: true })
  timestamp!: Date;
}

export const PartnerApiLogSchema = SchemaFactory.createForClass(PartnerApiLog);

// Additional indexes
PartnerApiLogSchema.index({ partnerId: 1, timestamp: -1 });
PartnerApiLogSchema.index({ success: 1, timestamp: -1 });
