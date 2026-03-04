import { Injectable, NestMiddleware, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { NetworkType } from '@openassets/types';
import { NetworkContextService } from '../services/network-context.service';
import { ChainManagerRegistry } from '../services/chain-manager-registry.service';

@Injectable()
export class NetworkContextMiddleware implements NestMiddleware {
  private enabledNetworks: NetworkType[] = [];

  constructor(
    private readonly networkContextService: NetworkContextService,
    private readonly configService: ConfigService,
  ) {
    const enabledStr = this.configService.get<string>('ENABLED_NETWORKS') || 
                      this.configService.get<string>('network.networkType') || 
                      'mantle';
    this.enabledNetworks = enabledStr.split(',').map(n => n.trim() as NetworkType);
  }

  use(req: Request, res: Response, next: NextFunction) {
    const networkHeader = req.header('X-Network')?.toLowerCase();

    let network: NetworkType = NetworkType.MANTLE;

    if (networkHeader) {
      const validNetworks = Object.values(NetworkType).filter(n => n !== NetworkType.UNKNOWN);
      if (!validNetworks.includes(networkHeader as NetworkType)) {
        throw new BadRequestException(`Invalid network '${networkHeader}'. Valid networks: ${validNetworks.join(', ')}`);
      }

      const enabledNetworks = this.chainManagerRegistry.getEnabledNetworks();
      if (!enabledNetworks.includes(networkHeader as NetworkType)) {
        throw new ForbiddenException(`Network '${networkHeader}' is not enabled in this deployment`);
      }

      network = networkHeader as NetworkType;
    }

    if (!this.enabledNetworks.includes(network)) {
      throw new ForbiddenException(`Network ${network} is not enabled on this deployment`);
    }

    this.networkContextService.runWithNetwork(network, () => {
      (req as any).network = network;
      next();
    });
  }
}
