# Partner Integration Testing Guide

**Version:** 1.0
**Date:** 2026-01-05
**Status:** Ready for Implementation

---

## Table of Contents

1. [Testing Overview](#testing-overview)
2. [Prerequisites](#prerequisites)
3. [Unit Testing](#unit-testing)
4. [Integration Testing](#integration-testing)
5. [Manual Testing Guide](#manual-testing-guide)
6. [Load Testing](#load-testing)
7. [Security Testing](#security-testing)
8. [Test Data Setup](#test-data-setup)
9. [CI/CD Integration](#cicd-integration)

---

## Testing Overview

### Testing Pyramid

```
        ┌─────────────────┐
        │   Load Tests    │ ← k6 (50-100 virtual users)
        └─────────────────┘
       ┌───────────────────┐
       │  E2E/Integration  │ ← Supertest (Full flow scenarios)
       └───────────────────┘
     ┌─────────────────────┐
     │    Unit Tests       │ ← Jest (Services, Guards, Controllers)
     └─────────────────────┘
```

### Coverage Goals

- **Unit Tests:** 80%+ coverage
- **Integration Tests:** All critical user flows
- **Load Tests:** Baseline performance metrics
- **Security Tests:** OWASP Top 10 validation

---

## Prerequisites

### Environment Setup

```bash
# Install dependencies
cd packages/backend
npm install

# Set up test environment variables
cp .env.example .env.test
```

### Test Environment Variables

Create `/packages/backend/.env.test`:

```bash
# MongoDB (use separate test database)
MONGODB_URI=mongodb://localhost:27017/mantle-rwa-test

# Blockchain
RPC_URL=https://rpc.sepolia.mantle.xyz
DEPLOYER_KEY=0x... # Test wallet with no real funds
SOLVENCY_VAULT_ADDRESS=0x...
SENIOR_POOL_ADDRESS=0x...
OAID_ADDRESS=0x...
USDC_ADDRESS=0x...

# JWT
JWT_SECRET=test-secret-key
JWT_EXPIRY=1h
JWT_REFRESH_EXPIRY=7d

# Redis (optional for rate limiting tests)
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Test Utilities

Create test helper file at `/packages/backend/src/test-utils/test-helpers.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Model } from 'mongoose';

/**
 * Create a mock Mongoose model
 */
export function createMockModel<T>(): DeepMockProxy<Model<T>> {
  return mockDeep<Model<T>>();
}

/**
 * Generate a random Ethereum address
 */
export function randomAddress(): string {
  return '0x' + Array.from({ length: 40 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

/**
 * Generate a random API key
 */
export function generateTestApiKey(prefix: string = 'xyz'): string {
  const random = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  return `pk_${prefix}_live_${random}`;
}

/**
 * Hash API key for storage (SHA-256)
 */
export function hashApiKey(apiKey: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Create mock partner data
 */
export function createMockPartner(overrides = {}) {
  const apiKey = generateTestApiKey();
  return {
    _id: 'partner_mongo_id_123',
    partnerId: 'partner_xyz_001',
    partnerName: 'XYZ Lending',
    apiKey: hashApiKey(apiKey),
    apiKeyPrefix: 'pk_xyz_live_',
    status: 'ACTIVE',
    tier: 'PREMIUM',
    dailyBorrowLimit: '100000000000', // $100k
    totalBorrowLimit: '500000000000', // $500k
    currentOutstanding: '0',
    platformFeePercentage: 50,
    settlementAddress: randomAddress(),
    contactEmail: 'test@example.com',
    createdBy: randomAddress(),
    totalBorrowed: '0',
    totalRepaid: '0',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    plainApiKey: apiKey, // Only for testing
  };
}

/**
 * Create mock partner loan data
 */
export function createMockPartnerLoan(overrides = {}) {
  return {
    _id: 'loan_mongo_id_123',
    partnerLoanId: 'xyz_loan_001',
    internalLoanId: 'uuid-internal-001',
    partnerId: 'partner_xyz_001',
    partnerName: 'XYZ Lending',
    userWallet: randomAddress(),
    oaidTokenId: 123,
    solvencyPositionId: 42,
    principalAmount: '5000000000', // $5000
    remainingDebt: '5000000000',
    interestRate: 0,
    borrowedAt: new Date(),
    totalRepaid: '0',
    repaymentHistory: [],
    status: 'ACTIVE',
    platformFeeCharged: '25000000', // 0.5% of $5000
    platformFeePaid: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
```

---

## Unit Testing

### 1. Partner Service Tests

**File:** `/packages/backend/src/modules/partners/services/partner.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PartnerService } from './partner.service';
import { getModelToken } from '@nestjs/mongoose';
import { Partner } from '../../../database/schemas/partner.schema';
import { PartnerApiLog } from '../../../database/schemas/partner-api-log.schema';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Model } from 'mongoose';
import { createMockModel, createMockPartner, hashApiKey } from '../../../test-utils/test-helpers';

describe('PartnerService', () => {
  let service: PartnerService;
  let partnerModel: DeepMockProxy<Model<Partner>>;
  let apiLogModel: DeepMockProxy<Model<PartnerApiLog>>;

  beforeEach(async () => {
    partnerModel = createMockModel<Partner>();
    apiLogModel = createMockModel<PartnerApiLog>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartnerService,
        { provide: getModelToken(Partner.name), useValue: partnerModel },
        { provide: getModelToken(PartnerApiLog.name), useValue: apiLogModel },
      ],
    }).compile();

    service = module.get<PartnerService>(PartnerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateApiKey', () => {
    it('should return null for invalid API key', async () => {
      (partnerModel.findOne as any).mockResolvedValue(null);

      const result = await service.validateApiKey('pk_invalid_key');

      expect(result).toBeNull();
      expect(partnerModel.findOne).toHaveBeenCalledWith({
        apiKey: expect.any(String), // hashed version
      });
    });

    it('should return partner for valid API key', async () => {
      const mockPartner = createMockPartner();
      const saveMock = jest.fn().mockResolvedValue(mockPartner);
      (partnerModel.findOne as any).mockResolvedValue({
        ...mockPartner,
        save: saveMock,
      });

      const result = await service.validateApiKey(mockPartner.plainApiKey);

      expect(result).toBeDefined();
      expect(result.partnerId).toBe('partner_xyz_001');
      expect(saveMock).toHaveBeenCalled(); // lastUsedAt updated
    });

    it('should hash API key before database lookup', async () => {
      (partnerModel.findOne as any).mockResolvedValue(null);
      const apiKey = 'pk_test_live_12345678901234567890123456789012';

      await service.validateApiKey(apiKey);

      expect(partnerModel.findOne).toHaveBeenCalledWith({
        apiKey: hashApiKey(apiKey),
      });
    });
  });

  describe('generateApiKey', () => {
    it('should generate a valid API key with correct format', () => {
      const result = service.generateApiKey('xyz', 'live');

      expect(result.apiKey).toMatch(/^pk_xyz_live_[a-f0-9]{32}$/);
      expect(result.hashedKey).toHaveLength(64); // SHA-256 hex
      expect(result.prefix).toBe('pk_xyz_live_');
    });

    it('should generate unique keys on multiple calls', () => {
      const key1 = service.generateApiKey('xyz', 'live');
      const key2 = service.generateApiKey('xyz', 'live');

      expect(key1.apiKey).not.toBe(key2.apiKey);
      expect(key1.hashedKey).not.toBe(key2.hashedKey);
    });

    it('should support sandbox environment', () => {
      const result = service.generateApiKey('xyz', 'sandbox');

      expect(result.apiKey).toMatch(/^pk_xyz_sandbox_[a-f0-9]{32}$/);
    });
  });

  describe('createPartner', () => {
    it('should create a partner with hashed API key', async () => {
      const createDto = {
        partnerName: 'New Partner',
        apiKeyPrefix: 'new',
        tier: 'BASIC' as const,
        dailyBorrowLimit: '50000000000',
        totalBorrowLimit: '200000000000',
        platformFeePercentage: 75,
        settlementAddress: '0x1234567890123456789012345678901234567890',
        contactEmail: 'new@partner.com',
      };

      const createdPartner = { ...createDto, partnerId: 'partner_new_001' };
      (partnerModel.create as any).mockResolvedValue(createdPartner);

      const result = await service.createPartner(createDto, '0xadmin');

      expect(result).toBeDefined();
      expect(result.plainApiKey).toMatch(/^pk_new_live_/);
      expect(partnerModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerName: 'New Partner',
          apiKey: expect.any(String), // Should be hashed
          createdBy: '0xadmin',
        })
      );
    });
  });

  describe('getPartnerStats', () => {
    it('should calculate correct usage statistics', async () => {
      const mockPartner = createMockPartner({
        currentOutstanding: '25000000000', // $25k
        dailyBorrowLimit: '100000000000', // $100k
        totalBorrowLimit: '500000000000', // $500k
      });

      const result = await service.getPartnerStats(mockPartner as any);

      expect(result.limits.currentOutstanding).toBe('25000000000');
      expect(result.usage.totalRemaining).toBe('475000000000');
      expect(result.usage.utilizationRate).toBeCloseTo(5.0); // 25/500 * 100
    });
  });

  describe('logApiCall', () => {
    it('should log successful API call', async () => {
      const mockPartner = createMockPartner();
      (apiLogModel.create as any).mockResolvedValue({});

      await service.logApiCall(
        mockPartner as any,
        '/partners/borrow',
        'POST',
        { oaidTokenId: 123 },
        200,
        true,
        150,
        '192.168.1.1'
      );

      expect(apiLogModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerId: 'partner_xyz_001',
          endpoint: '/partners/borrow',
          method: 'POST',
          statusCode: 200,
          success: true,
          responseTime: 150,
          ipAddress: '192.168.1.1',
        })
      );
    });
  });
});
```

### 2. Partner API Key Guard Tests

**File:** `/packages/backend/src/modules/partners/guards/partner-api-key.guard.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PartnerApiKeyGuard } from './partner-api-key.guard';
import { PartnerService } from '../services/partner.service';
import { mockDeep } from 'jest-mock-extended';
import { createMockPartner } from '../../../test-utils/test-helpers';

describe('PartnerApiKeyGuard', () => {
  let guard: PartnerApiKeyGuard;
  let partnerService: any;

  beforeEach(async () => {
    partnerService = {
      validateApiKey: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartnerApiKeyGuard,
        { provide: PartnerService, useValue: partnerService },
      ],
    }).compile();

    guard = module.get<PartnerApiKeyGuard>(PartnerApiKeyGuard);
  });

  const createMockExecutionContext = (authHeader?: string): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {
            authorization: authHeader,
          },
        }),
      }),
    } as any;
  };

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should throw UnauthorizedException when no auth header', async () => {
      const context = createMockExecutionContext();

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Missing API key');
    });

    it('should throw UnauthorizedException when auth header does not start with Bearer', async () => {
      const context = createMockExecutionContext('Basic some-token');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Missing API key');
    });

    it('should throw UnauthorizedException for invalid API key', async () => {
      partnerService.validateApiKey.mockResolvedValue(null);
      const context = createMockExecutionContext('Bearer pk_invalid_key');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Invalid API key');
    });

    it('should throw ForbiddenException for suspended partner', async () => {
      const suspendedPartner = createMockPartner({ status: 'SUSPENDED' });
      partnerService.validateApiKey.mockResolvedValue(suspendedPartner);
      const context = createMockExecutionContext(`Bearer ${suspendedPartner.plainApiKey}`);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Partner account is suspended');
    });

    it('should allow active partner and attach to request', async () => {
      const activePartner = createMockPartner({ status: 'ACTIVE' });
      partnerService.validateApiKey.mockResolvedValue(activePartner);

      const mockRequest = { headers: { authorization: `Bearer ${activePartner.plainApiKey}` } };
      const context = {
        switchToHttp: () => ({ getRequest: () => mockRequest }),
      } as any;

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockRequest['partner']).toBeDefined();
      expect(mockRequest['partner'].partnerId).toBe('partner_xyz_001');
    });
  });
});
```

### 3. Partner Loan Service Tests

**File:** `/packages/backend/src/modules/partners/services/partner-loan.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PartnerLoanService } from './partner-loan.service';
import { PartnerService } from './partner.service';
import { getModelToken } from '@nestjs/mongoose';
import { PartnerLoan } from '../../../database/schemas/partner-loan.schema';
import { Partner } from '../../../database/schemas/partner.schema';
import { SolvencyPositionService } from '../../solvency/services/solvency-position.service';
import { SolvencyBlockchainService } from '../../solvency/services/solvency-blockchain.service';
import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { mockDeep } from 'jest-mock-extended';
import {
  createMockModel,
  createMockPartner,
  createMockPartnerLoan,
  randomAddress
} from '../../../test-utils/test-helpers';

describe('PartnerLoanService', () => {
  let service: PartnerLoanService;
  let partnerLoanModel: any;
  let partnerModel: any;
  let partnerService: any;
  let solvencyPositionService: any;
  let solvencyBlockchainService: any;

  beforeEach(async () => {
    partnerLoanModel = createMockModel<PartnerLoan>();
    partnerModel = createMockModel<Partner>();

    partnerService = {
      logApiCall: jest.fn().mockResolvedValue(undefined),
    };

    solvencyPositionService = {
      findActivePositionByOAID: jest.fn(),
      addPartnerLoan: jest.fn().mockResolvedValue(undefined),
      markPartnerLoanRepaid: jest.fn().mockResolvedValue(undefined),
    };

    solvencyBlockchainService = {
      borrowUSDC: jest.fn(),
      repayLoan: jest.fn(),
      getOAIDOwner: jest.fn(),
      getOAIDCreditLine: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartnerLoanService,
        { provide: getModelToken(PartnerLoan.name), useValue: partnerLoanModel },
        { provide: getModelToken(Partner.name), useValue: partnerModel },
        { provide: PartnerService, useValue: partnerService },
        { provide: SolvencyPositionService, useValue: solvencyPositionService },
        { provide: SolvencyBlockchainService, useValue: solvencyBlockchainService },
      ],
    }).compile();

    service = module.get<PartnerLoanService>(PartnerLoanService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('partnerBorrow', () => {
    const borrowDto = {
      oaidTokenId: 123,
      userWallet: randomAddress(),
      borrowAmount: '5000000000',
      partnerLoanId: 'xyz_loan_001',
    };

    const mockPartner = createMockPartner();
    const mockPosition = {
      _id: 'position_mongo_id',
      positionId: 42,
      user: borrowDto.userWallet,
      oaidTokenId: 123,
    };

    it('should throw ForbiddenException if user does not own OAID', async () => {
      solvencyBlockchainService.getOAIDOwner.mockResolvedValue('0xOtherUser');

      await expect(service.partnerBorrow(mockPartner as any, borrowDto))
        .rejects.toThrow(ForbiddenException);
      await expect(service.partnerBorrow(mockPartner as any, borrowDto))
        .rejects.toThrow('User does not own this OAID');
    });

    it('should throw BadRequestException if credit line is inactive', async () => {
      solvencyBlockchainService.getOAIDOwner.mockResolvedValue(borrowDto.userWallet);
      solvencyBlockchainService.getOAIDCreditLine.mockResolvedValue({
        limit: '10000000000',
        used: '0',
        active: false,
      });

      await expect(service.partnerBorrow(mockPartner as any, borrowDto))
        .rejects.toThrow(BadRequestException);
      await expect(service.partnerBorrow(mockPartner as any, borrowDto))
        .rejects.toThrow('OAID credit line is not active');
    });

    it('should throw BadRequestException if insufficient credit', async () => {
      solvencyBlockchainService.getOAIDOwner.mockResolvedValue(borrowDto.userWallet);
      solvencyBlockchainService.getOAIDCreditLine.mockResolvedValue({
        limit: '10000000000',
        used: '7000000000', // Only $3000 available
        active: true,
      });

      await expect(service.partnerBorrow(mockPartner as any, borrowDto))
        .rejects.toThrow(BadRequestException);
      await expect(service.partnerBorrow(mockPartner as any, borrowDto))
        .rejects.toThrow('Insufficient credit');
    });

    it('should throw ConflictException for duplicate loan ID', async () => {
      solvencyBlockchainService.getOAIDOwner.mockResolvedValue(borrowDto.userWallet);
      solvencyBlockchainService.getOAIDCreditLine.mockResolvedValue({
        limit: '10000000000',
        used: '0',
        active: true,
      });

      (partnerLoanModel.findOne as any).mockResolvedValue({ partnerLoanId: 'xyz_loan_001' });

      await expect(service.partnerBorrow(mockPartner as any, borrowDto))
        .rejects.toThrow(ConflictException);
      await expect(service.partnerBorrow(mockPartner as any, borrowDto))
        .rejects.toThrow('Partner loan ID already exists');
    });

    it('should successfully process valid borrow', async () => {
      solvencyBlockchainService.getOAIDOwner.mockResolvedValue(borrowDto.userWallet);
      solvencyBlockchainService.getOAIDCreditLine.mockResolvedValue({
        limit: '10000000000',
        used: '0',
        active: true,
      });
      (partnerLoanModel.findOne as any).mockResolvedValue(null); // No duplicate
      solvencyPositionService.findActivePositionByOAID.mockResolvedValue(mockPosition);

      solvencyBlockchainService.borrowUSDC.mockResolvedValue({
        hash: '0xtxhash123',
      });

      (partnerLoanModel.create as any).mockResolvedValue(createMockPartnerLoan());
      (partnerModel.findByIdAndUpdate as any).mockResolvedValue({});

      const result = await service.partnerBorrow(mockPartner as any, borrowDto);

      expect(result.success).toBe(true);
      expect(result.borrowedAmount).toBe('5000000000');
      expect(result.txHash).toBe('0xtxhash123');
      expect(solvencyBlockchainService.borrowUSDC).toHaveBeenCalledWith(42, '5000000000');
      expect(partnerLoanModel.create).toHaveBeenCalled();
      expect(solvencyPositionService.addPartnerLoan).toHaveBeenCalled();
    });

    it('should calculate platform fee correctly', async () => {
      solvencyBlockchainService.getOAIDOwner.mockResolvedValue(borrowDto.userWallet);
      solvencyBlockchainService.getOAIDCreditLine.mockResolvedValue({
        limit: '10000000000',
        used: '0',
        active: true,
      });
      (partnerLoanModel.findOne as any).mockResolvedValue(null);
      solvencyPositionService.findActivePositionByOAID.mockResolvedValue(mockPosition);
      solvencyBlockchainService.borrowUSDC.mockResolvedValue({ hash: '0xtxhash' });
      (partnerLoanModel.create as any).mockResolvedValue(createMockPartnerLoan());
      (partnerModel.findByIdAndUpdate as any).mockResolvedValue({});

      const partnerWith50Bps = { ...mockPartner, platformFeePercentage: 50 }; // 0.5%
      const result = await service.partnerBorrow(partnerWith50Bps as any, borrowDto);

      // $5000 * 0.5% = $25
      expect(result.platformFee).toBe('25000000'); // 25 USDC (6 decimals)
      expect(result.netAmountTransferred).toBe('4975000000'); // $4975
    });
  });

  describe('partnerRepay', () => {
    const repayDto = {
      partnerLoanId: 'xyz_loan_001',
      repaymentAmount: '5000000000',
    };

    it('should throw NotFoundException for non-existent loan', async () => {
      const mockPartner = createMockPartner();
      (partnerLoanModel.findOne as any).mockResolvedValue(null);

      await expect(service.partnerRepay(mockPartner as any, repayDto))
        .rejects.toThrow('Loan not found');
    });

    it('should throw BadRequestException for already repaid loan', async () => {
      const mockPartner = createMockPartner();
      const repaidLoan = createMockPartnerLoan({ status: 'REPAID' });
      (partnerLoanModel.findOne as any).mockResolvedValue(repaidLoan);

      await expect(service.partnerRepay(mockPartner as any, repayDto))
        .rejects.toThrow('Loan already fully repaid');
    });

    it('should successfully process full repayment', async () => {
      const mockPartner = createMockPartner();
      const mockLoan = createMockPartnerLoan({
        remainingDebt: '5000000000',
        solvencyPositionId: 42,
      });

      (partnerLoanModel.findOne as any).mockResolvedValue(mockLoan);
      solvencyBlockchainService.repayLoan.mockResolvedValue({ hash: '0xrepayhash' });
      (partnerLoanModel.findByIdAndUpdate as any).mockResolvedValue({});
      (partnerModel.findByIdAndUpdate as any).mockResolvedValue({});

      const result = await service.partnerRepay(mockPartner as any, repayDto);

      expect(result.success).toBe(true);
      expect(result.remainingDebt).toBe('0');
      expect(result.loanStatus).toBe('REPAID');
      expect(solvencyBlockchainService.repayLoan).toHaveBeenCalledWith(42, '5000000000');
    });
  });
});
```

### 4. Partner Controller Tests

**File:** `/packages/backend/src/modules/partners/controllers/partner.controller.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PartnerController } from './partner.controller';
import { PartnerLoanService } from '../services/partner-loan.service';
import { createMockPartner } from '../../../test-utils/test-helpers';

describe('PartnerController', () => {
  let controller: PartnerController;
  let loanService: any;

  beforeEach(async () => {
    loanService = {
      partnerBorrow: jest.fn(),
      partnerRepay: jest.fn(),
      getLoanByPartnerLoanId: jest.fn(),
      getUserLoansForPartner: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PartnerController],
      providers: [
        { provide: PartnerLoanService, useValue: loanService },
      ],
    }).compile();

    controller = module.get<PartnerController>(PartnerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('borrow', () => {
    it('should call loanService.partnerBorrow with correct parameters', async () => {
      const mockPartner = createMockPartner();
      const borrowDto = {
        oaidTokenId: 123,
        userWallet: '0x123',
        borrowAmount: '5000000000',
        partnerLoanId: 'xyz_001',
      };

      loanService.partnerBorrow.mockResolvedValue({ success: true });

      const req = { partner: mockPartner };
      const result = await controller.borrow(borrowDto, req as any);

      expect(result.success).toBe(true);
      expect(loanService.partnerBorrow).toHaveBeenCalledWith(mockPartner, borrowDto);
    });
  });
});
```

---

## Integration Testing

### E2E Test Setup

Create `/packages/backend/test/partner-integration.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { generateTestApiKey, hashApiKey, randomAddress } from '../src/test-utils/test-helpers';

describe('Partner Integration (E2E)', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let testPartner: any;
  let testApiKey: string;
  let testUserWallet: string;
  let testOAIDTokenId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    mongoConnection = moduleFixture.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    await mongoConnection.dropDatabase();
    await app.close();
  });

  describe('Partner Authentication', () => {
    it('should reject request without API key', () => {
      return request(app.getHttpServer())
        .post('/partners/borrow')
        .send({
          oaidTokenId: 123,
          userWallet: '0x123',
          borrowAmount: '1000000000',
          partnerLoanId: 'test_001',
        })
        .expect(401)
        .expect(res => {
          expect(res.body.message).toContain('Missing API key');
        });
    });

    it('should reject request with invalid API key', () => {
      return request(app.getHttpServer())
        .post('/partners/borrow')
        .set('Authorization', 'Bearer pk_invalid_key_12345678901234567890123456789012')
        .send({
          oaidTokenId: 123,
          userWallet: '0x123',
          borrowAmount: '1000000000',
          partnerLoanId: 'test_001',
        })
        .expect(401)
        .expect(res => {
          expect(res.body.message).toContain('Invalid API key');
        });
    });
  });

  describe('Public Endpoints', () => {
    it('GET /partners/public/oaid/:id/credit-line - should return credit line without auth', () => {
      // Note: Requires actual OAID to exist on-chain
      return request(app.getHttpServer())
        .get('/partners/public/oaid/123/credit-line')
        .expect(200)
        .expect(res => {
          expect(res.body).toHaveProperty('oaidTokenId');
          expect(res.body).toHaveProperty('creditLimit');
          expect(res.body).toHaveProperty('availableCredit');
        });
    });
  });

  describe('Complete Borrow & Repay Flow', () => {
    let partnerLoanId: string;

    beforeAll(async () => {
      // Create test partner
      testApiKey = generateTestApiKey('test');
      const hashedKey = hashApiKey(testApiKey);

      testPartner = await mongoConnection.collection('partners').insertOne({
        partnerId: 'partner_test_001',
        partnerName: 'Test Partner',
        apiKey: hashedKey,
        apiKeyPrefix: 'pk_test_live_',
        status: 'ACTIVE',
        tier: 'PREMIUM',
        dailyBorrowLimit: '100000000000',
        totalBorrowLimit: '500000000000',
        currentOutstanding: '0',
        platformFeePercentage: 50,
        settlementAddress: randomAddress(),
        contactEmail: 'test@test.com',
        createdBy: randomAddress(),
        totalBorrowed: '0',
        totalRepaid: '0',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // TODO: Create test OAID on blockchain
      testUserWallet = randomAddress();
      testOAIDTokenId = 123;
    });

    it('POST /partners/borrow - should successfully borrow', async () => {
      partnerLoanId = `test_loan_${Date.now()}`;

      const response = await request(app.getHttpServer())
        .post('/partners/borrow')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({
          oaidTokenId: testOAIDTokenId,
          userWallet: testUserWallet,
          borrowAmount: '5000000000',
          partnerLoanId,
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.borrowedAmount).toBe('5000000000');
      expect(response.body).toHaveProperty('txHash');
      expect(response.body).toHaveProperty('internalLoanId');
      expect(response.body.platformFee).toBe('25000000'); // 0.5% of $5000
      expect(response.body.netAmountTransferred).toBe('4975000000');
    });

    it('GET /partners/loan/:id - should retrieve loan details', async () => {
      const response = await request(app.getHttpServer())
        .get(`/partners/loan/${partnerLoanId}`)
        .set('Authorization', `Bearer ${testApiKey}`)
        .expect(200);

      expect(response.body.partnerLoanId).toBe(partnerLoanId);
      expect(response.body.principalAmount).toBe('5000000000');
      expect(response.body.status).toBe('ACTIVE');
    });

    it('POST /partners/repay - should successfully repay loan', async () => {
      const response = await request(app.getHttpServer())
        .post('/partners/repay')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({
          partnerLoanId,
          repaymentAmount: '5000000000',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.remainingDebt).toBe('0');
      expect(response.body.loanStatus).toBe('REPAID');
    });

    it('GET /partners/my/stats - should show updated partner stats', async () => {
      const response = await request(app.getHttpServer())
        .get('/partners/my/stats')
        .set('Authorization', `Bearer ${testApiKey}`)
        .expect(200);

      expect(response.body.partnerId).toBe('partner_test_001');
      expect(response.body.lifetime.totalBorrowed).toBe('5000000000');
      expect(response.body.lifetime.totalRepaid).toBe('5000000000');
      expect(response.body.limits.currentOutstanding).toBe('0');
    });
  });
});
```

---

## Manual Testing Guide

### Setup Test Environment

1. **Start Services:**
```bash
# Terminal 1: MongoDB
docker run -d -p 27017:27017 --name mongo-test mongo:latest

# Terminal 2: Redis (optional, for rate limiting)
docker run -d -p 6379:6379 --name redis-test redis:latest

# Terminal 3: Backend
cd packages/backend
npm run dev
```

2. **Create Test Partner:**
```bash
curl -X POST http://localhost:3000/admin/partners/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -d '{
    "partnerName": "Test Lending Platform",
    "apiKeyPrefix": "test",
    "tier": "PREMIUM",
    "dailyBorrowLimit": "100000000000",
    "totalBorrowLimit": "500000000000",
    "platformFeePercentage": 50,
    "settlementAddress": "0x...",
    "contactEmail": "test@example.com"
  }'
```

Save the returned API key!

### Test Scenarios

#### Scenario 1: Check Credit Line (No Auth)

```bash
curl http://localhost:3000/partners/public/oaid/123/credit-line
```

**Expected Response:**
```json
{
  "oaidTokenId": 123,
  "creditLimit": "10000000000",
  "creditUsed": "2000000000",
  "availableCredit": "8000000000",
  "active": true,
  "owner": "0x..."
}
```

#### Scenario 2: Borrow on Behalf of User

```bash
curl -X POST http://localhost:3000/partners/borrow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer pk_test_live_..." \
  -d '{
    "oaidTokenId": 123,
    "userWallet": "0x580F5b09765E71D64613c8F4403234f8790DD7D3",
    "borrowAmount": "5000000000",
    "partnerLoanId": "manual_test_001"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "internalLoanId": "uuid-...",
  "borrowedAmount": "5000000000",
  "netAmountTransferred": "4975000000",
  "platformFee": "25000000",
  "remainingCredit": "3000000000",
  "txHash": "0x...",
  "message": "Loan successfully processed"
}
```

#### Scenario 3: Get Loan Details

```bash
curl http://localhost:3000/partners/loan/manual_test_001 \
  -H "Authorization: Bearer pk_test_live_..."
```

#### Scenario 4: Repay Loan

```bash
curl -X POST http://localhost:3000/partners/repay \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer pk_test_live_..." \
  -d '{
    "partnerLoanId": "manual_test_001",
    "repaymentAmount": "5000000000"
  }'
```

#### Scenario 5: Get Partner Stats

```bash
curl http://localhost:3000/partners/my/stats \
  -H "Authorization: Bearer pk_test_live_..."
```

### Error Scenarios to Test

1. **Invalid API Key:**
```bash
curl -X POST http://localhost:3000/partners/borrow \
  -H "Authorization: Bearer pk_invalid_key" \
  -d '{...}'
# Expected: 401 Unauthorized
```

2. **Insufficient Credit:**
```bash
# Borrow more than available
curl -X POST http://localhost:3000/partners/borrow \
  -H "Authorization: Bearer pk_test_live_..." \
  -d '{
    "oaidTokenId": 123,
    "userWallet": "0x...",
    "borrowAmount": "999999999999",
    "partnerLoanId": "test_002"
  }'
# Expected: 400 Bad Request - "Insufficient credit"
```

3. **User Does Not Own OAID:**
```bash
curl -X POST http://localhost:3000/partners/borrow \
  -H "Authorization: Bearer pk_test_live_..." \
  -d '{
    "oaidTokenId": 123,
    "userWallet": "0xWrongUser...",
    "borrowAmount": "1000000000",
    "partnerLoanId": "test_003"
  }'
# Expected: 403 Forbidden - "User does not own this OAID"
```

4. **Duplicate Loan ID:**
```bash
# Use same partnerLoanId twice
# Expected: 409 Conflict - "Partner loan ID already exists"
```

---

## Load Testing

### Install k6

```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

### Load Test Script

**File:** `/packages/backend/test/load/partner-load.js`

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Custom metrics
const borrowSuccessRate = new Counter('borrow_success');
const borrowFailureRate = new Counter('borrow_failure');
const borrowDuration = new Trend('borrow_duration');

export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up to 10 users
    { duration: '1m', target: 50 },   // Ramp up to 50 users
    { duration: '2m', target: 50 },   // Stay at 50 users
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests should be below 2s
    'http_req_duration{endpoint:borrow}': ['p(95)<3000'],
    borrow_success: ['count>100'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.PARTNER_API_KEY || 'pk_test_live_...';

export default function () {
  const partnerLoanId = `load_test_${__VU}_${__ITER}_${Date.now()}`;

  // Test 1: Check credit line (public endpoint)
  const creditResponse = http.get(
    `${BASE_URL}/partners/public/oaid/123/credit-line`,
    {
      tags: { endpoint: 'credit-line' },
    }
  );

  check(creditResponse, {
    'credit check status is 200': (r) => r.status === 200,
    'has availableCredit': (r) => JSON.parse(r.body).availableCredit !== undefined,
  });

  sleep(1);

  // Test 2: Borrow operation
  const borrowPayload = JSON.stringify({
    oaidTokenId: 123,
    userWallet: '0x580F5b09765E71D64613c8F4403234f8790DD7D3',
    borrowAmount: '1000000000', // $1000
    partnerLoanId,
    metadata: {
      loadTest: true,
      virtualUser: __VU,
      iteration: __ITER,
    },
  });

  const borrowStart = Date.now();
  const borrowResponse = http.post(
    `${BASE_URL}/partners/borrow`,
    borrowPayload,
    {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: 'borrow' },
    }
  );

  const borrowTime = Date.now() - borrowStart;
  borrowDuration.add(borrowTime);

  const borrowOk = check(borrowResponse, {
    'borrow status is 201': (r) => r.status === 201,
    'borrow has txHash': (r) => {
      if (r.status === 201) {
        return JSON.parse(r.body).txHash !== undefined;
      }
      return false;
    },
  });

  if (borrowOk) {
    borrowSuccessRate.add(1);

    sleep(2);

    // Test 3: Get loan details
    const loanResponse = http.get(
      `${BASE_URL}/partners/loan/${partnerLoanId}`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
        },
        tags: { endpoint: 'get-loan' },
      }
    );

    check(loanResponse, {
      'loan details status is 200': (r) => r.status === 200,
      'loan status is ACTIVE': (r) => {
        if (r.status === 200) {
          return JSON.parse(r.body).status === 'ACTIVE';
        }
        return false;
      },
    });
  } else {
    borrowFailureRate.add(1);
    console.error(`Borrow failed: ${borrowResponse.status} - ${borrowResponse.body}`);
  }

  sleep(1);
}

export function handleSummary(data) {
  return {
    'load-test-summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
```

### Run Load Test

```bash
cd packages/backend/test/load

# Basic test
k6 run partner-load.js

# With custom environment
BASE_URL=https://api-staging.mantle-rwa.com \
PARTNER_API_KEY=pk_test_live_... \
k6 run partner-load.js

# Output results to InfluxDB
k6 run --out influxdb=http://localhost:8086/k6 partner-load.js
```

### Expected Performance Metrics

- **Throughput:** 50-100 RPS sustained
- **Response Time (p95):** < 2 seconds
- **Response Time (p99):** < 5 seconds
- **Error Rate:** < 1%
- **Database Connection Pool:** Should not exhaust

---

## Security Testing

### 1. API Key Security

**Test:** Verify API keys are hashed
```bash
# Check database
mongo mantle-rwa
db.partners.findOne({}, { apiKey: 1 })
# Should return SHA-256 hash, not plaintext
```

**Test:** API key regeneration invalidates old key
```bash
# Regenerate key
curl -X POST http://localhost:3000/admin/partners/partner_xyz_001/regenerate-api-key \
  -H "Authorization: Bearer ADMIN_JWT"

# Try using old key
curl -X POST http://localhost:3000/partners/borrow \
  -H "Authorization: Bearer OLD_API_KEY" \
  -d '{...}'
# Expected: 401 Unauthorized
```

### 2. Authorization Tests

**Test:** Partner cannot access other partner's loans
```bash
# Create loan with Partner A
curl -X POST .../partners/borrow \
  -H "Authorization: Bearer PARTNER_A_KEY" \
  -d '{ "partnerLoanId": "partner_a_loan_001", ... }'

# Try to access with Partner B
curl .../partners/loan/partner_a_loan_001 \
  -H "Authorization: Bearer PARTNER_B_KEY"
# Expected: 404 Not Found or 403 Forbidden
```

### 3. Input Validation

**Test:** SQL/NoSQL Injection attempts
```bash
curl -X POST .../partners/borrow \
  -H "Authorization: Bearer API_KEY" \
  -d '{
    "oaidTokenId": "$ne",
    "userWallet": "0x123",
    "borrowAmount": "1000000000",
    "partnerLoanId": "{\\"$gt\\":\\"\\"}"
  }'
# Expected: 400 Bad Request - Validation error
```

**Test:** Negative amounts
```bash
curl -X POST .../partners/borrow \
  -d '{
    "oaidTokenId": 123,
    "userWallet": "0x123",
    "borrowAmount": "-1000000000",
    "partnerLoanId": "test"
  }'
# Expected: 400 Bad Request
```

### 4. Rate Limiting (If Implemented)

**Test:** Exceed rate limit
```bash
# Send 101 requests in 1 minute (BASIC tier limit: 100/min)
for i in {1..101}; do
  curl .../partners/public/oaid/123/credit-line &
done
wait
# Expected: Some requests return 429 Too Many Requests
```

---

## Test Data Setup

### Create Test Partners Script

**File:** `/packages/backend/scripts/seed-test-partners.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PartnerService } from '../src/modules/partners/services/partner.service';
import { getModelToken } from '@nestjs/mongoose';
import { Partner } from '../src/database/schemas/partner.schema';
import { Model } from 'mongoose';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const partnerService = app.get(PartnerService);
  const partnerModel = app.get<Model<Partner>>(getModelToken(Partner.name));

  // Clear existing test partners
  await partnerModel.deleteMany({ partnerId: /^partner_test_/ });

  // Create test partners
  const partners = [
    {
      partnerName: 'Test Basic Partner',
      apiKeyPrefix: 'basic',
      tier: 'BASIC' as const,
      dailyBorrowLimit: '50000000000',
      totalBorrowLimit: '200000000000',
      platformFeePercentage: 75,
      settlementAddress: '0x1234567890123456789012345678901234567890',
      contactEmail: 'basic@test.com',
    },
    {
      partnerName: 'Test Premium Partner',
      apiKeyPrefix: 'premium',
      tier: 'PREMIUM' as const,
      dailyBorrowLimit: '100000000000',
      totalBorrowLimit: '500000000000',
      platformFeePercentage: 50,
      settlementAddress: '0x2345678901234567890123456789012345678901',
      contactEmail: 'premium@test.com',
    },
  ];

  for (const partnerData of partners) {
    const result = await partnerService.createPartner(
      partnerData,
      '0xTestAdminWallet'
    );
    console.log(`Created ${partnerData.partnerName}:`);
    console.log(`  API Key: ${result.plainApiKey}`);
    console.log(`  Partner ID: ${result.partner.partnerId}`);
    console.log('');
  }

  await app.close();
}

bootstrap();
```

Run:
```bash
ts-node packages/backend/scripts/seed-test-partners.ts
```

---

## CI/CD Integration

### GitHub Actions Workflow

**File:** `.github/workflows/partner-tests.yml`

```yaml
name: Partner Integration Tests

on:
  push:
    branches: [main, develop]
    paths:
      - 'packages/backend/src/modules/partners/**'
      - 'packages/backend/test/**'
  pull_request:
    branches: [main, develop]

jobs:
  unit-tests:
    runs-on: ubuntu-latest

    services:
      mongodb:
        image: mongo:latest
        ports:
          - 27017:27017

      redis:
        image: redis:latest
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: packages/backend/package-lock.json

      - name: Install dependencies
        working-directory: packages/backend
        run: npm ci

      - name: Run unit tests
        working-directory: packages/backend
        run: npm test -- --coverage
        env:
          MONGODB_URI: mongodb://localhost:27017/test
          REDIS_HOST: localhost
          REDIS_PORT: 6379

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: packages/backend/coverage/lcov.info
          flags: backend-partners

  integration-tests:
    runs-on: ubuntu-latest

    services:
      mongodb:
        image: mongo:latest
        ports:
          - 27017:27017

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        working-directory: packages/backend
        run: npm ci

      - name: Run E2E tests
        working-directory: packages/backend
        run: npm run test:e2e
        env:
          MONGODB_URI: mongodb://localhost:27017/test-e2e

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: e2e-test-results
          path: packages/backend/test-results/

  load-tests:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'

    steps:
      - uses: actions/checkout@v3

      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install k6

      - name: Run load test
        working-directory: packages/backend/test/load
        run: k6 run --summary-export=results.json partner-load.js
        env:
          BASE_URL: ${{ secrets.STAGING_API_URL }}
          PARTNER_API_KEY: ${{ secrets.TEST_PARTNER_API_KEY }}

      - name: Upload load test results
        uses: actions/upload-artifact@v3
        with:
          name: load-test-results
          path: packages/backend/test/load/results.json
```

---

## Test Coverage Checklist

### Unit Tests Coverage

- [ ] PartnerService
  - [ ] validateApiKey
  - [ ] generateApiKey
  - [ ] createPartner
  - [ ] updatePartner
  - [ ] getPartnerStats
  - [ ] logApiCall

- [ ] PartnerLoanService
  - [ ] partnerBorrow - validation checks
  - [ ] partnerBorrow - successful flow
  - [ ] partnerBorrow - fee calculation
  - [ ] partnerRepay - validation checks
  - [ ] partnerRepay - full repayment
  - [ ] partnerRepay - partial repayment

- [ ] PartnerApiKeyGuard
  - [ ] Missing authorization header
  - [ ] Invalid API key format
  - [ ] Invalid API key
  - [ ] Suspended partner
  - [ ] Active partner success

- [ ] PartnerController
  - [ ] All endpoint handlers

### Integration Tests Coverage

- [ ] Complete borrow flow
- [ ] Complete repay flow
- [ ] Partner stats tracking
- [ ] Limit enforcement
- [ ] Error scenarios
- [ ] Concurrent requests

### Manual Tests Coverage

- [ ] Public endpoints (no auth)
- [ ] Authenticated endpoints
- [ ] Admin endpoints
- [ ] All error scenarios
- [ ] Edge cases

### Security Tests Coverage

- [ ] API key hashing
- [ ] Authorization boundaries
- [ ] Input validation
- [ ] Rate limiting
- [ ] Injection attacks

---

## Running All Tests

```bash
# Unit tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:cov

# E2E tests
npm run test:e2e

# All tests
npm test && npm run test:e2e
```

---

## Troubleshooting

### Common Issues

**Issue:** MongoDB connection fails in tests
```bash
# Solution: Ensure MongoDB is running
docker run -d -p 27017:27017 mongo:latest
```

**Issue:** Tests fail with "Cannot find module"
```bash
# Solution: Clear jest cache
npm test -- --clearCache
```

**Issue:** Load tests fail immediately
```bash
# Solution: Check BASE_URL and API_KEY environment variables
echo $BASE_URL
echo $PARTNER_API_KEY
```

---

## Next Steps

1. ✅ Read this guide
2. [ ] Set up test environment
3. [ ] Implement unit tests for PartnerService
4. [ ] Implement unit tests for PartnerLoanService
5. [ ] Implement guard tests
6. [ ] Create E2E test suite
7. [ ] Set up load testing
8. [ ] Configure CI/CD pipeline
9. [ ] Achieve 80%+ coverage
10. [ ] Document findings

---

**Document Version:** 1.0
**Last Updated:** 2026-01-05
**Maintained By:** Engineering Team
