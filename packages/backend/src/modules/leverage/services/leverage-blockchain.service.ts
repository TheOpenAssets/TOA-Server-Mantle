import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Hash, Address, decodeEventLog } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';
import { WalletService } from '../../blockchain/services/wallet.service';
import { MethPriceService } from '../../blockchain/services/meth-price.service';

/**
 * @title LeverageBlockchainService
 * @notice Service for interacting with leverage contracts on blockchain
 * @dev Uses platform wallet for all leverage operations
 */
@Injectable()
export class LeverageBlockchainService {
  private readonly logger = new Logger(LeverageBlockchainService.name);
  private publicClient;

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
    private walletService: WalletService,
    private methPriceService: MethPriceService,
  ) {
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });
  }

  /**
   * Create leverage position on-chain
   * @param user User address
   * @param mETHAmount mETH collateral amount (wei)
   * @param usdcToBorrow USDC to borrow (wei)
   * @param rwaToken RWA token address
   * @param rwaTokenAmount RWA token amount (wei)
   * @param assetId Asset ID
   * @param mETHPriceUSD Current mETH price in USD (6 decimals USDC wei format)
   * @returns Transaction hash and position ID
   */
  async createPosition(params: {
    user: string;
    mETHAmount: bigint;
    usdcToBorrow: bigint;
    rwaToken: string;
    rwaTokenAmount: bigint;
    assetId: string;
    mETHPriceUSD: bigint;
  }): Promise<{ hash: Hash; positionId?: number }> {
    const wallet = this.walletService.getPlatformWallet();
    const address = this.contractLoader.getContractAddress('LeverageVault');
    const abi = this.contractLoader.getContractAbi('LeverageVault');

    // Convert mETH price from 6 decimals (USDC wei) to 18 decimals (contract expects 18)
    // e.g., 2856450000 (6 decimals) → 2856450000000000000000 (18 decimals)
    const mETHPriceUSD18 = params.mETHPriceUSD * BigInt(10 ** 12);

    this.logger.log(
      `Creating leverage position for ${params.user}: ${Number(params.mETHAmount) / 1e18} mETH collateral`,
    );
    this.logger.log(`mETH Price: $${Number(params.mETHPriceUSD) / 1e6} (18 decimals: ${mETHPriceUSD18})`);

    try {
      const hash = await wallet.writeContract({
        address: address as Address,
        abi,
        functionName: 'createPosition',
        args: [
          params.user,
          params.mETHAmount,
          params.usdcToBorrow,
          params.rwaToken,
          params.rwaTokenAmount,
          params.assetId,
          mETHPriceUSD18,
        ],
      });

      // Wait for transaction and parse event to get positionId
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      // Parse PositionCreated event to get positionId
      let positionId: number | undefined;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
            eventName: 'PositionCreated',
          });
          if (decoded.eventName === 'PositionCreated' && decoded.args) {
            positionId = Number((decoded.args as any).positionId);
            break;
          }
        } catch {
          // Not the event we're looking for
          continue;
        }
      }

      this.logger.log(`✅ Position created: ${hash} (ID: ${positionId})`);
      return { hash, positionId };
    } catch (error) {
      this.logger.error(`Failed to create position: ${error}`);
      throw error;
    }
  }

  /**
   * Harvest yield from position
   * @param positionId Position ID
   * @returns Transaction hash
   */
  async harvestYield(positionId: number): Promise<Hash> {
    const wallet = this.walletService.getPlatformWallet();
    const address = this.contractLoader.getContractAddress('LeverageVault');
    const abi = this.contractLoader.getContractAbi('LeverageVault');

    this.logger.log(`🌾 Harvesting yield for position ${positionId}...`);

    try {
      const hash = await wallet.writeContract({
        address: address as Address,
        abi,
        functionName: 'harvestYield',
        args: [BigInt(positionId)],
      });

      await this.publicClient.waitForTransactionReceipt({ hash });
      this.logger.log(`✅ Yield harvested: ${hash}`);
      return hash;
    } catch (error) {
      this.logger.error(`Failed to harvest yield: ${error}`);
      throw error;
    }
  }

  /**
   * Liquidate position
   * @param positionId Position ID
   * @returns Transaction hash
   */
  async liquidatePosition(positionId: number): Promise<Hash> {
    const wallet = this.walletService.getPlatformWallet();
    const address = this.contractLoader.getContractAddress('LeverageVault');
    const abi = this.contractLoader.getContractAbi('LeverageVault');

    this.logger.log(`⚠️ Liquidating position ${positionId}...`);

    // Get current mETH price (returns 18 decimals format)
    const methPriceUSD = BigInt(this.methPriceService.getCurrentPrice());

    try {
      const hash = await wallet.writeContract({
        address: address as Address,
        abi,
        functionName: 'liquidatePosition',
        args: [BigInt(positionId), methPriceUSD],
      });

      await this.publicClient.waitForTransactionReceipt({ hash });
      this.logger.log(`✅ Position liquidated: ${hash}`);
      return hash;
    } catch (error) {
      this.logger.error(`Failed to liquidate position: ${error}`);
      throw error;
    }
  }

  /**
   * Process settlement for position
   * @param positionId Position ID
   * @param settlementUSDC Settlement USDC amount (wei)
   * @returns Transaction hash
   */
  async processSettlement(
    positionId: number,
    settlementUSDC: bigint,
  ): Promise<Hash> {
    const wallet = this.walletService.getPlatformWallet();
    const address = this.contractLoader.getContractAddress('LeverageVault');
    const abi = this.contractLoader.getContractAbi('LeverageVault');

    this.logger.log(
      `💰 Processing settlement for position ${positionId}: ${Number(settlementUSDC) / 1e6} USDC`,
    );

    try {
      const hash = await wallet.writeContract({
        address: address as Address,
        abi,
        functionName: 'processSettlement',
        args: [BigInt(positionId), settlementUSDC],
      });

      await this.publicClient.waitForTransactionReceipt({ hash });
      this.logger.log(`✅ Settlement processed: ${hash}`);
      return hash;
    } catch (error) {
      this.logger.error(`Failed to process settlement: ${error}`);
      throw error;
    }
  }

  /**
   * Get outstanding debt for position
   * @param positionId Position ID
   * @returns Outstanding debt (USDC wei)
   */
  async getOutstandingDebt(positionId: number): Promise<bigint> {
    try {
      const seniorPoolAddress =
        this.contractLoader.getContractAddress('SeniorPool');
      const seniorPoolABI = this.contractLoader.getContractAbi('SeniorPool');

      const debt = (await this.publicClient.readContract({
        address: seniorPoolAddress as Address,
        abi: seniorPoolABI,
        functionName: 'getOutstandingDebt',
        args: [BigInt(positionId)],
      })) as bigint;

      return debt;
    } catch (error) {
      this.logger.error(`Failed to get outstanding debt: ${error}`);
      throw error;
    }
  }

  /**
   * Get accrued interest for position
   * @param positionId Position ID
   * @returns Accrued interest (USDC wei)
   */
  async getAccruedInterest(positionId: number): Promise<bigint> {
    try {
      const seniorPoolAddress =
        this.contractLoader.getContractAddress('SeniorPool');
      const seniorPoolABI = this.contractLoader.getContractAbi('SeniorPool');

      const interest = (await this.publicClient.readContract({
        address: seniorPoolAddress as Address,
        abi: seniorPoolABI,
        functionName: 'getAccruedInterest',
        args: [BigInt(positionId)],
      })) as bigint;

      return interest;
    } catch (error) {
      this.logger.error(`Failed to get accrued interest: ${error}`);
      throw error;
    }
  }

  /**
   * Get health factor for position
   * @param positionId Position ID
   * @returns Health factor in basis points (e.g., 15000 = 150%)
   */
  async getHealthFactor(positionId: number): Promise<number> {
    try {
      const leverageVaultAddress =
        this.contractLoader.getContractAddress('LeverageVault');
      const leverageVaultABI = this.contractLoader.getContractAbi('LeverageVault');

      // Get current mETH price (returns 18 decimals format)
      const methPriceUSD = BigInt(this.methPriceService.getCurrentPrice());

      const healthFactor = (await this.publicClient.readContract({
        address: leverageVaultAddress as Address,
        abi: leverageVaultABI,
        functionName: 'getHealthFactor',
        args: [BigInt(positionId), methPriceUSD],
      })) as bigint;

      return Number(healthFactor);
    } catch (error) {
      this.logger.error(`Failed to get health factor: ${error}`);
      throw error;
    }
  }

  /**
   * Get position details from contract
   * @param positionId Position ID
   * @returns Position struct
   */
  async getPosition(positionId: number): Promise<any> {
    try {
      const leverageVaultAddress =
        this.contractLoader.getContractAddress('LeverageVault');
      const leverageVaultABI = this.contractLoader.getContractAbi('LeverageVault');

      const position = await this.publicClient.readContract({
        address: leverageVaultAddress as Address,
        abi: leverageVaultABI,
        functionName: 'getPosition',
        args: [BigInt(positionId)],
      });

      return position;
    } catch (error) {
      this.logger.error(`Failed to get position: ${error}`);
      throw error;
    }
  }

  /**
   * Add collateral to position
   * @param positionId Position ID
   * @param mETHAmount Additional mETH amount (wei)
   * @returns Transaction hash
   */
  async addCollateral(positionId: number, mETHAmount: bigint): Promise<Hash> {
    const wallet = this.walletService.getPlatformWallet();
    const address = this.contractLoader.getContractAddress('LeverageVault');
    const abi = this.contractLoader.getContractAbi('LeverageVault');

    this.logger.log(
      `Adding ${Number(mETHAmount) / 1e18} mETH collateral to position ${positionId}`,
    );

    try {
      const hash = await wallet.writeContract({
        address: address as Address,
        abi,
        functionName: 'addCollateral',
        args: [BigInt(positionId), mETHAmount],
      });

      await this.publicClient.waitForTransactionReceipt({ hash });
      this.logger.log(`✅ Collateral added: ${hash}`);
      return hash;
    } catch (error) {
      this.logger.error(`Failed to add collateral: ${error}`);
      throw error;
    }
  }
}
