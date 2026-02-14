import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { RedisService } from '../../redis/redis.service';
import { SignatureService } from './signature.service';
import { User } from '../../../database/schemas/user.schema';
import { UserRole } from '@openassets/types';
import { UserSession } from '../../../database/schemas/session.schema';
import { BadRequestException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { NetworkType } from '../utils/wallet.util';

describe('AuthService Multi-Network', () => {
  let service: AuthService;
  let jwtService: DeepMockProxy<JwtService>;
  let redisService: DeepMockProxy<RedisService>;
  let signatureService: DeepMockProxy<SignatureService>;
  let userModel: DeepMockProxy<Model<User>>;
  let sessionModel: DeepMockProxy<Model<UserSession>>;
  let configService: DeepMockProxy<ConfigService>;

  const evmAddress = '0x23e67597f0898f747Fa3291C8920168adF9455D0';
  const normalizedEvmAddress = evmAddress.toLowerCase();
  const stellarAddress = 'gcyhvco3g7i6vjus5frwaukyocaffteyriys3cqehr5alxy2wp736isq';
  const normalizedStellarAddress = stellarAddress.toUpperCase();

  beforeEach(async () => {
    jwtService = mockDeep<JwtService>();
    redisService = mockDeep<RedisService>();
    signatureService = mockDeep<SignatureService>();
    userModel = mockDeep<Model<User>>();
    sessionModel = mockDeep<Model<UserSession>>();
    configService = mockDeep<ConfigService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: RedisService, useValue: redisService },
        { provide: SignatureService, useValue: signatureService },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(UserSession.name), useValue: sessionModel },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('Address Normalization', () => {
    it('should normalize EVM addresses to lowercase in createChallenge', async () => {
      await service.createChallenge(evmAddress);
      expect(redisService.set).toHaveBeenCalledWith(
        `nonce:${normalizedEvmAddress}`,
        expect.any(String),
        60,
      );
    });

    it('should normalize Stellar addresses to uppercase in createChallenge', async () => {
      await service.createChallenge(stellarAddress);
      expect(redisService.set).toHaveBeenCalledWith(
        `nonce:${normalizedStellarAddress}`,
        expect.any(String),
        60,
      );
    });
  });

  describe('JWT Network Field', () => {
    it('should include network: mantle for EVM wallets', async () => {
      const mockUser = {
        _id: 'user123',
        walletAddress: normalizedEvmAddress,
        role: UserRole.INVESTOR,
        kyc: false,
      } as any;

      (jwtService.signAsync as any).mockResolvedValue('token');

      // @ts-ignore - accessing private method for testing
      await service.generateTokens(mockUser);

      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          network: NetworkType.MANTLE,
          wallet: normalizedEvmAddress,
        }),
        expect.any(Object),
      );
    });

    it('should include network: stellar for Stellar wallets', async () => {
      const mockUser = {
        _id: 'user123',
        walletAddress: normalizedStellarAddress,
        role: UserRole.INVESTOR,
        kyc: false,
      } as any;

      (jwtService.signAsync as any).mockResolvedValue('token');

      // @ts-ignore - accessing private method for testing
      await service.generateTokens(mockUser);

      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          network: NetworkType.STELLAR,
          wallet: normalizedStellarAddress,
        }),
        expect.any(Object),
      );
    });
  });

  describe('Login with Normalization', () => {
    it('should find user with normalized address even if submitted in different case', async () => {
      const nonce = '123456';
      const loginDto = {
        walletAddress: evmAddress, // Mixed case
        signature: 'sig',
        message: `Nonce: ${nonce}`,
      };

      (redisService.get as any).mockResolvedValue(nonce);
      (signatureService.verifySignature as any).mockResolvedValue(true);
      (userModel.findOne as any).mockResolvedValue({
        _id: 'user123',
        walletAddress: normalizedEvmAddress,
        role: UserRole.INVESTOR,
        kyc: false,
      });

      await service.login(loginDto);

      expect(userModel.findOne).toHaveBeenCalledWith({
        walletAddress: normalizedEvmAddress,
      });
    });
  });
});
