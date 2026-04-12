import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Queue } from 'bullmq';
import { createPublicClient, http, fallback, Address, parseAbiItem, decodeEventLog, Log } from 'viem';
import { getActiveChain } from '@/src/config/active-chain';
import { ContractLoaderService } from './contract-loader.service';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
// IssuerVaultService is NOT imported here to avoid circular dependency.
// IssuerVault events are dispatched to the BullMQ queue and processed by
// IssuerVaultEventProcessor in the issuer-vault module.

@Injectable()
export class EventListenerService implements OnModuleInit {
  private readonly logger = new Logger(EventListenerService.name);
  private publicClient;
  private lastBlockNumber: bigint = 0n;
  private isPolling = false;
  private watchedTokenAddresses: Set<string> = new Set();
  private readonly blockTimestampCache = new Map<bigint, number>();

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
    @InjectQueue('event-processing') private eventQueue: Queue,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
  ) {
    // Use HTTP transport (polling) with optional multi-RPC fallback.
    // This helps on public endpoints that frequently return rate-limit errors.
    const rpcUrl = this.configService.get<string>('blockchain.rpcUrl') || '';
    const rpcUrlsFromEnv = (process.env.EXTRA_RPC_URLS || process.env.BNB_RPC_URLS || '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);

    const rpcCandidates = Array.from(new Set([rpcUrl, ...rpcUrlsFromEnv].filter(Boolean)));

    const transport = rpcCandidates.length > 1
      ? fallback(rpcCandidates.map((url) => http(url)))
      : http(rpcCandidates[0] || rpcUrl);

    this.publicClient = createPublicClient({
      chain: getActiveChain(),
      transport,
    });

    if (rpcCandidates.length > 1) {
      this.logger.log(`Event listener RPC fallback enabled (${rpcCandidates.length} endpoints)`);
    }
  }

  async onModuleInit() {
    await this.initializeListener();
  }

  async initializeListener() {
    this.logger.log('Initializing blockchain event listeners (Polling Mode)...');

    // Contract addresses come from the network-aware contract loader
    // (e.g. @contracts/bnb -> src/bnb.addresses.ts synced from deployed_contracts_bnb.json).
    const requiredContracts = [
      'SecondaryMarket',
      'PrimaryMarketplace',
      'TokenFactory',
      'IdentityRegistry',
      'AttestationRegistry',
      'YieldVault',
      'IssuerVault',
    ];
    const availableContracts = requiredContracts.filter((name) => this.contractLoader.hasContract(name));

    if (availableContracts.length === 0) {
      this.logger.warn('⚠️  No on-chain contract addresses resolved for active network. Skipping blockchain event listeners.');
      return;
    }

    this.logger.log(`Resolved contracts for event polling: ${availableContracts.join(', ')}`);

    // Load existing tokens to watch
    await this.loadExistingTokens();

    // Initialize last processed block to current block
    try {
      const currentBlock = await this.publicClient.getBlockNumber();
      // Start with configurable lookback so orders/trades created shortly before restart are not missed.
      // Default is intentionally larger than the safety buffer used during polling.
      const lookbackFromEnv = Number(process.env.EVENT_LISTENER_LOOKBACK_BLOCKS || '5000');
      const lookbackBlocks = Number.isFinite(lookbackFromEnv) && lookbackFromEnv > 0
        ? BigInt(Math.floor(lookbackFromEnv))
        : 5000n;

      this.lastBlockNumber = currentBlock > lookbackBlocks ? currentBlock - lookbackBlocks : 0n;
      this.logger.log(
        `Starting event polling from block ${this.lastBlockNumber} ` +
        `(current=${currentBlock}, lookback=${lookbackBlocks})`
      );
    } catch (error) {
      this.logger.error('Failed to get initial block number:', error);
    }

    const pollIntervalFromEnv = Number(process.env.EVENT_LISTENER_POLL_INTERVAL_MS || '8000');
    const pollIntervalMs = Number.isFinite(pollIntervalFromEnv) && pollIntervalFromEnv >= 1000
      ? Math.floor(pollIntervalFromEnv)
      : 8000;

    this.logger.log(`Event polling interval: ${pollIntervalMs}ms`);
    // Start polling loop
    setInterval(() => this.pollBlockchainEvents(), pollIntervalMs);
  }

  private async loadExistingTokens() {
    try {
      const assetsWithTokens = await this.assetModel.find({
        'token.address': { $exists: true, $ne: null },
      }).select('token.address');

      for (const asset of assetsWithTokens) {
        if (asset.token?.address && asset.token.address.startsWith('0x')) {
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

      // Process small ranges to stay under strict public RPC getLogs limits.
      // BNB public endpoints often reject wider windows with "limit exceeded".
      const maxRangeFromEnv = Number(process.env.EVENT_LISTENER_MAX_RANGE_BLOCKS || '20');
      const maxRange = Number.isFinite(maxRangeFromEnv) && maxRangeFromEnv > 0
        ? BigInt(Math.floor(maxRangeFromEnv))
        : 20n;
      let toBlock = safeBlock;
      if (toBlock - this.lastBlockNumber > maxRange) {
        toBlock = this.lastBlockNumber + maxRange;
      }

      const fromBlock = this.lastBlockNumber + 1n;

      // Allow lightweight mode to focus only on SecondaryMarket ingestion.
      // Useful on strict public RPC endpoints that frequently rate-limit getLogs calls.
      const onlySecondary = (process.env.EVENT_LISTENER_ONLY_SECONDARY || 'false').toLowerCase() === 'true';

      const checks: Array<{ name: string; run: () => Promise<void> }> = [
        { name: 'SecondaryMarket', run: () => this.checkSecondaryMarket(fromBlock, toBlock) },
        { name: 'PrimaryMarketplace', run: () => this.checkPrimaryMarketplace(fromBlock, toBlock) },
        { name: 'AttestationRegistry', run: () => this.checkAttestationRegistry(fromBlock, toBlock) },
        { name: 'TokenFactory', run: () => this.checkTokenFactory(fromBlock, toBlock) },
        { name: 'IdentityRegistry', run: () => this.checkIdentityRegistry(fromBlock, toBlock) },
        { name: 'YieldVault', run: () => this.checkYieldVault(fromBlock, toBlock) },
        { name: 'IssuerVault', run: () => this.checkIssuerVault(fromBlock, toBlock) },
        { name: 'SolvencyVault', run: () => this.checkSolvencyVault(fromBlock, toBlock) },
        { name: 'TokenTransfers', run: () => this.checkTokenTransfers(fromBlock, toBlock) },
      ];

      const activeChecks = onlySecondary
        ? checks.filter((check) => check.name === 'SecondaryMarket')
        : checks;

      if (onlySecondary) {
        this.logger.debug('EVENT_LISTENER_ONLY_SECONDARY=true -> polling SecondaryMarket only');
      }

      // Run sequentially to avoid bursty RPC calls that trigger provider rate limits.
      for (const check of activeChecks) {
        try {
          await check.run();
        } catch (error) {
          this.logger.error(`Event check failed for ${check.name}:`, error);
        }
      }

      this.lastBlockNumber = toBlock;
    } catch (error) {
      this.logger.error('Error polling events:', error);
    } finally {
      this.isPolling = false;
    }
  }

  private async getBlockTimestamp(blockNumber: bigint): Promise<number> {
    const cached = this.blockTimestampCache.get(blockNumber);
    if (cached) {
      return cached;
    }

    const block = await this.publicClient.getBlock({ blockNumber });
    const timestamp = Number(block.timestamp);

    // Keep cache bounded to avoid unbounded memory growth in long-running processes.
    if (this.blockTimestampCache.size > 1000) {
      const oldest = this.blockTimestampCache.keys().next().value;
      if (oldest !== undefined) {
        this.blockTimestampCache.delete(oldest);
      }
    }
    this.blockTimestampCache.set(blockNumber, timestamp);

    return timestamp;
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

            // Add new token to watchlist (EVM addresses only)
            if (args.token?.startsWith('0x')) {
              this.watchedTokenAddresses.add(args.token.toLowerCase());
            }
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

  private async checkIssuerVault(fromBlock: bigint, toBlock: bigint) {
    if (!this.contractLoader.hasContract('IssuerVault')) return;

    const address = this.contractLoader.getContractAddress('IssuerVault');
    const abi = this.contractLoader.getContractAbi('IssuerVault');

    try {
      const logs = await this.publicClient.getLogs({
        address: address as Address,
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        try {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }) as { eventName: string; args: any };
          const { eventName, args } = decoded;

          // Convert bytes32 assetId back to UUID-style string
          // The backend stored it as 0x<32-hex-chars-padded-to-64>, reverse the padding
          const bytes32: string = args.assetId ?? '';
          const hex = bytes32.replace(/^0x/, '').replace(/0+$/, '');
          const assetId = hex.length >= 32
            ? `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`
            : bytes32;

          if (eventName === 'DepositReceived') {
            await this.eventQueue.add('issuer-vault-deposit-received', {
              assetId,
              amount: args.amount?.toString(),
              txHash: log.transactionHash,
            });
          } else if (eventName === 'LiquidityWithdrawn') {
            await this.eventQueue.add('issuer-vault-liquidity-withdrawn', {
              assetId,
              amount: args.amount?.toString(),
              txHash: log.transactionHash,
            });
          } else if (eventName === 'DebtRepaid') {
            await this.eventQueue.add('issuer-vault-debt-repaid', {
              assetId,
              txHash: log.transactionHash,
            });
          } else if (eventName === 'VaultFullyRepaid') {
            await this.eventQueue.add('issuer-vault-fully-repaid', {
              assetId,
              totalInterest: args.totalInterest?.toString(),
              txHash: log.transactionHash,
            });
          }
        } catch { /* ignore decode errors on unrelated logs */ }
      }
    } catch (error) {
      this.logger.error(`Error checking IssuerVault events: ${error}`);
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
            const blockTimestamp = await this.getBlockTimestamp(log.blockNumber!);
            await this.eventQueue.add('process-p2p-order-created', {
              orderId: args.orderId.toString(),
              maker: args.maker,
              tokenAddress: args.tokenAddress,
              amount: args.amount.toString(),
              pricePerToken: args.pricePerToken.toString(),
              isBuy: args.isBuy,
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
              timestamp: blockTimestamp,
            });
          } else if (eventName === 'OrderFilled') {
            this.logger.log(`[P2P Event] OrderFilled detected: #${args.orderId}, amount: ${args.amountFilled.toString()}`);
            const blockTimestamp = await this.getBlockTimestamp(log.blockNumber!);
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
              timestamp: blockTimestamp,
            });
          } else if (eventName === 'OrderCancelled') {
            this.logger.log(`[P2P Event] OrderCancelled detected: #${args.orderId}`);
            const blockTimestamp = await this.getBlockTimestamp(log.blockNumber!);
            await this.eventQueue.add('process-p2p-order-cancelled', {
              orderId: args.orderId.toString(),
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
              timestamp: blockTimestamp,
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

    // try {
    //   const logs = await this.publicClient.getLogs({
    //     address: address as Address,
    //     fromBlock,
    //     toBlock,
    //   });

    //   for (const log of logs) {
    //     try {
    //       const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }) as { eventName: string; args: any };
    //       const args = decoded.args;
    //       const eventName = decoded.eventName;

    //       if (eventName === 'USDCBorrowed') {
    //         await this.eventQueue.add('process-solvency-borrow', {
    //           positionId: Number(args.positionId),
    //           amount: args.amount.toString(),
    //           totalDebt: args.totalDebt.toString(),
    //           txHash: log.transactionHash,
    //           blockNumber: Number(log.blockNumber),
    //         });
    //       } else if (eventName === 'LoanRepaid') {
    //         await this.eventQueue.add('process-solvency-repayment', {
    //           positionId: Number(args.positionId),
    //           amountPaid: args.amountPaid.toString(),
    //           principal: args.principal.toString(),
    //           interest: args.interest.toString(),
    //           remainingDebt: args.remainingDebt.toString(),
    //           txHash: log.transactionHash,
    //           blockNumber: Number(log.blockNumber),
    //         });
    //       } else if (eventName === 'MissedPaymentMarked') {
    //         await this.eventQueue.add('process-solvency-missed-payment', {
    //           positionId: Number(args.positionId),
    //           missedPayments: Number(args.missedPayments),
    //           txHash: log.transactionHash,
    //           blockNumber: Number(log.blockNumber),
    //         });
    //       } else if (eventName === 'PositionDefaulted') {
    //         await this.eventQueue.add('process-solvency-defaulted', {
    //           positionId: Number(args.positionId),
    //           txHash: log.transactionHash,
    //           blockNumber: Number(log.blockNumber),
    //         });
    //       } else if (eventName === 'PositionLiquidated') {
    //         await this.eventQueue.add('process-solvency-liquidated', {
    //           positionId: Number(args.positionId),
    //           marketplaceListingId: args.marketplaceListingId,
    //           txHash: log.transactionHash,
    //           blockNumber: Number(log.blockNumber),
    //         });
    //       } else if (eventName === 'LiquidationSettled') {
    //         await this.eventQueue.add('process-solvency-liquidation-settled', {
    //           positionId: Number(args.positionId),
    //           yieldReceived: args.yieldReceived.toString(),
    //           debtRepaid: args.debtRepaid.toString(),
    //           userRefund: args.userRefund.toString(),
    //           txHash: log.transactionHash,
    //           blockNumber: Number(log.blockNumber),
    //         });
    //       } else if (eventName === 'CollateralWithdrawn') {
    //         await this.eventQueue.add('process-solvency-withdrawal', {
    //           positionId: Number(args.positionId),
    //           amount: args.amount.toString(),
    //           remainingCollateral: args.remainingCollateral.toString(),
    //           txHash: log.transactionHash,
    //           blockNumber: Number(log.blockNumber),
    //         });
    //       } else if (eventName === 'RepaymentPlanCreated') {
    //         await this.eventQueue.add('process-solvency-repayment-plan', {
    //           positionId: Number(args.positionId),
    //           loanDuration: Number(args.loanDuration),
    //           numberOfInstallments: Number(args.numberOfInstallments),
    //           installmentInterval: Number(args.installmentInterval),
    //           txHash: log.transactionHash,
    //           blockNumber: Number(log.blockNumber),
    //         });
    //       }
    //     } catch { /* ignore decode errors */ }
    //   }
    // } catch (error) {
    //   this.logger.error(`Error checking SolvencyVault events: ${error}`);
    //   throw error;
    // }
  }
}
