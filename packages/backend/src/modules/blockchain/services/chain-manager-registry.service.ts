import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NetworkType } from '@openassets/types';
import { ChainManager } from '../interfaces/chain-manager.interface';
import { MantleChainManager } from '../managers/mantle.manager';
import { ArbitrumChainManager } from '../managers/arbitrum.manager';
import { StellarChainManager } from '../managers/stellar.manager';
import { CreditCoinChainManager } from '../managers/creditcoin.manager';

@Injectable()
export class ChainManagerRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChainManagerRegistry.name);
  private readonly managers: Map<NetworkType, ChainManager> = new Map();

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.initializeManagers();
    await this.startOperations();
  }

  async onModuleDestroy() {
    await this.stopOperations();
  }

  private initializeManagers() {
    // For now, we still use NETWORK_TYPE, but ENABLED_NETWORKS will replace it in Pillar 3
    const enabledNetworksStr = this.configService.get<string>('ENABLED_NETWORKS') || 
                             this.configService.get<string>('network.networkType') || 
                             'mantle';
    
    const enabledNetworks = enabledNetworksStr.split(',').map(n => n.trim() as NetworkType);

    if (enabledNetworks.includes(NetworkType.MANTLE)) {
      this.managers.set(NetworkType.MANTLE, new MantleChainManager(this.configService));
      this.logger.log('MantleChainManager initialized');
    }

    if (enabledNetworks.includes(NetworkType.ARBITRUM)) {
      this.managers.set(NetworkType.ARBITRUM, new ArbitrumChainManager(this.configService));
      this.logger.log('ArbitrumChainManager initialized');
    }

    if (enabledNetworks.includes(NetworkType.STELLAR)) {
      this.managers.set(NetworkType.STELLAR, new StellarChainManager());
      this.logger.log('StellarChainManager initialized');
    }

    if (enabledNetworks.includes(NetworkType.CREDITCOIN)) {
      this.managers.set(NetworkType.CREDITCOIN, new CreditCoinChainManager(this.configService));
      this.logger.log('CreditCoinChainManager initialized');
    }
  }

  private async startOperations() {
    for (const manager of this.managers.values()) {
      await manager.startBackgroundOperations();
    }
  }

  private async stopOperations() {
    for (const manager of this.managers.values()) {
      await manager.stopBackgroundOperations();
    }
  }

  getManager(type: NetworkType): ChainManager {
    const manager = this.managers.get(type);
    if (!manager) {
      throw new Error(`Chain manager for ${type} not initialized`);
    }
    return manager;
  }

  getEnabledNetworks(): NetworkType[] {
    return Array.from(this.managers.keys());
  }
}
