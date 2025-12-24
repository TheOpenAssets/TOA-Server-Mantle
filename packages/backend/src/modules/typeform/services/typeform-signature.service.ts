import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TypeformSignatureService {
  private readonly webhookSecret: string;
  private readonly logger = new Logger(TypeformSignatureService.name);

  constructor(private configService: ConfigService) {
    this.webhookSecret = this.configService.get<string>('TYPEFORM_WEBHOOK_SECRET') || '';
    if (!this.webhookSecret) {
      this.logger.warn('TYPEFORM_WEBHOOK_SECRET not configured. Webhook verification will fail.');
    }
  }

  verifySignature(rawPayload: string, signature: string): boolean {
    if (!signature) {
      return false;
    }

    if (!this.webhookSecret) {
        this.logger.error('Cannot verify signature: TYPEFORM_WEBHOOK_SECRET is missing');
        return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawPayload)
      .digest('base64');

    const expected = `sha256=${expectedSignature}`;

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      );
    } catch {
      return false;
    }
  }
}
