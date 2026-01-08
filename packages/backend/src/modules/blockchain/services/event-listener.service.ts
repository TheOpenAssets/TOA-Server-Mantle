import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Queue } from 'bullmq';
import { createPublicClient, http, webSocket, Address, parseAbiItem } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { ContractLoaderService } from './contract-loader.service';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';

@Injectable()
export class EventListenerService implements OnModuleInit {
  private readonly logger = new Logger(EventListenerService.name);
  private publicClient;

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
    @InjectQueue('event-processing') private eventQueue: Queue,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
  ) {
    const wssUrl = this.configService.get('blockchain.wssUrl');
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: wssUrl.startsWith('wss') ? webSocket(wssUrl) : http(wssUrl),
    });
  }

  onModuleInit() {
    this.startListening();
  }

  async startListening() {
    this.logger.log('Starting blockchain event listeners...');

    // Check if contracts are configured
    const contractsConfig = this.configService.get('blockchain.contracts');
    const hasContracts = contractsConfig && Object.values(contractsConfig).some(addr => addr && addr !== '');

    if (!hasContracts) {
      this.logger.warn('⚠️  Contract addresses not configured. Skipping blockchain event listeners.');
      this.logger.warn('   Deploy contracts and update .env to enable event listening.');
      return;
    }

    // Only watch contracts that are configured
    try {
      if (this.contractLoader.hasContract('AttestationRegistry')) {
        this.watchAttestationRegistry();
      }
      if (this.contractLoader.hasContract('TokenFactory')) {
        this.watchTokenFactory();
      }
      if (this.contractLoader.hasContract('IdentityRegistry')) {
        this.watchIdentityRegistry();
      }
      if (this.contractLoader.hasContract('PrimaryMarketplace')) {
        this.watchPrimaryMarketplace();
      }
      if (this.contractLoader.hasContract('YieldVault')) {
        this.watchYieldVault();
      }
      if (this.contractLoader.hasContract('SolvencyVault')) {
        this.watchSolvencyVault();
      }

      // CRITICAL FIX: Watch Transfer events for all existing deployed tokens
      // This ensures we don't miss events if the backend was restarted after token deployment
      await this.watchExistingTokens();
    } catch (error) {
      this.logger.error('Error starting event listeners:', error);
      this.logger.warn('Continuing without blockchain event listeners...');
    }
  }

  /**
   * Query database for all deployed tokens and start watching their Transfer events
   * This is critical for holder tracking after backend restarts
   */
  private async watchExistingTokens() {
    try {
      // Find all assets that have tokens deployed
      const assetsWithTokens = await this.assetModel.find({
        'token.address': { $exists: true, $ne: null },
      }).select('token.address assetId');

      if (assetsWithTokens.length === 0) {
        this.logger.log('No deployed tokens found in database - skipping existing token watch setup');
        return;
      }

      this.logger.log(`Found ${assetsWithTokens.length} deployed tokens - setting up Transfer event watchers...`);

      for (const asset of assetsWithTokens) {
        const tokenAddress = asset.token!.address;
        this.logger.log(`  ✓ Watching transfers for token: ${tokenAddress} (Asset: ${asset.assetId})`);
        this.watchTokenTransfers(tokenAddress as Address);
      }

      this.logger.log(`✅ Successfully set up Transfer watchers for ${assetsWithTokens.length} tokens`);
    } catch (error: any) {
      this.logger.error(`Failed to watch existing tokens: ${error?.message || error}`);
      // Don't throw - allow other listeners to continue working
    }
  }

  private watchAttestationRegistry() {
    const address = this.contractLoader.getContractAddress('AttestationRegistry');
    const abi = this.contractLoader.getContractAbi('AttestationRegistry');

    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'AssetRegistered',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { assetId, blobId, attestationHash, attestor } = log.args;
          await this.eventQueue.add('process-asset-registered', {
            assetId,
            blobId,
            attestationHash,
            attestor,
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
            // timestamp will be fetched in processor if needed, or we can use Date.now() approx
            timestamp: Math.floor(Date.now() / 1000), 
          });
        }
      },
    });

    this.logger.log(`Watching AttestationRegistry at ${address}`);
  }

  private watchTokenFactory() {
    const address = this.contractLoader.getContractAddress('TokenFactory');
    const abi = this.contractLoader.getContractAbi('TokenFactory');

    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'TokenSuiteDeployed',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { assetId, token, compliance, totalSupply } = log.args;
          await this.eventQueue.add('process-token-deployed', {
            assetId,
            tokenAddress: token,
            complianceAddress: compliance,
            totalSupply: totalSupply.toString(),
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
            timestamp: Math.floor(Date.now() / 1000),
          });
          
          // Dynamically start watching this new token's transfers
          this.watchTokenTransfers(token as Address);
        }
      },
    });

    this.logger.log(`Watching TokenFactory at ${address}`);
  }

  private watchIdentityRegistry() {
    const address = this.contractLoader.getContractAddress('IdentityRegistry');
    const abi = this.contractLoader.getContractAbi('IdentityRegistry');

    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'IdentityRegistered',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { wallet } = log.args;
          await this.eventQueue.add('process-identity-registered', {
            wallet,
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
            timestamp: Math.floor(Date.now() / 1000),
          });
        }
      },
    });

    this.logger.log(`Watching IdentityRegistry at ${address}`);
  }

  private watchPrimaryMarketplace() {
    const address = this.contractLoader.getContractAddress('PrimaryMarketplace');
    const abi = this.contractLoader.getContractAbi('PrimaryMarketplace');

    // Watch TokensPurchased (Static Sales)
    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'TokensPurchased',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { assetId, buyer, amount, price, totalPayment } = log.args;
          await this.eventQueue.add('process-token-purchased', {
            assetId,
            buyer,
            amount: amount.toString(),
            price: price.toString(),
            totalPayment: totalPayment.toString(),
            txHash: log.transactionHash,
          });
        }
      },
    });

    // Watch BidSubmitted
    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'BidSubmitted',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { assetId, bidder, tokenAmount, price, bidIndex } = log.args;
          await this.eventQueue.add('process-bid-submitted', {
            assetId,
            bidder,
            tokenAmount: tokenAmount.toString(),
            price: price.toString(),
            bidIndex: Number(bidIndex),
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          });
        }
      },
    });

    // Watch AuctionEnded
    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'AuctionEnded',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { assetId, clearingPrice, totalTokensSold } = log.args;
          await this.eventQueue.add('process-auction-ended', {
            assetId,
            clearingPrice: clearingPrice.toString(),
            totalTokensSold: totalTokensSold.toString(),
            txHash: log.transactionHash,
          });
        }
      },
    });

    // Watch BidSettled
    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'BidSettled',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { assetId, bidder, tokensReceived, cost, refund, bidIndex } = log.args;
          await this.eventQueue.add('process-bid-settled', {
            assetId,
            bidder,
            bidIndex: Number(bidIndex), // Assuming added to event or derived
            tokensReceived: tokensReceived.toString(),
            cost: cost.toString(),
            refund: refund.toString(),
            txHash: log.transactionHash,
          });
        }
      },
    });

    this.logger.log(`Watching PrimaryMarketplace at ${address}`);
  }

  private watchYieldVault() {
    const address = this.contractLoader.getContractAddress('YieldVault');
    const abi = this.contractLoader.getContractAbi('YieldVault');

    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'YieldDistributed',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { tokenAddress, totalAmount, holderCount } = log.args;
          await this.eventQueue.add('process-yield-distributed', {
            tokenAddress,
            totalAmount: totalAmount.toString(),
            holderCount: Number(holderCount),
            txHash: log.transactionHash,
          });
        }
      },
    });
  }

  private watchTokenTransfers(tokenAddress: Address) {
    this.logger.log(`Started dynamic monitoring for token: ${tokenAddress}`);

    this.publicClient.watchContractEvent({
      address: tokenAddress,
      abi: this.contractLoader.getContractAbi('RWAToken'),
      eventName: 'Transfer',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { from, to, value } = log.args;
          await this.eventQueue.add('process-transfer', {
            tokenAddress,
            from,
            to,
            amount: value.toString(),
            txHash: log.transactionHash,
          });
        }
      },
    });
  }

  private watchSolvencyVault() {
    const address = this.contractLoader.getContractAddress('SolvencyVault');
    const abi = this.contractLoader.getContractAbi('SolvencyVault');

    // Watch USDCBorrowed
    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'USDCBorrowed',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { positionId, amount, totalDebt } = log.args;
          await this.eventQueue.add('process-solvency-borrow', {
            positionId: Number(positionId),
            amount: amount.toString(),
            totalDebt: totalDebt.toString(),
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          });
        }
      },
    });

    // Watch LoanRepaid
    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'LoanRepaid',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { positionId, amountPaid, principal, interest, remainingDebt } = log.args;
          await this.eventQueue.add('process-solvency-repayment', {
            positionId: Number(positionId),
            amountPaid: amountPaid.toString(),
            principal: principal.toString(),
            interest: interest.toString(),
            remainingDebt: remainingDebt.toString(),
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          });
        }
      },
    });

    // Watch MissedPaymentMarked
    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'MissedPaymentMarked',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { positionId, missedPayments } = log.args;
          await this.eventQueue.add('process-solvency-missed-payment', {
            positionId: Number(positionId),
            missedPayments: Number(missedPayments),
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          });
        }
      },
    });

    // Watch PositionDefaulted
    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'PositionDefaulted',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { positionId } = log.args;
          await this.eventQueue.add('process-solvency-defaulted', {
            positionId: Number(positionId),
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          });
        }
      },
    });

    // Watch PositionLiquidated
    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'PositionLiquidated',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { positionId, marketplaceListingId } = log.args;
          await this.eventQueue.add('process-solvency-liquidated', {
            positionId: Number(positionId),
            marketplaceListingId: marketplaceListingId,
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          });
        }
      },
    });

    // Watch LiquidationSettled
    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'LiquidationSettled',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { positionId, yieldReceived, debtRepaid, userRefund } = log.args;
          await this.eventQueue.add('process-solvency-liquidation-settled', {
            positionId: Number(positionId),
            yieldReceived: yieldReceived.toString(),
            debtRepaid: debtRepaid.toString(),
            userRefund: userRefund.toString(),
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          });
        }
      },
    });

    // Watch CollateralWithdrawn
    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'CollateralWithdrawn',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { positionId, amount, remainingCollateral } = log.args;
          await this.eventQueue.add('process-solvency-withdrawal', {
            positionId: Number(positionId),
            amount: amount.toString(),
            remainingCollateral: remainingCollateral.toString(),
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          });
        }
      },
    });

    // Watch RepaymentPlanCreated
    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'RepaymentPlanCreated',
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          const { positionId, loanDuration, numberOfInstallments, installmentInterval } = log.args;
          await this.eventQueue.add('process-solvency-repayment-plan', {
            positionId: Number(positionId),
            loanDuration: Number(loanDuration),
            numberOfInstallments: Number(numberOfInstallments),
            installmentInterval: Number(installmentInterval),
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          });
        }
      },
    });

    this.logger.log(`Watching SolvencyVault at ${address}`);
  }
}
