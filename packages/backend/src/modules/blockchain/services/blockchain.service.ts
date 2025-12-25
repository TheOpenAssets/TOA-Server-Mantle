import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Hash, Address, decodeEventLog } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { ContractLoaderService } from './contract-loader.service';
import { WalletService } from './wallet.service';
import { RegisterAssetDto } from '../dto/register-asset.dto';
import { DeployTokenDto } from '../dto/deploy-token.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private publicClient;

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
    private walletService: WalletService,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
  ) {
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });
  }

  async registerAsset(dto: RegisterAssetDto): Promise<Hash> {
    const { assetId, attestationHash, blobId, payload, signature } = dto;
    const wallet = this.walletService.getAdminWallet();
    const address = this.contractLoader.getContractAddress('AttestationRegistry');
    const abi = this.contractLoader.getContractAbi('AttestationRegistry');

    this.logger.log(`Registering asset ${assetId} on-chain...`);

    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'registerAsset',
      args: [assetId, attestationHash, blobId, payload, signature],
    });

    // Don't wait for receipt - return immediately
    this.logger.log(`Asset registered: ${hash}`);
    return hash;
  }

  async registerIdentity(walletAddress: string): Promise<Hash> {
    const wallet = this.walletService.getAdminWallet(); // Admin is trusted issuer
    const address = this.contractLoader.getContractAddress('IdentityRegistry');
    const abi = this.contractLoader.getContractAbi('IdentityRegistry');

    this.logger.log(`Registering identity for ${walletAddress}...`);

    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'registerIdentity',
      args: [walletAddress],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async deployToken(dto: DeployTokenDto): Promise<{ hash: string; tokenAddress?: string; complianceAddress?: string }> {
    const wallet = this.walletService.getAdminWallet();
    const address = this.contractLoader.getContractAddress('TokenFactory');
    const abi = this.contractLoader.getContractAbi('TokenFactory');

    this.logger.log(`Deploying token for asset ${dto.assetId}...`);

    // Convert UUID to bytes32 for on-chain usage
    const assetIdBytes32 = '0x' + dto.assetId.replace(/-/g, '').padEnd(64, '0');

    // Use provided values or defaults and convert to wei (18 decimals)
    const totalSupplyRaw = dto.totalSupply || '100000'; // Default 100k tokens
    const totalSupplyWei = BigInt(totalSupplyRaw) * BigInt(10 ** 18);
    const issuer = dto.issuer || wallet.account.address; // Default to admin wallet

    this.logger.log(`Token params: supply=${totalSupplyRaw} tokens (${totalSupplyWei} wei), name=${dto.name}, symbol=${dto.symbol}, issuer=${issuer}`);

    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'deployTokenSuite',
      args: [assetIdBytes32, totalSupplyWei, dto.name, dto.symbol, issuer],
    });

    this.logger.log(`Token deployment submitted in tx: ${hash}`);
    this.logger.log(`Waiting for transaction confirmation...`);

    // Wait for transaction receipt
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000, // 60 second timeout
    });

    this.logger.log(`Transaction confirmed in block ${receipt.blockNumber}`);

    // Parse logs to extract token address
    let tokenAddress: string | undefined;
    let complianceAddress: string | undefined;

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics,
        }) as { eventName: string; args: any };

        if (decoded.eventName === 'TokenSuiteDeployed') {
          const args = decoded.args;
          tokenAddress = args.token;
          complianceAddress = args.compliance;
          this.logger.log(`Token deployed at: ${tokenAddress}`);
          this.logger.log(`Compliance module at: ${complianceAddress}`);
          break;
        }
      } catch (e) {
        // Skip logs that don't match
        continue;
      }
    }

    if (!tokenAddress) {
      this.logger.error(`Could not find TokenSuiteDeployed event in transaction logs`);
      // Still return hash, but status won't be updated
      return { hash };
    }

    // Update MongoDB with token info and status
    this.logger.log(`Updating asset ${dto.assetId} status to TOKENIZED`);

    await this.assetModel.updateOne(
      { assetId: dto.assetId },
      {
        $set: {
          'token.address': tokenAddress,
          'token.compliance': complianceAddress,
          'token.supply': totalSupplyRaw,
          'token.deployedAt': new Date(),
          'token.transactionHash': hash,
          status: AssetStatus.TOKENIZED,
          'checkpoints.tokenized': true,
        },
      }
    );

    this.logger.log(`Asset ${dto.assetId} updated to TOKENIZED status`);

    return { hash, tokenAddress, complianceAddress };
  }

  async depositYield(tokenAddress: string, amount: string): Promise<Hash> {
    const wallet = this.walletService.getPlatformWallet();
    const address = this.contractLoader.getContractAddress('YieldVault');
    const abi = this.contractLoader.getContractAbi('YieldVault');
    
    // First approve USDC
    // This assumes Platform Wallet holds the USDC. 
    // Implementation of USDC approval skipped for brevity but required in prod.

    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'depositYield',
      args: [tokenAddress, BigInt(amount)],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async distributeYield(tokenAddress: string, holders: string[], amounts: string[]): Promise<Hash> {
    const wallet = this.walletService.getPlatformWallet();
    const address = this.contractLoader.getContractAddress('YieldVault');
    const abi = this.contractLoader.getContractAbi('YieldVault');

    const amountBigInts = amounts.map(a => BigInt(a));

    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'distributeYieldBatch',
      args: [tokenAddress, holders, amountBigInts],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async listOnMarketplace(
    tokenAddress: string,
    type: 'STATIC' | 'AUCTION',
    price: string,
    minInvestment: string,
    duration?: string,
  ): Promise<Hash> {
    const wallet = this.walletService.getAdminWallet();
    const address = this.contractLoader.getContractAddress('PrimaryMarketplace');
    const abi = this.contractLoader.getContractAbi('PrimaryMarketplace');

    this.logger.log(`Listing token ${tokenAddress} on ${type} marketplace...`);

    // Get asset info from database to extract assetId and totalSupply
    const asset = await this.assetModel.findOne({ 'token.address': tokenAddress });
    if (!asset) {
      throw new Error(`Asset not found for token ${tokenAddress}`);
    }

    // Convert UUID to bytes32
    const assetIdBytes32 = ('0x' + asset.assetId.replace(/-/g, '').padEnd(64, '0')) as Hash;

    // Get totalSupply and convert to wei (18 decimals)
    const totalSupplyRaw = asset.tokenParams?.totalSupply || asset.token?.supply || '100000';
    const totalSupplyWei = BigInt(totalSupplyRaw) * BigInt(10 ** 18);

    // Determine listing type enum (0 = STATIC, 1 = AUCTION)
    const listingTypeEnum = type === 'STATIC' ? 0 : 1;

    // For STATIC listings
    if (type === 'STATIC') {
      const hash = await wallet.writeContract({
        address: address as Address,
        abi,
        functionName: 'createListing',
        args: [
          assetIdBytes32,
          tokenAddress as Address,
          listingTypeEnum,
          BigInt(price),      // staticPrice
          BigInt(0),          // endPrice (not used for static)
          BigInt(0),          // duration (not used for static)
          totalSupplyWei,     // totalSupply in wei
          BigInt(minInvestment),
        ],
      });

      await this.publicClient.waitForTransactionReceipt({ hash });
      this.logger.log(`Token listed in tx: ${hash}`);
      return hash;
    }

    // For AUCTION listings
    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'createListing',
      args: [
        assetIdBytes32,
        tokenAddress as Address,
        listingTypeEnum,
        BigInt(price),      // startPrice
        BigInt(price),      // endPrice (could be different for Dutch auction)
        BigInt(duration || '86400'), // duration in seconds
        totalSupplyWei,     // totalSupply in wei
        BigInt(minInvestment),
      ],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    this.logger.log(`Auction listed in tx: ${hash}`);
    return hash;
  }

  async revokeAsset(assetId: string, reason: string): Promise<Hash> {
    const wallet = this.walletService.getAdminWallet();
    const address = this.contractLoader.getContractAddress('AttestationRegistry');
    const abi = this.contractLoader.getContractAbi('AttestationRegistry');

    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'revokeAsset',
      args: [assetId, reason],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // Read Methods
  async isVerified(walletAddress: string): Promise<boolean> {
    const address = this.contractLoader.getContractAddress('IdentityRegistry');
    const abi = this.contractLoader.getContractAbi('IdentityRegistry');

    return await this.publicClient.readContract({
      address: address as Address,
      abi,
      functionName: 'isVerified',
      args: [walletAddress],
    }) as boolean;
  }
}
