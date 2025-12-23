import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../../database/schemas/user.schema';

@Injectable()
export class OriginatorGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || user.role !== UserRole.ORIGINATOR) {
      throw new ForbiddenException('Only originators can upload assets');
    }
    return true;
  }
}
