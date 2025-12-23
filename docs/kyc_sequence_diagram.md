# KYC System Sequence Diagram

This diagram shows the complete KYC (Know Your Customer) flow implementation with exact code references.

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Controller as KycController<br/>(kyc.controller.ts)
    participant Service as KycService<br/>(kyc.service.ts)
    participant Storage as DocumentStorageService<br/>(document-storage.service.ts)
    participant MongoDB as MongoDB<br/>(User Collection)
    participant Queue as BullMQ Queue<br/>(kyc-verification)
    participant Worker as VerificationProcessor<br/>(verification.processor.ts)
    participant PDFParser as pdf-parse
    participant Jimp as Jimp<br/>(Image Processing)
    participant QR as jsQR<br/>(QR Decoder)
    participant OCR as Tesseract.js<br/>(OCR Engine)
    participant XML as xml2js<br/>(XML Parser)
    participant AuthGuard as JwtAuthGuard
    
    rect rgb(240, 248, 255)
    Note over Client,MongoDB: Flow 1: Document Upload (POST /kyc/upload)
    Client->>+Controller: POST /kyc/upload<br/>Header: Bearer {accessToken}<br/>FormData: document (PDF/JPEG/JPG/PNG, max 5MB)
    Note right of Controller: @UseGuards(JwtAuthGuard)<br/>@UseInterceptors(FileInterceptor)<br/>Line 7-26
    
    Controller->>+AuthGuard: Validate JWT
    AuthGuard-->>-Controller: req.user populated
    
    Controller->>Controller: ParseFilePipeBuilder validates:<br/>- fileType: /(pdf|jpeg|jpg|png)$/<br/>- maxSize: 5MB<br/>Line 16-20
    
    alt File validation fails
        Controller-->>Client: 422 Unprocessable Entity
    end
    
    Controller->>+Service: uploadDocument(user, file)
    Note right of Service: Line 18-60
    
    alt KYC already verified
        Note right of Service: Check: user.kyc === true<br/>Line 19-21
        Service-->>Controller: BadRequestException("KYC already verified")
        Controller-->>Client: 400 Bad Request
    end
    
    alt Document already processing or verified
        Note right of Service: Check: kycDocuments.aadhaar.status<br/>Line 24-26
        Service-->>Controller: BadRequestException("Document already uploaded...")
        Controller-->>Client: 400 Bad Request
    end
    
    Service->>Service: documentId = uuidv4()
    Note right of Service: Line 28
    
    Service->>+Storage: saveDocument(file, walletAddress, documentId)
    Note right of Storage: Line 15-29
    Storage->>Storage: Create directory: local-storage/kyc-documents/{wallet}
    Note right of Storage: Line 16-18
    Storage->>Storage: Generate filename: {documentId}.pdf<br/>Line 21-22
    Storage->>Storage: Write file to disk<br/>fs.promises.writeFile(filePath, file.buffer)
    Note right of Storage: Line 24
    Storage-->>-Service: fileUrl = "file://kyc-documents/{wallet}/{docId}.pdf"
    Note right of Storage: Line 27
    
    Service->>+MongoDB: updateOne(User,<br/>{_id: user._id},<br/>{$set: kycDocuments.aadhaar})
    Note right of Service: Line 32-43<br/>Sets: documentId, fileUrl,<br/>uploadedAt, status: PROCESSING
    MongoDB-->>-Service: OK
    
    Service->>+Queue: add('verify-document', jobData)
    Note right of Service: Line 46-52<br/>jobData: {userId, walletAddress,<br/>fileUrl, documentId}
    Queue-->>-Service: Job created
    
    Service-->>-Controller: {documentId, status: PROCESSING,<br/>message: "Document uploaded..."}
    Controller-->>-Client: 200 OK<br/>{documentId, status, message}
    end
    25-145
    
    Worker->>Worker: Extract job.data:<br/>{userId, fileUrl}
    Note right of Worker: Line 26
    
    Worker->>+Storage: getFullPath(fileUrl)
    Storage->>Storage: Convert file:// URI to absolute path
    Storage-->>-Worker: absolute file path
    
    Worker->>Worker: Read file from disk<br/>fs.readFileSync(filePath)
    Note right of Worker: Line 30
    Worker->>Worker: Detect file extension:<br/>.pdf or .jpg/.jpeg/.png
    Note right of Worker: Line 31
    
    alt File is PDF
        Worker->>+PDFParser: pdf(dataBuffer)
        Note right of Worker: Line 38-39
        PDFParser->>PDFParser: Extract text content
        PDFParser-->>-Worker: {text, numpages, info}
        Worker->>Worker: extractedText = data.text
        Note right of Worker: PDF: No QR extraction
    else File is Image (JPG/JPEG/PNG)
        Worker->>+Jimp: Jimp.read(dataBuffer)
        Note right of Worker: Line 43
        Jimp->>Jimp: Load and decode image
        Jimp-->>-Worker: image {width, height, bitmap}
        
        Worker->>+QR: jsQR(imageData, width, height)
        Note right of Worker: Line 47<br/>Decode QR code from image
        
        alt QR Code Found
            QR-->>Worker: code {data, location}
            Note right of Worker: Line 48
            Worker->>Worker: qrDecoded = true
            Note right of Worker: Line 49
            
            alt QR data is XML
                Note right of Worker: Check: starts with '<' and contains 'uid'<br/>Line 53
                Worker->>+XML: parseStringPromise(code.data)
                Note right of Worker: Line 54<br/>Parse Aadhaar XML QR
                XML->>XML: Parse XML structure
                XML-->>-Worker: qrData {PrintLetterBarcodeData}
            else QR is Secure QR (non-XML)
                Worker->>Worker: qrData = {raw: code.data}
                Note right of Worker: Line 57-59<br/>Store raw data for future decoding
            end
        else No QR Found
            QR-->>Worker: null
        end
        QR-->>-Worker: QR processing complete
        
        Worker->>+OCR: createWorker('eng')
        Note right of Worker: Line 65<br/>Initialize Tesseract OCR
        OCR-->>-Worker: worker
        
        Worker->>+OCR: worker.recognize(filePath)
        Note right of Worker: Line 66<br/>Extract all text from image
        OCR->>OCR: Perform optical character recognition
        OCR-->>-Worker: {data: {text, confidence}}
        
        Worker->>Worker: extractedText = ret.data.text
        Note right of Worker: Line 67
        
        Worker->>+OCR: worker.terminate()
        Note right of Worker: Line 68<br/>Cleanup OCR worker
        OCR-->>-Worker: OK
    end
    
    Note over Worker: Verification & Scoring Logic
    Worker->>Worker: Initialize: score = 0, qrDataMatch = false
    Note right of Worker: Line 72-73
    
    Worker->>Worker: Check keywords in extractedText:<br/>+ 30 pts: "aadhaar" OR "government of india"
    Note right of Worker: Line 76-78
    
    alt QR Code was decoded
        Worker->>Worker: score += 30 (QR decoded bonus)
        Note right of Worker: Line 81-82
        
        opt QR Data is Aadhaar XML
            Worker->>Worker: Extract from qrData.PrintLetterBarcodeData:<br/>- qrName (attrs.name)<br/>- qrUid (attrs.uid)
            Note right of Worker: Line 86-88
            
            Worker->>Worker: Fuzzy match: qrName in extractedText<br/>+ 20 pts if match found
            Note right of Worker: Line 91-94
            
            Worker->>Worker: Check: UID last 4 digits in text<br/>+ 20 pts if found
            Note right of Worker: Line 97-99
        end
    else PDF fallback (no QR)
        Worker->>Worker: Basic validation:<br/>+ 20 pts if text length > 100
        Note right of Worker: Line 101-103
    end
    
    Worker->>Worker: Calculate final status:<br/>score >= 80 → VERIFIED (kyc = true)<br/>score < 80 → REJECTED (kyc = false)
    Note right of Worker: Line 106-107
    
    Worker->>+MongoDB: updateOne(User, {_id: userId},<br/>{$set: {<br/>  kyc: kycStatus,<br/>  kycDocuments.aadhaar.status,<br/>  verificationScore,<br/>  verificationMeta: {<br/>    qr1Decoded, qrDataMatch, textMatchScore<br/>  },<br/>  verifiedAt, rejectionReason<br/>}})
    Note right of Worker: Line 110-125
    MongoDB-->>-Worker: OK (KYC Updated)
    
    Worker-->>-Queue: Job completed: {status, score, qrDecoded}
    Note right of Worker: Line 127ser KYC Rejected)
    end
    
    Worker-->>-Queue: Job completed: {status, score}
    Note right of Worker: Line 56
    end
    
    rect rgb(255, 250, 240)
    Note over Client,MongoDB: Flow 3: Check KYC Status (GET /kyc/status)
    Client->>+Controller: GET /kyc/status<br/>Header: Bearer {accessToken}
    Note right of Controller: @UseGuards(JwtAuthGuard)<br/>getStatus(req)<br/>Line 28-30
    
    Controller->>+AuthGuard: Validate JWT
    AuthGuard-->>-Controller: req.user populated
    
    Controller->>+Service: getStatus(user)
    Note right of Service: Line 62-68
    
    Service->>+MongoDB: findById(User, user._id)
    Note right of Service: Line 63
    MongoDB-->>-Service: fullUser
    
    Service-->>-Controller: {kyc: boolean,<br/>documents: {aadhaar: {...}}}
    Note right of Service: Line 64-67<br/>Returns: kyc flag + kycDocuments object
    
    Controller-->>-Client: 200 OK<br/>{kyc, documents}
    end
    
    rect rgb(255, 240, 240)
    Note over Client,MongoDB: Flow 4: Delete Document (DELETE /kyc/documents)
    Client->>+Controller: DELETE /kyc/documents<br/>Header: Bearer {accessToken}
    Note right of Controller: @UseGuards(JwtAuthGuard)<br/>deleteDocument(req)<br/>Line 32-34
    
    Controller->>+AuthGuard: Validate JWT
    AuthGuard-->>-Controller: req.user populated
    
    Controller->>+Service: deleteDocument(user)
    Note right of Service: Line 70-95
    
    Service->>+MongoDB: findById(User, user._id)
    Note right of Service: Line 71
    MongoDB-->>-Service: fullUser
    
    alt Image Document
        Worker->>Jimp: Load image
        Worker->>QR: Decode QR code
        Worker->>XML: Parse Aadhaar XML
        Worker->>OCR: Extract text via Tesseract
    else PDF Document
        Worker->>PDFParser: Extract text
    end
    Worker->>Worker: Cross-verify QR vs OCR text
    Worker->>Worker: Calculate score (0-100)
    Worker->>MongoDB: Update: kyc = true/false<br/>status = VERIFIED/REJECTED<br/>verificationMeta
    alt No document found
        Note right of Service: Check: !aadhaar<br/>Line 74-76
        Service-->>Controller: NotFoundException("No document found")
        Controller-->>Client: 404 Not Found
    end
    
    alt Document is verified
        Note right of Service: Check: aadhaar.status === VERIFIED<br/>Line 78-80
        Service-->>Controller: ForbiddenException("Cannot delete verified document")
        Controller-->>Client: 403 Forbidden
    end
    
    Service->>+Storage: deleteDocument(aadhaar.fileUrl)
    Note right of Storage: Line 31-41
    Storage->>Storage: Convert file:// URI to path
    Storage->>Storage: Check if file exists:<br/>fs.existsSync(fullPath)
    Note right of Storage: Line 37
    
    opt File exists
        Storage->>Storage: Delete physical file:<br/>fs.promises.unlink(fullPath)
        Note right of Storage: Line 38
    end
    
    Storage-->>-Service: OK (File deleted)
    
    Service->>+MongoDB: updateOne(User, {_id: user._id},<br/>{$unset: {kycDocuments.aadhaar}})
    Note right of Service: Line 85-88<br/>Removes document metadata from DB
    MongoDB-->>-Service: OK
    
    Service-->>-Controller: {message: "Document deleted"}
    Controller-->>-Client: 200 OK<br/>{message}
    end
    
    rect rgb(248, 248, 255)
    Note over Worker,MongoDB: Flow 5: Verification Processing Error Handling
    Queue->>+Worker: Job triggered: verify-document
    Worker->>Worker: Attempt PDF processing
    
    alt Processing error (corrupt PDF, invalid file, etc.)
        Note right of Worker: try-catch block<br/>Line 24-69
        Worker->>+MongoDB: updateOne(User, {_id: userId},<br/>{$set: {kycDocuments.aadhaar.status: REJECTED,<br/>rejectionReason: "Processing Error"}})
        Note right of Worker: Line 60-67
        MongoDB-->>-Worker: OK
        Worker-->>-Queue: Job failed (exception thrown)
    end
    end
    
    rect rgb(255, 248, 248)
    Note over Client,Service: Flow 6: Complete User Journey Timeline
    
    Note over Client: 1. User logs in (Auth flow)
    Note over Client: 2. User.kyc = false initially
    
    Client->>Controller: POST /kyc/upload (with PDF)
    Controller->>MongoDB: Set status: PROCESSING
    Controller->>Queue: Schedule verification job
    Controller-->>Client: Return: documentId, PROCESSING
    
    Note over Client: 3. Client polls or waits
    
    Queue->>Worker: Process document in background
    Worker->>PDFParser: Extract text
    Worker->>Worker: Calculate score
    Worker->>MongoDB: Update: kyc = true/false<br/>status = VERIFIED/REJECTED
    
    Client->>Controller: GET /kyc/status (poll)
    Controller->>MongoDB: Fetch current status
    Controller-->>Client: {kyc: true, status: VERIFIED}
    
    Note over Client: 4. Access KYC-protected routes<br/>with KycAuthGuard
    end
```

## Key Implementation Details

### Storage Architecture

**Local File System (Development):**
- Base directory: `process.cwd()/local-storage/kyc-documents/`
- Structure: `{walletAddress}/{documentId}.pdf`
- URI format: `file://kyc-documents/{walletAddress}/{documentId}.pdf`

**Database Schema:**

**User Schema** - [user.schema.ts](../packages/backend/src/database/schemas/user.schema.ts#L61-L95)
```typescript
{
  _id: ObjectId,
  walletAddress: String,
  role: Enum,
  kyc: Boolean,  // Main KYC flag
  kycDocuments: {
    aadhaar: {
      documentId: String,
      fileUrl: String,
      uploadedAt: Date,
      verifiedAt?: Date,
      verificationScore?: Number,
      extractedData?: {
        uid?: String,
        name?: String,
        dob?: String,
        gender?: String,
        address?: Object
      },
      verificationMeta?: {
        qr1Decoded?: Boolean,
        qr2Decoded?: Boolean,
        qrDataMatch?: Boolean,
        textMatchScore?: Number
      },
      status: Enum (PENDING | PROCESSING | VERIFIED | REJECTED),
      rejectionReason?: String
    }
  }
}
```

### Queue Configuration

**BullMQ Queue**: `kyc-verification`
- **Job Name**: `verify-document`
- **Job Data**:
  ```typescript
  {
    userId: string,
    walletAddress: string,
    fileUrl: string,
    documentId: string
  }
  ```
- **Processing**: Asynchronous background worker
- **Concurrency**: Default (1 job at a time per worker)

### Verification Algorithm

**Current Implementation** ([verification.processor.ts](../packages/backend/src/modules/kyc/processors/verification.processor.ts)):

**For PDF Documents** (Line 38-39):
1. **Text Extraction**: Uses `pdf-parse` to extract text
2. **Keyword Matching**: 
   - Check for "Aadhaar" or "Government of India": +30 points
   - Basic length validation (>100 chars): +20 points

**For Image Documents (JPG/JPEG/PNG)** (Line 43-68):
1. **Image Loading**: Uses `Jimp` to read and decode image
2. **QR Code Extraction** (Line 47-63):
   - Uses `jsQR` to scan for QR codes
   - If found: +30 points
   - **XML QR Format**: Parses Aadhaar XML structure using `xml2js`
     ```xml
     <PrintLetterBarcodeData uid="xxxx" name="..." dob="..." />
     ```
   - **Secure QR**: Stores raw data for future processing
3. **OCR Text Extraction** (Line 65-68):
   - Uses `Tesseract.js` OCR engine
   - Extracts all text from image
   - Language: English ('eng')

**Cross-Verification Logic** (Line 72-103):
1. **Base Score** (Line 76-78):
   - Contains "aadhaar" or "government of india": +30 points

2. **QR Data Matching** (Line 86-99):
   - Extract `name` and `uid` from QR XML
   - **Name Match**: Fuzzy string match between QR name and OCR text: +20 points
   - **UID Match**: Check if UID last 4 digits appear in OCR text: +20 points

3. **Scoring Summary**:
   - **Maximum Score**: 100 points
   - **Pass Threshold**: 80+ points
   - **VERIFIED**: Score >= 80 (sets `user.kyc = true`)
   - **REJECTED**: Score < 80 (sets `user.kyc = false`)

**Verification Metadata Stored**:
```typescript
verificationMeta: {
  qr1Decoded: boolean,        // Was QR code found and decoded?
  qrDataMatch: boolean,       // Did QR data match OCR text?
  textMatchScore: number      // Final verification score
}
```

### File Validation

**Upload Constraints** ([kyc.controller.ts](../packages/backend/src/modules/kyc/controllers/kyc.controller.ts#L16-L20)):
- **File Types**: 
  - PDF: `application/pdf`
  - Images: JPEG, JPG, PNG
  - Regex: `/(pdf|jpeg|jpg|png)$/`format (not PDF/JPG/PNG), size > 5MB |
| KYC already verified | 400 | Attempt to upload when kyc=true |
| Document processing | 400 | Upload while status=PROCESSING |
| No document found | 404 | Delete non-existent document |
| Cannot delete verified | 403 | Attempt to delete when status=VERIFIED |
| Processing error | Internal | PDF parse error, OCR failure, corrupt image |
| QR decode failure | - | Continues with OCR-only verifica

1. **Authentication Required**
   - All endpoints protected by `JwtAuthGuard`
   - User identified by JWT token

2. **State Validation**
   - Cannot upload if already verified
   - Cannot upload if document is processing
   - Cannot delete verified documents

3. **File Isolation**
   - Each user has separate directory
   - File names use UUIDs to prevent conflicts
   - Path traversal protection in storage service

4. **Idempotency**
   - Document ID generated server-side
   - Status transitions tracked in DB
   - Session history in MongoDB audit trail

### Error Handling

| Error | HTTP Status | Scenario |
|-------|-------------|----------|
| File validation failed | 422 | Invalid PDF, size > 5MB |
| KYC already verified | 400 | Attempt to upload when kyc=true |
| Document processing | 400 | Upload while status=PROCESSING |
| No document found | 404 | Delete non-existent document |
| Cannot delete verified | 403 | Attempt to delete when status=VERIFIED |
| Processing error | Internal | PDF parse error, file corruption |

### Status Flow

```
INITIAL STATE (no document)
    ↓
[User uploads] → PROCESSING (MongoDB + Queue job)
  Image Processing & Verification**:
- `jimp`: Image loading and manipulation
- `jsqr`: QR code decoding
- `tesseract.js`: OCR (Optical Character Recognition) engine
- `xml2js`: XML parsing for Aadhaar QR data

**Future**:
- `fast-levenshtein`: Fuzzy string matching (installed, ready for use
    └─→ REJECTED (score < 80, kyc=false)
```

  - PDF: 1-2 seconds
  - Image with OCR: 3-8 seconds (depends on image size/quality)
  - QR decoding: < 500ms
- **Status Polling**: Client should poll `/kyc/status` every 3-5

1. **Auth Module**: `JwtAuthGuard` for authentication
2. **Redis**: BullMQ uses Redis for queue management
3. **MongoDB**: User document persistence
4. **File System**: Local storage (ready for S3/Cloud migration)

### File References

- **Controller**: [packages/backend/src/modules/kyc/controllers/kyc.controller.ts](../packages/backend/src/modules/kyc/controllers/kyc.controller.ts)
- **Service**: [packages/backend/src/modules/kyc/services/kyc.service.ts](../packages/backend/src/modules/kyc/services/kyc.service.ts)
- **Storage**: [packages/backend/src/modules/kyc/services/document-storage.service.ts](../packages/backend/src/modules/kyc/services/document-storage.service.ts)
- **Processor**: [packages/backend/src/modules/kyc/processors/verification.processor.ts](../packages/backend/src/modules/kyc/processors/verification.processor.ts)
- **Module**: [packages/backend/src/modules/kyc/kyc.module.ts](../packages/backend/src/modules/kyc/kyc.module.ts)
- **User Schema**: [packages/backend/src/database/schemas/user.schema.ts](../packages/backend/src/database/schemas/user.schema.ts#L61-L95)

### Dependencies

**Core**:
- `@nestjs/bullmq` + `bullmq`: Queue management
- `@nestjs/platform-express` + `multer`: File upload
- `pdf-parse`: PDF text extraction

**Future** (installed, not yet used):
- `fast-levenshtein`: Fuzzy string matching
- `xml2js`: QR/XML data parsing
- `graphicsmagick`: Image/QR extraction (requires system deps)

### Processing Timing

- **Upload Response**: Immediate (< 100ms)
- **File Write**: Synchronous (< 500ms)
- **Queue Add**: < 50ms
- **Background Processing**: 1-5 seconds (depends on PDF size)
- **Status Polling**: Client should poll `/kyc/status` every 2-3 seconds

## Developer Onboarding Guide

1. **Upload Flow**: Start at [KycController.upload](../packages/backend/src/modules/kyc/controllers/kyc.controller.ts#L11) → [KycService.uploadDocument](../packages/backend/src/modules/kyc/services/kyc.service.ts#L18)

2. **Storage Layer**: Understand [DocumentStorageService.saveDocument](../packages/backend/src/modules/kyc/services/document-storage.service.ts#L15) for file handling

3. **Queue Job**: Follow job creation at [KycService.uploadDocument](../packages/backend/src/modules/kyc/services/kyc.service.ts#L46-L52)

4. **Verification Logic**: Core processing in [VerificationProcessor.process](../packages/backend/src/modules/kyc/processors/verification.processor.ts#L21-L71)

5. **Status Check**: Simple retrieval at [KycService.getStatus](../packages/backend/src/modules/kyc/services/kyc.service.ts#L62)

6. **Deletion**: Cleanup logic at [KycService.deleteDocument](../packages/backend/src/modules/kyc/services/kyc.service.ts#L70)

7. **Schema**: Review [User.kycDocuments](../packages/backend/src/database/schemas/user.schema.ts#L61-L95) for data structure

## Testing

**Unit Tests**: [kyc.service.spec.ts](../packages/backend/src/modules/kyc/services/kyc.service.spec.ts)
- Mocked dependencies (UserModel, Storage, Queue)
- 8 test cases covering all scenarios
- ✅ All tests passing

**Test Coverage**:
- Upload validation (already verified, already processing)
- Successful upload flow
- Status retrieval
- Document deletion (not found, verified, successful)
