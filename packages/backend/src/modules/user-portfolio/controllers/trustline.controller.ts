import { Controller, Post, Get, Body, Param, Query, UseGuards, Request, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { v4 as uuidv4 } from 'uuid';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserPortfolioService } from '../services/user-portfolio.service';
import { NotifyTrustlineDto, CheckAbilityResponseDto } from '../dto/trustline.dto';
import { TrustlineRequestStatus } from '../../../database/schemas/trustline-request.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TrustlineRequest, TrustlineRequestDocument } from '../../../database/schemas/trustline-request.schema';
import { UserPortfolio, UserPortfolioDocument } from '../schemas/user-portfolio.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';

@ApiTags('Trustline')
@Controller('trustline')
export class TrustlineController {
  private readonly logger = new Logger(TrustlineController.name);

  constructor(
    private userPortfolioService: UserPortfolioService,
    @InjectModel(TrustlineRequest.name) private trustlineRequestModel: Model<TrustlineRequestDocument>,
    @InjectModel(UserPortfolio.name) private portfolioModel: Model<UserPortfolioDocument>,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
  ) {}

  @Post('add-trustline-notify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Notify backend that investor has added trustline',
    description: 'Frontend executes changeTrust transaction with investor private key, then notifies backend. Backend creates pending approval request.',
  })
  @ApiResponse({
    status: 200,
    description: 'Trustline request created or existing request returned',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        requestId: { type: 'string', example: 'f64a0f2f-9c17-43a1-b376-d829ae5595b4' },
        status: { type: 'string', example: 'PENDING' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request - validation error or non-Stellar asset' })
  @ApiResponse({ status: 401, description: 'Unauthorized - invalid JWT' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async addTrustlineNotify(@Request() req: any, @Body() dto: NotifyTrustlineDto) {
    const investorAddress = req.user.walletAddress;
    this.logger.log(`Investor ${investorAddress} notifying trustline addition for asset ${dto.assetId} with txHash ${dto.txHash}`);

    // Validate network is stellar
    if (dto.network.toLowerCase() !== 'stellar') {
      throw new BadRequestException('Trustline approval only available on Stellar network');
    }

    // Fetch asset from Assets collection
    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (!asset) {
      throw new NotFoundException(`Asset with ID ${dto.assetId} not found`);
    }

    // Validate it's a Stellar asset
    if (asset.network !== 'stellar') {
      throw new BadRequestException('Cannot request trustline for non-Stellar asset');
    }

    // Extract assetCode and issuerAddress from asset
    const assetCode = asset.registry?.assetCode;
    const issuerAddress = asset.token?.address;

    if (!assetCode || !issuerAddress) {
      throw new BadRequestException('Asset does not have required Stellar registry information');
    }

    // Check for duplicate request (idempotent)
    const existingRequest = await this.trustlineRequestModel.findOne({
      investorAddress,
      assetId: dto.assetId,
      status: TrustlineRequestStatus.PENDING,
    });

    if (existingRequest) {
      this.logger.log(`Duplicate trustline request detected for investor ${investorAddress} and asset ${dto.assetId}, returning existing request`);
      return {
        success: true,
        requestId: existingRequest.requestId,
        status: existingRequest.status,
      };
    }

    // Generate UUID for requestId
    const requestId = uuidv4();

    // Create TrustlineRequest with status=PENDING
    const request = await this.trustlineRequestModel.create({
      requestId,
      investorAddress,
      assetId: dto.assetId,
      assetCode,
      issuerAddress,
      network: dto.network,
      trustlineTransactionHash: dto.txHash,
      blockNumber: dto.blockNumber,
      status: TrustlineRequestStatus.PENDING,
    });

    this.logger.log(`Created trustline request ${requestId} for investor ${investorAddress} and asset ${dto.assetId}`);

    // Update portfolio: add assetId to requested_trustlines
    await this.userPortfolioService.addRequestedTrustline(investorAddress, dto.network, dto.assetId);

    // Note: Admin notification is handled by TrustlineApprovalService in AdminModule
    // via event listener or admin polling the endpoint

    return {
      success: true,
      requestId,
      status: request.status,
    };
  }

  @Get('check-ability-to-buy/:assetId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Check if investor can purchase tokens for an asset',
    description: 'Returns purchase eligibility based on trustline approval status',
  })
  @ApiResponse({
    status: 200,
    description: 'Eligibility check result',
    type: CheckAbilityResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - invalid JWT' })
  async checkAbilityToBuy(@Request() req: any, @Param('assetId') assetId: string): Promise<CheckAbilityResponseDto> {
    const investorAddress = req.user.walletAddress;
    this.logger.log(`Checking purchase ability for investor ${investorAddress} and asset ${assetId}`);

    // Query portfolio for trustline arrays
    const portfolio = await this.portfolioModel.findOne({
      walletAddress: investorAddress.toLowerCase(),
      network: 'stellar', // Trustlines are Stellar-specific
    }).lean();

    if (!portfolio) {
      return {
        canBuy: false,
        trustlineStatus: 'NOT_REQUESTED',
        reason: 'Trustline not yet requested',
      };
    }

    // Check approved trustlines
    if (portfolio.approved_trustlines?.includes(assetId)) {
      return {
        canBuy: true,
        trustlineStatus: 'APPROVED',
      };
    }

    // Check requested trustlines
    if (portfolio.requested_trustlines?.includes(assetId)) {
      return {
        canBuy: false,
        trustlineStatus: 'PENDING',
        reason: 'Trustline approval pending',
      };
    }

    // Not requested yet
    return {
      canBuy: false,
      trustlineStatus: 'NOT_REQUESTED',
      reason: 'Trustline not yet requested',
    };
  }

  @Get('my-requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get investor trustline requests',
    description: 'Returns paginated list of investor trustline requests with optional status filter',
  })
  @ApiResponse({
    status: 200,
    description: 'List of trustline requests',
    schema: {
      type: 'object',
      properties: {
        requests: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              requestId: { type: 'string' },
              assetId: { type: 'string' },
              assetCode: { type: 'string' },
              status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
              createdAt: { type: 'string', format: 'date-time' },
              reviewedAt: { type: 'string', format: 'date-time' },
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
  async getMyRequests(
    @Request() req: any,
    @Query('status') status?: TrustlineRequestStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const investorAddress = req.user.walletAddress;
    this.logger.log(`Fetching trustline requests for investor ${investorAddress}`);

    const query: any = { investorAddress };
    if (status) {
      query.status = status;
    }

    const limitNum = limit ? parseInt(limit) : 20;
    const offsetNum = offset ? parseInt(offset) : 0;

    const [requests, totalCount] = await Promise.all([
      this.trustlineRequestModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(offsetNum)
        .limit(limitNum)
        .lean(),
      this.trustlineRequestModel.countDocuments(query),
    ]);

    return {
      requests,
      totalCount,
      page: Math.floor(offsetNum / limitNum) + 1,
      limit: limitNum,
    };
  }
}
