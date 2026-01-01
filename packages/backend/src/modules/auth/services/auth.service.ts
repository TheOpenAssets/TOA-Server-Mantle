import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'fs';
import { join } from 'path';
import { User, UserDocument, UserRole } from '../../../database/schemas/user.schema';
import { UserSession, UserSessionDocument } from '../../../database/schemas/session.schema';
import { RedisService } from '../../redis/redis.service';
import { SignatureService } from './signature.service';
import { LoginDto, RefreshDto } from '../dto/auth.dto';

@Injectable()
export class AuthService {
  private approvedAdmins: string[] = [];

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(UserSession.name) private sessionModel: Model<UserSessionDocument>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private redisService: RedisService,
    private signatureService: SignatureService,
  ) {
    // Load approved admins from config file
    try {
      const configPath = join(process.cwd(), 'configs', 'approved_admins.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      this.approvedAdmins = config.admins.map((addr: string) => addr.toLowerCase());
    } catch (error) {
      console.error('Failed to load approved admins config:', error);
      this.approvedAdmins = [];
    }
  }

  /**
   * Check if a wallet address is approved as admin
   */
  private isApprovedAdmin(walletAddress: string): boolean {
    return this.approvedAdmins.includes(walletAddress.toLowerCase());
  }

  async createChallenge(walletAddress: string, role?: UserRole): Promise<{ message: string; nonce: string }> {
    // Validate admin role request
    if (role === UserRole.ADMIN && !this.isApprovedAdmin(walletAddress)) {
      throw new ForbiddenException('Wallet address not authorized for admin role');
    }
    const nonce = uuidv4();
    const message = `Sign this message to authenticate with Mantle RWA Platform.\nNonce: ${nonce}\nTimestamp: ${Date.now()}`;

    // Store nonce and role preference in Redis
    await this.redisService.set(`nonce:${walletAddress}`, nonce, 60);
    if (role) {
      await this.redisService.set(`role:${walletAddress}:${nonce}`, role, 60);
    }

    return { message, nonce };
  }

  async login(loginDto: LoginDto) {
    const { walletAddress, signature, message } = loginDto;

    // 1. Extract Nonce from message
    const nonceMatch = message.match(/Nonce: ([a-f0-9-]+)/);
    if (!nonceMatch) {
      throw new BadRequestException('Invalid message format');
    }
    const nonce = nonceMatch[1];

    // 2. Verify Nonce
    const storedNonce = await this.redisService.get(`nonce:${walletAddress}`);
    if (!storedNonce || storedNonce !== nonce) {
      throw new BadRequestException('Invalid or expired nonce');
    }

    // 2a. Get role preference from Redis (if provided during challenge)
    const rolePreference = await this.redisService.get(`role:${walletAddress}:${nonce}`) as UserRole | null;

    // Clean up nonce and role from Redis
    await this.redisService.del(`nonce:${walletAddress}`);
    if (rolePreference) {
      await this.redisService.del(`role:${walletAddress}:${nonce}`);
    }

    // 3. Verify Signature
    const isValid = await this.signatureService.verifySignature(walletAddress, message, signature);
    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    // 3a. Validate admin role (defense in depth)
    if (rolePreference === UserRole.ADMIN && !this.isApprovedAdmin(walletAddress)) {
      throw new ForbiddenException('Wallet address not authorized for admin role');
    }

    // 4. Find or Create User
    let user = await this.userModel.findOne({ walletAddress });
    if (!user) {
      // Determine final role - only allow ADMIN if wallet is approved
      const finalRole = rolePreference === UserRole.ADMIN && this.isApprovedAdmin(walletAddress)
        ? UserRole.ADMIN
        : (rolePreference === UserRole.ORIGINATOR ? UserRole.ORIGINATOR : UserRole.INVESTOR);

      user = await this.userModel.create({
        walletAddress,
        role: finalRole,
        kyc: false,
      });
    }

    // 5. Generate Tokens
    return this.generateTokens(user);
  }

  async refresh(refreshDto: RefreshDto) {
    const { refreshToken } = refreshDto;

    try {
      // 1. Verify Refresh Token Signature
      const payload = this.jwtService.verify(refreshToken);
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      // 2. Find User and Session
      const user = await this.userModel.findById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      const session = await this.sessionModel.findOne({ user: user._id });
      if (!session) {
          throw new UnauthorizedException('Session not found');
      }

      // 3. Verify against MongoDB Session
      if (
        !session.currentRefreshToken ||
        session.currentRefreshToken.jti !== payload.jti ||
        new Date(session.currentRefreshToken.exp).getTime() < Date.now()
      ) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      // 4. Invalidate old access token if active
      const activeAccessTokenJti = await this.redisService.get(`session:active:${user.walletAddress}`);
      if (activeAccessTokenJti) {
        await this.redisService.del(`access:${user.walletAddress}:${activeAccessTokenJti}`);
      }

      // 5. Generate NEW tokens and rotate session
      const tokens = await this.generateTokens(user);
      return {
        accessToken: tokens.tokens.access,
        refreshToken: tokens.tokens.refresh,
      };

    } catch (e) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(user: UserDocument) {
      // Clear Redis session
      const activeAccessTokenJti = await this.redisService.get(`session:active:${user.walletAddress}`);
      if (activeAccessTokenJti) {
          await this.redisService.del(`access:${user.walletAddress}:${activeAccessTokenJti}`);
          await this.redisService.del(`session:active:${user.walletAddress}`);
      }
      
      // Clear MongoDB Refresh Token in UserSession
      const session = await this.sessionModel.findOne({ user: user._id });
      if (session) {
          await this.sessionModel.updateOne(
              { user: user._id },
              { 
                  $unset: { currentRefreshToken: "" },
                  $push: {
                      sessionHistory: {
                          refreshTokenId: session.currentRefreshToken?.jti,
                          createdAt: session.currentRefreshToken?.issuedAt,
                          revokedAt: new Date(),
                          ipAddress: 'unknown'
                      }
                  }
               }
          );
      }
  }

  private async generateTokens(user: UserDocument) {
    const accessJti = uuidv4();
    const refreshJti = uuidv4();
    const deviceHash = 'unknown';

    const accessTokenExpiresIn = parseInt(this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRES_IN', '900'));

    const accessPayload = {
      sub: user._id,
      wallet: user.walletAddress,
      role: user.role,
      kyc: user.kyc,
      jti: accessJti,
    };

    const refreshPayload = {
      sub: user._id,
      wallet: user.walletAddress,
      type: 'refresh',
      jti: refreshJti,
      deviceHash,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, { expiresIn: accessTokenExpiresIn }),
      this.jwtService.signAsync(refreshPayload, { expiresIn: '7d' }),
    ]);

    // Store Access Token in Redis
    await this.redisService.set(
      `access:${user.walletAddress}:${accessJti}`,
      JSON.stringify({ userId: user._id, jti: accessJti, wallet: user.walletAddress }),
      accessTokenExpiresIn
    );
    await this.redisService.set(`session:active:${user.walletAddress}`, accessJti, accessTokenExpiresIn);

    // Store Refresh Token in MongoDB UserSession
    // Upsert session document
    await this.sessionModel.updateOne(
      { user: user._id },
      {
        $set: {
          user: user._id,
          walletAddress: user.walletAddress,
          currentRefreshToken: {
            jti: refreshJti,
            exp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            deviceHash,
            issuedAt: new Date(),
          },
        },
        $push: {
            sessionHistory: {
                refreshTokenId: refreshJti,
                createdAt: new Date(),
            }
        }
      },
      { upsert: true }
    );

    return {
      user: {
        id: user._id,
        walletAddress: user.walletAddress,
        role: user.role,
        kyc: user.kyc,
        createdAt: user.createdAt,
      },
      tokens: {
        access: accessToken,
        refresh: refreshToken,
      },
    };
  }
}
