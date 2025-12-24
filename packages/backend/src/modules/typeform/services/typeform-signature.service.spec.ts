import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { TypeformSignatureService } from './typeform-signature.service';

describe('TypeformSignatureService', () => {
  let service: TypeformSignatureService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TypeformSignatureService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-secret'),
          },
        },
      ],
    }).compile();

    service = module.get<TypeformSignatureService>(TypeformSignatureService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should verify valid signature', () => {
    const payload = '{"event_id":"test"}';
    const secret = 'test-secret';
    const signature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64');

    expect(service.verifySignature(payload, `sha256=${signature}`)).toBe(true);
  });

  it('should reject invalid signature', () => {
    expect(service.verifySignature('{}', 'invalid')).toBe(false);
  });
});
