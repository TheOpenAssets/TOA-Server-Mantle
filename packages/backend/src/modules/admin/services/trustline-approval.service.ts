import { Injectable, Logger, BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { TrustlineRequest, TrustlineRequestDocument, TrustlineRequestStatus } from '../../../database/schemas/trustline-request.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { UserPortfolioService } from '../../user-portfolio/services/user-portfolio.service';
import { NetworkRegistryService } from '../../blockchain/services/network-registry.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { NotificationType, NotificationSeverity, NotificationAction, NetworkType } from '@openassets/types';

interface TrustlineRequestFilters {
  status?: TrustlineRequestStatus;
  investorAddress?: string;
  assetId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

interface PaginationParams {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

@Injectable()
export class TrustlineApprovalService {
  private readonly logger = new Logger(TrustlineApprovalService.name);
  private adminWallets: string[] = [];

  constructor(
    @InjectModel(TrustlineRequest.name) private trustlineRequestModel: Model<TrustlineRequestDocument>,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    private userPortfolioService: UserPortfolioService,
    private networkRegistryService: NetworkRegistryService,
    private notificationService: NotificationService,
    private configService: ConfigService,
  ) {
    this.loadAdminWallets();
  }

  /**
   * Load admin wallets from config file
   */
  private loadAdminWallets() {
    try {
      const configPath = join(process.cwd(), 'configs', 'approved_admins.json');
      const configData = JSON.parse(readFileSync(configPath, 'utf8'));
      this.adminWallets = configData.admins || [];
      this.logger.log(`Loaded ${this.adminWallets.length} admin wallets for trustline notifications`);
    } catch (error: any) {
      this.logger.error(`Failed to load admin wallets: ${error.message}`);
      this.adminWallets = [];
    }
  }

  /**
   * Notify backend that investor has added a trustline (frontend already executed changeTrust)
   * Creates a pending trustline approval request
   */
  async notifyTrustlineAdded(
    investorAddress: string,
    assetId: string,
    network: string,
    txHash: string,
    blockNumber?: string
  ): Promise<{ success: boolean; requestId: string; status: string }> {
    // Validate network is stellar
    if (network.toLowerCase() !== 'stellar') {
      throw new BadRequestException('Trustline approval only available on Stellar network');
    }

    // Fetch asset from Assets collection
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new NotFoundException(`Asset with ID ${assetId} not found`);
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
      assetId,
      status: TrustlineRequestStatus.PENDING,
    });

    if (existingRequest) {
      this.logger.log(`Duplicate trustline request detected for investor ${investorAddress} and asset ${assetId}, returning existing request`);
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
      assetId,
      assetCode,
      issuerAddress,
      network,
      trustlineTransactionHash: txHash,
      blockNumber,
      status: TrustlineRequestStatus.PENDING,
    });

    this.logger.log(`Created trustline request ${requestId} for investor ${investorAddress} and asset ${assetId}`);

    // Update portfolio: add assetId to requested_trustlines
    await this.userPortfolioService.addRequestedTrustline(investorAddress, assetId, network as NetworkType);

    // Notify all admins
    await this.notifyAllAdmins(
      'New Trustline Request',
      `Investor ${investorAddress.slice(0, 8)}... requested approval for asset ${asset.metadata?.invoiceNumber || assetCode}`,
      {
        requestId,
        assetId,
        investorAddress,
        assetCode,
      }
    );

    return {
      success: true,
      requestId,
      status: request.status,
    };
  }

  /**
   * Admin approves a trustline request
   * Executes blockchain transaction and updates state
   */
  async approveTrustline(
    requestId: string,
    adminWallet: string
  ): Promise<{ success: boolean; transactionHash?: string; request: TrustlineRequest }> {
    // Fetch TrustlineRequest by requestId
    const request = await this.trustlineRequestModel.findOne({ requestId });
    if (!request) {
      throw new NotFoundException(`Trustline request with ID ${requestId} not found`);
    }

    // Validate status is PENDING
    if (request.status !== TrustlineRequestStatus.PENDING) {
      throw new BadRequestException(`Trustline request is already ${request.status}`);
    }

    // Fetch asset for metadata
    const asset = await this.assetModel.findOne({ assetId: request.assetId });

    try {
      // Build asset identifier for Stellar (assetCode:issuerAddress)
      const assetIdentifier = `${request.assetCode}:${request.issuerAddress}`;

      // Call NetworkRegistryService.approveTrustlineForUser
      this.logger.log(`Admin ${adminWallet} approving trustline for investor ${request.investorAddress} and asset ${assetIdentifier}`);
      
      const result = await this.networkRegistryService.approveTrustlineForUser(
        request.investorAddress,
        assetIdentifier
      );

      // Handle different response types
      // Case 1: Skipped (not Stellar network or method not supported)
      if ('completed' in result && !result.completed) {
        throw new ServiceUnavailableException(
          `Failed to approve trustline on blockchain: ${result.reason || 'Unknown error'}`
        );
      }

      // Case 2: Success - adapter returned txId
      const txId = 'txId' in result ? result.txId : undefined;
      if (!txId) {
        throw new ServiceUnavailableException('Failed to get transaction ID from blockchain adapter');
      }

      // Update TrustlineRequest: set status=APPROVED
      request.status = TrustlineRequestStatus.APPROVED;
      request.reviewedBy = adminWallet;
      request.reviewedAt = new Date();
      request.approvalTransactionHash = txId;
      await request.save();

      this.logger.log(`Trustline request ${requestId} approved successfully`);

      // Update portfolio: move from requested to approved
      await this.userPortfolioService.approveTrustline(
        request.investorAddress,
        request.assetId,
        request.network as NetworkType
      );

      // Notify investor
      await this.notificationService.create({
        userId: request.investorAddress,
        walletAddress: request.investorAddress,
        header: 'Trustline Approved',
        detail: `Your trustline for asset ${asset?.metadata?.invoiceNumber || request.assetCode} has been approved. You can now purchase tokens.`,
        type: NotificationType.TRUSTLINE_APPROVED,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_MARKETPLACE,
        actionMetadata: {
          requestId,
          assetId: request.assetId,
        },
      });

      return {
        success: true,
        transactionHash: txId,
        request: request.toObject(),
      };
    } catch (error: any) {
      this.logger.error(`Failed to approve trustline ${requestId}: ${error.message}`, error.stack);
      
      // Keep request status as PENDING so admin can retry
      throw new ServiceUnavailableException(
        `Failed to approve trustline on blockchain: ${error.message}`
      );
    }
  }

  /**
   * Get pending (or filtered) trustline requests
   */
  async getPendingRequests(
    filters: TrustlineRequestFilters = {},
    pagination: PaginationParams = {}
  ): Promise<{
    requests: any[];
    totalCount: number;
    page: number;
    limit: number;
  }> {
    // Build MongoDB query
    const query: any = {};

    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.investorAddress) {
      query.investorAddress = filters.investorAddress;
    }
    if (filters.assetId) {
      query.assetId = filters.assetId;
    }
    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) {
        query.createdAt.$gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        query.createdAt.$lte = filters.dateTo;
      }
    }

    // Pagination
    const limit = pagination.limit || 20;
    const offset = pagination.offset || 0;
    const page = Math.floor(offset / limit) + 1;

    // Sort
    const sortBy = pagination.sortBy || 'createdAt';
    const sortOrder = pagination.sortOrder === 'asc' ? 1 : -1;
    const sort: any = { [sortBy]: sortOrder };

    // Execute query
    const [requests, totalCount] = await Promise.all([
      this.trustlineRequestModel
        .find(query)
        .sort(sort)
        .skip(offset)
        .limit(limit)
        .lean(),
      this.trustlineRequestModel.countDocuments(query),
    ]);

    // Populate with asset metadata
    const enrichedRequests = await Promise.all(
      requests.map(async (request) => {
        const asset = await this.assetModel.findOne({ assetId: request.assetId }).lean();
        return {
          ...request,
          assetMetadata: asset
            ? {
                name: asset.metadata?.invoiceNumber || 'N/A',
                assetCode: asset.registry?.assetCode,
                industry: asset.metadata?.industry,
                riskTier: asset.metadata?.riskTier,
              }
            : null,
        };
      })
    );

    return {
      requests: enrichedRequests,
      totalCount,
      page,
      limit,
    };
  }

  /**
   * Get single trustline request by ID
   */
  async getRequestById(requestId: string): Promise<any> {
    const request = await this.trustlineRequestModel.findOne({ requestId }).lean();
    if (!request) {
      throw new NotFoundException(`Trustline request with ID ${requestId} not found`);
    }

    // Populate with asset metadata
    const asset = await this.assetModel.findOne({ assetId: request.assetId }).lean();

    return {
      ...request,
      assetMetadata: asset
        ? {
            name: asset.metadata?.invoiceNumber || 'N/A',
            assetCode: asset.registry?.assetCode,
            industry: asset.metadata?.industry,
            riskTier: asset.metadata?.riskTier,
            assetType: asset.assetType,
          }
        : null,
    };
  }

  /**
   * Notify all admin users
   */
  private async notifyAllAdmins(header: string, detail: string, metadata?: any) {
    this.logger.log(`Notifying ${this.adminWallets.length} admin users: ${header}`);

    for (const adminWallet of this.adminWallets) {
      try {
        await this.notificationService.create({
          userId: adminWallet,
          walletAddress: adminWallet,
          header,
          detail,
          type: NotificationType.TRUSTLINE_REQUEST,
          severity: NotificationSeverity.INFO,
          action: NotificationAction.VIEW_TRUSTLINE_REQUESTS,
          actionMetadata: metadata,
        });
      } catch (error: any) {
        this.logger.error(`Failed to send notification to admin ${adminWallet}: ${error.message}`);
        // Continue notifying other admins even if one fails
      }
    }
  }
}
