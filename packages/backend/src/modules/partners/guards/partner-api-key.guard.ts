import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PartnerService } from '../services/partner.service';
import { PartnerStatus } from '../../../database/schemas/partner.schema';

@Injectable()
export class PartnerApiKeyGuard implements CanActivate {
  constructor(private partnerService: PartnerService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Extract API key from header
    // Format: "Authorization: Bearer pk_xyz_live_..."
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid API key format');
    }

    const apiKey = authHeader.substring(7);

    // Validate API key
    const partner = await this.partnerService.validateApiKey(apiKey);
    if (!partner) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Check partner status
    if (partner.status !== PartnerStatus.ACTIVE) {
      throw new ForbiddenException(`Partner account is ${partner.status.toLowerCase()}`);
    }

    // Attach partner to request for use in controllers
    request.partner = partner;

    return true;
  }
}
