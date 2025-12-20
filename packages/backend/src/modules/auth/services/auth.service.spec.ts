import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { RedisService } from '../../redis/redis.service';
import { SignatureService } from './signature.service';
import { User, UserRole } from '../../../database/schemas/user.schema';
import { UserSession } from '../../../database/schemas/session.schema';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Model } from 'mongoose';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: DeepMockProxy<JwtService>;
  let redisService: DeepMockProxy<RedisService>;
  let signatureService: DeepMockProxy<SignatureService>;
  let userModel: DeepMockProxy<Model<User>>;
  let sessionModel: DeepMockProxy<Model<UserSession>>;

  const mockUser = {
    _id: 'user123',
    walletAddress: '0x123',
    role: UserRole.INVESTOR,
    kyc: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jwtService = mockDeep<JwtService>();
    redisService = mockDeep<RedisService>();
    signatureService = mockDeep<SignatureService>();
    userModel = mockDeep<Model<User>>();
    sessionModel = mockDeep<Model<UserSession>>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: RedisService, useValue: redisService },
        { provide: SignatureService, useValue: signatureService },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(UserSession.name), useValue: sessionModel },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createChallenge', () => {
    it('should generate a message and nonce', async () => {
      const result = await service.createChallenge('0x123');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('nonce');
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('nonce:0x123'),
        expect.any(String),
        60,
      );
    });
  });

  describe('login', () => {
    const loginDto = {
      walletAddress: '0x123',
      signature: '0xsignature',
      message: 'Sign this message...\nNonce: 12345678-1234-1234-1234-123456789abc',
    };

    it('should throw BadRequestException if nonce is invalid', async () => {
      (redisService.get as any).mockResolvedValue(null);
      await expect(service.login(loginDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw UnauthorizedException if signature is invalid', async () => {
      (redisService.get as any).mockResolvedValue('12345678-1234-1234-1234-123456789abc');
      (signatureService.verifySignature as any).mockResolvedValue(false);
      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should return tokens on successful login', async () => {
      (redisService.get as any).mockResolvedValue('12345678-1234-1234-1234-123456789abc');
      (signatureService.verifySignature as any).mockResolvedValue(true);
      (userModel.findOne as any).mockResolvedValue(mockUser as any);
      
      (jwtService.signAsync as any).mockResolvedValue('token');
      (sessionModel.updateOne as any).mockResolvedValue({} as any);

      const result = await service.login(loginDto);
      
      expect(result).toHaveProperty('tokens');
      expect(result.tokens).toHaveProperty('access', 'token');
      expect(result.tokens).toHaveProperty('refresh', 'token');
      expect(redisService.set).toHaveBeenCalled();
      expect(sessionModel.updateOne).toHaveBeenCalled();
    });
  });
});