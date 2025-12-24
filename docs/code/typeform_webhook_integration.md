# Typeform Webhook Integration

**Date**: December 24, 2025
**Status**: Implementation Plan
**Module**: Typeform Webhook Handler

## Overview

Integration of Typeform webhook to receive invoice submission forms and automatically create assets in the RWA platform. The webhook downloads invoice files from Typeform URLs, validates data, verifies webhook signatures, and creates asset records that enter the existing processing pipeline.

## User Requirements

- **File Handling**: Typeform provides file URL in webhook payload
- **Action**: Create asset immediately upon webhook receipt
- **Security**: Verify Typeform HMAC-SHA256 signature
- **User Mapping**: Typeform form includes wallet address field

## Architecture

### Module Structure

**Location**: `packages/backend/src/modules/typeform/`

```
typeform/
├── typeform.module.ts
├── controllers/
│   └── typeform.controller.ts
├── services/
│   ├── typeform-webhook.service.ts
│   └── typeform-signature.service.ts
└── dto/
    └── typeform-webhook.dto.ts
```

### Flow Diagram

```
┌─────────────┐
│  Typeform   │
│   Server    │
└──────┬──────┘
       │ POST /webhooks/typeform
       │ + Typeform-Signature header
       ▼
┌─────────────────────────────────┐
│  TypeformController             │
│  - Verify HMAC signature        │
│  - Parse webhook payload        │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│  TypeformWebhookService         │
│  - Map fields to CreateAssetDto │
│  - Download invoice from URL    │
│  - Ensure user exists           │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│  AssetLifecycleService          │
│  (existing)                     │
│  - Create asset record          │
│  - Queue hash computation       │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│  MongoDB: assets collection     │
│  Status: UPLOADED               │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│  BullMQ: asset-processing       │
│  Jobs: hash → merkle → attest   │
└─────────────────────────────────┘
```

## Implementation Details

### 1. Typeform Webhook DTO

**File**: `packages/backend/src/modules/typeform/dto/typeform-webhook.dto.ts`

**Typeform Payload Structure**:

```typescript
interface TypeformWebhookDto {
  event_id: string;
  event_type: string; // "form_response"
  form_response: {
    form_id: string;
    token: string;
    submitted_at: string;
    definition: {
      id: string;
      title: string;
      fields: Array<{
        id: string;
        title: string;
        type: string;
      }>;
    };
    answers: Array<{
      field: {
        id: string;
        type: string;
      };
      type: string;
      text?: string;
      number?: number;
      date?: string;
      file_url?: string;
    }>;
  };
}
```

**Field Mapping**:

| Typeform Field | Asset Field | Type | Required |
|---|---|---|---|
| Wallet Address | walletAddress | string | Yes |
| Invoice Number | invoiceNumber | string | Yes |
| Face Value | faceValue | string (numeric) | Yes |
| Currency | currency | string | Yes |
| Issue Date | issueDate | string (ISO) | Yes |
| Due Date | dueDate | string (ISO) | Yes |
| Buyer Name | buyerName | string | Yes |
| Industry | industry | string | Yes |
| Risk Tier | riskTier | string | Yes |
| Total Supply | totalSupply | string (numeric) | Yes |
| Price Per Token | pricePerToken | string (numeric) | Yes |
| Min Investment | minInvestment | string (numeric) | Yes |
| Invoice File | file_url | URL | Yes |

### 2. Signature Verification Service

**File**: `packages/backend/src/modules/typeform/services/typeform-signature.service.ts`

**Purpose**: Verify webhook authenticity using HMAC-SHA256

**Algorithm**:
1. Extract webhook secret from environment (`TYPEFORM_WEBHOOK_SECRET`)
2. Compute HMAC-SHA256 of raw request body using secret
3. Encode as base64
4. Compare with `Typeform-Signature` header using timing-safe comparison

**Implementation**:

```typescript
import * as crypto from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TypeformSignatureService {
  private readonly webhookSecret: string;

  constructor(private configService: ConfigService) {
    this.webhookSecret = this.configService.get<string>('TYPEFORM_WEBHOOK_SECRET');
    if (!this.webhookSecret) {
      throw new Error('TYPEFORM_WEBHOOK_SECRET not configured');
    }
  }

  verifySignature(rawPayload: string, signature: string): boolean {
    if (!signature) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawPayload)
      .digest('base64');

    const expected = `sha256=${expectedSignature}`;

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      );
    } catch {
      return false;
    }
  }
}
```

**Security Reference**: [Typeform Webhook Security](https://www.typeform.com/developers/webhooks/secure-your-webhooks/)

### 3. Webhook Processing Service

**File**: `packages/backend/src/modules/typeform/services/typeform-webhook.service.ts`

**Key Methods**:

#### a) `processWebhook(payload: TypeformWebhookDto)`

**Responsibilities**:
- Extract and validate all required fields from Typeform answers
- Download invoice file from Typeform's file_url
- Find or create user by wallet address
- Validate user has ORIGINATOR role
- Save file to temporary storage
- Call `AssetLifecycleService.createAsset()`
- Return assetId for tracking

**Pseudocode**:
```typescript
async processWebhook(payload: TypeformWebhookDto) {
  // 1. Map Typeform fields to asset DTO
  const { dto, walletAddress, fileUrl } = this.mapTypeformToAssetDto(payload);

  // 2. Download invoice file
  const { buffer, filename, mimetype } = await this.downloadInvoiceFile(fileUrl);

  // 3. Save to temporary storage (multer-compatible)
  const filePath = await this.saveTempFile(buffer, filename);

  // 4. Ensure user exists
  const user = await this.ensureOriginatorUser(walletAddress);

  // 5. Create asset
  const multerFile = this.createMulterFile(filePath, filename, mimetype, buffer.length);
  const result = await this.assetLifecycleService.createAsset(
    walletAddress,
    dto,
    multerFile
  );

  return { assetId: result.assetId };
}
```

#### b) `downloadInvoiceFile(fileUrl: string)`

**Responsibilities**:
- Download file from Typeform URL using axios
- Validate file type (PDF, JPEG, PNG)
- Return buffer and metadata
- Handle download errors

**Implementation**:
```typescript
async downloadInvoiceFile(fileUrl: string) {
  const response = await axios.get(fileUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
    headers: {
      'User-Agent': 'RWA-Platform-Webhook/1.0',
    },
  });

  const contentType = response.headers['content-type'];
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];

  if (!allowedTypes.some(t => contentType.includes(t))) {
    throw new BadRequestException('Invalid file type');
  }

  const buffer = Buffer.from(response.data);
  const ext = this.getExtensionFromMimeType(contentType);
  const filename = `invoice-${Date.now()}.${ext}`;

  return { buffer, filename, mimetype: contentType };
}
```

#### c) `mapTypeformToAssetDto(formResponse)`

**Responsibilities**:
- Parse Typeform answers array
- Match field IDs/titles to expected fields
- Validate all required fields are present
- Convert types appropriately
- Return CreateAssetDto + walletAddress + fileUrl

**Field Extraction Pattern**:
```typescript
const answers = formResponse.answers;
const findAnswer = (title: string) => {
  return answers.find(a => a.field.title === title);
};

const walletAddress = findAnswer('Wallet Address')?.text;
const invoiceNumber = findAnswer('Invoice Number')?.text;
const faceValue = findAnswer('Face Value')?.text;
// ... etc

// Validate all required fields
if (!walletAddress || !invoiceNumber || ...) {
  throw new BadRequestException('Missing required fields');
}
```

#### d) `ensureOriginatorUser(walletAddress: string)`

**Responsibilities**:
- Validate wallet address format (0x + 40 hex chars)
- Check if user exists
- Create new user with role=ORIGINATOR if not found
- Return user document

**Implementation**:
```typescript
async ensureOriginatorUser(walletAddress: string) {
  // Validate format
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    throw new BadRequestException('Invalid wallet address format');
  }

  // Find or create
  let user = await this.userModel.findOne({ walletAddress });

  if (!user) {
    user = new this.userModel({
      walletAddress,
      role: UserRole.ORIGINATOR,
      kyc: false,
    });
    await user.save();
  }

  return user;
}
```

### 4. Webhook Controller

**File**: `packages/backend/src/modules/typeform/controllers/typeform.controller.ts`

**Endpoint**: `POST /webhooks/typeform`

**Features**:
- **Public endpoint** - No JWT authentication
- **Signature verification** - HMAC-SHA256 via header
- **Raw body access** - For signature verification
- **Error handling** - Return 200 OK even on errors (webhook best practice)

**Implementation**:

```typescript
import { Controller, Post, Req, Headers, Body, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { TypeformWebhookService } from '../services/typeform-webhook.service';
import { TypeformSignatureService } from '../services/typeform-signature.service';
import { TypeformWebhookDto } from '../dto/typeform-webhook.dto';

interface RawBodyRequest extends Request {
  rawBody?: string;
}

@Controller('webhooks')
export class TypeformController {
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
      throw new UnauthorizedException('Raw body required for verification');
    }

    if (!this.signatureService.verifySignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // 2. Process webhook
    try {
      const result = await this.typeformWebhookService.processWebhook(payload);

      console.log('[Typeform Webhook] Success', {
        eventId: payload.event_id,
        assetId: result.assetId,
      });

      return {
        success: true,
        assetId: result.assetId,
        message: 'Webhook processed successfully',
      };
    } catch (error) {
      // Log error but return 200 (Typeform will retry on non-200)
      console.error('[Typeform Webhook] Error', {
        eventId: payload.event_id,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }
}
```

### 5. Raw Body Middleware

**File**: `packages/backend/src/main.ts`

**Purpose**: Enable raw body access for signature verification

**Configuration**:

```typescript
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ... existing CORS, etc.

  // Raw body middleware for Typeform webhook
  app.use('/webhooks/typeform', express.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  }));

  // ... rest of setup
}
```

**Important**: This must be configured BEFORE the global body parser.

### 6. Module Configuration

**File**: `packages/backend/src/modules/typeform/typeform.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeformController } from './controllers/typeform.controller';
import { TypeformWebhookService } from './services/typeform-webhook.service';
import { TypeformSignatureService } from './services/typeform-signature.service';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { AssetsModule } from '../assets/assets.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    AssetsModule, // Import to access AssetLifecycleService
  ],
  controllers: [TypeformController],
  providers: [TypeformWebhookService, TypeformSignatureService],
})
export class TypeformModule {}
```

### 7. Export AssetLifecycleService

**File**: `packages/backend/src/modules/assets/assets.module.ts`

**Modification**: Add exports array

```typescript
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Asset.name, schema: AssetSchema }]),
    BullModule.registerQueue({ name: 'asset-processing' }),
    ComplianceEngineModule,
    BlockchainModule,
  ],
  controllers: [AssetsController],
  providers: [AssetLifecycleService, AssetProcessor],
  exports: [AssetLifecycleService], // ← Add this line
})
export class AssetsModule {}
```

### 8. Register in App Module

**File**: `packages/backend/src/app.module.ts`

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.MONGODB_URI),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT),
      },
    }),
    AuthModule,
    KycModule,
    AssetsModule,
    AdminModule,
    NotificationsModule,
    TypeformModule, // ← Add this line
  ],
})
export class AppModule {}
```

## Environment Configuration

### `.env`

Add the following variable:

```env
# Typeform Webhook Configuration
TYPEFORM_WEBHOOK_SECRET=your_secret_from_typeform_dashboard
```

**How to get the secret**:
1. Go to Typeform dashboard
2. Navigate to your form
3. Go to Connect > Webhooks
4. Create new webhook
5. Copy the webhook secret
6. Paste into `.env`

### `.env.example`

Document the variable:

```env
# Typeform Webhook Configuration
TYPEFORM_WEBHOOK_SECRET=
```

## Testing Strategy

### 1. Local Development with ngrok

**Setup**:
```bash
# Terminal 1: Run backend
cd packages/backend
yarn dev

# Terminal 2: Expose via ngrok
ngrok http 3000
```

**Configure Typeform**:
1. Copy ngrok URL (e.g., `https://abc123.ngrok-free.app`)
2. In Typeform dashboard, set webhook URL to: `https://abc123.ngrok-free.app/webhooks/typeform`
3. Copy webhook secret to `.env`

**Test**:
1. Submit Typeform with all required fields
2. Check backend logs for webhook receipt
3. Verify asset created in MongoDB
4. Check BullMQ jobs are queued

### 2. Signature Verification Testing

Create unit tests:

```typescript
describe('TypeformSignatureService', () => {
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
```

### 3. File Download Testing

Mock Typeform file URLs:

```typescript
describe('downloadInvoiceFile', () => {
  it('should download PDF file', async () => {
    // Mock axios
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: Buffer.from('PDF content'),
      headers: { 'content-type': 'application/pdf' },
    });

    const result = await service.downloadInvoiceFile('https://...');
    expect(result.mimetype).toBe('application/pdf');
  });
});
```

### 4. Integration Testing

End-to-end flow:

```typescript
describe('POST /webhooks/typeform', () => {
  it('should create asset from webhook', async () => {
    const payload = {
      event_id: 'test-123',
      event_type: 'form_response',
      form_response: {
        // ... complete payload
      },
    };

    const response = await request(app.getHttpServer())
      .post('/webhooks/typeform')
      .set('typeform-signature', validSignature)
      .send(payload)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.assetId).toBeDefined();
  });
});
```

## Security Considerations

### 1. Signature Verification
- **Always verify** `Typeform-Signature` header
- Use **timing-safe comparison** (prevents timing attacks)
- Reject requests with missing or invalid signatures

### 2. Input Validation
- Validate **all** fields using `class-validator`
- Sanitize wallet addresses (check format)
- Validate file types before download
- Check file sizes (prevent DoS via large files)

### 3. Error Handling
- **Don't leak** internal error details in responses
- **Log all errors** with context (event_id, timestamp)
- Return generic error messages to Typeform

### 4. Rate Limiting
Consider adding rate limiting:

```typescript
@UseGuards(ThrottlerGuard)
@Throttle(10, 60) // 10 requests per 60 seconds
@Post('typeform')
async handleWebhook(...) { ... }
```

### 5. Audit Trail
Log all webhook attempts:
- Event ID
- Timestamp
- Success/failure
- Error details (if any)
- Asset ID created (if successful)

## Files Created/Modified

### New Files

| File | Purpose |
|------|---------|
| `typeform/typeform.module.ts` | Module definition |
| `typeform/controllers/typeform.controller.ts` | Webhook HTTP handler |
| `typeform/services/typeform-webhook.service.ts` | Business logic |
| `typeform/services/typeform-signature.service.ts` | HMAC verification |
| `typeform/dto/typeform-webhook.dto.ts` | Type definitions |

### Modified Files

| File | Change |
|------|--------|
| `app.module.ts` | Register TypeformModule |
| `main.ts` | Add raw body middleware |
| `assets/assets.module.ts` | Export AssetLifecycleService |
| `.env.example` | Document TYPEFORM_WEBHOOK_SECRET |
| `docs/API_DOCUMENTATION.md` | Document webhook endpoint |

## Deployment Checklist

### Pre-deployment
- [ ] All files created and tested locally
- [ ] Unit tests written and passing
- [ ] Integration tests passing
- [ ] Signature verification tested
- [ ] File download tested with real Typeform URLs

### Staging
- [ ] Deploy to staging environment
- [ ] Set `TYPEFORM_WEBHOOK_SECRET` in staging env
- [ ] Configure Typeform webhook to staging URL
- [ ] Submit test form and verify asset creation
- [ ] Check logs for errors

### Production
- [ ] Set `TYPEFORM_WEBHOOK_SECRET` in production env
- [ ] Deploy to production
- [ ] Update Typeform webhook URL to production
- [ ] Submit test form
- [ ] Monitor logs for 24 hours
- [ ] Set up alerting for webhook failures

## Monitoring & Alerts

### Metrics to Track
- Webhook requests received (count)
- Signature verification failures (count)
- File download failures (count)
- Asset creation successes (count)
- Processing time (avg, p95, p99)

### Alert Conditions
- Signature verification failure rate > 5%
- File download failure rate > 10%
- No webhooks received for 24 hours (if expecting traffic)
- Processing time > 30 seconds

### Log Retention
- Keep webhook logs for **90 days**
- Archive successful webhook payloads (for audit)
- Keep error logs indefinitely for debugging

## Future Enhancements

### Phase 2 (Optional)
1. **Webhook Retry Logic**: Store failed webhooks and retry
2. **Admin Dashboard**: View all Typeform submissions
3. **Email Notifications**: Notify originators when asset is created
4. **Field Mapping Config**: Make field mapping configurable (not hardcoded)
5. **Multi-form Support**: Support multiple Typeform forms with different schemas

### Phase 3 (Optional)
1. **Typeform API Integration**: Pull submission data via API (not just webhooks)
2. **Validation Rules Engine**: Custom validation rules per form
3. **Duplicate Detection**: Prevent duplicate invoice submissions
4. **Webhook Replay**: Re-process webhooks for debugging

## References

- [Typeform Webhooks Documentation](https://www.typeform.com/developers/webhooks/)
- [Typeform Webhook Security](https://www.typeform.com/developers/webhooks/secure-your-webhooks/)
- [NestJS Request Lifecycle](https://docs.nestjs.com/faq/request-lifecycle)
- [BullMQ Documentation](https://docs.bullmq.io/)
