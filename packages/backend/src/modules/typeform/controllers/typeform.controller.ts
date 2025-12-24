import { Controller, Post, Req, Headers, Body, UnauthorizedException, Logger } from '@nestjs/common';
import { Request } from 'express';
import { TypeformWebhookService } from '../services/typeform-webhook.service';
import { TypeformSignatureService } from '../services/typeform-signature.service';
import { TypeformWebhookDto } from '../dto/typeform-webhook.dto';

interface RawBodyRequest extends Request {
  rawBody?: string;
}

@Controller('webhooks')
export class TypeformController {
  private readonly logger = new Logger(TypeformController.name);

  constructor(
    private typeformWebhookService: TypeformWebhookService,
    private signatureService: TypeformSignatureService,
  ) {}

  @Post('typeform')
  async handleWebhook(
    @Req() req: RawBodyRequest,
    @Headers('typeform-signature') signature: string,
    @Body() payload: TypeformWebhookDto,
  ) {
    // 1. Verify signature
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error('Raw body missing. Ensure middleware is configured.');
      throw new UnauthorizedException('Raw body required for verification');
    }

    if (!this.signatureService.verifySignature(rawBody, signature)) {
      this.logger.warn(`Invalid signature for event ${payload.event_id}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // 2. Process webhook
    try {
      const result = await this.typeformWebhookService.processWebhook(payload);

      this.logger.log(`[Typeform Webhook] Success for event ${payload.event_id}, assetId: ${result.assetId}`);

      return {
        success: true,
        assetId: result.assetId,
        message: 'Webhook processed successfully',
      };
    } catch (error: any) {
      // Log error but return 200 (Typeform will retry on non-200, but we might want to avoid infinite retries on bad data)
      // If it's a BadRequest (validation/mapping error), we probably shouldn't retry.
      // If it's a network/db error, we should let Typeform retry.
      // For now, per plan, we return failure but might log it as error.
      // However, if we return non-200, Typeform retries.
      
      this.logger.error(`[Typeform Webhook] Error for event ${payload.event_id}: ${error.message}`, error.stack);

      return {
        success: false,
        error: error.message,
      };
    }
  }
}
