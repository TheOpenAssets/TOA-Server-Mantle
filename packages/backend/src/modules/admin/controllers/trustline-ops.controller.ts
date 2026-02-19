import { Controller, Post, Get, Body, Param, Query, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsUUID, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { TrustlineApprovalService } from '../services/trustline-approval.service';
import { TrustlineRequestStatus } from '../../../database/schemas/trustline-request.schema';

export class ApproveTrustlineDto {
  @ApiProperty({ description: 'Trustline request UUID', example: 'f64a0f2f-9c17-43a1-b376-d829ae5595b4' })
  @IsUUID()
  @IsNotEmpty()
  requestId!: string;

  @ApiProperty({ description: 'Admin wallet address', example: 'GCDWG5NGM5FPSEHHTEFLWOAN56ONS2F5EAJBOOYZGOV4YWX42N5TDAOZ' })
  @IsString()
  @IsNotEmpty()
  adminWallet!: string;
}

export class TrustlineRequestQueryDto {
  @ApiProperty({ description: 'Filter by status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  @IsOptional()
  @IsEnum(TrustlineRequestStatus)
  status?: TrustlineRequestStatus;

  @ApiProperty({ description: 'Filter by investor address', required: false })
  @IsOptional()
  @IsString()
  investorAddress?: string;

  @ApiProperty({ description: 'Filter by asset ID', required: false })
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiProperty({ description: 'Filter by date from (ISO 8601)', required: false })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiProperty({ description: 'Filter by date to (ISO 8601)', required: false })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiProperty({ description: 'Limit results', required: false, example: 20 })
  @IsOptional()
  limit?: string;

  @ApiProperty({ description: 'Offset for pagination', required: false, example: 0 })
  @IsOptional()
  offset?: string;

  @ApiProperty({ description: 'Sort by field', required: false, example: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiProperty({ description: 'Sort order', required: false, enum: ['asc', 'desc'] })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

@ApiTags('Admin - Trustline Operations')
@Controller('admin/trustline-requests')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
@ApiBearerAuth()
export class TrustlineOpsController {
  private readonly logger = new Logger(TrustlineOpsController.name);

  constructor(private trustlineApprovalService: TrustlineApprovalService) {}

  @Get()
  @ApiOperation({
    summary: 'Get trustline requests with filters',
    description: 'Admin endpoint to query pending, approved, or rejected trustline requests with various filters',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  @ApiQuery({ name: 'investorAddress', required: false, type: String })
  @ApiQuery({ name: 'assetId', required: false, type: String })
  @ApiQuery({ name: 'dateFrom', required: false, type: String })
  @ApiQuery({ name: 'dateTo', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  @ApiQuery({ name: 'sortBy', required: false, type: String, example: 'createdAt' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of trustline requests',
    schema: {
      type: 'object',
      properties: {
        requests: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              requestId: { type: 'string' },
              investorAddress: { type: 'string' },
              assetId: { type: 'string' },
              assetCode: { type: 'string' },
              status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
              createdAt: { type: 'string', format: 'date-time' },
              reviewedAt: { type: 'string', format: 'date-time' },
              assetMetadata: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  assetCode: { type: 'string' },
                  industry: { type: 'string' },
                  riskTier: { type: 'string' },
                },
              },
            },
          },
        },
        totalCount: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden - not an admin' })
  async getTrustlineRequests(@Query() query: TrustlineRequestQueryDto) {
    this.logger.log(`Admin querying trustline requests with filters: ${JSON.stringify(query)}`);

    const filters: any = {};
    if (query.status) filters.status = query.status;
    if (query.investorAddress) filters.investorAddress = query.investorAddress;
    if (query.assetId) filters.assetId = query.assetId;
    if (query.dateFrom) filters.dateFrom = new Date(query.dateFrom);
    if (query.dateTo) filters.dateTo = new Date(query.dateTo);

    const pagination = {
      limit: query.limit ? parseInt(query.limit) : 20,
      offset: query.offset ? parseInt(query.offset) : 0,
      sortBy: query.sortBy || 'createdAt',
      sortOrder: query.sortOrder || 'desc',
    };

    return this.trustlineApprovalService.getPendingRequests(filters, pagination);
  }

  @Get(':requestId')
  @ApiOperation({
    summary: 'Get single trustline request by ID',
    description: 'Returns detailed information about a specific trustline request',
  })
  @ApiResponse({
    status: 200,
    description: 'Trustline request details',
    schema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        investorAddress: { type: 'string' },
        assetId: { type: 'string' },
        assetCode: { type: 'string' },
        issuerAddress: { type: 'string' },
        network: { type: 'string' },
        trustlineTransactionHash: { type: 'string' },
        status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
        reviewedBy: { type: 'string' },
        reviewedAt: { type: 'string', format: 'date-time' },
        approvalTransactionHash: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
        assetMetadata: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            assetCode: { type: 'string' },
            industry: { type: 'string' },
            riskTier: { type: 'string' },
            assetType: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden - not an admin' })
  @ApiResponse({ status: 404, description: 'Trustline request not found' })
  async getRequestById(@Param('requestId') requestId: string) {
    this.logger.log(`Admin fetching trustline request ${requestId}`);
    return this.trustlineApprovalService.getRequestById(requestId);
  }

  @Post('approve')
  @ApiOperation({
    summary: 'Approve a trustline request',
    description: 'Executes blockchain approval transaction and updates request status',
  })
  @ApiResponse({
    status: 200,
    description: 'Trustline approved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        transactionHash: { type: 'string' },
        request: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
            status: { type: 'string', example: 'APPROVED' },
            reviewedBy: { type: 'string' },
            reviewedAt: { type: 'string', format: 'date-time' },
            approvalTransactionHash: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request - request not in PENDING status' })
  @ApiResponse({ status: 401, description: 'Unauthorized - invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden - not an admin' })
  @ApiResponse({ status: 404, description: 'Trustline request not found' })
  @ApiResponse({ status: 503, description: 'Service unavailable - blockchain call failed' })
  async approveTrustline(@Body() dto: ApproveTrustlineDto) {
    this.logger.log(`Admin ${dto.adminWallet} approving trustline request ${dto.requestId}`);
    return this.trustlineApprovalService.approveTrustline(dto.requestId, dto.adminWallet);
  }
}
