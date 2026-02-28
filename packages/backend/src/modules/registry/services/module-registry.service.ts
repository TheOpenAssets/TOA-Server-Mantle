import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { NetworkType } from '@openassets/types';
import {
  ASSET_ORIGINATION_SERVICE,
  MANTLE_ASSET_ORIGINATION_TOKEN,
  STELLAR_ASSET_ORIGINATION_TOKEN,
  ADMIN_DOMAIN_STRATEGY,
  MANTLE_ADMIN_STRATEGY_TOKEN,
  STELLAR_ADMIN_STRATEGY_TOKEN,
} from '../registry.constants';
import { IAssetOriginationService } from '../interfaces/asset-origination.interface';
import { IAdminDomainStrategy } from '../interfaces/admin-domain.interface';

@Injectable()
export class ModuleRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ModuleRegistryService.name);
  private readonly serviceMap = new Map<string, any>();
  private networkType?: NetworkType;

  constructor(
    private configService: ConfigService,
    private moduleRef: ModuleRef,
  ) { }

  async onModuleInit() {
    this.networkType = this.configService.get<NetworkType>('network.networkType') || NetworkType.MANTLE;
    this.logger.log(`Initializing ModuleRegistry for network: ${this.networkType}`);

    await this.resolveServices();
  }

  private async resolveServices() {
    try {
      // Resolve Asset Origination Service
      const isEvm = this.networkType === NetworkType.MANTLE || this.networkType === NetworkType.ARBITRUM;
      const assetToken = isEvm
        ? MANTLE_ASSET_ORIGINATION_TOKEN
        : STELLAR_ASSET_ORIGINATION_TOKEN;

      await this.resolveService(ASSET_ORIGINATION_SERVICE, assetToken);

      // Resolve Admin Domain Strategy
      const adminToken = isEvm
        ? MANTLE_ADMIN_STRATEGY_TOKEN
        : STELLAR_ADMIN_STRATEGY_TOKEN;

      await this.resolveService(ADMIN_DOMAIN_STRATEGY, adminToken);

      // Add other services as they are implemented...
    } catch (error: any) {
      this.logger.error(`Error resolving services in ModuleRegistry: ${error.message}`);
    }
  }

  private async resolveService(key: string, token: string) {
    try {
      const service = this.moduleRef.get(token, { strict: false });
      if (service) {
        this.serviceMap.set(key, service);
        this.logger.log(`Resolved ${key}: ${token}`);
      }
    } catch (e) {
      this.logger.warn(`Could not resolve ${token}. This is expected if the network-specific implementation is not loaded.`);
    }
  }

  getAssetOriginationService(): IAssetOriginationService {
    return this.getService<IAssetOriginationService>(ASSET_ORIGINATION_SERVICE);
  }

  getAdminDomainStrategy(): IAdminDomainStrategy {
    return this.getService<IAdminDomainStrategy>(ADMIN_DOMAIN_STRATEGY);
  }

  /**
   * Generic getter for any registered service
   */
  getService<T>(token: string): T {
    const service = this.serviceMap.get(token);
    if (!service) {
      throw new Error(`Service ${token} not available for network ${this.networkType}`);
    }
    return service as T;
  }
}
