import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import { Model } from 'mongoose';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private redisService: RedisService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'secret', // Default for dev
    });
  }

  async validate(payload: any) {
    // Check Redis for access token existence
    const key = `access:${payload.wallet}:${payload.jti}`;
    const tokenData = await this.redisService.get(key);

    if (!tokenData) {
      throw new UnauthorizedException('Token revoked or expired');
    }

    // Optional: Fetch fresh user data from DB if needed, or just return payload
    // For "me" endpoint and guards, payload is often enough, but let's return the user document for convenience
    // or a partial object.
    // The plan says "Inject user into request". 
    // Let's verify the user still exists in DB?
    
    return { 
        _id: payload.sub, 
        walletAddress: payload.wallet, 
        role: payload.role, 
        kyc: payload.kyc,
        jti: payload.jti
    };
  }
}
