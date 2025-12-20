import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class KycAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
        // Should have been caught by JwtAuthGuard, but safety check
        return false;
    }

    if (!user.kyc) {
      throw new ForbiddenException({
        error: 'KYC_REQUIRED',
        message: 'KYC verification required for this action',
        kycStatus: 'PENDING' // or false
      });
    }

    return true;
  }
}
