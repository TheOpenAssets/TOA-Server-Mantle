import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Queue } from 'bullmq';
import { createPublicClient, http, Address, parseAbiItem, decodeEventLog, Log } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { ContractLoaderService } from './contract-loader.service';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';

@Injectable()
export class EventListenerService implements OnModuleInit {
  private readonly logger = new Logger(EventListenerService.name);
  private publicClient;
  private lastBlockNumber: bigint = 0n;
  private isPolling = false;
  private watchedTokenAddresses: Set<string> = new Set();

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
    @InjectQueue('event-processing') private eventQueue: Queue,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
  ) {
    // Use HTTP transport (polling) to avoid WebSocket subscription limits on public RPCs
    const rpcUrl = this.configService.get('blockchain.rpcUrl');
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(rpcUrl),
    });
  }

  async onModuleInit() {
    await this.initializeListener();
  }

  async initializeListener() {
    this.logger.log('Initializing blockchain event listeners (Polling Mode)...');

    // Check if contracts are configured
    const contractsConfig = this.configService.get('blockchain.contracts');
    const hasContracts = contractsConfig && Object.values(contractsConfig).some(addr => addr && addr !== '');

    if (!hasContracts) {
      this.logger.warn('⚠️  Contract addresses not configured. Skipping blockchain event listeners.');
      return;
    }

    // Load existing tokens to watch
    await this.loadExistingTokens();

    // Initialize last processed block to current block
    try {
      const currentBlock = await this.publicClient.getBlockNumber();
      // Start slightly behind to ensure block availability on all RPC nodes
      this.lastBlockNumber = currentBlock > 5n ? currentBlock - 5n : 0n;
      this.logger.log(`Starting event polling from block ${this.lastBlockNumber}`);
    } catch (error) {
      this.logger.error('Failed to get initial block number:', error);
    }

    // Start polling loop (every 3 seconds)
    setInterval(() => this.pollBlockchainEvents(), 3000);
  }

  private async loadExistingTokens() {
    try {
      const assetsWithTokens = await this.assetModel.find({
        'token.address': { $exists: true, $ne: null },
      }).select('token.address');

      for (const asset of assetsWithTokens) {
        if (asset.token?.address) {
          this.watchedTokenAddresses.add(asset.token.address.toLowerCase());
        }
      }
      this.logger.log(`Loaded ${this.watchedTokenAddresses.size} tokens for monitoring`);
    } catch (error) {
      this.logger.error('Failed to load existing tokens:', error);
    }
  }

  private async pollBlockchainEvents() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const currentBlock = await this.publicClient.getBlockNumber();
      // Use a buffer to avoid "block not found" errors on load-balanced RPCs
      const safeBlock = currentBlock > 5n ? currentBlock - 5n : 0n;

      if (safeBlock <= this.lastBlockNumber) {
        this.isPolling = false;
        return;
      }

      // Process max 100 blocks at a time to avoid RPC limits
      const maxRange = 100n;
      let toBlock = safeBlock;
      if (toBlock - this.lastBlockNumber > maxRange) {
        toBlock = this.lastBlockNumber + maxRange;
      }

      const fromBlock = this.lastBlockNumber + 1n;

      // Execute checks in parallel
      await Promise.all([
        this.checkSecondaryMarket(fromBlock, toBlock),
        this.checkPrimaryMarketplace(fromBlock, toBlock),
        this.checkAttestationRegistry(fromBlock, toBlock),
        this.checkTokenFactory(fromBlock, toBlock),
        this.checkIdentityRegistry(fromBlock, toBlock),
        this.checkYieldVault(fromBlock, toBlock),
        this.checkSolvencyVault(fromBlock, toBlock),
        this.checkTokenTransfers(fromBlock, toBlock),
      ]);

      this.lastBlockNumber = toBlock;
    } catch (error) {
      this.logger.error('Error polling events:', error);
    } finally {
      this.isPolling = false;
    }
  }

  private async checkAttestationRegistry(fromBlock: bigint, toBlock: bigint) {
    if (!this.contractLoader.hasContract('AttestationRegistry')) return;
    const address = this.contractLoader.getContractAddress('AttestationRegistry');
    const abi = this.contractLoader.getContractAbi('AttestationRegistry');

    try {
      const logs = await this.publicClient.getLogs({
        address: address as Address,
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        try {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }) as { eventName: string; args: any };
          if (decoded.eventName === 'AssetRegistered') {
            const args = decoded.args;
            await this.eventQueue.add('process-asset-registered', {
              assetId: args.assetId,
              blobId: args.blobId,
              attestationHash: args.attestationHash,
              attestor: args.attestor,
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
              timestamp: Math.floor(Date.now() / 1000),
            });
          }
        } catch { /* ignore decode errors */ }
      }
    } catch (error) {
      this.logger.error(`Error checking AttestationRegistry events: ${error}`);
      throw error;
    }
  }

  private async checkTokenFactory(fromBlock: bigint, toBlock: bigint) {
    if (!this.contractLoader.hasContract('TokenFactory')) return;
    const address = this.contractLoader.getContractAddress('TokenFactory');
    const abi = this.contractLoader.getContractAbi('TokenFactory');

    try {
      const logs = await this.publicClient.getLogs({
        address: address as Address,
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        try {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }) as { eventName: string; args: any };
          if (decoded.eventName === 'TokenSuiteDeployed') {
            const args = decoded.args;
            await this.eventQueue.add('process-token-deployed', {
              assetId: args.assetId,
              tokenAddress: args.token,
              complianceAddress: args.compliance,
              totalSupply: args.totalSupply.toString(),
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
              timestamp: Math.floor(Date.now() / 1000),
            });

            // Add new token to watchlist
            this.watchedTokenAddresses.add(args.token.toLowerCase());
          }
        } catch { /* ignore decode errors */ }
      }
    } catch (error) {
      this.logger.error(`Error checking TokenFactory events: ${error}`);
      throw error;
    }
  }

  private async checkIdentityRegistry(fromBlock: bigint, toBlock: bigint) {
    if (!this.contractLoader.hasContract('IdentityRegistry')) return;
    const address = this.contractLoader.getContractAddress('IdentityRegistry');
    const abi = this.contractLoader.getContractAbi('IdentityRegistry');

    try {
      const logs = await this.publicClient.getLogs({
        address: address as Address,
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        try {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }) as { eventName: string; args: any };
          if (decoded.eventName === 'IdentityRegistered') {
            const args = decoded.args;
            await this.eventQueue.add('process-identity-registered', {
              wallet: args.wallet,
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
              timestamp: Math.floor(Date.now() / 1000),
            });
          }
        } catch { /* ignore decode errors */ }
      }
    } catch (error) {
      this.logger.error(`Error checking IdentityRegistry events: ${error}`);
      throw error;
    }
  }

  private async checkPrimaryMarketplace(fromBlock: bigint, toBlock: bigint) {
    if (!this.contractLoader.hasContract('PrimaryMarketplace')) return;
    const address = this.contractLoader.getContractAddress('PrimaryMarketplace');
    const abi = this.contractLoader.getContractAbi('PrimaryMarketplace');

    try {
      const logs = await this.publicClient.getLogs({
        address: address as Address,
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        try {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }) as { eventName: string; args: any };
          const args = decoded.args;
          const eventName = decoded.eventName;

          if (eventName === 'TokensPurchased') {
            await this.eventQueue.add('process-token-purchased', {
              assetId: args.assetId,
              buyer: args.buyer,
              amount: args.amount.toString(),
              price: args.price.toString(),
              totalPayment: args.totalPayment.toString(),
              txHash: log.transactionHash,
            });
          } else if (eventName === 'BidSubmitted') {
            await this.eventQueue.add('process-bid-submitted', {
              assetId: args.assetId,
              bidder: args.bidder,
              tokenAmount: args.tokenAmount.toString(),
              price: args.price.toString(),
              bidIndex: Number(args.bidIndex),
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
            });
          } else if (eventName === 'AuctionEnded') {
            await this.eventQueue.add('process-auction-ended', {
              assetId: args.assetId,
              clearingPrice: args.clearingPrice.toString(),
              totalTokensSold: args.totalTokensSold.toString(),
              txHash: log.transactionHash,
            });
          } else if (eventName === 'BidSettled') {
            await this.eventQueue.add('process-bid-settled', {
              assetId: args.assetId,
              bidder: args.bidder,
              bidIndex: Number(args.bidIndex),
              tokensReceived: args.tokensReceived.toString(),
              cost: args.cost.toString(),
              refund: args.refund.toString(),
              txHash: log.transactionHash,
            });
          }
        } catch { /* ignore decode errors */ }
      }
    } catch (error) {
      this.logger.error(`Error checking PrimaryMarketplace events: ${error}`);
      throw error;
    }
  }

  private async checkYieldVault(fromBlock: bigint, toBlock: bigint) {
    if (!this.contractLoader.hasContract('YieldVault')) return;
    const address = this.contractLoader.getContractAddress('YieldVault');
    const abi = this.contractLoader.getContractAbi('YieldVault');

    try {
      const logs = await this.publicClient.getLogs({
        address: address as Address,
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        try {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }) as { eventName: string; args: any };
          if (decoded.eventName === 'YieldDistributed') {
            const args = decoded.args;
            await this.eventQueue.add('process-yield-distributed', {
              tokenAddress: args.tokenAddress,
              totalAmount: args.totalAmount.toString(),
              holderCount: Number(args.holderCount),
              txHash: log.transactionHash,
            });
          }
        } catch { /* ignore decode errors */ }
      }
    } catch (error) {
      this.logger.error(`Error checking YieldVault events: ${error}`);
      throw error;
    }
  }

  private async checkSecondaryMarket(fromBlock: bigint, toBlock: bigint) {
    if (!this.contractLoader.hasContract('SecondaryMarket')) return;
    const address = this.contractLoader.getContractAddress('SecondaryMarket');
    const abi = this.contractLoader.getContractAbi('SecondaryMarket');

    try {
      const logs = await this.publicClient.getLogs({
        address: address as Address,
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        try {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }) as { eventName: string; args: any };
          const args = decoded.args;
          const eventName = decoded.eventName;

          if (eventName === 'OrderCreated') {
            this.logger.log(`[P2P Event] OrderCreated detected: #${args.orderId} by ${args.maker}`);
            await this.eventQueue.add('process-p2p-order-created', {
              orderId: args.orderId.toString(),
              maker: args.maker,
              tokenAddress: args.tokenAddress,
              amount: args.amount.toString(),
              pricePerToken: args.pricePerToken.toString(),
              isBuy: args.isBuy,
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
              timestamp: Math.floor(Date.now() / 1000),
            });
          } else if (eventName === 'OrderFilled') {
            this.logger.log(`[P2P Event] OrderFilled detected: #${args.orderId}, amount: ${args.amountFilled.toString()}`);
            await this.eventQueue.add('process-p2p-order-filled', {
              orderId: args.orderId.toString(),
              taker: args.taker,
              maker: args.maker,
              tokenAddress: args.tokenAddress,
              amountFilled: args.amountFilled.toString(),
              totalCost: args.totalCost.toString(),
              remainingAmount: args.remainingAmount.toString(),
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
              timestamp: Math.floor(Date.now() / 1000),
            });
          } else if (eventName === 'OrderCancelled') {
            this.logger.log(`[P2P Event] OrderCancelled detected: #${args.orderId}`);
            await this.eventQueue.add('process-p2p-order-cancelled', {
              orderId: args.orderId.toString(),
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
              timestamp: Math.floor(Date.now() / 1000),
            });
          }
        } catch { /* ignore decode errors */ }
      }
    } catch (error) {
      this.logger.error(`Error checking SecondaryMarket events: ${error}`);
      throw error;
    }
  }

  private async checkTokenTransfers(fromBlock: bigint, toBlock: bigint) {
    if (this.watchedTokenAddresses.size === 0) return;

    try {
      const logs = await this.publicClient.getLogs({
        address: Array.from(this.watchedTokenAddresses) as Address[],
        event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        const args = log.args;
        await this.eventQueue.add('process-transfer', {
          tokenAddress: log.address,
          from: args.from,
          to: args.to,
          amount: args.value!.toString(),
          txHash: log.transactionHash,
        });
      }
    } catch (error) {
      this.logger.error(`Error checking Token Transfer events: ${error}`);
      throw error;
    }
  }

  private async checkSolvencyVault(fromBlock: bigint, toBlock: bigint) {
    if (!this.contractLoader.hasContract('SolvencyVault')) return;
    const address = this.contractLoader.getContractAddress('SolvencyVault');
    const abi = this.contractLoader.getContractAbi('SolvencyVault');

    try {
      const logs = await this.publicClient.getLogs({
        address: address as Address,
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        try {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }) as { eventName: string; args: any };
          const args = decoded.args;
          const eventName = decoded.eventName;

          if (eventName === 'USDCBorrowed') {
            await this.eventQueue.add('process-solvency-borrow', {
              positionId: Number(args.positionId),
              amount: args.amount.toString(),
              totalDebt: args.totalDebt.toString(),
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
            });
          } else if (eventName === 'LoanRepaid') {
            await this.eventQueue.add('process-solvency-repayment', {
              positionId: Number(args.positionId),
              amountPaid: args.amountPaid.toString(),
              principal: args.principal.toString(),
              interest: args.interest.toString(),
              remainingDebt: args.remainingDebt.toString(),
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
            });
          } else if (eventName === 'MissedPaymentMarked') {
            await this.eventQueue.add('process-solvency-missed-payment', {
              positionId: Number(args.positionId),
              missedPayments: Number(args.missedPayments),
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
            });
          } else if (eventName === 'PositionDefaulted') {
            await this.eventQueue.add('process-solvency-defaulted', {
              positionId: Number(args.positionId),
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
            });
          } else if (eventName === 'PositionLiquidated') {
            await this.eventQueue.add('process-solvency-liquidated', {
              positionId: Number(args.positionId),
              marketplaceListingId: args.marketplaceListingId,
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
            });
          } else if (eventName === 'LiquidationSettled') {
            await this.eventQueue.add('process-solvency-liquidation-settled', {
              positionId: Number(args.positionId),
              yieldReceived: args.yieldReceived.toString(),
              debtRepaid: args.debtRepaid.toString(),
              userRefund: args.userRefund.toString(),
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
            });
          } else if (eventName === 'CollateralWithdrawn') {
            await this.eventQueue.add('process-solvency-withdrawal', {
              positionId: Number(args.positionId),
              amount: args.amount.toString(),
              remainingCollateral: args.remainingCollateral.toString(),
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
            });
          } else if (eventName === 'RepaymentPlanCreated') {
            await this.eventQueue.add('process-solvency-repayment-plan', {
              positionId: Number(args.positionId),
              loanDuration: Number(args.loanDuration),
              numberOfInstallments: Number(args.numberOfInstallments),
              installmentInterval: Number(args.installmentInterval),
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
            });
          }
        } catch { /* ignore decode errors */ }
      }
    } catch (error) {
      this.logger.error(`Error checking SolvencyVault events: ${error}`);
      throw error;
    }
  }
}
