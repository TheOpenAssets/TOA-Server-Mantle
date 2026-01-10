import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import {
  PrivateAsset,
  PrivateAssetDocument,
  PrivateAssetType,
} from '../../../database/schemas/private-asset.schema';
import {
  PrivateAssetRequest,
  PrivateAssetRequestDocument,
  PrivateAssetRequestStatus,
} from '../../../database/schemas/private-asset-request.schema';
import { WalletService } from '../../blockchain/services/wallet.service';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';
import { SolvencyBlockchainService } from './solvency-blockchain.service';
import { Address, createPublicClient, http, PublicClient } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class PrivateAssetService {
  private readonly logger = new Logger(PrivateAssetService.name);
  private publicClient: PublicClient;

  constructor(
    @InjectModel(PrivateAsset.name)
    private privateAssetModel: Model<PrivateAssetDocument>,
    @InjectModel(PrivateAssetRequest.name)
    private privateAssetRequestModel: Model<PrivateAssetRequestDocument>,
    private walletService: WalletService,
    private contractLoader: ContractLoaderService,
    private configService: ConfigService,
    private solvencyBlockchainService: SolvencyBlockchainService,
  ) {
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });
  }

  /**
   * Mint new Private Asset Token
   */
  async mintPrivateAsset(params: {
    name: string;
    symbol: string;
    assetType: PrivateAssetType;
    totalSupply: string;
    valuation: string;
    location?: string;
    documentHash?: string;
    issuer: string;
  }): Promise<PrivateAssetDocument> {
    this.logger.log(`Minting private asset token: ${params.name} (${params.symbol})`);

    // Generate unique assetId
    const assetId = ethers.id(
      `${params.name}-${params.symbol}-${Date.now()}`
    );

    // Deploy via TokenFactory
    const wallet = this.walletService.getPlatformWallet();
    
    const factoryAddress = this.contractLoader.getContractAddress('TokenFactory');
    const factoryAbi = this.contractLoader.getContractAbi('TokenFactory');

    this.logger.log(`Deploying PrivateAssetToken via TokenFactory...`);

    const hash = await wallet.writeContract({
      address: factoryAddress as Address,
      abi: factoryAbi,
      functionName: 'deployPrivateAssetTokenSuite',
      args: [
        assetId as `0x${string}`,
        BigInt(params.totalSupply),
        params.name,
        params.symbol,
        params.issuer as Address,
        params.assetType,
        params.location || '',
        BigInt(params.valuation),
        params.documentHash || '',
      ],
    });

    this.logger.log(`Deployment transaction submitted: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
    });

    this.logger.log(`Deployment confirmed in block ${receipt.blockNumber}`);

    // Parse PrivateAssetTokenDeployed event to get addresses
    const logs = await this.publicClient.getLogs({
      address: factoryAddress as Address,
      event: {
        type: 'event',
        name: 'PrivateAssetTokenDeployed',
        inputs: [
          { name: 'assetId', type: 'bytes32', indexed: true },
          { name: 'token', type: 'address', indexed: false },
          { name: 'compliance', type: 'address', indexed: false },
          { name: 'totalSupply', type: 'uint256', indexed: false },
          { name: 'assetType', type: 'string', indexed: false },
          { name: 'valuation', type: 'uint256', indexed: false },
        ],
      },
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });

    if (logs.length === 0) {
      throw new BadRequestException('Failed to parse deployment event');
    }

    const log = logs[0]!;
    const tokenAddress = log.args.token as string;
    const complianceAddress = log.args.compliance as string;

    this.logger.log(`Token deployed at: ${tokenAddress}`);
    this.logger.log(`Compliance deployed at: ${complianceAddress}`);

    // Create database record
    const privateAsset = new this.privateAssetModel({
      assetId,
      tokenAddress,
      assetType: params.assetType,
      name: params.name,
      symbol: params.symbol,
      totalSupply: params.totalSupply,
      valuation: params.valuation,
      valuationDate: new Date(),
      location: params.location,
      documentHash: params.documentHash,
      issuer: params.issuer,
      isActive: true,
      deploymentTxHash: hash,
      deploymentBlockNumber: Number(receipt.blockNumber),
      complianceModuleAddress: complianceAddress,
      valuationHistory: [
        {
          valuation: params.valuation,
          valuationDate: new Date(),
          updatedBy: params.issuer,
        },
      ],
      activeSolvencyPositions: 0,
      totalCollateralLocked: '0',
      totalUsdcBorrowed: '0',
    });

    await privateAsset.save();
    this.logger.log(`Private asset ${assetId} saved to database`);

    return privateAsset;
  }

  /**
   * Get private asset by ID
   */
  async getPrivateAsset(assetId: string): Promise<PrivateAssetDocument> {
    const asset = await this.privateAssetModel.findOne({ assetId });

    if (!asset) {
      throw new NotFoundException(`Private asset ${assetId} not found`);
    }

    return asset;
  }

  /**
   * Get private asset by token address
   */
  async getPrivateAssetByToken(tokenAddress: string): Promise<PrivateAssetDocument> {
    const asset = await this.privateAssetModel.findOne({ tokenAddress });

    if (!asset) {
      throw new NotFoundException(`Private asset with token ${tokenAddress} not found`);
    }

    return asset;
  }

  /**
   * Get all private assets
   */
  async getAllPrivateAssets(
    assetType?: PrivateAssetType,
    isActive?: boolean,
  ): Promise<PrivateAsset[]> {
    const query: any = {};

    if (assetType) {
      query.assetType = assetType;
    }

    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    return this.privateAssetModel.find(query).sort({ createdAt: -1 }).exec();
  }

  /**
   * Get private assets by issuer
   */
  async getAssetsByIssuer(issuer: string): Promise<PrivateAsset[]> {
    return this.privateAssetModel
      .find({ issuer })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Update private asset valuation
   */
  async updateValuation(
    assetId: string,
    newValuation: string,
    updatedBy: string,
  ): Promise<PrivateAssetDocument> {
    const asset = await this.getPrivateAsset(assetId);

    this.logger.log(`Updating valuation for asset ${assetId}`);
    this.logger.log(`Old: ${asset.valuation}, New: ${newValuation}`);

    // Update on-chain
    const wallet = this.walletService.getPlatformWallet();
    
    const tokenAbi = this.contractLoader.getContractAbi('PrivateAssetToken');

    const hash = await wallet.writeContract({
      address: asset.tokenAddress as Address,
      abi: tokenAbi,
      functionName: 'updateValuation',
      args: [BigInt(newValuation)],
    });

    this.logger.log(`Valuation update transaction submitted: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
    });

    this.logger.log(`Valuation update confirmed in block ${receipt.blockNumber}`);

    // Update database
    asset.valuation = newValuation;
    asset.valuationDate = new Date();

    asset.valuationHistory?.push({
      valuation: newValuation,
      valuationDate: new Date(),
      updatedBy,
      updateTxHash: hash,
    });

    await asset.save();
    this.logger.log(`Asset ${assetId} valuation updated in database`);

    return asset;
  }

  /**
   * Update asset status
   */
  async updateAssetStatus(assetId: string, isActive: boolean): Promise<PrivateAssetDocument> {
    const asset = await this.getPrivateAsset(assetId);

    // Update on-chain
    const wallet = this.walletService.getPlatformWallet();
    
    const tokenAbi = this.contractLoader.getContractAbi('PrivateAssetToken');

    const hash = await wallet.writeContract({
      address: asset.tokenAddress as Address,
      abi: tokenAbi,
      functionName: 'setActive',
      args: [isActive],
    });

    await this.publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });

    // Update database
    asset.isActive = isActive;
    await asset.save();

    this.logger.log(`Asset ${assetId} status updated to ${isActive ? 'active' : 'inactive'}`);

    return asset;
  }

  /**
   * Update collateral tracking when position is created/modified
   */
  async updateCollateralTracking(
    tokenAddress: string,
    collateralChange: string,
    debtChange: string,
    positionDelta: number,
  ): Promise<void> {
    const asset = await this.getPrivateAssetByToken(tokenAddress);

    const currentCollateral = BigInt(asset.totalCollateralLocked);
    const currentDebt = BigInt(asset.totalUsdcBorrowed);

    asset.totalCollateralLocked = (currentCollateral + BigInt(collateralChange)).toString();
    asset.totalUsdcBorrowed = (currentDebt + BigInt(debtChange)).toString();
    asset.activeSolvencyPositions += positionDelta;

    await asset.save();
    this.logger.log(`Updated collateral tracking for asset ${asset.assetId}`);
  }

  /**
   * Get valuation history for asset
   */
  async getValuationHistory(assetId: string): Promise<PrivateAsset['valuationHistory']> {
    const asset = await this.getPrivateAsset(assetId);
    return asset.valuationHistory || [];
  }

  /**
   * Get private asset statistics
   */
  async getAssetStatistics(): Promise<{
    totalAssets: number;
    activeAssets: number;
    totalValueLocked: string;
    totalCollateralLocked: string;
    totalUsdcBorrowed: string;
    assetsByType: Record<PrivateAssetType, number>;
  }> {
    const allAssets = await this.privateAssetModel.find({});
    const activeAssets = allAssets.filter((a) => a.isActive);

    let totalValueLocked = 0n;
    let totalCollateralLocked = 0n;
    let totalUsdcBorrowed = 0n;

    const assetsByType: Record<PrivateAssetType, number> = {
      [PrivateAssetType.DEED]: 0,
      [PrivateAssetType.BOND]: 0,
      [PrivateAssetType.INVOICE]: 0,
      [PrivateAssetType.EQUIPMENT]: 0,
      [PrivateAssetType.OTHER]: 0,
    };

    for (const asset of allAssets) {
      totalValueLocked += BigInt(asset.valuation);
      totalCollateralLocked += BigInt(asset.totalCollateralLocked);
      totalUsdcBorrowed += BigInt(asset.totalUsdcBorrowed);
      assetsByType[asset.assetType]++;
    }

    return {
      totalAssets: allAssets.length,
      activeAssets: activeAssets.length,
      totalValueLocked: totalValueLocked.toString(),
      totalCollateralLocked: totalCollateralLocked.toString(),
      totalUsdcBorrowed: totalUsdcBorrowed.toString(),
      assetsByType,
    };
  }

  // ========== Private Asset Request Methods ==========

  /**
   * Create a new private asset upload request
   */
  async createAssetRequest(
    requesterAddress: string,
    requesterRole: string,
    params: {
      name: string;
      assetType: PrivateAssetType;
      location?: string;
      claimedValuation: string;
      documentHash: string;
      documentUrl?: string;
      description?: string;
      metadata?: any;
    },
  ): Promise<PrivateAssetRequestDocument> {
    this.logger.log(`Creating private asset request for ${requesterAddress}`);

    const request = new this.privateAssetRequestModel({
      requestId: uuidv4(),
      requesterAddress: requesterAddress.toLowerCase(),
      requesterRole,
      name: params.name,
      assetType: params.assetType,
      location: params.location,
      claimedValuation: params.claimedValuation,
      documentHash: params.documentHash,
      documentUrl: params.documentUrl,
      description: params.description,
      metadata: params.metadata,
      status: PrivateAssetRequestStatus.PENDING,
    });

    await request.save();
    this.logger.log(`Private asset request created: ${request.requestId}`);

    return request;
  }

  /**
   * Get all pending private asset requests (admin)
   */
  async getPendingRequests(): Promise<PrivateAssetRequest[]> {
    return this.privateAssetRequestModel
      .find({ status: PrivateAssetRequestStatus.PENDING })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Get all requests (admin) with optional status filter
   */
  async getAllRequests(status?: PrivateAssetRequestStatus): Promise<PrivateAssetRequest[]> {
    const query = status ? { status } : {};
    return this.privateAssetRequestModel
      .find(query)
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Get request by ID
   */
  async getRequest(requestId: string): Promise<PrivateAssetRequestDocument> {
    const request = await this.privateAssetRequestModel.findOne({ requestId });

    if (!request) {
      throw new NotFoundException(`Private asset request ${requestId} not found`);
    }

    return request;
  }

  /**
   * Get all requests by requester
   */
  async getUserRequests(requesterAddress: string): Promise<PrivateAssetRequest[]> {
    return this.privateAssetRequestModel
      .find({ requesterAddress: requesterAddress.toLowerCase() })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Approve private asset request
   * This mints the token and deposits directly to SolvencyVault
   */
  async approveRequest(
    requestId: string,
    adminAddress: string,
    finalValuation: string,
    notes?: string,
  ): Promise<{
    request: PrivateAssetRequestDocument;
    asset: PrivateAssetDocument;
    mintTxHash: string;
  }> {
    const request = await this.getRequest(requestId);

    if (request.status !== PrivateAssetRequestStatus.PENDING) {
      throw new BadRequestException(`Request ${requestId} is not pending`);
    }

    this.logger.log(`Approving private asset request: ${requestId}`);
    this.logger.log(`Claimed valuation: ${request.claimedValuation}, Final: ${finalValuation}`);

    // Generate symbol (e.g., DEED-001)
    const count = await this.privateAssetModel.countDocuments({ assetType: request.assetType });
    const symbol = `${request.assetType}-${String(count + 1).padStart(3, '0')}`;

    // Mint token (1 whole token = 1e18 wei)
    const totalSupply = ethers.parseEther('1').toString();

    const asset = await this.mintPrivateAsset({
      name: request.name,
      symbol,
      assetType: request.assetType,
      totalSupply,
      valuation: finalValuation,
      location: request.location,
      documentHash: request.documentHash,
      issuer: request.requesterAddress,
    });

    // Update request with approval details
    request.status = PrivateAssetRequestStatus.APPROVED;
    request.finalValuation = finalValuation;
    request.reviewedBy = adminAddress.toLowerCase();
    request.reviewedAt = new Date();
    request.tokenAddress = asset.tokenAddress;
    request.tokenSymbol = symbol;
    request.assetId = asset.assetId;
    request.mintTransactionHash = asset.deploymentTxHash;

    // Deposit directly to SolvencyVault (entire token supply = 1e18 wei)
    this.logger.log(`Depositing private asset to SolvencyVault for user ${request.requesterAddress}`);

    const depositResult = await this.solvencyBlockchainService.depositCollateral(
      request.requesterAddress, // User who owns the position
      asset.tokenAddress,       // Collateral token address
      totalSupply,              // Amount: 1 whole token (1e18 wei)
      finalValuation,           // Token value in USD (6 decimals)
      'PRIVATE_ASSET',          // Token type
      true,                     // Issue OAID credit line
    );

    this.logger.log(`Deposit successful. Position ID: ${depositResult.positionId}, TxHash: ${depositResult.txHash}`);

    // Update request with solvency position details
    request.solvencyPositionId = depositResult.positionId;
    request.depositTransactionHash = depositResult.txHash;

    await request.save();
    this.logger.log(`Private asset request approved and deposited: ${requestId}`);

    return {
      request,
      asset,
      mintTxHash: asset.deploymentTxHash,
    };
  }

  /**
   * Reject private asset request
   */
  async rejectRequest(
    requestId: string,
    adminAddress: string,
    rejectionReason: string,
  ): Promise<PrivateAssetRequestDocument> {
    const request = await this.getRequest(requestId);

    if (request.status !== PrivateAssetRequestStatus.PENDING) {
      throw new BadRequestException(`Request ${requestId} is not pending`);
    }

    this.logger.log(`Rejecting private asset request: ${requestId}`);

    request.status = PrivateAssetRequestStatus.REJECTED;
    request.reviewedBy = adminAddress.toLowerCase();
    request.reviewedAt = new Date();
    request.rejectionReason = rejectionReason;

    await request.save();
    this.logger.log(`Private asset request rejected: ${requestId}`);

    return request;
  }
}
