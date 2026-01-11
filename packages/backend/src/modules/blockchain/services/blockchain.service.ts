import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Hash, Address, decodeEventLog, parseAbi } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { ContractLoaderService } from './contract-loader.service';
import { WalletService } from './wallet.service';
import { RegisterAssetDto } from '../dto/register-asset.dto';
import { DeployTokenDto } from '../dto/deploy-token.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';

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

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    description: string,
    maxRetries: number = 5,
    initialDelay: number = 2000,
  ): Promise<T> {
    let retries = 0;
    let delay = initialDelay;

    while (true) {
      try {
        return await operation();
      } catch (error: any) {
        retries++;
        if (retries > maxRetries) {
          this.logger.error(`Failed ${description} after ${maxRetries} retries: ${error.message}`);
          throw error;
        }
        this.logger.warn(
          `Error in ${description} (attempt ${retries}/${maxRetries}): ${error.message}. Retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }

  async registerAsset(dto: RegisterAssetDto): Promise<Hash> {
    const { assetId, attestationHash, blobId, payload, signature } = dto;
    const wallet = this.walletService.getAdminWallet();
    const address = this.contractLoader.getContractAddress('AttestationRegistry');
    const abi = this.contractLoader.getContractAbi('AttestationRegistry');

    this.logger.log(`Registering asset ${assetId} on-chain...`);

    const hash = await this.executeWithRetry(() => wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'registerAsset',
      args: [assetId, attestationHash, blobId, payload, signature],
    }), 'registerAsset write');

    // Don't wait for receipt - return immediately
    this.logger.log(`Asset registered: ${hash}`);
    return hash;
  }

  async registerIdentity(walletAddress: string): Promise<Hash> {
    const wallet = this.walletService.getAdminWallet(); // Admin is trusted issuer
    const address = this.contractLoader.getContractAddress('IdentityRegistry');
    const abi = this.contractLoader.getContractAbi('IdentityRegistry');

    this.logger.log(`Registering identity for ${walletAddress}...`);

    const hash = await this.executeWithRetry(() => wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'registerIdentity',
      args: [walletAddress],
    }), 'registerIdentity write');

    this.logger.log(`Transaction submitted: ${hash}, waiting for confirmation...`);
    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 300_000, // 5 minutes timeout
    }), 'registerIdentity receipt');
    this.logger.log(`Identity registration confirmed for ${walletAddress}`);
    return hash;
  }

  async deployToken(dto: DeployTokenDto): Promise<{ hash: string; tokenAddress?: string; complianceAddress?: string }> {
    const wallet = this.walletService.getAdminWallet();
    const address = this.contractLoader.getContractAddress('TokenFactory');
    const abi = this.contractLoader.getContractAbi('TokenFactory');

    this.logger.log(`Deploying token for asset ${dto.assetId}...`);

    // Convert UUID to bytes32 for on-chain usage
    const assetIdBytes32 = '0x' + dto.assetId.replace(/-/g, '').padEnd(64, '0');

    // Get total supply from asset or DTO
    let totalSupplyWei: bigint;

    if (dto.totalSupply) {
      // Use provided value (already in wei format)
      totalSupplyWei = BigInt(dto.totalSupply);
      this.logger.log(`Using provided totalSupply: ${dto.totalSupply} wei`);
    } else {
      // Get from asset's tokenParams (already stored in wei format during upload)
      const asset = await this.assetModel.findOne({ assetId: dto.assetId });
      if (!asset) {
        throw new Error(`Asset ${dto.assetId} not found`);
      }

      if (!asset.tokenParams?.totalSupply) {
        throw new Error(`Asset ${dto.assetId} missing tokenParams.totalSupply`);
      }

      totalSupplyWei = BigInt(asset.tokenParams.totalSupply);
      this.logger.log(`Using asset's totalSupply: ${asset.tokenParams.totalSupply} wei (${Number(totalSupplyWei) / 1e18} tokens)`);
    }
    const issuer = dto.issuer || wallet.account.address; // Default to admin wallet

    this.logger.log(`Token params: supply=${Number(totalSupplyWei) / 1e18} tokens (${totalSupplyWei} wei), name=${dto.name}, symbol=${dto.symbol}, issuer=${issuer}`);

    // Check wallet balance before submitting transaction
    const balance = await this.publicClient.getBalance({ address: wallet.account.address as Address });
    this.logger.log(`Admin wallet ${wallet.account.address} balance: ${Number(balance) / 1e18} MNT`);

    if (balance === BigInt(0)) {
      throw new Error(`Admin wallet has no MNT for gas. Please fund ${wallet.account.address}`);
    }

    this.logger.log(`Submitting transaction to TokenFactory at ${address}...`);

    let hash: `0x${string}`;
    try {
      hash = await this.executeWithRetry(() => wallet.writeContract({
        address: address as Address,
        abi,
        functionName: 'deployTokenSuite',
        args: [assetIdBytes32, totalSupplyWei, dto.name, dto.symbol, issuer],
      }), 'deployTokenSuite write');

      this.logger.log(`Transaction submitted successfully: ${hash}`);
    } catch (error) {
      this.logger.error(`Failed to submit transaction:`, error);
      throw error;
    }

    this.logger.log(`Token deployment submitted in tx: ${hash}`);
    this.logger.log(`Waiting for transaction confirmation...`);

    // Wait for transaction receipt (increased timeout for Mantle RPC)
    const receipt = await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000, // 3 minute timeout (Mantle RPC can be slow)
      pollingInterval: 2_000, // Check every 2 seconds
    }), 'deployTokenSuite receipt');

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

    this.logger.log(`Token deployed successfully - Address: ${tokenAddress}, Compliance: ${complianceAddress}`);

    return { hash, tokenAddress, complianceAddress };
  }

  async depositYield(tokenAddress: string, amount: string): Promise<Hash> {
    const wallet = this.walletService.getPlatformWallet();
    const yieldVaultAddress = this.contractLoader.getContractAddress('YieldVault');
    const yieldVaultAbi = this.contractLoader.getContractAbi('YieldVault');

    // Step 1: Approve USDC for YieldVault to spend
    const usdcAddress = this.contractLoader.getContractAddress('USDC');
    const usdcAbi = this.contractLoader.getContractAbi('USDC');

    this.logger.log(`Approving YieldVault to spend ${amount} USDC...`);

    const approvalHash = await this.executeWithRetry(() => wallet.writeContract({
      address: usdcAddress as Address,
      abi: usdcAbi,
      functionName: 'approve',
      args: [yieldVaultAddress, BigInt(amount)],
    }), 'approve USDC write');

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash: approvalHash,
      timeout: 180_000, // 3 minute timeout (Mantle RPC can be slow)
      pollingInterval: 2_000, // Check every 2 seconds
    }), 'approve USDC receipt');
    this.logger.log(`USDC approved in tx: ${approvalHash}`);

    // Step 2: Deposit yield to vault
    this.logger.log(`Depositing ${amount} USDC to YieldVault for token ${tokenAddress}...`);

    const hash = await this.executeWithRetry(() => wallet.writeContract({
      address: yieldVaultAddress as Address,
      abi: yieldVaultAbi,
      functionName: 'depositYield',
      args: [tokenAddress, BigInt(amount)],
    }), 'depositYield write');

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000, // 3 minute timeout (Mantle RPC can be slow)
      pollingInterval: 2_000, // Check every 2 seconds
    }), 'depositYield receipt');
    this.logger.log(`Yield deposited in tx: ${hash}`);
    return hash;
  }

  async distributeYield(tokenAddress: string, holders: string[], amounts: string[]): Promise<Hash> {
    const wallet = this.walletService.getPlatformWallet();
    const address = this.contractLoader.getContractAddress('YieldVault');
    const abi = this.contractLoader.getContractAbi('YieldVault');

    const amountBigInts = amounts.map(a => BigInt(a));

    const hash = await this.executeWithRetry(() => wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'distributeYieldBatch',
      args: [tokenAddress, holders, amountBigInts],
    }), 'distributeYieldBatch write');

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000, // 3 minute timeout (Mantle RPC can be slow)
      pollingInterval: 2_000, // Check every 2 seconds
    }), 'distributeYieldBatch receipt');
    return hash;
  }

  async listOnMarketplace(
    tokenAddress: string,
    type: 'STATIC' | 'AUCTION',
    price: string,
    minInvestment: string,
    duration?: string,
  ): Promise<Hash> {
    try {
      const wallet = this.walletService.getAdminWallet();
      const address = this.contractLoader.getContractAddress('PrimaryMarketplace');
      const abi = this.contractLoader.getContractAbi('PrimaryMarketplace');

      this.logger.log(`========== Starting listOnMarketplace ==========`);
      this.logger.log(`Input params: tokenAddress=${tokenAddress}, type=${type}, price=${price}, minInvestment=${minInvestment}, duration=${duration}`);
      this.logger.log(`Marketplace contract: ${address}`);
      this.logger.log(`Admin wallet: ${wallet.account.address}`);

      // Get asset info from database to extract assetId and totalSupply
      this.logger.log(`Querying database for asset with token.address: ${tokenAddress}`);
      const asset = await this.assetModel.findOne({ 'token.address': tokenAddress });

      if (!asset) {
        this.logger.error(`❌ Asset not found for token ${tokenAddress}`);
        throw new Error(`Asset not found for token ${tokenAddress}`);
      }

      this.logger.log(`✓ Asset found: ${asset.assetId}`);
      this.logger.log(`Asset data: tokenParams.totalSupply=${asset.tokenParams?.totalSupply}, token.supply=${asset.token?.supply}`);

      // Convert UUID to bytes32
      const assetIdBytes32 = ('0x' + asset.assetId.replace(/-/g, '').padEnd(64, '0')) as Hash;
      this.logger.log(`AssetId bytes32: ${assetIdBytes32}`);

      // Get totalSupply (already in wei from database - 18 decimals)
      const totalSupplyRaw = asset.tokenParams?.totalSupply || asset.token?.supply || '100000000000000000000';
      const totalSupplyWei = BigInt(totalSupplyRaw); // Already in wei, no multiplication needed
      this.logger.log(`Total supply: raw=${totalSupplyRaw}, wei=${totalSupplyWei.toString()}`);

      // Determine listing type enum (0 = STATIC, 1 = AUCTION)
      const listingTypeEnum = type === 'STATIC' ? 0 : 1;

      // Log all contract call parameters
      this.logger.log(`========== Contract Call Parameters ==========`);
      this.logger.log(`Function: createListing`);
      this.logger.log(`  [0] assetId: ${assetIdBytes32}`);
      this.logger.log(`  [1] tokenAddress: ${tokenAddress}`);
      this.logger.log(`  [2] listingType: ${listingTypeEnum} (${type})`);
      this.logger.log(`  [3] priceOrReserve: ${price}`);
      this.logger.log(`  [4] duration: ${duration || '0'}`);
      this.logger.log(`  [5] totalSupply: ${totalSupplyWei.toString()}`);
      this.logger.log(`  [6] minInvestment: ${minInvestment}`);
      this.logger.log(`==============================================`);

      // New createListing signature:
      // createListing(assetId, tokenAddress, listingType, priceOrReserve, duration, totalSupply, minInvestment)

      this.logger.log(`Submitting transaction...`);
      const hash = await this.executeWithRetry(() => wallet.writeContract({
        address: address as Address,
        abi,
        functionName: 'createListing',
        args: [
          assetIdBytes32,
          tokenAddress as Address,
          listingTypeEnum,
          BigInt(price),               // priceOrReserve
          BigInt(duration || '0'),     // duration (0 for STATIC is fine, or ignored)
          totalSupplyWei,              // totalSupply
          BigInt(minInvestment),       // minInvestment
        ],
      }), 'createListing write');

      this.logger.log(`✓ Transaction submitted: ${hash}`);
      this.logger.log(`Waiting for transaction receipt...`);

      const receipt = await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
        hash,
        timeout: 180_000,
        pollingInterval: 2_000,
      }), 'createListing receipt');

      this.logger.log(`✓ Transaction confirmed in block ${receipt.blockNumber}`);
      this.logger.log(`Transaction status: ${receipt.status}`);
      this.logger.log(`Gas used: ${receipt.gasUsed.toString()}`);
      this.logger.log(`${type} listing created successfully in tx: ${hash}`);
      this.logger.log(`========== listOnMarketplace completed ==========`);

      return hash;
    } catch (error: any) {
      this.logger.error(`========== listOnMarketplace FAILED ==========`);
      this.logger.error(`Error type: ${error?.constructor?.name || typeof error}`);
      this.logger.error(`Error message: ${error?.message || String(error)}`);

      // BigInt-safe JSON serializer
      const bigIntReplacer = (_key: string, value: any) =>
        typeof value === 'bigint' ? value.toString() : value;

      if (error?.cause) {
        this.logger.error(`Error cause: ${JSON.stringify(error.cause, bigIntReplacer, 2)}`);
      }

      if (error?.metaMessages) {
        this.logger.error(`Meta messages: ${JSON.stringify(error.metaMessages, bigIntReplacer, 2)}`);
      }

      if (error?.details) {
        this.logger.error(`Error details: ${error.details}`);
      }

      if (error?.data) {
        this.logger.error(`Error data: ${JSON.stringify(error.data, bigIntReplacer, 2)}`);
      }

      if (error?.stack) {
        this.logger.error(`Stack trace: ${error.stack}`);
      }

      this.logger.error(`Full error: ${JSON.stringify(error, bigIntReplacer, 2)}`);
      this.logger.error(`============================================`);

      throw error;
    }
  }

  async approveMarketplace(tokenAddress: string): Promise<Hash> {
    const wallet = this.walletService.getPlatformWallet();
    const marketplaceAddress = this.contractLoader.getContractAddress('PrimaryMarketplace');

    const tokenAbi = parseAbi([
      'function approve(address spender, uint256 amount) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)',
    ]);

    this.logger.log(`Approving marketplace ${marketplaceAddress} to spend tokens from ${tokenAddress}`);

    // Check current allowance
    const currentAllowance = await this.executeWithRetry(() => this.publicClient.readContract({
      address: tokenAddress as Address,
      abi: tokenAbi,
      functionName: 'allowance',
      args: [wallet.account.address, marketplaceAddress as Address],
    }), 'allowance check') as bigint;

    if (currentAllowance > 0n) {
      this.logger.log(`Marketplace already has approval: ${currentAllowance.toString()}`);
      return '0x0' as Hash; // Return dummy hash if already approved
    }

    // Approve max amount (unlimited approval)
    const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'); // MaxUint256

    const hash = await this.executeWithRetry(() => wallet.writeContract({
      address: tokenAddress as Address,
      abi: tokenAbi,
      functionName: 'approve',
      args: [marketplaceAddress as Address, maxApproval],
    }), 'approve marketplace write');

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
      pollingInterval: 2_000,
    }), 'approve marketplace receipt');

    this.logger.log(`Marketplace approved in tx: ${hash}`);
    return hash;
  }

  async endAuction(assetId: string, clearingPrice: string): Promise<Hash> {
    const wallet = this.walletService.getAdminWallet();
    const address = this.contractLoader.getContractAddress('PrimaryMarketplace');
    const abi = this.contractLoader.getContractAbi('PrimaryMarketplace');

    const assetIdBytes32 = ('0x' + assetId.replace(/-/g, '').padEnd(64, '0')) as Hash;

    this.logger.log(`Ending auction for asset ${assetId} with clearing price ${clearingPrice}...`);

    const hash = await this.executeWithRetry(() => wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'endAuction',
      args: [assetIdBytes32, BigInt(clearingPrice)],
    }), 'endAuction write');

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000, // 3 minute timeout
      pollingInterval: 2_000,
    }), 'endAuction receipt');
    this.logger.log(`Auction ended in tx: ${hash}`);
    return hash;
  }

  async revokeAsset(assetId: string, reason: string): Promise<Hash> {
    const wallet = this.walletService.getAdminWallet();
    const address = this.contractLoader.getContractAddress('AttestationRegistry');
    const abi = this.contractLoader.getContractAbi('AttestationRegistry');

    const hash = await this.executeWithRetry(() => wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'revokeAsset',
      args: [assetId, reason],
    }), 'revokeAsset write');

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({ hash }), 'revokeAsset receipt');
    return hash;
  }

  /**
   * Burn unsold tokens from custody wallet (marketplace inventory)
   * This is called during payout to ensure only sold tokens remain in circulation
   */
  async burnUnsoldTokens(tokenAddress: string, assetId: string): Promise<{
    tokensBurned: bigint;
    newTotalSupply: bigint;
    txHash: string;
  }> {
    const wallet = this.walletService.getPlatformWallet();
    const tokenAbi = this.contractLoader.getContractAbi('RWAToken');

    // Get custody wallet address (where unsold tokens are held)
    const custodyWalletAddress = this.configService.get<string>('blockchain.custodyAddress');

    if (!custodyWalletAddress) {
      throw new Error('Custody wallet address not configured in .env (CUSTODY_WALLET_ADDRESS)');
    }

    this.logger.log(`Checking unsold token balance in custody wallet ${custodyWalletAddress}...`);

    const unsoldBalance = await this.executeWithRetry(() => this.publicClient.readContract({
      address: tokenAddress as Address,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [custodyWalletAddress as Address],
    }), 'check unsold balance') as bigint;

    this.logger.log(`Custody wallet holds ${unsoldBalance.toString()} wei (${Number(unsoldBalance) / 1e18} tokens)`);

    if (unsoldBalance === 0n) {
      this.logger.log(`✅ No unsold tokens to burn - all tokens were sold`);

      // Get current total supply
      const totalSupply = await this.executeWithRetry(() => this.publicClient.readContract({
        address: tokenAddress as Address,
        abi: tokenAbi,
        functionName: 'totalSupply',
        args: [],
      }), 'get totalSupply') as bigint;

      return { tokensBurned: 0n, newTotalSupply: totalSupply, txHash: '' };
    }

    // Burn unsold tokens from custody wallet
    // The platform wallet should have authority to burn from custody
    this.logger.log(`🔥 Burning ${Number(unsoldBalance) / 1e18} unsold tokens from custody wallet...`);

    let hash: Hash;
    if (wallet.account.address.toLowerCase() === custodyWalletAddress.toLowerCase()) {
      // If platform wallet IS custody wallet, use burn() directly
      // This avoids allowance requirement for self-burn
      hash = await this.executeWithRetry(() => wallet.writeContract({
        address: tokenAddress as Address,
        abi: tokenAbi,
        functionName: 'burn',
        args: [unsoldBalance],
      }), 'burn write');
    } else {
      // If different, use burnFrom (requires allowance)
      hash = await this.executeWithRetry(() => wallet.writeContract({
        address: tokenAddress as Address,
        abi: tokenAbi,
        functionName: 'burnFrom',
        args: [custodyWalletAddress as Address, unsoldBalance],
      }), 'burnFrom write');
    }

    this.logger.log(`Burn transaction submitted: ${hash}`);

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
      pollingInterval: 2_000,
    }), 'burn receipt');

    this.logger.log(`✅ Burn transaction confirmed in tx: ${hash}`);

    // Get new total supply after burn
    const newTotalSupply = await this.executeWithRetry(() => this.publicClient.readContract({
      address: tokenAddress as Address,
      abi: tokenAbi,
      functionName: 'totalSupply',
      args: [],
    }), 'get totalSupply after burn') as bigint;

    this.logger.log(`New total supply: ${newTotalSupply.toString()} wei (${Number(newTotalSupply) / 1e18} tokens)`);

    return {
      tokensBurned: unsoldBalance,
      newTotalSupply,
      txHash: hash,
    };
  }

  // Read Methods
  async isVerified(walletAddress: string): Promise<boolean> {
    const address = this.contractLoader.getContractAddress('IdentityRegistry');
    const abi = this.contractLoader.getContractAbi('IdentityRegistry');

    return await this.executeWithRetry(() => this.publicClient.readContract({
      address: address as Address,
      abi,
      functionName: 'isVerified',
      args: [walletAddress],
    }), 'isVerified check') as boolean;
  }
}
