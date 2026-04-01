import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Address, defineChain } from 'viem';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';
import { StArbPriceService } from '../../blockchain/services/starb-price.service';

/**
 * @title ArbitrumDEXService
 * @notice Service for interacting with BNB DEX and stARB price oracle
 * @dev Provides price quotes, swap calculations, and USD value conversions for BNB
 * NOTE: Pricing is managed entirely in backend via StArbPriceService (no on-chain oracle)
 */
@Injectable()
export class ArbitrumDEXService {
  private readonly logger = new Logger(ArbitrumDEXService.name);
  private publicClient;

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
    private starbPriceService: StArbPriceService,
  ) {
    // Dynamically construct chain from config
    const rpcUrl = this.configService.get<string>('blockchain.rpcUrl') || 'https://sepolia-rollup.arbitrum.io/rpc';
    const chainId = this.configService.get<number>('blockchain.chainId') || 421614;
    const nativeSymbol = this.configService.get<string>('blockchain.evmNativeSymbol') || 'ETH';

    const configuredChain = defineChain({
      id: chainId,
      name: this.configService.get<string>('network.networkName') || 'BNB',
      nativeCurrency: {
        decimals: 18,
        name: 'Ethereum',
        symbol: nativeSymbol,
      },
      rpcUrls: {
        default: {
          http: [rpcUrl],
        },
        public: {
          http: [rpcUrl],
        },
      },
    });

    this.publicClient = createPublicClient({
      chain: configuredChain,
      transport: http(rpcUrl),
    });

    this.logger.log(`DEX service initialized for chain ${chainId} (${nativeSymbol})`);
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    description: string,
    maxRetries = 5,
    initialDelay = 2000,
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

  /**
   * Get stARB price in USD from backend StArbPriceService
   * @returns Price in USD with 6 decimals (USDC wei format, e.g., 800000 = $0.80)
   */
  async getCollateralPrice(): Promise<bigint> {
    try {
      const price = this.starbPriceService.getCurrentPrice(); // 6 decimals
      this.logger.debug(`stARB price (from backend): $${price / 1e6}`);
      return BigInt(price);
    } catch (error) {
      this.logger.error(`Failed to get stARB price: ${error}`);
      throw error;
    }
  }

  /**
   * Get swap quote from Arbitrum DEX
   * @param starbAmount Amount of stARB to swap (wei format, 18 decimals)
   * @returns Expected USDC output (wei format, 6 decimals)
   */
  async getQuote(starbAmount: bigint): Promise<bigint> {
    try {
      const swapIntegrationAddress = this.contractLoader.getContractAddress('BNBSwapIntegration');
      const swapIntegrationABI = this.contractLoader.getContractAbi('BNBSwapIntegration');

      const quote = (await this.executeWithRetry(() => this.publicClient.readContract({
        address: swapIntegrationAddress as Address,
        abi: swapIntegrationABI,
        functionName: 'getQuote',
        args: [starbAmount],
      }), 'getQuote')) as bigint;

      this.logger.debug(
        `Swap quote: ${Number(starbAmount) / 1e18} stARB → ${Number(quote) / 1e6} USDC`,
      );
      return quote;
    } catch (error) {
      this.logger.error(`Failed to get swap quote: ${error}`);
      throw error;
    }
  }

  /**
   * Calculate USD value of stARB amount using backend pricing
   * @param starbAmount Amount of stARB (wei format, 18 decimals)
   * @returns USD value (wei format, 6 decimals for USDC)
   */
  async calculateCollateralValueUSD(starbAmount: bigint): Promise<bigint> {
    try {
      // Use StArbPriceService's built-in conversion
      const valueUSD = this.starbPriceService.starbToUsdc(starbAmount);

      this.logger.debug(
        `${Number(starbAmount) / 1e18} stARB = $${Number(valueUSD) / 1e6} (backend pricing)`,
      );
      return valueUSD;
    } catch (error) {
      this.logger.error(`Failed to calculate stARB value: ${error}`);
      throw error;
    }
  }

  /**
   * Calculate stARB amount needed for target USDC using backend pricing
   * @param targetUSDC Target USDC amount (wei format, 6 decimals)
   * @returns stARB amount needed (wei format, 18 decimals)
   */
  async calculateCollateralForUSDC(targetUSDC: bigint): Promise<bigint> {
    try {
      // Use StArbPriceService's built-in conversion
      const starbNeeded = this.starbPriceService.usdcToStarb(targetUSDC);

      this.logger.debug(
        `Need ${Number(starbNeeded) / 1e18} stARB for $${Number(targetUSDC) / 1e6} (backend pricing)`,
      );
      return starbNeeded;
    } catch (error) {
      this.logger.error(`Failed to calculate stARB for USDC: ${error}`);
      throw error;
    }
  }

  /**
  * Get DEX statistics from BNBSwapIntegration
   * @returns Swap statistics
   */
  async getDEXStats(): Promise<{
    totalSwaps: bigint;
    totalCollateralSwapped: bigint;
    totalUSDCReceived: bigint;
  }> {
    try {
      const swapIntegrationAddress = this.contractLoader.getContractAddress('BNBSwapIntegration');
      const swapIntegrationABI = this.contractLoader.getContractAbi('BNBSwapIntegration');

      const stats = (await this.executeWithRetry(() => this.publicClient.readContract({
        address: swapIntegrationAddress as Address,
        abi: swapIntegrationABI,
        functionName: 'getSwapStats',
      }), 'getSwapStats')) as [bigint, bigint, bigint];

      return {
        totalSwaps: stats[0],
        totalCollateralSwapped: stats[1],
        totalUSDCReceived: stats[2],
      };
    } catch (error) {
      this.logger.error(`Failed to get DEX stats: ${error}`);
      throw error;
    }
  }

  /**
   * Check if DEX has sufficient liquidity for swap
   * @param starbAmount Amount to swap
   * @returns true if liquidity is sufficient (>10x swap amount)
   */
  async checkLiquidity(starbAmount: bigint): Promise<boolean> {
    try {
      const dexAddress = this.contractLoader.getContractAddress('MockBNBDEX');
      const dexABI = this.contractLoader.getContractAbi('MockBNBDEX');

      const reserves = (await this.executeWithRetry(() => this.publicClient.readContract({
        address: dexAddress as Address,
        abi: dexABI,
        functionName: 'getReserves',
      }), 'getReserves')) as [bigint, bigint];

      const usdcReserve = reserves[1];
      const requiredUSDC = await this.getQuote(starbAmount);
      const hasLiquidity = usdcReserve >= requiredUSDC * BigInt(10); // 10x buffer

      this.logger.debug(
        `Liquidity check: ${hasLiquidity ? '✅' : '❌'} (reserve: ${Number(usdcReserve) / 1e6} USDC, needed: ${Number(requiredUSDC) / 1e6} USDC)`,
      );

      return hasLiquidity;
    } catch (error) {
      this.logger.error(`Failed to check liquidity: ${error}`);
      return false;
    }
  }

  // ====================================================================
  // Method Aliases for Network-Agnostic Interface Compatibility
  // ====================================================================

  /**
   * Alias for getCollateralPrice() - provides interface compatibility with FluxionDEXService
   * @returns stARB price in USD with 6 decimals
   */
  async getMETHPrice(): Promise<bigint> {
    return this.getCollateralPrice();
  }

  /**
   * Alias for calculateCollateralForUSDC() - provides interface compatibility with FluxionDEXService
   * @param targetUSDC Target USDC amount (wei format, 6 decimals)
   * @returns stARB amount needed (wei format, 18 decimals)
   */
  async calculateMETHForUSDC(targetUSDC: bigint): Promise<bigint> {
    return this.calculateCollateralForUSDC(targetUSDC);
  }

  /**
   * Alias for calculateCollateralValueUSD() - provides interface compatibility with FluxionDEXService
   * @param starbAmount Amount of stARB (wei format, 18 decimals)
   * @returns USD value (wei format, 6 decimals for USDC)
   */
  async calculateMETHValueUSD(starbAmount: bigint): Promise<bigint> {
    return this.calculateCollateralValueUSD(starbAmount);
  }
}
