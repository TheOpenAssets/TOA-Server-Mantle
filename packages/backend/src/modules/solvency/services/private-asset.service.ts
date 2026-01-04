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
import { WalletService } from '../../blockchain/services/wallet.service';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';
import { Address, createPublicClient, http, PublicClient } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';

@Injectable()
export class PrivateAssetService {
  private readonly logger = new Logger(PrivateAssetService.name);
  private publicClient: PublicClient;

  constructor(
    @InjectModel(PrivateAsset.name)
    private privateAssetModel: Model<PrivateAssetDocument>,
    private walletService: WalletService,
    private contractLoader: ContractLoaderService,
    private configService: ConfigService,
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
}
