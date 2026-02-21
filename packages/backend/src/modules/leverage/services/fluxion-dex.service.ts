import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Address, defineChain } from 'viem';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';
import { MethPriceService } from '../../blockchain/services/meth-price.service';

/**
 * @title FluxionDEXService
 * @notice Service for interacting with Fluxion DEX and mETH price oracle
 * @dev Provides price quotes, swap calculations, and USD value conversions
 * NOTE: Pricing is managed entirely in backend via MethPriceService (no on-chain oracle)
 */
@Injectable()
export class FluxionDEXService {
  private readonly logger = new Logger(FluxionDEXService.name);
  private publicClient;

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
    private methPriceService: MethPriceService,
  ) {
    // Dynamically construct chain from config
    const rpcUrl = this.configService.get<string>('blockchain.rpcUrl') || 'http://localhost:8545';
    const chainId = this.configService.get<number>('blockchain.chainId') || 5003;
    const networkName = this.configService.get<string>('network.networkName') || 'Mantle Sepolia';
    const nativeSymbol = this.configService.get<string>('blockchain.evmNativeSymbol') || 'MNT';

    const chain = defineChain({
      id: chainId,
      name: networkName,
      nativeCurrency: {
        decimals: 18,
        name: nativeSymbol,
        symbol: nativeSymbol,
      },
      rpcUrls: {
        default: { http: [rpcUrl] },
        public: { http: [rpcUrl] },
      },
    });

    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
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
   * Get mETH price in USD from backend MethPriceService
   * @returns Price in USD with 6 decimals (USDC wei format, e.g., 3000000000 = $3000)
   */
  async getMETHPrice(): Promise<bigint> {
    try {
      const price = this.methPriceService.getCurrentPrice(); // 6 decimals
      this.logger.debug(`mETH price (from backend): $${price / 1e6}`);
      return BigInt(price);
    } catch (error) {
      this.logger.error(`Failed to get mETH price: ${error}`);
      throw error;
    }
  }

  /**
   * Get swap quote from Fluxion DEX
   * @param mETHAmount Amount of mETH to swap (wei format, 18 decimals)
   * @returns Expected USDC output (wei format, 6 decimals)
   */
  async getQuote(mETHAmount: bigint): Promise<bigint> {
    try {
      const fluxionAddress =
        this.contractLoader.getContractAddress('FluxionIntegration');
      const fluxionABI = this.contractLoader.getContractAbi('FluxionIntegration');

      const quote = (await this.executeWithRetry(() => this.publicClient.readContract({
        address: fluxionAddress as Address,
        abi: fluxionABI,
        functionName: 'getQuote',
        args: [mETHAmount],
      }), 'getQuote')) as bigint;

      this.logger.debug(
        `Swap quote: ${Number(mETHAmount) / 1e18} mETH → ${Number(quote) / 1e6} USDC`,
      );
      return quote;
    } catch (error) {
      this.logger.error(`Failed to get swap quote: ${error}`);
      throw error;
    }
  }

  /**
   * Calculate USD value of mETH amount using backend pricing
   * @param mETHAmount Amount of mETH (wei format, 18 decimals)
   * @returns USD value (wei format, 6 decimals for USDC)
   */
  async calculateMETHValueUSD(mETHAmount: bigint): Promise<bigint> {
    try {
      // Use MethPriceService's built-in conversion
      const valueUSD = this.methPriceService.methToUsdc(mETHAmount);

      this.logger.debug(
        `${Number(mETHAmount) / 1e18} mETH = $${Number(valueUSD) / 1e6} (backend pricing)`,
      );
      return valueUSD;
    } catch (error) {
      this.logger.error(`Failed to calculate mETH value: ${error}`);
      throw error;
    }
  }

  /**
   * Calculate mETH amount needed for target USDC using backend pricing
   * @param targetUSDC Target USDC amount (wei format, 6 decimals)
   * @returns mETH amount needed (wei format, 18 decimals)
   */
  async calculateMETHForUSDC(targetUSDC: bigint): Promise<bigint> {
    try {
      // Use MethPriceService's built-in conversion
      const mETHNeeded = this.methPriceService.usdcToMeth(targetUSDC);

      this.logger.debug(
        `Need ${Number(mETHNeeded) / 1e18} mETH for $${Number(targetUSDC) / 1e6} (backend pricing)`,
      );
      return mETHNeeded;
    } catch (error) {
      this.logger.error(`Failed to calculate mETH for USDC: ${error}`);
      throw error;
    }
  }

  /**
   * Get DEX statistics from FluxionIntegration
   * @returns Swap statistics
   */
  async getDEXStats(): Promise<{
    totalSwaps: bigint;
    totalMETHSwapped: bigint;
    totalUSDCReceived: bigint;
  }> {
    try {
      const fluxionAddress =
        this.contractLoader.getContractAddress('FluxionIntegration');
      const fluxionABI = this.contractLoader.getContractAbi('FluxionIntegration');

      const stats = (await this.executeWithRetry(() => this.publicClient.readContract({
        address: fluxionAddress as Address,
        abi: fluxionABI,
        functionName: 'getSwapStats',
      }), 'getSwapStats')) as [bigint, bigint, bigint];

      return {
        totalSwaps: stats[0],
        totalMETHSwapped: stats[1],
        totalUSDCReceived: stats[2],
      };
    } catch (error) {
      this.logger.error(`Failed to get DEX stats: ${error}`);
      throw error;
    }
  }

  /**
   * Check if DEX has sufficient liquidity for swap
   * @param mETHAmount Amount to swap
   * @returns true if liquidity is sufficient (>10x swap amount)
   */
  async checkLiquidity(mETHAmount: bigint): Promise<boolean> {
    try {
      const dexAddress = this.contractLoader.getContractAddress('MockFluxionDEX');
      const dexABI = this.contractLoader.getContractAbi('MockFluxionDEX');

      const reserves = (await this.executeWithRetry(() => this.publicClient.readContract({
        address: dexAddress as Address,
        abi: dexABI,
        functionName: 'getReserves',
      }), 'getReserves')) as [bigint, bigint];

      const usdcReserve = reserves[1];
      const requiredUSDC = await this.getQuote(mETHAmount);
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
}
