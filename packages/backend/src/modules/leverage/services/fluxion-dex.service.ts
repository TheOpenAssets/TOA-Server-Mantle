import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Address } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';

/**
 * @title FluxionDEXService
 * @notice Service for interacting with Fluxion DEX and mETH price oracle
 * @dev Provides price quotes, swap calculations, and USD value conversions
 */
@Injectable()
export class FluxionDEXService {
  private readonly logger = new Logger(FluxionDEXService.name);
  private publicClient;

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
  ) {
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });
  }

  /**
   * Get mETH price in USD from oracle (MockMETH contract)
   * @returns Price in USD with 18 decimals (e.g., 3000 * 1e18 = $3000)
   */
  async getMETHPrice(): Promise<bigint> {
    try {
      const methAddress = this.contractLoader.getContractAddress('MockMETH');
      const methABI = this.contractLoader.getContractAbi('MockMETH');

      const price = (await this.publicClient.readContract({
        address: methAddress as Address,
        abi: methABI,
        functionName: 'getPrice',
      })) as bigint;

      this.logger.debug(`mETH price: $${Number(price) / 1e18}`);
      return price;
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

      const quote = (await this.publicClient.readContract({
        address: fluxionAddress as Address,
        abi: fluxionABI,
        functionName: 'getQuote',
        args: [mETHAmount],
      })) as bigint;

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
   * Calculate USD value of mETH amount
   * @param mETHAmount Amount of mETH (wei format, 18 decimals)
   * @returns USD value (wei format, 6 decimals for USDC)
   */
  async calculateMETHValueUSD(mETHAmount: bigint): Promise<bigint> {
    try {
      const price = await this.getMETHPrice(); // 18 decimals
      // Convert to USDC 6 decimals: (mETH * price) / 1e30
      const valueUSD = (mETHAmount * price) / BigInt(1e30);

      this.logger.debug(
        `${Number(mETHAmount) / 1e18} mETH = $${Number(valueUSD) / 1e6}`,
      );
      return valueUSD;
    } catch (error) {
      this.logger.error(`Failed to calculate mETH value: ${error}`);
      throw error;
    }
  }

  /**
   * Calculate mETH amount needed for target USDC
   * @param targetUSDC Target USDC amount (wei format, 6 decimals)
   * @returns mETH amount needed (wei format, 18 decimals)
   */
  async calculateMETHForUSDC(targetUSDC: bigint): Promise<bigint> {
    try {
      const price = await this.getMETHPrice(); // 18 decimals
      // mETH = (targetUSDC * 1e30) / price
      const mETHNeeded = (targetUSDC * BigInt(1e30)) / price;

      this.logger.debug(
        `Need ${Number(mETHNeeded) / 1e18} mETH for $${Number(targetUSDC) / 1e6}`,
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

      const stats = (await this.publicClient.readContract({
        address: fluxionAddress as Address,
        abi: fluxionABI,
        functionName: 'getSwapStats',
      })) as [bigint, bigint, bigint];

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

      const reserves = (await this.publicClient.readContract({
        address: dexAddress as Address,
        abi: dexABI,
        functionName: 'getReserves',
      })) as [bigint, bigint];

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
