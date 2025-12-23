import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createPublicClient, http, webSocket, Address, parseAbiItem } from 'viem';
import { mantleSepolia } from 'viem/chains';
import { ContractLoaderService } from './contract-loader.service';

@Injectable()
export class EventListenerService implements OnModuleInit {
  private readonly logger = new Logger(EventListenerService.name);
  private publicClient;

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
    @InjectQueue('event-processing') private eventQueue: Queue,
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

    this.watchAttestationRegistry();
    this.watchTokenFactory();
    this.watchIdentityRegistry();
    this.watchPrimaryMarketplace();
    this.watchYieldVault();
  }

  private watchAttestationRegistry() {
    const address = this.contractLoader.getContractAddress('AttestationRegistry');
    const abi = this.contractLoader.getContractAbi('AttestationRegistry');

    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'AssetRegistered',
      onLogs: async (logs) => {
        for (const log of logs) {
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
        for (const log of logs) {
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
        for (const log of logs) {
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

    this.publicClient.watchContractEvent({
      address: address as Address,
      abi,
      eventName: 'TokensPurchased',
      onLogs: async (logs) => {
        for (const log of logs) {
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
        for (const log of logs) {
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
        for (const log of logs) {
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
}
