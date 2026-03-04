import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { NetworkType } from '@openassets/types';
import { NetworkContextService } from '../../blockchain/services/network-context.service';
import {
  ASSET_ORIGINATION_SERVICE,
  ADMIN_DOMAIN_STRATEGY,
  NETWORK_TOKEN_MAP,
} from '../registry.constants';
import { IAssetOriginationService } from '../interfaces/asset-origination.interface';
import { IAdminDomainStrategy } from '../interfaces/admin-domain.interface';

@Injectable()
export class ModuleRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ModuleRegistryService.name);

  // Maps network -> (service key -> implementation)
  private readonly implementationMap = new Map<NetworkType, Map<string, any>>();

  constructor(
    private configService: ConfigService,
    private moduleRef: ModuleRef,
    private networkContextService: NetworkContextService,
  ) { }

  async onModuleInit() {
    this.logger.log('Initializing ModuleRegistry for multi-network support');
    await this.resolveAllImplementations();
  }

  private async resolveAllImplementations() {
    const rawConfig = this.configService.get<string>('ENABLED_NETWORKS') || this.configService.get<string>('network.networkType') || 'mantle';
    const networks = rawConfig.split(',').map(n => n.trim() as NetworkType).filter(n => n !== NetworkType.UNKNOWN);

    for (const network of networks) {
      const networkMap = new Map<string, any>();
      this.implementationMap.set(network, networkMap);

      const tokens = NETWORK_TOKEN_MAP[network];
      if (tokens) {
        const assetToken = tokens[ASSET_ORIGINATION_SERVICE];
        if (assetToken) {
          await this.resolveAndRegister(network, ASSET_ORIGINATION_SERVICE, assetToken);
        }

        const adminToken = tokens[ADMIN_DOMAIN_STRATEGY];
        if (adminToken) {
          await this.resolveAndRegister(network, ADMIN_DOMAIN_STRATEGY, adminToken);
        }
      }
    }
  }

  private async resolveAndRegister(network: NetworkType, key: string, token: string) {
    try {
      const service = this.moduleRef.get(token, { strict: false });
      if (service) {
        this.implementationMap.get(network)?.set(key, service);
        this.logger.debug(`Registered ${key} for ${network}: ${token}`);
      }
    } catch (e) {
      // Expected if implementation is not registered in the module
      this.logger.warn(`Could not resolve ${token} for ${network}. Implementation might not be loaded.`);
    }
  }

  getAssetOriginationService(): IAssetOriginationService {
    return this.getService<IAssetOriginationService>(ASSET_ORIGINATION_SERVICE);
  }

  getAdminDomainStrategy(): IAdminDomainStrategy {
    return this.getService<IAdminDomainStrategy>(ADMIN_DOMAIN_STRATEGY);
  }

  /**
   * Generic getter for any registered service, resolving by current context network
   */
  getService<T>(token: string): T {
    const network = this.networkContextService.getNetwork();
    const networkMap = this.implementationMap.get(network);
    const service = networkMap?.get(token);

    if (!service) {
      this.logger.error(`Service ${token} not available for network ${network}`);
      throw new Error(`Service ${token} not available for network ${network}`);
    }

    return service as T;
  }
}
