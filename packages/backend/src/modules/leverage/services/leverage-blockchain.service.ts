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

    // Convert assetId to bytes32 for PrimaryMarket interaction
    const assetIdBytes = ('0x' + params.assetId.replace(/-/g, '').padEnd(64, '0')) as Hash;

    this.logger.log(
      `Creating leverage position for ${params.user}: ${Number(params.mETHAmount) / 1e18} mETH collateral`,
    );
    this.logger.log(`mETH Price: $${Number(params.mETHPriceUSD) / 1e6} (18 decimals: ${mETHPriceUSD18})`);
    this.logger.log(`Asset ID bytes32: ${assetIdBytes}`);

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
          assetIdBytes, // Pass bytes32 assetId
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
  async harvestYield(positionId: number): Promise<{
    hash: Hash;
    mETHSwapped: bigint;
    usdcReceived: bigint;
    interestPaid: bigint;
  }> {
    const wallet = this.walletService.getPlatformWallet();
    const address = this.contractLoader.getContractAddress('LeverageVault');
    const abi = this.contractLoader.getContractAbi('LeverageVault');

    this.logger.log(`🌾 Harvesting yield for position ${positionId}...`);

    try {
      // Get current mETH price and convert from 6 to 18 decimals
      const methPriceUSDC = BigInt(this.methPriceService.getCurrentPrice());
      const methPriceUSD = methPriceUSDC * BigInt(1e12); // Convert from 6 to 18 decimals

      const hash = await wallet.writeContract({
        address: address as Address,
        abi,
        functionName: 'harvestYield',
        args: [BigInt(positionId), methPriceUSD],
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      this.logger.log(`✅ Yield harvested: ${hash}`);

      // Parse YieldHarvested event from receipt
      const yieldHarvestedEvent = receipt.logs.find((log) => {
        try {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
          }) as any;
          return decoded.eventName === 'YieldHarvested';
        } catch {
          return false;
        }
      });

      if (!yieldHarvestedEvent) {
        throw new Error('YieldHarvested event not found in transaction receipt');
      }

      const decoded = decodeEventLog({
        abi,
        data: yieldHarvestedEvent.data,
        topics: yieldHarvestedEvent.topics,
      }) as any;

      const eventArgs = decoded.args as {
        positionId: bigint;
        mETHSwapped: bigint;
        usdcReceived: bigint;
        interestPaid: bigint;
      };

      return {
        hash,
        mETHSwapped: eventArgs.mETHSwapped,
        usdcReceived: eventArgs.usdcReceived,
        interestPaid: eventArgs.interestPaid,
      };
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

    // Get current mETH price (6 decimals) and convert to 18 decimals
    const methPriceUSDC = BigInt(this.methPriceService.getCurrentPrice());
    const methPriceUSD = methPriceUSDC * BigInt(1e12); // Convert from 6 to 18 decimals

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
   * Claim yield by burning RWA tokens held by vault
   * @param positionId Position ID
   * @param tokenAmount Amount of RWA tokens to burn (wei)
   * @returns Transaction hash and amounts
   */
  async claimYieldFromBurn(
    positionId: number,
    tokenAmount: bigint,
  ): Promise<{
    hash: Hash;
    tokensBurned: bigint;
    usdcReceived: bigint;
  }> {
    const wallet = this.walletService.getPlatformWallet();
    const leverageVaultAddress = this.contractLoader.getContractAddress('LeverageVault');
    const leverageVaultAbi = this.contractLoader.getContractAbi('LeverageVault');
    const yieldVaultAddress = this.contractLoader.getContractAddress('YieldVault');
    const yieldVaultAbi = this.contractLoader.getContractAbi('YieldVault');

    this.logger.log(
      `🔥 Claiming yield for position ${positionId}: burning ${Number(tokenAmount) / 1e18} RWA tokens`,
    );

    try {
      // Get position to get rwaToken address
      const position = await this.getPosition(positionId);
      const rwaToken = position.rwaToken;

      const hash = await wallet.writeContract({
        address: leverageVaultAddress as Address,
        abi: leverageVaultAbi,
        functionName: 'claimYieldFromBurn',
        args: [BigInt(positionId), yieldVaultAddress, rwaToken, tokenAmount],
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      this.logger.log(`✅ Yield claimed via burn: ${hash}`);

      // Parse YieldClaimed event from YieldVault
      const yieldClaimedEvent = receipt.logs.find((log) => {
        try {
          const decoded = decodeEventLog({
            abi: yieldVaultAbi,
            data: log.data,
            topics: log.topics,
          }) as any;
          return decoded.eventName === 'YieldClaimed';
        } catch {
          return false;
        }
      });

      if (!yieldClaimedEvent) {
        throw new Error('YieldClaimed event not found in transaction receipt');
      }

      const decoded = decodeEventLog({
        abi: yieldVaultAbi,
        data: yieldClaimedEvent.data,
        topics: yieldClaimedEvent.topics,
      }) as any;

      const eventArgs = decoded.args as {
        user: string;
        tokenAddress: string;
        tokensBurned: bigint;
        usdcReceived: bigint;
        timestamp: bigint;
      };

      return {
        hash,
        tokensBurned: eventArgs.tokensBurned,
        usdcReceived: eventArgs.usdcReceived,
      };
    } catch (error) {
      this.logger.error(`Failed to claim yield from burn: ${error}`);
      throw error;
    }
  }

  /**
   * Process settlement for position
   * @param positionId Position ID
   * @param settlementUSDC Settlement USDC amount (wei)
   * @returns Transaction hash and settlement details
   */
  async processSettlement(
    positionId: number,
    settlementUSDC: bigint,
  ): Promise<{
    hash: Hash;
    seniorRepayment: bigint;
    interestRepayment: bigint;
    userYield: bigint;
  }> {
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

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      this.logger.log(`✅ Settlement processed: ${hash}`);

      // Parse SettlementProcessed event from receipt
      const settlementEvent = receipt.logs.find((log) => {
        try {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
          }) as any;
          return decoded.eventName === 'SettlementProcessed';
        } catch {
          return false;
        }
      });

      if (!settlementEvent) {
        throw new Error('SettlementProcessed event not found in transaction receipt');
      }

      const decoded = decodeEventLog({
        abi,
        data: settlementEvent.data,
        topics: settlementEvent.topics,
      }) as any;

      const eventArgs = decoded.args as {
        positionId: bigint;
        seniorRepayment: bigint;
        interestRepayment: bigint;
        userYield: bigint;
      };

      return {
        hash,
        seniorRepayment: eventArgs.seniorRepayment,
        interestRepayment: eventArgs.interestRepayment,
        userYield: eventArgs.userYield,
      };
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

      // Get current mETH price (6 decimals) and convert to 18 decimals
      const methPriceUSDC = BigInt(this.methPriceService.getCurrentPrice());
      const methPriceUSD = methPriceUSDC * BigInt(1e12); // Convert from 6 to 18 decimals

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
