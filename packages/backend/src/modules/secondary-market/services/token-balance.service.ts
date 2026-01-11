import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Address } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { P2POrder, P2POrderDocument, OrderStatus } from '../../../database/schemas/p2p-order.schema';
import { LeveragePosition } from '../../../database/schemas/leverage-position.schema';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';

export interface TokenBalanceInfo {
    assetId: string;
    tokenAddress: string;
    walletBalance: string; // Actual on-chain balance in user's wallet
    lockedInOrders: string; // Locked in active P2P sell orders
    inLeverageVault: string; // Tokens in LeverageVault (non-tradeable)
    tradeableBalance: string; // walletBalance - lockedInOrders
    walletBalanceFormatted: string;
    tradeableBalanceFormatted: string;
}

@Injectable()
export class TokenBalanceService {
    private readonly logger = new Logger(TokenBalanceService.name);
    private publicClient;

    constructor(
        private configService: ConfigService,
        private contractLoader: ContractLoaderService,
        @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
        @InjectModel(P2POrder.name) private orderModel: Model<P2POrderDocument>,
        @InjectModel(LeveragePosition.name) private leveragePositionModel: Model<LeveragePosition>,
    ) {
        this.publicClient = createPublicClient({
            chain: mantleSepolia,
            transport: http(this.configService.get('blockchain.rpcUrl')),
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
     * Get user's actual wallet balance from RWAToken contract
     */
    async getWalletBalance(userAddress: string, tokenAddress: string): Promise<string> {
        this.logger.debug(`[Balance Service] Querying on-chain balance - User: ${userAddress}, Token: ${tokenAddress}`);

        try {
            const erc20Abi = [
                {
                    type: 'function',
                    name: 'balanceOf',
                    stateMutability: 'view',
                    inputs: [{ name: 'account', type: 'address' }],
                    outputs: [{ type: 'uint256' }],
                },
            ] as const;

            const balance = await this.executeWithRetry(() => this.publicClient.readContract({
                address: tokenAddress as Address,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [userAddress as Address],
            }), 'getWalletBalance') as bigint;

            const balanceFormatted = (Number(balance) / 1e18).toFixed(4);
            this.logger.log(`[Balance Service] ✅ On-chain balance retrieved: ${balanceFormatted} tokens for ${userAddress}`);
            return balance.toString();
        } catch (error: any) {
            this.logger.error(`[Balance Service] ❌ Error fetching wallet balance for ${userAddress} on token ${tokenAddress}: ${error.message}`);
            return '0';
        }
    }

    /**
     * Get tradeable balance for a specific asset
     * Tradeable = Wallet Balance - Locked in Orders
     * Excludes tokens in LeverageVault (those are tracked separately)
     */
    async getTradeableBalance(userAddress: string, assetId: string): Promise<TokenBalanceInfo> {
        const normalizedAddress = userAddress.toLowerCase();
        this.logger.debug(`[Balance Service] Computing tradeable balance - User: ${normalizedAddress}, Asset: ${assetId}`);

        // Get asset to find token address
        const asset = await this.assetModel.findOne({ assetId });
        if (!asset || !asset.token?.address) {
            this.logger.error(`[Balance Service] Asset ${assetId} not found or has no token`);
            throw new Error(`Asset ${assetId} not found or has no token`);
        }

        const tokenAddress = asset.token.address;
        this.logger.debug(`[Balance Service] Token address resolved: ${tokenAddress}`);

        // 1. Get actual wallet balance from contract
        const walletBalance = await this.getWalletBalance(normalizedAddress, tokenAddress);

        // 2. Calculate tokens locked in active P2P sell orders
        const activeOrders = await this.orderModel.find({
            maker: normalizedAddress,
            assetId,
            status: OrderStatus.OPEN,
            isBuy: false, // Only sell orders lock tokens
        });

        this.logger.debug(`[Balance Service] Found ${activeOrders.length} active sell orders`);

        let lockedInOrders = BigInt(0);
        for (const order of activeOrders) {
            lockedInOrders += BigInt(order.remainingAmount);
        }

        // 3. Calculate tokens in LeverageVault (for informational purposes)
        let inLeverageVault = BigInt(0);
        try {
            const leveragePositions = await this.leveragePositionModel.find({
                userAddress: normalizedAddress,
                assetId,
                status: { $in: ['ACTIVE'] }, // Only active positions
            });

            for (const position of leveragePositions) {
                inLeverageVault += BigInt(position.rwaTokenAmount);
            }
            this.logger.debug(`[Balance Service] Found ${leveragePositions.length} active leverage positions, total: ${(Number(inLeverageVault) / 1e18).toFixed(4)} tokens`);
        } catch (error: any) {
            this.logger.warn(`[Balance Service] Could not fetch leverage positions: ${error.message}`);
        }

        // 4. Calculate tradeable balance
        const walletBalanceBigInt = BigInt(walletBalance);
        const tradeableBalance = walletBalanceBigInt;

        // Ensure tradeable balance is not negative (shouldn't happen but safety check)
        const finalTradeableBalance = tradeableBalance < BigInt(0) ? BigInt(0) : tradeableBalance;

        const result = {
            assetId,
            tokenAddress,
            walletBalance: walletBalance,
            lockedInOrders: lockedInOrders.toString(),
            inLeverageVault: inLeverageVault.toString(),
            tradeableBalance: finalTradeableBalance.toString(),
            walletBalanceFormatted: (Number(walletBalance) / 1e18).toFixed(4),
            tradeableBalanceFormatted: (Number(finalTradeableBalance) / 1e18).toFixed(4),
        };

        this.logger.log(`[Balance Service] ✅ Balance computed - Wallet: ${result.walletBalanceFormatted}, Locked: ${(Number(lockedInOrders) / 1e18).toFixed(4)}, Tradeable: ${result.tradeableBalanceFormatted}`);
        return result;
    }

    /**
     * Get tradeable balances for all assets owned by user
     */
    async getAllTradeableBalances(userAddress: string): Promise<TokenBalanceInfo[]> {
        const normalizedAddress = userAddress.toLowerCase();
        this.logger.log(`[Balance Service] Fetching all tradeable balances for user: ${normalizedAddress}`);

        // Find all assets where user has:
        // 1. Primary market purchases
        // 2. P2P trades (buyer)
        // 3. Active P2P orders
        // 4. Leverage positions

        // For now, we'll get unique asset IDs from orders and positions
        const orderAssets = await this.orderModel.distinct('assetId', {
            $or: [
                { maker: normalizedAddress },
                // We'll need to track taker addresses in future for complete coverage
            ]
        });

        const leverageAssets = await this.leveragePositionModel.distinct('assetId', {
            userAddress: normalizedAddress,
        });

        // Combine and deduplicate
        const allAssetIds = [...new Set([...orderAssets, ...leverageAssets])];
        this.logger.debug(`[Balance Service] Found ${allAssetIds.length} unique assets for user`);

        // Get tradeable balance for each asset
        const balances: TokenBalanceInfo[] = [];
        for (const assetId of allAssetIds) {
            try {
                const balance = await this.getTradeableBalance(normalizedAddress, assetId);
                // Only include assets where user has some balance or locked tokens
                if (BigInt(balance.walletBalance) > BigInt(0) || BigInt(balance.lockedInOrders) > BigInt(0)) {
                    balances.push(balance);
                }
            } catch (error: any) {
                this.logger.error(`[Balance Service] Error getting balance for asset ${assetId}: ${error.message}`);
            }
        }

        this.logger.log(`[Balance Service] Retrieved ${balances.length} asset balances with non-zero values`);
        return balances;
    }

    /**
     * Validate if user has sufficient tradeable balance for an order
     */
    async validateSufficientBalance(
        userAddress: string,
        assetId: string,
        requiredAmount: string,
    ): Promise<{ valid: boolean; reason?: string; balance?: TokenBalanceInfo }> {
        this.logger.debug(`[Balance Service] Validating sufficient balance - User: ${userAddress}, Asset: ${assetId}, Required: ${requiredAmount}`);

        try {
            const balance = await this.getTradeableBalance(userAddress, assetId);

            const required = BigInt(requiredAmount);
            const available = BigInt(balance.tradeableBalance);

            const requiredFormatted = (Number(required) / 1e18).toFixed(4);

            if (available < required) {
                const reason = `Insufficient tradeable balance. Required: ${requiredFormatted}, Available: ${balance.tradeableBalanceFormatted}`;
                this.logger.warn(`[Balance Service] ❌ Validation failed - ${reason}`);
                return {
                    valid: false,
                    reason,
                    balance,
                };
            }

            this.logger.log(`[Balance Service] ✅ Validation passed - Required: ${requiredFormatted}, Available: ${balance.tradeableBalanceFormatted}`);
            return {
                valid: true,
                balance,
            };
        } catch (error: any) {
            this.logger.error(`[Balance Service] ❌ Error validating balance: ${error.message}`);
            return {
                valid: false,
                reason: `Error validating balance: ${error.message}`,
            };
        }
    }
}
